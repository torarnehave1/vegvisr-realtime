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
