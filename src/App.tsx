import React, { useState, useEffect, createContext, useContext } from 'react';
import {
  RealtimeKitProvider,
  useRealtimeKitClient,
} from '@cloudflare/realtimekit-react';
import {
  RtkCameraToggle,
  RtkChatToggle,
  RtkDialogManager,
  RtkGrid,
  RtkParticipantTile,
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
  provideRtkDesignSystem,
} from '@cloudflare/realtimekit-react-ui';
import { AuthBar, ScreenRecorder } from 'vegvisr-ui-kit';
import { readStoredUser, type AuthUser } from './lib/auth';
import { Login } from './components/Login';
import { WaitingRoomPanel } from './components/WaitingRoomPanel';
import { AccessDeniedPage } from './components/AccessDeniedPage';
import { SlugManagement } from './components/SlugManagement';
import { SlugJoinPrompt } from './components/SlugJoinPrompt';
import { SpeakerView } from './components/SpeakerView';
import ParticipantsPanel from './components/ParticipantsPanel';
import ImpersonationBar from './components/ImpersonationBar';
import { useMeetingSession } from './hooks/useMeetingSession';
import { config } from './lib/rtkConfig';
import { MobileMeeting } from './components/MobileMeeting';
import { useIsMobile } from './hooks/useIsMobile';

const MAGIC_BASE = 'https://cookie.vegvisr.org';
const DASHBOARD_BASE = 'https://dashboard.vegvisr.org';

const AuthContext = createContext<AuthUser | null>(null);

type StandardRoom = {
  id: string;
  kind?: string | null;
  title?: string | null;
};

type MyRoomsState = {
  personalMeetingId: string | null;
  teamMeetingId: string | null;
  standardRooms: StandardRoom[];
};

const normalizeRole = (role: string | null | undefined) =>
  (role || '').trim().toLowerCase().replace(/[\s_-]+/g, '');

const canRoleManageMeetings = (role: string | null | undefined) => {
  const normalized = normalizeRole(role);
  return normalized === 'admin' || normalized === 'superadmin';
};

const normalizeStandardRooms = (data: any): StandardRoom[] => {
  const source = Array.isArray(data?.standardRooms)
    ? data.standardRooms
    : Array.isArray(data?.rooms)
      ? data.rooms
      : [];

  const seen = new Set<string>();
  const rooms: StandardRoom[] = [];

  for (const room of source) {
    const id = typeof room?.id === 'string'
      ? room.id
      : typeof room?.meetingId === 'string'
        ? room.meetingId
        : null;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    rooms.push({
      id,
      kind: typeof room?.kind === 'string' ? room.kind : null,
      title: typeof room?.title === 'string' ? room.title : null,
    });
  }

  const addLegacyRoom = (id: unknown, kind: string, title: unknown) => {
    if (typeof id !== 'string' || !id || seen.has(id)) return;
    seen.add(id);
    rooms.push({
      id,
      kind,
      title: typeof title === 'string' ? title : null,
    });
  };

  addLegacyRoom(data?.personalMeetingId, 'personal', data?.personalTitle);
  addLegacyRoom(data?.teamMeetingId, 'team', data?.teamTitle);

  return rooms;
};

// ─── Meeting UI ──────────────────────────────────────────────────────────────

function Meeting({ meetingId, isHost }: { meetingId: string; isHost: boolean }) {
  const {
    meeting,
    roomJoined,
    roomState,
    selfName,
    canRecord,
    viewMode,
    setViewMode,
    activeSpeakerId,
    meetingSeconds,
    fmtTime,
    isRecording,
    isPaused,
    isStarting,
    isStopping,
    recordingBusy,
    showRecordingBanner,
    recSeconds,
    toggleRecording,
    togglePauseRecording,
    waitingGuests,
    admitGuest,
    denyGuest,
    states,
    updateStates,
  } = useMeetingSession({ meetingId, isHost, allowDuo: false });

  // Drag state for the participants panel lives inside the panel itself now.
  const [showParticipants, setShowParticipants] = useState(false);

  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');

  // ── Music mode ──────────────────────────────────────────────────────────────
  // When enabled, the local mic is captured with noise suppression and
  // auto-gain turned OFF (these were the ones chopping music into pieces),
  // plus stereo ON. Echo cancellation stays ON so the speaker -> mic loop
  // doesn't bleed back to other participants when system audio is playing.
  const [musicMode, setMusicMode] = useState<boolean>(() => {
    try { return typeof window !== 'undefined' && localStorage.getItem('vegvisr-music-mode') === 'on'; }
    catch { return false; }
  });
  const [musicModeBusy, setMusicModeBusy] = useState(false);
  const [musicModeError, setMusicModeError] = useState<string | null>(null);

  const applyAudioConstraints = async (wantMusic: boolean) => {
    if (!meeting?.self) return;
    setMusicModeBusy(true);
    setMusicModeError(null);
    try {
      // Preserve the currently-selected mic device so toggling doesn't change source.
      const currentDeviceId = meeting.self.audioTrack?.getSettings?.()?.deviceId;
      const constraints: MediaTrackConstraints = wantMusic
        ? {
            // EC stays on — it removes the speaker -> mic loop without gating music.
            echoCancellation: true,
            // NS + AGC stay off — these are the ones that mistake music for noise.
            noiseSuppression: false,
            autoGainControl: false,
            channelCount: 2,
            // sampleRate hint; not all browsers honour it
            sampleRate: 48000,
          }
        : {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          };
      if (currentDeviceId) (constraints as any).deviceId = { exact: currentDeviceId };
      const stream = await navigator.mediaDevices.getUserMedia({ audio: constraints, video: false });
      const newTrack = stream.getAudioTracks()[0];
      if (!newTrack) throw new Error('No audio track obtained');
      // enableAudio with a custom track swaps the live mic source in-place.
      await meeting.self.enableAudio(newTrack);
    } catch (err: any) {
      setMusicModeError(err?.message || 'Could not switch audio mode');
      throw err;
    } finally {
      setMusicModeBusy(false);
    }
  };

  const toggleMusicMode = async () => {
    const next = !musicMode;
    setMusicMode(next);
    try { localStorage.setItem('vegvisr-music-mode', next ? 'on' : 'off'); } catch { /* ignore */ }
    // Only push new constraints if audio is currently enabled; otherwise the
    // toggle just stores the preference and the SDK will use its defaults next
    // time the mic is enabled.
    if (meeting?.self?.audioEnabled) {
      try { await applyAudioConstraints(next); } catch { setMusicMode(!next); }
    }
  };

  if (!meeting) return <RtkSpinner />;



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
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 text-slate-200">
        <div className="w-8 h-8 border-2 border-sky-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-sm text-slate-400">Joining…</p>
      </div>
    );
  }

  return (
    <div
      className="flex flex-col w-full h-full relative"
      ref={(el) => {
        el?.addEventListener('rtkStateUpdate', (e: any) => updateStates(e.detail));
      }}
    >
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
          {/* Single Participants button — opens combined Waiting Room +
              In-Meeting roster. Amber pulse when a host has guests knocking. */}
          <button
            className={`ml-2 px-2 py-1 rounded text-white text-xs font-medium ${
              isHost && waitingGuests.length > 0
                ? 'bg-amber-600 hover:bg-amber-500 animate-pulse'
                : 'bg-slate-600 hover:bg-slate-500'
            }`}
            onClick={() => setShowParticipants((v) => !v)}
            title={isHost ? 'Participants — admit guests, mute, stop video, send to waiting room' : 'Participants'}
          >
            👥{isHost && waitingGuests.length > 0 ? ` 🖐${waitingGuests.length}` : ''}
          </button>
        </div>
      </header>

      {/* ── Combined Participants + Waiting Room panel (single 👥 button) ──── */}
      {showParticipants && meeting && (
        <ParticipantsPanel
          meeting={meeting}
          isHost={isHost}
          waitingGuests={isHost ? waitingGuests : []}
          admitGuest={admitGuest}
          denyGuest={denyGuest}
          onClose={() => setShowParticipants(false)}
        />
      )}
      {/* ────────────────────────────────────────────────────────────────────── */}

      <main className="flex flex-1 p-2 min-h-0">
        {viewMode === 'speaker' ? (
          <SpeakerView
            meeting={meeting}
            config={config}
            states={states}
            activeSpeakerId={activeSpeakerId}
          />
        ) : (
          <RtkGrid meeting={meeting} config={config} />
        )}
        {states.activeSidebar && <RtkSidebar meeting={meeting} states={states} />}
      </main>
      <footer className="p-2 flex items-center w-full border-t border-slate-700">
        <div className="flex flex-1">
          {/* size="sm" tells RealtimeKit's controlbar button to hide the label
              (its internal CSS rule :host([size='sm']) .label { display: none }).
              Same prop set on every toggle below so the row is icon-only. */}
          <RtkLeaveButton size="sm" />
        </div>
        <div className="flex gap-2 justify-center flex-1">
          <RtkMicToggle meeting={meeting} size="sm" />
          <RtkCameraToggle meeting={meeting} size="sm" />
          {/* Screen-share hidden on mobile — Chrome on Android can't capture
              screen via getDisplayMedia anyway. Tailwind sm: = >=640px. */}
          <span className="hidden sm:inline-flex">
            <RtkScreenShareToggle meeting={meeting} size="sm" />
          </span>
          <RtkChatToggle meeting={meeting} size="sm" />
          {/* View toggle — Grid view <-> Speaker view */}
          <button
            type="button"
            onClick={() => setViewMode(viewMode === 'grid' ? 'speaker' : 'grid')}
            title={viewMode === 'grid' ? 'Switch to Speaker view' : 'Switch to Grid view'}
            aria-label={viewMode === 'grid' ? 'Switch to Speaker view' : 'Switch to Grid view'}
            className="p-2 rounded transition-colors bg-slate-700 hover:bg-slate-600 text-white flex items-center justify-center"
          >
            {viewMode === 'grid' ? (
              <>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <rect x="1" y="1" width="14" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
                  <rect x="1" y="12" width="4" height="3" rx="0.5" fill="currentColor" />
                  <rect x="6" y="12" width="4" height="3" rx="0.5" fill="currentColor" />
                  <rect x="11" y="12" width="4" height="3" rx="0.5" fill="currentColor" />
                </svg>
                <span className="sr-only">Switch to Speaker view</span>
              </>
            ) : (
              <>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <rect x="1" y="1" width="6" height="6" rx="0.5" fill="currentColor" />
                  <rect x="9" y="1" width="6" height="6" rx="0.5" fill="currentColor" />
                  <rect x="1" y="9" width="6" height="6" rx="0.5" fill="currentColor" />
                  <rect x="9" y="9" width="6" height="6" rx="0.5" fill="currentColor" />
                </svg>
                <span className="sr-only">Switch to Grid view</span>
              </>
            )}
          </button>
          {/* Music mode — disables voice processing so system audio (e.g. via
              BlackHole) reaches participants without being chopped up.
              Hidden on mobile per user request — niche desktop-only feature. */}
          <button
            type="button"
            onClick={toggleMusicMode}
            disabled={musicModeBusy}
            title={musicMode
              ? (musicModeError ? `Music mode on (last error: ${musicModeError})` : 'Music mode is ON — disable to use voice processing')
              : 'Music mode is OFF — enable for clean system-audio capture (e.g. via BlackHole)'}
            aria-pressed={musicMode}
            className={`hidden sm:flex p-2 rounded transition-colors text-white items-center justify-center disabled:opacity-50 ${
              musicMode ? 'bg-purple-600 hover:bg-purple-500' : 'bg-slate-700 hover:bg-slate-600'
            }`}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M6 12V4l7-1v8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              <circle cx="4.5" cy="12" r="1.5" fill="currentColor" />
              <circle cx="11.5" cy="11" r="1.5" fill="currentColor" />
            </svg>
            <span className="sr-only">{musicMode ? 'Music mode is on' : 'Music mode is off'}</span>
          </button>
          {/* Settings cog hidden on mobile (Tailwind `sm:` = >=640px).
              The Settings dialog is still reachable from the participant tile
              long-press; the footer cog just duplicates that on mobile. */}
          <span className="hidden sm:inline-flex">
            <RtkSettingsToggle size="sm" />
          </span>
          {/* Record button — host-only AND only on >= sm (640px). The phone
              is a poor recording surface (battery, audio path, background tab
              kills the meeting), so we hide it on mobile entirely. The
              isHost + canRecord gates remain for desktop. */}
          {canRecord && isHost && (
            <span className="hidden sm:inline-flex gap-2">
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
            </span>
          )}
        </div>
        <div className="flex flex-1" />
      </footer>

    </div>
  );
}

