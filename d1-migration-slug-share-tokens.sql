-- Migration: share-link tokens for slugs.
-- Run only once with: wrangler d1 execute vegvisr_org --remote --file=d1-migration-slug-share-tokens.sql
-- Idempotent for the CREATE TABLE / CREATE INDEX parts. The ALTER TABLE
-- will error if the column already exists; that's expected on re-runs.

ALTER TABLE custom_room_slugs ADD COLUMN scheduled_start_at TEXT;

CREATE TABLE IF NOT EXISTS slug_share_tokens (
  id TEXT PRIMARY KEY,             -- UUID; this IS the token, used in URL as ?t=<id>
  slug_id TEXT NOT NULL,           -- FK to custom_room_slugs.id
  meeting_id TEXT NOT NULL,        -- snapshot at mint time
  valid_from TEXT NOT NULL,        -- ISO ts: scheduled_start_at minus 1 hour
  valid_until TEXT NOT NULL,       -- ISO ts: scheduled_start_at plus 1 hour
  created_by TEXT NOT NULL,        -- owner email
  created_at TEXT NOT NULL,
  revoked_at TEXT,                 -- NULL until revoked
  FOREIGN KEY (slug_id) REFERENCES custom_room_slugs(id)
);

CREATE INDEX IF NOT EXISTS idx_share_token_slug ON slug_share_tokens(slug_id);
CREATE INDEX IF NOT EXISTS idx_share_token_window ON slug_share_tokens(valid_from, valid_until);
