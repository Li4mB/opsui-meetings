# OpsUI Meetings Technical Plan

## 1. Product Goal

Build a polished Windows desktop application for the OpsUI team to view and manage demo bookings sourced from Google Calendar. The application must:

- ship as a standalone Windows `.exe`
- authenticate only approved internal users
- support admin management of internal credentials
- cache previously synced meetings for offline use
- force users onto the latest released version
- provide a fast, modern dark-mode experience for day-to-day internal operations

## 2. Recommended Architecture

### Decision

Use a two-part system:

1. `OpsUI Meetings Desktop`
   - Tauri v2 desktop shell
   - React + TypeScript UI
   - local SQLite cache for offline data
2. `OpsUI Meetings API`
   - Fastify + TypeScript service
   - central auth, user management, assignment persistence, and Google Calendar sync

### Why this architecture

This app could technically talk to Google Calendar directly from the desktop client, but that would require shipping Google credentials inside the `.exe`. That is a poor security tradeoff for an internal tool that also needs central user administration. A small API gives us:

- central approved-user management
- central meeting assignment state shared across all users
- no Google service-account secret in the desktop bundle
- cleaner forced-update enforcement
- simpler auditability and easier future expansion

## 3. Tech Stack Recommendation

### Desktop

- `Tauri v2`
  - best fit for a lightweight Windows `.exe`
  - native installer and updater support
  - lower memory footprint than Electron
- `React 19 + TypeScript`
  - fast UI development and strong typing
- `Vite`
  - quick local iteration and small bundle overhead
- `Zustand`
  - minimal app state management
- `TanStack Query`
  - syncs server data cleanly while supporting refresh and stale cache handling
- `FullCalendar`
  - robust calendar/list views in a business app context
- `date-fns` + `date-fns-tz`
  - timezone formatting and viewer-local rendering
- `Tauri SQL plugin (SQLite)`
  - local offline cache for meetings, user preferences, and last sync metadata
- `Tauri Stronghold plugin`
  - secure storage for auth token and sensitive local secrets

### API

- `Node.js + Fastify + TypeScript`
  - fast startup, simple internal API surface, easy deployment
- `better-sqlite3`
  - lightweight internal database for initial deployment
  - can be swapped for PostgreSQL later without changing desktop contracts
- `argon2`
  - password hashing for approved users
- `jose`
  - signed session tokens
- `googleapis`
  - Google Calendar integration
- `zod`
  - request/response validation shared with the desktop app

### Packaging / Delivery

- `Tauri bundle` to produce Windows installer `.exe`
- `Tauri updater`
  - signed updates
  - static manifest hosted on GitHub Releases or an internal HTTPS URL
- `GitHub Actions` or internal CI
  - build desktop bundle
  - sign updater artifacts
  - publish update manifest

## 4. Security Model

### Authentication

- Users log in with internal OpsUI username/password, not Google OAuth
- Passwords are never stored in plaintext
- API stores only Argon2 password hashes
- One seeded admin user is created during API bootstrap
- Admin can add, disable, and remove approved users

### Authorization

- `admin`
  - manage users
  - manage assignees
  - trigger full sync
- `member`
  - view meetings
  - assign meetings to self or other visible users

### Google Access

- API authenticates to Google Calendar using a service account
- preferred setup:
  - dedicated shared OpsUI demo calendar
  - service account granted read/write access
- if the calendar is domain-owned:
  - support domain-wide delegation later if required

### Local Storage

- auth token stored in Stronghold
- cached meetings stored in local SQLite
- no raw password persisted after login

## 5. Core Data Model

### User

- `id`
- `username`
- `displayName`
- `role` (`admin` | `member`)
- `passwordHash`
- `colorHex`
- `active`
- `createdAt`
- `updatedAt`

### Meeting

- `id`
- `googleEventId`
- `title`
- `clientName`
- `company`
- `country`
- `meetingType`
- `startAtUtc`
- `endAtUtc`
- `sourceTimezone`
- `googleMeetUrl`
- `googleDocUrl`
- `clientEmail`
- `phone`
- `companySize`
- `modulesOfInterest`
- `descriptionRaw`
- `calendarHtmlUrl`
- `assignedUserId`
- `updatedAt`
- `lastSyncedAt`

### Sync Metadata

- `id`
- `calendarId`
- `syncToken` or `updatedMin`
- `lastSuccessfulSyncAt`

## 6. Meeting Parsing Rules

Google Calendar event conventions:

- title format:
  - `OpsUI Intro - [Name] - [Company]`
- `hangoutLink` becomes Google Meet URL
- description is parsed for:
  - Google Doc brief link
  - phone
  - company size
  - modules of interest
  - country
  - meeting type
