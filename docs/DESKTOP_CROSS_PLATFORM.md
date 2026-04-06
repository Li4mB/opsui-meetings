# Desktop Cross-Platform Architecture

## Goal

Ship one OpsUI Meetings desktop product across Windows and macOS without forking feature code.

## Shared source of truth

- `apps/desktop/src`
  - React UI, flows, and state
- `packages/shared`
  - API contracts, schemas, and shared domain types
- `apps/api`
  - backend service shared by both desktop platforms

## Platform adapter boundary

Shared app code talks to a small set of desktop adapters:

- `apps/desktop/src/lib/platform.ts`
  - window creation, external URLs, native-vs-browser checks
- `apps/desktop/src/lib/cache.ts`
  - Tauri SQLite cache with browser fallback
- `apps/desktop/src/lib/session.ts`
  - Stronghold-backed session storage with browser fallback
- `apps/desktop/src/lib/updater.ts`
  - Tauri updater install flow

## Packaging boundary

- `apps/desktop/src-tauri/tauri.conf.json`
  - shared desktop identity, window sizing, icons, updater endpoints, plugin config
- `apps/desktop/src-tauri/tauri.windows.conf.json`
  - Windows-only bundle target and installer behavior
- `apps/desktop/src-tauri/tauri.macos.conf.json`
  - macOS-only bundle targets

## Release tooling

- `apps/desktop/scripts/build-desktop.mjs`
  - cross-platform signed Tauri build entry point
- `apps/desktop/scripts/sync-icons.mjs`
  - cross-platform icon generation
- `apps/desktop/scripts/generate-updater-manifest.mjs`
  - per-platform updater manifest generation
- `apps/desktop/scripts/lib/desktop-release.mjs`
  - shared script helpers for build and updater artifacts

## Updater strategy

- New builds request a platform-specific manifest first.
- Existing Windows installs keep using `latest.json`.
- Release automation publishes both so Windows stays backward-compatible while macOS joins the same channel.
- The default macOS release path builds the `.app` and updater archive; DMG packaging is left as a follow-up because its Finder automation is unreliable in non-interactive environments.
