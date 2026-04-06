# Render First Rollout Checklist

Use this rollout for the first deployment of the current branch.

Goal:

- deploy the new API and desktop-compatible auth bootstrap
- keep existing Render logins working
- avoid an unsafe cutover from the current Render SQLite database to Supabase

## Render service settings

- Service type: `Web Service`
- Root directory: repo root
- Runtime: `Node`
- Node version: `22`
- Build command:

```sh
npm install && npm run build --workspace @opsui/api
```

- Start command:

```sh
npm run start --workspace @opsui/api
```

## Persistent disk

Attach a Render persistent disk if the service does not already have one.

- Mount path: `/var/data`

Set:

```env
OPSUI_DB_PATH=/var/data/opsui-meetings.sqlite
```

Important:

- keep this pointed at the same persistent disk path the current Render service
  already uses
- do not switch the production service to a fresh empty SQLite path

## Environment variables to set

These are the safe production values for the first rollout:

```env
NODE_VERSION=22
PORT=10000
JWT_SECRET=<existing-production-secret>
OPSUI_USE_SAMPLE_DATA=false
OPSUI_SEED_ADMIN_USERNAME=opsui-admin
OPSUI_SEED_ADMIN_PASSWORD=<existing-seed-admin-password-or-ChangeMe123!>
OPSUI_SEED_ADMIN_DISPLAY_NAME=OpsUI Admin
OPSUI_DB_PROVIDER=sqlite
OPSUI_DB_PATH=/var/data/opsui-meetings.sqlite
OPSUI_GOOGLE_CALENDAR_ID=<existing-production-value>
OPSUI_GOOGLE_SERVICE_ACCOUNT_JSON=<existing-production-value>
OPSUI_GOOGLE_DRIVE_BRIEFS_FOLDER_ID=<existing-production-value>
OPENAI_API_KEY=<existing-production-value>
OPSUI_OPENAI_MODEL=gpt-5.2
OPSUI_OPENAI_VECTOR_STORE_ID=<existing-production-value-if-used>
OPSUI_MAKE_MEETING_REQUEST_WEBHOOK_URL=<existing-production-value-if-used>
```

## Environment variables to leave unset

Do not set any of these on the first rollout:

```env
OPSUI_DB_URL
SUPABASE_DB_URL
POSTGRES_URL
DATABASE_URL
```

Why:

- the current live users appear to live in the existing Render-backed app data
- the new Supabase `opsui.users` table currently only contains `opsui-admin`
- a direct production cutover to Supabase would risk breaking existing internal
  logins

## Desktop app environment

The desktop app should keep pointing at the OpsUI API host, not at the raw
Supabase project URL.

Example:

```env
VITE_OPSUI_API_BASE_URL=https://opsui-meetings.onrender.com
```

## Deploy verification

After the Render deploy finishes, verify these in order:

1. `GET /health` returns `status: ok`
2. `POST /auth/login` works for an existing non-seed internal user
3. `GET /auth/bootstrap` returns the expected approved users on a fresh device
4. `GET /users` still returns the current team after admin login
5. meeting sync still works
6. the desktop app can sign in on a new machine without first logging in as
   `opsui-admin`

## Do not do this yet

Do not cut the production Render service over to Supabase until one of these is
true:

- the current Render SQLite database has been exported and migrated with
  password hashes preserved
- all existing internal users are intentionally getting new passwords
- a staged legacy-login migration flow has been added
