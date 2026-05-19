// HistoryDashboard.jsx — 3-pane DVR layout
import { useState, useEffect, useCallback, useRef } from 'react';
import { usePlaybackManager } from '../hooks/usePlaybackManager';
import SeamlessPlayer from './SeamlessPlayer';
import TimelineBar from './TimelineBar';

const IconRefresh = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M1 4v6h6M23 20v-6h-6" /><path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4-4.64 4.36A9 9 0 0 1 3.51 15" />
  </svg>
);
const IconStop = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="1" /></svg>
);
const IconPlay = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
);
const IconCamera = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M23 7l-7 5 7 5V7z" /><rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
  </svg>
);

function useClock() {
  const [t, setT] = useState(() => new Date().toLocaleTimeString('en-GB'));
  useEffect(() => {
    const id = setInterval(() => setT(new Date().toLocaleTimeString('en-GB')), 1000);
    return () => clearInterval(id);
  }, []);
  return t;
}

function ClipItem({ clip, currentClipPair, nextClipPair, onClick }) {
  const isFwd = clip.channel === 'forward';
  const color = isFwd ? '#3b82f6' : '#22c55e';
  const isActive = currentClipPair && currentClipPair[clip.channel]?.filename === clip.filename;
  const isNext = nextClipPair && nextClipPair[clip.channel]?.filename === clip.filename;
  return (
    <button
      onClick={onClick}
      className="w-full text-left flex items-center gap-2 px-3 py-2 rounded transition-all duration-150"
      style={{
        background: isActive ? `${color}18` : isNext ? 'rgba(99,102,241,0.1)' : 'transparent',
        border: `1px solid ${isActive ? `${color}45` : isNext ? 'rgba(99,102,241,0.3)' : 'transparent'}`,
      }}
    >
      <span className="text-[9px] font-bold tracking-widest shrink-0 w-7"
            style={{ color, fontFamily: 'var(--font-mono)' }}>
        {isFwd ? 'FWD' : 'IN'}
      </span>
      <span className="text-[10px] text-slate-300 truncate flex-1"
            style={{ fontFamily: 'var(--font-mono)' }}
            title={clip.filename}>
        {clip.filename.replace('.ts', '')}
      </span>
      {isActive && <IconPlay />}
      {isNext && !isActive && (
        <span className="text-[9px] text-indigo-400 font-bold tracking-widest"
              style={{ fontFamily: 'var(--font-mono)' }}>NEXT</span>
      )}
    </button>
  );
}

function Skeleton({ rows = 8 }) {
  return (
    <div className="flex flex-col gap-2 p-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-8 rounded animate-pulse"
             style={{ background: 'rgba(255,255,255,0.06)', animationDelay: `${i * 80}ms` }} />
      ))}
    </div>
  );
}

const DEMO_VEHICLES = [
  { imei: '503079604270',    label: 'Device 1 · 503079604270' },
  { imei: '860503079604270', label: 'Device 2 · 860503079604270' },
  { imei: '864993060968006', label: 'Device 3 · 864993060968006' },
];

