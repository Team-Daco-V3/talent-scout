@echo off
setlocal
set "PORT=17300"
set "TALENT_SCOUT_PORT=%PORT%"

cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required to run Talent Scout.
  echo Install Node.js 20.19 or newer, then run this file again.
  pause
  exit /b 1
)

where npm.cmd >nul 2>nul
if errorlevel 1 (
  echo npm was not found. Reinstall Node.js with npm enabled.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo Installing dependencies...
  call npm.cmd install
  if errorlevel 1 (
    echo Failed to install dependencies.
    pause
    exit /b 1
  )
)

call powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$port=[int]$env:TALENT_SCOUT_PORT; $listeners=@(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue); foreach ($listener in $listeners) { $proc=Get-Process -Id $listener.OwningProcess -ErrorAction SilentlyContinue; if ($proc -and $proc.ProcessName -eq 'node') { Write-Host ('Stopping existing Node process on port {0}: PID {1}' -f $port,$proc.Id); Stop-Process -Id $proc.Id -Force } elseif ($proc) { Write-Host ('Port {0} is already used by {1} (PID {2}). Close it manually or choose another port.' -f $port,$proc.ProcessName,$proc.Id); exit 2 } else { Write-Host ('Port {0} is already used by PID {1}. Close it manually or choose another port.' -f $port,$listener.OwningProcess); exit 2 } }; Start-Sleep -Milliseconds 500"
if errorlevel 1 (
  pause
  exit /b 1
)

echo Starting Talent Scout at http://localhost:%PORT% ...
call npm.cmd run start

pause
