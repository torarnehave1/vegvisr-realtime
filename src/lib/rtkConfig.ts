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
//
// The SDK reads videoFit from MULTIPLE paths depending on context:
//   - rtk-participant-tile reads this.config.config.videoFit
//   - rtk-grid (multi-participant layout) reads config.config.grid.multi.videoFit
//   - rtk-grid (single-participant layout) reads config.config.grid.single.videoFit
// Set all three so a tile created mid-meeting (e.g., after a waiting-room
// admit) inherits the right fit regardless of which path the SDK consults
// first. Without all three, the first render of a newly-admitted participant
// could fall back to the SDK default 'cover'.
{
  const inner: any = { ...((config as any).config ?? {}) }
  inner.videoFit = 'contain'
  inner.grid = {
    ...(inner.grid ?? {}),
    multi: { ...(inner.grid?.multi ?? {}), videoFit: 'contain' },
    single: { ...(inner.grid?.single ?? {}), videoFit: 'contain' },
  }
  ;(config as any).config = inner
}
