param(
  [switch]$UseRelease,
  [switch]$WithoutCore
)

$ErrorActionPreference = "Stop"

$edgePath = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
$fixturePath = (Resolve-Path (Join-Path $PSScriptRoot "dom-rebuild.html")).Path
$profilePath = Join-Path $PSScriptRoot "edge-headless-profile"
$fixtureUrl = "file:///" + ($fixturePath -replace "\\", "/")
$query = @()
if ($UseRelease) { $query += "release=1" }
if ($WithoutCore) { $query += "withoutCore=1" }
if ($query.Count) { $fixtureUrl += "?" + ($query -join "&") }

New-Item -ItemType Directory -Force -Path $profilePath | Out-Null

$outputPath = Join-Path $profilePath "dom-result.html"
$errorPath = Join-Path $profilePath "dom-errors.log"
$arguments = @(
  "--headless=new",
  "--disable-gpu",
  "--no-first-run",
  "--disable-default-apps",
  "--virtual-time-budget=2200",
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

if ($outputText -match 'data-result="pass"') {
  Write-Output "PASS: visible bilingual subtitles survived the Disney DOM rebuild."
  exit 0
}

Write-Error "FAIL: bilingual subtitles were not visibly rendered after the Disney DOM rebuild."
