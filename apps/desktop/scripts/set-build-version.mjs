import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const desktopRoot = path.resolve(__dirname, "..");
const version = process.argv[2];

if (!version) {
  throw new Error("Usage: node set-build-version.mjs <version>");
}

const packageJsonPath = path.join(desktopRoot, "package.json");
const tauriConfigPath = path.join(desktopRoot, "src-tauri", "tauri.conf.json");
const cargoTomlPath = path.join(desktopRoot, "src-tauri", "Cargo.toml");

const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
packageJson.version = version;
fs.writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);

const tauriConfig = JSON.parse(fs.readFileSync(tauriConfigPath, "utf8"));
tauriConfig.version = version;
fs.writeFileSync(tauriConfigPath, `${JSON.stringify(tauriConfig, null, 2)}\n`);

const cargoToml = fs.readFileSync(cargoTomlPath, "utf8");
const nextCargoToml = cargoToml.replace(
  /^version = ".*"$/m,
  `version = "${version}"`,
);

fs.writeFileSync(cargoTomlPath, nextCargoToml);

console.log(`Desktop build version set to ${version}`);
