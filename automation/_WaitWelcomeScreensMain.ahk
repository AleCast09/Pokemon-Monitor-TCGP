; _WaitWelcomeScreensMain.ahk
; Copia EXCLUSIVA para la instancia Main (2026-08-05, a pedido explicito del usuario).
; Main no tiene ningun inject que le abra el juego solo (a diferencia de la donante, que
; lo abre via _InjectAccount.ahk de Kevin) -- por eso, SOLO esta copia hace "am start" una
; vez al principio para abrir la app. El script compartido _WaitWelcomeScreens.ahk (usado
; por la donante y por Shinedust) NO hace esto -- se saco de ahi porque el juego ya viene
; abierto por el inject, y forzar otro "am start" encima lo crasheaba (confirmado en vivo
; esta noche: sacarlo de ahi arreglo el crash).
;
; Espera a que el juego pase las pantallas que pueden aparecer recien abierto -- titulo
; ("Tap to Start"), carrusel "Welcome back!" (boton "Next"), pagina "special missions"
; (boton "OK"), popup "News" (boton "X") -- hasta detectar una CONFIRMACION POSITIVA de
; haber llegado al menu principal ("Wonder Pick" solo aparece ahi, needle own_mainmenu).
;
; Uso: _WaitWelcomeScreensMain.ahk "<winTitle>" "<folderPath>" "<outputFile>"
;   winTitle   = nombre de la instancia (deberia ser siempre "Main")
;   folderPath = carpeta base de MuMu (ej. "C:\Program Files\Netease\MuMuPlayer")
;   outputFile = ruta donde escribir "OK" o "ERROR: <motivo>"

#SingleInstance off
SetBatchLines, -1
#NoEnv

if (A_Args.Length() < 3) {
    ExitApp, 1
}

global g_winTitle   := A_Args[1]
global g_folderPath := A_Args[2]
global g_outputFile := A_Args[3]

#Include %A_ScriptDir%\_AdbUtils.ahk
#Include %A_ScriptDir%\lib\Gdip_All.ahk
#Include %A_ScriptDir%\lib\Gdip_Imagesearch.ahk

global pToken := Gdip_Startup()

LogsDir := A_ScriptDir . "\Logs"
if !FileExist(LogsDir)
    FileCreateDir, %LogsDir%

WriteResult(text) {
    global g_outputFile
    try {
        if (FileExist(g_outputFile))
            FileDelete, %g_outputFile%
        FileAppend, %text%, %g_outputFile%
    } catch e {
    }
}

ExitConError(motivo) {
    global pToken
    WriteResult("ERROR: " . motivo)
    try {
        Gdip_Shutdown(pToken)
    } catch e {
    }
    ExitApp, 3
}

adbPath := resolverRutaAdb(g_folderPath)
if (adbPath = "")
    ExitConError("adb_no_encontrado")

puerto := resolverPuertoAdb(g_folderPath, g_winTitle)
if (puerto = "")
    ExitConError("puerto_no_encontrado")

AdbConectar(adbPath, puerto)

; Abre el juego (2026-08-05): unica vez, sin reintento ni chequeo de por medio -- Main no
; tiene nada mas que lo abra, asi que esta copia SI necesita hacerlo. Un solo "am start",
; sin loop de reintento (eso fue lo que se saco del script compartido por sospecha real de
; causar crashes).
AdbEjecutar(adbPath, puerto, "shell am start -W -n jp.pokemon.pokemontcgp/com.unity3d.player.UnityPlayerActivity -f 0x10018000")
Sleep, 2000

; Logico->dispositivo (mismo criterio que el resto de los scripts propios):
; coordenadas calibradas a mano en pantalla logica 283x532 (estilo Kevin).
tap(x, y, esperaMs := 4000) {
    static convX := 540/283, convY := 960/488, offset := 40
    global adbPath, puerto
    AdbTap(adbPath, puerto, Round(x * convX), Round((y - offset) * convY))
    Sleep, %esperaMs%
}

global _needlesCache := {}
cargarNeedle(nombre) {
    global _needlesCache
    if (_needlesCache.HasKey(nombre))
        return _needlesCache[nombre]
    ruta := A_ScriptDir . "\Needles\" . nombre . ".png"
    p := FileExist(ruta) ? Gdip_CreateBitmapFromFile(ruta) : 0
    _needlesCache[nombre] := p
    return p
}

