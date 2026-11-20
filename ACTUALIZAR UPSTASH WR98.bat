@echo off
chcp 65001 >nul
title Update wr98 Upstash (Dragonite)
cd /d "%~dp0"
rem Cuando wr98 rota la clave de su Upstash: pegar la direccion y la clave nuevas. Se guardan para todos los hosts.
node scripts\actualizar-wr98.js
echo.
pause
