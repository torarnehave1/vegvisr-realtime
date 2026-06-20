import { useEffect, useRef } from 'react';
import { readStoredUser } from '../lib/auth';

/**
 * Host-browser participant telemetry capture (decision 1A).
 *
 * When the viewer is the host, this buffers participant engagement events
 * (join / leave / mute-unmute / video on-off / active-speaker) and flushes a
 * batch to `POST /realtime/telemetry` every ~10 s, plus a final keepalive flush
 * when the tab unloads or the component unmounts. Non-hosts, or a missing
 * meeting / meetingId, are a no-op.
 *
 * Server-side the batch lands in the MEETING OWNER's KV; owners without KV creds
 * are a silent no-op. The `sessionId` is minted per mount here — the 5-minute
 * merge-on-rejoin rule (segmenting) arrives in Slice 3.
 */

type TelemetryType = 'join' | 'leave' | 'audio' | 'video' | 'speaking';

interface TelemetryEvent {
  ts: number;
  pid: string;
  name: string;
  type: TelemetryType;
  value?: boolean;
}

const FLUSH_MS = 10_000;
const MERGE_MS = 5 * 60_000; // host blip < 5 min → merge into the same session
const ENDPOINT = 'https://api.vegvisr.org/realtime/telemetry';
const ROLLUP_ENDPOINT = 'https://api.vegvisr.org/realtime/telemetry/rollup';

// RTK payloads vary in shape across event types; pull id + name defensively.
const pInfo = (p: any) => ({
  id: p?.id || p?.peerId || p?.userId || '',
  name: p?.name || p?.displayName || '(unnamed)',
});

export function useTelemetryCapture(meeting: any, meetingId: string, isHost: boolean) {
  const bufferRef = useRef<TelemetryEvent[]>([]);
  const sessionIdRef = useRef<string>('');
  const speakingRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isHost || !meeting || !meetingId) return;

    const self = meeting.self;
    const parts = meeting.participants;
    const joined = parts?.joined;

    // Session segmenting (decision A): reuse the stored sessionId if the host was
    // last active < 5 min ago (a blip → merge); otherwise mint a new session.
    const sKey = `vegvisr-tel-session:${meetingId}`;
    let sid = '';
    try {
      const raw = localStorage.getItem(sKey);
      if (raw) {
        const o = JSON.parse(raw);
        if (o?.sessionId && o?.lastActivity && Date.now() - o.lastActivity < MERGE_MS) sid = o.sessionId;
      }
    } catch { /* ignore */ }
    if (!sid) sid = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    sessionIdRef.current = sid;
    const touch = () => {
      try { localStorage.setItem(sKey, JSON.stringify({ sessionId: sid, lastActivity: Date.now() })); } catch { /* ignore */ }
    };
    touch();

    const push = (type: TelemetryType, p: any, value?: boolean) => {
      const { id, name } = pInfo(p);
      if (!id) return;
      bufferRef.current.push({ ts: Date.now(), pid: id, name, type, value });
    };

    const flush = (keepalive = false) => {
      touch();
      const events = bufferRef.current;
      if (events.length === 0) return;
      bufferRef.current = [];
      const stored = readStoredUser();
      if (!stored?.emailVerificationToken) return;
      fetch(ENDPOINT, {
        method: 'POST',
        keepalive,
        headers: { 'Content-Type': 'application/json', 'X-API-Token': stored.emailVerificationToken },
        body: JSON.stringify({ meetingId, sessionId: sid, events }),
      }).catch((e) => {
        // Best-effort retry: prepend the failed batch ahead of newer events.
        bufferRef.current = events.concat(bufferRef.current);
        console.warn('[telemetry] flush failed:', e);
      });
    };

    // On host close: send the final buffer AND trigger the summary rollup in one
    // call, so the last events are included before the summary is computed.
    const rollup = (keepalive = false) => {
      touch();
      const events = bufferRef.current;
      bufferRef.current = [];
      const stored = readStoredUser();
      if (!stored?.emailVerificationToken) return;
      fetch(ROLLUP_ENDPOINT, {
        method: 'POST',
        keepalive,
        headers: { 'Content-Type': 'application/json', 'X-API-Token': stored.emailVerificationToken },
        body: JSON.stringify({ meetingId, sessionId: sid, events, endedAt: Date.now() }),
      }).catch((e) => { console.warn('[telemetry] rollup failed:', e); });
    };

    // Initial snapshot — everyone already present when the host started capturing,
    // plus the host's own current audio/video state.
    try {
      (joined?.toArray?.() ?? []).forEach((p: any) => push('join', p));
      if (self) {
        push('join', self);
        push('audio', self, !!self.audioEnabled);
        push('video', self, !!self.videoEnabled);
      }
    } catch (e) {
      console.warn('[telemetry] snapshot failed:', e);
    }

    const onJoin = (p: any) => push('join', p);
    const onLeave = (p: any) => push('leave', p);
    const onAudio = (p: any) => { const t = p?.participant || p; push('audio', t, !!t?.audioEnabled); };
    const onVideo = (p: any) => { const t = p?.participant || p; push('video', t, !!t?.videoEnabled); };
    const onSelfAudio = () => push('audio', self, !!self?.audioEnabled);
    const onSelfVideo = () => push('video', self, !!self?.videoEnabled);
    const onActiveSpeaker = (payload: any) => {
      const next = payload?.peerId || null;
      const prev = speakingRef.current;
      if (next === prev) return;
      if (prev) push('speaking', joined?.get?.(prev) || { id: prev }, false);
      if (next) push('speaking', joined?.get?.(next) || { id: next }, true);
      speakingRef.current = next;
    };

    joined?.on?.('participantJoined', onJoin);
    joined?.on?.('participantLeft', onLeave);
    joined?.on?.('audioUpdate', onAudio);
    joined?.on?.('videoUpdate', onVideo);
    self?.on?.('audioUpdate', onSelfAudio);
    self?.on?.('videoUpdate', onSelfVideo);
    parts?.on?.('activeSpeaker', onActiveSpeaker);

    const iv = setInterval(() => flush(false), FLUSH_MS);
    const onPageHide = () => rollup(true);
    window.addEventListener('pagehide', onPageHide);

    return () => {
      clearInterval(iv);
      window.removeEventListener('pagehide', onPageHide);
      joined?.removeListener?.('participantJoined', onJoin);
      joined?.removeListener?.('participantLeft', onLeave);
      joined?.removeListener?.('audioUpdate', onAudio);
      joined?.removeListener?.('videoUpdate', onVideo);
      self?.removeListener?.('audioUpdate', onSelfAudio);
      self?.removeListener?.('videoUpdate', onSelfVideo);
      parts?.off?.('activeSpeaker', onActiveSpeaker);
      rollup(true); // final flush + summary rollup on unmount
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meeting, meetingId, isHost]);
}
