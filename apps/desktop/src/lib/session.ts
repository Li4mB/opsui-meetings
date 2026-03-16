import type { Session } from "@opsui/shared";
import { sessionSchema } from "@opsui/shared";
import { appDataDir, join } from "@tauri-apps/api/path";
import { Stronghold } from "@tauri-apps/plugin-stronghold";
import { clearCache } from "./cache";
import { isTauriApp } from "./platform";

const BROWSER_KEY = "opsui-meetings::session";
const STRONGHOLD_PASSWORD = "opsui-meetings-session-v1";
const CLIENT_NAME = "opsui-meetings-session";
const STORE_KEY = "session";

const createStrongholdStore = async () => {
  try {
    const baseDir = await appDataDir();
    const vaultPath = await join(baseDir, "opsui-meetings.hold");
    const stronghold = await Stronghold.load(vaultPath, STRONGHOLD_PASSWORD);

    try {
      const client = await stronghold.loadClient(CLIENT_NAME);
      return { stronghold, store: client.getStore() };
    } catch {
      const client = await stronghold.createClient(CLIENT_NAME);
      return { stronghold, store: client.getStore() };
    }
  } catch {
    return null;
  }
};

export const loadStoredSession = async (): Promise<Session | null> => {
  if (!isTauriApp()) {
    const raw = localStorage.getItem(BROWSER_KEY);
    return raw ? sessionSchema.parse(JSON.parse(raw)) : null;
  }

  const strongholdStore = await createStrongholdStore();

  if (!strongholdStore) {
    return null;
  }

  const { store } = strongholdStore;
  const value = await store.get(STORE_KEY);

  if (!value) {
    return null;
  }

  return sessionSchema.parse(JSON.parse(new TextDecoder().decode(value)));
};

export const saveStoredSession = async (session: Session) => {
  if (!isTauriApp()) {
    localStorage.setItem(BROWSER_KEY, JSON.stringify(session));
    return;
  }

  const strongholdStore = await createStrongholdStore();

  if (!strongholdStore) {
    localStorage.setItem(BROWSER_KEY, JSON.stringify(session));
    return;
  }

  const { stronghold, store } = strongholdStore;
  await store.insert(
    STORE_KEY,
    Array.from(new TextEncoder().encode(JSON.stringify(session))),
  );
  await stronghold.save();
};

export const clearStoredSession = async () => {
  if (!isTauriApp()) {
    localStorage.removeItem(BROWSER_KEY);
    await clearCache("users");
    return;
  }

  const strongholdStore = await createStrongholdStore();

  if (strongholdStore) {
    const { stronghold, store } = strongholdStore;
    await store.remove(STORE_KEY);
    await stronghold.save();
  }

  localStorage.removeItem(BROWSER_KEY);
  await clearCache("users");
};
