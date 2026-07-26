@echo off
echo Stopping Monitor Pokemon...
powershell -NoProfile -Command "Get-Process MonitorPokemon,MonitorPokemonPanel -ErrorAction SilentlyContinue | Stop-Process -Force; Remove-Item -Path (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Startup\Monitor Pokemon.lnk') -ErrorAction SilentlyContinue"
echo.
echo Done. Monitor Pokemon is stopped and will no longer start automatically when Windows starts.
echo Your token and settings are still saved — open "Start Monitor Pokemon.bat" anytime to use it again.
pause
