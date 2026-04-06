# OpsUI Desktop

Cross-platform Tauri desktop app for OpsUI Meetings.

## Shared product surface

- Windows and macOS ship the same React UI, business logic, data contracts, and state flow.
- Platform-specific behavior is isolated to:
  - `src/lib/platform.ts`
  - `src/lib/cache.ts`
  - `src/lib/session.ts`
  - `src/lib/updater.ts`
  - `src-tauri/tauri.windows.conf.json`
  - `src-tauri/tauri.macos.conf.json`

## Local development

Install workspace dependencies from the repo root:

```sh
npm install
```

Run the web UI only:

```sh
npm run dev:desktop
```

Run the native Tauri desktop shell:

```sh
npm run dev:desktop:tauri
```

## Desktop builds

The desktop release build expects the Tauri updater signing key:

```sh
export TAURI_SIGNING_PRIVATE_KEY_PATH="$HOME/.tauri/opsui-meetings.key"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="<password>"
```

Build for the current Windows host:

```sh
npm run build:desktop:windows
```

Build for the current macOS host:

```sh
npm run build:desktop:macos
```

The shared entry point for signed native bundles is:

```sh
npm run build:desktop
```
