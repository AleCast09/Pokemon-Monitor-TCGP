; _DonorRespondTrade.ahk
; Pieza para el lado de la cuenta donante: responde a la oferta de trade de
; Main con la MISMA carta buscada por nombre (la que se necesita que reciba
; Main). Asume que Main ya propuso (ver _MainAcceptAndTrade.ahk) y que esta
; instancia ya tiene el juego abierto (ver _InjectXml.ahk/_ClosePopupIfAny.ahk).
;
; Uso: _DonorRespondTrade.ahk "<winTitle>" "<folderPath>" "<cardName>" "<outputFile>"

#SingleInstance off
SetBatchLines, -1
#NoEnv

if (A_Args.Length() < 4) {
    ExitApp, 1
}

global g_winTitle   := A_Args[1]
global g_folderPath := A_Args[2]
global g_cardName   := A_Args[3]
global g_outputFile := A_Args[4]

#Include %A_ScriptDir%\_AdbUtils.ahk
#Include %A_ScriptDir%\_OcrUtils.ahk
#Include %A_ScriptDir%\lib\Gdip_All.ahk
#Include %A_ScriptDir%\lib\Gdip_Extra.ahk

global pToken := Gdip_Startup()

LogsDir := A_ScriptDir . "\Logs"
if !FileExist(LogsDir)
    FileCreateDir, %LogsDir%

EscribirResultado(texto) {
    global g_outputFile
    try {
        if (FileExist(g_outputFile))
            FileDelete, %g_outputFile%
        FileAppend, %texto%, %g_outputFile%
    } catch e {
    }
}

ExitConError(motivo) {
    global pToken
    EscribirResultado("ERROR: " . motivo)
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
Sleep, 300

CapturarPantalla(puerto) {
    global adbPath
    ruta := A_ScriptDir . "\Logs\_donresp_" . puerto . "_" . A_TickCount . ".png"
    AdbScreenshot(adbPath, puerto, ruta)
    return ruta
}
LeerTitulo(puerto) {
    ruta := CapturarPantalla(puerto)
    texto := ""
    if FileExist(ruta) {
        try {
            pBitmapOriginal := Gdip_CreateBitmapFromFile(ruta)
            pBitmapFormatted := Gdip_CropResizeGreyscaleContrast(pBitmapOriginal, 0, 40, 540, 130, 150, 0)
            texto := GetTextFromBitmap(pBitmapFormatted)
            Gdip_DisposeImage(pBitmapOriginal)
            Gdip_DisposeImage(pBitmapFormatted)
        } catch e {
            texto := ""
        }
        FileDelete, %ruta%
    }
    return texto
}
AvanzarPaso(puerto, x, y, esperado, maxIntentos := 4, intentoSeg := 3) {
    global adbPath
    Loop, %maxIntentos% {
        AdbTap(adbPath, puerto, x, y)
        Sleep, % intentoSeg * 1000
        texto := LeerTitulo(puerto)
        if (esperado = "" || InStr(texto, esperado))
            return true
    }
    return false
}

AdbTap(adbPath, puerto, 270, 925) ; Comunidad
Sleep, 2500
AdbTap(adbPath, puerto, 397, 715) ; tile Trade
Sleep, 2500
; Tutorial de 3 paginas (aparece siempre, cuenta donante nueva cada vez) --
; toques preventivos antes del flujo real.
AdbTap(adbPath, puerto, 270, 750) ; View / tutorial p.1
Sleep, 2000
AdbTap(adbPath, puerto, 270, 770) ; tutorial p.2
Sleep, 1500
AdbTap(adbPath, puerto, 387, 770) ; tutorial p.3
Sleep, 1500
if (!AvanzarPaso(puerto, 270, 750, "Trade", 4, 3)) ; View real -> Trade Offer Received
    ExitConError("no_llego_a_trade_offer_received")
AdbTap(adbPath, puerto, 397, 820) ; Trade (responder)
Sleep, 2500
AdbTap(adbPath, puerto, 477, 213) ; buscador
Sleep, 1500
AdbTap(adbPath, puerto, 270, 192) ; caja de texto
Sleep, 800
AdbInputText(adbPath, puerto, g_cardName)
Sleep, 800
AdbTap(adbPath, puerto, 270, 819) ; Buscar
Sleep, 2000
AdbTap(adbPath, puerto, 103, 798) ; primer resultado
Sleep, 1500
AdbTap(adbPath, puerto, 270, 770) ; popup info (si aparece)
Sleep, 1500
AdbTap(adbPath, puerto, 270, 820) ; OK (confirmar seleccion)
Sleep, 2000
AdbTap(adbPath, puerto, 387, 822) ; OK (confirmar final)
Sleep, 2000
AdbTap(adbPath, puerto, 387, 638) ; confirmar dialogo
Sleep, 2500

EscribirResultado("OK")
Gdip_Shutdown(pToken)
ExitApp, 0
