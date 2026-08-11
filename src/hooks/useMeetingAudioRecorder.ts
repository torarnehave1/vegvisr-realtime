import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * In-meeting audio recorder — captures EVERY participant, not just the local mic.
 *
 * Why this exists: RealtimeKit's own recording auto-stops at ~75 s with
 * stop_reason ALL_PEERS_LEFT even while people are still connected, which makes
 * it unusable for a podcast. This records in the browser instead, so the
 * server-side recording lifecycle cannot cut it short.
 *
 * How it captures guests: each participant (and self) exposes an
 * `audioTrack: MediaStreamTrack`. Every track is wrapped in its own
 * MediaStreamSource and connected into one MediaStreamDestination, which is the
 * mix bus. MediaRecorder records that bus, producing a single mixed file.
 *
 * Tracks are not stable for the life of a call — muting/unmuting and device
 * changes REPLACE a participant's track object — so sources are re-wired on
 * `audioUpdate` as well as join/leave. Wiring is keyed by peer id and always
 * disconnects the previous node first, otherwise a participant who mutes and
 * unmutes several times ends up mixed in multiple times and progressively
 * louder.
 */

export type MeetingRecState = 'idle' | 'recording' | 'paused' | 'done';

const pickMimeType = (): string => {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
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

export function useMeetingAudioRecorder(meeting: any) {
  const [state, setState] = useState<MeetingRecState>('idle');
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [voices, setVoices] = useState(0);
  const [result, setResult] = useState<{ file: File; url: string; size: number } | null>(null);

  const ctxRef = useRef<AudioContext | null>(null);
  const destRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const mimeRef = useRef('');
  // peerId -> the source node currently feeding the mix for that participant.
  const sourcesRef = useRef<Map<string, MediaStreamAudioSourceNode>>(new Map());
  const activeRef = useRef(false);

  const wire = useCallback((peerId: string, track: MediaStreamTrack | null | undefined) => {
    const ctx = ctxRef.current;
    const dest = destRef.current;
    if (!ctx || !dest || !peerId) return;

    const existing = sourcesRef.current.get(peerId);
    if (existing) {
      try { existing.disconnect(); } catch { /* already disconnected */ }
      sourcesRef.current.delete(peerId);
    }
    // A muted participant has no live track; they rejoin the mix on unmute.
    if (!track || track.readyState === 'ended') {
      setVoices(sourcesRef.current.size);
      return;
    }
    try {
      const src = ctx.createMediaStreamSource(new MediaStream([track]));
      src.connect(dest);
      sourcesRef.current.set(peerId, src);
    } catch (e) {
      console.warn('[audiorec] could not wire', peerId, e);
    }
    setVoices(sourcesRef.current.size);
  }, []);

  const unwire = useCallback((peerId: string) => {
    const existing = sourcesRef.current.get(peerId);
    if (existing) {
      try { existing.disconnect(); } catch { /* already disconnected */ }
      sourcesRef.current.delete(peerId);
      setVoices(sourcesRef.current.size);
    }
  }, []);

  useEffect(() => {
    if (state !== 'recording') return;
    const iv = setInterval(() => setSeconds(s => s + 1), 1000);
    return () => clearInterval(iv);
  }, [state]);

  const teardown = useCallback(() => {
    activeRef.current = false;
    sourcesRef.current.forEach(s => { try { s.disconnect(); } catch { /* noop */ } });
    sourcesRef.current.clear();
    setVoices(0);
    destRef.current = null;
    ctxRef.current?.close().catch(() => { /* already closed */ });
    ctxRef.current = null;
  }, []);

  // Keep the mix in sync with who is in the room while recording.
  useEffect(() => {
    if (!meeting || state === 'idle' || state === 'done') return;
    const joined = meeting.participants?.joined;
    const self = meeting.self;

    const onJoin = (p: any) => wire(p?.id || p?.peerId, p?.audioTrack);
    const onLeave = (p: any) => unwire(p?.id || p?.peerId);
    const onAudio = (p: any) => {
      const t = p?.participant || p;
      wire(t?.id || t?.peerId, t?.audioTrack);
    };
    const onSelfAudio = () => wire(self?.id || 'self', self?.audioTrack);

    joined?.on?.('participantJoined', onJoin);
    joined?.on?.('participantLeft', onLeave);
    joined?.on?.('audioUpdate', onAudio);
    self?.on?.('audioUpdate', onSelfAudio);
    return () => {
      joined?.removeListener?.('participantJoined', onJoin);
      joined?.removeListener?.('participantLeft', onLeave);
      joined?.removeListener?.('audioUpdate', onAudio);
      self?.removeListener?.('audioUpdate', onSelfAudio);
    };
  }, [meeting, state, wire, unwire]);

  useEffect(() => () => {
    try { if (recorderRef.current?.state !== 'inactive') recorderRef.current?.stop(); } catch { /* noop */ }
    teardown();
  }, [teardown]);

  // The take lives in memory until it is uploaded, so closing or reloading the
  // tab destroys it. Warn while recording, and while a finished-but-unsaved
  // recording is still pending — losing a 40-minute podcast to a stray Cmd-W is
  // not a recoverable mistake.
  useEffect(() => {
    const unsaved = state === 'recording' || state === 'paused' || (state === 'done' && !!result);
    if (!unsaved) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [state, result]);

  const start = useCallback(async () => {
    setError(null);
    if (!meeting) { setError('Meeting not ready'); return; }
    try {
      const Ctor = window.AudioContext || (window as any).webkitAudioContext;
      const ctx = new Ctor();
      // Chrome starts contexts suspended without a recent gesture; the click
      // that called start() counts, but resume() explicitly is still required.
      if (ctx.state === 'suspended') await ctx.resume();
      ctxRef.current = ctx;
      const dest = ctx.createMediaStreamDestination();
      destRef.current = dest;
      sourcesRef.current = new Map();
      activeRef.current = true;

      // Seed the mix with everyone already in the room.
      const self = meeting.self;
      if (self) wire(self.id || 'self', self.audioTrack);
      const joinedList = meeting.participants?.joined?.toArray?.() ?? [];
      joinedList.forEach((p: any) => wire(p?.id || p?.peerId, p?.audioTrack));

      if (sourcesRef.current.size === 0) {
        teardown();
        setError('No live microphones to record — unmute yourself or a guest first.');
        return;
      }

      const mime = pickMimeType();
      mimeRef.current = mime;
      const recorder = mime
        ? new MediaRecorder(dest.stream, { mimeType: mime })
        : new MediaRecorder(dest.stream);
      recorderRef.current = recorder;
      chunksRef.current = [];
      recorder.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      recorder.onstop = () => {
        const type = mimeRef.current || 'audio/webm';
        const blob = new Blob(chunksRef.current, { type });
        const now = new Date();
        const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
        const file = new File([blob], `podcast-${stamp}.${extForMime(type)}`, { type });
        setResult({ file, url: URL.createObjectURL(blob), size: blob.size });
        teardown();
        setState('done');
      };
      recorder.start(1000);
      setSeconds(0);
      setResult(null);
      setState('recording');
    } catch (err: any) {
      teardown();
      setError(`Could not start recording: ${err?.message || String(err)}`);
    }
  }, [meeting, wire, teardown]);

  const togglePause = useCallback(() => {
    const rec = recorderRef.current;
    if (!rec) return;
    if (rec.state === 'recording') { rec.pause(); setState('paused'); }
    else if (rec.state === 'paused') { rec.resume(); setState('recording'); }
  }, []);

  const stop = useCallback(() => {
    const rec = recorderRef.current;
    if (rec && rec.state !== 'inactive') rec.stop();
  }, []);

  const reset = useCallback(() => {
    if (result?.url) URL.revokeObjectURL(result.url);
    setResult(null);
    setSeconds(0);
    setState('idle');
    setError(null);
  }, [result]);

  /**
   * Save the take to the user's own disk. Uploading is the normal path, but the
   * recording lives only in browser memory until that completes — and leaving
   * the meeting unmounts this hook. A local copy is the difference between "the
   * upload failed, try again" and "the podcast is gone".
   */
  const downloadLocal = useCallback(() => {
    if (!result) return;
    const a = document.createElement('a');
    a.href = result.url;
    a.download = result.file.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }, [result]);

  return { state, seconds, error, voices, result, start, stop, togglePause, reset, downloadLocal, setError };
}
