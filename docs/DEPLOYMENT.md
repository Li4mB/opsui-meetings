# OpsUI Meetings Deployment

## What ships in this repo

- `apps/desktop`
  - Tauri desktop application for Windows
- `apps/api`
  - Fastify API for auth, user management, meeting sync, and assignment persistence
- `packages/shared`
  - shared DTOs and validation schemas

## Local Development

### 1. Install dependencies

```powershell
npm install
```

### 2. Start the API

Copy [`.env.example`](C:/Users/daabo/OneDrive/Documents/OpsUI/opsui-meetings/apps/api/.env.example) to `.env` inside `apps/api`, then run:

```powershell
npm run dev:api
```

Default local API URL:

- `http://localhost:8787`

Default seed admin:

- username: `opsui-admin`
- password: `ChangeMe123!`

### 3. Start the desktop UI

Copy [`.env.example`](C:/Users/daabo/OneDrive/Documents/OpsUI/opsui-meetings/apps/desktop/.env.example) to `.env` inside `apps/desktop`, then run:

```powershell
npm run dev:desktop
```

## Google Calendar Setup

### Development mode

The API defaults to sample data mode:

- `OPSUI_USE_SAMPLE_DATA=true`

This allows the desktop app to run immediately without external credentials.

### Production mode

Set these API variables:

- `OPSUI_USE_SAMPLE_DATA=false`
- `OPSUI_GOOGLE_CALENDAR_ID=<shared-opsui-calendar-id>`
- `OPSUI_GOOGLE_SERVICE_ACCOUNT_JSON=<single-line-json>`
- `OPSUI_GOOGLE_DRIVE_BRIEFS_FOLDER_ID=<google-drive-folder-id>`

Recommended production setup:

1. Create a dedicated Google service account.
2. Share the OpsUI demo calendar with that service account as a writer.
3. Share the Google Drive briefs folder with that same service account as a viewer.
4. Store the full service-account JSON securely in the API environment.
5. Restart the API.

The API sync logic reads:

- event title
- description
- attendees
- `hangoutLink`
- `htmlLink`

## API Deployment

### Minimum production requirements

- Node.js 24+
- a persistent filesystem location for the SQLite database
- HTTPS exposure or private network access from the OpsUI desktop clients

### Current persistence

By default, the API stores state in:

- `apps/api/data/opsui-meetings.sqlite`

For production, set:

- `OPSUI_DB_PATH=<absolute-path-to-persistent-disk>/opsui-meetings.sqlite`

Example for a mounted persistent disk:

- `OPSUI_DB_PATH=/var/data/opsui-meetings.sqlite`

Without a persistent disk or explicit `OPSUI_DB_PATH`, a redeploy or instance replacement can create a fresh SQLite file. When that happens, server-managed state is lost, including:

- approved users beyond the seeded admin
- meeting assignments
- `past_meetings` records used to keep resolved meetings out of the active list
- sync metadata

For team use, deploy the API on a shared host so all desktop clients see the same:

- approved users
- assignments
- sync state

## Desktop Packaging

### Windows prerequisites

The machine needs:

- Visual Studio 2022 C++ toolchain
- Windows SDK libraries

If the Windows SDK is missing, this command works:

```powershell
winget install --id Microsoft.WindowsSDK.10.0.26100 --accept-source-agreements --accept-package-agreements --disable-interactivity
```

### Build the Windows installer

Run from `apps/desktop` inside a Visual Studio developer environment, or call `vcvars64.bat` first.

Example:

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY = "$env:USERPROFILE\.tauri\opsui-meetings.key"
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = "<password>"
npm run build:signed
```

### Current verified build outputs

- installer: [OpsUI Meetings Dashboard_0.1.1_x64-setup.exe](C:/Users/daabo/OneDrive/Documents/OpsUI/opsui-meetings/apps/desktop/src-tauri/target/release/bundle/nsis/OpsUI%20Meetings%20Dashboard_0.1.1_x64-setup.exe)
- signature: [OpsUI Meetings Dashboard_0.1.1_x64-setup.exe.sig](C:/Users/daabo/OneDrive/Documents/OpsUI/opsui-meetings/apps/desktop/src-tauri/target/release/bundle/nsis/OpsUI%20Meetings%20Dashboard_0.1.1_x64-setup.exe.sig)
- raw exe: [opsui-meetings.exe](C:/Users/daabo/OneDrive/Documents/OpsUI/opsui-meetings/apps/desktop/src-tauri/target/release/opsui-meetings.exe)

## Security Notes

- API passwords are stored as Argon2 hashes
- desktop sessions are stored locally in Stronghold
- cached meetings and users are stored in local SQLite
- the public updater key is safe to ship
- the private updater key must never be committed
- user-level signing env vars are acceptable for local builds, but CI secrets are preferred for release automation

## Important production follow-up

Make sure the same updater private key is preserved in GitHub secrets for all future releases. Existing desktop installs will only accept updates signed by the matching public key already shipped in [tauri.conf.json](C:/Users/daabo/OneDrive/Documents/OpsUI/opsui-meetings/apps/desktop/src-tauri/tauri.conf.json).
