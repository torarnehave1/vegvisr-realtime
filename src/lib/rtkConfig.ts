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
