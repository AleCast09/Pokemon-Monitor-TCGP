@echo off
echo Unblocking Monitor Pokemon files...
powershell -NoProfile -Command "Get-ChildItem -Path '%~dp0' -Recurse -Force | Unblock-File"
echo.
echo Done. You can now open "Start Monitor Pokemon.bat"
pause
