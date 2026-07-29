@echo off
set MONITOR_ROLE=reconfigurar
if exist "%~dp0..\MonitorPokemon.exe" (
  powershell -NoProfile -WindowStyle Hidden -Command "Get-ChildItem -Path '%~dp0..' -Recurse -Force -ErrorAction SilentlyContinue | Unblock-File -ErrorAction SilentlyContinue; Start-Process -FilePath '%~dp0..\MonitorPokemon.exe' -WorkingDirectory '%~dp0..' -WindowStyle Hidden"
) else (
  powershell -NoProfile -WindowStyle Hidden -Command "Start-Process -FilePath 'node' -ArgumentList '\"entry.js\"' -WorkingDirectory '%~dp0..' -WindowStyle Hidden"
)
