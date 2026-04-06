import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ARCH_ALIASES = new Map([
  ["x64", "x86_64"],
  ["arm64", "aarch64"],
  ["ia32", "i686"],
  ["arm", "armv7"],
]);

const PLATFORM_ALIASES = new Map([
  ["win32", "windows"],
  ["darwin", "darwin"],
  ["linux", "linux"],
]);

export const desktopRoot = path.resolve(__dirname, "..", "..");
export const tauriRoot = path.join(desktopRoot, "src-tauri");
export const bundleRoot = path.join(tauriRoot, "target", "release", "bundle");
export const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

export const normalizeUpdaterArch = (arch) => {
  const normalized = ARCH_ALIASES.get(arch);

  if (!normalized) {
    throw new Error(`Unsupported architecture "${arch}" for updater artifacts.`);
  }

  return normalized;
};

export const normalizeUpdaterOs = (platform) => {
  const normalized = PLATFORM_ALIASES.get(platform);

  if (!normalized) {
    throw new Error(`Unsupported platform "${platform}" for updater artifacts.`);
  }

  return normalized;
};

export const detectHostUpdaterPlatformKey = () =>
  `${normalizeUpdaterOs(process.platform)}-${normalizeUpdaterArch(process.arch)}`;

export const getUpdaterArtifactConfig = (platformKey) => {
  const [os] = platformKey.split("-", 1);

  if (os === "windows") {
    return {
      bundleDir: path.join(bundleRoot, "nsis"),
      fileMatcher: /-setup\.exe$/i,
      legacyManifestName: "latest.json",
      manifestName: `${platformKey}.json`,
    };
  }

  if (os === "darwin") {
    return {
      bundleDir: path.join(bundleRoot, "macos"),
      fileMatcher: /\.app\.tar\.gz$/i,
      legacyManifestName: null,
      manifestName: `${platformKey}.json`,
    };
  }

  throw new Error(`Unsupported updater platform key "${platformKey}".`);
};

export const resolveSigningKeyContent = () => {
  if (process.env.TAURI_SIGNING_PRIVATE_KEY) {
    return process.env.TAURI_SIGNING_PRIVATE_KEY;
  }

  const keyPath = process.env.TAURI_SIGNING_PRIVATE_KEY_PATH;

  if (!keyPath) {
    return null;
  }

  const resolvedKeyPath = path.resolve(keyPath);

  if (!fs.existsSync(resolvedKeyPath)) {
    throw new Error(`Tauri signing key file not found at ${resolvedKeyPath}`);
  }

  return fs.readFileSync(resolvedKeyPath, "utf8");
};

export const ensureSigningEnvironment = () => {
  const signingKeyContent = resolveSigningKeyContent();

  if (!signingKeyContent) {
    throw new Error(
      "Set TAURI_SIGNING_PRIVATE_KEY or TAURI_SIGNING_PRIVATE_KEY_PATH before building desktop release artifacts.",
    );
  }

  process.env.TAURI_SIGNING_PRIVATE_KEY = signingKeyContent;
};

export const runCommand = ({
  command,
  args,
  cwd = desktopRoot,
  env,
  shell = false,
}) => {
  const result = spawnSync(command, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: "inherit",
    shell,
  });

  if (typeof result.status === "number" && result.status !== 0) {
    throw new Error(`${command} exited with code ${result.status}`);
  }

  if (result.error) {
    throw result.error;
  }
};

const quoteForCmd = (value) =>
  /[\s"&|^<>]/.test(value)
    ? `"${value.replace(/"/g, '""')}"`
    : value;

export const findWindowsVcvars = () => {
  if (process.platform !== "win32") {
    return null;
  }

  const programFilesX86 =
    process.env["ProgramFiles(x86)"] ?? process.env.ProgramFiles ?? "C:\\Program Files (x86)";
  const vswherePath = path.join(
    programFilesX86,
    "Microsoft Visual Studio",
    "Installer",
    "vswhere.exe",
  );

  if (fs.existsSync(vswherePath)) {
    const result = spawnSync(
      vswherePath,
      [
        "-latest",
        "-products",
        "*",
        "-requires",
        "Microsoft.VisualStudio.Component.VC.Tools.x86.x64",
        "-property",
        "installationPath",
      ],
      {
        encoding: "utf8",
      },
    );

    if (result.status === 0) {
      const installationPath = result.stdout.trim();

      if (installationPath) {
        const candidate = path.join(
          installationPath,
          "VC",
          "Auxiliary",
          "Build",
          "vcvars64.bat",
        );

        if (fs.existsSync(candidate)) {
          return candidate;
        }
      }
    }
  }

  const candidates = [
    "C:\\Program Files\\Microsoft Visual Studio\\2022\\Community\\VC\\Auxiliary\\Build\\vcvars64.bat",
    "C:\\Program Files\\Microsoft Visual Studio\\2022\\Professional\\VC\\Auxiliary\\Build\\vcvars64.bat",
    "C:\\Program Files\\Microsoft Visual Studio\\2022\\Enterprise\\VC\\Auxiliary\\Build\\vcvars64.bat",
    "C:\\Program Files\\Microsoft Visual Studio\\2022\\BuildTools\\VC\\Auxiliary\\Build\\vcvars64.bat",
  ];

  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
};

export const runTauriBuild = (extraArgs = []) => {
  if (process.platform !== "win32") {
    runCommand({
      command: npmCommand,
      args: ["run", "tauri", "build", "--", ...extraArgs],
    });
    return;
  }

  const vcvarsPath = findWindowsVcvars();

  if (!vcvarsPath) {
    runCommand({
      command: npmCommand,
      args: ["run", "tauri", "build", "--", ...extraArgs],
    });
    return;
  }

  const tauriArgs = extraArgs.map(quoteForCmd).join(" ");
  const tauriCommand = [
    "call",
    quoteForCmd(vcvarsPath),
    "&&",
    "npm",
    "run",
    "tauri",
    "build",
    ...(tauriArgs ? ["--", tauriArgs] : []),
  ].join(" ");

  runCommand({
    command: "cmd.exe",
    args: ["/d", "/s", "/c", tauriCommand],
  });
};
