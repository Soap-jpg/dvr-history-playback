import React, { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import { Play, Pause, FastForward, Rewind } from 'lucide-react';

interface RecordingRange {
  from: number;
  duration: number;
}

interface AIEvent {
  type: string;
  timestamp: number;
  confidence: number;
}

const CameraPlayer = React.forwardRef(({ cameraId, videoSrc, isPlaying, onPlay, onPause, showNoFootageMessage, playbackTime, onPlayingDateChange }: any, ref: any) => {
  const videoRef = ref;

  useEffect(() => {
    if (!videoRef.current) return;
    let hls: Hls;

    if (Hls.isSupported()) {
      hls = new Hls();
      hls.loadSource(videoSrc);
      hls.attachMedia(videoRef.current);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        videoRef.current?.play().catch(err => console.log('Autoplay prevented:', err));
      });

      // Constantly report the TRUE real-world time of the video back to the timeline
      const syncInterval = setInterval(() => {
        if (hls && hls.playingDate && onPlayingDateChange && videoRef.current && !videoRef.current.paused) {
          onPlayingDateChange(hls.playingDate);
        }
      }, 500);

      return () => {
        clearInterval(syncInterval);
        hls.destroy();
      };
    } else if (videoRef.current.canPlayType('application/vnd.apple.mpegurl')) {
      videoRef.current.src = videoSrc;
      videoRef.current.addEventListener('loadedmetadata', () => {
        videoRef.current?.play().catch(err => console.log('Autoplay prevented:', err));
      });
    }
    return () => { if (hls) hls.destroy(); };
  }, [videoSrc]);

  return (
    <div className="w-full h-full bg-surface-container border border-outline-variant rounded relative overflow-hidden shadow-lg group">
      <video
        ref={videoRef}
        muted
        onPlay={onPlay}
        onPause={onPause}
        className="absolute inset-0 w-full h-full object-contain bg-black"
        playsInline
      />
      <div className="absolute inset-0 z-30 pointer-events-none"></div>
      <div className="absolute inset-0 bg-gradient-to-t from-surface-container-lowest/90 via-transparent to-surface-container-lowest/30 pointer-events-none"></div>

      <div className="absolute top-4 left-4 flex flex-col space-y-2 pointer-events-none z-40">
        <div className="flex space-x-2">
          <div className="bg-surface/80 backdrop-blur-sm border border-outline-variant px-2.5 py-1 rounded flex items-center w-fit shadow-md">
            <span className="font-data-tabular text-data-tabular text-on-surface tracking-wider">{cameraId}</span>
          </div>
          <div className="bg-surface/80 backdrop-blur-sm border border-outline-variant px-2.5 py-1 rounded flex items-center w-fit shadow-md">
            <span className="font-data-tabular text-data-tabular text-on-surface tracking-wider">
              {playbackTime.toTimeString().split(' ')[0]}
            </span>
          </div>
        </div>
        <div className="bg-surface/80 backdrop-blur-sm border border-outline-variant px-2.5 py-0.5 rounded flex items-center w-fit shadow-sm">
          <span className="font-data-tabular text-data-tabular text-on-surface-variant text-[11px] uppercase">1080p / 60FPS</span>
        </div>
      </div>

      {showNoFootageMessage && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-50">
          <div className="bg-surface/90 backdrop-blur-md border border-outline px-6 py-3 rounded shadow-2xl flex items-center space-x-3">
            <span className="w-2 h-2 rounded-full bg-[#ef4444] animate-pulse"></span>
            <span className="font-label-caps text-label-caps text-on-surface tracking-wider">NO FOOTAGE AVAILABLE</span>
          </div>
        </div>
      )}
    </div>
  );
});

