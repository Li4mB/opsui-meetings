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

const getStorageKey = (key: string) => `${STORAGE_PREFIX}${key}`;

const saveCacheToDatabase = async <T>(key: string, payload: CacheEnvelope<T>) => {
  const db = await getDatabase();

  if (!db) {
    return false;
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

    return true;
  } catch {
    return false;
  }
};

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
  const raw = localStorage.getItem(getStorageKey(key));

  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as CacheEnvelope<T>;
  } catch {
    localStorage.removeItem(getStorageKey(key));
    return null;
  }
};

const writeBrowserCache = <T>(key: string, payload: CacheEnvelope<T>) => {
  localStorage.setItem(getStorageKey(key), JSON.stringify(payload));
};

export const loadCache = async <T>(key: string): Promise<CacheEnvelope<T> | null> => {
  const browserCache = loadBrowserCache<T>(key);

  if (!isTauriApp()) {
    return browserCache;
  }

  const db = await getDatabase();

  if (!db) {
    return browserCache;
  }

  let rows: Row[] = [];

  try {
    rows = await db.select<Row[]>(
      "SELECT value FROM cache_entries WHERE key = $1 LIMIT 1",
      [key],
    );
  } catch {
    return browserCache;
  }

  if (!rows.length) {
    if (browserCache) {
      await saveCacheToDatabase(key, browserCache).catch(() => null);
    }

    return browserCache;
  }

  try {
    return JSON.parse(rows[0].value) as CacheEnvelope<T>;
  } catch {
    if (browserCache) {
      await saveCacheToDatabase(key, browserCache).catch(() => null);
      return browserCache;
    }

    return null;
  }
};

export const saveCache = async <T>(key: string, value: T) => {
  const payload: CacheEnvelope<T> = {
    value,
    updatedAt: new Date().toISOString(),
  };

  if (!isTauriApp()) {
    writeBrowserCache(key, payload);
    return;
  }

  writeBrowserCache(key, payload);

  const savedToDatabase = await saveCacheToDatabase(key, payload);

  if (!savedToDatabase) {
    return;
  }
};

export const clearCache = async (key: string) => {
  localStorage.removeItem(getStorageKey(key));

  if (!isTauriApp()) {
    return;
  }

  const db = await getDatabase();

  if (!db) {
    return;
  }

  try {
    await db.execute("DELETE FROM cache_entries WHERE key = $1", [key]);
  } catch {}
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
