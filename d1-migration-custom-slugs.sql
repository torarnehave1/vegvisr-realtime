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
