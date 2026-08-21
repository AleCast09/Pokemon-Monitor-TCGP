# Ejecutado SOLO por la Tarea Programada "MonitorPokemon_KillAHK" (configurada con
# privilegios mas altos) -- lee el PID que bot.js dejo en un archivo compartido y lo mata a
# la fuerza. Existe porque un AHK que quedo trabado por dentro no responde a la señal 0x500
# ni al ciclo de apagar/prender MuMu, y bot.js (corriendo SIN privilegios de administrador, a
# proposito) no puede matarlo por su cuenta aunque el AHK si corra elevado.
#
# FIX real 2026-08-21 (bug encontrado probando en vivo con una segunda instalacion en la
# misma PC -- la de prueba, en el Escritorio): la Tarea Programada se crea UNA sola vez,
# apuntando a ESTE script en la carpeta de instalacion de PRODUCCION -- pero antes el archivo
# con el PID se buscaba al lado del PROPIO script (junto a la carpeta de PRODUCCION), no
# donde el bot que en realidad disparo la tarea vive. Cualquier OTRA instalacion en la misma
# PC (como el bot de prueba en el Escritorio) escribia el archivo en SU PROPIA carpeta, y
# esta tarea (compartida, siempre la misma para toda la PC) nunca lo encontraba ahi --
# la tarea "corria bien" (exit code 0) pero sin hacer nada de verdad, en absoluto silencio.
# %TEMP% es una carpeta fija por USUARIO de Windows (no por instalacion), asi que sirve igual
# sin importar desde que carpeta corra el bot que dispara esto.
$rutaTarget = Join-Path $env:TEMP "MonitorPokemon_kill_ahk_target.txt"
if (-not (Test-Path $rutaTarget)) { exit 0 }

$contenido = (Get-Content $rutaTarget -Raw -ErrorAction SilentlyContinue)
Remove-Item $rutaTarget -Force -ErrorAction SilentlyContinue

$pid_objetivo = 0
if (-not [int]::TryParse(($contenido -replace '\D', ''), [ref]$pid_objetivo)) { exit 0 }
if ($pid_objetivo -le 0) { exit 0 }

try {
    Stop-Process -Id $pid_objetivo -Force -ErrorAction Stop
} catch {
    # Ya no existia, o algun otro error -- no hay nada mas que intentar aca.
}
