// usePlaybackManager.js — Core state machine for Dual-Camera Synchronized Playback
import { useState, useEffect, useRef, useCallback } from 'react';
import { requestVideoList, fetchVideoList, playVideo, checkUploadStatus } from '../services/api';

const SECONDS_IN_DAY   = 86_400;
const POLL_INTERVAL_MS = 1_000;
const SYNC_TOLERANCE_SEC = 180;

const FILENAME_RE = /^(\d{4})_(\d{2})_(\d{2})_(\d{2})_(\d{2})_(\d{2})_(\d{2})\.ts$/;

function parseFilename(filename) {
  const m = filename.match(FILENAME_RE);
  if (!m) return null;
  const [, year, month, day, hour, min, sec, cc] = m;
  const startTime = new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(min), Number(sec));
  const channel = cc === '03' ? 'forward' : 'inward';
  const secondsFromMidnight = Number(hour) * 3600 + Number(min) * 60 + Number(sec);
  return {
    filename, channel, startTime,
    endTime: new Date(startTime.getTime() + 180_000),
    secondsFromMidnight,
    timelinePct: secondsFromMidnight / SECONDS_IN_DAY,
  };
}

function refineEndTimes(clips) {
  const sorted = [...clips].sort((a, b) => a.startTime - b.startTime);
  return sorted.map((clip, i) => {
    const next = sorted[i + 1];
    if (next && next.channel === clip.channel) {
      const gap = next.startTime - clip.startTime;
      if (gap > 0 && gap <= 300_000) return { ...clip, endTime: new Date(next.startTime) };
    }
    return clip;
  });
}

function findClipPairAtTime(seconds, forwardClips, inwardClips) {
  // Find clips that contain this timestamp
  const fwd = forwardClips.find(c => 
    c.secondsFromMidnight <= seconds && 
    seconds < c.secondsFromMidnight + 180 // within clip duration (approx 3 min)
  );
  const inw = inwardClips.find(c => 
    c.secondsFromMidnight <= seconds && 
    seconds < c.secondsFromMidnight + 180
  );
  
  // Calculate offset within each clip
  const calculateOffset = (clip) => {
    if (!clip) return 0;
    return Math.max(0, seconds - clip.secondsFromMidnight);
  };
  
  if (fwd || inw) { 
    return { 
      forward: fwd ?? null, 
      inward: inw ?? null,
      forwardOffset: calculateOffset(fwd),
      inwardOffset: calculateOffset(inw)
    }; 
  }
  
  // Fallback: closest clips within tolerance
  const closestFwd = forwardClips.reduce((best, c) => 
    !best || Math.abs(c.secondsFromMidnight - seconds) < Math.abs(best.secondsFromMidnight - seconds) ? c : best, null);
  const closestInw = inwardClips.reduce((best, c) => 
    !best || Math.abs(c.secondsFromMidnight - seconds) < Math.abs(best.secondsFromMidnight - seconds) ? c : best, null);
  return { 
    forward: closestFwd, 
    inward: closestInw,
    forwardOffset: calculateOffset(closestFwd),
    inwardOffset: calculateOffset(closestInw)
  };
}

function findNextClipPair(currentPair, forwardClips, inwardClips) {
  const nextFwd = currentPair.forward ? 
    forwardClips.slice().sort((a, b) => a.startTime - b.startTime)
      .find(c => c.startTime > currentPair.forward.startTime) : null;
  const nextInw = currentPair.inward ?
    inwardClips.slice().sort((a, b) => a.startTime - b.startTime)
      .find(c => c.startTime > currentPair.inward.startTime) : null;
  return { forward: nextFwd, inward: nextInw };
}

