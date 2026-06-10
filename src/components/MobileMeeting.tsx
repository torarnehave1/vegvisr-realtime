import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  RtkCameraToggle,
  RtkChatToggle,
  RtkGrid,
  RtkLeaveButton,
  RtkMicToggle,
  RtkSidebar,
  RtkSpinner,
} from '@cloudflare/realtimekit-react-ui';
import { SpeakerView } from './SpeakerView';
import { DuoView } from './DuoView';
import { config } from '../lib/rtkConfig';
import { useMeetingSession, type ViewMode } from '../hooks/useMeetingSession';

const VIEW_ORDER: ViewMode[] = ['grid', 'speaker', 'duo'];
const VIEW_LABEL: Record<ViewMode, string> = {
  grid: 'Gallery',
  speaker: 'Speaker',
  duo: '2-person',
};

const AUTO_HIDE_MS = 3500;
const SWIPE_THRESHOLD = 50;

/**
 * Immersive, Zoom-style meeting layout for phones / touch screens.
 * - No chrome by default: video fills the screen.
 * - Tap toggles an auto-hiding control overlay.
 * - Horizontal swipe cycles Gallery → Speaker → 2-person.
 * Shares all meeting state with the desktop layout via useMeetingSession.
 */
export function MobileMeeting({
  meetingId,
  isHost,
}: {
  meetingId: string;
  isHost: boolean;
}) {
  const session = useMeetingSession({ meetingId, isHost, allowDuo: true });
  const {
    meeting,
    roomJoined,
    roomState,
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
  } = session;

  const [controlsVisible, setControlsVisible] = useState(true);
  const [showWaitlist, setShowWaitlist] = useState(false);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gestureRef = useRef<{ x: number; y: number; moved: boolean } | null>(null);

  // Auto-hide the overlay after inactivity whenever it is shown.
  const scheduleHide = useCallback(() => {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => setControlsVisible(false), AUTO_HIDE_MS);
  }, []);

  useEffect(() => {
    if (controlsVisible) scheduleHide();
    return () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, [controlsVisible, scheduleHide]);

  const revealControls = useCallback(() => {
    setControlsVisible(true);
    scheduleHide();
  }, [scheduleHide]);

  const cycleView = useCallback(
    (dir: 1 | -1) => {
      const idx = VIEW_ORDER.indexOf(viewMode);
      const next = VIEW_ORDER[(idx + dir + VIEW_ORDER.length) % VIEW_ORDER.length];
      setViewMode(next);
    },
    [viewMode, setViewMode],
  );

  // ── Gestures: tap toggles overlay, horizontal swipe cycles views ───────────
  const onPointerDown = (e: React.PointerEvent) => {
    gestureRef.current = { x: e.clientX, y: e.clientY, moved: false };
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const g = gestureRef.current;
    gestureRef.current = null;
    if (!g) return;
    const dx = e.clientX - g.x;
    const dy = e.clientY - g.y;
    if (Math.abs(dx) > SWIPE_THRESHOLD && Math.abs(dx) > Math.abs(dy)) {
      cycleView(dx < 0 ? 1 : -1); // swipe left → next view
      revealControls();
      return;
    }
    if (Math.abs(dx) < 8 && Math.abs(dy) < 8) {
      // Tap — toggle overlay.
      setControlsVisible((v) => !v);
    }
  };

  // ── Flip camera (front/rear) ───────────────────────────────────────────────
  const flipCamera = useCallback(async () => {
    if (!meeting?.self) return;
    try {
      const devices: MediaDeviceInfo[] = await meeting.self.getVideoDevices();
      if (!devices || devices.length < 2) return;
      const current = meeting.self.videoTrack?.getSettings?.()?.deviceId;
      const next = devices.find((d) => d.deviceId !== current) || devices[0];
      await meeting.self.setDevice(next);
    } catch (err) {
      console.error('Flip camera failed:', err);
    }
  }, [meeting]);

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

  const stop = (e: React.PointerEvent) => e.stopPropagation();

  return (
    <div
      className="relative w-full bg-slate-950 overflow-hidden select-none"
      style={{ height: '100dvh' }}
      ref={(el) => {
        el?.addEventListener('rtkStateUpdate', (e: any) => updateStates(e.detail));
      }}
    >
      {/* Video layer — owns the tap/swipe gestures */}
      <div
        className="absolute inset-0 flex"
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
      >
        {viewMode === 'speaker' ? (
          <SpeakerView
            meeting={meeting}
            config={config}
            states={states}
            activeSpeakerId={activeSpeakerId}
          />
        ) : viewMode === 'duo' ? (
          <DuoView
            meeting={meeting}
            config={config}
            states={states}
            activeSpeakerId={activeSpeakerId}
          />
        ) : (
          <RtkGrid meeting={meeting} config={config} />
        )}
      </div>

      {/* Recording banner (transient, top) */}
      {showRecordingBanner && (
        <div
          className="absolute top-0 left-0 right-0 flex items-center justify-center gap-2 px-3 py-2 bg-red-700 text-white text-sm font-medium animate-pulse z-20"
          style={{ paddingTop: 'calc(env(safe-area-inset-top) + 0.5rem)' }}
        >
          <span className="inline-block w-3 h-3 rounded-full bg-red-300 animate-ping" />
          <span>{isStarting ? 'Recording starting…' : '⏺ This meeting is being recorded'}</span>
        </div>
      )}

      {/* Overlay — pointer-events disabled except on its controls */}
      <div
        className={`absolute inset-0 z-10 pointer-events-none transition-opacity duration-200 ${
          controlsVisible ? 'opacity-100' : 'opacity-0'
        }`}
      >
        {/* Top strip: view name + timers + waiting badge */}
        <div
          className="absolute top-0 left-0 right-0 flex items-center gap-2 px-3 pb-2 bg-gradient-to-b from-black/60 to-transparent pointer-events-auto"
          style={{ paddingTop: 'calc(env(safe-area-inset-top) + 0.5rem)' }}
          onPointerDown={stop}
        >
          <span className="text-xs font-semibold text-white bg-white/10 rounded-full px-2.5 py-1">
            {VIEW_LABEL[viewMode]}
          </span>
          <span className="font-mono text-xs text-slate-300">🕐 {fmtTime(meetingSeconds)}</span>
          {(isRecording || isPaused) && (
            <span
              className={`font-mono text-xs flex items-center gap-1 ${isPaused ? 'text-yellow-300' : 'text-red-300'}`}
            >
              <span
                className={`inline-block w-2 h-2 rounded-full ${isPaused ? 'bg-yellow-400' : 'bg-red-500 animate-pulse'}`}
              />
              {isPaused ? 'PAUSED' : 'REC'} {fmtTime(recSeconds)}
            </span>
          )}
          {isHost && (
            <button
              className={`ml-auto px-2.5 py-1 rounded-full text-white text-xs font-medium ${
                waitingGuests.length > 0
                  ? 'bg-amber-600 animate-pulse'
                  : 'bg-white/10'
              }`}
              onClick={() => setShowWaitlist((v) => !v)}
              title="Waiting room"
            >
              🖐 {waitingGuests.length}
            </button>
          )}
        </div>

        {/* Page dots */}
        <div className="absolute left-0 right-0 bottom-24 flex items-center justify-center gap-2">
          {VIEW_ORDER.map((v) => (
            <span
              key={v}
              className={`w-2 h-2 rounded-full transition-colors ${
                v === viewMode ? 'bg-white' : 'bg-white/30'
              }`}
            />
          ))}
        </div>

        {/* Bottom control bar */}
        <div
          className="absolute bottom-0 left-0 right-0 flex items-center justify-center gap-3 px-4 pt-6 bg-gradient-to-t from-black/70 to-transparent pointer-events-auto"
          style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 1rem)' }}
          onPointerDown={stop}
        >
          <RtkMicToggle meeting={meeting} />
          <RtkCameraToggle meeting={meeting} />
          {/* Flip camera */}
          <button
            type="button"
            onClick={flipCamera}
            aria-label="Flip camera"
            title="Flip camera"
            className="w-12 h-12 rounded-full bg-white/15 hover:bg-white/25 text-white flex items-center justify-center"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M15 7h3a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              <circle cx="12" cy="12.5" r="3" stroke="currentColor" strokeWidth="1.6" />
              <path d="M10 7l2-2 2 2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <RtkChatToggle meeting={meeting} />
          {canRecord && (
            <button
              type="button"
              onClick={isRecording || isPaused ? togglePauseRecording : toggleRecording}
              onDoubleClick={toggleRecording}
              disabled={recordingBusy || isStarting || isStopping}
              aria-label={isRecording || isPaused ? 'Stop recording' : 'Start recording'}
              title={isRecording || isPaused ? 'Tap: pause/resume · double-tap: stop' : 'Start recording'}
              className={`w-12 h-12 rounded-full flex items-center justify-center text-white disabled:opacity-40 ${
                isRecording || isPaused ? 'bg-red-600' : 'bg-white/15 hover:bg-white/25'
              }`}
            >
              {isStarting || isStopping ? '⏳' : isPaused ? '▶' : isRecording ? '⏸' : '⏺'}
            </button>
          )}
          <RtkLeaveButton />
        </div>
      </div>

      {/* Waiting-room bottom sheet (host) */}
      {isHost && showWaitlist && (
        <div className="absolute inset-x-0 bottom-0 z-30 bg-slate-900 border-t border-slate-600 rounded-t-2xl shadow-2xl max-h-[60%] flex flex-col">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700">
            <span className="text-sm font-semibold text-white">
              🖐 Waiting Room ({waitingGuests.length})
            </span>
            <button
              className="text-slate-400 hover:text-white text-xl leading-none"
              onClick={() => setShowWaitlist(false)}
            >
              ✕
            </button>
          </div>
          <div className="p-3 flex flex-col gap-2 overflow-y-auto">
            {waitingGuests.length === 0 ? (
              <p className="text-slate-400 text-sm text-center py-6">No one waiting</p>
            ) : (
              <>
                {waitingGuests.map((g: any) => (
                  <div
                    key={g.guest_email}
                    className="flex items-center gap-2 px-2 py-2 rounded bg-slate-800"
                  >
                    <div className="w-9 h-9 rounded-full bg-slate-600 flex items-center justify-center text-sm text-white font-bold flex-shrink-0">
                      {(g.guest_name || g.guest_email || '?')[0].toUpperCase()}
                    </div>
                    <span className="flex-1 text-sm text-slate-200 truncate">
                      {g.guest_name || g.guest_email}
                    </span>
                    <button
                      className="px-3 py-1.5 bg-emerald-600 rounded text-white text-xs font-medium"
                      onClick={() => admitGuest(g.guest_email)}
                    >
                      ✓ Admit
                    </button>
                    <button
                      className="px-3 py-1.5 bg-red-700 rounded text-white text-xs font-medium"
                      onClick={() => denyGuest(g.guest_email)}
                    >
                      ✕
                    </button>
                  </div>
                ))}
                <button
                  className="mt-1 w-full py-2 bg-emerald-700 rounded text-white text-sm font-medium"
                  onClick={() => waitingGuests.forEach((g: any) => admitGuest(g.guest_email))}
                >
                  Admit All
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Chat / sidebar overlay — full width on mobile */}
      {states.activeSidebar && (
        <div className="absolute inset-0 z-40 bg-slate-900">
          <RtkSidebar meeting={meeting} states={states} />
        </div>
      )}
    </div>
  );
}