buscarNeedleEnCaptura(pHaystack, nombreNeedle, variation := 30) {
    pNeedle := cargarNeedle(nombreNeedle)
    if (!pNeedle)
        return false
    vPosXY := ""
    vRet := Gdip_ImageSearch(pHaystack, pNeedle, vPosXY, 0, 0, 0, 0, variation)
    return (vRet = 1)
}

; Log de depuracion TEMPORAL (2026-08-02) -- sacar una vez confirmado.
logDebugBienvenida(msg) {
    global LogsDir, g_winTitle
    FormatTime, ahora,, HH:mm:ss
    try {
        FileAppend, % "[" . ahora . "] [" . g_winTitle . "] " . msg . "`n", % LogsDir . "\_welcomeback_debug.txt"
    } catch e {
    }
}

esperarPantallasBienvenida(timeoutMs := 70000) {
    global adbPath, puerto, LogsDir
    inicio := A_TickCount
    intento := 0
    ultimoTapStart := 0
    logDebugBienvenida("=== INICIO esperarPantallasBienvenida (needles propios, script Main) ===")
    Loop {
        if (A_TickCount - inicio > timeoutMs) {
            logDebugBienvenida("TIMEOUT alcanzado (" . timeoutMs . "ms)")
            return false
        }
        intento++

        tempFile := LogsDir . "\_welcomeback_check_" . g_winTitle . ".png"
        AdbScreenshot(adbPath, puerto, tempFile)
        if (!FileExist(tempFile)) {
            logDebugBienvenida("intento " . intento . " -- no se pudo sacar captura")
            Sleep, 1000
            continue
        }
        pHaystack := Gdip_CreateBitmapFromFile(tempFile)
        FileDelete, %tempFile%
        if (!pHaystack) {
            logDebugBienvenida("intento " . intento . " -- captura invalida")
            Sleep, 1000
            continue
        }

        if (buscarNeedleEnCaptura(pHaystack, "own_mainmenu") || buscarNeedleEnCaptura(pHaystack, "own_mainmenu_packs", 45) || buscarNeedleEnCaptura(pHaystack, "own_mainmenu_navbar")) {
            logDebugBienvenida("intento " . intento . " -- YA LLEGO al menu principal, esperando 5s a que termine de cargar")
            Gdip_DisposeImage(pHaystack)
            Sleep, 5000
            return true
        }

        if (buscarNeedleEnCaptura(pHaystack, "own_next")) {
            logDebugBienvenida("intento " . intento . " -- needle 'own_next' -> tap Next (136,432)")
            tap(136, 432)
        } else if (buscarNeedleEnCaptura(pHaystack, "own_ok")) {
            logDebugBienvenida("intento " . intento . " -- needle 'own_ok' -> tap OK (203,431)")
            tap(203, 431)
        } else if (buscarNeedleEnCaptura(pHaystack, "own_tapstart") || buscarNeedleEnCaptura(pHaystack, "own_tapstart_logo", 75)) {
            ; Cooldown antes de repetir el tap: el logo puede seguir matcheando un rato
            ; despues del primer tap, mientras el juego ya esta a mitad de la transicion.
            if (A_TickCount - ultimoTapStart > 8000) {
                logDebugBienvenida("intento " . intento . " -- needle 'own_tapstart'/'own_tapstart_logo' -> tap Start (141,452)")
                ultimoTapStart := A_TickCount
                tap(141, 452)
            } else {
                logDebugBienvenida("intento " . intento . " -- needle 'own_tapstart'/'own_tapstart_logo' pero en cooldown, no vuelve a tocar")
                Sleep, 1000
            }
        } else if (buscarNeedleEnCaptura(pHaystack, "own_news_x")) {
            logDebugBienvenida("intento " . intento . " -- needle 'own_news_x' -> tap X (141,478)")
            tap(141, 478)
        } else if (buscarNeedleEnCaptura(pHaystack, "own_gameclosed")) {
            logDebugBienvenida("intento " . intento . " -- needle 'own_gameclosed' -> tap OK (150,369)")
            tap(150, 369)
        } else {
            logDebugBienvenida("intento " . intento . " -- ningun needle matcheo, esperando")
            Sleep, 1000
        }
        Gdip_DisposeImage(pHaystack)
    }
}

llego := esperarPantallasBienvenida(130000)
if (!llego)
    ExitConError("timeout_pantallas_bienvenida")

WriteResult("OK")
Gdip_Shutdown(pToken)
ExitApp, 0
