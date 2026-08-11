import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Waveform playback for audio recordings in the recordings library.
 *
 * Draws a static peak envelope decoded from the file, with a played/unplayed
 * split and click-to-seek. The <audio> element remains the actual transport —
 * the canvas is a control surface over it, so seeking, buffering and codec
 * support stay the browser's job.
 *
 * Decoding needs the whole file in memory, which is fine for a talk-length
 * recording but not for a multi-GB video. Anything over DECODE_LIMIT_BYTES, or
 * any decode failure, degrades to the plain audio element rather than blocking
 * playback.
 */

const DECODE_LIMIT_BYTES = 150 * 1024 * 1024;
const BAR_W = 3;
const BAR_GAP = 1;

interface Props {
  /** Playback transport. A media element, so it is not subject to CORS. */
  src: string;
  /**
   * URL to read bytes from for peak extraction. Must be CORS-readable, which
   * `src` often is not: the R2 custom domain serves recordings without an
   * Access-Control-Allow-Origin header, so fetching it cross-origin throws and
   * the waveform would silently never appear. Callers should pass the worker's
   * /recordings/download URL here, which does send CORS headers.
   * Falls back to `src` when omitted.
   */
  decodeSrc?: string;
  /** Rendered when the file can't be decoded into peaks. */
  fallbackLabel?: string;
}

const fmt = (sec: number) => {
  if (!Number.isFinite(sec)) return '0:00';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
};

export function WaveformPlayer({ src, decodeSrc, fallbackLabel }: Props) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const peaksRef = useRef<number[] | null>(null);

  const [status, setStatus] = useState<'loading' | 'ready' | 'fallback'>('loading');
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);

  // ── Draw ───────────────────────────────────────────────────────────────────
  const paint = useCallback(() => {
    const canvas = canvasRef.current;
    const peaks = peaksRef.current;
    if (!canvas || !peaks) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.clientWidth;
    const cssH = canvas.clientHeight;
    if (canvas.width !== cssW * dpr || canvas.height !== cssH * dpr) {
      canvas.width = cssW * dpr;
      canvas.height = cssH * dpr;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    const mid = cssH / 2;
    const progress = duration > 0 ? current / duration : 0;
    const playedX = progress * cssW;

    peaks.forEach((v, i) => {
      const x = i * (BAR_W + BAR_GAP);
      if (x > cssW) return;
      const h = Math.max(2, v * cssH * 0.9);
      ctx.fillStyle = x + BAR_W <= playedX ? '#a78bfa' : 'rgba(148,163,184,0.45)';
      ctx.fillRect(x, mid - h / 2, BAR_W, h);
    });
  }, [current, duration]);

  useEffect(() => { paint(); }, [paint]);

  // Repaint on resize so the envelope keeps filling the card width.
  useEffect(() => {
    const onResize = () => paint();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [paint]);

  // ── Decode peaks once per src ──────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    let audioCtx: AudioContext | null = null;

    (async () => {
      setStatus('loading');
      peaksRef.current = null;
      try {
        const resp = await fetch(decodeSrc || src);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const len = Number(resp.headers.get('content-length') || '0');
        if (len > DECODE_LIMIT_BYTES) throw new Error('too large to decode');

        const buf = await resp.arrayBuffer();
        if (cancelled) return;
        const Ctor = window.AudioContext || (window as any).webkitAudioContext;
        audioCtx = new Ctor();
        const decoded = await audioCtx.decodeAudioData(buf);
        if (cancelled) return;

        const canvas = canvasRef.current;
        const width = canvas?.clientWidth || 600;
        const barCount = Math.max(1, Math.floor(width / (BAR_W + BAR_GAP)));
        const data = decoded.getChannelData(0);
        const block = Math.floor(data.length / barCount) || 1;

        const peaks: number[] = [];
        let max = 0;
        for (let i = 0; i < barCount; i++) {
          const start = i * block;
          let sum = 0;
          for (let j = 0; j < block; j++) {
            const s = data[start + j] || 0;
            sum += s * s;
          }
          const rms = Math.sqrt(sum / block);
          peaks.push(rms);
          if (rms > max) max = rms;
        }
        // Normalize so a quietly-recorded podcast still fills the card.
        peaksRef.current = max > 0 ? peaks.map(p => p / max) : peaks;
        setDuration(decoded.duration);
        setStatus('ready');
        paint();
      } catch {
        if (!cancelled) setStatus('fallback');
      } finally {
        audioCtx?.close().catch(() => { /* already closed */ });
      }
    })();

    return () => { cancelled = true; };
    // paint is intentionally omitted — including it would re-decode on every frame.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, decodeSrc]);

  const toggle = () => {
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) el.play().catch(() => { /* autoplay/codec refusal surfaces in the element */ });
    else el.pause();
  };

  const seek = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const el = audioRef.current;
    const canvas = canvasRef.current;
    if (!el || !canvas || !duration) return;
    const rect = canvas.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    el.currentTime = ratio * duration;
    setCurrent(el.currentTime);
  };

  return (
    <div className="w-full px-4 py-3">
      {status === 'ready' ? (
        <>
          <div className="flex items-center gap-3">
            <button
              onClick={toggle}
              className="flex-shrink-0 w-10 h-10 rounded-full bg-purple-600 hover:bg-purple-500 text-white flex items-center justify-center transition-colors"
              title={playing ? 'Pause' : 'Play'}
            >
              <span className={playing ? '' : 'ml-0.5'}>{playing ? '⏸' : '▶'}</span>
            </button>
            <canvas
              ref={canvasRef}
              onClick={seek}
              className="flex-1 h-16 cursor-pointer"
              title="Click to seek"
            />
          </div>
          <div className="mt-1.5 flex justify-between text-[11px] text-slate-400 font-mono">
            <span>{fmt(current)}</span>
            <span>{fmt(duration)}</span>
          </div>
        </>
      ) : status === 'loading' ? (
        <div className="h-16 flex items-center justify-center text-slate-400 text-xs">
          Loading waveform…
        </div>
      ) : (
        <div className="text-slate-400 text-xs mb-2">
          {fallbackLabel || 'Waveform unavailable — playing with the standard player.'}
        </div>
      )}

      {/* Always mounted: it is the transport for the canvas UI, and the whole
          player when decoding was skipped or failed. */}
      <audio
        ref={audioRef}
        src={src}
        controls={status !== 'ready'}
        className={status === 'ready' ? 'hidden' : 'w-full'}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={e => setCurrent((e.target as HTMLAudioElement).currentTime)}
        onLoadedMetadata={e => {
          const d = (e.target as HTMLAudioElement).duration;
          if (Number.isFinite(d) && d > 0) setDuration(prev => prev || d);
        }}
      />
    </div>
  );
}
