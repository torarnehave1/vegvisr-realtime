import React, { useEffect, useState } from 'react';
import { RtkParticipantTile } from '@cloudflare/realtimekit-react-ui';

interface SpeakerViewProps {
  meeting: any;
  config: any;
  states: any;
  activeSpeakerId: string | null;
}

/**
 * Custom layout used when the user chooses "Speaker view".
 *
 *   ┌──────────────────────────────────────────┐
 *   │                                          │
 *   │          featured (large) tile           │ ~70% height
 *   │                                          │
 *   └──────────────────────────────────────────┘
 *   ┌──┐ ┌──┐ ┌──┐ ┌──┐ ┌──┐ ┌──┐               ~30% height
 *   │..│ │..│ │..│ │..│ │..│ │..│ ...
 *   └──┘ └──┘ └──┘ └──┘ └──┘ └──┘
 *
 * The "featured" tile is the active speaker. If nobody has spoken yet
 * (or the speaker has left), we fall back to self.
 */
export const SpeakerView: React.FC<SpeakerViewProps> = ({
  meeting,
  config,
  states,
  activeSpeakerId,
}) => {
  // Re-render when participants join/leave by tracking a version counter.
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

  if (!meeting?.self) return null;

  const self = meeting.self;
  const others: any[] = meeting?.participants?.joined
    ? Array.from(meeting.participants.joined.values())
    : [];

  // Decide the featured participant: active speaker, or self if no speaker yet.
  let featured: any = self;
  if (activeSpeakerId) {
    if (activeSpeakerId === self.id) {
      featured = self;
    } else {
      const match = others.find((p) => p.id === activeSpeakerId);
      if (match) featured = match;
    }
  }

  // Thumbnail strip = self + everyone else, except the featured participant.
  const stripParticipants = [self, ...others].filter((p) => p.id !== featured.id);

  return (
    <div className="flex flex-col flex-1 min-h-0 gap-2">
      <div className="flex-1 min-h-0">
        <RtkParticipantTile
          meeting={meeting}
          participant={featured}
          config={config}
          states={states}
          style={{ width: '100%', height: '100%' }}
        />
      </div>
      {stripParticipants.length > 0 && (
        <div className="flex-shrink-0 flex gap-2 overflow-x-auto h-32 pb-1">
          {stripParticipants.map((p) => (
            <div key={p.id} className="flex-shrink-0 w-44 h-full">
              <RtkParticipantTile
                meeting={meeting}
                participant={p}
                config={config}
                states={states}
                style={{ width: '100%', height: '100%' }}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
