# OpsUI Meetings Releases

## Release flow

OpsUI Meetings uses Tauri's updater flow with:

- signed updater artifacts
- platform-specific manifests for current builds
- a legacy Windows manifest for already-installed Windows clients
- GitHub Releases as the distribution endpoint

The desktop app blocks normal access when an update is detected and installs the approved release before relaunching.

## Manifest strategy

New desktop builds check:

1. `https://github.com/opsui/opsui-meetings/releases/latest/download/{{target}}-{{arch}}.json`
2. `https://github.com/opsui/opsui-meetings/releases/latest/download/latest.json`

Current manifests:

- `windows-x86_64.json`
- `darwin-aarch64.json`
- `latest.json`
  - maintained for older Windows installs that already shipped with the original single-manifest endpoint

## Automated publishing

The workflow at [`/.github/workflows/publish-desktop-update.yml`](../.github/workflows/publish-desktop-update.yml):

1. calculates a desktop build version from the package minor version and the GitHub Actions run number
2. optionally waits for the API healthcheck
3. builds signed Windows artifacts
4. builds signed macOS artifacts
5. generates updater manifests for each platform
6. publishes all assets to one GitHub Release

### Required GitHub secrets

- `TAURI_SIGNING_PRIVATE_KEY`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`

### Optional GitHub secret

- `RENDER_HEALTHCHECK_URL`

If `RENDER_HEALTHCHECK_URL` is set, the workflow waits for that endpoint to return success before publishing desktop artifacts.

## One-time updater setup

Generate a permanent updater keypair:

```sh
npx tauri signer generate -- --ci -w "$HOME/.tauri/opsui-meetings.key" -p "<strong-password>"
```

Store the public key in [`apps/desktop/src-tauri/tauri.conf.json`](../apps/desktop/src-tauri/tauri.conf.json) under `plugins.updater.pubkey`.

Store the private key securely in CI as:

- `TAURI_SIGNING_PRIVATE_KEY`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`

## Local signed build commands

Windows:

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY_PATH = "$env:USERPROFILE\.tauri\opsui-meetings.key"
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = "<password>"
npm run build:desktop:windows
```

macOS:

```sh
export TAURI_SIGNING_PRIVATE_KEY_PATH="$HOME/.tauri/opsui-meetings.key"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="<password>"
npm run build:desktop:macos
```

## Published artifacts

Windows:

- `OpsUI Meetings Dashboard_<version>_x64-setup.exe`
- `OpsUI Meetings Dashboard_<version>_x64-setup.exe.sig`
- `windows-x86_64.json`
- `latest.json`

macOS:

- `OpsUI Meetings Dashboard.app.tar.gz`
- `OpsUI Meetings Dashboard.app.tar.gz.sig`
- `darwin-aarch64.json`

## Notes

- Keep the same updater private key across releases.
- If the updater private key changes, existing installs will reject future updates.
- macOS release automation currently publishes the `.app.tar.gz` updater artifact rather than a DMG to avoid Finder/AppleScript DMG hangs in automation.
- Apple code signing and notarization are still needed before public rollout.
