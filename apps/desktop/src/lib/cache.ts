import type { Meeting, Session, User } from "@opsui/shared";
import Database from "@tauri-apps/plugin-sql";
import { isTauriApp } from "./platform";

type CacheEnvelope<T> = {
  value: T;
  updatedAt: string;
};

type Row = {
  value: string;
};

export type MeetingsCache = {
  meetings: Meeting[];
  lastSuccessfulSyncAt: string | null;
};

const DATABASE_URL = "sqlite:opsui-meetings-cache.db";
const STORAGE_PREFIX = "opsui-meetings::";
let databasePromise: Promise<Database | null> | null = null;

const getDatabase = async () => {
  if (!isTauriApp()) {
    return null;
  }

  if (!databasePromise) {
    databasePromise = (async () => {
      try {
        const db = await Database.load(DATABASE_URL);
        await db.execute(`
          CREATE TABLE IF NOT EXISTS cache_entries (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at TEXT NOT NULL
          )
        `);
        return db;
      } catch {
        return null;
      }
    })();
  }

  return databasePromise;
};

const loadBrowserCache = <T>(key: string): CacheEnvelope<T> | null => {
  const raw = localStorage.getItem(`${STORAGE_PREFIX}${key}`);

  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as CacheEnvelope<T>;
  } catch {
    return null;
  }
};

const writeBrowserCache = <T>(key: string, value: T) => {
  const payload: CacheEnvelope<T> = {
    value,
    updatedAt: new Date().toISOString(),
  };

  localStorage.setItem(`${STORAGE_PREFIX}${key}`, JSON.stringify(payload));
};

export const loadCache = async <T>(key: string): Promise<CacheEnvelope<T> | null> => {
  if (!isTauriApp()) {
    return loadBrowserCache<T>(key);
  }

  const db = await getDatabase();

  if (!db) {
    return null;
  }

  const rows = await db.select<Row[]>(
    "SELECT value FROM cache_entries WHERE key = $1 LIMIT 1",
    [key],
  );

  if (!rows.length) {
    return null;
  }

  try {
    return JSON.parse(rows[0].value) as CacheEnvelope<T>;
  } catch {
    return null;
  }
};

export const saveCache = async <T>(key: string, value: T) => {
  const payload: CacheEnvelope<T> = {
    value,
    updatedAt: new Date().toISOString(),
  };

  if (!isTauriApp()) {
    writeBrowserCache(key, value);
    return;
  }

  const db = await getDatabase();

  if (!db) {
    return;
  }

  try {
    await db.execute(
      `
        INSERT INTO cache_entries (key, value, updated_at)
        VALUES ($1, $2, $3)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
      `,
      [key, JSON.stringify(payload), payload.updatedAt],
    );
  } catch {
    writeBrowserCache(key, value);
  }
};

export const clearCache = async (key: string) => {
  if (!isTauriApp()) {
    localStorage.removeItem(`${STORAGE_PREFIX}${key}`);
    return;
  }

  const db = await getDatabase();

  if (!db) {
    return;
  }

  try {
    await db.execute("DELETE FROM cache_entries WHERE key = $1", [key]);
  } catch {
    localStorage.removeItem(`${STORAGE_PREFIX}${key}`);
  }
};

export const loadMeetingsCache = async () =>
  (await loadCache<MeetingsCache>("meetings"))?.value ?? {
    meetings: [],
    lastSuccessfulSyncAt: null,
  };

export const saveMeetingsCache = async (payload: MeetingsCache) =>
  saveCache("meetings", payload);

export const loadPastMeetingsCache = async () =>
  (await loadCache<MeetingsCache>("past-meetings"))?.value ?? {
    meetings: [],
    lastSuccessfulSyncAt: null,
  };

export const savePastMeetingsCache = async (payload: MeetingsCache) =>
  saveCache("past-meetings", payload);

export const loadCurrentMeetingCache = async () =>
  (await loadCache<Meeting | null>("current-meeting"))?.value ?? null;

export const saveCurrentMeetingCache = async (meeting: Meeting | null) =>
  saveCache("current-meeting", meeting);

export const loadUsersCache = async () =>
  (await loadCache<User[]>("users"))?.value ?? [];

export const saveUsersCache = async (users: User[]) => saveCache("users", users);

export const loadSessionCache = async () =>
  (await loadCache<Session | null>("session"))?.value ?? null;

export const saveSessionCache = async (session: Session | null) =>
  saveCache("session", session);

export const clearSessionCache = async () => clearCache("session");
