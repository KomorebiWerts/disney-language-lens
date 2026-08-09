param(
  [switch]$UseRelease
)

$ErrorActionPreference = "Stop"

$edgePath = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
$fixturePath = (Resolve-Path (Join-Path $PSScriptRoot "ui-preview.html")).Path
$profilePath = Join-Path $PSScriptRoot "edge-word-card-profile"
$fixtureUrl = "file:///" + ($fixturePath -replace "\\", "/")
if ($UseRelease) { $fixtureUrl += "?release=1" }

New-Item -ItemType Directory -Force -Path $profilePath | Out-Null

$outputPath = Join-Path $profilePath "word-card-result.html"
$errorPath = Join-Path $profilePath "word-card-errors.log"
$arguments = @(
  "--headless=new",
  "--disable-gpu",
  "--no-first-run",
  "--disable-default-apps",
  "--virtual-time-budget=2400",
  "--user-data-dir=$profilePath",
  "--dump-dom",
  $fixtureUrl
)

Start-Process -FilePath $edgePath `
  -ArgumentList $arguments `
  -Wait `
  -WindowStyle Hidden `
  -RedirectStandardOutput $outputPath `
  -RedirectStandardError $errorPath | Out-Null

$outputText = Get-Content -Raw $outputPath
if ($outputText -match 'data-word-card-result="pass"') {
  Write-Output "PASS: contextual phrase card rendered the correct patronizing sense."
  exit 0
}

$details = if ($outputText -match '<pre id="qa-output" hidden="">([^<]+)</pre>') { $Matches[1] } else { "no QA details" }
Write-Error "FAIL: contextual phrase card did not pass visual DOM checks. $details"