export default function HistoryDashboard() {
  const clock = useClock();
  const [imei, setImei] = useState(DEMO_VEHICLES[0].imei);
  const [selectedDate, setSelectedDate] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  });
  const [camFilter, setCamFilter] = useState('both');

  const {
    timelineData, forwardClips, inwardClips,
    inventoryLoading, inventoryError, refetch,
    playbackStatus, currentClipPair, nextClipPair,
    forwardStreamUrl, inwardStreamUrl,
    nextForwardUrl, nextInwardUrl,
    startOffsets,
    currentTimeOffset,
    seekToTime, seekToClip, onVideoEnded, onTimeUpdate, stop,
    seekEventRef,
  } = usePlaybackManager(imei);

  const showForward = camFilter !== 'inward';
  const showInward = camFilter !== 'forward';

  const handleClipClick = useCallback((clip) => seekToClip(clip), [seekToClip]);

  // Wire seekEventRef: when user clicks within the current clip, directly
  // seek both video elements without restarting playback
  const fwdVideoRef = useRef(null);
  const inwVideoRef = useRef(null);

  useEffect(() => {
    seekEventRef.current = (offsets) => {
      if (fwdVideoRef.current && offsets.forward !== undefined) {
        fwdVideoRef.current.currentTime = offsets.forward;
      }
      if (inwVideoRef.current && offsets.inward !== undefined) {
        inwVideoRef.current.currentTime = offsets.inward;
      }
    };
    return () => { seekEventRef.current = null; };
  }, [seekEventRef]);

  const today = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

  const statusColor = playbackStatus === 'playing'
    ? '#22c55e' : playbackStatus === 'loading_device'
    ? '#f59e0b' : '#64748b';

  const statusLabel = { idle: 'IDLE', loading_device: 'LOADING…', playing: 'PLAYING' }[playbackStatus];

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden"
         style={{ background: 'var(--color-bg)', color: '#e2e8f0', fontFamily: 'var(--font-ui)' }}>

      <header className="flex items-center justify-between px-5 shrink-0"
              style={{ height: '48px', background: 'var(--color-surface)', borderBottom: '1px solid var(--color-border-hi)', zIndex: 40 }}>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded flex items-center justify-center"
                 style={{ background: 'rgba(59,130,246,0.15)', border: '1px solid rgba(59,130,246,0.4)' }}>
              <IconCamera />
            </div>
            <span className="font-semibold text-sm tracking-tight">
              okDriver <span style={{ color: '#3b82f6' }}>History</span>
            </span>
          </div>

          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs"
               style={{ background: 'var(--color-surface-mid)', border: '1px solid var(--color-border)', color: '#94a3b8', fontFamily: 'var(--font-mono)' }}>
            <span className="text-slate-500 text-[9px] tracking-widest font-bold uppercase">IMEI</span>
            <span>{imei}</span>
          </div>

          <div className="px-2.5 py-1 rounded text-xs"
               style={{ background: 'var(--color-surface-mid)', border: '1px solid var(--color-border)', fontFamily: 'var(--font-mono)' }}>
            <span className="text-slate-500 text-[9px] tracking-widest font-bold uppercase mr-1.5">CLIPS</span>
            <span style={{ color: '#3b82f6' }}>{inventoryLoading ? '…' : timelineData.length}</span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded text-[10px] font-bold tracking-widest uppercase"
               style={{ background: `${statusColor}14`, border: `1px solid ${statusColor}40`, color: statusColor, fontFamily: 'var(--font-mono)' }}>
            <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: statusColor }} />
            {statusLabel}
          </div>

          {playbackStatus !== 'idle' && (
            <button onClick={stop}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs transition-colors"
                    style={{ border: '1px solid rgba(239,68,68,0.4)', color: '#f87171', background: 'rgba(239,68,68,0.08)' }}>
              <IconStop /> STOP
            </button>
          )}

          <button onClick={refetch}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs transition-colors"
                  style={{ border: '1px solid var(--color-border-hi)', color: '#94a3b8', background: 'transparent' }}>
            <IconRefresh />
            <span className="hidden sm:inline tracking-widest font-semibold uppercase">Refresh</span>
          </button>

          <div className="flex items-center gap-2 text-xs"
               style={{ color: '#64748b', fontFamily: 'var(--font-mono)' }}>
            <span className="w-1.5 h-1.5 rounded-full animate-glow" style={{ background: '#22c55e', color: '#22c55e' }} />
            <span>{today}</span>
            <span style={{ color: '#cbd5e1' }}>{clock}</span>
          </div>
        </div>
      </header>

      <div className="flex flex-1 min-h-0 overflow-hidden">

        <aside className="shrink-0 flex flex-col overflow-hidden"
               style={{ width: '240px', background: 'var(--color-surface)', borderRight: '1px solid var(--color-border)' }}>

          <div className="shrink-0 px-3 py-2"
               style={{ borderBottom: '1px solid var(--color-border)', background: 'var(--color-surface-mid)' }}>
            <span className="text-[9px] font-bold tracking-[0.2em] uppercase text-slate-500"
                  style={{ fontFamily: 'var(--font-mono)' }}>Controls</span>
          </div>

          <div className="shrink-0 flex flex-col gap-3 p-3"
               style={{ borderBottom: '1px solid var(--color-border)' }}>

            <div className="flex flex-col gap-1">
              <label className="text-[9px] font-bold tracking-widest uppercase text-slate-500"
                     style={{ fontFamily: 'var(--font-mono)' }}>Vehicle</label>
              <select
                value={imei}
                onChange={(e) => setImei(e.target.value)}
                className="w-full px-2 py-1.5 rounded text-xs"
                style={{
                  background:  'var(--color-surface-hi)',
                  border:      '1px solid var(--color-border-hi)',
                  color:       '#e2e8f0',
                  fontFamily:  'var(--font-mono)',
                  outline:     'none',
                }}
              >
                {DEMO_VEHICLES.map((v) => (
                  <option key={v.imei} value={v.imei}>{v.label}</option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-[9px] font-bold tracking-widest uppercase text-slate-500"
                     style={{ fontFamily: 'var(--font-mono)' }}>Date</label>
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="w-full px-2 py-1.5 rounded text-xs"
                style={{
                  background:  'var(--color-surface-hi)',
                  border:      '1px solid var(--color-border-hi)',
                  color:       '#e2e8f0',
                  fontFamily:  'var(--font-mono)',
                  outline:     'none',
                  colorScheme: 'dark',
                }}
              />
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-[9px] font-bold tracking-widest uppercase text-slate-500"
                     style={{ fontFamily: 'var(--font-mono)' }}>Camera</label>
              <div className="flex rounded overflow-hidden"
                   style={{ border: '1px solid var(--color-border-hi)' }}>
                {[['both','BOTH'],['forward','FWD'],['inward','IN']].map(([val, lbl]) => (
                  <button
                    key={val}
                    onClick={() => setCamFilter(val)}
                    className="flex-1 py-1.5 text-[10px] font-bold tracking-widest uppercase transition-colors"
                    style={{
                      background:  camFilter === val ? (val === 'forward' ? '#3b82f6' : val === 'inward' ? '#22c55e' : '#6366f1') : 'var(--color-surface-hi)',
                      color:       camFilter === val ? '#fff' : '#64748b',
                      fontFamily:  'var(--font-mono)',
                      border:      'none',
                      cursor:      'pointer',
                    }}
                  >
                    {lbl}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="shrink-0 px-3 py-2"
               style={{ borderBottom: '1px solid var(--color-border)', background: 'var(--color-surface-mid)' }}>
            <div className="flex items-center justify-between">
              <span className="text-[9px] font-bold tracking-[0.2em] uppercase text-slate-500"
                    style={{ fontFamily: 'var(--font-mono)' }}>Clip List</span>
              {inventoryLoading && (
                <div className="w-3 h-3 rounded-full border-2 border-t-blue-400 border-slate-700 spin" />
              )}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto min-h-0">
            {inventoryLoading ? <Skeleton /> : inventoryError ? (
              <p className="p-3 text-xs text-red-400">{inventoryError}</p>
            ) : timelineData.length === 0 ? (
              <p className="p-3 text-xs text-slate-600 text-center">No clips found</p>
            ) : (
              <div className="flex flex-col gap-0.5 p-2">
                {[...timelineData]
                  .sort((a, b) => a.startTime - b.startTime)
                  .filter((c) => camFilter === 'both' || c.channel === camFilter)
                  .map((clip) => (
                    <ClipItem
                      key={clip.filename}
                      clip={clip}
                      currentClipPair={currentClipPair}
                      nextClipPair={nextClipPair}
                      onClick={() => handleClipClick(clip)}
                    />
                  ))}
              </div>
            )}
          </div>

          <div className="shrink-0 p-3 space-y-1.5"
               style={{ borderTop: '1px solid var(--color-border)', background: 'var(--color-surface-mid)' }}>
            {[['NOW', currentClipPair, '#3b82f6'], ['NEXT', nextClipPair, '#6366f1']].map(([lbl, pair, col]) => (
              <div key={lbl} className="flex justify-between items-center">
                <span className="text-[9px] font-bold tracking-widest text-slate-600"
                      style={{ fontFamily: 'var(--font-mono)' }}>{lbl}</span>
                <span className="text-[9px] truncate max-w-[150px]"
                      style={{ color: col, fontFamily: 'var(--font-mono)' }}
                      title={pair?.forward?.filename || pair?.inward?.filename || ''}>
                  {pair?.forward ? pair.forward.filename.replace('.ts', '') : 
                   pair?.inward ? pair.inward.filename.replace('.ts', '') : '—'}
                </span>
              </div>
            ))}
          </div>
        </aside>

        <main className="flex flex-col flex-1 min-w-0 min-h-0">

          {inventoryError && (
            <div className="px-4 py-2 text-sm text-red-400 shrink-0"
                 style={{ background: 'rgba(239,68,68,0.1)', borderBottom: '1px solid rgba(239,68,68,0.25)' }}>
              ⚠ {inventoryError}
            </div>
          )}

          <div className={`flex-1 min-h-0 p-4 grid gap-4 ${showForward && showInward ? 'grid-cols-2' : 'grid-cols-1'}`}>
            {showForward && (
              <SeamlessPlayer
                streamUrl={forwardStreamUrl}
                nextStreamUrl={nextForwardUrl}
                status={playbackStatus}
                channel="forward"
                label="FORWARD CAM"
                clipStartTime={currentClipPair?.forward?.startTime ?? null}
                startOffset={startOffsets.forward}
                onEnded={onVideoEnded}
                onTimeUpdate={onTimeUpdate}
                videoRef={fwdVideoRef}
              />
            )}
            {showInward && (
              <SeamlessPlayer
                streamUrl={inwardStreamUrl}
                nextStreamUrl={nextInwardUrl}
                status={playbackStatus}
                channel="inward"
                label="INWARD CAM"
                clipStartTime={currentClipPair?.inward?.startTime ?? null}
                startOffset={startOffsets.inward}
                onEnded={onVideoEnded}
                onTimeUpdate={() => {}}
                videoRef={inwVideoRef}
              />
            )}
          </div>

          <div className="shrink-0" style={{ height: '120px', borderTop: '1px solid var(--color-border)' }}>
            <div className="flex items-center justify-between px-4 shrink-0"
                 style={{ height: '28px', background: 'var(--color-surface-mid)', borderBottom: '1px solid var(--color-border)' }}>
              <div className="flex items-center gap-4">
                <span className="text-[9px] font-bold tracking-[0.2em] uppercase text-slate-400"
                      style={{ fontFamily: 'var(--font-mono)' }}>Timeline · 24h</span>
                <div className="flex items-center gap-3">
                  {[['#3b82f6','FWD CLIPS'],['#22c55e','IN CLIPS'],['#ef4444','PLAYHEAD']].map(([col, lbl]) => (
                    <span key={lbl} className="flex items-center gap-1 text-[9px] text-slate-600"
                          style={{ fontFamily: 'var(--font-mono)' }}>
                      <span className="w-2 h-2 rounded-sm inline-block" style={{ background: col }} />
                      {lbl}
                    </span>
                  ))}
                </div>
              </div>
              {inventoryLoading && (
                <div className="flex items-center gap-1.5 text-[9px] text-slate-500"
                     style={{ fontFamily: 'var(--font-mono)' }}>
                  <div className="w-3 h-3 rounded-full border-2 border-t-blue-400 border-slate-700 spin" />
                  LOADING CLIPS…
                </div>
              )}
            </div>

            <div style={{ height: 'calc(100% - 28px)' }}>
              <TimelineBar
                forwardClips={forwardClips}
                inwardClips={inwardClips}
                scrubberSecond={currentTimeOffset}
                onSeek={seekToTime}
                onClipClick={seekToClip}
                activeFilename={currentClipPair?.forward?.filename ?? currentClipPair?.inward?.filename ?? null}
              />
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}