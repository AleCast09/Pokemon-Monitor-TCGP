; _SpeedMod.ahk -- reescrito 2026-08-25 (v2) a pedido explicito del usuario ("los usuarios me
; dijeron que demora mucho, hagamos que el speed se active y haga match mas rapido"): antes
; usaba AdbScreenshot (captura via el emulador -- renderizar + comprimir a PNG + transferir
; por el pipe, ~150-400ms por intento) igual que el resto de nuestros scripts. Comparando
; contra el codigo real de Kevin (Scripts\Include\Utils.ahk, funcion from_window) se encontro
; que el usa una captura de VENTANA DE WINDOWS directa (PrintWindow con la bandera
; PW_RENDERFULLCONTENT=0x2, necesaria para que no salga todo negro contra ventanas con
; render por GPU como MuMu) -- esto es casi instantaneo (0ms medido en vivo, contra
; 47-150ms+ de AdbScreenshot) porque agarra los pixeles que la ventana YA tiene dibujados en
; pantalla, sin pedirle nada al emulador. Ademas Kevin revisa cada 100ms (nosotros usabamos
; 500ms) -- 5 veces mas seguido.
;
; Esta captura de ventana es a la resolucion NATIVA de la ventana (~275x528, la mitad mas o
; menos de los 540x960 de un screenshot ADB) -- por eso el needle de este script es propio,
; recortado de una captura real a ESTA resolucion (no reusa ningun needle de otro script, que
; estan todos recortados de capturas ADB a 540x960 y no matchearian aca).
;
; Simplificado a proposito (2026-08-25): la version anterior confirmaba que el panel habia
; abierto con un segundo needle (el engranaje) antes de deslizar el slider -- probado en vivo
; 2 veces que tocar el icono + esperar un instante fijo ya abre el panel de forma confiable,
; asi que se saca esa segunda needle (dificil de recortar bien a esta resolucion tan chica) y
; se reemplaza por un delay fijo corto.
;
; Uso: _SpeedMod.ahk "<winTitle>" "<folderPath>" "<outputFile>"
;   Escribe "OK" si logro abrir el panel y mover el slider, "ERROR: <motivo>" si no.
;   No es critico para que el trade funcione -- si falla, el llamador sigue el trade igual,
;   solo mas lento.

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

; Ventana real de MuMu para esta instancia -- misma logica que obtenerHwndMuMu de
; _AdbUtils.ahk, resuelta directo aca porque hace falta el handle para la captura.
hwnd := WinExist(g_winTitle . " ahk_class Qt5156QWindowIcon")
if (!hwnd)
    ExitConError("ventana_no_encontrada")

tap(x, y, esperaMs := 800) {
    static convX := 540/283, convY := 960/488, offset := 40
    global adbPath, puerto
    AdbTap(adbPath, puerto, Round(x * convX), Round((y - offset) * convY))
    Sleep, %esperaMs%
}

; Deslizar el slider (horizontal, en pixeles de dispositivo reales -- medido en vivo contra
; una captura ADB real: slider de x=33 a x=363, y=248).
deslizarSliderAlMaximo(esperaMs := 1000) {
    global adbPath, puerto
    RunWait, %ComSpec% /c ""%adbPath%" -s 127.0.0.1:%puerto% shell input swipe 33 248 363 248 600", , Hide
    Sleep, %esperaMs%
}

; capturarVentana ahora vive en _AdbUtils.ahk (2026-08-25, compartida entre este script y
; _WaitWelcomeScreens.ahk/_WaitWelcomeScreensMain.ahk) -- se saco la copia local de aca porque
; quedaba definida dos veces (bug real: "Duplicate function definition", el script no
; arrancaba). Mismo comportamiento, una sola definicion.

; Poll cada 100ms (2026-08-25, igual que Kevin -- antes 500ms) usando captura de ventana en
; vez de ADB -- ambos cambios hacen que la deteccion sea sensiblemente mas rapida.
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

; El panel tarda un instante en terminar su animacion de apertura (confirmado en vivo 2 veces
; que este delay fijo alcanza, sin necesitar una segunda needle de confirmacion).
Sleep, 800

deslizarSliderAlMaximo()

; Minimizar el panel (cosmetico -- si falla, el multiplicador ya quedo aplicado igual, no
; corta con error).
tap(171, 285)

WriteResult("OK")
Gdip_Shutdown(pToken)
ExitApp, 0
