import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const desktopRoot = path.resolve(__dirname, "..");

const version = process.argv[2];
const repository = process.argv[3] ?? process.env.GITHUB_REPOSITORY ?? "opsui/opsui-meetings";
const releaseTag = process.argv[4] ?? `v${version}`;
const bundleDir =
  process.argv[5] ??
  path.join(desktopRoot, "src-tauri", "target", "release", "bundle", "nsis");

if (!version) {
  throw new Error("Usage: node generate-updater-manifest.mjs <version> [repository] [releaseTag] [bundleDir]");
}

const bundleEntries = fs.readdirSync(bundleDir);
const installerName = bundleEntries.find((entry) => /-setup\.exe$/i.test(entry));

if (!installerName) {
  throw new Error(`Unable to find NSIS installer in ${bundleDir}`);
}

const signaturePath = path.join(bundleDir, `${installerName}.sig`);

if (!fs.existsSync(signaturePath)) {
  throw new Error(`Signature file not found for ${installerName}`);
}

const signature = fs.readFileSync(signaturePath, "utf8").trim();
const encodedInstallerName = encodeURIComponent(installerName);

const manifest = {
  version,
  notes: `Automated desktop update for ${version}`,
  pub_date: new Date().toISOString(),
  platforms: {
    "windows-x86_64": {
      signature,
      url: `https://github.com/${repository}/releases/download/${releaseTag}/${encodedInstallerName}`,
    },
  },
};

const outputPath = path.join(bundleDir, "latest.json");
fs.writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`Updater manifest written to ${outputPath}`);