// ─── Guest Waiting Screen (polls DB until admitted/denied) ───────────────────

function GuestWaitingScreen({
  meetingId,
  waitingScreenInfo,
  onAdmitted,
  onDenied,
}: {
  meetingId: string;
  waitingScreenInfo: { meetingTitle?: string | null; hostName?: string | null; waitingImage?: string | null } | null;
  onAdmitted: () => void;
  onDenied: () => void;
}) {
  const stored = readStoredUser();
  const guestEmail = stored?.email ?? '';

  useEffect(() => {
    if (!guestEmail) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const r = await fetch(
          `https://api.vegvisr.org/realtime/waiting-room/status?meetingId=${encodeURIComponent(meetingId)}&guestEmail=${encodeURIComponent(guestEmail)}`
        );
        const data = await r.json();
        if (cancelled) return;
        if (data.status === 'admitted') { onAdmitted(); return; }
        if (data.status === 'denied') { onDenied(); return; }
      } catch { /* ignore */ }
      if (!cancelled) setTimeout(poll, 3000);
    };
    const id = setTimeout(poll, 2000); // first poll after 2s
    return () => { cancelled = true; clearTimeout(id); };
  }, [meetingId, guestEmail]);

  const info = waitingScreenInfo;
  return (
    <div className="flex flex-col items-center justify-center h-full gap-6 text-slate-200 p-8">
      <div className="w-full max-w-sm bg-slate-800 border border-slate-700 rounded-xl p-6 flex flex-col items-center gap-5 shadow-xl text-center">
        {info?.waitingImage && (
          <img src={info.waitingImage} alt="" className="w-24 h-24 rounded-xl object-cover shadow-lg" />
        )}
        <div>
          <h1 className="text-lg font-semibold">{info?.meetingTitle || 'Waiting to join…'}</h1>
          {info?.hostName && (
            <p className="text-sm text-slate-400 mt-1">Hosted by {info.hostName}</p>
          )}
        </div>
        <div className="w-10 h-10 border-4 border-sky-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-sm text-slate-400">Waiting for the host to let you in</p>
      </div>
    </div>
  );
}

