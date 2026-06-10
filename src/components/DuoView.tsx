import React, { useEffect, useRef, useState } from 'react';
import { RtkParticipantTile } from '@cloudflare/realtimekit-react-ui';

interface DuoViewProps {
  meeting: any;
  config: any;
  states: any;
  activeSpeakerId: string | null;
}

/**
 * 2-person ("duo") view — Zoom / FaceTime 1:1 style.
 *
 *   ┌──────────────────────────────────────────┐
 *   │                                          │
 *   │        the other participant             │  full-bleed
 *   │                            ┌──────┐      │
 *   │                            │ self │ PiP  │  draggable
 *   │                            └──────┘      │
 *   └──────────────────────────────────────────┘
 *
 * The featured (full-screen) tile is the active-speaking remote, falling back
 * to the first remote. Self is rendered as a small draggable picture-in-picture
 * tile. With no remote participant, self fills the screen and there is no PiP.
 */
export const DuoView: React.FC<DuoViewProps> = ({
  meeting,
  config,
  states,
  activeSpeakerId,
}) => {
  // Re-render when participants join/leave.
  const [, setVersion] = useState(0);
  useEffect(() => {
    if (!meeting?.participants?.joined) return;
    const joined = meeting.participants.joined;
    const bump = () => setVersion((v) => v + 1);
    joined.on('participantJoined', bump);
    joined.on('participantLeft', bump);
    return () => {
      joined.off?.('participantJoined', bump);
      joined.off?.('participantLeft', bump);
    };
  }, [meeting]);

  // Draggable PiP position. null => anchored bottom-right via CSS; once dragged
  // we switch to explicit left/top.
  const [pipPos, setPipPos] = useState<{ x: number; y: number } | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{
    startX: number;
    startY: number;
    origX: number;
    origY: number;
    moved: boolean;
  } | null>(null);

  if (!meeting?.self) return null;

  const self = meeting.self;
  const others: any[] = meeting?.participants?.joined
    ? Array.from(meeting.participants.joined.values())
    : [];

  // No remote yet — show self full-screen, no PiP.
  if (others.length === 0) {
    return (
      <div className="relative flex-1 min-h-0 w-full h-full">
        <RtkParticipantTile
          meeting={meeting}
          participant={self}
          config={config}
          states={states}
          style={{ width: '100%', height: '100%' }}
        />
      </div>
    );
  }

  // Featured = active-speaking remote, else first remote.
  let featured = others[0];
  if (activeSpeakerId && activeSpeakerId !== self.id) {
    const match = others.find((p) => p.id === activeSpeakerId);
    if (match) featured = match;
  }

  const onPipPointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    const rect = containerRef.current?.getBoundingClientRect();
    const target = e.currentTarget as HTMLElement;
    const pipRect = target.getBoundingClientRect();
    const baseX = rect ? pipRect.left - rect.left : pipRect.left;
    const baseY = rect ? pipRect.top - rect.top : pipRect.top;
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      origX: pipPos ? pipPos.x : baseX,
      origY: pipPos ? pipPos.y : baseY,
      moved: false,
    };
    target.setPointerCapture?.(e.pointerId);
  };

  const onPipPointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    e.stopPropagation();
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) dragRef.current.moved = true;
    const rect = containerRef.current?.getBoundingClientRect();
    let nx = dragRef.current.origX + dx;
    let ny = dragRef.current.origY + dy;
    // Keep the PiP within the container bounds.
    const pipRect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    if (rect) {
      nx = Math.max(0, Math.min(nx, rect.width - pipRect.width));
      ny = Math.max(0, Math.min(ny, rect.height - pipRect.height));
    }
    setPipPos({ x: nx, y: ny });
  };

  const onPipPointerUp = (e: React.PointerEvent) => {
    e.stopPropagation();
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    dragRef.current = null;
  };

  const pipStyle: React.CSSProperties = pipPos
    ? { left: pipPos.x, top: pipPos.y }
    : { right: 12, bottom: 12 };

  return (
    <div ref={containerRef} className="relative flex-1 min-h-0 w-full h-full">
      {/* Featured remote — fills the view */}
      <RtkParticipantTile
        meeting={meeting}
        participant={featured}
        config={config}
        states={states}
        style={{ width: '100%', height: '100%' }}
      />
      {/* Self PiP — draggable */}
      <div
        className="absolute w-28 h-40 sm:w-32 sm:h-44 rounded-lg overflow-hidden shadow-2xl ring-1 ring-white/20 touch-none cursor-grab active:cursor-grabbing z-10"
        style={pipStyle}
        onPointerDown={onPipPointerDown}
        onPointerMove={onPipPointerMove}
        onPointerUp={onPipPointerUp}
      >
        <RtkParticipantTile
          meeting={meeting}
          participant={self}
          config={config}
          states={states}
          style={{ width: '100%', height: '100%', pointerEvents: 'none' }}
        />
      </div>
    </div>
  );
};
