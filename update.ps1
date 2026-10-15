# Downloads the newest RugRadar from the public GitHub repo named in
# update-source.txt and copies it over this folder. Your .env (keys) and
# node_modules are never touched. Any problem: the update is skipped.
param([string]$Repo)
$ErrorActionPreference = 'Stop'
try {
  $here = $PSScriptRoot
  $tmp = Join-Path $env:TEMP 'rugradar-update'
  if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
  New-Item -ItemType Directory $tmp | Out-Null
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  $zip = Join-Path $tmp 'latest.zip'
  Invoke-WebRequest -Uri "https://github.com/$Repo/archive/refs/heads/main.zip" -OutFile $zip -UseBasicParsing -TimeoutSec 30
  Expand-Archive -Path $zip -DestinationPath $tmp -Force
  $src = Get-ChildItem $tmp -Directory | Where-Object { Test-Path (Join-Path $_.FullName 'server.js') } | Select-Object -First 1
  if (-not $src) { throw 'download did not contain the app' }
  $oldPkg = Get-Content (Join-Path $here 'package.json') -Raw
  $oldVer = ($oldPkg | ConvertFrom-Json).version
  $newVer = (Get-Content (Join-Path $src.FullName 'package.json') -Raw | ConvertFrom-Json).version
  robocopy $src.FullName $here /E /XD node_modules .git /XF .env update-source.txt start.bat demo.bat /NFL /NDL /NJH /NJS /NP | Out-Null
  if ($oldVer -ne $newVer) { Write-Host "  Updated: $oldVer -> $newVer" } else { Write-Host "  Up to date ($newVer)" }
  $newPkg = Get-Content (Join-Path $here 'package.json') -Raw
  if ($newPkg -ne $oldPkg) { Write-Host '  Installing new parts...'; & npm install --no-audit --no-fund | Out-Null }
  Remove-Item $tmp -Recurse -Force
} catch {
  Write-Host "  Update skipped ($($_.Exception.Message)). Starting the version you have."
}
