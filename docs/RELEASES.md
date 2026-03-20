# OpsUI Meetings Releases

## Release Flow

OpsUI Meetings uses Tauri's updater flow with:

- a signed Windows installer
- a `.sig` signature file
- a remote update endpoint configured in [tauri.conf.json](C:/Users/daabo/OneDrive/Documents/OpsUI/opsui-meetings/apps/desktop/src-tauri/tauri.conf.json)

The app blocks normal access when an update is detected and installs the update before relaunching.

## Automated publishing

This repo now includes [publish-desktop-update.yml](C:/Users/daabo/OneDrive/Documents/OpsUI/opsui-meetings/.github/workflows/publish-desktop-update.yml), which:

1. runs on every push to `main`
2. assigns the desktop build a monotonically increasing version based on the GitHub Actions run number
3. builds a signed Windows installer
4. generates `latest.json`
5. publishes the installer, signature, and manifest to a GitHub Release

The desktop app checks that release feed on startup and automatically installs any newer approved release before launching the workspace.

### Required GitHub secrets

- `TAURI_SIGNING_PRIVATE_KEY`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`

### Optional GitHub secret

- `RENDER_HEALTHCHECK_URL`

If `RENDER_HEALTHCHECK_URL` is set, the workflow waits for that endpoint to return a successful response before publishing the desktop release. This is the cleanest way in this repo to keep desktop updates aligned with a healthy Render deployment.

## One-time setup

### 1. Generate a permanent updater keypair

```powershell
npx tauri signer generate -- --ci -w "$env:USERPROFILE\.tauri\opsui-meetings.key" -p "<strong-password>"
```

### 2. Put the public key in Tauri config

Update:

- [tauri.conf.json](C:/Users/daabo/OneDrive/Documents/OpsUI/opsui-meetings/apps/desktop/src-tauri/tauri.conf.json)

Field:

- `plugins.updater.pubkey`

### 3. Store the private key securely

Use CI/CD or user environment variables for:

- `TAURI_SIGNING_PRIVATE_KEY_PATH`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`

## Build command

From `apps/desktop`:

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY_PATH = "$env:USERPROFILE\.tauri\opsui-meetings-dashboard.key"
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = "<password>"
npm run build:signed
```

## Artifacts to publish

From `apps/desktop/src-tauri/target/release/bundle/nsis`:

- `OpsUI Meetings Dashboard_<version>_x64-setup.exe`
- `OpsUI Meetings Dashboard_<version>_x64-setup.exe.sig`

## Static update manifest

The desktop app can use a static `latest.json` file hosted on GitHub Releases or another HTTPS endpoint.

Example manifest:

```json
{
  "version": "0.1.0",
  "notes": "Initial internal OpsUI Meetings Dashboard release",
  "pub_date": "2026-03-14T00:00:00Z",
  "platforms": {
    "windows-x86_64": {
      "signature": "CONTENTS OF THE .sig FILE",
      "url": "https://github.com/opsui/opsui-meetings/releases/download/v0.1.0/OpsUI%20Meetings%20Dashboard_0.1.0_x64-setup.exe"
    }
  }
}
```

## Recommended publishing flow

1. Push to `main`.
2. Let Render complete a healthy deploy.
3. Let the GitHub Action publish the signed installer, `.sig`, and `latest.json`.
4. Launch an existing desktop install and confirm it auto-downloads the newer release.

## Notes

- The updater only works with signed artifacts.
- Keep the same private key across releases.
- If the private key changes, already-installed clients will reject future updates.
