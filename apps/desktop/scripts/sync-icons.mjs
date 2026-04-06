import path from "node:path";
import { desktopRoot, npmCommand, runCommand, tauriRoot } from "./lib/desktop-release.mjs";

const sourceIcon = path.join(desktopRoot, "src", "assets", "op.png");

runCommand({
  command: npmCommand,
  args: ["exec", "--", "tauri", "icon", sourceIcon],
  cwd: tauriRoot,
});