export default function DVRPlayback() {
  const videoRef1 = useRef<HTMLVideoElement>(null);
  const videoRef2 = useRef<HTMLVideoElement>(null);

  const [isLive, setIsLive] = useState<boolean>(true);
  const [isPlaying1, setIsPlaying1] = useState<boolean>(false);
  const [isPlaying2, setIsPlaying2] = useState<boolean>(false);
  
  const [videoSrc1, setVideoSrc1] = useState<string>('/api/iit-assignment-cam/live.m3u8');
  const [videoSrc2, setVideoSrc2] = useState<string>('/api/cam-2/live.m3u8');
  
  const [playbackTime, setPlaybackTime] = useState<Date>(new Date());
  const [playheadPct, setPlayheadPct] = useState<number>(62.5);
  const [showNoFootageMessage, setShowNoFootageMessage] = useState<boolean>(false);

  const [recordingRanges, setRecordingRanges] = useState<RecordingRange[]>([]);
  const [aiEvents, setAiEvents] = useState<AIEvent[]>([]);
  
  const ignoreTimeUpdateRef = useRef<boolean>(false);
  const skipPauseDetectionRef = useRef<boolean>(false);
  const trueLiveDateRef = useRef<Date | null>(null);

  const isPlaying = isPlaying1 || isPlaying2;
  const [realTime, setRealTime] = useState<number>(Date.now());

  // Disable fast forward if the clock hasn't fallen at least 10s behind real time
  const canSkipForward = (realTime - playbackTime.getTime()) >= 9000; // 9s for safety margin

  // Playhead and time sync (Only for Live. VOD is synced via CameraPlayer's true playingDate)
  useEffect(() => {
    const interval = setInterval(() => {
      setRealTime(Date.now());
      if (isLive && isPlaying) {
        setPlaybackTime(prev => {
          // If we've fallen more than 2 seconds behind real time, we're acting like VOD.
          // Don't jump to Date.now() (which would skip the clock ahead of the video),
          // instead just tick +1s to maintain seamless playback at the frozen time.
          if (Date.now() - prev.getTime() > 2000) {
            const next = new Date(prev.getTime() + 1000);
            const secondsSinceMidnight = next.getHours() * 3600 + next.getMinutes() * 60 + next.getSeconds();
            setPlayheadPct((secondsSinceMidnight / 86400) * 100);
            return next;
          }
          
          const now = new Date();
          const secondsSinceMidnight = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
          setPlayheadPct((secondsSinceMidnight / 86400) * 100);
          return now;
        });
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [isLive, isPlaying]);

  const handleTrueTimeUpdate = (trueDate: Date) => {
    trueLiveDateRef.current = trueDate;
    if (!isLive && !ignoreTimeUpdateRef.current) {
      setPlaybackTime(trueDate);
      const secondsSinceMidnight = trueDate.getHours() * 3600 + trueDate.getMinutes() * 60 + trueDate.getSeconds();
      setPlayheadPct((secondsSinceMidnight / 86400) * 100);
    }
  };

  const handleTimelineClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percentage = x / rect.width;
    
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const targetUnix = Math.floor(startOfDay.getTime() / 1000) + (percentage * 86400);
    const targetDate = new Date(targetUnix * 1000);
    
    let hasFootage = false;
    for (const range of recordingRanges) {
      if (targetUnix >= (range.from - 120) && targetUnix <= (range.from + range.duration + 120)) {
        hasFootage = true;
        break;
      }
    }

    if (!hasFootage && recordingRanges.length > 0) {
      setShowNoFootageMessage(true);
      setTimeout(() => setShowNoFootageMessage(false), 3000);
      return;
    }
    
    setIsLive(false);
    setPlaybackTime(targetDate);
    setPlayheadPct(percentage * 100);
    
    const endOfDayUnix = Math.floor(startOfDay.getTime() / 1000) + 86400;
    const duration = endOfDayUnix - targetUnix;
    
    setVideoSrc1(`/api/iit-assignment-cam/index-${Math.floor(targetUnix)}-${duration}.m3u8`);
    setVideoSrc2(`/api/cam-2/index-${Math.floor(targetUnix)}-${duration}.m3u8`);
  };

  const jumpToLive = () => {
    if (isLive) return;
    // Prevent the pause-detection from immediately undoing this
    skipPauseDetectionRef.current = true;
    setTimeout(() => skipPauseDetectionRef.current = false, 2000);
    
    setIsLive(true);
    // Cache-buster forces React to see a new URL, destroying the old HLS
    // instance and creating a fresh one at the actual live edge
    const t = Date.now();
    setVideoSrc1(`/api/iit-assignment-cam/live.m3u8?t=${t}`);
    setVideoSrc2(`/api/cam-2/live.m3u8?t=${t}`);
    setPlaybackTime(new Date());
  };

  const toggleMasterPlay = () => {
    const isAnyPaused = videoRef1.current?.paused || videoRef2.current?.paused;
    if (isAnyPaused) {
      // If we are unpausing a live stream and we've fallen more than 10s behind real time,
      // the live HLS buffer is likely dead. We MUST seamlessly transition to History mode
      // starting exactly from the frozen clock time so no footage is lost.
      const gap = Date.now() - playbackTime.getTime();
      if (isLive && gap > 10000) {
        // Use the exact frame time to account for stream latency, preventing skips!
        const actualPauseTime = trueLiveDateRef.current || playbackTime;
        const targetUnix = Math.floor(actualPauseTime.getTime() / 1000);
        
        const now = new Date();
        const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const endOfDayUnix = Math.floor(startOfDay.getTime() / 1000) + 86400;
        const duration = endOfDayUnix - targetUnix;
        
        setIsLive(false);
        setPlaybackTime(actualPauseTime);
        setVideoSrc1(`/api/iit-assignment-cam/index-${targetUnix}-${duration}.m3u8`);
        setVideoSrc2(`/api/cam-2/index-${targetUnix}-${duration}.m3u8`);
        return;
      }

      videoRef1.current?.play().catch(console.error);
      videoRef2.current?.play().catch(console.error);
    } else {
      videoRef1.current?.pause();
      videoRef2.current?.pause();
    }
  };

  const skipBySeconds = (seconds: number) => {
    // Freeze the UI clock so the HLS player's segment-boundary timestamps
    // don't overwrite our clean offset while the new playlist loads
    ignoreTimeUpdateRef.current = true;
    setTimeout(() => ignoreTimeUpdateRef.current = false, 2000);

    const baseTime = isLive ? new Date() : playbackTime;
    const targetUnix = Math.floor(baseTime.getTime() / 1000) + seconds;
    const targetDate = new Date(targetUnix * 1000);

    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfDayUnix = Math.floor(startOfDay.getTime() / 1000) + 86400;
    const duration = endOfDayUnix - targetUnix;

    if (duration <= 0) return; // can't skip past end of day

    // Cap the target so we never request a timestamp too close to "now"
    // (the backend needs at least ~15s of recorded segments to build a playlist)
    const nowUnix = Math.floor(Date.now() / 1000);
    const cappedTargetUnix = Math.min(targetUnix, nowUnix - 15);
    if (cappedTargetUnix <= 0) return;
    const cappedDate = new Date(cappedTargetUnix * 1000);
    const cappedDuration = endOfDayUnix - cappedTargetUnix;

    setIsLive(false);
    setPlaybackTime(cappedDate);
    const secondsSinceMidnight = cappedDate.getHours() * 3600 + cappedDate.getMinutes() * 60 + cappedDate.getSeconds();
    setPlayheadPct((secondsSinceMidnight / 86400) * 100);
    setVideoSrc1(`/api/iit-assignment-cam/index-${cappedTargetUnix}-${cappedDuration}.m3u8`);
    setVideoSrc2(`/api/cam-2/index-${cappedTargetUnix}-${cappedDuration}.m3u8`);
  };

  useEffect(() => {
    const fetchMetadata = async () => {
      try {
        const [statusRes, eventsRes] = await Promise.all([
          fetch('/api/iit-assignment-cam/recording_status.json'),
          fetch('/api/iit-assignment-cam/ai_events.json')
        ]);
        
        if (statusRes.ok) {
          const statusData = await statusRes.json();
          if (statusData && statusData.length > 0) {
            setRecordingRanges(statusData[0].ranges || []);
          }
        }
        
        if (eventsRes.ok) {
          const eventsData = await eventsRes.json();
          setAiEvents(eventsData.events || []);
        }
      } catch (err) {
        console.error('Failed to fetch metadata:', err);
      }
    };

    fetchMetadata();
    const interval = setInterval(fetchMetadata, 10000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex h-screen w-screen overflow-hidden antialiased bg-background dark">
      <div className="flex flex-col flex-1 w-full max-w-[1600px] mx-auto min-w-0 bg-background relative z-10 border-x border-outline-variant shadow-2xl">
        <main className="flex-1 flex flex-col min-h-0 bg-background">
          {/* Header */}
          <header className="flex items-center justify-between px-container-padding py-4 border-b border-surface-container-highest shrink-0 bg-surface-container-lowest">
            <div className="flex items-center space-x-4">
              <h1 className="font-headline-sm text-headline-sm text-on-surface">Dual Camera DVR Playback</h1>
              <div className="flex items-center space-x-2 px-2.5 py-1 rounded-sm bg-surface-container border border-outline-variant">
                <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse shadow-[0_0_8px_rgba(78,222,163,0.6)]"></span>
                <span className="font-label-caps text-label-caps text-primary">LIVE_FEED_AVAILABLE</span>
              </div>
            </div>
            <div className="font-data-tabular text-data-tabular text-on-surface-variant tracking-wider flex items-center space-x-6">
                <button 
                  onClick={jumpToLive}
                  className={`pointer-events-auto backdrop-blur-sm border px-3 py-1.5 rounded transition-colors flex items-center shadow-sm text-sm ${
                    isLive 
                      ? 'border-primary text-primary bg-primary/20 cursor-default' 
                      : 'border-outline text-on-surface bg-surface-container hover:border-primary hover:text-primary cursor-pointer'
                  }`}
                >
                  <FastForward className="w-3 h-3 mr-1.5" />
                  {isLive ? 'LIVE' : 'JUMP TO LIVE'}
                </button>
              <span>
                {new Date().getFullYear()}-{String(new Date().getMonth() + 1).padStart(2, '0')}-{String(new Date().getDate()).padStart(2, '0')} {String(new Date().getHours()).padStart(2, '0')}:{String(new Date().getMinutes()).padStart(2, '0')}:{String(new Date().getSeconds()).padStart(2, '0')} LOCAL
              </span>
            </div>
          </header>

          {/* Video Container (SPLIT SCREEN) */}
          <div className="flex-1 p-4 md:p-6 lg:p-8 flex items-center justify-center relative overflow-hidden bg-background">
            <div className="w-full h-full grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
              <CameraPlayer 
                ref={videoRef1}
                cameraId="CAM1"
                videoSrc={videoSrc1}
                isPlaying={isPlaying1}
                onPlay={() => setIsPlaying1(true)}
                onPause={() => setIsPlaying1(false)}
                showNoFootageMessage={showNoFootageMessage}
                playbackTime={playbackTime}
                onPlayingDateChange={handleTrueTimeUpdate}
              />
              <CameraPlayer 
                ref={videoRef2}
                cameraId="CAM2"
                videoSrc={videoSrc2}
                isPlaying={isPlaying2}
                onPlay={() => setIsPlaying2(true)}
                onPause={() => setIsPlaying2(false)}
                showNoFootageMessage={showNoFootageMessage}
                playbackTime={playbackTime}
              />
            </div>
          </div>

          {/* Timeline UI */}
          <div className="h-timeline-height shrink-0 bg-surface-container border-t border-outline-variant flex flex-col relative">
            <div className="flex justify-between items-center px-4 py-1.5 border-b border-surface-container-highest bg-surface-container-low shrink-0 z-20 shadow-sm">
              <div className="flex items-center space-x-6">
                <div className="flex items-center space-x-1">
                  <button 
                    onClick={() => skipBySeconds(-10)}
                    className="w-8 h-8 flex items-center justify-center rounded-full text-on-surface-variant hover:text-primary hover:bg-surface-container-high transition-colors"
                    title="Skip Back 10s"
                  >
                    <Rewind className="w-4 h-4 fill-current" />
                  </button>
                  <button 
                    onClick={toggleMasterPlay}
                    className="w-8 h-8 flex items-center justify-center rounded-full bg-primary/20 text-primary hover:bg-primary/30 transition-colors shadow-sm"
                    title="Master Play/Pause"
                  >
                    {(!isPlaying1 || !isPlaying2) ? <Play className="w-4 h-4 ml-0.5 fill-current" /> : <Pause className="w-4 h-4 fill-current" />}
                  </button>
                  <button 
                    onClick={() => skipBySeconds(10)}
                    disabled={!canSkipForward}
                    className={`w-8 h-8 flex items-center justify-center rounded-full transition-colors ${!canSkipForward ? 'opacity-30 cursor-not-allowed text-on-surface-variant' : 'text-on-surface-variant hover:text-primary hover:bg-surface-container-high'}`}
                    title={!canSkipForward ? 'Cannot skip forward — no future footage' : 'Skip Forward 10s'}
                  >
                    <FastForward className="w-4 h-4 fill-current" />
                  </button>
                </div>
                <span className="font-label-caps text-label-caps text-on-surface">SYNCED TIMELINE_</span>
                <div className="flex items-center space-x-4 font-label-caps text-[10px] text-on-surface-variant">
                  <div className="flex items-center"><span className="w-2.5 h-1.5 bg-primary/80 mr-1.5 rounded-sm border border-primary/50"></span> REC_BLOCK</div>
                  <div className="flex items-center"><span className="w-1.5 h-1.5 bg-[#eab308] rounded-full mr-1.5 shadow-[0_0_4px_#eab308]"></span> EVT_MOTION</div>
                  <div className="flex items-center"><span className="w-1.5 h-1.5 bg-[#3b82f6] rounded-full mr-1.5 shadow-[0_0_4px_#3b82f6]"></span> EVT_PERSON</div>
                </div>
              </div>
            </div>

            <div className="flex-1 relative bg-surface-container-lowest overflow-x-auto no-scrollbar cursor-ew-resize border-b border-outline-variant">
              <div 
                className="absolute top-0 left-0 h-full w-[1800px] min-w-full cursor-pointer"
                onClick={handleTimelineClick}
              >
                <div className="absolute inset-0 flex justify-between w-full h-full border-t border-surface-container pointer-events-none opacity-40">
                  <div className="h-full border-l border-outline-variant relative"><span className="absolute top-1 left-1 text-[9px] font-data-tabular text-on-surface-variant">00:00</span></div>
                  <div className="h-full border-l border-outline-variant relative"><span className="absolute top-1 left-1 text-[9px] font-data-tabular text-on-surface-variant">04:00</span></div>
                  <div className="h-full border-l border-outline-variant relative"><span className="absolute top-1 left-1 text-[9px] font-data-tabular text-on-surface-variant">08:00</span></div>
                  <div className="h-full border-l border-outline-variant relative"><span className="absolute top-1 left-1 text-[9px] font-data-tabular text-on-surface-variant">12:00</span></div>
                  <div className="h-full border-l border-outline-variant relative"><span className="absolute top-1 left-1 text-[9px] font-data-tabular text-on-surface-variant">16:00</span></div>
                  <div className="h-full border-l border-outline-variant relative"><span className="absolute top-1 left-1 text-[9px] font-data-tabular text-on-surface-variant">20:00</span></div>
                  <div className="h-full"></div>
                </div>
                
                <div className="absolute top-1/2 left-0 right-0 h-px bg-surface-container-highest -translate-y-1/2"></div>
                
                {recordingRanges.length > 0 ? (
                  recordingRanges.map((range, idx) => {
                    const startOfDay = new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate()).getTime() / 1000;
                    const offset = range.from - startOfDay;
                    const leftPct = (offset / 86400) * 100;
                    const widthPct = Math.max(0.05, (range.duration / 86400) * 100);
                    return (
                       <div key={idx} className="absolute top-1/2 h-4 bg-primary/60 border-y border-primary/80 -translate-y-1/2 rounded-sm backdrop-blur-[2px] transition-all" style={{ left: `${leftPct}%`, width: `${widthPct}%` }}></div>
                    );
                  })
                ) : (
                  <>
                    <div className="absolute top-1/2 left-[5%] w-[12%] h-4 bg-primary/20 border-y border-primary/40 -translate-y-1/2 rounded-sm backdrop-blur-[2px]"></div>
                    <div className="absolute top-1/2 left-[25%] w-[35%] h-4 bg-primary/20 border-y border-primary/40 -translate-y-1/2 rounded-sm backdrop-blur-[2px]"></div>
                    <div className="absolute top-1/2 left-[70%] w-[18%] h-4 bg-primary/20 border-y border-primary/40 -translate-y-1/2 rounded-sm backdrop-blur-[2px]"></div>
                  </>
                )}

                <div className="absolute top-[35%] left-[28%] w-1.5 h-1.5 rounded-full bg-[#eab308] shadow-[0_0_4px_#eab308]"></div>
                <div className="absolute top-[35%] left-[45%] w-1.5 h-1.5 rounded-full bg-[#eab308] shadow-[0_0_4px_#eab308]"></div>
                <div className="absolute top-[35%] left-[80%] w-1.5 h-1.5 rounded-full bg-[#eab308] shadow-[0_0_4px_#eab308]"></div>
                <div className="absolute bottom-[35%] left-[32%] w-1.5 h-1.5 rounded-full bg-[#3b82f6] shadow-[0_0_4px_#3b82f6]"></div>
                <div className="absolute bottom-[35%] left-[55%] w-1.5 h-1.5 rounded-full bg-[#3b82f6] shadow-[0_0_4px_#3b82f6]"></div>
                <div className="absolute bottom-[35%] left-[75%] w-1.5 h-1.5 rounded-full bg-[#3b82f6] shadow-[0_0_4px_#3b82f6]"></div>
                
                <div 
                  className="absolute top-0 bottom-0 w-0.5 bg-[#ef4444] shadow-[0_0_10px_#ef4444] z-30 pointer-events-none transition-all duration-1000"
                  style={{ left: `${playheadPct}%` }}
                >
                  <div className="absolute top-0 left-1/2 -translate-x-1/2 border-[5px] border-transparent border-t-[#ef4444]"></div>
                  <div className="absolute -top-6 left-1/2 -translate-x-1/2 bg-[#ef4444] text-white font-data-tabular text-[10px] px-1.5 py-0.5 rounded shadow-lg whitespace-nowrap">
                    {playbackTime.toTimeString().split(' ')[0]}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
