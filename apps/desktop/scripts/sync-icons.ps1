$ErrorActionPreference = "Stop"

$desktopRoot = Split-Path -Parent $PSScriptRoot
$sourceIcon = Join-Path $desktopRoot "src\\assets\\op.png"
$tauriRoot = Join-Path $desktopRoot "src-tauri"

if (-not (Test-Path $sourceIcon)) {
  throw "Source icon not found at $sourceIcon"
}

Push-Location $tauriRoot
try {
  npx tauri icon $sourceIcon

  if ($LASTEXITCODE -ne 0) {
    throw "Tauri icon generation failed with exit code $LASTEXITCODE"
  }
}
finally {
  Pop-Location
}
