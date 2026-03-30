import React, { useState, useEffect, useReducer, useCallback, createContext, useContext } from 'react';
import {
  RealtimeKitProvider,
  useRealtimeKitClient,
  useRealtimeKitMeeting,
  useRealtimeKitSelector,
} from '@cloudflare/realtimekit-react';
import {
  RtkCameraToggle,
  RtkChatToggle,
  RtkDialogManager,
  RtkGrid,
  RtkLeaveButton,
  RtkLogo,
  RtkMeetingTitle,
  RtkMicToggle,
  RtkParticipantsAudio,
  RtkScreenShareToggle,
  RtkSetupScreen,
  RtkSettings,
  RtkSettingsToggle,
  RtkSidebar,
  RtkSpinner,
  RtkUiProvider,
  defaultConfig,
  provideRtkDesignSystem,
} from '@cloudflare/realtimekit-react-ui';
import { AuthBar, EcosystemNav } from 'vegvisr-ui-kit';
import { readStoredUser, type AuthUser } from './lib/auth';
import { Login } from './components/Login';
import { WaitingRoomPanel } from './components/WaitingRoomPanel';

const MAGIC_BASE = 'https://cookie.vegvisr.org';
const DASHBOARD_BASE = 'https://dashboard.vegvisr.org';

const AuthContext = createContext<AuthUser | null>(null);

// ─── Meeting UI ──────────────────────────────────────────────────────────────

const config = { ...defaultConfig };
if (config.root) {
  config.root['rtk-participant-tile'] = (
    config.root['rtk-participant-tile'] as any
  ).children;
}

