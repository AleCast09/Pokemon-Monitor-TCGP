@echo off
chcp 65001 >nul
title Monitor Pokemon - Community host setup
cd /d "%~dp0"

rem Host de la comunidad (Zenith Rise): instala solo lo que falte (Node.js, componentes, PM2) y abre el
rem asistente (host-setup.js). Doble clic y seguir las preguntas. Se puede volver a correr para cambiar algo.

call :node_ok
if errorlevel 1 call :instalar_node
call :node_ok
if errorlevel 1 (
    echo.
    echo Node.js could not be installed automatically.
    echo Install the LTS version from https://nodejs.org and run this file again.
    pause
    exit /b 1
)

echo Installing the bot's components (the first time takes a few minutes)...
call npm install --omit=dev --no-audit --no-fund
if errorlevel 1 (
    echo Could not install the components. Check your internet connection and try again.
    pause
    exit /b 1
)

where pm2 >nul 2>nul
if errorlevel 1 (
    echo Installing PM2 - keeps the bot running in the background...
    call npm install -g pm2
    set "PATH=%PATH%;%APPDATA%\npm"
)

echo.
node host-setup.js
echo.
pause
exit /b 0

rem ---- Node.js 22 o mas nuevo instalado? (errorlevel 0 = si)
:node_ok
where node >nul 2>nul || exit /b 1
node -e "process.exit(Number(process.versions.node.split('.')[0]) < 22 ? 1 : 0)"
exit /b %errorlevel%

rem ---- Instala Node.js LTS: con winget si esta, si no baja el instalador oficial de nodejs.org.
:instalar_node
echo Node.js 22 or newer is needed - installing it now (Windows may ask for permission)...
where winget >nul 2>nul
if not errorlevel 1 (
    winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
) else (
    powershell -NoProfile -ExecutionPolicy Bypass -Command "$v = (Invoke-RestMethod https://nodejs.org/dist/index.json | Where-Object { $_.lts -and [int]($_.version.TrimStart('v').Split('.')[0]) -ge 22 } | Select-Object -First 1).version; $msi = Join-Path $env:TEMP ('node-' + $v + '-x64.msi'); Invoke-WebRequest ('https://nodejs.org/dist/' + $v + '/node-' + $v + '-x64.msi') -OutFile $msi; Start-Process msiexec -ArgumentList '/i', $msi, '/passive' -Wait"
)
rem La consola no ve el PATH nuevo hasta reabrirse: se agrega a mano.
set "PATH=%PATH%;%ProgramFiles%\nodejs;%APPDATA%\npm"
exit /b 0
