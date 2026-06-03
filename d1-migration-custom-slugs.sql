-- Migration: Create custom_room_slugs table for memorable meeting URLs
-- Run with: wrangler d1 execute <db-name> --file=d1-migration-custom-slugs.sql

CREATE TABLE IF NOT EXISTS custom_room_slugs (
  id TEXT PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  meeting_id TEXT NOT NULL,
  owner_email TEXT NOT NULL,
  allowed_emails JSON NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  active BOOLEAN DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_slug ON custom_room_slugs(slug);
CREATE INDEX IF NOT EXISTS idx_owner ON custom_room_slugs(owner_email);
CREATE INDEX IF NOT EXISTS idx_active ON custom_room_slugs(active);

-- Table for storing contact messages from non-approved users
CREATE TABLE IF NOT EXISTS slug_contact_messages (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL,
  from_email TEXT NOT NULL,
  to_email TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL,
  read_at TEXT,
  FOREIGN KEY (slug) REFERENCES custom_room_slugs(slug)
);

CREATE INDEX IF NOT EXISTS idx_slug_messages ON slug_contact_messages(slug);
CREATE INDEX IF NOT EXISTS idx_to_email_messages ON slug_contact_messages(to_email);

-- ─────────────────────────────────────────────────────────────────────────────
-- Share-link tokens (added 2026-05): an alternative join path that lets an
-- invited guest bypass the email-allowlist entry form. Token is valid only
-- within a 2-hour window centred on the slug's scheduled meeting time.
-- ─────────────────────────────────────────────────────────────────────────────

-- Optional scheduled meeting time on a slug. NULL = no meeting time set;
-- share tokens cannot be minted until this is filled in.
-- NOTE: re-running this against a DB that already has the column will error
-- on this line. That's expected; SQLite has no "ADD COLUMN IF NOT EXISTS".
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
