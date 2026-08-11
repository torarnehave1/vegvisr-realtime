import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Audio-only recorder for podcasts / voice notes.
 *
 * Records straight from the microphone in the browser rather than through
 * RealtimeKit, so it is unaffected by the server-side recording lifecycle (the
 * ALL_PEERS_LEFT auto-stop that cuts meeting recordings short). The resulting
 * file is handed to the caller as a `File` and uploaded through the SAME
 * multipart path as a video, so it lands in the owner's R2 next to everything
 * else and inherits listing, sharing, download and transcription for free.
 *
 * The live waveform is drawn from an AnalyserNode — it is a monitor, not the
 * recorded signal. Recording itself is plain MediaRecorder; the analyser only
 * taps the same stream so the user can see the mic is actually picking up.
 */

interface Props {
  onComplete: (file: File) => void;
  onCancel: () => void;
  /** Disables the save button while an upload is in flight. */
  busy?: boolean;
  uploadProgress?: number | null;
}

/**
 * Pick a container the browser can actually record. Chrome/Firefox produce
 * webm/opus; Safari only supports mp4/aac. Falling through to '' lets
 * MediaRecorder choose its own default rather than throwing.
 */
const pickMimeType = (): string => {
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/ogg;codecs=opus',
  ];
  for (const t of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported?.(t)) return t;
  }
  return '';
};

const extForMime = (mime: string): string => {
  if (mime.includes('webm')) return 'webm';
  if (mime.includes('mp4')) return 'm4a';
  if (mime.includes('ogg')) return 'ogg';
  return 'webm';
};