- attendees are scanned for likely client email

Parsing strategy:

- use regex and label-based extraction
- preserve the original description in case parsing fails
- surface partially parsed meetings instead of dropping them

## 7. UX / Product Decisions

### Primary Views

- login screen
- dashboard with:
  - calendar view
  - list view
  - filters
  - sync status
  - upcoming meetings summary
- meeting detail drawer
- admin user management screen

### Dark UI Direction

- slate/charcoal background
- cool blue and teal accents
- muted panels with high-contrast text
- strong spacing and table readability
- subtle gradients rather than a flat dark slab

### Assignment Experience

- each user gets a color
- assigned meeting pill, border, and calendar accent use that color
- quick assign dropdown in list cards and details drawer

### Offline Behavior

- last successful sync loads immediately from SQLite
- stale/offline indicator shown in app shell
- sync button retries live refresh when network returns

## 8. Auto-Update Design

### Decision

Use Tauri updater with a signed static manifest.

### Flow

1. App launches
2. Before showing the main app shell, it checks remote update metadata
3. If a newer version exists:
   - show blocking update screen
   - disable normal app access
   - download and install update automatically where possible
4. If no update exists:
   - continue boot sequence

### Hosting

- initial recommendation:
  - GitHub Releases with static JSON manifest
- internal alternative:
  - HTTPS-hosted manifest on an OpsUI-controlled server

## 9. Proposed Project Structure

```text
opsui-meetings/
  apps/
    desktop/
      src/
        app/
        components/
        features/
          auth/
          meetings/
          admin/
          updater/
        hooks/
        lib/
        styles/
        types/
      src-tauri/
        src/
        icons/
        tauri.conf.json
    api/
      src/
        config/
        db/
        modules/
          auth/
          users/
          meetings/
          sync/
          health/
        plugins/
        utils/
      data/
  packages/
    shared/
      src/
        schemas/
        contracts/
        constants/
  docs/
    TECHNICAL_PLAN.md
    DEPLOYMENT.md
    RELEASES.md
```

## 10. API Contract Outline

### Auth

- `POST /auth/login`
- `POST /auth/logout`
- `GET /auth/me`

### Users

- `GET /users`
- `POST /users`
- `PATCH /users/:id`
- `DELETE /users/:id`

### Meetings

- `GET /meetings`
  - supports filters:
    - `country`
    - `assignedUserId`
    - `from`
    - `to`
- `GET /meetings/:id`
- `PATCH /meetings/:id/assignment`
- `POST /meetings/sync`

### Ops

- `GET /health`
- `GET /release-config`

## 11. Desktop App Modules

### Boot

- verify update requirement
- restore secure session
- load cached meetings
- attempt background sync

### Auth Module

- login form
- remember active session token securely
- route guard for authenticated areas

### Meetings Module

- calendar/list toggle
- filter sidebar
- detail drawer
- assignment actions
- sync button
- stale/offline states

### Admin Module

- users table
- create user modal
- edit role/color/status
- remove user action

## 12. Implementation Steps

### Phase 1: Foundation

1. Create monorepo with npm workspaces
2. Scaffold Tauri desktop app and Fastify API
3. Add shared TypeScript package for schemas and DTOs
4. Add env templates and docs

### Phase 2: API

1. Build SQLite database bootstrap
2. Add seeded admin creation on first run
3. Implement auth endpoints with Argon2
4. Implement user CRUD
5. Implement Google Calendar sync service
6. Parse event description into structured meeting fields
7. Persist assignments and sync metadata

### Phase 3: Desktop

1. Build app shell and theme system
2. Build login screen
3. Build cached meeting repository with SQLite
4. Build meeting list and calendar views
5. Build detail drawer and assignment actions
6. Build filters and local timezone rendering
7. Build admin user management screens

### Phase 4: Release / Ops

1. Configure updater
2. Add blocking update gate
3. Add release manifest generation docs
4. Build Windows installer
5. Validate offline startup and sync recovery

## 13. Delivery Decisions For This Build

For this repository build, implement:

- full desktop app codebase
- full internal API codebase
- local SQLite-backed API for development and small-team deployment
- Windows packaging configuration for Tauri
- update-check plumbing with environment-configurable manifest URL
- documentation for production configuration

## 14. Known Tradeoffs

- A true centrally managed system requires the API to be deployed somewhere reachable by all desktop clients
- Google Calendar sync cannot be fully exercised without valid service-account credentials and a real calendar ID
- automatic update installation requires signed release artifacts and an HTTPS-hosted manifest

These are expected infrastructure dependencies, not gaps in the app design.
