# Starts Seasons of Solace locally and opens it in your browser.
#
# Right-click this file and choose "Run with PowerShell", or from a terminal in
# this folder:  .\run.ps1
#
# The app needs Chrome or Edge — it uses WebGPU to run the companion on your own
# machine, and Firefox and Safari are not there yet on Windows.

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$port = 8125

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host ''
    Write-Host '  Node.js is not installed, and this little server needs it.' -ForegroundColor Yellow
    Write-Host '  Get it from https://nodejs.org (the LTS button), then run this again.'
    Write-Host ''
    Read-Host '  Press Enter to close'
    exit 1
}

Write-Host ''
Write-Host '  Starting Seasons of Solace...' -ForegroundColor Cyan
Write-Host ''

Start-Job -ScriptBlock {
    Start-Sleep -Seconds 1
    Start-Process "http://localhost:$using:port/"
} | Out-Null

node (Join-Path $here 'tools\serve.mjs') $port
