$ErrorActionPreference = "Stop"

if (-not $env:TAURI_SIGNING_PRIVATE_KEY_PATH) {
  $env:TAURI_SIGNING_PRIVATE_KEY_PATH = [Environment]::GetEnvironmentVariable(
    "TAURI_SIGNING_PRIVATE_KEY_PATH",
    "User"
  )
}

if (-not $env:TAURI_SIGNING_PRIVATE_KEY_PATH -and $env:TAURI_SIGNING_PRIVATE_KEY -and (Test-Path $env:TAURI_SIGNING_PRIVATE_KEY)) {
  $env:TAURI_SIGNING_PRIVATE_KEY_PATH = $env:TAURI_SIGNING_PRIVATE_KEY
  $env:TAURI_SIGNING_PRIVATE_KEY = $null
}

if (-not $env:TAURI_SIGNING_PRIVATE_KEY_PATH) {
  $legacyPath = [Environment]::GetEnvironmentVariable(
    "TAURI_SIGNING_PRIVATE_KEY",
    "User"
  )

  if ($legacyPath -and (Test-Path $legacyPath)) {
    $env:TAURI_SIGNING_PRIVATE_KEY_PATH = $legacyPath
  }
}

if (-not $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD) {
  $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = [Environment]::GetEnvironmentVariable(
    "TAURI_SIGNING_PRIVATE_KEY_PASSWORD",
    "User"
  )
}

if (-not $env:TAURI_SIGNING_PRIVATE_KEY_PATH -and -not $env:TAURI_SIGNING_PRIVATE_KEY) {
  throw "Neither TAURI_SIGNING_PRIVATE_KEY_PATH nor TAURI_SIGNING_PRIVATE_KEY is set."
}

if ($env:TAURI_SIGNING_PRIVATE_KEY_PATH -and -not (Test-Path $env:TAURI_SIGNING_PRIVATE_KEY_PATH)) {
  throw "Private key file not found at $($env:TAURI_SIGNING_PRIVATE_KEY_PATH)"
}

if (-not $env:TAURI_SIGNING_PRIVATE_KEY -and $env:TAURI_SIGNING_PRIVATE_KEY_PATH) {
  $env:TAURI_SIGNING_PRIVATE_KEY = Get-Content -Path $env:TAURI_SIGNING_PRIVATE_KEY_PATH -Raw
}

$vcvars = $null
$vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"

if (Test-Path $vswhere) {
  $installationPath = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath

  if ($LASTEXITCODE -eq 0 -and $installationPath) {
    $candidate = Join-Path $installationPath "VC\Auxiliary\Build\vcvars64.bat"

    if (Test-Path $candidate) {
      $vcvars = $candidate
    }
  }
}

if (-not $vcvars) {
  $candidates = @(
    "C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Auxiliary\Build\vcvars64.bat",
    "C:\Program Files\Microsoft Visual Studio\2022\Professional\VC\Auxiliary\Build\vcvars64.bat",
    "C:\Program Files\Microsoft Visual Studio\2022\Enterprise\VC\Auxiliary\Build\vcvars64.bat",
    "C:\Program Files\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat"
  )

  foreach ($candidate in $candidates) {
    if (Test-Path $candidate) {
      $vcvars = $candidate
      break
    }
  }
}

if (-not $vcvars) {
  throw "Visual Studio vcvars64.bat could not be located."
}

cmd.exe /c "`"$vcvars`" && npm run tauri build"

if ($LASTEXITCODE -ne 0) {
  throw "Signed desktop build failed with exit code $LASTEXITCODE"
}
