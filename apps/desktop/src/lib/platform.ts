import { isTauri } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Webview } from "@tauri-apps/api/webview";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";

const CURRENT_MEETING_WINDOW_LABEL = "current-meeting";
const EMBEDDED_MEETING_VIEW_LABEL = "current-meeting-embedded";

export const isTauriApp = () => {
  try {
    return isTauri();
  } catch {
    return false;
  }
};

export const viewerTimeZone =
  Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

export const openExternalUrl = async (url: string) => {
  if (!url) {
    return;
  }

  if (isTauriApp()) {
    await openUrl(url);
    return;
  }

  window.open(url, "_blank", "noopener,noreferrer");
};

export const openCurrentMeetingWindow = async (url: string) => {
  if (!url) {
    return;
  }

  if (!isTauriApp()) {
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }

  const existing = await WebviewWindow.getByLabel(CURRENT_MEETING_WINDOW_LABEL);

  if (existing) {
    await existing.close().catch(() => null);
  }

  const meetingWindow = new WebviewWindow(CURRENT_MEETING_WINDOW_LABEL, {
    url,
    title: "OpsUI Meetings Dashboard - Current Meeting",
    width: 1380,
    height: 920,
    minWidth: 1080,
    minHeight: 720,
    center: true,
    focus: true,
    resizable: true,
    dataDirectory: "current-meeting-profile",
  });

  await Promise.race([
    new Promise<void>((resolve, reject) => {
      void meetingWindow.once("tauri://created", () => resolve());
      void meetingWindow.once("tauri://error", (event) => reject(event));
    }),
    new Promise<void>((resolve) => {
      window.setTimeout(() => resolve(), 1500);
    }),
  ]).catch(() => null);

  await meetingWindow.setFocus().catch(() => null);
};

export const closeEmbeddedCurrentMeetingView = async () => {
  if (!isTauriApp()) {
    return;
  }

  const embeddedView = await Webview.getByLabel(EMBEDDED_MEETING_VIEW_LABEL);

  if (!embeddedView) {
    return;
  }

  await embeddedView.close().catch(() => null);
};

export const focusCurrentMeetingWindow = async () => {
  if (!isTauriApp()) {
    return;
  }

  const existing = await WebviewWindow.getByLabel(CURRENT_MEETING_WINDOW_LABEL);

  if (!existing) {
    return;
  }

  await existing.show().catch(() => null);
  await existing.setFocus().catch(() => null);
};

export const closeCurrentMeetingWindow = async () => {
  if (!isTauriApp()) {
    return;
  }

  const existing = await WebviewWindow.getByLabel(CURRENT_MEETING_WINDOW_LABEL);

  if (!existing) {
    return;
  }

  await existing.close().catch(() => null);
};
