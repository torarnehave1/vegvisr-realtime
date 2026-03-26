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
  RtkEndedScreen,
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
  const canRecord = useRealtimeKitSelector((m) => m.self.permissions.canRecord);

  const [states, updateStates] = useReducer(
    (state: any, payload: any) => ({ ...state, ...payload }),
    { meeting: 'joined', activeSidebar: false },
  );

  const [recordingState, setRecordingState] = useState<string>('IDLE');
  const [recordingBusy, setRecordingBusy] = useState(false);

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
  const isStarting = recordingState === 'STARTING';
  const isStopping = recordingState === 'STOPPING';

  const toggleRecording = useCallback(async () => {
    if (!meeting?.recording) return;
    setRecordingBusy(true);
    try {
      if (isRecording) {
        await meeting.recording.stop();
      } else {
        await meeting.recording.start();
      }
    } catch (err: any) {
      console.error('Recording error:', err);
    } finally {
      setRecordingBusy(false);
    }
  }, [meeting, isRecording]);

  if (!meeting) return <RtkSpinner />;
  if (roomState === 'ended' || roomState === 'left') return <RtkEndedScreen />;
  if (!roomJoined) return <RtkSetupScreen meeting={meeting} />;

  return (
    <div
      className="flex flex-col w-full h-full"
      ref={(el) => {
        el?.addEventListener('rtkStateUpdate', (e: any) => updateStates(e.detail));
      }}
    >
      {/* Recording warning banner */}
      {(isRecording || isStarting) && (
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
      </header>
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
            <button
              className={`px-3 py-1.5 rounded text-xs font-medium transition-colors disabled:opacity-40 ${
                isRecording
                  ? 'bg-red-600 hover:bg-red-500 text-white'
                  : 'bg-slate-700 hover:bg-slate-600 text-slate-200'
              }`}
              disabled={recordingBusy || isStarting || isStopping}
              onClick={toggleRecording}
              title={isRecording ? 'Stop recording' : 'Start recording'}
            >
              {isStarting ? '⏳ Starting…' : isStopping ? '⏳ Stopping…' : isRecording ? '⏹ Stop Rec' : '⏺ Record'}
            </button>
          )}
        </div>
        <div className="flex flex-1" />
      </footer>
    </div>
  );
}

function RealtimeMeeting() {
  const [meeting, initMeeting] = useRealtimeKitClient();
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [noParams, setNoParams] = useState(false);
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
      await initMeeting({ authToken: data.authToken, defaults: { audio: false, video: false } });
      setNoParams(false);
    } catch (err: any) {
      setTokenError(err.message);
    } finally {
      setJoining(false);
    }
  };

  const joinByMeetingId = (id: string) => fetchTokenAndJoin(id);

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

    // Meeting ID in URL — fetch a fresh participant token from the backend.
    if (meetingId) {
      const stored = readStoredUser();
      if (!stored?.emailVerificationToken) {
        setTokenError('You must be logged in to join this meeting.');
        return;
      }
      fetch('https://api.vegvisr.org/realtime/join-token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Token': stored.emailVerificationToken,
        },
        body: JSON.stringify({
          meetingId,
          clientData: {
            customParticipantId: stored.email,
            name: displayName.trim() || stored.email.split('@')[0],
          },
        }),
      })
        .then((r) => r.json())
        .then(async (data) => {
          if (!data.authToken) throw new Error(data.error || 'No token returned from server');
          await initMeeting({ authToken: data.authToken, defaults: { audio: false, video: false } });
        })
        .catch((err) => setTokenError(err.message));
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
      <div className="flex flex-col items-center justify-center h-full gap-6 p-8">
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

        {/* Recordings */}
        <div className="flex items-center w-full max-w-sm gap-3 mt-2">
          <div className="flex-1 h-px bg-slate-700" />
          <span className="text-slate-500 text-xs">recordings</span>
          <div className="flex-1 h-px bg-slate-700" />
        </div>

        <div className="w-full max-w-sm">
          <button
            className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded text-white text-sm w-full disabled:opacity-40"
            disabled={loadingRecordings}
            onClick={fetchRecordings}
          >
            {loadingRecordings ? 'Loading…' : '🎬 Load Recordings'}
          </button>

          {recordings.some((r: any) => r.source === 'realtimekit') && (
            <button
              className="px-4 py-2 bg-amber-700 hover:bg-amber-600 rounded text-white text-sm w-full disabled:opacity-40 mt-2"
              disabled={syncingRecordings}
              onClick={syncRecordingsToR2}
            >
              {syncingRecordings ? 'Syncing…' : '☁️→💾 Sync Cloud Recordings to R2'}
            </button>
          )}

          {recordings.length > 0 && (
            <div className="mt-3 flex flex-col gap-2 max-h-72 overflow-y-auto">
              {recordings.map((rec: any) => {
                const isSuperadmin = readStoredUser()?.role === 'Superadmin';
                const sizeStr = rec.size > 1024 * 1024
                  ? `${(rec.size / (1024 * 1024)).toFixed(1)} MB`
                  : `${(rec.size / 1024).toFixed(0)} KB`;
                return (
                  <div key={rec.key} className="flex flex-col gap-1 bg-slate-800 border border-slate-700 rounded px-3 py-2">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-white text-sm truncate" title={rec.name}>{rec.name}</p>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-slate-500 text-xs">{sizeStr}</span>
                          {rec.uploaded && <span className="text-slate-500 text-xs">{new Date(rec.uploaded).toLocaleString()}</span>}
                          {rec.duration != null && <span className="text-slate-500 text-xs">{rec.duration.toFixed(1)}s</span>}
                          {rec.meetingTitle && <span className="text-slate-400 text-xs">📹 {rec.meetingTitle}</span>}
                          {rec.source === 'realtimekit' && <span className="text-amber-400 text-xs">☁️ cloud</span>}
                          {rec.error && <span className="text-red-400 text-xs" title={rec.error}>⚠️ R2 failed</span>}
                        </div>
                      </div>
                      <button
                        className="px-2 py-1 bg-sky-700 hover:bg-sky-600 rounded text-white text-xs whitespace-nowrap"
                        onClick={() => downloadRecording(rec)}
                        title="Download"
                      >
                        ⬇
                      </button>
                      {isSuperadmin && (
                        <>
                          <button
                            className="px-2 py-1 text-slate-400 hover:text-white text-xs"
                            title="Rename"
                            onClick={() => { setRenamingKey(rec.key); setRenameDraft(rec.name); }}
                          >
                            ✏️
                          </button>
                          <button
                            className="px-2 py-1 bg-red-700 hover:bg-red-600 rounded text-white text-xs whitespace-nowrap disabled:opacity-40"
                            onClick={() => deleteRecording(rec.key)}
                            disabled={deletingKey === rec.key}
                            title="Delete"
                          >
                            {deletingKey === rec.key ? '…' : '🗑'}
                          </button>
                        </>
                      )}
                    </div>
                    {renamingKey === rec.key && (
                      <div className="flex gap-2 mt-1">
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
                  </div>
                );
              })}
            </div>
          )}
        </div>
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
