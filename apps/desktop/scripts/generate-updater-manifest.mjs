import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import {
  detectHostUpdaterPlatformKey,
  getUpdaterArtifactConfig,
} from "./lib/desktop-release.mjs";

const readArgumentValue = (name) => {
  const flag = `--${name}`;
  const index = process.argv.indexOf(flag);

  if (index === -1) {
    return null;
  }

  return process.argv[index + 1] ?? null;
};

const hasFlag = (name) => process.argv.includes(`--${name}`);

const version = readArgumentValue("version");
const platformKey = readArgumentValue("platform-key") ?? detectHostUpdaterPlatformKey();
const repository =
  readArgumentValue("repository") ??
  process.env.GITHUB_REPOSITORY ??
  "opsui/opsui-meetings";
const releaseTag = readArgumentValue("release-tag") ?? (version ? `v${version}` : null);
const notes =
  readArgumentValue("notes") ?? (version ? `Automated desktop update for ${version}` : null);
const config = getUpdaterArtifactConfig(platformKey);
const bundleDir = path.resolve(readArgumentValue("bundle-dir") ?? config.bundleDir);

if (!version) {
  throw new Error(
    "Usage: node generate-updater-manifest.mjs --version <version> [--platform-key <os-arch>] [--repository <owner/repo>] [--release-tag <tag>] [--bundle-dir <dir>] [--write-legacy-windows-manifest]",
  );
}

if (!releaseTag || !notes) {
  throw new Error("Version is required to generate updater manifests.");
}

if (!fs.existsSync(bundleDir)) {
  throw new Error(`Bundle directory not found at ${bundleDir}`);
}

const bundleEntries = fs.readdirSync(bundleDir);
const assetName = bundleEntries
  .filter((entry) => config.fileMatcher.test(entry))
  .sort(
    (left, right) =>
      fs.statSync(path.join(bundleDir, right)).mtimeMs -
      fs.statSync(path.join(bundleDir, left)).mtimeMs,
  )[0];

if (!assetName) {
  throw new Error(`Unable to find an updater artifact for ${platformKey} in ${bundleDir}`);
}

const signaturePath = path.join(bundleDir, `${assetName}.sig`);

if (!fs.existsSync(signaturePath)) {
  throw new Error(`Signature file not found for ${assetName}`);
}

const manifest = {
  version,
  notes,
  pub_date: new Date().toISOString(),
  platforms: {
    [platformKey]: {
      signature: fs.readFileSync(signaturePath, "utf8").trim(),
      url: `https://github.com/${repository}/releases/download/${releaseTag}/${encodeURIComponent(assetName)}`,
    },
  },
};

const manifestPath = path.join(bundleDir, config.manifestName);
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Updater manifest written to ${manifestPath}`);

if (hasFlag("write-legacy-windows-manifest") && config.legacyManifestName) {
  const legacyManifestPath = path.join(bundleDir, config.legacyManifestName);
  fs.writeFileSync(legacyManifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Legacy updater manifest written to ${legacyManifestPath}`);
}