function RealtimeMeeting() {
  const [meeting, initMeeting] = useRealtimeKitClient();
  const isMobile = useIsMobile();
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
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteSending, setInviteSending] = useState(false);
  const [inviteSent, setInviteSent] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [pastMeetings, setPastMeetings] = useState<any[]>([]);
  const [loadingMeetings, setLoadingMeetings] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [myRooms, setMyRooms] = useState<MyRoomsState>({ personalMeetingId: null, teamMeetingId: null, standardRooms: [] });
  const [provisioningRooms, setProvisioningRooms] = useState(false);
  const [editingRoomTitle, setEditingRoomTitle] = useState<string | null>(null);
  const [roomTitleDraft, setRoomTitleDraft] = useState('');
  const [savingTitle, setSavingTitle] = useState(false);
  const [roomTitles, setRoomTitles] = useState<Record<string, string>>({});
  const [recordings, setRecordings] = useState<any[]>([]);
  const [loadingRecordings, setLoadingRecordings] = useState(false);
  const [syncingRecordings, setSyncingRecordings] = useState(false);
  const [syncJobs, setSyncJobs] = useState<Array<{ jobId: string; fileName: string; status: string; message?: string | null }>>([]);
  const [superadmins, setSuperadmins] = useState<Array<{ email: string; userId?: string }>>([]);
  const [activeAccount, setActiveAccount] = useState<string>('');
  const [recordingsSort, setRecordingsSort] = useState<'date-desc' | 'date-asc' | 'name-asc' | 'name-desc'>('date-desc');
  const [recordingsSearch, setRecordingsSearch] = useState('');
  const [uploadingRecording, setUploadingRecording] = useState(false);
  const [uploadingRecordingProgress, setUploadingRecordingProgress] = useState<number | null>(null);
  const recordingUploadInputRef = React.useRef<HTMLInputElement | null>(null);
  const [renamingKey, setRenamingKey] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [editingMetadataKey, setEditingMetadataKey] = useState<string | null>(null);
  const [metadataDraft, setMetadataDraft] = useState<{ title: string; labels: string; thumbnailUrl: string }>({ title: '', labels: '', thumbnailUrl: '' });
  const [savingMetadataKey, setSavingMetadataKey] = useState<string | null>(null);
  const [deletingKey, setDeletingKey] = useState<string | null>(null);
  const [transcribingKey, setTranscribingKey] = useState<string | null>(null);
  const [transcripts, setTranscripts] = useState<Record<string, string>>({});
  const [transcribeProgress, setTranscribeProgress] = useState<{ current: number; total: number } | null>(null);
  const [extractingAudioKey, setExtractingAudioKey] = useState<string | null>(null);
  const [audioExtractError, setAudioExtractError] = useState<Record<string, string>>({});
  const [lobbyTab, setLobbyTab] = useState<'meetings' | 'recordings' | 'slugs'>('meetings');
  const [playingKey, setPlayingKey] = useState<string | null>(null);
  const [copiedTranscript, setCopiedTranscript] = useState<string | null>(null);
  const [waitingTitle, setWaitingTitle] = useState('');
  const [waitingImage, setWaitingImage] = useState('');
  const [savingWaitingScreen, setSavingWaitingScreen] = useState(false);
  const [editingWaitingScreen, setEditingWaitingScreen] = useState(false);
  const [waitingRoomEnabled, setWaitingRoomEnabled] = useState(false);
  const [togglingWaitingRoom, setTogglingWaitingRoom] = useState(false);
  const [pendingMeetingId, setPendingMeetingId] = useState<string | null>(null);
  // Custom slug state
  const [slugAccessDenied, setSlugAccessDenied] = useState<{ slug: string; ownerEmail: string } | null>(null);
  const [slugLoading, setSlugLoading] = useState(false);
  const [slugPrompt, setSlugPrompt] = useState<{ slug: string } | null>(null);
  const [slugPromptError, setSlugPromptError] = useState<string | null>(null);
  // Guest waiting room state
  const [guestWaiting, setGuestWaiting] = useState(false);
  const [guestDenied, setGuestDenied] = useState(false);
  const [knockingMeetingId, setKnockingMeetingId] = useState<string | null>(null);
  // Active meeting tracking (set after joining, used by Meeting component)
  const [activeMeetingId, setActiveMeetingId] = useState<string | null>(null);
  const [isCallHost, setIsCallHost] = useState(false);
  const [displayName, setDisplayName] = useState(() => {
    const stored = readStoredUser();
    if (!stored?.email) return '';
    if (stored.displayName) return stored.displayName;
    return stored.email.split('@')[0].replace(/[._-]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  });

  // Only Admin and Superadmin can create / own meeting rooms
  const canCreateMeetings = canRoleManageMeetings(readStoredUser()?.role);

  const standardRooms = myRooms.standardRooms;
  const hasStandardRooms = standardRooms.length > 0;

  const getRoomLabel = (room: StandardRoom, index: number) => {
    if (room.kind === 'personal') return '🏠 My Room';
    if (room.kind === 'team') return '👥 Team Room';
    return `🗂️ Room ${index + 1}`;
  };

  const getRoomButtonClass = (room: StandardRoom, index: number) => {
    if (room.kind === 'personal') return 'bg-violet-700 hover:bg-violet-600';
    if (room.kind === 'team') return 'bg-indigo-700 hover:bg-indigo-600';
    return index % 2 === 0 ? 'bg-cyan-700 hover:bg-cyan-600' : 'bg-emerald-700 hover:bg-emerald-600';
  };

  const getRoomSubtitleClass = (room: StandardRoom, index: number) => {
    if (room.kind === 'personal') return 'text-violet-200';
    if (room.kind === 'team') return 'text-indigo-200';
    return index % 2 === 0 ? 'text-cyan-200' : 'text-emerald-200';
  };

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
      setActiveMeetingId(meetingId);
      setIsCallHost(!!data.isOwner || presetName === 'group_call_host');
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

  const sendEmailInvite = async () => {
    if (!inviteEmail.trim() || !inviteLink) return;
    setInviteSending(true);
    setInviteError(null);
    try {
      const res = await fetch(`${MAGIC_BASE}/login/magic/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: inviteEmail.trim(), redirectUrl: inviteLink }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Failed to send invite');
      setInviteSent(true);
      setInviteEmail('');
      setTimeout(() => setInviteSent(false), 4000);
    } catch (err: any) {
      setInviteError(err.message);
    } finally {
      setInviteSending(false);
    }
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
        const normalizedRooms = normalizeStandardRooms(data);
        setMyRooms({
          personalMeetingId: data.personalMeetingId ?? null,
          teamMeetingId: data.teamMeetingId ?? null,
          standardRooms: normalizedRooms,
        });
        setRoomTitles(
          normalizedRooms.reduce<Record<string, string>>((acc, room) => {
            if (room.title) acc[room.id] = room.title;
            return acc;
          }, {})
        );
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
        const normalizedRooms = normalizeStandardRooms(data);
        setMyRooms({
          personalMeetingId: data.personalMeetingId ?? null,
          teamMeetingId: data.teamMeetingId ?? null,
          standardRooms: normalizedRooms,
        });
        setRoomTitles(
          normalizedRooms.reduce<Record<string, string>>((acc, room) => {
            if (room.title) acc[room.id] = room.title;
            return acc;
          }, {})
        );
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
        const nextTitle = typeof data.title === 'string' ? data.title : title;
        setRoomTitles((prev) => ({ ...prev, [meetingId]: nextTitle }));
        setMyRooms((prev) => ({
          ...prev,
          standardRooms: prev.standardRooms.map((room) =>
            room.id === meetingId ? { ...room, title: nextTitle } : room
          ),
        }));
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
      const target = activeAccount && activeAccount !== stored.email
        ? `?asUser=${encodeURIComponent(activeAccount)}`
        : '';
      const r = await fetch(`https://api.vegvisr.org/realtime/recordings${target}`, {
        headers: { 'X-API-Token': stored.emailVerificationToken },
      });
      const data = await r.json();
      if (data.success) setRecordings(data.recordings || []);
    } catch { /* ignore */ }
    finally { setLoadingRecordings(false); }
  };

  const uploadRecordingToR2 = async (file: File) => {
    const stored = readStoredUser();
    if (!stored?.emailVerificationToken) return;
    if (stored.role !== 'Superadmin') {
      alert('Only Superadmin users can upload videos to R2.');
      return;
    }
    setUploadingRecording(true);
    setUploadingRecordingProgress(0);
    let uploadSession: { uploadId: string; key: string; name: string; size: number; contentType: string } | null = null;
    try {
      const initResponse = await fetch('https://api.vegvisr.org/realtime/recordings/upload/init', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Token': stored.emailVerificationToken,
        },
        body: JSON.stringify({
          filename: file.name,
          contentType: file.type || 'video/mp4',
          size: file.size,
        }),
      });
      const initData = await initResponse.json();
      if (!initResponse.ok || !initData.success) {
        throw new Error(initData.error || `Upload init failed with status ${initResponse.status}`);
      }
      uploadSession = initData;
      const currentUpload = initData as {
        uploadId: string;
        key: string;
        name: string;
        size: number;
        contentType: string;
      };

      const chunkSize = 8 * 1024 * 1024;
      const parts: Array<{ partNumber: number; etag: string }> = [];
      const totalParts = Math.max(1, Math.ceil(file.size / chunkSize));

      for (let partNumber = 1; partNumber <= totalParts; partNumber += 1) {
        const start = (partNumber - 1) * chunkSize;
        const end = Math.min(file.size, start + chunkSize);
        const chunk = file.slice(start, end);
        const partResponse = await fetch(
          `https://api.vegvisr.org/realtime/recordings/upload/part?key=${encodeURIComponent(currentUpload.key)}&uploadId=${encodeURIComponent(currentUpload.uploadId)}&partNumber=${partNumber}`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/octet-stream',
              'X-API-Token': stored.emailVerificationToken,
            },
            body: chunk,
          }
        );
        const partData = await partResponse.json();
        if (!partResponse.ok || !partData.success || !partData.part?.etag) {
          throw new Error(partData.error || `Upload part ${partNumber} failed with status ${partResponse.status}`);
        }
        parts.push({ partNumber: Number(partData.part.partNumber), etag: String(partData.part.etag) });
        setUploadingRecordingProgress(Math.round((partNumber / totalParts) * 100));
      }

      const completeResponse = await fetch('https://api.vegvisr.org/realtime/recordings/upload/complete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Token': stored.emailVerificationToken,
        },
        body: JSON.stringify({
          key: currentUpload.key,
          uploadId: currentUpload.uploadId,
          parts,
          name: currentUpload.name,
          size: currentUpload.size,
          contentType: currentUpload.contentType,
        }),
      });
      const completeData = await completeResponse.json();
      if (!completeResponse.ok || !completeData.success) {
        throw new Error(completeData.error || `Upload complete failed with status ${completeResponse.status}`);
      }

      await fetchRecordings();
      alert(`Uploaded ${completeData.name || file.name} to R2.`);
    } catch (err: any) {
      if (uploadSession?.uploadId && uploadSession?.key) {
        try {
          await fetch('https://api.vegvisr.org/realtime/recordings/upload/abort', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-API-Token': stored.emailVerificationToken,
            },
            body: JSON.stringify({
              key: uploadSession.key,
              uploadId: uploadSession.uploadId,
            }),
          });
        } catch { /* ignore abort cleanup errors */ }
      }
      alert('Upload error: ' + err.message);
    } finally {
      setUploadingRecording(false);
      setUploadingRecordingProgress(null);
      if (recordingUploadInputRef.current) recordingUploadInputRef.current.value = '';
    }
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

  const startEditingRecordingMetadata = (rec: any) => {
    setEditingMetadataKey(rec.key);
    setMetadataDraft({
      title: rec.title || '',
      labels: Array.isArray(rec.labels) ? rec.labels.join(', ') : '',
      thumbnailUrl: rec.thumbnailUrl || '',
    });
  };

  const saveRecordingMetadata = async (key: string) => {
    const stored = readStoredUser();
    if (!stored?.emailVerificationToken) return;
    setSavingMetadataKey(key);
    try {
      const r = await fetch('https://api.vegvisr.org/realtime/recordings/metadata', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Token': stored.emailVerificationToken,
        },
        body: JSON.stringify({
          key,
          asUser: activeAccount && activeAccount !== stored.email ? activeAccount : undefined,
          title: metadataDraft.title,
          labels: metadataDraft.labels,
          thumbnailUrl: metadataDraft.thumbnailUrl,
        }),
      });
      const data = await r.json();
      if (!r.ok || !data.success) throw new Error(data.error || `Metadata save failed with status ${r.status}`);
      setRecordings(prev => prev.map(rec => rec.key === key ? {
        ...rec,
        title: data.title || '',
        labels: Array.isArray(data.labels) ? data.labels : [],
        thumbnailUrl: data.thumbnailUrl || '',
        customMetadata: data.customMetadata || rec.customMetadata || {},
      } : rec));
      setEditingMetadataKey(null);
    } catch (err: any) {
      alert('Metadata error: ' + err.message);
    } finally {
      setSavingMetadataKey(null);
    }
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

  /**
   * Download only the audio track of a recording.
   * Pipeline: fetch video -> decodeAudioData -> WAV blob (44.1kHz stereo) -> save.
   * Runs entirely in the browser. No backend changes required.
   */
  const downloadRecordingAudio = async (rec: any) => {
    const stored = readStoredUser();
    if (!stored?.emailVerificationToken) return;
    const key = rec.key;
    setExtractingAudioKey(key);
    setAudioExtractError(prev => { const next = { ...prev }; delete next[key]; return next; });
    try {
      // 1. Fetch the source recording (same logic as transcribeRecording)
      const params = new URLSearchParams({ token: stored.emailVerificationToken });
      if (rec.source === 'realtimekit' && rec.download_url) {
        params.set('rtk_url', rec.download_url);
      } else {
        params.set('key', key);
      }
      const downloadUrl = `https://api.vegvisr.org/realtime/recordings/download?${params.toString()}`;
      const dlResp = await fetch(downloadUrl);
      if (!dlResp.ok) throw new Error(`Download failed: ${dlResp.status} ${dlResp.statusText}`);
      const arrayBuf = await dlResp.arrayBuffer();

      // 2. Decode audio from the video container
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      let audioBuffer: AudioBuffer;
      try {
        audioBuffer = await audioCtx.decodeAudioData(arrayBuf);
      } finally {
        try { audioCtx.close(); } catch { /* ignore */ }
      }

      // 3. Encode to a podcast-quality WAV (44.1 kHz, stereo)
      const wavBlob = audioBufferToWavBlob(audioBuffer, { sampleRate: 44100, channels: 2 });

      // 4. Trigger a browser file save
      const baseName = (rec.title || rec.fileName || rec.key || 'recording')
        .replace(/\.[^.]+$/, '')
        .replace(/[\\/:*?"<>|]+/g, '-');
      const url = URL.createObjectURL(wavBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${baseName}.wav`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      // Revoke after a beat so the download starts cleanly
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err: any) {
      const msg = err?.message || 'Audio extraction failed';
      setAudioExtractError(prev => ({ ...prev, [key]: msg }));
    } finally {
      setExtractingAudioKey(null);
    }
  };

  const CHUNK_DURATION_SECONDS = 120;
  const WHISPER_ENDPOINT = 'https://openai.vegvisr.org/audio';

  /**
   * Encode an AudioBuffer to a 16-bit PCM WAV Blob.
   * Defaults are tuned for Whisper transcription (16kHz mono).
   * Pass { sampleRate: 44100, channels: 2 } for podcast-quality stereo downloads.
   */
  const audioBufferToWavBlob = (
    audioBuffer: AudioBuffer,
    opts: { sampleRate?: number; channels?: 1 | 2 } = {},
  ): Blob => {
    const targetRate = opts.sampleRate ?? 16000;
    const targetChannels: 1 | 2 = opts.channels ?? 1;
    const srcRate = audioBuffer.sampleRate;
    const ratio = srcRate / targetRate;
    const newLength = Math.floor(audioBuffer.length / ratio);
    const bytesPerSample = 2; // 16-bit PCM
    const blockAlign = targetChannels * bytesPerSample;
    const dataSize = newLength * blockAlign;
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);
    const writeStr = (off: number, s: string) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
    writeStr(0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeStr(8, 'WAVE');
    writeStr(12, 'fmt ');
    view.setUint32(16, 16, true);          // PCM fmt chunk size
    view.setUint16(20, 1, true);           // PCM format
    view.setUint16(22, targetChannels, true);
    view.setUint32(24, targetRate, true);
    view.setUint32(28, targetRate * blockAlign, true); // byte rate
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, 16, true);          // bits per sample
    writeStr(36, 'data');
    view.setUint32(40, dataSize, true);

    const ch0 = audioBuffer.getChannelData(0);
    const ch1 = audioBuffer.numberOfChannels > 1 ? audioBuffer.getChannelData(1) : ch0;
    let offset = 44;
    const lastIdx = audioBuffer.length - 1;

    if (targetChannels === 1) {
      // Downmix to mono + resample with linear interpolation
      for (let i = 0; i < newLength; i++) {
        const srcIdx = i * ratio;
        const idx = Math.floor(srcIdx);
        const frac = srcIdx - idx;
        const next = Math.min(idx + 1, lastIdx);
        const s0 = ((ch0[idx] || 0) + (ch1[idx] || 0)) / 2;
        const s1 = ((ch0[next] || 0) + (ch1[next] || 0)) / 2;
        const sample = Math.max(-1, Math.min(1, s0 + (s1 - s0) * frac));
        view.setInt16(offset, sample * 0x7fff, true);
        offset += 2;
      }
    } else {
      // Preserve stereo + resample. Interleave L, R per frame.
      for (let i = 0; i < newLength; i++) {
        const srcIdx = i * ratio;
        const idx = Math.floor(srcIdx);
        const frac = srcIdx - idx;
        const next = Math.min(idx + 1, lastIdx);
        const l0 = ch0[idx] || 0;
        const l1 = ch0[next] || 0;
        const r0 = ch1[idx] || 0;
        const r1 = ch1[next] || 0;
        const ls = Math.max(-1, Math.min(1, l0 + (l1 - l0) * frac));
        const rs = Math.max(-1, Math.min(1, r0 + (r1 - r0) * frac));
        view.setInt16(offset, ls * 0x7fff, true);
        view.setInt16(offset + 2, rs * 0x7fff, true);
        offset += 4;
      }
    }
    return new Blob([buffer], { type: 'audio/wav' });
  };

  const fmtChunkTs = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const transcribeRecording = async (rec: any) => {
    const stored = readStoredUser();
    if (!stored?.emailVerificationToken) return;
    const key = rec.key;
    setTranscribingKey(key);
    setTranscribeProgress(null);
    setTranscripts(prev => ({ ...prev, [key]: 'Downloading recording…' }));
    try {
      // Download either the R2 object or the RealtimeKit cloud recording through the API
      const params = new URLSearchParams({ token: stored.emailVerificationToken });
      if (rec.source === 'realtimekit' && rec.download_url) {
        params.set('rtk_url', rec.download_url);
      } else {
        params.set('key', key);
      }
      const downloadUrl = `https://api.vegvisr.org/realtime/recordings/download?${params.toString()}`;
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
    const targetEmail = activeAccount && activeAccount !== stored.email ? activeAccount : null;
    setSyncingRecordings(true);
    setSyncJobs([]);
    try {
      // 1. Enqueue jobs (returns immediately, no waiting on the upload)
      const r = await fetch('https://api.vegvisr.org/realtime/recordings/sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Token': stored.emailVerificationToken,
        },
        body: JSON.stringify(targetEmail ? { asUser: targetEmail } : {}),
      });
      const data = await r.json();
      if (!data.success) {
        alert('Sync failed to start: ' + (data.error || 'Unknown error'));
        return;
      }

      const queuedJobs: Array<{ jobId: string; fileName: string }> = (data.jobs || [])
        .filter((j: any) => j.status === 'queued' && j.jobId)
        .map((j: any) => ({ jobId: j.jobId, fileName: j.name }));

      if (queuedJobs.length === 0) {
        alert(`No new recordings to sync. ${data.skipped || 0} already existed.`);
        await fetchRecordings();
        return;
      }

      setSyncJobs(queuedJobs.map(j => ({ jobId: j.jobId, fileName: j.fileName, status: 'queued' })));

      // 2. Poll status until all jobs reach a terminal state
      const jobIds = queuedJobs.map(j => j.jobId);
      const TERMINAL = new Set(['done', 'failed', 'already_exists', 'skipped']);
      const startedAt = Date.now();
      const MAX_WAIT_MS = 30 * 60 * 1000; // 30 min safety cap
      let allDone = false;
      const asUserParam = targetEmail ? `&asUser=${encodeURIComponent(targetEmail)}` : '';
      while (!allDone) {
        if (Date.now() - startedAt > MAX_WAIT_MS) break;
        await new Promise(r => setTimeout(r, 3000));
        try {
          const sr = await fetch(
            `https://api.vegvisr.org/realtime/recordings/sync-status?jobIds=${encodeURIComponent(jobIds.join(','))}${asUserParam}`,
            { headers: { 'X-API-Token': stored.emailVerificationToken } }
          );
          const sd = await sr.json();
          if (sd.success && Array.isArray(sd.jobs)) {
            setSyncJobs(sd.jobs.map((j: any) => ({
              jobId: j.jobId,
              fileName: j.fileName,
              status: j.status,
              message: j.message,
            })));
            if (sd.jobs.length > 0 && sd.jobs.every((j: any) => TERMINAL.has(j.status))) {
              allDone = true;
            }
          }
        } catch { /* keep polling */ }
      }

      const finalSr = await fetch(
        `https://api.vegvisr.org/realtime/recordings/sync-status?jobIds=${encodeURIComponent(jobIds.join(','))}${asUserParam}`,
        { headers: { 'X-API-Token': stored.emailVerificationToken } }
      );
      const finalSd = await finalSr.json();
      const done = (finalSd.jobs || []).filter((j: any) => j.status === 'done').length;
      const failed = (finalSd.jobs || []).filter((j: any) => j.status === 'failed').length;
      alert(`Sync complete: ${done} uploaded, ${failed} failed.${failed > 0 ? ' Check the status panel for details.' : ''}`);
      await fetchRecordings();
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
    // Prefer the playUrl from the listing (presigned for r2-own, public for shared bucket).
    if (rec.playUrl) return rec.playUrl;
    // Legacy proxy fallback (still works, but loads bytes through the worker).
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

  // Load the Superadmin account list for the tab switcher (only Superadmins
  // can call this endpoint; for everyone else it just returns 403 and the
  // tabs stay hidden).
  useEffect(() => {
    const stored = readStoredUser();
    const token = stored?.emailVerificationToken;
    if (!token) return;
    if (stored.role !== 'Superadmin') return;
    (async () => {
      try {
        const r = await fetch('https://api.vegvisr.org/realtime/admin/superadmins', {
          headers: { 'X-API-Token': token },
        });
        const data = await r.json();
        if (data.success && Array.isArray(data.users)) {
          setSuperadmins(data.users);
          if (!activeAccount) setActiveAccount(data.currentEmail || stored.email || '');
        }
      } catch { /* ignore */ }
    })();
  }, []);

  // When the Superadmin switches tabs, reload that user's recordings.
  useEffect(() => {
    const stored = readStoredUser();
    if (!stored?.emailVerificationToken) return;
    if (lobbyTab !== 'recordings') return;
    if (!activeAccount) return;
    fetchRecordings();
  }, [activeAccount, lobbyTab]);

  // Validate custom slug. Logged-in users go through pre-join screen via pendingMeetingId.
  // Guest users (from SlugJoinPrompt) join directly using the returned authToken.
  const validateAndRedirectSlug = async (
    slug: string,
    userEmail: string,
    isGuest: boolean = false,
    shareToken?: string,
  ) => {
    setSlugLoading(true);
    setSlugPromptError(null);
    const stored = readStoredUser();
    // Share-link path is effectively a guest direct-join: the backend mints the
    // RealtimeKit token in the same response, and we use it to join immediately.
    const useShareToken = Boolean(shareToken);
    const effectivelyGuest = isGuest || useShareToken;
    try {
      const res = await fetch(`https://api.vegvisr.org/realtime/validate-slug`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(stored?.emailVerificationToken && { 'X-API-Token': stored.emailVerificationToken }),
        },
        body: JSON.stringify({
          slug,
          userEmail: useShareToken ? undefined : userEmail,
          requestJoinToken: effectivelyGuest,
          shareToken: useShareToken ? shareToken : undefined,
        }),
      });
      const data = await res.json();
      if (data.success && data.meetingId) {
        if (effectivelyGuest && data.authToken) {
          // Guest / share-link — join directly with the token returned by validate-slug
          setSlugPrompt(null);
          await initMeeting({ authToken: data.authToken, defaults: { audio: false, video: false } });
        } else {
          // Logged-in (no share token) — redirect to pre-join screen (existing flow)
          window.history.replaceState({}, '', `/?meetingId=${encodeURIComponent(data.meetingId)}`);
          setPendingMeetingId(data.meetingId);
        }
      } else {
        // Not approved or slug not found
        if (useShareToken) {
          // Share-link failures land on the existing access-denied surface; the
          // backend already returns a clear error string for revoked/expired.
          setSlugAccessDenied({
            slug,
            ownerEmail: data.ownerEmail || 'unknown',
          });
        } else if (isGuest) {
          // Map status codes to friendly, non-technical messages
          let friendly = 'Something went wrong. Please try again.';
          if (res.status === 403) {
            friendly = "We couldn't find this email on the guest list. Double-check the address you entered, or ask the person who invited you to add it.";
          } else if (res.status === 400 && /not found/i.test(data.error || '')) {
            friendly = "This invitation link doesn't exist or has been removed.";
          } else if (res.status === 400 && /email/i.test(data.error || '')) {
            friendly = 'Please enter a valid email address.';
          }
          setSlugPromptError(friendly);
        } else {
          setSlugAccessDenied({
            slug,
            ownerEmail: data.ownerEmail || 'unknown',
          });
        }
      }
    } catch (err: any) {
      if (isGuest && !useShareToken) setSlugPromptError(err?.message || 'Failed to validate slug');
      else setSlugAccessDenied({ slug, ownerEmail: 'unknown' });
    } finally {
      setSlugLoading(false);
    }
  };

  useEffect(() => {
    const pathname = window.location.pathname;
    const searchParams = new URL(window.location.href).searchParams;
    const authToken = searchParams.get('authToken');
    const meetingId = searchParams.get('meetingId');

    provideRtkDesignSystem(document.body, { theme: 'dark' });

    // Check for custom slug in pathname (e.g., /slowyou)
    const slugMatch = pathname.match(/^\/([a-z0-9\-]{3,50})$/);
    if (slugMatch) {
      const slug = slugMatch[1];
      const shareToken = searchParams.get('t');
      const stored = readStoredUser();
      if (shareToken) {
        // Share-link path: skip email entry, validate token and join directly.
        // Works regardless of login state.
        validateAndRedirectSlug(slug, '', true, shareToken);
      } else if (stored?.email) {
        // Logged in — auto-validate with stored email
        validateAndRedirectSlug(slug, stored.email);
      } else {
        // Not logged in — show email entry prompt
        setSlugPrompt({ slug });
      }
      return;
    }

    // Direct token in URL — use it immediately (legacy / invite link flow)
    if (authToken) {
      initMeeting({ authToken, defaults: { audio: false, video: false } })
        .catch((err: any) => setTokenError(err.message));
      return;
    }

    // Meeting ID in URL — show pre-join screen first, only call initMeeting after user clicks Join
    if (meetingId) {
      const fetchInfo = async (id: string) => {
        try {
          const r = await fetch(`https://api.vegvisr.org/realtime/meeting-info?meetingId=${encodeURIComponent(id)}`);
          const meetingInfo = await r.json();
          if (meetingInfo?.success) setWaitingScreenInfo(meetingInfo);
        } catch { /* ignore */ }
        setPendingMeetingId(id);
      };
      fetchInfo(meetingId);
      return;
    }

    // No params — show the lobby
    setNoParams(true);
    fetchMyRooms();
  }, []);

  // Pre-join screen — shown when meetingId is in URL, BEFORE user clicks Join
  if (pendingMeetingId) {
    const info = waitingScreenInfo;
    const doKnock = async () => {
      const stored = readStoredUser();
      if (!stored?.email) { setTokenError('You must be logged in to join this meeting.'); return; }
      setJoining(true);
      try {
        await fetch('https://api.vegvisr.org/realtime/waiting-room/knock', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            meetingId: pendingMeetingId,
            guestEmail: stored.email,
            guestName: displayName.trim() || stored.email.split('@')[0],
          }),
        });
        setKnockingMeetingId(pendingMeetingId);
        setPendingMeetingId(null);
        setGuestWaiting(true);
      } catch (err: any) {
        setTokenError(err.message);
      } finally {
        setJoining(false);
      }
    };
    return (
      <div className="flex flex-col items-center justify-center h-full gap-6 text-slate-200 p-8">
        <div className="w-full max-w-sm bg-slate-800 border border-slate-700 rounded-xl p-6 flex flex-col gap-5 shadow-xl">
          {info?.waitingImage && (
            <img src={info.waitingImage} alt="" className="w-full h-32 object-cover rounded-lg" />
          )}
          <div className="text-center">
            <h1 className="text-lg font-semibold">{info?.meetingTitle || 'Join Meeting'}</h1>
            {info?.hostName && (
              <p className="text-sm text-slate-400 mt-1">Hosted by {info.hostName}</p>
            )}
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-400">Your name</label>
            <input
              className="bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-sky-500"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Enter your name"
              onKeyDown={(e) => { if (e.key === 'Enter' && !joining) doKnock(); }}
            />
          </div>
          {tokenError && <p className="text-red-400 text-sm">{tokenError}</p>}
          <button
            className="w-full py-2.5 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 rounded text-white font-medium transition-colors"
            disabled={joining}
            onClick={doKnock}
          >
            {joining ? 'Joining…' : 'Join Meeting'}
          </button>
        </div>
      </div>
    );
  }

  // Guest custom waiting room screen — polls DB until admitted or denied
  if (guestWaiting && knockingMeetingId) {
    return (
      <GuestWaitingScreen
        meetingId={knockingMeetingId}
        waitingScreenInfo={waitingScreenInfo}
        onAdmitted={() => {
          setGuestWaiting(false);
          fetchTokenAndJoin(knockingMeetingId!);
        }}
        onDenied={() => {
          setGuestWaiting(false);
          setGuestDenied(true);
        }}
      />
    );
  }

  if (guestDenied) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-6 text-slate-200 p-8 text-center">
        <p className="text-5xl">🚫</p>
        <p className="text-lg font-medium">You were not admitted to this meeting.</p>
        <button
          className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded text-white text-sm"
          onClick={() => { setGuestDenied(false); window.location.href = window.location.origin + window.location.pathname; }}
        >
          ← Back to Lobby
        </button>
      </div>
    );
  }

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
        {/* Logo banner removed — the AuthGate's slim top bar now shows a small
            logo next to ScreenRecorder, so the lobby starts directly with the
            impersonation banner / lobby content. */}

        {/* System Owner "Login as…" control + impersonation banner */}
        <ImpersonationBar />

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
          {canRoleManageMeetings(readStoredUser()?.role) && (
            <button
              className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${lobbyTab === 'slugs' ? 'text-white border-b-2 border-emerald-500 bg-slate-800/50' : 'text-slate-400 hover:text-white'}`}
              onClick={() => setLobbyTab('slugs')}
            >
              🔗 Room Slugs
            </button>
          )}
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

        {/* Standard Rooms — Admin/Superadmin only */}
        {hasStandardRooms && (
          <div className="flex flex-col gap-2 w-full max-w-sm">
            {standardRooms.map((room, index) => (
              <React.Fragment key={room.id}>
              <div className="flex items-center gap-2">
                <button
                  className={`flex-1 px-4 py-3 rounded-lg text-white font-medium disabled:opacity-40 text-left ${getRoomButtonClass(room, index)}`}
                  disabled={joining}
                  onClick={() => {
                    setInviteLink(`${window.location.origin}/?meetingId=${room.id}`);
                    setCopied(false);
                    fetchTokenAndJoin(room.id, 'group_call_host');
                  }}
                >
                  <span className="block text-sm">{joining ? 'Joining…' : getRoomLabel(room, index)}</span>
                  {roomTitles[room.id] && <span className={`block text-xs mt-0.5 ${getRoomSubtitleClass(room, index)}`}>{roomTitles[room.id]}</span>}
                </button>
                {canCreateMeetings && (
                  <button
                    className="px-2 py-2 text-slate-400 hover:text-white text-sm"
                    title="Rename room"
                    onClick={() => {
                      setEditingRoomTitle(room.id);
                      setRoomTitleDraft(roomTitles[room.id] || '');
                    }}
                  >
                    ✏️
                  </button>
                )}
              </div>
              {canCreateMeetings && editingRoomTitle === room.id && (
              <div className="flex gap-2">
                <input
                  type="text"
                  className="flex-1 bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-white text-sm focus:outline-none focus:border-sky-500"
                  placeholder="Room title"
                  value={roomTitleDraft}
                  onChange={(e) => setRoomTitleDraft(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && roomTitleDraft.trim() && renameRoom(room.id, roomTitleDraft.trim())}
                  autoFocus
                />
                <button
                  className="px-3 py-1.5 bg-sky-600 hover:bg-sky-500 rounded text-white text-xs disabled:opacity-40"
                  disabled={savingTitle || !roomTitleDraft.trim()}
                  onClick={() => renameRoom(room.id, roomTitleDraft.trim())}
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
              </React.Fragment>
            ))}
          </div>
        )}

        {canCreateMeetings && (
          <button
            className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded text-white text-sm w-full max-w-sm disabled:opacity-40"
            disabled={provisioningRooms}
            onClick={provisionRooms}
          >
            {provisioningRooms
              ? 'Setting up…'
              : hasStandardRooms
                ? '➕ Add Standard Room'
                : '🔧 Set Up My Standard Rooms'}
          </button>
        )}

        {/* Waiting Room & Screen Settings — Admin/Superadmin only */}
        {canCreateMeetings && hasStandardRooms && (
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

        {/* Create Meeting — Admin/Superadmin only */}
        {canCreateMeetings && (
          <button
            className="px-6 py-3 bg-emerald-600 hover:bg-emerald-500 rounded-lg text-white font-medium disabled:opacity-40 w-full max-w-sm"
            disabled={joining}
            onClick={createMeeting}
          >
            {joining && !manualMeetingId.trim() ? 'Creating…' : '+ Create Meeting'}
          </button>
        )}

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
            {/* Email invite */}
            <div className="flex flex-col gap-1 mt-1">
              <p className="text-xs text-slate-400">Or send an email invitation:</p>
              <div className="flex gap-2">
                <input
                  type="email"
                  className="flex-1 bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-white text-xs placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                  placeholder="guest@example.com"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && !inviteSending && sendEmailInvite()}
                />
                <button
                  className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 rounded text-white text-xs whitespace-nowrap disabled:opacity-40"
                  disabled={!inviteEmail.trim() || inviteSending}
                  onClick={sendEmailInvite}
                >
                  {inviteSending ? 'Sending…' : inviteSent ? '✓ Sent!' : 'Send Invite'}
                </button>
              </div>
              {inviteError && <p className="text-xs text-red-400">{inviteError}</p>}
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
                {readStoredUser()?.role === 'Superadmin' && (
                  <>
                    <input
                      ref={recordingUploadInputRef}
                      type="file"
                      accept="video/*"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) uploadRecordingToR2(file);
                      }}
                    />
                    <button
                      className="px-3 py-2 bg-emerald-700 hover:bg-emerald-600 rounded text-white text-xs disabled:opacity-40"
                      disabled={uploadingRecording}
                      onClick={() => recordingUploadInputRef.current?.click()}
                    >
                      {uploadingRecording
                        ? `Uploading${uploadingRecordingProgress != null ? ` ${uploadingRecordingProgress}%` : '…'}`
                        : '⬆ Upload Video to R2'}
                    </button>
                  </>
                )}
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

            {/* Search + sort */}
            <div className="flex flex-col gap-3 mb-3 md:flex-row md:items-center md:justify-between">
              <input
                type="text"
                value={recordingsSearch}
                onChange={(e) => setRecordingsSearch(e.target.value)}
                placeholder="Search portfolio by title, label, owner or filename"
                className="w-full md:max-w-sm bg-slate-800 border border-slate-700 rounded px-3 py-2 text-white text-sm placeholder-slate-500 focus:outline-none focus:border-sky-500"
              />
              <div className="flex items-center justify-end gap-2">
              <label htmlFor="recordings-sort" className="text-slate-400 text-xs">Sort by:</label>
              <select
                id="recordings-sort"
                title="Sort recordings"
                value={recordingsSort}
                onChange={(e) => setRecordingsSort(e.target.value as typeof recordingsSort)}
                className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-white text-xs focus:outline-none focus:border-sky-500"
              >
                <option value="date-desc">Date (newest first)</option>
                <option value="date-asc">Date (oldest first)</option>
                <option value="name-asc">Name (A–Z)</option>
                <option value="name-desc">Name (Z–A)</option>
              </select>
              </div>
            </div>

            {/* Superadmin-only: account switcher tabs */}
            {superadmins.length > 1 && (
              <div className="mb-4 flex flex-wrap gap-1 border-b border-slate-700">
                {superadmins.map(u => {
                  const isActive = u.email === activeAccount;
                  const stored = readStoredUser();
                  const isSelf = u.email === stored?.email;
                  return (
                    <button
                      key={u.email}
                      onClick={() => setActiveAccount(u.email)}
                      className={`px-3 py-1.5 text-xs rounded-t transition-colors ${
                        isActive
                          ? 'bg-slate-800 text-white border border-b-0 border-slate-700'
                          : 'bg-transparent text-slate-400 hover:text-white hover:bg-slate-800/50'
                      }`}
                      title={isSelf ? 'Your account' : `View ${u.email}'s recordings`}
                    >
                      {isSelf ? `${u.email} (you)` : u.email}
                    </button>
                  );
                })}
              </div>
            )}

            {syncJobs.length > 0 && (
              <div className="mb-4 rounded border border-slate-700 bg-slate-900/60 p-3">
                <div className="text-xs text-slate-300 mb-2 font-semibold">Sync progress</div>
                <ul className="space-y-1">
                  {syncJobs.map(job => {
                    const color =
                      job.status === 'done' ? 'text-emerald-400'
                      : job.status === 'failed' ? 'text-red-400'
                      : job.status === 'uploading' ? 'text-sky-400'
                      : job.status === 'downloading' ? 'text-amber-400'
                      : 'text-slate-400';
                    return (
                      <li key={job.jobId} className="text-xs flex items-center justify-between gap-2">
                        <span className="truncate text-slate-300">{job.fileName}</span>
                        <span className={`shrink-0 ${color}`}>
                          {job.status}
                          {job.message && job.status === 'failed' ? ` — ${job.message}` : ''}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

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
              {(() => {
                const sorted = [...recordings];
                const ts = (r: any) => r.uploaded ? new Date(r.uploaded).getTime() : 0;
                const portfolioName = (r: any) => String(r.title || r.name || r.key || '').toLowerCase();
                const search = recordingsSearch.trim().toLowerCase();
                const filtered = search
                  ? sorted.filter((r: any) => {
                      const haystack = [
                        r.title,
                        r.name,
                        r.key,
                        r.meetingTitle,
                        r.ownerEmail,
                        ...(Array.isArray(r.labels) ? r.labels : []),
                      ].filter(Boolean).join(' ').toLowerCase();
                      return haystack.includes(search);
                    })
                  : sorted;
                if (recordingsSort === 'date-desc') sorted.sort((a, b) => ts(b) - ts(a));
                else if (recordingsSort === 'date-asc') sorted.sort((a, b) => ts(a) - ts(b));
                else if (recordingsSort === 'name-asc') sorted.sort((a, b) => portfolioName(a).localeCompare(portfolioName(b)));
                else if (recordingsSort === 'name-desc') sorted.sort((a, b) => portfolioName(b).localeCompare(portfolioName(a)));
                return filtered.sort((a, b) => {
                  if (recordingsSort === 'date-desc') return ts(b) - ts(a);
                  if (recordingsSort === 'date-asc') return ts(a) - ts(b);
                  if (recordingsSort === 'name-asc') return portfolioName(a).localeCompare(portfolioName(b));
                  return portfolioName(b).localeCompare(portfolioName(a));
                });
              })().map((rec: any) => {
                // Admin + Superadmin may manage their own recordings (rename / edit / delete).
                const canManageRecs = canRoleManageMeetings(readStoredUser()?.role);
                const sizeStr = rec.size > 1024 * 1024
                  ? `${(rec.size / (1024 * 1024)).toFixed(1)} MB`
                  : `${(rec.size / 1024).toFixed(0)} KB`;
                const videoUrl = getVideoUrl(rec);
                const isPlaying = playingKey === rec.key;
                const isR2 = rec.source !== 'realtimekit';
                const displayTitle = rec.title || rec.name;
                const labels = Array.isArray(rec.labels) ? rec.labels : [];
                const hasThumbnail = !!rec.thumbnailUrl;

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
                          className="w-full flex items-center justify-center py-12 bg-slate-900 hover:bg-slate-800 transition-colors group min-h-[240px]"
                          onClick={() => setPlayingKey(rec.key)}
                          title="Play recording"
                        >
                          {hasThumbnail && (
                            <img
                              src={rec.thumbnailUrl}
                              alt={displayTitle}
                              className="absolute inset-0 h-full w-full object-cover opacity-60"
                            />
                          )}
                          <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/60 to-slate-950/10" />
                          <div className="relative flex flex-col items-center gap-2 px-6">
                            <div className="w-14 h-14 rounded-full bg-white/10 group-hover:bg-white/20 flex items-center justify-center transition-colors">
                              <span className="text-2xl ml-1">▶</span>
                            </div>
                            <span className="text-white text-base font-semibold text-center">{displayTitle}</span>
                            {labels.length > 0 && (
                              <div className="flex flex-wrap justify-center gap-1">
                                {labels.map((label: string) => (
                                  <span key={`${rec.key}-${label}`} className="rounded-full bg-slate-900/80 px-2 py-0.5 text-[11px] text-sky-200">
                                    {label}
                                  </span>
                                ))}
                              </div>
                            )}
                            <span className="text-slate-300 text-xs group-hover:text-white transition-colors">Click to play</span>
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
                          <p className="text-white text-sm font-medium truncate" title={displayTitle}>{displayTitle}</p>
                          {rec.title && rec.title !== rec.name && (
                            <p className="text-slate-500 text-xs truncate mt-0.5" title={rec.name}>{rec.name}</p>
                          )}
                          <div className="flex items-center gap-3 mt-1 flex-wrap">
                            <span className="text-slate-500 text-xs">{sizeStr}</span>
                            {rec.uploaded && <span className="text-slate-500 text-xs">{new Date(rec.uploaded).toLocaleString()}</span>}
                            {rec.duration != null && <span className="text-slate-500 text-xs">{Math.floor(rec.duration / 60)}:{String(Math.floor(rec.duration % 60)).padStart(2, '0')}</span>}
                            {rec.meetingTitle && <span className="text-slate-400 text-xs">📹 {rec.meetingTitle}</span>}
                            {rec.ownerEmail && <span className="text-emerald-400 text-xs" title="Meeting owner">👤 {rec.ownerEmail}</span>}
                            {rec.error && <span className="text-red-400 text-xs" title={rec.error}>⚠️ R2 failed</span>}
                          </div>
                          {labels.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-2">
                              {labels.map((label: string) => (
                                <span key={`${rec.key}-meta-${label}`} className="rounded-full bg-slate-700 px-2 py-0.5 text-[11px] text-sky-200">
                                  {label}
                                </span>
                              ))}
                            </div>
                          )}
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
                            title="Download video"
                          >
                            ⬇
                          </button>
                          {((rec.source !== 'realtimekit') || !!rec.download_url) && (
                            <button
                              className="px-2.5 py-1.5 bg-teal-700 hover:bg-teal-600 rounded text-white text-xs disabled:opacity-40"
                              onClick={() => downloadRecordingAudio(rec)}
                              disabled={extractingAudioKey === rec.key}
                              title="Download audio only (WAV, 44.1 kHz stereo)"
                            >
                              {extractingAudioKey === rec.key ? '⏳' : '🎵'}
                            </button>
                          )}
                          {((rec.source !== 'realtimekit') || !!rec.download_url) && (
                            <button
                              className="px-2.5 py-1.5 bg-purple-700 hover:bg-purple-600 rounded text-white text-xs disabled:opacity-40"
                              onClick={() => transcribeRecording(rec)}
                              disabled={transcribingKey === rec.key}
                              title="Transcribe with Whisper"
                            >
                              {transcribingKey === rec.key
                                ? (transcribeProgress ? `⏳ ${transcribeProgress.current}/${transcribeProgress.total}` : '⏳')
                                : '📝 Transcribe'}
                            </button>
                          )}
                          {canManageRecs && (
                            <>
                              {(rec.source === 'r2' || rec.source === 'r2-own') && (
                                <button
                                  className="px-2 py-1.5 text-slate-400 hover:text-white text-xs"
                                  title="Edit portfolio metadata"
                                  onClick={() => startEditingRecordingMetadata(rec)}
                                >
                                  🏷
                                </button>
                              )}
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

                      {editingMetadataKey === rec.key && (
                        <div className="mt-3 border border-slate-600 rounded-lg p-3 bg-slate-900/70 space-y-2">
                          <div>
                            <label className="block text-slate-400 text-xs mb-1">Portfolio title</label>
                            <input
                              type="text"
                              className="w-full bg-slate-900 border border-slate-600 rounded px-2 py-1.5 text-white text-xs focus:outline-none focus:border-sky-500"
                              value={metadataDraft.title}
                              onChange={(e) => setMetadataDraft(prev => ({ ...prev, title: e.target.value }))}
                              placeholder="Featured video title"
                            />
                          </div>
                          <div>
                            <label className="block text-slate-400 text-xs mb-1">Labels</label>
                            <input
                              type="text"
                              className="w-full bg-slate-900 border border-slate-600 rounded px-2 py-1.5 text-white text-xs focus:outline-none focus:border-sky-500"
                              value={metadataDraft.labels}
                              onChange={(e) => setMetadataDraft(prev => ({ ...prev, labels: e.target.value }))}
                              placeholder="newsroom, interview, live, campus"
                            />
                          </div>
                          <div>
                            <label className="block text-slate-400 text-xs mb-1">Thumbnail image URL</label>
                            <input
                              type="url"
                              className="w-full bg-slate-900 border border-slate-600 rounded px-2 py-1.5 text-white text-xs focus:outline-none focus:border-sky-500"
                              value={metadataDraft.thumbnailUrl}
                              onChange={(e) => setMetadataDraft(prev => ({ ...prev, thumbnailUrl: e.target.value }))}
                              placeholder="https://…"
                            />
                          </div>
                          <div className="flex gap-2">
                            <button
                              className="px-2 py-1 bg-sky-600 hover:bg-sky-500 rounded text-white text-xs disabled:opacity-40"
                              onClick={() => saveRecordingMetadata(rec.key)}
                              disabled={savingMetadataKey === rec.key}
                            >
                              {savingMetadataKey === rec.key ? 'Saving…' : 'Save metadata'}
                            </button>
                            <button
                              className="px-2 py-1 text-slate-400 hover:text-white text-xs"
                              onClick={() => setEditingMetadataKey(null)}
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Audio extraction error, if any */}
                      {audioExtractError[rec.key] && (
                        <div className="mt-2 text-xs text-red-400">
                          Audio download failed: {audioExtractError[rec.key]}
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

        {/* ─── Slugs Tab ─── */}
        {lobbyTab === 'slugs' && (
        <div className="flex flex-col flex-1 gap-6 p-8 overflow-y-auto">
          <SlugManagement userRooms={myRooms.standardRooms} />
        </div>
        )}

      </div>
    );
  }

  // Meeting not initialized yet — show waiting screen
  // Show slug join prompt for guests (not logged in)
  if (slugPrompt) {
    return (
      <SlugJoinPrompt
        slug={slugPrompt.slug}
        onJoin={(email) => validateAndRedirectSlug(slugPrompt.slug, email, true)}
        loading={slugLoading}
        error={slugPromptError}
      />
    );
  }
  // Show access denied page if slug validation failed
  if (slugAccessDenied) {
    return <AccessDeniedPage slug={slugAccessDenied.slug} ownerEmail={slugAccessDenied.ownerEmail} />;
  }

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
        <div className="flex flex-col gap-1.5 px-3 py-2 bg-slate-800 border-b border-slate-700 text-sm">
          <div className="flex items-center gap-2">
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
          <div className="flex items-center gap-2">
            <span className="text-slate-500 text-xs whitespace-nowrap">Email invite:</span>
            <input
              type="email"
              className="flex-1 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-white text-xs placeholder-slate-500 focus:outline-none focus:border-emerald-500 min-w-0"
              placeholder="guest@example.com"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !inviteSending && sendEmailInvite()}
            />
            <button
              className="px-3 py-1 bg-emerald-600 hover:bg-emerald-500 rounded text-white text-xs whitespace-nowrap disabled:opacity-40"
              disabled={!inviteEmail.trim() || inviteSending}
              onClick={sendEmailInvite}
            >
              {inviteSending ? 'Sending…' : inviteSent ? '✓ Sent!' : 'Send Invite'}
            </button>
          </div>
          {inviteError && <p className="text-xs text-red-400 px-1">{inviteError}</p>}
        </div>
      )}
      <div className="flex-1 min-h-0">
        <RealtimeKitProvider value={meeting}>
          {/* Temporary: render the desktop <Meeting> for mobile too while
              MobileMeeting's auto-hiding controls regression is being fixed.
              MobileMeeting hides the camera button after a few seconds, which
              left mobile users unable to enable their camera. Revert to the
              pre-MobileMeeting (e22f97c) behaviour: same Meeting layout on
              every viewport, controls always visible. */}
          <RtkUiProvider meeting={meeting} showSetupScreen>
            <Meeting meetingId={activeMeetingId ?? ''} isHost={isCallHost} />
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
      // User not found — auto-register as Realtime user, then fetch their context
      try {
        await fetch(`${DASHBOARD_BASE}/register-realtime-user`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: data.email }),
        });
        const userContext = await fetchUserContext(data.email);
        persistUser(userContext);
      } catch {
        persistUser({ email: data.email, role: 'user', user_id: data.email, emailVerificationToken: null });
      }
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
    if (stored?.email) {
      // Validate stored user still exists in DB — clears stale cache if deleted
      fetch(`${DASHBOARD_BASE}/get-role?email=${encodeURIComponent(stored.email)}`)
        .then(async res => {
          if (!isMounted) return;
          if (res.ok) {
            const roleData = await res.json().catch(() => null);
            const nextRole = typeof roleData?.role === 'string' ? roleData.role : stored.role || null;
            const nextUser = { ...stored, role: nextRole };
            try {
              localStorage.setItem('user', JSON.stringify({
                ...JSON.parse(localStorage.getItem('user') || '{}'),
                role: nextRole,
              }));
            } catch { /* ignore */ }
            setAuthUser(nextUser);
            setAuthStatus('authed');
          } else {
            // User removed from DB — clear cache and force re-login
            try { localStorage.removeItem('user'); } catch { /* ignore */ }
            setAuthUser(null);
            setAuthStatus('anonymous');
          }
        })
        .catch(() => {
          if (!isMounted) return;
          // Network error — trust cache to avoid locking out on flaky connection
          setAuthUser(stored);
          setAuthStatus('authed');
        });
    } else if (isMounted) {
      setAuthStatus('anonymous');
    }
    return () => { isMounted = false; };
  }, []);

  if (authStatus === 'authed') {
    return (
      <AuthContext.Provider value={authUser}>
        <div className="flex flex-col h-screen bg-slate-950 text-white">
          {/* Slim top bar: logo + screen-record on the left, user / log-out on
              the right. EcosystemNav menu removed; logo moved here so the lobby
              no longer needs its own banner. */}
          <div className="flex-shrink-0 border-b border-slate-800 bg-slate-900 px-4 py-2 flex items-center justify-between gap-2">
            <div className="flex items-center gap-3">
              <img
                src="https://favicons.vegvisr.org/favicons/1774561024334-1-1774561031809-512x512.png"
                alt="Vegvisr Realtime"
                className="w-8 h-8 rounded"
              />
              <ScreenRecorder />
              {/* Build marker — confirms you're on the latest deploy. Bump
                  the text every time you push if you want a versioned tag. */}
              <span
                aria-label="Build marker XA"
                title="Build marker XA — visual confirmation of latest deploy"
                className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-green-500 text-white text-[10px] font-bold tracking-wider"
              >
                XA
              </span>
            </div>
            {/* Wrapped so the index.css media query can hide AuthBar's email
                badge on small screens — its letter-spacing:0.3em + the email
                text together exceed the right-side budget on a Samsung-sized
                portrait viewport, pushing the page wider than 412px. */}
            <div className="header-authbar">
              <AuthBar
                userEmail={authUser?.email}
                badgeLabel="Vegvisr"
                signInLabel="Sign in"
                logoutLabel="Log out"
                onLogout={handleLogout}
              />
            </div>
          </div>
          <div className="flex-1 min-h-0">
            {children}
          </div>
        </div>
      </AuthContext.Provider>
    );
  }

  // Anonymous visitors hitting a slug URL (e.g. /slowyou) bypass the login screen
  // and go straight into the inner app, which renders SlugJoinPrompt for the email entry.
  const slugUrlMatch = typeof window !== 'undefined'
    && /^\/[a-z0-9\-]{3,50}$/.test(window.location.pathname);

  if (authStatus === 'anonymous') {
    if (slugUrlMatch) {
      return (
        <AuthContext.Provider value={null}>
          <div className="flex flex-col h-screen bg-slate-950 text-white">
            <div className="flex-1 min-h-0">{children}</div>
          </div>
        </AuthContext.Provider>
      );
    }
    return <Login />;
  }

  // checking state — spinner (skip for slug URLs to avoid a flash before the prompt)
  if (slugUrlMatch) {
    return (
      <AuthContext.Provider value={null}>
        <div className="flex flex-col h-screen bg-slate-950 text-white">
          <div className="flex-1 min-h-0">{children}</div>
        </div>
      </AuthContext.Provider>
    );
  }
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
