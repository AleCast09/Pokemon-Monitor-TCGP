@echo off
echo Desbloqueando los archivos de Monitor Pokemon...
powershell -NoProfile -Command "Get-ChildItem -Path '%~dp0' -Recurse -Force | Unblock-File"
echo.
echo Listo. Ya podes abrir "Iniciar Monitor Pokemon.vbs"
pause
