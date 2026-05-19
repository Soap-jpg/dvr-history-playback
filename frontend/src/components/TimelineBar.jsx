// ---------------------------------------------------------------------------
// TimelineBar.jsx
//
// 24-hour interactive timeline showing clip availability + red scrubber.
//
// Layout (top → bottom):
//   ┌──────────────────────────────────────────────────────────────────┐
//   │ FWD  [██████]       [███]                  [██]                  │  ← forward row
//   │ IN   [██████]       [███]                  [██]                  │  ← inward  row
//   │ 00:00  02:00  04:00  ...  10:00  ...  18:00  20:00  22:00        │  ← hour ruler (clickable)
//   └──────────────────────────────────────────────────────────────────┘
//
// Click anywhere on the hour ruler → converts pixel x to seconds →
// calls onSeek(seconds, channel) which resolves to the nearest clip.
//
// Click directly on a clip block → calls onClipClick(clip) for exact seek.
//
// Props:
//   forwardClips    — ClipMeta[]
//   inwardClips     — ClipMeta[]
//   scrubberSecond  — number [0, 86400)
//   onSeek          — (seconds: number, channel: string) => void
//   onClipClick     — (clip: ClipMeta) => void
//   activeFilename  — string | null  (highlights the playing clip)
// ---------------------------------------------------------------------------

import { useRef, useCallback, useState } from 'react';

// ── Constants ─────────────────────────────────────────────────────────────────

const SECONDS_IN_DAY = 86_400;

// Hour labels: 00, 02, 04 … 22
const HOUR_MARKS = Array.from({ length: 13 }, (_, i) => i * 2);

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Convert absolute seconds → percentage string for `left` / `width` CSS. */
function sPct(seconds) {
  return `${((seconds / SECONDS_IN_DAY) * 100).toFixed(4)}%`;
}

/** Format seconds-from-midnight into HH:MM:SS. */
function formatSeconds(s) {
  const h  = Math.floor(s / 3600);
  const m  = Math.floor((s % 3600) / 60);
  const ss = Math.floor(s % 60);
  return [h, m, ss].map((v) => String(v).padStart(2, '0')).join(':');
}

// ── ClipRow ───────────────────────────────────────────────────────────────────

function ClipRow({ clips, label, accentColor, dimColor, activeFilename, onClipClick }) {
  return (
    <div className="flex items-center" style={{ height: '28px' }}>
      {/* Row label */}
      <div
        className="shrink-0 flex items-center justify-end pr-2 text-[9px] font-bold tracking-widest uppercase"
        style={{ width: '44px', color: accentColor, fontFamily: 'var(--font-mono)' }}
      >
        {label}
      </div>

      {/* Track */}
      <div
        className="relative flex-1 rounded-sm overflow-hidden"
        style={{
          height: '14px',
          background: 'rgba(255,255,255,0.04)',
          border:     '1px solid rgba(255,255,255,0.07)',
        }}
      >
        {clips.map((clip) => {
          const startPct  = sPct(clip.secondsFromMidnight);
          const durationS = Math.max(
            45,
            (clip.endTime.getTime() - clip.startTime.getTime()) / 1000,
          );
          const widthPct  = sPct(durationS);
          const isActive  = clip.filename === activeFilename;

          return (
            <div
              key={clip.filename}
              className="clip-block absolute top-0 h-full cursor-pointer"
              style={{
                left:        startPct,
                width:       widthPct,
                background:  isActive ? accentColor : dimColor,
                borderLeft:  `1px solid ${accentColor}`,
                borderRight: `1px solid ${accentColor}60`,
                boxShadow:   isActive ? `0 0 8px ${accentColor}90` : 'none',
              }}
              onClick={() => onClipClick(clip)}
              title={`${clip.channel.toUpperCase()} · ${clip.startTime.toLocaleTimeString('en-GB')}\n${clip.filename}`}
            />
          );
        })}
      </div>
    </div>
  );
}

// ── Scrubber ──────────────────────────────────────────────────────────────────

function Scrubber({ second }) {
  const label = formatSeconds(second);
  return (
    <div
      className="absolute top-0 bottom-0 z-20 pointer-events-none"
      style={{ left: sPct(second) }}
    >
      {/* Time tooltip */}
      <div
        className="absolute -top-6 left-1/2 -translate-x-1/2 px-1.5 py-0.5 rounded text-[9px] font-semibold whitespace-nowrap shadow-lg"
        style={{
          background: '#ef4444',
          color:      '#fff',
          fontFamily: 'var(--font-mono)',
        }}
      >
        {label}
      </div>

      {/* Top caret */}
      <div
        className="absolute top-0 left-1/2 -translate-x-1/2"
        style={{
          borderLeft:   '4px solid transparent',
          borderRight:  '4px solid transparent',
          borderTop:    '5px solid #ef4444',
        }}
      />

      {/* Vertical needle */}
      <div
        className="w-px h-full"
        style={{ background: '#ef4444', boxShadow: '0 0 6px #ef4444cc' }}
      />
    </div>
  );
}

