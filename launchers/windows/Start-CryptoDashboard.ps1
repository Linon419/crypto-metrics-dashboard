$ErrorActionPreference = "Stop"

$AppName = "Crypto Metrics Dashboard"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Resolve-Path (Join-Path $ScriptDir "..\..")

$host.UI.RawUI.WindowTitle = $AppName
Set-Location $ProjectRoot

Write-Host ""
Write-Host "Starting $AppName locally..." -ForegroundColor Cyan
Write-Host "Project folder: $ProjectRoot"
Write-Host ""

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host "Node.js is required. Install the LTS version from https://nodejs.org/ and run this file again." -ForegroundColor Yellow
  exit 1
}

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  Write-Host "npm is required. Reinstall Node.js LTS from https://nodejs.org/ and run this file again." -ForegroundColor Yellow
  exit 1
}

node ".\scripts\start-local-dashboard.js"
