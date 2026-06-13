import React, { useEffect, useState, useRef } from 'react';

interface Props {
  meeting: any;
  /** When true, render Mute / Cam / 🖐 actions per row. When false, list is read-only. */
  isHost: boolean;
  onClose: () => void;
  /** Initial fixed position (top-right by default, below the waiting-room panel). */
  initialPos?: { x: number; y: number };
}

interface Row {
  id: string;
  name: string;
  presetName: string;
  audioEnabled: boolean;
  videoEnabled: boolean;
}

/**
 * Host-only participants modal: lists joined participants with per-row actions
 * (mute audio, stop video, kick = send back to waiting room).
 *
 * Subscribes to participant join / leave / media-state events so the list and
 * the per-row icons stay live without polling.
 *
 * "Send to waiting room" is implemented as `meeting.participants.kick(id)` —
 * with the waiting-room toggle enabled, a kicked participant re-knocks on
 * rejoin. If the waiting room is disabled it's a hard eject, which matches
 * the same SDK call other RealtimeKit hosts use.
 */
export default function ParticipantsPanel({ meeting, isHost, onClose, initialPos }: Props) {
  const [rows, setRows] = useState<Row[]>([]);
  // Default position: same right edge as the waiting-room popup, but below
  // it (y=300) so the two panels don't overlap when both are open.
  const [pos, setPos] = useState(
    initialPos ?? { x: typeof window !== 'undefined' ? window.innerWidth - 360 : 100, y: 300 },
  );
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = () => {
    try {
      const arr = (meeting?.participants?.joined?.toArray?.() ?? []) as any[];
      setRows(
        arr.map((p) => ({
          id: p.id,
          name: p.name || '(unnamed)',
          presetName: p.presetName || '',
          audioEnabled: !!p.audioEnabled,
          videoEnabled: !!p.videoEnabled,
        })),
      );
    } catch {
      setRows([]);
    }
  };

  useEffect(() => {
    refresh();
    const joined = meeting?.participants?.joined;
    if (!joined) return;
    // Updates that change the list or per-row icons.
    const onChange = () => refresh();
    joined.on?.('participantJoined', onChange);
    joined.on?.('participantLeft', onChange);
    joined.on?.('audioUpdate', onChange);
    joined.on?.('videoUpdate', onChange);
    return () => {
      joined.removeListener?.('participantJoined', onChange);
      joined.removeListener?.('participantLeft', onChange);
      joined.removeListener?.('audioUpdate', onChange);
      joined.removeListener?.('videoUpdate', onChange);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meeting]);

  const onDragStart = (e: React.MouseEvent) => {
    dragRef.current = { startX: e.clientX, startY: e.clientY, origX: pos.x, origY: pos.y };
    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      setPos({
        x: dragRef.current.origX + ev.clientX - dragRef.current.startX,
        y: dragRef.current.origY + ev.clientY - dragRef.current.startY,
      });
    };
    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const muteAudio = async (id: string) => {
    setBusyId(id);
    try {
      await meeting.participants.disableAudio(id);
    } catch (e) {
      console.warn('[participants] disableAudio failed:', e);
    } finally {
      setBusyId(null);
    }
  };
  const stopVideo = async (id: string) => {
    setBusyId(id);
    try {
      await meeting.participants.disableVideo(id);
    } catch (e) {
      console.warn('[participants] disableVideo failed:', e);
    } finally {
      setBusyId(null);
    }
  };
  const kick = async (id: string, name: string) => {
    if (!window.confirm(`Send ${name} back to the waiting room?`)) return;
    setBusyId(id);
    try {
      await meeting.participants.kick(id);
    } catch (e) {
      console.warn('[participants] kick failed:', e);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div
      style={{ position: 'fixed', left: pos.x, top: pos.y, zIndex: 9998, width: 340 }}
      className="bg-slate-900 border border-slate-500 rounded-xl shadow-2xl select-none"
    >
      <div
        className="flex items-center justify-between px-3 py-2 bg-slate-700 rounded-t-xl cursor-grab active:cursor-grabbing"
        onMouseDown={onDragStart}
      >
        <span className="text-sm font-semibold text-white">👥 Participants ({rows.length})</span>
        <button
          className="text-slate-400 hover:text-white text-lg leading-none"
          onClick={onClose}
          aria-label="Close"
        >✕</button>
      </div>

      <div className="p-2 flex flex-col gap-1 max-h-80 overflow-y-auto">
        {rows.length === 0 ? (
          <p className="text-slate-400 text-xs text-center py-4">No participants yet</p>
        ) : (
          rows.map((r) => {
            const busy = busyId === r.id;
            const rowIsHost = /host/i.test(r.presetName);
            return (
              <div key={r.id} className="flex items-center gap-2 px-2 py-2 rounded hover:bg-slate-800">
                <div className="w-8 h-8 rounded-full bg-slate-600 flex items-center justify-center text-xs text-white font-bold flex-shrink-0">
                  {(r.name || '?')[0].toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm text-slate-200 truncate">{r.name}</span>
                    {rowIsHost && (
                      <span className="text-[9px] uppercase tracking-wider text-emerald-300 bg-emerald-900/50 px-1 rounded">
                        host
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span
                      className={`text-[10px] ${r.audioEnabled ? 'text-emerald-400' : 'text-slate-500'}`}
                      title={r.audioEnabled ? 'Audio on' : 'Audio off'}
                    >{r.audioEnabled ? '🔊' : '🔇'}</span>
                    <span
                      className={`text-[10px] ${r.videoEnabled ? 'text-emerald-400' : 'text-slate-500'}`}
                      title={r.videoEnabled ? 'Video on' : 'Video off'}
                    >{r.videoEnabled ? '📹' : '📵'}</span>
                    <span className="text-[9px] text-slate-500 truncate">{r.id.slice(0, 8)}</span>
                  </div>
                </div>
                {isHost && (
                  <>
                    <button
                      className="px-1.5 py-1 bg-slate-700 hover:bg-slate-600 rounded text-white text-[11px] disabled:opacity-40"
                      disabled={busy || !r.audioEnabled || rowIsHost}
                      onClick={() => muteAudio(r.id)}
                      title={rowIsHost ? "Can't mute another host" : 'Mute audio'}
                    >Mute</button>
                    <button
                      className="px-1.5 py-1 bg-slate-700 hover:bg-slate-600 rounded text-white text-[11px] disabled:opacity-40"
                      disabled={busy || !r.videoEnabled || rowIsHost}
                      onClick={() => stopVideo(r.id)}
                      title={rowIsHost ? "Can't stop another host's video" : 'Stop video'}
                    >Cam</button>
                    <button
                      className="px-1.5 py-1 bg-red-700 hover:bg-red-600 rounded text-white text-[11px] disabled:opacity-40"
                      disabled={busy || rowIsHost}
                      onClick={() => kick(r.id, r.name)}
                      title={rowIsHost ? "Can't kick a host" : 'Send to waiting room'}
                    >🖐</button>
                  </>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
