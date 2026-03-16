# OpsUI Meetings Releases

## Release Flow

OpsUI Meetings uses Tauri's updater flow with:

- a signed Windows installer
- a `.sig` signature file
- a remote update endpoint configured in [tauri.conf.json](C:/Users/daabo/OneDrive/Documents/OpsUI/opsui-meetings/apps/desktop/src-tauri/tauri.conf.json)

The app blocks normal access when an update is detected and installs the update before relaunching.

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

- `TAURI_SIGNING_PRIVATE_KEY`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`

## Build command

From `apps/desktop`:

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY = "$env:USERPROFILE\.tauri\opsui-meetings.key"
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = "<password>"
npm run build:signed
```

## Artifacts to publish

From `apps/desktop/src-tauri/target/release/bundle/nsis`:

- `OpsUI Meetings_<version>_x64-setup.exe`
- `OpsUI Meetings_<version>_x64-setup.exe.sig`

## Static update manifest

The desktop app can use a static `latest.json` file hosted on GitHub Releases or another HTTPS endpoint.

Example manifest:

```json
{
  "version": "0.1.0",
  "notes": "Initial internal OpsUI Meetings release",
  "pub_date": "2026-03-14T00:00:00Z",
  "platforms": {
    "windows-x86_64": {
      "signature": "CONTENTS OF THE .sig FILE",
      "url": "https://github.com/opsui/opsui-meetings/releases/download/v0.1.0/OpsUI%20Meetings_0.1.0_x64-setup.exe"
    }
  }
}
```

## Recommended publishing flow

1. Bump app version in desktop `package.json` and `src-tauri/tauri.conf.json`.
2. Build the installer with signing enabled.
3. Upload the installer and `.sig` file to a GitHub Release or internal HTTPS storage.
4. Publish `latest.json` to the configured updater endpoint.
5. Launch the app on a test machine with an older version and confirm the forced update gate appears.

## Notes

- The updater only works with signed artifacts.
- Keep the same private key across releases.
- If the private key changes, already-installed clients will reject future updates.
