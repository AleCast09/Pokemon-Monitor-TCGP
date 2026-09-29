; _SpeedModToMin.ahk -- baja el Speed Mod al minimo (1x), simetrico a deslizarSliderAlMaximo
; de _SpeedMod.ahk (2026-08-29, a pedido explicito del usuario): el swipe final de envio de
; carta NO registra con el juego a 3x (ver memoria project_pending_speedmod_swipe_bug), y
; ademas tocar una carta del Wishlist a 3x la deja "agrandada" (zoom) en vez de abrirla
; normal -- confirmado en vivo el mismo dia. Se usa el mismo needle/panel/tap de apertura que
; _SpeedMod.ahk, solo invirtiendo la direccion del swipe del slider (max->min en vez de
; min->max).
; Uso: _SpeedModToMin.ahk "<winTitle>" "<folderPath>" "<outputFile>"
;   Escribe "OK" si logro abrir el panel y bajar el slider, "ERROR: <motivo>" si no.
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

hwnd := WinExist(g_winTitle . " ahk_class Qt5156QWindowIcon")
if (!hwnd)
    ExitConError("ventana_no_encontrada")

tap(x, y, esperaMs := 800) {
    static convX := 540/283, convY := 960/488, offset := 40
    global adbPath, puerto
    AdbTap(adbPath, puerto, Round(x * convX), Round((y - offset) * convY))
    Sleep, %esperaMs%
}

; Mismo slider que _SpeedMod.ahk (x=33 a x=363, y=248) pero invertido: de 363 a 33.
deslizarSliderAlMinimo(esperaMs := 1000) {
    global adbPath, puerto
    RunWait, %ComSpec% /c ""%adbPath%" -s 127.0.0.1:%puerto% shell input swipe 363 248 33 248 600", , Hide
    Sleep, %esperaMs%
}

esperarIconoYTap(timeoutMs := 25000) {
    global hwnd
    pNeedle := Gdip_CreateBitmapFromFile(A_ScriptDir . "\Needles\own_speedmod_icon.png")
    inicio := A_TickCount
    Loop {
        pBitmap := capturarVentana(hwnd)
        encontrado := false
        if (pBitmap) {
            vPos := ""
            encontrado := (Gdip_ImageSearch(pBitmap, pNeedle, vPos, 0, 0, 0, 0, 60) = 1)
            Gdip_DisposeImage(pBitmap)
        }
        if (encontrado) {
            Gdip_DisposeImage(pNeedle)
            tap(18, 109)
            return true
        }
        if (A_TickCount - inicio > timeoutMs) {
            Gdip_DisposeImage(pNeedle)
            return false
        }
        Sleep, 100
    }
}

if (!esperarIconoYTap(25000))
    ExitConError("no_aparecio_icono_speedmod")

Sleep, 800

deslizarSliderAlMinimo()

; Minimizar el panel (cosmetico, mismo criterio que _SpeedMod.ahk).
tap(171, 285)

WriteResult("OK")
Gdip_Shutdown(pToken)
ExitApp, 0
