$ErrorActionPreference = "Stop"

$edgePath = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
$fixturePath = (Resolve-Path (Join-Path $PSScriptRoot "seek-sync.html")).Path
$profilePath = Join-Path $PSScriptRoot "edge-seek-sync-profile"
$fixtureUrl = "file:///" + ($fixturePath -replace "\\", "/")

New-Item -ItemType Directory -Force -Path $profilePath | Out-Null

$outputPath = Join-Path $profilePath "seek-sync-result.html"
$errorPath = Join-Path $profilePath "seek-sync-errors.log"
$arguments = @(
  "--headless=new",
  "--disable-gpu",
  "--no-first-run",
  "--disable-default-apps",
  "--allow-file-access-from-files",
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
  Write-Output "PASS: Edge synchronized +10s/-10s without pausing and kept long seeks on the absolute timeline."
  exit 0
}

$details = if ($outputText -match '<pre id="result">([^<]+)</pre>') { $Matches[1] } else { "no QA details" }
Write-Error "FAIL: Edge did not synchronize a playing seek. $details"
