# NEO Startup Script
# รัน: powershell -ExecutionPolicy Bypass -File start-neo.ps1

Write-Host "Starting NEO..." -ForegroundColor Cyan

# Start SSH Tunnel in background window
Start-Process powershell -ArgumentList "-NoExit -Command `"ssh -i '$env:USERPROFILE\.ssh\neo_key' -L 5433:172.18.0.4:5432 jack@195.201.81.33 -N -o StrictHostKeyChecking=no -o ServerAliveInterval=60`"" -WindowStyle Minimized

Write-Host "SSH Tunnel starting..." -ForegroundColor Yellow
Start-Sleep -Seconds 3

# Start NEO
Write-Host "NEO is starting..." -ForegroundColor Green
Set-Location $PSScriptRoot
npm run dev
