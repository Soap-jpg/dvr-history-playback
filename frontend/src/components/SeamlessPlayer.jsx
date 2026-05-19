// ---------------------------------------------------------------------------
// SeamlessPlayer.jsx
//
// Double-buffered HTML5 video player with HLS.js and custom controls.
// ---------------------------------------------------------------------------

import { useEffect, useRef, useState, useCallback } from 'react';
import Hls from 'hls.js';

const CHANNEL_ACCENT = {
  forward: '#3b82f6',
  inward:  '#22c55e',
};

function formatTime(seconds) {
  if (!seconds || !isFinite(seconds)) return '00:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function Spinner({ color }) {
  return (
    <svg className="spin" width="44" height="44" viewBox="0 0 44 44">
      <circle cx="22" cy="22" r="18" fill="none" stroke={`${color}30`} strokeWidth="3.5" />
      <circle
        cx="22" cy="22" r="18"
        fill="none"
        stroke={color}
        strokeWidth="3.5"
        strokeDasharray="24 90"
        strokeLinecap="round"
      />
    </svg>
  );
}

function StatusOverlay({ status, accentColor }) {
  if (status === 'playing') return null;

  const isLoading = status === 'loading_device';

  return (
    <div className="absolute inset-0 z-30 flex flex-col items-center justify-center"
         style={{ background: 'rgba(12,17,23,0.82)', backdropFilter: 'blur(6px)' }}>
      {isLoading ? (
        <>
          <Spinner color={accentColor} />
          <p className="mt-4 text-xs font-semibold tracking-[0.2em] uppercase"
             style={{ color: accentColor, fontFamily: 'var(--font-mono)' }}>
            Buffering Clip…
          </p>
          <p className="mt-1 text-[10px] tracking-widest text-slate-500 uppercase">
            Polling device upload
          </p>
        </>
      ) : (
        <>
          <div className="w-12 h-12 rounded-full border flex items-center justify-center mb-4"
               style={{ borderColor: `${accentColor}40`, background: `${accentColor}10` }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill={accentColor}>
              <path d="M8 5v14l11-7z" />
            </svg>
          </div>
          <p className="text-xs font-semibold tracking-[0.2em] uppercase text-slate-400"
             style={{ fontFamily: 'var(--font-mono)' }}>
            Click Timeline to Play
          </p>
        </>
      )}
    </div>
  );
}

function PrefetchBadge({ hasNext }) {
  if (!hasNext) return null;
  return (
    <div className="absolute bottom-3 left-3 z-20">
      <div className="flex items-center gap-1.5 px-2 py-0.5 rounded text-[9px] font-semibold tracking-widest uppercase"
           style={{
             background: 'rgba(99,102,241,0.15)',
             border:     '1px solid rgba(99,102,241,0.35)',
             color:      '#a5b4fc',
             fontFamily: 'var(--font-mono)',
           }}>
        <span className="w-1 h-1 rounded-full bg-indigo-400 animate-pulse" />
        Next Buffered
      </div>
    </div>
  );
}

const SeamlessPlayer = ({
  streamUrl,
  nextStreamUrl,
  status,
  channel,
  label,
  clipStartTime,
  startOffset = 0,
  onEnded,
  onTimeUpdate,
  videoRef,
}) => {
  const accentColor = CHANNEL_ACCENT[channel] ?? '#3b82f6';

  const videoARef = useRef(null);
  const videoBRef = useRef(null);

  const [activeSlot, setActiveSlot] = useState('A');
  const [hudTime, setHudTime] = useState('--:--:--');

  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const playbackRates = [0.5, 1, 1.5, 2, 4];

  // HLS.js instances for double-buffered playback
  const hlsARef = useRef(null);
  const hlsBRef = useRef(null);

  // Expose the active video element to the parent via videoRef
  useEffect(() => {
    if (videoRef) {
      videoRef.current = activeSlot === 'A' ? videoARef.current : videoBRef.current;
    }
  }, [activeSlot, videoRef]);

  /**
   * Helper: attach an HLS stream to a video element
   * Returns the Hls instance or null if native HLS is used (Safari)
   */
  function attachHls(url, videoEl, autoplay = false) {
    if (!url || !videoEl) return null;

    // If URL is a direct video file (MP4 or TS from live API), play natively
    const isDirectVideo = url.includes('.mp4') || (url.includes('.ts') && !url.includes('playlist'));
    if (isDirectVideo) {
      console.log(`[SeamlessPlayer:${channel}] Direct video: ${url}`);
      videoEl.src = url;
      videoEl.load();
      if (autoplay) {
        videoEl.play().catch((err) => {
          if (err.name !== 'AbortError') {
            console.warn(`[SeamlessPlayer:${channel}] Autoplay blocked:`, err.message);
          }
        });
      }
      return null; // No HLS instance needed for direct playback
    }

    // HLS playlist (.m3u8) — use hls.js
    if (Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
      });
      hls.loadSource(url);
      hls.attachMedia(videoEl);

      if (autoplay) {
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          videoEl.play().catch((err) => {
            if (err.name !== 'AbortError') {
              console.warn(`[SeamlessPlayer:${channel}] Autoplay blocked:`, err.message);
            }
          });
        });
      }

      return hls;
    } else if (videoEl.canPlayType('application/vnd.apple.mpegurl')) {
      // Safari has native HLS support
      videoEl.src = url;
      videoEl.load();
      if (autoplay) {
        videoEl.play().catch((err) => {
          if (err.name !== 'AbortError') {
            console.warn(`[SeamlessPlayer:${channel}] Autoplay blocked:`, err.message);
          }
        });
      }
      return null; // No hls instance needed for Safari
    }

    console.error('[SeamlessPlayer] HLS not supported in this browser');
    return null;
  }

  /**
   * Helper: destroy an HLS instance safely
   */
  function destroyHls(hlsRef) {
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
  }

  // ── Slot A: primary player ──
  useEffect(() => {
    const vid = videoARef.current;
    if (!vid) return;

    destroyHls(hlsARef);

    if (!streamUrl) {
      vid.removeAttribute('src');
      vid.load();
      return;
    }

    setActiveSlot('A');
    hlsARef.current = attachHls(streamUrl, vid, true);
  }, [streamUrl, channel]);

  // Track the last applied offset to detect new seek requests
  const lastAppliedOffsetRef = useRef(0);

  // Seek to startOffset after video loads and when startOffset changes
  useEffect(() => {
    const vid = videoARef.current;
    if (!vid || !streamUrl) return;

    // If startOffset changed, apply it
    if (startOffset !== lastAppliedOffsetRef.current) {
      lastAppliedOffsetRef.current = startOffset;

      // If video is already loaded, seek directly
      if (vid.readyState >= 2) {
        vid.currentTime = startOffset;
        return;
      }

      // Otherwise wait for canplay
      const handleCanPlay = () => {
        vid.currentTime = startOffset;
        vid.removeEventListener('canplay', handleCanPlay);
      };
      vid.addEventListener('canplay', handleCanPlay);
      return () => vid.removeEventListener('canplay', handleCanPlay);
    }
  }, [streamUrl, startOffset]);

  // ── Slot B: pre-buffered next clip ──
  useEffect(() => {
    const vid = videoBRef.current;
    if (!vid) return;

    destroyHls(hlsBRef);

    if (!nextStreamUrl) {
      vid.removeAttribute('src');
      vid.load();
      return;
    }

    hlsBRef.current = attachHls(nextStreamUrl, vid, false);
    // Pause immediately — this slot is just pre-loading
    vid.pause();
  }, [nextStreamUrl]);

  // Cleanup HLS instances on unmount
  useEffect(() => {
    return () => {
      destroyHls(hlsARef);
      destroyHls(hlsBRef);
    };
  }, []);

  const handleVideoAEnded = useCallback(() => {
    const vidB = videoBRef.current;

    if (nextStreamUrl && vidB) {
      setActiveSlot('B');
      vidB.currentTime = 0;
      vidB.play().catch(() => {});
    }

    onEnded?.();
  }, [nextStreamUrl, onEnded]);

  const handleVideoBEnded = useCallback(() => {
    onEnded?.();
  }, [onEnded]);

  const handleTimeUpdate = useCallback(() => {
    const vid = activeSlot === 'A' ? videoARef.current : videoBRef.current;
    if (!vid) return;

    const elapsed = vid.currentTime;
    onTimeUpdate?.(elapsed);
    setCurrentTime(elapsed);
    setDuration(vid.duration || 0);

    if (clipStartTime) {
      const absTime = new Date(clipStartTime.getTime() + elapsed * 1000);
      setHudTime(absTime.toTimeString().slice(0, 8));
    }
  }, [activeSlot, clipStartTime, onTimeUpdate]);

  const handlePlayPause = useCallback(() => {
    const vid = activeSlot === 'A' ? videoARef.current : videoBRef.current;
    if (!vid) return;
    if (vid.paused) {
      vid.play().catch(() => {});
      setIsPlaying(true);
    } else {
      vid.pause();
      setIsPlaying(false);
    }
  }, [activeSlot]);

  const handleSeekBarClick = useCallback((e) => {
    const vid = activeSlot === 'A' ? videoARef.current : videoBRef.current;
    if (!vid || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    vid.currentTime = pct * duration;
  }, [activeSlot, duration]);

  const handleSpeedChange = useCallback((rate) => {
    const vid = activeSlot === 'A' ? videoARef.current : videoBRef.current;
    if (!vid) return;
    vid.playbackRate = rate;
    setPlaybackSpeed(rate);
  }, [activeSlot]);

  useEffect(() => {
    const vid = activeSlot === 'A' ? videoARef.current : videoBRef.current;
    if (!vid) return;
    const updatePlayState = () => setIsPlaying(!vid.paused);
    vid.addEventListener('play', updatePlayState);
    vid.addEventListener('pause', updatePlayState);
    return () => {
      vid.removeEventListener('play', updatePlayState);
      vid.removeEventListener('pause', updatePlayState);
    };
  }, [activeSlot]);

  const opacityA = activeSlot === 'A' ? 1 : 0;
  const opacityB = activeSlot === 'B' ? 1 : 0;
  const zIndexA  = activeSlot === 'A' ? 10 : 5;
  const zIndexB  = activeSlot === 'B' ? 10 : 5;

  const progressPct = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div
      className="relative w-full h-full rounded-lg overflow-hidden bg-black scanlines"
      style={{ border: `1px solid ${accentColor}28` }}
    >
      <div
        className="absolute inset-0 pointer-events-none z-20"
        style={{
          background: 'linear-gradient(to top, rgba(0,0,0,0.65) 0%, transparent 45%, rgba(0,0,0,0.25) 100%)',
        }}
      />

      <StatusOverlay status={status} accentColor={accentColor} />

      <video
        ref={videoARef}
        className="absolute inset-0 w-full h-full object-contain bg-black video-layer"
        style={{ opacity: opacityA, zIndex: zIndexA }}
        playsInline
        onEnded={handleVideoAEnded}
        onTimeUpdate={handleTimeUpdate}
      />

      <video
        ref={videoBRef}
        className="absolute inset-0 w-full h-full object-contain bg-black video-layer"
        style={{ opacity: opacityB, zIndex: zIndexB }}
        playsInline
        onEnded={handleVideoBEnded}
      />

      <div className="absolute top-3 left-3 z-30 flex flex-col gap-1.5 pointer-events-none">
        <div
          className="flex items-center gap-2 px-2.5 py-1 rounded text-xs font-semibold tracking-[0.18em] uppercase"
          style={{
            background:   `${accentColor}18`,
            border:       `1px solid ${accentColor}45`,
            backdropFilter: 'blur(8px)',
            color:        accentColor,
            fontFamily:   'var(--font-mono)',
          }}
        >
          <span
            className="w-1.5 h-1.5 rounded-full animate-glow"
            style={{ background: accentColor, color: accentColor }}
          />
          {label}
        </div>

        {status === 'playing' && (
          <div
            className="px-2.5 py-0.5 rounded text-[11px] font-medium tracking-widest"
            style={{
              background:   'rgba(0,0,0,0.6)',
              border:       '1px solid rgba(255,255,255,0.08)',
              backdropFilter: 'blur(6px)',
              color:        '#cbd5e1',
              fontFamily:   'var(--font-mono)',
            }}
          >
            {hudTime}
          </div>
        )}
      </div>

      <div className="absolute top-3 right-3 z-30 pointer-events-none">
        <div
          className="px-2 py-0.5 rounded text-[9px] font-semibold tracking-widest uppercase"
          style={{
            background: 'rgba(0,0,0,0.5)',
            border:     '1px solid rgba(255,255,255,0.07)',
            color:      '#64748b',
            fontFamily: 'var(--font-mono)',
          }}
        >
          H.264 · HLS
        </div>
      </div>

      <PrefetchBadge hasNext={!!nextStreamUrl} />

      <div className="absolute bottom-0 left-0 right-0 z-30"
           style={{
             background: 'linear-gradient(to top, rgba(0,0,0,0.85) 0%, transparent 100%)',
             padding: '32px 12px 12px',
           }}>
        <div className="relative h-2 rounded-full cursor-pointer mb-2"
             style={{ background: 'rgba(255,255,255,0.15)' }}
             onClick={handleSeekBarClick}>
          <div
            className="absolute top-0 left-0 h-full rounded-full"
            style={{ background: accentColor, width: `${progressPct}%` }}
          />
          <div
            className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full shadow"
            style={{ background: '#fff', left: `calc(${progressPct}% - 6px)` }}
          />
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button
              onClick={handlePlayPause}
              className="w-8 h-8 flex items-center justify-center rounded-full transition-colors"
              style={{ background: `${accentColor}30`, color: '#fff' }}
            >
              {isPlaying ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                  <rect x="6" y="4" width="4" height="16" rx="1" />
                  <rect x="14" y="4" width="4" height="16" rx="1" />
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M8 5v14l11-7z" />
                </svg>
              )}
            </button>

            <span className="text-[10px]" style={{ color: '#94a3b8', fontFamily: 'var(--font-mono)' }}>
              {formatTime(currentTime)} / {formatTime(duration)}
            </span>
          </div>

          <div className="flex items-center gap-1">
            {playbackRates.map(rate => (
              <button
                key={rate}
                onClick={() => handleSpeedChange(rate)}
                className="px-2 py-0.5 rounded text-[9px] font-semibold transition-colors"
                style={{
                  background: playbackSpeed === rate ? accentColor : 'rgba(255,255,255,0.1)',
                  color: playbackSpeed === rate ? '#fff' : '#94a3b8',
                  fontFamily: 'var(--font-mono)',
                }}
              >
                {rate}x
              </button>
            ))}
          </div>
        </div>
      </div>

      {status === 'playing' && (
        <div className="absolute bottom-3 right-3 z-30 pointer-events-none">
          <div
            className="flex items-center gap-1.5 px-2.5 py-1 rounded text-[9px] font-semibold tracking-widest uppercase"
            style={{
              background: `${accentColor}14`,
              border:     `1px solid ${accentColor}35`,
              color:      accentColor,
              fontFamily: 'var(--font-mono)',
            }}
          >
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: accentColor }} />
            REC · HISTORY
          </div>
        </div>
      )}
    </div>
  );
};

export default SeamlessPlayer;