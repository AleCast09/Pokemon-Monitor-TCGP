@echo off
chcp 65001 >nul
title Monitor Pokemon - Community host setup
cd /d "%~dp0"

rem Host de la comunidad (Zenith Rise): instala lo necesario y abre el asistente (host-setup.js).
rem Doble clic y seguir las preguntas. Se puede volver a correr para cambiar algo.

where node >nul 2>nul
if errorlevel 1 (
    echo Node.js is not installed.
    echo Download the LTS version from https://nodejs.org , install it and run this file again.
    pause
    exit /b 1
)
node -e "process.exit(Number(process.versions.node.split('.')[0]) < 22 ? 1 : 0)"
if errorlevel 1 (
    echo Your Node.js is too old - version 22 or newer is needed.
    echo Download the LTS version from https://nodejs.org , install it and run this file again.
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
    echo Installing PM2 (keeps the bot running in the background)...
    call npm install -g pm2
)

echo.
node host-setup.js
echo.
pause
