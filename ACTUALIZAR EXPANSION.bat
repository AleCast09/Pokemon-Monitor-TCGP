@echo off
rem Actualiza datos de cartas, imagenes, nombres, sobres del motor, logos y arte de sobres de una expansion nueva.
cd /d "%~dp0"
node scripts\actualizar-expansion.js %*
echo.
pause
