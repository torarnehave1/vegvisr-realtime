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
        if (data.success) setWaitingGuests(data.guests || []);
      } catch {
        /* ignore */
      }
    };
    poll(); // immediate first call
    const iv = setInterval(poll, 4000);
    return () => clearInterval(iv);
  }, [isHost, meetingId]);

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