// ── HoverGhost (shows time-label under cursor) ────────────────────────────────

function HoverGhost({ second }) {
  if (second === null) return null;
  return (
    <div
      className="absolute top-0 bottom-0 z-10 pointer-events-none"
      style={{ left: sPct(second) }}
    >
      <div
        className="w-px h-full opacity-40"
        style={{ background: '#94a3b8' }}
      />
    </div>
  );
}

// ── Main TimelineBar ──────────────────────────────────────────────────────────

const TimelineBar = ({
  forwardClips,
  inwardClips,
  scrubberSecond,
  onSeek,
  onClipClick,
  activeFilename,
}) => {
  const rulerRef   = useRef(null);
  const [hoverSecond, setHoverSecond] = useState(null);

  // ── Click handler: pixel x → seconds → onSeek ─────────────────────────────
  const handleRulerClick = useCallback(
    (e) => {
      if (!rulerRef.current) return;
      const rect = rulerRef.current.getBoundingClientRect();
      const pct  = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const seconds = pct * SECONDS_IN_DAY;
      // Prefer forward; fallback to inward
      const channel = forwardClips.length > 0 ? 'forward' : 'inward';
      onSeek(seconds, channel);
    },
    [forwardClips, onSeek],
  );

  const handleRulerMouseMove = useCallback(
    (e) => {
      if (!rulerRef.current) return;
      const rect = rulerRef.current.getBoundingClientRect();
      const pct  = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      setHoverSecond(pct * SECONDS_IN_DAY);
    },
    [],
  );

  const handleRulerMouseLeave = useCallback(() => setHoverSecond(null), []);

  return (
    <div
      className="flex flex-col h-full select-none"
      style={{ background: 'var(--color-surface)', userSelect: 'none' }}
    >
      {/* ── Clip rows ────────────────────────────────────────────────────── */}
      <div className="flex flex-col justify-center gap-2 px-3 py-2" style={{ flex: 1 }}>
        <ClipRow
          clips={forwardClips}
          label="FWD"
          accentColor="#3b82f6"
          dimColor="rgba(59,130,246,0.35)"
          activeFilename={activeFilename}
          onClipClick={onClipClick}
        />
        <ClipRow
          clips={inwardClips}
          label="IN"
          accentColor="#22c55e"
          dimColor="rgba(34,197,94,0.35)"
          activeFilename={activeFilename}
          onClipClick={onClipClick}
        />
      </div>

      {/* ── Hour ruler (clickable) ────────────────────────────────────────── */}
      <div
        ref={rulerRef}
        className="relative cursor-crosshair shrink-0"
        style={{
          height:     '36px',
          borderTop:  '1px solid rgba(255,255,255,0.07)',
          background: 'var(--color-surface-mid)',
        }}
        onClick={handleRulerClick}
        onMouseMove={handleRulerMouseMove}
        onMouseLeave={handleRulerMouseLeave}
      >
        {/* Scrubber needle */}
        <Scrubber second={scrubberSecond} />

        {/* Hover ghost */}
        <HoverGhost second={hoverSecond} />

        {/* Hour tick marks */}
        {HOUR_MARKS.map((hour) => (
          <div
            key={hour}
            className="absolute top-0 h-full flex flex-col items-start"
            style={{ left: sPct(hour * 3600), pointerEvents: 'none' }}
          >
            <div
              className="shrink-0"
              style={{
                width:      '1px',
                height:     '10px',
                background: 'rgba(255,255,255,0.18)',
              }}
            />
            <span
              style={{
                marginLeft:  '2px',
                marginTop:   '2px',
                fontSize:    '8px',
                color:       '#475569',
                fontFamily:  'var(--font-mono)',
                lineHeight:  1,
                whiteSpace:  'nowrap',
              }}
            >
              {String(hour).padStart(2, '0')}:00
            </span>
          </div>
        ))}

        {/* Hover time label */}
        {hoverSecond !== null && (
          <div
            className="absolute bottom-1 pointer-events-none"
            style={{
              left:       sPct(hoverSecond),
              transform:  'translateX(-50%)',
              fontSize:   '8px',
              color:      '#94a3b8',
              fontFamily: 'var(--font-mono)',
              background: 'rgba(12,17,23,0.8)',
              padding:    '0 3px',
              borderRadius: '2px',
            }}
          >
            {formatSeconds(Math.round(hoverSecond))}
          </div>
        )}
      </div>
    </div>
  );
};

export default TimelineBar;