const fmtDuration = (totalSec: number) => {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = Math.floor(totalSec % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
};

export function AudioRecorder({ onComplete, onCancel, busy = false, uploadProgress = null }: Props) {
  const [state, setState] = useState<'idle' | 'recording' | 'paused' | 'done'>('idle');
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [title, setTitle] = useState('');

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const blobRef = useRef<Blob | null>(null);
  const mimeRef = useRef<string>('');

  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // Rolling history of recent amplitudes so the live view scrolls like a tape.
  const historyRef = useRef<number[]>([]);

  // ── Live waveform ──────────────────────────────────────────────────────────
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const analyser = analyserRef.current;
    if (!canvas || !analyser) return;
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

    const buf = new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(buf);
    // RMS of the frame → one bar. Cheap and stable versus peak sampling.
    let sum = 0;
    for (let i = 0; i < buf.length; i++) {
      const v = (buf[i] - 128) / 128;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / buf.length);

    const hist = historyRef.current;
    const barW = 3;
    const gap = 1;
    const maxBars = Math.floor(cssW / (barW + gap));
    hist.push(rms);
    if (hist.length > maxBars) hist.splice(0, hist.length - maxBars);

    const mid = cssH / 2;
    ctx.fillStyle = '#a78bfa';
    hist.forEach((v, i) => {
      // Boost is cosmetic — speech RMS rarely exceeds ~0.3, which would otherwise
      // render as an almost-flat line.
      const h = Math.max(2, Math.min(cssH, v * 3.2 * cssH));
      const x = i * (barW + gap);
      ctx.fillRect(x, mid - h / 2, barW, h);
    });

    // Centre line, so a silent mic still reads as "running" rather than broken.
    ctx.fillStyle = 'rgba(148,163,184,0.35)';
    ctx.fillRect(0, mid - 0.5, cssW, 1);

    rafRef.current = requestAnimationFrame(draw);
  }, []);

  const teardownStream = useCallback(() => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    analyserRef.current = null;
    audioCtxRef.current?.close().catch(() => { /* already closed */ });
    audioCtxRef.current = null;
  }, []);

  // Tick the elapsed timer only while actually recording (paused holds the value).
  useEffect(() => {
    if (state !== 'recording') return;
    const iv = setInterval(() => setSeconds(s => s + 1), 1000);
    return () => clearInterval(iv);
  }, [state]);

  // Stop the mic if the component goes away mid-recording.
  useEffect(() => () => {
    try { recorderRef.current?.state !== 'inactive' && recorderRef.current?.stop(); } catch { /* noop */ }
    teardownStream();
  }, [teardownStream]);

  const start = async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      streamRef.current = stream;

      const Ctor = window.AudioContext || (window as any).webkitAudioContext;
      const audioCtx = new Ctor();
      audioCtxRef.current = audioCtx;
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 1024;
      source.connect(analyser);
      analyserRef.current = analyser;
      historyRef.current = [];

      const mime = pickMimeType();
      mimeRef.current = mime;
      const recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      recorderRef.current = recorder;
      chunksRef.current = [];
      recorder.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      recorder.onstop = () => {
        const type = mimeRef.current || 'audio/webm';
        const blob = new Blob(chunksRef.current, { type });
        blobRef.current = blob;
        setPreviewUrl(URL.createObjectURL(blob));
        teardownStream();
        setState('done');
      };
      // Timeslice so chunks flush periodically — a crashed tab then still leaves
      // most of the audio recoverable in memory rather than one giant final blob.
      recorder.start(1000);
      setSeconds(0);
      setState('recording');
      rafRef.current = requestAnimationFrame(draw);
    } catch (err: any) {
      setError(err?.name === 'NotAllowedError'
        ? 'Microphone access was denied. Allow the mic for this site and try again.'
        : `Could not start recording: ${err?.message || String(err)}`);
    }
  };

  const togglePause = () => {
    const rec = recorderRef.current;
    if (!rec) return;
    if (rec.state === 'recording') {
      rec.pause();
      setState('paused');
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    } else if (rec.state === 'paused') {
      rec.resume();
      setState('recording');
      rafRef.current = requestAnimationFrame(draw);
    }
  };

  const stop = () => {
    const rec = recorderRef.current;
    if (rec && rec.state !== 'inactive') rec.stop();
  };

  const discard = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    blobRef.current = null;
    chunksRef.current = [];
    setPreviewUrl(null);
    setSeconds(0);
    setState('idle');
  };

  const save = () => {
    const blob = blobRef.current;
    if (!blob) return;
    const ext = extForMime(mimeRef.current || blob.type);
    const now = new Date();
    const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
    // sanitizeUploadName on the worker strips anything outside [\w.\- ], so keep
    // the generated part safe and let the user's title be normalized server-side.
    const base = title.trim() ? title.trim().replace(/[^\w.\- ]+/g, '').replace(/\s+/g, '-') : 'podcast';
    const file = new File([blob], `${base}-${stamp}.${ext}`, { type: blob.type || 'audio/webm' });
    onComplete(file);
  };

  return (
    <div className="rounded-lg border border-slate-700 bg-slate-900/80 p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-white text-sm font-semibold">Record audio</h3>
          <p className="text-slate-400 text-xs">
            Records locally in your browser, then uploads to your recordings library.
          </p>
        </div>
        <button
          className="px-2.5 py-1.5 bg-slate-700 hover:bg-slate-600 rounded text-white text-xs disabled:opacity-40"
          onClick={onCancel}
          disabled={busy || state === 'recording' || state === 'paused'}
          title={state === 'recording' || state === 'paused' ? 'Stop the recording first' : 'Close'}
        >
          ✕ Close
        </button>
      </div>

      {error && (
        <div className="mb-3 rounded border border-red-800 bg-red-950/50 px-3 py-2 text-xs text-red-300">
          {error}
        </div>
      )}

      {/* Live waveform — only meaningful while the mic is open. */}
      {(state === 'recording' || state === 'paused') && (
        <div className="mb-3">
          <canvas ref={canvasRef} className="w-full h-20 rounded bg-slate-950/60" />
          <div className="mt-2 flex items-center gap-2">
            <span className={`inline-block h-2 w-2 rounded-full ${state === 'recording' ? 'bg-red-500 animate-pulse' : 'bg-amber-400'}`} />
            <span className="text-white text-sm font-mono">{fmtDuration(seconds)}</span>
            <span className="text-slate-400 text-xs">{state === 'recording' ? 'Recording' : 'Paused'}</span>
          </div>
        </div>
      )}

      {state === 'done' && previewUrl && (
        <div className="mb-3">
          <audio src={previewUrl} controls className="w-full" />
          <div className="mt-2 flex items-center gap-3">
            <span className="text-slate-400 text-xs">Length {fmtDuration(seconds)}</span>
            {blobRef.current && (
              <span className="text-slate-400 text-xs">
                {(blobRef.current.size / (1024 * 1024)).toFixed(1)} MB
              </span>
            )}
          </div>
          <input
            type="text"
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="Name this recording (optional)"
            className="mt-3 w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-white text-sm placeholder-slate-500 focus:outline-none focus:border-sky-500"
          />
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {state === 'idle' && (
          <button
            className="px-3 py-2 bg-red-700 hover:bg-red-600 rounded text-white text-xs"
            onClick={start}
          >
            ● Start recording
          </button>
        )}
        {(state === 'recording' || state === 'paused') && (
          <>
            <button
              className="px-3 py-2 bg-amber-700 hover:bg-amber-600 rounded text-white text-xs"
              onClick={togglePause}
            >
              {state === 'recording' ? '⏸ Pause' : '▶ Resume'}
            </button>
            <button
              className="px-3 py-2 bg-slate-700 hover:bg-slate-600 rounded text-white text-xs"
              onClick={stop}
            >
              ⏹ Stop
            </button>
          </>
        )}
        {state === 'done' && (
          <>
            <button
              className="px-3 py-2 bg-emerald-700 hover:bg-emerald-600 rounded text-white text-xs disabled:opacity-40"
              onClick={save}
              disabled={busy}
            >
              {busy
                ? `Uploading${uploadProgress != null ? ` ${uploadProgress}%` : '…'}`
                : '⬆ Save to recordings'}
            </button>
            <button
              className="px-3 py-2 bg-slate-700 hover:bg-slate-600 rounded text-white text-xs disabled:opacity-40"
              onClick={discard}
              disabled={busy}
            >
              ↺ Discard & re-record
            </button>
          </>
        )}
      </div>
    </div>
  );
}
