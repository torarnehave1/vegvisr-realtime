import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import {
  useRealtimeKitMeeting,
  useRealtimeKitSelector,
} from '@cloudflare/realtimekit-react';
import { readStoredUser } from '../lib/auth';

export type ViewMode = 'grid' | 'speaker' | 'duo';

const VIEW_MODE_KEY = 'vegvisr-view-mode';

const readStoredViewMode = (allowDuo: boolean): ViewMode => {
  try {
    const stored =
      typeof window !== 'undefined' ? localStorage.getItem(VIEW_MODE_KEY) : null;
    if (stored === 'duo') return allowDuo ? 'duo' : 'speaker';
    if (stored === 'speaker') return 'speaker';
    return 'grid';
  } catch {
    return 'grid';
  }
};

const fmtTime = (totalSec: number) => {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
};

interface Options {
  meetingId: string;
  isHost: boolean;
  /** Allow the mobile-only 'duo' view mode. Desktop normalizes 'duo' -> 'speaker'. */
  allowDuo?: boolean;
}

/**
 * Shared, layout-independent meeting state + handlers. Consumed by both the
 * desktop `Meeting` component and the mobile `MobileMeeting` layout so the
 * recording lifecycle, waiting-room polling, active-speaker tracking, view-mode
 * persistence, timers, and join guard live in exactly one place (Lesson 23).
 *
 * Must be called inside a RealtimeKitProvider / RtkUiProvider tree.
 */
