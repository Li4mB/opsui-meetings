import type { Meeting } from "@opsui/shared";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { isTauriApp } from "./platform";

/**
 * OS desktop-notification helper.
 *
 * Only does anything inside the Tauri shell (the notification plugin is a
 * native capability; in a plain browser it is a no-op). Permission is requested
 * lazily and cached so we don't prompt repeatedly.
 */

type PermissionState = "unknown" | "granted" | "denied";
let permissionState: PermissionState = "unknown";

export async function ensureNotificationPermission(): Promise<boolean> {
  if (!isTauriApp()) {
    return false;
  }

  if (permissionState === "granted") {
    return true;
  }
  if (permissionState === "denied") {
    return false;
  }

  try {
    let granted = await isPermissionGranted();
    if (!granted) {
      const result = await requestPermission();
      granted = result === "granted";
    }
    permissionState = granted ? "granted" : "denied";
    return granted;
  } catch {
    permissionState = "denied";
    return false;
  }
}

function meetingLabel(meeting: Meeting): string {
  return (
    meeting.clientName?.trim() ||
    meeting.company?.trim() ||
    meeting.title?.trim() ||
    "New meeting"
  );
}

/**
 * Show a notification for one or more newly-arrived meetings. A single new
 * meeting gets a detailed toast; several are digested into one toast to avoid
 * spamming the user when a batch syncs in at once.
 */
export async function notifyNewMeetings(meetings: Meeting[]): Promise<void> {
  if (!isTauriApp() || meetings.length === 0) {
    return;
  }

  const granted = await ensureNotificationPermission();
  if (!granted) {
    return;
  }

  try {
    if (meetings.length === 1) {
      const meeting = meetings[0];
      const who = meetingLabel(meeting);
      const company =
        meeting.company && meeting.clientName ? ` · ${meeting.company}` : "";
      sendNotification({
        title: "New meeting",
        body: `${who}${company}`,
      });
      return;
    }

    const preview = meetings.slice(0, 3).map(meetingLabel).join(", ");
    const more = meetings.length > 3 ? "…" : "";
    sendNotification({
      title: `${meetings.length} new meetings`,
      body: `${preview}${more}`,
    });
  } catch {
    // Notification failures should never break the sync flow.
  }
}
