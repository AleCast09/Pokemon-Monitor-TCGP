@echo off
set MONITOR_ROLE=reconfigurar
powershell -NoProfile -WindowStyle Hidden -Command "Start-Process -FilePath '%~dp0MonitorPokemon.exe' -WorkingDirectory '%~dp0' -WindowStyle Hidden"
