import { check, type DownloadEvent, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { isTauriApp } from "./platform";

const UPDATE_CHECK_TIMEOUT_MS = 4000;

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

export const checkForAppUpdate = async (): Promise<Update | null> => {
  if (!isTauriApp()) {
    return null;
  }

  try {
    return await Promise.race<Promise<Update | null>>([
      check({ timeout: UPDATE_CHECK_TIMEOUT_MS }),
      new Promise<null>((resolve) => {
        window.setTimeout(() => resolve(null), UPDATE_CHECK_TIMEOUT_MS);
      }),
    ]);
  } catch {
    return null;
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
