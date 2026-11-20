@echo off
chcp 65001 >nul
title Monitor Pokemon - New host key
cd /d "%~dp0"

rem Solo en la PC de Ale: crea un host-key.txt nuevo con una contraseña nueva (para instalar hosts).
rem Los hosts que ya estan funcionando no se ven afectados.

node host-setup.js --make-key
echo.
echo Write the password down somewhere safe - it is not saved anywhere else.
pause
