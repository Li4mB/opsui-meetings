import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import argon2 from "argon2";
import { nanoid } from "nanoid";
import { env } from "../config/env.js";

const ensureDirectory = (filePath: string) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
};

ensureDirectory(env.dbPath);

export const db = new Database(env.dbPath);

db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('admin', 'member')),
    password_hash TEXT NOT NULL,
    color_hex TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS meetings (
    id TEXT PRIMARY KEY,
    google_event_id TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    client_name TEXT NOT NULL,
    company TEXT NOT NULL,
    country TEXT NOT NULL,
    meeting_type TEXT NOT NULL,
    start_at_utc TEXT NOT NULL,
    end_at_utc TEXT NOT NULL,
    source_timezone TEXT NOT NULL,
    google_meet_url TEXT,
    google_doc_url TEXT,
    client_email TEXT,
    phone TEXT,
    company_size TEXT,
    modules_of_interest_json TEXT NOT NULL,
    description_raw TEXT NOT NULL,
    calendar_html_url TEXT,
    assigned_user_id TEXT,
    updated_at TEXT NOT NULL,
    last_synced_at TEXT NOT NULL,
    FOREIGN KEY (assigned_user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS past_meetings (
    id TEXT PRIMARY KEY,
    google_event_id TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    client_name TEXT NOT NULL,
    company TEXT NOT NULL,
    country TEXT NOT NULL,
    meeting_type TEXT NOT NULL,
    start_at_utc TEXT NOT NULL,
    end_at_utc TEXT NOT NULL,
    source_timezone TEXT NOT NULL,
    google_meet_url TEXT,
    google_doc_url TEXT,
    client_email TEXT,
    phone TEXT,
    company_size TEXT,
    modules_of_interest_json TEXT NOT NULL,
    description_raw TEXT NOT NULL,
    calendar_html_url TEXT,
    assigned_user_id TEXT,
    updated_at TEXT NOT NULL,
    last_synced_at TEXT NOT NULL,
    resolved_at TEXT NOT NULL,
    FOREIGN KEY (assigned_user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS sync_state (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS ai_meeting_guides (
    google_event_id TEXT PRIMARY KEY,
    guide_json TEXT NOT NULL,
    created_by_user_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (created_by_user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS meeting_requests (
    id TEXT PRIMARY KEY,
    client_name TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT NOT NULL,
    company_name TEXT NOT NULL,
    country TEXT NOT NULL DEFAULT 'Unknown',
    business_size TEXT NOT NULL,
    modules_json TEXT NOT NULL,
    meeting_mode TEXT NOT NULL CHECK(meeting_mode IN ('google_meet', 'in_person')),
    preferred_date TEXT NOT NULL,
    preferred_time TEXT NOT NULL,
    additional_info TEXT NOT NULL,
    created_by_user_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (created_by_user_id) REFERENCES users(id)
  );
`);

const ensureColumn = (
  tableName: string,
  columnName: string,
  columnDefinition: string,
) => {
  const columns = db
    .prepare<[], { name: string }>(`PRAGMA table_info(${tableName})`)
    .all()
    .map((row) => row.name);

  if (!columns.includes(columnName)) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnDefinition}`);
  }
};

ensureColumn(
  "meeting_requests",
  "country",
  "country TEXT NOT NULL DEFAULT 'Unknown'",
);

export const seedAdminIfMissing = async () => {
  const existing = db
    .prepare("SELECT id FROM users WHERE username = ? LIMIT 1")
    .get(env.seedAdminUsername);

  if (existing) {
    return;
  }

  const timestamp = new Date().toISOString();
  const passwordHash = await argon2.hash(env.seedAdminPassword);

  db.prepare(`
    INSERT INTO users (
      id,
      username,
      display_name,
      role,
      password_hash,
      color_hex,
      active,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
  `).run(
    nanoid(),
    env.seedAdminUsername,
    env.seedAdminDisplayName,
    "admin",
    passwordHash,
    "#4FD1C5",
    timestamp,
    timestamp,
  );
};
