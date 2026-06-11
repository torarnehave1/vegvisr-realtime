import { defaultConfig } from '@cloudflare/realtimekit-react-ui';

// Shared RealtimeKit UI config passed to RtkGrid / RtkParticipantTile in both the
// desktop and mobile layouts. Unwraps the participant-tile `children` config the
// same way the original inline App.tsx setup did.
export const config = { ...defaultConfig };
if (config.root) {
  config.root['rtk-participant-tile'] = (
    config.root['rtk-participant-tile'] as any
  ).children;
}

// Tile videoFit: 'cover' (default) crops to fill the tile — looks fine for
// landscape webcams but cuts top/bottom of a portrait phone video. Switch to
// 'contain' so phone-in-portrait shows the full face with side bars instead.
// Read by rtk-participant-tile at this.config.config.videoFit.
;(config as any).config = { ...((config as any).config ?? {}), videoFit: 'contain' };