function Meeting() {
  const { meeting } = useRealtimeKitMeeting();
  const roomJoined = useRealtimeKitSelector((m) => m.self.roomJoined);
  const roomState = useRealtimeKitSelector((m) => m.self.roomState);
  const selfName = useRealtimeKitSelector((m) => m.self.name);

  const canRecord = useRealtimeKitSelector((m) => m.self.permissions.canRecord);

  // Debug: log every roomState and roomJoined change
  useEffect(() => {
    console.log('[WaitingRoom] roomState:', roomState, '| roomJoined:', roomJoined, '| selfName:', selfName);
  }, [roomState, roomJoined, selfName]);

  // Debug: log when meeting object changes
  useEffect(() => {
    if (!meeting) return;
    console.log('[WaitingRoom] meeting initialized. self.waitListAndRoomWaitingInfo:', (meeting as any)?.self?.waitListAndRoomWaitingInfo);
    console.log('[WaitingRoom] meeting.self:', {
      id: (meeting as any)?.self?.id,
      presetId: (meeting as any)?.self?.presetId,
      waitlisted: (meeting as any)?.self?.waitlisted,
      roomState: (meeting as any)?.self?.roomState,
    });
  }, [meeting]);

  // Waitlist management (host)
  const [waitlistedParticipants, setWaitlistedParticipants] = useState<any[]>([]);
  const [showWaitlist, setShowWaitlist] = useState(false);
  const [knockNotification, setKnockNotification] = useState<string | null>(null);

  useEffect(() => {
    if (!meeting?.participants?.waitlisted) return;
    const updateWaitlist = () => {
      const list: any[] = [];
      meeting.participants.waitlisted.toArray().forEach((p: any) => list.push(p));
      setWaitlistedParticipants(list);
    };
    const onParticipantKnocked = (participant: any) => {
      console.log('[WaitingRoom] Knock! Participant entered waiting room:', participant?.name || participant?.id);
      updateWaitlist();
      setShowWaitlist(true);
      const name = participant?.name || participant?.customParticipantId || 'Someone';
      setKnockNotification(`${name} is waiting to join`);
    };
    updateWaitlist();
    meeting.participants.waitlisted.on('participantJoined', onParticipantKnocked);
    meeting.participants.waitlisted.on('participantLeft', updateWaitlist);
    return () => {
      meeting.participants.waitlisted.removeListener('participantJoined', onParticipantKnocked);
      meeting.participants.waitlisted.removeListener('participantLeft', updateWaitlist);
    };
  }, [meeting]);

  // Auto-dismiss knock notification after 6 seconds
  useEffect(() => {
    if (!knockNotification) return;
    const timer = setTimeout(() => setKnockNotification(null), 6000);
    return () => clearTimeout(timer);
  }, [knockNotification]);

  const [states, updateStates] = useReducer(
    (state: any, payload: any) => ({ ...state, ...payload }),
    { meeting: 'joined', activeSidebar: false },
  );

  const [recordingState, setRecordingState] = useState<string>('IDLE');
  const [recordingBusy, setRecordingBusy] = useState(false);
  const [showRecordingBanner, setShowRecordingBanner] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');

  // Meeting elapsed timer (hh:mm:ss)
  const [meetingSeconds, setMeetingSeconds] = useState(0);
  useEffect(() => {
    if (!roomJoined) return;
    setMeetingSeconds(0);
    const iv = setInterval(() => setMeetingSeconds((s) => s + 1), 1000);
    return () => clearInterval(iv);
  }, [roomJoined]);

  const [recSeconds, setRecSeconds] = useState(0);

  const fmtTime = (totalSec: number) => {
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  // Subscribe to recording state changes
  useEffect(() => {
    if (!meeting?.recording) return;
    const rec = meeting.recording;
    setRecordingState(rec.recordingState);
    const handler = (state: string) => setRecordingState(state);
    rec.on('recordingUpdate', handler);
    return () => { rec.removeListener('recordingUpdate', handler); };
  }, [meeting]);

  const isRecording = recordingState === 'RECORDING';
  const isPaused = recordingState === 'PAUSED';
  const isStarting = recordingState === 'STARTING';
  const isStopping = recordingState === 'STOPPING';

  // Recording elapsed timer — ticks while RECORDING, holds while PAUSED, resets on IDLE/STOPPING
  useEffect(() => {
    if (isRecording) {
      const iv = setInterval(() => setRecSeconds((s) => s + 1), 1000);
      return () => clearInterval(iv);
    }
    if (isPaused) return; // keep current value, don't tick
    setRecSeconds(0); // reset on stop/idle
  }, [isRecording, isPaused]);

  // Show banner briefly when recording starts
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

  const acceptParticipant = useCallback((id: string) => {
    meeting?.participants?.acceptWaitingRoomRequest(id);
  }, [meeting]);

  const rejectParticipant = useCallback(async (id: string) => {
    await meeting?.participants?.rejectWaitingRoomRequest(id);
  }, [meeting]);

  const acceptAll = useCallback(async () => {
    if (!meeting?.participants?.waitlisted) return;
    const ids = meeting.participants.waitlisted.toArray().map((p: any) => p.id);
    if (ids.length > 0) {
      await meeting.participants.acceptAllWaitingRoomRequest(ids);
    }
  }, [meeting]);

  if (!meeting) return <RtkSpinner />;

  // Guest: waiting room — shown when preset has waiting room enabled
  if (roomState === 'waitlisted') {
    console.log('[WaitingRoom] RENDERING: waiting room screen (roomState=waitlisted)');
    return (
      <div className="flex flex-col items-center justify-center h-full gap-6 text-slate-200 p-8">
        <div className="w-20 h-20 rounded-full bg-sky-900/50 flex items-center justify-center">
          <span className="text-4xl">🕐</span>
        </div>
        <div className="text-center">
          <h1 className="text-xl font-semibold">You're in the waiting room</h1>
          <p className="text-sm text-slate-400 mt-2">The host will let you in soon</p>
        </div>
        <div className="w-8 h-8 border-3 border-sky-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (roomState === 'ended' || roomState === 'left') {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 text-slate-200">
        <p className="text-lg font-medium">The meeting ended.</p>
        <button
          className="px-5 py-2 bg-sky-600 hover:bg-sky-500 rounded text-white font-medium"
          onClick={() => {
            window.location.href = window.location.origin + window.location.pathname;
          }}
        >
          ← Return to Lobby
        </button>
      </div>
    );
  }
  if (!roomJoined) {
    console.log('[WaitingRoom] RENDERING: setup screen (roomJoined=false, roomState=' + roomState + ')');
    return <RtkSetupScreen meeting={meeting} />;
  }

  return (
    <div
      className="flex flex-col w-full h-full relative"
      ref={(el) => {
        el?.addEventListener('rtkStateUpdate', (e: any) => updateStates(e.detail));
      }}
    >
      {/* Knock notification banner — auto-dismisses after 6 seconds */}
      {knockNotification && (
        <div className="flex items-center justify-between gap-2 px-3 py-2 bg-amber-700 text-white text-sm font-medium">
          <div className="flex items-center gap-2">
            <span className="inline-block w-3 h-3 rounded-full bg-amber-300 animate-ping" />
            <span>🖐 {knockNotification}</span>
          </div>
          <button
            className="px-2 py-0.5 bg-amber-500 hover:bg-amber-400 rounded text-white text-xs ml-2"
            onClick={() => { setKnockNotification(null); setShowWaitlist(true); }}
          >
            View →
          </button>
        </div>
      )}

      {/* Recording warning banner — shown for 3 seconds */}
      {showRecordingBanner && (
        <div className="flex items-center justify-center gap-2 px-3 py-2 bg-red-700 text-white text-sm font-medium animate-pulse">
          <span className="inline-block w-3 h-3 rounded-full bg-red-300 animate-ping" />
          <span>
            {isStarting ? 'Recording starting…' : '⏺ This meeting is being recorded'}
          </span>
        </div>
      )}
      <header className="flex items-center gap-3 h-12 border-b border-slate-700 w-full px-2 text-sm text-slate-200">
        <RtkLogo meeting={meeting} />
        <RtkMeetingTitle meeting={meeting} />
        <span className="ml-2 font-mono text-xs text-slate-400" title="Meeting duration">
          🕐 {fmtTime(meetingSeconds)}
        </span>
        {(isRecording || isPaused) && (
          <span className={`ml-2 font-mono text-xs flex items-center gap-1 ${isPaused ? 'text-yellow-400' : 'text-red-400'}`} title={isPaused ? 'Recording paused' : 'Recording duration'}>
            <span className={`inline-block w-2 h-2 rounded-full ${isPaused ? 'bg-yellow-500' : 'bg-red-500 animate-pulse'}`} />
            {isPaused ? 'REC PAUSED' : 'REC'} {fmtTime(recSeconds)}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          {editingName ? (
            <form className="flex items-center gap-1" onSubmit={async (e) => {
              e.preventDefault();
              if (nameDraft.trim() && meeting) {
                try { await (meeting as any).changeDisplayName(nameDraft.trim()); } catch {}
              }
              setEditingName(false);
            }}>
              <input
                autoFocus
                className="bg-slate-800 border border-slate-500 rounded px-2 py-0.5 text-xs text-white w-32 focus:outline-none focus:border-sky-500"
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                onBlur={() => setEditingName(false)}
                onKeyDown={(e) => { if (e.key === 'Escape') setEditingName(false); }}
              />
            </form>
          ) : (
            <button
              className="text-xs text-slate-400 hover:text-white truncate max-w-[150px]"
              onClick={() => { setNameDraft(selfName || ''); setEditingName(true); }}
              title="Click to change your display name"
            >
              {selfName || 'You'} ✏️
            </button>
          )}
          {/* Waitlist indicator + toggle */}
          {waitlistedParticipants.length > 0 && (
            <button
              className={`relative ml-2 px-2 py-1 rounded text-white text-xs font-medium ${knockNotification ? 'bg-amber-500 animate-pulse ring-2 ring-amber-300' : 'bg-amber-600 hover:bg-amber-500'}`}
              onClick={() => setShowWaitlist(!showWaitlist)}
              title={`${waitlistedParticipants.length} waiting`}
            >
              🖐 {waitlistedParticipants.length}
            </button>
          )}
        </div>
      </header>

      {/* Waitlist panel — floating overlay */}
      {showWaitlist && waitlistedParticipants.length > 0 && (
        <div className="absolute top-14 right-2 z-50 bg-slate-800 border border-slate-600 rounded-lg shadow-xl w-72 max-h-80 overflow-y-auto">
          <div className="flex items-center justify-between p-3 border-b border-slate-700">
            <span className="text-sm font-medium text-slate-200">
              Waiting Room ({waitlistedParticipants.length})
            </span>
            <div className="flex items-center gap-2">
              <button
                className="px-2 py-1 bg-emerald-600 hover:bg-emerald-500 rounded text-white text-xs"
                onClick={acceptAll}
              >
                Accept All
              </button>
              <button
                className="text-slate-500 hover:text-white text-sm"
                onClick={() => setShowWaitlist(false)}
              >
                ✕
              </button>
            </div>
          </div>
          <div className="p-2 flex flex-col gap-1">
            {waitlistedParticipants.map((p: any) => (
              <div key={p.id} className="flex items-center gap-2 px-2 py-2 rounded hover:bg-slate-700/50">
                {p.picture ? (
                  <img src={p.picture} alt="" className="w-8 h-8 rounded-full object-cover" />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-slate-600 flex items-center justify-center text-xs text-slate-300">
                    {(p.name || '?')[0].toUpperCase()}
                  </div>
                )}
                <span className="flex-1 text-sm text-slate-200 truncate">{p.name || p.customParticipantId || 'Guest'}</span>
                <button
                  className="px-2 py-1 bg-emerald-600 hover:bg-emerald-500 rounded text-white text-xs"
                  onClick={() => acceptParticipant(p.id)}
                  title="Accept"
                >
                  ✓
                </button>
                <button
                  className="px-2 py-1 bg-red-600 hover:bg-red-500 rounded text-white text-xs"
                  onClick={() => rejectParticipant(p.id)}
                  title="Deny"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <main className="flex flex-1 p-2 min-h-0">
        <RtkGrid meeting={meeting} config={config} />
        {states.activeSidebar && <RtkSidebar meeting={meeting} states={states} />}
      </main>
      <footer className="p-2 flex items-center w-full border-t border-slate-700">
        <div className="flex flex-1">
          <RtkLeaveButton />
        </div>
        <div className="flex gap-2 justify-center flex-1">
          <RtkMicToggle meeting={meeting} />
          <RtkCameraToggle meeting={meeting} />
          <RtkScreenShareToggle meeting={meeting} />
          <RtkChatToggle meeting={meeting} />
          <RtkSettingsToggle />
          {/* Record button — only visible to hosts with canRecord permission */}
          {canRecord && (
            <>
              <button
                className={`px-3 py-1.5 rounded text-xs font-medium transition-colors disabled:opacity-40 ${
                  isRecording || isPaused
                    ? 'bg-red-600 hover:bg-red-500 text-white'
                    : 'bg-slate-700 hover:bg-slate-600 text-slate-200'
                }`}
                disabled={recordingBusy || isStarting || isStopping}
                onClick={toggleRecording}
                title={isRecording || isPaused ? 'Stop recording' : 'Start recording'}
              >
                {isStarting ? '⏳ Starting…' : isStopping ? '⏳ Stopping…' : isRecording || isPaused ? '⏹ Stop' : '⏺ Record'}
              </button>
              {(isRecording || isPaused) && (
                <button
                  className={`px-3 py-1.5 rounded text-xs font-medium transition-colors disabled:opacity-40 ${
                    isPaused
                      ? 'bg-yellow-600 hover:bg-yellow-500 text-white'
                      : 'bg-slate-700 hover:bg-slate-600 text-slate-200'
                  }`}
                  disabled={recordingBusy}
                  onClick={togglePauseRecording}
                  title={isPaused ? 'Resume recording' : 'Pause recording'}
                >
                  {isPaused ? '▶ Resume' : '⏸ Pause'}
                </button>
              )}
            </>
          )}
        </div>
        <div className="flex flex-1" />
      </footer>
      <WaitingRoomPanel meeting={meeting} />
    </div>
  );
}

function RealtimeMeeting() {
  const [meeting, initMeeting] = useRealtimeKitClient();
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [noParams, setNoParams] = useState(false);
  const [waitingScreenInfo, setWaitingScreenInfo] = useState<{
    meetingTitle?: string | null;
    hostName?: string | null;
    waitingTitle?: string | null;
    waitingImage?: string | null;
    waitingRoomEnabled?: boolean | null;
    hostOnline?: boolean | null;
  } | null>(null);
  // Pre-join state: when waiting room is on and host isn't in the meeting yet
  const [waitingForHost, setWaitingForHost] = useState(false);
  const [checkingHost, setCheckingHost] = useState(false);
  const [manualMeetingId, setManualMeetingId] = useState('');
  const [joining, setJoining] = useState(false);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pastMeetings, setPastMeetings] = useState<any[]>([]);
  const [loadingMeetings, setLoadingMeetings] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [myRooms, setMyRooms] = useState<{ personalMeetingId: string | null; teamMeetingId: string | null }>({ personalMeetingId: null, teamMeetingId: null });
  const [provisioningRooms, setProvisioningRooms] = useState(false);
  const [editingRoomTitle, setEditingRoomTitle] = useState<'personal' | 'team' | null>(null);
  const [roomTitleDraft, setRoomTitleDraft] = useState('');
  const [savingTitle, setSavingTitle] = useState(false);
  const [personalRoomTitle, setPersonalRoomTitle] = useState<string | null>(null);
  const [teamRoomTitle, setTeamRoomTitle] = useState<string | null>(null);
  const [recordings, setRecordings] = useState<any[]>([]);
  const [loadingRecordings, setLoadingRecordings] = useState(false);
  const [syncingRecordings, setSyncingRecordings] = useState(false);
  const [renamingKey, setRenamingKey] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [deletingKey, setDeletingKey] = useState<string | null>(null);
  const [transcribingKey, setTranscribingKey] = useState<string | null>(null);
  const [transcripts, setTranscripts] = useState<Record<string, string>>({});
  const [transcribeProgress, setTranscribeProgress] = useState<{ current: number; total: number } | null>(null);
  const [lobbyTab, setLobbyTab] = useState<'meetings' | 'recordings'>('meetings');
  const [playingKey, setPlayingKey] = useState<string | null>(null);
  const [copiedTranscript, setCopiedTranscript] = useState<string | null>(null);
  const [waitingTitle, setWaitingTitle] = useState('');
  const [waitingImage, setWaitingImage] = useState('');
  const [savingWaitingScreen, setSavingWaitingScreen] = useState(false);
  const [editingWaitingScreen, setEditingWaitingScreen] = useState(false);
  const [waitingRoomEnabled, setWaitingRoomEnabled] = useState(false);
  const [togglingWaitingRoom, setTogglingWaitingRoom] = useState(false);
  const [displayName, setDisplayName] = useState(() => {
    const stored = readStoredUser();
    if (!stored?.email) return '';
    if (stored.displayName) return stored.displayName;
    return stored.email.split('@')[0].replace(/[._-]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  });

  const fetchTokenAndJoin = async (
    meetingId: string,
    presetName?: string,
  ) => {
    const stored = readStoredUser();
    if (!stored?.emailVerificationToken) {
      setTokenError('You must be logged in to join this meeting.');
      return;
    }
    setJoining(true);
    try {
      const clientData: Record<string, string> = {
        customParticipantId: stored.email,
      };
      if (displayName.trim()) clientData.name = displayName.trim();
      if (presetName) clientData.presetName = presetName;

      const r = await fetch('https://api.vegvisr.org/realtime/join-token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Token': stored.emailVerificationToken,
        },
        body: JSON.stringify({ meetingId, clientData }),
      });
      const data = await r.json();
      if (!data.authToken) throw new Error(data.error || 'No token returned from server');
      console.log('[WaitingRoom] fetchTokenAndJoin: got authToken, calling initMeeting for meetingId:', meetingId);
      await initMeeting({ authToken: data.authToken, defaults: { audio: false, video: false } });
      console.log('[WaitingRoom] fetchTokenAndJoin: initMeeting resolved');
      setNoParams(false);
    } catch (err: any) {
      setTokenError(err.message);
    } finally {
      setJoining(false);
    }
  };

  const joinByMeetingId = (id: string) => fetchTokenAndJoin(id);

  // Check if host is online and join if so — used by "waiting for host" retry button
  const checkHostAndJoin = async () => {
    const meetingId = new URL(window.location.href).searchParams.get('meetingId');
    if (!meetingId) return;
    setCheckingHost(true);
    try {
      const r = await fetch(`https://api.vegvisr.org/realtime/meeting-info?meetingId=${encodeURIComponent(meetingId)}`);
      const info = await r.json();
      if (info?.success) setWaitingScreenInfo(info);
      if (!info?.waitingRoomEnabled || info?.hostOnline !== false) {
        // Host is now online (or waiting room was turned off) — proceed with join
        setWaitingForHost(false);
        const stored = readStoredUser();
        if (!stored?.emailVerificationToken) { setTokenError('You must be logged in.'); return; }
        const tokenResp = await fetch('https://api.vegvisr.org/realtime/join-token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-API-Token': stored.emailVerificationToken },
          body: JSON.stringify({ meetingId, clientData: { customParticipantId: stored.email, name: displayName.trim() || stored.email.split('@')[0] } }),
        });
        const data = await tokenResp.json();
        if (!data.authToken) throw new Error(data.error || 'No token returned');
        await initMeeting({ authToken: data.authToken, defaults: { audio: false, video: false } });
      }
      // else: host still not online — stay on waiting-for-host screen
    } catch (err: any) {
      setTokenError(err.message);
    } finally {
      setCheckingHost(false);
    }
  };

  const createMeeting = async () => {
    const stored = readStoredUser();
    if (!stored?.emailVerificationToken) {
      setTokenError('You must be logged in to create a meeting.');
      return;
    }
    setJoining(true);
    try {
      // 1. Create meeting via Cloudflare RealtimeKit API
      const createRes = await fetch('https://api.vegvisr.org/realtime/create-meeting', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Token': stored.emailVerificationToken,
        },
        body: JSON.stringify({}),
      });
      const createData = await createRes.json();
      if (!createData.meetingId) throw new Error(createData.error || 'Failed to create meeting');

      const newId = createData.meetingId;
      const link = `${window.location.origin}/?meetingId=${newId}`;
      setInviteLink(link);
      setCopied(false);

      // 2. Join as host
      await fetchTokenAndJoin(newId, 'group_call_host');
    } catch (err: any) {
      setTokenError(err.message);
      setJoining(false);
    }
  };

  const copyInviteLink = () => {
    if (!inviteLink) return;
    navigator.clipboard.writeText(inviteLink).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const fetchMyRooms = async () => {
    const stored = readStoredUser();
    if (!stored?.emailVerificationToken) return;
    try {
      const r = await fetch('https://api.vegvisr.org/realtime/my-rooms', {
        headers: { 'X-API-Token': stored.emailVerificationToken },
      });
      const data = await r.json();
      if (data.success) {
        setMyRooms({ personalMeetingId: data.personalMeetingId, teamMeetingId: data.teamMeetingId });
        if (data.personalTitle) setPersonalRoomTitle(data.personalTitle);
        if (data.teamTitle) setTeamRoomTitle(data.teamTitle);
        // Load waiting screen config
        if (data.waitingScreen) {
          if (data.waitingScreen.title) setWaitingTitle(data.waitingScreen.title);
          if (data.waitingScreen.image) setWaitingImage(data.waitingScreen.image);
        }
        // Load waiting room enabled state
        setWaitingRoomEnabled(!!data.waitingRoomEnabled);
        // Update display name from config table if available
        if (data.displayName && !stored.displayName) {
          setDisplayName(data.displayName);
          // Persist to localStorage
          try {
            const raw = localStorage.getItem('user');
            if (raw) {
              const parsed = JSON.parse(raw);
              parsed.displayName = data.displayName;
              localStorage.setItem('user', JSON.stringify(parsed));
            }
          } catch { /* ignore */ }
        }
      }
    } catch { /* ignore */ }
  };

  const provisionRooms = async () => {
    const stored = readStoredUser();
    if (!stored?.emailVerificationToken) return;
    setProvisioningRooms(true);
    try {
      const r = await fetch('https://api.vegvisr.org/realtime/provision-rooms', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Token': stored.emailVerificationToken,
        },
        body: JSON.stringify({ displayName: displayName.trim() || undefined }),
      });
      const data = await r.json();
      if (data.success) {
        setMyRooms({ personalMeetingId: data.personalMeetingId, teamMeetingId: data.teamMeetingId });
      }
    } catch { /* ignore */ }
    finally { setProvisioningRooms(false); }
  };

  const fetchMeetings = async () => {
    const stored = readStoredUser();
    if (!stored?.emailVerificationToken) return;
    setLoadingMeetings(true);
    try {
      const r = await fetch('https://api.vegvisr.org/realtime/list-meetings', {
        headers: { 'X-API-Token': stored.emailVerificationToken },
      });
      const data = await r.json();
      if (data.meetings) setPastMeetings(data.meetings);
    } catch { /* ignore */ }
    finally { setLoadingMeetings(false); }
  };

  const closeMeeting = async (meetingId: string) => {
    const stored = readStoredUser();
    if (!stored?.emailVerificationToken) return;
    setDeletingId(meetingId);
    try {
      const r = await fetch('https://api.vegvisr.org/realtime/close-meeting', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Token': stored.emailVerificationToken,
        },
        body: JSON.stringify({ meetingId }),
      });
      const data = await r.json();
      if (data.success) {
        setPastMeetings((prev) =>
          prev.map((m) => m.id === meetingId ? { ...m, status: 'INACTIVE' } : m)
        );
      }
    } catch { /* ignore */ }
    finally { setDeletingId(null); }
  };

  const renameRoom = async (meetingId: string, title: string) => {
    const stored = readStoredUser();
    if (!stored?.emailVerificationToken) return;
    setSavingTitle(true);
    try {
      const r = await fetch('https://api.vegvisr.org/realtime/rename-room', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Token': stored.emailVerificationToken,
        },
        body: JSON.stringify({ meetingId, title }),
      });
      const data = await r.json();
      if (data.success) {
        if (meetingId === myRooms.personalMeetingId) setPersonalRoomTitle(data.title);
        if (meetingId === myRooms.teamMeetingId) setTeamRoomTitle(data.title);
      }
    } catch { /* ignore */ }
    finally {
      setSavingTitle(false);
      setEditingRoomTitle(null);
    }
  };

  const saveWaitingScreen = async () => {
    const stored = readStoredUser();
    if (!stored?.emailVerificationToken) return;
    setSavingWaitingScreen(true);
    try {
      const r = await fetch('https://api.vegvisr.org/realtime/update-waiting-screen', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Token': stored.emailVerificationToken,
        },
        body: JSON.stringify({ title: waitingTitle.trim() || null, image: waitingImage.trim() || null }),
      });
      const data = await r.json();
      if (data.success) {
        setEditingWaitingScreen(false);
      }
    } catch { /* ignore */ }
    finally { setSavingWaitingScreen(false); }
  };

  const toggleWaitingRoom = async () => {
    const stored = readStoredUser();
    if (!stored?.emailVerificationToken) return;
    setTogglingWaitingRoom(true);
    try {
      const r = await fetch('https://api.vegvisr.org/realtime/toggle-waiting-room', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Token': stored.emailVerificationToken,
        },
        body: JSON.stringify({ enabled: !waitingRoomEnabled }),
      });
      const data = await r.json();
      if (data.success) {
        setWaitingRoomEnabled(data.waitingRoomEnabled);
      }
    } catch { /* ignore */ }
    finally { setTogglingWaitingRoom(false); }
  };

  const fetchRecordings = async () => {
    const stored = readStoredUser();
    if (!stored?.emailVerificationToken) return;
    setLoadingRecordings(true);
    try {
      const r = await fetch('https://api.vegvisr.org/realtime/recordings', {
        headers: { 'X-API-Token': stored.emailVerificationToken },
      });
      const data = await r.json();
      if (data.success) setRecordings(data.recordings || []);
    } catch { /* ignore */ }
    finally { setLoadingRecordings(false); }
  };

  const renameRecording = async (key: string, newName: string) => {
    const stored = readStoredUser();
    if (!stored?.emailVerificationToken) return;
    try {
      const r = await fetch('https://api.vegvisr.org/realtime/recordings/rename', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Token': stored.emailVerificationToken,
        },
        body: JSON.stringify({ key, newName }),
      });
      const data = await r.json();
      if (data.success) {
        setRecordings(prev => prev.map(rec =>
          rec.key === key ? { ...rec, key: data.newKey, name: newName } : rec
        ));
      }
    } catch { /* ignore */ }
    finally { setRenamingKey(null); }
  };

  const deleteRecording = async (key: string) => {
    const stored = readStoredUser();
    if (!stored?.emailVerificationToken) return;
    setDeletingKey(key);
    try {
      const r = await fetch('https://api.vegvisr.org/realtime/recordings/delete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Token': stored.emailVerificationToken,
        },
        body: JSON.stringify({ key }),
      });
      const data = await r.json();
      if (data.success) {
        setRecordings(prev => prev.filter(rec => rec.key !== key));
      }
    } catch { /* ignore */ }
    finally { setDeletingKey(null); }
  };

  const downloadRecording = (rec: any) => {
    const stored = readStoredUser();
    if (!stored?.emailVerificationToken) return;
    if (rec.source === 'realtimekit' && rec.download_url) {
      window.open(rec.download_url, '_blank');
    } else {
      window.open(
        `https://api.vegvisr.org/realtime/recordings/download?key=${encodeURIComponent(rec.key)}&token=${encodeURIComponent(stored.emailVerificationToken)}`,
        '_blank'
      );
    }
  };

  const CHUNK_DURATION_SECONDS = 120;
  const WHISPER_ENDPOINT = 'https://openai.vegvisr.org/audio';

  const audioBufferToWavBlob = (audioBuffer: AudioBuffer): Blob => {
    const numberOfChannels = 1; // mono for speech
    const sampleRate = 16000; // 16kHz for Whisper
    const srcRate = audioBuffer.sampleRate;
    const ratio = srcRate / sampleRate;
    const newLength = Math.floor(audioBuffer.length / ratio);
    const buffer = new ArrayBuffer(44 + newLength * 2);
    const view = new DataView(buffer);
    const writeStr = (off: number, s: string) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
    writeStr(0, 'RIFF');
    view.setUint32(4, 36 + newLength * 2, true);
    writeStr(8, 'WAVE');
    writeStr(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numberOfChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeStr(36, 'data');
    view.setUint32(40, newLength * 2, true);
    // Mix to mono + resample with linear interpolation
    const ch0 = audioBuffer.getChannelData(0);
    const ch1 = audioBuffer.numberOfChannels > 1 ? audioBuffer.getChannelData(1) : ch0;
    let offset = 44;
    for (let i = 0; i < newLength; i++) {
      const srcIdx = i * ratio;
      const idx = Math.floor(srcIdx);
      const frac = srcIdx - idx;
      const s0 = ((ch0[idx] || 0) + (ch1[idx] || 0)) / 2;
      const s1 = ((ch0[Math.min(idx + 1, audioBuffer.length - 1)] || 0) + (ch1[Math.min(idx + 1, audioBuffer.length - 1)] || 0)) / 2;
      const sample = Math.max(-1, Math.min(1, s0 + (s1 - s0) * frac));
      view.setInt16(offset, sample * 0x7fff, true);
      offset += 2;
    }
    return new Blob([buffer], { type: 'audio/wav' });
  };

  const fmtChunkTs = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const transcribeRecording = async (key: string) => {
    const stored = readStoredUser();
    if (!stored?.emailVerificationToken) return;
    setTranscribingKey(key);
    setTranscribeProgress(null);
    setTranscripts(prev => ({ ...prev, [key]: 'Downloading recording…' }));
    try {
      // 1. Download the video/audio from R2 via the download endpoint
      const downloadUrl = `https://api.vegvisr.org/realtime/recordings/download?key=${encodeURIComponent(key)}&token=${encodeURIComponent(stored.emailVerificationToken)}`;
      const dlResp = await fetch(downloadUrl);
      if (!dlResp.ok) throw new Error(`Download failed: ${dlResp.status} ${dlResp.statusText}`);
      const arrayBuf = await dlResp.arrayBuffer();
      const sizeMB = (arrayBuf.byteLength / 1024 / 1024).toFixed(1);
      setTranscripts(prev => ({ ...prev, [key]: `Downloaded ${sizeMB} MB — decoding audio…` }));

      // 2. Decode audio from the video using Web Audio API
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      let audioBuffer: AudioBuffer;
      try {
        audioBuffer = await audioCtx.decodeAudioData(arrayBuf);
      } finally {
        await audioCtx.close();
      }

      // 3. Split into chunks
      const chunkSamples = CHUNK_DURATION_SECONDS * audioBuffer.sampleRate;
      const totalChunks = Math.max(Math.ceil(audioBuffer.length / chunkSamples), 1);
      setTranscribeProgress({ current: 0, total: totalChunks });
      setTranscripts(prev => ({ ...prev, [key]: `Transcribing ${totalChunks} chunk(s)…` }));

      const segments: string[] = [];

      for (let i = 0; i < totalChunks; i++) {
        setTranscribeProgress({ current: i + 1, total: totalChunks });
        const startSample = i * chunkSamples;
        const endSample = Math.min(startSample + chunkSamples, audioBuffer.length);
        const chunkLength = endSample - startSample;

        // Create chunk AudioBuffer
        const offCtx = new OfflineAudioContext(audioBuffer.numberOfChannels, chunkLength, audioBuffer.sampleRate);
        const chunkBuf = offCtx.createBuffer(audioBuffer.numberOfChannels, chunkLength, audioBuffer.sampleRate);
        for (let ch = 0; ch < audioBuffer.numberOfChannels; ch++) {
          const src = audioBuffer.getChannelData(ch);
          const dst = chunkBuf.getChannelData(ch);
          for (let s = 0; s < chunkLength; s++) dst[s] = src[startSample + s];
        }

        // Convert to mono 16kHz WAV
        const wavBlob = audioBufferToWavBlob(chunkBuf);

        // Send to Whisper endpoint (same as GrokChatPanel)
        const formData = new FormData();
        formData.append('file', wavBlob, `chunk_${i + 1}.wav`);
        formData.append('model', 'whisper-1');

        const whisperResp = await fetch(WHISPER_ENDPOINT, { method: 'POST', body: formData });
        const whisperData = await whisperResp.json();
        const chunkText = (whisperData.text || '').trim();
        const startTime = startSample / audioBuffer.sampleRate;
        const endTime = endSample / audioBuffer.sampleRate;
        const label = `[${fmtChunkTs(startTime)} – ${fmtChunkTs(endTime)}]`;

        if (chunkText) {
          segments.push(`${label} ${chunkText}`);
        } else {
          segments.push(`${label} (no speech detected)`);
        }

        // Show partial results as they come in
        setTranscripts(prev => ({ ...prev, [key]: segments.join('\n\n') }));
      }

      setTranscripts(prev => ({ ...prev, [key]: segments.join('\n\n') || 'No speech detected in recording.' }));
    } catch (err: any) {
      setTranscripts(prev => ({ ...prev, [key]: `Error: ${err.message}` }));
    } finally {
      setTranscribingKey(null);
      setTranscribeProgress(null);
    }
  };

  const syncRecordingsToR2 = async () => {
    const stored = readStoredUser();
    if (!stored?.emailVerificationToken) return;
    setSyncingRecordings(true);
    try {
      const r = await fetch('https://api.vegvisr.org/realtime/recordings/sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Token': stored.emailVerificationToken,
        },
        body: JSON.stringify({}),
      });
      const data = await r.json();
      if (data.success) {
        alert(`Synced ${data.synced} recording(s) to R2. ${data.skipped} already existed.`);
        await fetchRecordings();
      } else {
        alert('Sync failed: ' + (data.error || 'Unknown error'));
      }
    } catch (err: any) {
      alert('Sync error: ' + err.message);
    } finally {
      setSyncingRecordings(false);
    }
  };

  const getVideoUrl = (rec: any): string | null => {
    const stored = readStoredUser();
    if (!stored?.emailVerificationToken) return null;
    if (rec.source === 'realtimekit' && rec.download_url) return rec.download_url;
    return `https://api.vegvisr.org/realtime/recordings/download?key=${encodeURIComponent(rec.key)}&token=${encodeURIComponent(stored.emailVerificationToken)}`;
  };

  const copyTranscript = (key: string) => {
    const text = transcripts[key];
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      setCopiedTranscript(key);
      setTimeout(() => setCopiedTranscript(null), 2000);
    });
  };

  useEffect(() => {
    const searchParams = new URL(window.location.href).searchParams;
    const authToken = searchParams.get('authToken');
    const meetingId = searchParams.get('meetingId');

    provideRtkDesignSystem(document.body, { theme: 'dark' });

    // Direct token in URL — use it immediately (legacy / invite link flow)
    if (authToken) {
      initMeeting({ authToken, defaults: { audio: false, video: false } })
        .catch((err: any) => setTokenError(err.message));
      return;
    }

    // Meeting ID in URL — sequential flow:
    // 1. Fetch meeting info (title, host, waiting room config)
    // 2. If waiting room enabled and host not online: show "waiting for host" screen
    // 3. Otherwise: fetch token and join
    if (meetingId) {
      const joinMeetingById = async (id: string) => {
        // Step 1: Fetch meeting info
        let meetingInfo: any = null;
        try {
          const r = await fetch(`https://api.vegvisr.org/realtime/meeting-info?meetingId=${encodeURIComponent(id)}`);
          meetingInfo = await r.json();
          if (meetingInfo?.success) setWaitingScreenInfo(meetingInfo);
        } catch { /* ignore — proceed without info */ }

        // Step 2: If waiting room is on and host is confirmed offline, show waiting-for-host
        if (meetingInfo?.waitingRoomEnabled && meetingInfo?.hostOnline === false) {
          console.log('[WaitingRoom] Host not yet in meeting. Showing waiting-for-host screen.');
          setWaitingForHost(true);
          return;
        }

        // Step 3: Fetch join token and initialize
        const stored = readStoredUser();
        if (!stored?.emailVerificationToken) {
          setTokenError('You must be logged in to join this meeting.');
          return;
        }
        try {
          const r = await fetch('https://api.vegvisr.org/realtime/join-token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-API-Token': stored.emailVerificationToken },
            body: JSON.stringify({
              meetingId: id,
              clientData: {
                customParticipantId: stored.email,
                name: displayName.trim() || stored.email.split('@')[0],
              },
            }),
          });
          const data = await r.json();
          if (!data.authToken) throw new Error(data.error || 'No token returned from server');
          console.log('[WaitingRoom] Got authToken from backend. Calling initMeeting...');
          await initMeeting({ authToken: data.authToken, defaults: { audio: false, video: false } });
          console.log('[WaitingRoom] initMeeting() resolved. Meeting initialized.');
        } catch (err: any) {
          setTokenError(err.message);
        }
      };

      joinMeetingById(meetingId);
      return;
    }

    // No params — show the lobby
    setNoParams(true);
    fetchMyRooms();
  }, []);

  if (tokenError) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-6 p-8 text-center">
        <p className="text-red-400">{tokenError}</p>
        <button
          className="px-4 py-2 bg-sky-600 hover:bg-sky-500 rounded text-white text-sm"
          onClick={() => setTokenError(null)}
        >
          Try again
        </button>
      </div>
    );
  }

  if (noParams) {
    return (
      <div className="flex flex-col h-full">
        {/* Top bar with logo */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-700">
          <img src="https://favicons.vegvisr.org/favicons/1774561024334-1-1774561031809-512x512.png" alt="Vegvisr Realtime" style={{ width: '200px', height: '200px' }} />
        </div>

        {/* Tab navigation */}
        <div className="flex border-b border-slate-700">
          <button
            className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${lobbyTab === 'meetings' ? 'text-white border-b-2 border-sky-500 bg-slate-800/50' : 'text-slate-400 hover:text-white'}`}
            onClick={() => setLobbyTab('meetings')}
          >
            📞 Meetings
          </button>
          <button
            className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${lobbyTab === 'recordings' ? 'text-white border-b-2 border-purple-500 bg-slate-800/50' : 'text-slate-400 hover:text-white'}`}
            onClick={() => { setLobbyTab('recordings'); if (recordings.length === 0) fetchRecordings(); }}
          >
            🎬 Recordings {recordings.length > 0 && <span className="ml-1 text-xs bg-slate-700 rounded-full px-1.5">{recordings.length}</span>}
          </button>
        </div>

        {/* ─── Meetings Tab ─── */}
        {lobbyTab === 'meetings' && (
        <div className="flex flex-col items-center justify-center flex-1 gap-6 p-8 overflow-y-auto">
        <div className="text-center mb-2">
          <h1 className="text-2xl font-semibold text-white mb-1">Meetings</h1>
          <p className="text-slate-400 text-sm">Create a new meeting or join an existing one.</p>
        </div>

        {/* Display name */}
        <div className="w-full max-w-sm">
          <label className="block text-xs text-slate-400 mb-1">Your name</label>
          <input
            type="text"
            className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-2 text-white text-sm placeholder-slate-500 focus:outline-none focus:border-sky-500"
            placeholder="Enter your name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
        </div>

        {/* Permanent Rooms */}
        {(myRooms.personalMeetingId || myRooms.teamMeetingId) ? (
          <div className="flex flex-col gap-2 w-full max-w-sm">
            {myRooms.personalMeetingId && (
              <div className="flex items-center gap-2">
                <button
                  className="flex-1 px-4 py-3 bg-violet-700 hover:bg-violet-600 rounded-lg text-white font-medium disabled:opacity-40 text-left"
                  disabled={joining}
                  onClick={() => {
                    setInviteLink(`${window.location.origin}/?meetingId=${myRooms.personalMeetingId}`);
                    setCopied(false);
                    fetchTokenAndJoin(myRooms.personalMeetingId!, 'group_call_host');
                  }}
                >
                  <span className="block text-sm">{joining ? 'Joining…' : '🏠 My Room'}</span>
                  {personalRoomTitle && <span className="block text-xs text-violet-200 mt-0.5">{personalRoomTitle}</span>}
                </button>
                <button
                  className="px-2 py-2 text-slate-400 hover:text-white text-sm"
                  title="Rename room"
                  onClick={() => {
                    setEditingRoomTitle('personal');
                    setRoomTitleDraft(personalRoomTitle || '');
                  }}
                >
                  ✏️
                </button>
              </div>
            )}
            {editingRoomTitle === 'personal' && myRooms.personalMeetingId && (
              <div className="flex gap-2">
                <input
                  type="text"
                  className="flex-1 bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-white text-sm focus:outline-none focus:border-sky-500"
                  placeholder="Room title"
                  value={roomTitleDraft}
                  onChange={(e) => setRoomTitleDraft(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && roomTitleDraft.trim() && renameRoom(myRooms.personalMeetingId!, roomTitleDraft.trim())}
                  autoFocus
                />
                <button
                  className="px-3 py-1.5 bg-sky-600 hover:bg-sky-500 rounded text-white text-xs disabled:opacity-40"
                  disabled={savingTitle || !roomTitleDraft.trim()}
                  onClick={() => renameRoom(myRooms.personalMeetingId!, roomTitleDraft.trim())}
                >
                  {savingTitle ? '…' : 'Save'}
                </button>
                <button
                  className="px-2 py-1.5 text-slate-500 hover:text-white text-xs"
                  onClick={() => setEditingRoomTitle(null)}
                >
                  ✕
                </button>
              </div>
            )}
            {myRooms.teamMeetingId && (
              <div className="flex items-center gap-2">
                <button
                  className="flex-1 px-4 py-3 bg-indigo-700 hover:bg-indigo-600 rounded-lg text-white font-medium disabled:opacity-40 text-left"
                  disabled={joining}
                  onClick={() => {
                    setInviteLink(`${window.location.origin}/?meetingId=${myRooms.teamMeetingId}`);
                    setCopied(false);
                    fetchTokenAndJoin(myRooms.teamMeetingId!, 'group_call_host');
                  }}
                >
                  <span className="block text-sm">{joining ? 'Joining…' : '👥 Team Room'}</span>
                  {teamRoomTitle && <span className="block text-xs text-indigo-200 mt-0.5">{teamRoomTitle}</span>}
                </button>
                <button
                  className="px-2 py-2 text-slate-400 hover:text-white text-sm"
                  title="Rename room"
                  onClick={() => {
                    setEditingRoomTitle('team');
                    setRoomTitleDraft(teamRoomTitle || '');
                  }}
                >
                  ✏️
                </button>
              </div>
            )}
            {editingRoomTitle === 'team' && myRooms.teamMeetingId && (
              <div className="flex gap-2">
                <input
                  type="text"
                  className="flex-1 bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-white text-sm focus:outline-none focus:border-sky-500"
                  placeholder="Room title"
                  value={roomTitleDraft}
                  onChange={(e) => setRoomTitleDraft(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && roomTitleDraft.trim() && renameRoom(myRooms.teamMeetingId!, roomTitleDraft.trim())}
                  autoFocus
                />
                <button
                  className="px-3 py-1.5 bg-sky-600 hover:bg-sky-500 rounded text-white text-xs disabled:opacity-40"
                  disabled={savingTitle || !roomTitleDraft.trim()}
                  onClick={() => renameRoom(myRooms.teamMeetingId!, roomTitleDraft.trim())}
                >
                  {savingTitle ? '…' : 'Save'}
                </button>
                <button
                  className="px-2 py-1.5 text-slate-500 hover:text-white text-xs"
                  onClick={() => setEditingRoomTitle(null)}
                >
                  ✕
                </button>
              </div>
            )}
          </div>
        ) : (
          <button
            className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded text-white text-sm w-full max-w-sm disabled:opacity-40"
            disabled={provisioningRooms}
            onClick={provisionRooms}
          >
            {provisioningRooms ? 'Setting up…' : '🔧 Set Up My Permanent Rooms'}
          </button>
        )}

        {/* Waiting Room & Screen Settings */}
        {(myRooms.personalMeetingId || myRooms.teamMeetingId) && (
          <div className="w-full max-w-sm flex flex-col gap-2">
            {/* Waiting Room Toggle */}
            <div className="flex items-center justify-between bg-slate-800/50 border border-slate-700 rounded-lg px-3 py-2.5">
              <div className="flex items-center gap-2">
                <span className="text-sm">🖐</span>
                <div>
                  <span className="text-sm text-slate-200">Waiting Room</span>
                  <p className="text-[10px] text-slate-500 mt-0.5">Approve guests before they join</p>
                </div>
              </div>
              <button
                className={`relative w-10 h-5 rounded-full transition-colors ${waitingRoomEnabled ? 'bg-emerald-600' : 'bg-slate-600'} disabled:opacity-40`}
                disabled={togglingWaitingRoom}
                onClick={toggleWaitingRoom}
                title={waitingRoomEnabled ? 'Disable waiting room' : 'Enable waiting room'}
              >
                <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${waitingRoomEnabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
              </button>
            </div>
            {waitingRoomEnabled && (
              <div className="flex items-start gap-2 bg-amber-900/30 border border-amber-700/50 rounded-lg px-3 py-2 text-[11px] text-amber-300">
                <span className="mt-0.5 shrink-0">⚠️</span>
                <span>
                  <strong>Important:</strong> Guests will only be held in the waiting room if you <strong>join your meeting first</strong>. Start your meeting, then share the invite link.
                </span>
              </div>
            )}

            {/* Waiting Screen Customization */}
            <button
              className="w-full text-left text-sm text-slate-400 hover:text-white flex items-center gap-2 py-1"
              onClick={() => setEditingWaitingScreen(!editingWaitingScreen)}
            >
              <span>{editingWaitingScreen ? '▾' : '▸'}</span>
              <span>🖼️ Waiting Screen Settings</span>
              {(waitingTitle || waitingImage) && !editingWaitingScreen && (
                <span className="text-xs text-sky-400 ml-auto">configured</span>
              )}
            </button>
            {editingWaitingScreen && (
              <div className="flex flex-col gap-3 mt-2 bg-slate-800/50 border border-slate-700 rounded-lg p-3">
                <p className="text-xs text-slate-400">Customize what guests see while joining your room</p>
                <div>
                  <label className="text-xs text-slate-400 block mb-1">Title</label>
                  <input
                    type="text"
                    className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-white text-sm focus:outline-none focus:border-sky-500"
                    placeholder="e.g. Welcome to my meeting"
                    value={waitingTitle}
                    onChange={(e) => setWaitingTitle(e.target.value)}
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-400 block mb-1">Image URL</label>
                  <input
                    type="url"
                    className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-white text-sm focus:outline-none focus:border-sky-500"
                    placeholder="https://example.com/my-logo.png"
                    value={waitingImage}
                    onChange={(e) => setWaitingImage(e.target.value)}
                  />
                </div>
                {/* Preview */}
                {(waitingTitle || waitingImage) && (
                  <div className="flex flex-col items-center gap-2 bg-slate-900 rounded-lg p-4 border border-slate-700">
                    <p className="text-[10px] text-slate-500 mb-1">Preview</p>
                    {waitingImage && (
                      <img
                        src={waitingImage}
                        alt="Waiting screen preview"
                        className="w-16 h-16 rounded-xl object-cover"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                      />
                    )}
                    {waitingTitle && <p className="text-sm font-medium text-slate-200">{waitingTitle}</p>}
                    <p className="text-[10px] text-slate-500">Hosted by {displayName || 'you'}</p>
                  </div>
                )}
                <div className="flex gap-2 justify-end">
                  <button
                    className="px-3 py-1.5 text-slate-500 hover:text-white text-xs"
                    onClick={() => setEditingWaitingScreen(false)}
                  >
                    Cancel
                  </button>
                  <button
                    className="px-4 py-1.5 bg-sky-600 hover:bg-sky-500 rounded text-white text-xs disabled:opacity-40"
                    disabled={savingWaitingScreen}
                    onClick={saveWaitingScreen}
                  >
                    {savingWaitingScreen ? 'Saving…' : 'Save'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Create Meeting */}
        <button
          className="px-6 py-3 bg-emerald-600 hover:bg-emerald-500 rounded-lg text-white font-medium disabled:opacity-40 w-full max-w-sm"
          disabled={joining}
          onClick={createMeeting}
        >
          {joining && !manualMeetingId.trim() ? 'Creating…' : '+ Create Meeting'}
        </button>

        {/* Invite link (shown after creating) */}
        {inviteLink && (
          <div className="flex flex-col gap-2 w-full max-w-sm bg-slate-800 border border-slate-600 rounded-lg p-3">
            <p className="text-xs text-slate-400">Share this link to invite others:</p>
            <div className="flex gap-2 items-center">
              <input
                type="text"
                readOnly
                aria-label="Invite link"
                value={inviteLink}
                className="flex-1 bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-white text-xs font-mono focus:outline-none select-all"
                onFocus={(e) => e.target.select()}
              />
              <button
                className="px-3 py-1.5 bg-sky-600 hover:bg-sky-500 rounded text-white text-xs whitespace-nowrap"
                onClick={copyInviteLink}
              >
                {copied ? '✓ Copied' : 'Copy'}
              </button>
            </div>
          </div>
        )}

        {/* Divider */}
        <div className="flex items-center w-full max-w-sm gap-3">
          <div className="flex-1 h-px bg-slate-700" />
          <span className="text-slate-500 text-xs">or join an existing meeting</span>
          <div className="flex-1 h-px bg-slate-700" />
        </div>

        {/* Join existing */}
        <div className="flex gap-2 w-full max-w-sm">
          <input
            type="text"
            className="flex-1 bg-slate-800 border border-slate-600 rounded px-3 py-2 text-white text-sm placeholder-slate-500 focus:outline-none focus:border-sky-500"
            placeholder="Meeting ID"
            value={manualMeetingId}
            onChange={(e) => setManualMeetingId(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && manualMeetingId.trim() && !joining && joinByMeetingId(manualMeetingId.trim())}
          />
          <button
            className="px-4 py-2 bg-sky-600 hover:bg-sky-500 rounded text-white text-sm disabled:opacity-40"
            disabled={!manualMeetingId.trim() || joining}
            onClick={() => joinByMeetingId(manualMeetingId.trim())}
          >
            {joining && manualMeetingId.trim() ? 'Joining…' : 'Join'}
          </button>
        </div>

        {/* Past Meetings */}
        <div className="flex items-center w-full max-w-sm gap-3 mt-2">
          <div className="flex-1 h-px bg-slate-700" />
          <span className="text-slate-500 text-xs">past meetings</span>
          <div className="flex-1 h-px bg-slate-700" />
        </div>

        <div className="w-full max-w-sm">
          <button
            className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded text-white text-sm w-full disabled:opacity-40"
            disabled={loadingMeetings}
            onClick={fetchMeetings}
          >
            {loadingMeetings ? 'Loading…' : '↻ Load Meetings'}
          </button>

          {pastMeetings.length > 0 && (
            <div className="mt-3 flex flex-col gap-2 max-h-60 overflow-y-auto">
              {pastMeetings.map((m: any) => (
                <div key={m.id} className={`flex items-center gap-2 rounded px-3 py-2 border ${
                  m.status === 'INACTIVE' ? 'bg-slate-900 border-slate-800 opacity-60' : 'bg-slate-800 border-slate-700'
                }`}>
                  <div className="flex-1 min-w-0">
                    <p className="text-white text-xs font-mono truncate">{m.id}</p>
                    <div className="flex items-center gap-2">
                      {m.title && <span className="text-slate-400 text-xs">{m.title}</span>}
                      <span className={`text-xs ${m.status === 'INACTIVE' ? 'text-red-400' : 'text-green-400'}`}>
                        {m.status === 'INACTIVE' ? '● Closed' : '● Active'}
                      </span>
                    </div>
                    {m.created_at && <p className="text-slate-500 text-xs">{new Date(m.created_at).toLocaleString()}</p>}
                  </div>
                  {m.status !== 'INACTIVE' && (
                    <button
                      className="px-2 py-1 bg-sky-700 hover:bg-sky-600 rounded text-white text-xs whitespace-nowrap"
                      onClick={() => joinByMeetingId(m.id)}
                      disabled={joining}
                    >
                      Join
                    </button>
                  )}
                  {m.status !== 'INACTIVE' && (
                    <button
                      className="px-2 py-1 bg-red-700 hover:bg-red-600 rounded text-white text-xs whitespace-nowrap disabled:opacity-40"
                      onClick={() => closeMeeting(m.id)}
                      disabled={deletingId === m.id}
                    >
                      {deletingId === m.id ? '…' : 'Close'}
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
        </div>
        )}

        {/* ─── Recordings Tab ─── */}
        {lobbyTab === 'recordings' && (
        <div className="flex-1 overflow-y-auto p-4">
          <div className="max-w-4xl mx-auto">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h1 className="text-xl font-semibold text-white">Recordings</h1>
                <p className="text-slate-400 text-sm">Play, transcribe and manage your meeting recordings.</p>
              </div>
              <div className="flex gap-2">
                {recordings.some((r: any) => r.source === 'realtimekit') && (
                  <button
                    className="px-3 py-2 bg-amber-700 hover:bg-amber-600 rounded text-white text-xs disabled:opacity-40"
                    disabled={syncingRecordings}
                    onClick={syncRecordingsToR2}
                  >
                    {syncingRecordings ? 'Syncing…' : '☁️→💾 Sync to R2'}
                  </button>
                )}
                <button
                  className="px-3 py-2 bg-slate-700 hover:bg-slate-600 rounded text-white text-xs disabled:opacity-40"
                  disabled={loadingRecordings}
                  onClick={fetchRecordings}
                >
                  {loadingRecordings ? 'Loading…' : '↻ Refresh'}
                </button>
              </div>
            </div>

            {recordings.length === 0 && !loadingRecordings && (
              <div className="text-center py-16 text-slate-500">
                <p className="text-4xl mb-3">🎬</p>
                <p>No recordings yet. Record a meeting to see it here.</p>
              </div>
            )}

            {loadingRecordings && (
              <div className="text-center py-16 text-slate-400">
                <div className="w-6 h-6 border-2 border-sky-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
                <p className="text-sm">Loading recordings…</p>
              </div>
            )}

            <div className="grid gap-4">
              {recordings.map((rec: any) => {
                const isSuperadmin = readStoredUser()?.role === 'Superadmin';
                const sizeStr = rec.size > 1024 * 1024
                  ? `${(rec.size / (1024 * 1024)).toFixed(1)} MB`
                  : `${(rec.size / 1024).toFixed(0)} KB`;
                const videoUrl = getVideoUrl(rec);
                const isPlaying = playingKey === rec.key;
                const isR2 = rec.source !== 'realtimekit';

                return (
                  <div key={rec.key} className="bg-slate-800 border border-slate-700 rounded-lg overflow-hidden">
                    {/* Video player / thumbnail area */}
                    <div className="relative bg-black">
                      {isPlaying && videoUrl ? (
                        <video
                          className="w-full max-h-[400px]"
                          src={videoUrl}
                          controls
                          autoPlay
                          onEnded={() => setPlayingKey(null)}
                        />
                      ) : (
                        <button
                          className="w-full flex items-center justify-center py-12 bg-slate-900 hover:bg-slate-800 transition-colors group"
                          onClick={() => setPlayingKey(rec.key)}
                          title="Play recording"
                        >
                          <div className="flex flex-col items-center gap-2">
                            <div className="w-14 h-14 rounded-full bg-white/10 group-hover:bg-white/20 flex items-center justify-center transition-colors">
                              <span className="text-2xl ml-1">▶</span>
                            </div>
                            <span className="text-slate-400 text-xs group-hover:text-white transition-colors">Click to play</span>
                          </div>
                        </button>
                      )}
                      {rec.source === 'realtimekit' && (
                        <div className="absolute top-2 right-2 bg-amber-600/80 rounded px-2 py-0.5 text-xs text-white">
                          ☁️ cloud
                        </div>
                      )}
                    </div>

                    {/* Recording info & actions */}
                    <div className="p-3">
                      <div className="flex items-start gap-3">
                        <div className="flex-1 min-w-0">
                          <p className="text-white text-sm font-medium truncate" title={rec.name}>{rec.name}</p>
                          <div className="flex items-center gap-3 mt-1 flex-wrap">
                            <span className="text-slate-500 text-xs">{sizeStr}</span>
                            {rec.uploaded && <span className="text-slate-500 text-xs">{new Date(rec.uploaded).toLocaleString()}</span>}
                            {rec.duration != null && <span className="text-slate-500 text-xs">{Math.floor(rec.duration / 60)}:{String(Math.floor(rec.duration % 60)).padStart(2, '0')}</span>}
                            {rec.meetingTitle && <span className="text-slate-400 text-xs">📹 {rec.meetingTitle}</span>}
                            {rec.error && <span className="text-red-400 text-xs" title={rec.error}>⚠️ R2 failed</span>}
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          <button
                            className="px-2.5 py-1.5 bg-slate-700 hover:bg-slate-600 rounded text-white text-xs"
                            onClick={() => setPlayingKey(isPlaying ? null : rec.key)}
                            title={isPlaying ? 'Close player' : 'Play'}
                          >
                            {isPlaying ? '⏹' : '▶'}
                          </button>
                          <button
                            className="px-2.5 py-1.5 bg-sky-700 hover:bg-sky-600 rounded text-white text-xs"
                            onClick={() => downloadRecording(rec)}
                            title="Download"
                          >
                            ⬇
                          </button>
                          {isR2 && (
                            <button
                              className="px-2.5 py-1.5 bg-purple-700 hover:bg-purple-600 rounded text-white text-xs disabled:opacity-40"
                              onClick={() => transcribeRecording(rec.key)}
                              disabled={transcribingKey === rec.key}
                              title="Transcribe with Whisper"
                            >
                              {transcribingKey === rec.key
                                ? (transcribeProgress ? `⏳ ${transcribeProgress.current}/${transcribeProgress.total}` : '⏳')
                                : '📝 Transcribe'}
                            </button>
                          )}
                          {isSuperadmin && (
                            <>
                              <button
                                className="px-2 py-1.5 text-slate-400 hover:text-white text-xs"
                                title="Rename"
                                onClick={() => { setRenamingKey(rec.key); setRenameDraft(rec.name); }}
                              >
                                ✏️
                              </button>
                              <button
                                className="px-2 py-1.5 bg-red-700 hover:bg-red-600 rounded text-white text-xs disabled:opacity-40"
                                onClick={() => deleteRecording(rec.key)}
                                disabled={deletingKey === rec.key}
                                title="Delete"
                              >
                                {deletingKey === rec.key ? '…' : '🗑'}
                              </button>
                            </>
                          )}
                        </div>
                      </div>

                      {/* Rename inline */}
                      {renamingKey === rec.key && (
                        <div className="flex gap-2 mt-2">
                          <input
                            type="text"
                            className="flex-1 bg-slate-900 border border-slate-600 rounded px-2 py-1 text-white text-xs focus:outline-none focus:border-sky-500"
                            value={renameDraft}
                            onChange={(e) => setRenameDraft(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && renameDraft.trim() && renameRecording(rec.key, renameDraft.trim())}
                            autoFocus
                          />
                          <button
                            className="px-2 py-1 bg-sky-600 hover:bg-sky-500 rounded text-white text-xs"
                            onClick={() => renameRecording(rec.key, renameDraft.trim())}
                            disabled={!renameDraft.trim()}
                          >
                            Save
                          </button>
                          <button
                            className="px-2 py-1 text-slate-500 hover:text-white text-xs"
                            onClick={() => setRenamingKey(null)}
                          >
                            ✕
                          </button>
                        </div>
                      )}

                      {/* Transcript area — large, copyable */}
                      {transcripts[rec.key] && (
                        <div className="mt-3 border border-slate-600 rounded-lg overflow-hidden">
                          <div className="flex items-center justify-between bg-slate-700/50 px-3 py-2">
                            <span className="text-purple-400 text-xs font-medium">📝 Transcript</span>
                            <div className="flex items-center gap-2">
                              <button
                                className="px-2 py-1 bg-slate-600 hover:bg-slate-500 rounded text-white text-xs"
                                onClick={() => copyTranscript(rec.key)}
                              >
                                {copiedTranscript === rec.key ? '✓ Copied' : '📋 Copy'}
                              </button>
                              <button
                                className="text-slate-400 hover:text-white text-xs px-1"
                                onClick={() => setTranscripts(prev => { const n = { ...prev }; delete n[rec.key]; return n; })}
                              >
                                ✕
                              </button>
                            </div>
                          </div>
                          <textarea
                            className="w-full bg-slate-900 text-slate-200 text-sm p-3 resize-y focus:outline-none border-0"
                            readOnly
                            rows={Math.min(Math.max(transcripts[rec.key].split('\n').length + 1, 4), 20)}
                            value={transcripts[rec.key]}
                            onFocus={(e) => e.target.select()}
                          />
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
        )}

      </div>
    );
  }

  // Waiting for host to start the meeting (waiting room is ON but host isn't in the meeting yet)
  if (waitingForHost && !meeting) {
    const wsTitle = waitingScreenInfo?.waitingTitle || waitingScreenInfo?.meetingTitle;
    const wsHost = waitingScreenInfo?.hostName;
    const wsImage = waitingScreenInfo?.waitingImage;
    return (
      <div className="flex flex-col items-center justify-center h-full gap-6 text-slate-200 p-8">
        {wsImage && (
          <img src={wsImage} alt={wsTitle || 'Meeting'} className="w-32 h-32 rounded-2xl object-cover shadow-lg shadow-sky-900/30" />
        )}
        <div className="text-center">
          {wsTitle && <h1 className="text-2xl font-semibold mb-1">{wsTitle}</h1>}
          <p className="text-lg font-medium">Waiting for host to start the meeting</p>
          {wsHost && <p className="text-sm text-slate-400 mt-2">Hosted by <span className="text-slate-200">{wsHost}</span></p>}
          <p className="text-xs text-slate-500 mt-3">The meeting hasn't started yet. The host will let you in once they join.</p>
        </div>
        <button
          onClick={checkHostAndJoin}
          disabled={checkingHost}
          className="px-5 py-2 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 rounded text-white font-medium flex items-center gap-2"
        >
          {checkingHost ? (
            <><span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Checking…</>
          ) : (
            '🔄 Check Again'
          )}
        </button>
      </div>
    );
  }

  // Meeting not initialized yet — show waiting screen
  if (!meeting) {
    const wsTitle = waitingScreenInfo?.waitingTitle || waitingScreenInfo?.meetingTitle;
    const wsHost = waitingScreenInfo?.hostName;
    const wsImage = waitingScreenInfo?.waitingImage;

    return (
      <div className="flex flex-col items-center justify-center h-full gap-6 text-slate-200 p-8">
        {wsImage && (
          <img
            src={wsImage}
            alt={wsTitle || 'Meeting'}
            className="w-32 h-32 rounded-2xl object-cover shadow-lg shadow-sky-900/30"
          />
        )}
        <div className="text-center">
          {wsTitle ? (
            <h1 className="text-2xl font-semibold">{wsTitle}</h1>
          ) : (
            <p className="text-lg font-medium">Connecting to meeting…</p>
          )}
          {wsHost && (
            <p className="text-sm text-slate-400 mt-2">Hosted by <span className="text-slate-200">{wsHost}</span></p>
          )}
        </div>
        <div className="w-10 h-10 border-4 border-sky-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-sm text-slate-500">Setting up your session</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col w-full h-full">
      {inviteLink && (
        <div className="flex items-center gap-2 px-3 py-2 bg-slate-800 border-b border-slate-700 text-sm">
          <span className="text-slate-400 text-xs whitespace-nowrap">Invite link:</span>
          <input
            type="text"
            readOnly
            aria-label="Invite link"
            value={inviteLink}
            className="flex-1 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-white text-xs font-mono focus:outline-none select-all min-w-0"
            onFocus={(e) => e.target.select()}
          />
          <button
            className="px-3 py-1 bg-sky-600 hover:bg-sky-500 rounded text-white text-xs whitespace-nowrap"
            onClick={copyInviteLink}
          >
            {copied ? '✓ Copied' : 'Copy'}
          </button>
          <button
            className="px-2 py-1 text-slate-500 hover:text-white text-xs"
            onClick={() => setInviteLink(null)}
            title="Dismiss"
          >
            ✕
          </button>
        </div>
      )}
      <div className="flex-1 min-h-0">
        <RealtimeKitProvider value={meeting}>
          <RtkUiProvider meeting={meeting} showSetupScreen>
            <Meeting />
            <RtkDialogManager />
            <RtkSettings />
            <RtkParticipantsAudio />
          </RtkUiProvider>
        </RealtimeKitProvider>
      </div>
    </div>
  );
}

// ─── Auth gate ───────────────────────────────────────────────────────────────

function AuthGate({ children }: { children: React.ReactNode }) {
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [authStatus, setAuthStatus] = useState<'checking' | 'authed' | 'anonymous'>('checking');

  const setAuthCookie = (token: string) => {
    if (!token) return;
    const isVegvisr = window.location.hostname.endsWith('vegvisr.org');
    const domain = isVegvisr ? '; Domain=.vegvisr.org' : '';
    const maxAge = 60 * 60 * 24 * 30;
    document.cookie = `vegvisr_token=${encodeURIComponent(token)}; Path=/; Max-Age=${maxAge}; SameSite=Lax; Secure${domain}`;
  };

  const persistUser = (user: {
    email: string;
    role: string;
    user_id: string | null;
    emailVerificationToken: string | null;
    oauth_id?: string | null;
    displayName?: string | null;
  }) => {
    const payload = {
      email: user.email,
      role: user.role,
      user_id: user.user_id,
      oauth_id: user.oauth_id || user.user_id || null,
      emailVerificationToken: user.emailVerificationToken,
      displayName: user.displayName || null,
    };
    localStorage.setItem('user', JSON.stringify(payload));
    if (user.emailVerificationToken) setAuthCookie(user.emailVerificationToken);
    sessionStorage.setItem('email_session_verified', '1');
    setAuthUser({
      userId: payload.user_id || payload.oauth_id || '',
      email: payload.email,
      role: payload.role || null,
      displayName: payload.displayName,
    });
  };

  const fetchUserContext = async (targetEmail: string) => {
    const roleRes = await fetch(`${DASHBOARD_BASE}/get-role?email=${encodeURIComponent(targetEmail)}`);
    if (!roleRes.ok) throw new Error(`User role unavailable (status: ${roleRes.status})`);
    const roleData = await roleRes.json();
    if (!roleData?.role) throw new Error('Unable to retrieve user role.');
    const userDataRes = await fetch(`${DASHBOARD_BASE}/userdata?email=${encodeURIComponent(targetEmail)}`);
    if (!userDataRes.ok) throw new Error(`Unable to fetch user data (status: ${userDataRes.status})`);
    const userData = await userDataRes.json();
    return {
      email: targetEmail,
      role: roleData.role,
      user_id: userData.user_id,
      emailVerificationToken: userData.emailVerificationToken,
      oauth_id: userData.oauth_id,
    };
  };

  const verifyMagicToken = async (token: string) => {
    const res = await fetch(`${MAGIC_BASE}/login/magic/verify?token=${encodeURIComponent(token)}`);
    const data = await res.json();
    if (!res.ok || !data.success || !data.email) throw new Error(data.error || 'Invalid or expired magic link.');
    try {
      const userContext = await fetchUserContext(data.email);
      persistUser(userContext);
    } catch {
      persistUser({ email: data.email, role: 'user', user_id: data.email, emailVerificationToken: null });
    }
  };

  const clearAuthCookie = () => {
    const base = 'vegvisr_token=; Path=/; Max-Age=0; SameSite=Lax; Secure';
    document.cookie = base;
    if (window.location.hostname.endsWith('vegvisr.org')) {
      document.cookie = `${base}; Domain=.vegvisr.org`;
    }
  };

  const handleLogout = () => {
    try {
      localStorage.removeItem('user');
      sessionStorage.removeItem('email_session_verified');
    } catch { /* ignore */ }
    clearAuthCookie();
    setAuthUser(null);
    setAuthStatus('anonymous');
  };

  useEffect(() => {
    const url = new URL(window.location.href);
    const magic = url.searchParams.get('magic');
    if (!magic) return;
    setAuthStatus('checking');
    verifyMagicToken(magic)
      .then(() => {
        url.searchParams.delete('magic');
        window.history.replaceState({}, '', url.toString());
        setAuthStatus('authed');
      })
      .catch(() => setAuthStatus('anonymous'));
  }, []);

  useEffect(() => {
    let isMounted = true;
    const stored = readStoredUser();
    if (stored && isMounted) {
      setAuthUser(stored);
      setAuthStatus('authed');
    } else if (isMounted) {
      setAuthStatus('anonymous');
    }
    return () => { isMounted = false; };
  }, []);

  if (authStatus === 'authed') {
    return (
      <AuthContext.Provider value={authUser}>
        <div className="flex flex-col h-screen bg-slate-950 text-white">
          <div className="flex-shrink-0 border-b border-slate-800 bg-slate-900 px-4 py-2 flex items-center justify-between">
            <EcosystemNav />
            <AuthBar
              userEmail={authUser?.email}
              badgeLabel="Vegvisr"
              signInLabel="Sign in"
              logoutLabel="Log out"
              onLogout={handleLogout}
            />
          </div>
          <div className="flex-1 min-h-0">
            {children}
          </div>
        </div>
      </AuthContext.Provider>
    );
  }

  if (authStatus === 'anonymous') {
    return <Login />;
  }

  // checking state — spinner
  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-sky-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

// ─── Root ─────────────────────────────────────────────────────────────────────

export function useAuth() {
  return useContext(AuthContext);
}

export default function App() {
  return (
    <AuthGate>
      <RealtimeMeeting />
    </AuthGate>
  );
}
