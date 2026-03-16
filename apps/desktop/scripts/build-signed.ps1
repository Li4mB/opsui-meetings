$ErrorActionPreference = "Stop"

if (-not $env:TAURI_SIGNING_PRIVATE_KEY) {
  $env:TAURI_SIGNING_PRIVATE_KEY = [Environment]::GetEnvironmentVariable(
    "TAURI_SIGNING_PRIVATE_KEY",
    "User"
  )
}

if (-not $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD) {
  $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = [Environment]::GetEnvironmentVariable(
    "TAURI_SIGNING_PRIVATE_KEY_PASSWORD",
    "User"
  )
}

if (-not $env:TAURI_SIGNING_PRIVATE_KEY) {
  throw "TAURI_SIGNING_PRIVATE_KEY is not set."
}

if (-not (Test-Path $env:TAURI_SIGNING_PRIVATE_KEY)) {
  throw "Private key file not found at $($env:TAURI_SIGNING_PRIVATE_KEY)"
}

$vcvars = "C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Auxiliary\Build\vcvars64.bat"

if (-not (Test-Path $vcvars)) {
  throw "Visual Studio vcvars64.bat not found at $vcvars"
}

cmd.exe /c "`"$vcvars`" && npm run tauri build"

if ($LASTEXITCODE -ne 0) {
  throw "Signed desktop build failed with exit code $LASTEXITCODE"
}
