import { check, type DownloadEvent, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { isTauriApp } from "./platform";

// GitHub redirects releases/latest/download/* to release-assets.githubusercontent.com,
// so a real check routinely needs more than a few seconds on slower links. The old
// 4s race abandoned a still-working check and reported "up to date" by mistake.
const UPDATE_CHECK_TIMEOUT_MS = 30_000;
// Hard stop in case the plugin promise never settles. It REJECTS (surfaced as an
// error + retry) rather than resolving — we must never silently claim "up to date".
const UPDATE_CHECK_SAFETY_MS = 45_000;

// A check has three meaningful outcomes the UI must tell apart: an update is
// waiting, we are confirmed current, or the check itself failed. The previous
// `Update | null` collapsed "failed" into "no update", hiding outages.
export type UpdateCheckResult =
  | { kind: "update"; update: Update }
  | { kind: "current" }
  | { kind: "error"; message: string }
  | { kind: "unsupported" };

export type UpdateState =
  | {
      status: "checking";
    }
  | {
      status: "ready";
    }
  | {
      status: "required";
      update: Update;
      progress: number;
      message: string | null;
    }
  | {
      status: "installing";
      update: Update;
      progress: number;
      message: string | null;
    }
  | {
      status: "error";
      update: Update;
      progress: number;
      message: string;
    };

export const checkForAppUpdate = async (): Promise<UpdateCheckResult> => {
  if (!isTauriApp()) {
    return { kind: "unsupported" };
  }

  try {
    const update = await Promise.race<Promise<Update | null>>([
      check({ timeout: UPDATE_CHECK_TIMEOUT_MS }),
      new Promise<never>((_resolve, reject) => {
        window.setTimeout(
          () => reject(new Error("Update check timed out.")),
          UPDATE_CHECK_SAFETY_MS,
        );
      }),
    ]);

    return update ? { kind: "update", update } : { kind: "current" };
  } catch (error) {
    return {
      kind: "error",
      message:
        error instanceof Error && error.message
          ? error.message
          : "Couldn't reach the release channel.",
    };
  }
};

export const installAppUpdate = async (
  update: Update,
  onProgress: (progress: number) => void,
) => {
  let downloadedBytes = 0;
  let totalBytes = 0;

  await update.downloadAndInstall((event: DownloadEvent) => {
    if (event.event === "Started") {
      totalBytes = event.data.contentLength ?? 0;
    }

    if (event.event === "Progress") {
      downloadedBytes += event.data.chunkLength;
      onProgress(totalBytes ? downloadedBytes / totalBytes : 0.4);
    }

    if (event.event === "Finished") {
      onProgress(1);
    }
  });

  await relaunch();
};
