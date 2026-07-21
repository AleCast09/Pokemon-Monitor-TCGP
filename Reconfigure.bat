@echo off
set MONITOR_ROLE=reconfigurar
powershell -NoProfile -WindowStyle Hidden -Command "Get-ChildItem -Path '%~dp0' -Recurse -Force -ErrorAction SilentlyContinue | Unblock-File -ErrorAction SilentlyContinue; Start-Process -FilePath '%~dp0MonitorPokemon.exe' -WorkingDirectory '%~dp0' -WindowStyle Hidden"