export function usePlaybackManager(imei) {
  const [timelineData, setTimelineData] = useState([]);
  const [inventoryLoading, setInventoryLoading] = useState(true);
  const [inventoryError, setInventoryError] = useState(null);
  const [playbackStatus, setPlaybackStatus] = useState('idle');
  const [currentClipPair, setCurrentClipPair] = useState({ forward: null, inward: null });
  const [nextClipPair, setNextClipPair] = useState({ forward: null, inward: null });
  const [forwardStreamUrl, setForwardStreamUrl] = useState(null);
  const [inwardStreamUrl, setInwardStreamUrl] = useState(null);
  const [nextForwardUrl, setNextForwardUrl] = useState(null);
  const [nextInwardUrl, setNextInwardUrl] = useState(null);
  const [startOffsets, setStartOffsets] = useState({ forward: 0, inward: 0 });
  const [currentTimeOffset, setCurrentTimeOffset] = useState(() => {
    const now = new Date();
    return now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
  });
  const [fetchTick, setFetchTick] = useState(0);

  const pollTimerRef = useRef(null);
  const pollAbortRef = useRef(false);

  const forwardClips = timelineData.filter((c) => c.channel === 'forward');
  const inwardClips = timelineData.filter((c) => c.channel === 'inward');

  useEffect(() => {
    let cancelled = false;
    
    async function loadVideoList() {
      try {
        setInventoryLoading(true);
        
        // API 1: Wake the dashcam and trigger SD card scan
        await requestVideoList(imei);
        if (cancelled) return;
        
        // API 2: Poll for video list — the live device takes a few seconds
        // to scan its SD card and POST results back to the server.
        const MAX_RETRIES = 10;
        const RETRY_DELAY_MS = 2000;
        let videos = [];
        
        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
          if (cancelled) return;
          
          const res = await fetchVideoList(imei);
          const list = res.videos || res;
          videos = Array.isArray(list) ? list : [];
          
          if (videos.length > 0) {
            console.log(`[Playback] Got ${videos.length} clips on attempt ${attempt}`);
            break;
          }
          
          if (attempt < MAX_RETRIES) {
            console.log(`[Playback] Empty list, retry ${attempt}/${MAX_RETRIES} in ${RETRY_DELAY_MS}ms...`);
            await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
          }
        }
        
        if (cancelled) return;
        setTimelineData(refineEndTimes(videos.map(parseFilename).filter(Boolean)));
        setInventoryError(null);
      } catch (err) {
        if (cancelled) return;
        setInventoryError(err.message ?? 'Failed to load clips');
      } finally {
        if (!cancelled) setInventoryLoading(false);
      }
    }
    
    loadVideoList();
    return () => { cancelled = true; };
  }, [imei, fetchTick]);

  const stopPolling = useCallback(() => {
    pollAbortRef.current = true;
    if (pollTimerRef.current) { clearInterval(pollTimerRef.current); pollTimerRef.current = null; }
  }, []);

  const stop = useCallback(() => {
    stopPolling();
    setPlaybackStatus('idle');
    setCurrentClipPair({ forward: null, inward: null });
    setNextClipPair({ forward: null, inward: null });
    setForwardStreamUrl(null);
    setInwardStreamUrl(null);
    setNextForwardUrl(null);
    setNextInwardUrl(null);
  }, [stopPolling]);

  useEffect(() => stop, [stop]);

  const initiatePlayback = useCallback(async (clipPair) => {
    stopPolling();
    pollAbortRef.current = false;
    const next = findNextClipPair(clipPair, forwardClips, inwardClips);

    setCurrentClipPair(clipPair);
    setNextClipPair(next);
    setForwardStreamUrl(null);
    setInwardStreamUrl(null);
    setNextForwardUrl(null);
    setNextInwardUrl(null);
    setStartOffsets({
      forward: clipPair.forwardOffset || 0,
      inward: clipPair.inwardOffset || 0
    });
    setPlaybackStatus('loading_device');
    setCurrentTimeOffset(clipPair.forward?.secondsFromMidnight ?? clipPair.inward?.secondsFromMidnight ?? 0);

    const clipsToPlay = [clipPair.forward, clipPair.inward, next.forward, next.inward].filter(Boolean);
    const uniqueFiles = [...new Set(clipsToPlay.map(c => c.filename))];
    
    for (const f of uniqueFiles) {
      playVideo(imei, f).catch(() => {});
    }

    pollTimerRef.current = setInterval(async () => {
      if (pollAbortRef.current) return;
      try {
        const urls = {};
        
        for (const clip of [clipPair.forward, clipPair.inward].filter(Boolean)) {
          const { status, url } = await checkUploadStatus(imei, clip.filename);
          if (status === 'ready' && url) {
            urls[clip.channel] = url;
          }
        }

        const fwdReady = !clipPair.forward || urls.forward;
        const inwReady = !clipPair.inward || urls.inward;

        if (fwdReady && inwReady) {
          // Current clip is ready — start playing
          if (urls.forward) setForwardStreamUrl(urls.forward);
          if (urls.inward) setInwardStreamUrl(urls.inward);
          setPlaybackStatus('playing');

          // Stop the current-clip poller, start a next-clip poller
          clearInterval(pollTimerRef.current);
          pollTimerRef.current = null;

          // Background poller: keep checking until next clips are ready
          if (next.forward || next.inward) {
            const nextPoller = setInterval(async () => {
              if (pollAbortRef.current) {
                clearInterval(nextPoller);
                return;
              }
              let allNextReady = true;

              for (const clip of [next.forward, next.inward].filter(Boolean)) {
                const ns = await checkUploadStatus(imei, clip.filename);
                if (ns.status === 'ready' && ns.url) {
                  if (clip.channel === 'forward') setNextForwardUrl(ns.url);
                  else setNextInwardUrl(ns.url);
                } else {
                  allNextReady = false;
                }
              }

              if (allNextReady) {
                clearInterval(nextPoller);
                console.log('[Poller] Next clips pre-fetched and ready');
              }
            }, POLL_INTERVAL_MS);
          }
        }
      } catch (e) {
        console.error('[Poller]', e);
      }
    }, POLL_INTERVAL_MS);
  }, [imei, forwardClips, inwardClips, stopPolling]);

  // Ref for dispatching seek events to the video elements without restarting playback
  const seekEventRef = useRef(null);

  const seekToTime = useCallback((seconds) => {
    const pair = findClipPairAtTime(seconds, forwardClips, inwardClips);
    if (!pair.forward && !pair.inward) return;

    // Check if the clicked time falls within the currently playing clips.
    // If so, just seek within the video instead of restarting the whole API flow.
    const currentFwd = currentClipPair.forward;
    const currentInw = currentClipPair.inward;
    const isWithinCurrentFwd = currentFwd && pair.forward &&
      currentFwd.filename === pair.forward.filename;
    const isWithinCurrentInw = currentInw && pair.inward &&
      currentInw.filename === pair.inward.filename;

    if (playbackStatus === 'playing' && (isWithinCurrentFwd || isWithinCurrentInw)) {
      // Local seek — no API calls needed
      const newOffsets = {
        forward: pair.forwardOffset || 0,
        inward: pair.inwardOffset || 0,
      };
      setStartOffsets(newOffsets);
      setCurrentTimeOffset(seconds);

      // Dispatch seek event so SeamlessPlayer components can update video.currentTime
      if (seekEventRef.current) seekEventRef.current(newOffsets);
      return;
    }

    // Different clip — full restart needed
    initiatePlayback(pair);
  }, [forwardClips, inwardClips, initiatePlayback, currentClipPair, playbackStatus]);

  const seekToClip = useCallback((clip) => {
    const pair = { 
      forward: clip.channel === 'forward' ? clip : null, 
      inward: clip.channel === 'inward' ? clip : null 
    };
    if (clip.channel === 'forward') {
      const matchingInward = inwardClips.find(c => 
        Math.abs(c.secondsFromMidnight - clip.secondsFromMidnight) <= SYNC_TOLERANCE_SEC);
      if (matchingInward) pair.inward = matchingInward;
    } else {
      const matchingForward = forwardClips.find(c => 
        Math.abs(c.secondsFromMidnight - clip.secondsFromMidnight) <= SYNC_TOLERANCE_SEC);
      if (matchingForward) pair.forward = matchingForward;
    }
    initiatePlayback(pair);
  }, [forwardClips, inwardClips, initiatePlayback]);

  const onVideoEnded = useCallback(() => {
    if (!nextClipPair.forward && !nextClipPair.inward) {
      setPlaybackStatus('idle');
      setCurrentClipPair({ forward: null, inward: null });
      setForwardStreamUrl(null);
      setInwardStreamUrl(null);
      return;
    }

    const useNext = nextForwardUrl || nextInwardUrl;
    
    if (useNext) {
      const newNext = findNextClipPair(nextClipPair, forwardClips, inwardClips);
      setCurrentClipPair(nextClipPair);
      setNextClipPair(newNext);
      setForwardStreamUrl(nextForwardUrl);
      setInwardStreamUrl(nextInwardUrl);
      setNextForwardUrl(null);
      setNextInwardUrl(null);
      setPlaybackStatus('playing');
      setCurrentTimeOffset(nextClipPair.forward?.secondsFromMidnight ?? nextClipPair.inward?.secondsFromMidnight ?? 0);
      
      if (newNext.forward) playVideo(imei, newNext.forward.filename).catch(() => {});
      if (newNext.inward) playVideo(imei, newNext.inward.filename).catch(() => {});
    } else {
      initiatePlayback(nextClipPair);
    }
  }, [nextClipPair, nextForwardUrl, nextInwardUrl, forwardClips, inwardClips, imei, initiatePlayback]);

  const onTimeUpdate = useCallback((elapsed) => {
    const clip = currentClipPair.forward || currentClipPair.inward;
    if (!clip) return;
    setCurrentTimeOffset(Math.min(clip.secondsFromMidnight + elapsed, SECONDS_IN_DAY - 1));
  }, [currentClipPair]);

  const refetch = useCallback(() => {
    localStorage.removeItem(`okdriver_video_list_${imei}`);
    setFetchTick((t) => t + 1);
  }, [imei]);

  return {
    timelineData, forwardClips, inwardClips,
    inventoryLoading, inventoryError, refetch,
    playbackStatus, currentClipPair, nextClipPair,
    forwardStreamUrl, inwardStreamUrl,
    nextForwardUrl, nextInwardUrl,
    startOffsets,
    currentTimeOffset,
    seekToTime, seekToClip, onVideoEnded, onTimeUpdate, stop,
    seekEventRef,
  };
}