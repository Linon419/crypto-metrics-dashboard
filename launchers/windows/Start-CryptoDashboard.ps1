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

function Test-NodeAndNpm {
  return [bool](Get-Command node -ErrorAction SilentlyContinue) -and
    [bool](Get-Command npm -ErrorAction SilentlyContinue)
}

if (-not (Test-NodeAndNpm)) {
  Write-Host "Node.js LTS and npm are needed to run this dashboard." -ForegroundColor Yellow
  $Winget = Get-Command winget -ErrorAction SilentlyContinue
  if (-not $Winget) {
    Write-Host "Automatic installation is unavailable because winget was not found." -ForegroundColor Yellow
    Write-Host "Install Node.js LTS from https://nodejs.org/ and run this file again."
    exit 1
  }

  $Answer = Read-Host "Install Node.js LTS automatically now? [Y/N]"
  if ($Answer -notmatch '^(?i:y|yes)$') {
    Write-Host "Installation cancelled. You can install Node.js LTS from https://nodejs.org/." -ForegroundColor Yellow
    exit 1
  }

  Write-Host "Installing Node.js LTS. Windows may ask for permission..." -ForegroundColor Cyan
  & $Winget.Source install --id OpenJS.NodeJS.LTS -e --accept-package-agreements --accept-source-agreements
  if ($LASTEXITCODE -ne 0) {
    Write-Host "Node.js installation failed. Install it from https://nodejs.org/ and try again." -ForegroundColor Red
    exit 1
  }

  $MachinePath = [Environment]::GetEnvironmentVariable("Path", "Machine")
  $UserPath = [Environment]::GetEnvironmentVariable("Path", "User")
  $env:Path = "$MachinePath;$UserPath"

  if (-not (Test-NodeAndNpm)) {
    Write-Host "Node.js was installed, but this window cannot see it yet." -ForegroundColor Yellow
    Write-Host "Close this window and double-click the launcher again."
    exit 1
  }
}

node ".\scripts\start-local-dashboard.js"
