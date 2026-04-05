import process from "node:process";
import {
  ensureSigningEnvironment,
  runTauriBuild,
} from "./lib/desktop-release.mjs";

const EXPECTED_PLATFORM_ALIASES = new Map([
  ["windows", "win32"],
  ["win32", "win32"],
  ["macos", "darwin"],
  ["darwin", "darwin"],
  ["linux", "linux"],
]);

const args = process.argv.slice(2);
const tauriArgs = [];
let expectedPlatform = null;

for (let index = 0; index < args.length; index += 1) {
  const argument = args[index];

  if (argument === "--expect-platform") {
    expectedPlatform = args[index + 1] ?? null;
    index += 1;
    continue;
  }

  tauriArgs.push(argument);
}

if (expectedPlatform) {
  const normalizedExpectedPlatform = EXPECTED_PLATFORM_ALIASES.get(expectedPlatform);

  if (!normalizedExpectedPlatform) {
    throw new Error(`Unsupported expected platform "${expectedPlatform}".`);
  }

  if (normalizedExpectedPlatform !== process.platform) {
    throw new Error(
      `This build must run on ${expectedPlatform}, but the current host is ${process.platform}.`,
    );
  }
}

ensureSigningEnvironment();
runTauriBuild(tauriArgs);