export function useMeetingSession({ meetingId, isHost, allowDuo = false }: Options) {
  const { meeting } = useRealtimeKitMeeting();
  const roomJoined = useRealtimeKitSelector((m) => m.self.roomJoined);
  const roomState = useRealtimeKitSelector((m) => m.self.roomState);
  const selfName = useRealtimeKitSelector((m) => m.self.name);
  const canRecord = useRealtimeKitSelector((m) => m.self.permissions.canRecord);

  // ── Join guard: call meeting.join() at most once when room is initialised ──
  const joinCalledRef = useRef(false);
  useEffect(() => {
    if (!meeting) return;
    if (!roomJoined && roomState === 'init' && !joinCalledRef.current) {
      joinCalledRef.current = true;
      (meeting as any).join().catch((e: any) => console.error('auto-join error:', e));
    }
  }, [meeting, roomJoined, roomState]);

  // ── View mode (grid | speaker | duo), persisted across meetings ────────────
  const [viewMode, setViewModeRaw] = useState<ViewMode>(() =>
    readStoredViewMode(allowDuo),
  );
  const setViewMode = useCallback(
    (next: ViewMode) => {
      const normalized = next === 'duo' && !allowDuo ? 'speaker' : next;
      setViewModeRaw(normalized);
    },
    [allowDuo],
  );
  useEffect(() => {
    try {
      localStorage.setItem(VIEW_MODE_KEY, viewMode);
    } catch {
      /* ignore */
    }
  }, [viewMode]);

  // ── Active speaker (peerId of the loudest participant) ─────────────────────
  const [activeSpeakerId, setActiveSpeakerId] = useState<string | null>(null);
  useEffect(() => {
    if (!meeting?.participants) return;
    const handler = (payload: { peerId: string; volume: number }) => {
      if (payload?.peerId) setActiveSpeakerId(payload.peerId);
    };
    meeting.participants.on('activeSpeaker', handler);
    return () => {
      meeting.participants.off?.('activeSpeaker', handler);
    };
  }, [meeting]);

  // ── Meeting elapsed timer ──────────────────────────────────────────────────
  const [meetingSeconds, setMeetingSeconds] = useState(0);
  useEffect(() => {
    if (!roomJoined) return;
    setMeetingSeconds(0);
    const iv = setInterval(() => setMeetingSeconds((s) => s + 1), 1000);
    return () => clearInterval(iv);
  }, [roomJoined]);

  // ── Recording ──────────────────────────────────────────────────────────────
  const [recordingState, setRecordingState] = useState<string>('IDLE');
  const [recordingBusy, setRecordingBusy] = useState(false);
  const [showRecordingBanner, setShowRecordingBanner] = useState(false);
  const [recSeconds, setRecSeconds] = useState(0);

  useEffect(() => {
    if (!meeting?.recording) return;
    const rec = meeting.recording;
    setRecordingState(rec.recordingState);
    const handler = (state: string) => setRecordingState(state);
    rec.on('recordingUpdate', handler);
    return () => {
      rec.removeListener('recordingUpdate', handler);
    };
  }, [meeting]);

  const isRecording = recordingState === 'RECORDING';
  const isPaused = recordingState === 'PAUSED';
  const isStarting = recordingState === 'STARTING';
  const isStopping = recordingState === 'STOPPING';

  useEffect(() => {
    if (isRecording) {
      const iv = setInterval(() => setRecSeconds((s) => s + 1), 1000);
      return () => clearInterval(iv);
    }
    if (isPaused) return; // hold value, don't tick
    setRecSeconds(0); // reset on stop/idle
  }, [isRecording, isPaused]);

  useEffect(() => {
    if (isRecording || isStarting) {
      setShowRecordingBanner(true);
      const timer = setTimeout(() => setShowRecordingBanner(false), 3000);
      return () => clearTimeout(timer);
    }
    setShowRecordingBanner(false);
  }, [isRecording, isStarting]);

  const toggleRecording = useCallback(async () => {
    if (!meeting?.recording) return;
    setRecordingBusy(true);
    try {
      if (isRecording || isPaused) {
        await meeting.recording.stop();
      } else {
        await meeting.recording.start();
      }
    } catch (err: any) {
      console.error('Recording error:', err);
    } finally {
      setRecordingBusy(false);
    }
  }, [meeting, isRecording, isPaused]);

  const togglePauseRecording = useCallback(async () => {
    if (!meeting?.recording) return;
    setRecordingBusy(true);
    try {
      if (isPaused) {
        await meeting.recording.resume();
      } else {
        await meeting.recording.pause();
      }
    } catch (err: any) {
      console.error('Recording pause/resume error:', err);
    } finally {
      setRecordingBusy(false);
    }
  }, [meeting, isPaused]);

  // ── Waiting room (host only) ───────────────────────────────────────────────
  const [waitingGuests, setWaitingGuests] = useState<any[]>([]);
  // Refs survive re-renders. seenGuests holds the email set we'd already
  // notified for; pingCtx is a lazy AudioContext we only create after the
  // first user gesture (browsers block AudioContext autoplay otherwise).
  const seenGuests = useRef<Set<string>>(new Set());
  const pingCtxRef = useRef<AudioContext | null>(null);

  /**
   * Play a short two-tone "pling" via Web Audio. Self-contained — no asset
   * file to host or load. Calls into AudioContext lazily on first use; the
   * meeting page has had user gesture by then (host clicked "Join"), so
   * autoplay restrictions don't apply.
   */
  const playPling = useCallback(() => {
    try {
      if (!pingCtxRef.current) {
        const Ctor = window.AudioContext || (window as any).webkitAudioContext;
        if (!Ctor) return;
        pingCtxRef.current = new Ctor();
      }
      const ctx = pingCtxRef.current;
      // Chrome ships AudioContexts in `suspended` state if the host's user
      // gesture happened more than a moment ago — must explicitly resume
      // before scheduling oscillator notes or they're silently dropped.
      const schedule = () => {
        const now = ctx.currentTime;
        // Two short sine notes: A5 → E6 (gentle, recognizable)
        const note = (freq: number, start: number, dur: number, vol: number) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sine';
          osc.frequency.value = freq;
          gain.gain.setValueAtTime(0, now + start);
          gain.gain.linearRampToValueAtTime(vol, now + start + 0.01);
          gain.gain.linearRampToValueAtTime(0, now + start + dur);
          osc.connect(gain).connect(ctx.destination);
          osc.start(now + start);
          osc.stop(now + start + dur + 0.05);
        };
        note(880, 0, 0.18, 0.2);   // A5
        note(1318, 0.18, 0.25, 0.2); // E6
      };
      if (ctx.state === 'suspended') {
        ctx.resume().then(schedule).catch((e) => console.warn('[pling] resume failed:', e));
      } else {
        schedule();
      }
      console.log('[pling] scheduled, ctx.state=', ctx.state);
    } catch (e) {
      console.warn('[pling] error:', e);
      /* audio failure should never break the meeting */
    }
  }, []);

  useEffect(() => {
    if (!isHost || !meetingId) return;
    const poll = async () => {
      const stored = readStoredUser();
      if (!stored?.emailVerificationToken) return;
      try {
        const r = await fetch(
          `https://api.vegvisr.org/realtime/waiting-room/list?meetingId=${encodeURIComponent(meetingId)}`,
          { headers: { 'X-API-Token': stored.emailVerificationToken } },
        );
        const data = await r.json();
        if (data.success) {
          const guests = data.guests || [];
          // Every distinct knock pings exactly once. A knock that's been
          // sitting in the queue when the host's page first loads still pings
          // — the host has to hear it to admit the guest, that's the entire
          // point of the notification. Pings stop only for emails the host
          // already saw and that are still waiting. Once an email leaves the
          // list (admitted or denied), it's dropped from seenGuests so a
          // re-knock from the same email pings again.
          let newArrivals = 0;
          for (const g of guests) {
            const key = g.guest_email;
            if (!key) continue;
            if (!seenGuests.current.has(key)) {
              seenGuests.current.add(key);
              newArrivals++;
            }
          }
          // Drop emails no longer in waiting list so re-knocks ping again.
          const stillWaiting = new Set(guests.map((g: any) => g.guest_email));
          for (const seen of seenGuests.current) {
            if (!stillWaiting.has(seen)) seenGuests.current.delete(seen);
          }
          if (newArrivals > 0) {
            console.log('[pling] new arrivals:', newArrivals, 'guests:', guests.map((g: any) => g.guest_email));
            playPling();
          }
          setWaitingGuests(guests);
        }
      } catch {
        /* ignore */
      }
    };
    poll(); // immediate first call
    const iv = setInterval(poll, 4000);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHost, meetingId, playPling]);

  const admitGuest = useCallback(
    async (guestEmail: string) => {
      const stored = readStoredUser();
      if (!stored?.emailVerificationToken) return;
      await fetch('https://api.vegvisr.org/realtime/waiting-room/admit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Token': stored.emailVerificationToken,
        },
        body: JSON.stringify({ meetingId, guestEmail }),
      });
      setWaitingGuests((prev) => prev.filter((g) => g.guest_email !== guestEmail));
    },
    [meetingId],
  );

  const denyGuest = useCallback(
    async (guestEmail: string) => {
      const stored = readStoredUser();
      if (!stored?.emailVerificationToken) return;
      await fetch('https://api.vegvisr.org/realtime/waiting-room/deny', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Token': stored.emailVerificationToken,
        },
        body: JSON.stringify({ meetingId, guestEmail }),
      });
      setWaitingGuests((prev) => prev.filter((g) => g.guest_email !== guestEmail));
    },
    [meetingId],
  );

  // ── rtkStateUpdate sink (sidebar/chat open state) ──────────────────────────
  const [states, updateStates] = useReducer(
    (state: any, payload: any) => ({ ...state, ...payload }),
    { meeting: 'joined', activeSidebar: false },
  );

  return {
    meeting,
    roomJoined,
    roomState,
    selfName,
    canRecord,
    // view
    viewMode,
    setViewMode,
    activeSpeakerId,
    // timers
    meetingSeconds,
    fmtTime,
    // recording
    recordingState,
    isRecording,
    isPaused,
    isStarting,
    isStopping,
    recordingBusy,
    showRecordingBanner,
    recSeconds,
    toggleRecording,
    togglePauseRecording,
    // waiting room
    waitingGuests,
    admitGuest,
    denyGuest,
    // rtk state sink
    states,
    updateStates,
  };
}
