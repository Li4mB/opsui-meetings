# OpsUI Meetings Deployment

See also:

- [`RENDER_FIRST_ROLLOUT.md`](./RENDER_FIRST_ROLLOUT.md) for the safest first
  production deploy path on Render

## What ships in this repo

- `apps/desktop`
  - Tauri desktop application for Windows and macOS
- `apps/api`
  - Fastify API for auth, user management, meeting sync, and assignment persistence
- `packages/shared`
  - shared DTOs and validation schemas

## Local development

### 1. Install dependencies

```sh
npm install
```

### 2. Start the API

Copy [`apps/api/.env.example`](../apps/api/.env.example) to `apps/api/.env`, then run:

```sh
npm run dev:api
```

Default local API URL:

- `http://localhost:8787`

Default seed admin:

- username: `opsui-admin`
- password: `ChangeMe123!`

### 3. Start the desktop UI

Copy [`apps/desktop/.env.example`](../apps/desktop/.env.example) to `apps/desktop/.env`.

Web UI only:

```sh
npm run dev:desktop
```

Native desktop shell:

```sh
npm run dev:desktop:tauri
```

## Google Calendar setup

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

## API deployment

### Minimum production requirements

- Node.js 22+
- a persistent filesystem location for the SQLite database
- HTTPS exposure or private network access from the OpsUI desktop clients

### Current persistence

By default, local development stores API state in:

- `apps/api/data/opsui-meetings.sqlite`

For local SQLite persistence, set:

- `OPSUI_DB_PATH=<absolute-path-to-persistent-disk>/opsui-meetings.sqlite`

Example:

- `OPSUI_DB_PATH=/var/data/opsui-meetings.sqlite`

### Recommended production persistence

For production, use Supabase Postgres behind the same OpsUI API routes.

Set:

- `OPSUI_DB_PROVIDER=supabase`
- `OPSUI_DB_URL=<supabase-postgres-connection-string>`
- `OPSUI_DB_SSL=true`
- `OPSUI_DB_SCHEMA=opsui`

Important:

- the desktop app should still call the OpsUI API host
- do not point `VITE_OPSUI_API_BASE_URL` at the raw `https://<project-ref>.supabase.co` URL
- the Supabase project URL is not a drop-in replacement for the Fastify API routes
- the API uses a dedicated `opsui` Postgres schema so it does not collide with existing Supabase `public` tables

For team use, deploy the API on a shared host so all desktop clients see the same:

- approved users
- assignments
- sync state

### Render rollout recommendation

If your current Render deployment already has live users and passwords in its
existing SQLite database, keep Render on that SQLite storage for the first
deployment of this branch.

Recommended first rollout:

1. Push the code changes.
2. Deploy the Render service without setting `OPSUI_DB_URL`,
   `SUPABASE_DB_URL`, `POSTGRES_URL`, or `DATABASE_URL`.
3. Keep `OPSUI_DB_PATH` pointed at the same persistent disk path the current
   Render service already uses.
4. Verify that existing internal users can still log in after deploy.

Why:

- existing user password hashes cannot be recovered through the current public
  API alone
- switching Render directly from SQLite to Supabase without a password-aware
  migration would strand existing internal accounts
- this branch already includes the pre-login account bootstrap, so users can be
  shown on a fresh install without requiring an `opsui-admin` bootstrap login

Only cut Render over to Supabase after one of these is true:

- you have direct access to the current Render SQLite database and can migrate
  password hashes safely
- you are intentionally resetting passwords for all existing internal accounts
- you introduce a staged legacy-login migration flow and keep the legacy backend
  reachable during the transition

## Desktop packaging

### Shared prerequisites

- Node.js 22+
- Rust stable
- Tauri updater signing key and password

### Windows build prerequisites

- Visual Studio 2022 C++ toolchain
- Windows SDK libraries

Build the Windows installer from the repo root:

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY_PATH = "$env:USERPROFILE\.tauri\opsui-meetings.key"
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = "<password>"
npm run build:desktop:windows
```

### macOS build prerequisites

- Xcode Command Line Tools

Build the macOS app bundle from the repo root:

```sh
export TAURI_SIGNING_PRIVATE_KEY_PATH="$HOME/.tauri/opsui-meetings.key"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="<password>"
npm run build:desktop:macos
```

### Current bundle outputs

Windows:

- `apps/desktop/src-tauri/target/release/bundle/nsis/*.exe`
- `apps/desktop/src-tauri/target/release/bundle/nsis/*.sig`

macOS:

- `apps/desktop/src-tauri/target/release/bundle/macos/*.app`
- `apps/desktop/src-tauri/target/release/bundle/macos/*.app.tar.gz`
- `apps/desktop/src-tauri/target/release/bundle/macos/*.sig`

## Security notes

- API passwords are stored as Argon2 hashes
- desktop sessions are stored locally in Stronghold
- cached meetings and users are stored in local SQLite
- the public updater key is safe to ship
- the private updater key must never be committed

## Important production follow-up

Keep the same updater private key across releases. Existing desktop installs only accept updates signed by the matching public key in [`apps/desktop/src-tauri/tauri.conf.json`](../apps/desktop/src-tauri/tauri.conf.json).

DMG packaging is intentionally not part of the default automated macOS build because Tauri's Finder/AppleScript DMG step is unreliable in non-interactive automation. Apple code signing and notarization are still needed before public rollout.
