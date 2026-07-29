; _MainFinalizeAndCleanup.ahk
; Pieza para el lado de Main: una vez que la donante ya respondio (ver
; _DonorRespondTrade.ahk), actualiza, acepta, desliza para enviar, cierra el
; cartel de gracias, y elimina la amistad recien usada (limpieza, para que la
; lista de Main no crezca y el proximo trade siga siendo facil de ubicar).
;
; Uso: _MainFinalizeAndCleanup.ahk "<winTitleMain>" "<folderPath>" "<outputFile>"

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
    ruta := A_ScriptDir . "\Logs\_finmain_" . puerto . "_" . A_TickCount . ".png"
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
AvanzarPaso(puerto, x, y, esperado, maxIntentos := 5, intentoSeg := 3) {
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

if (!AvanzarPaso(puerto, 433, 654, "recibida", 6, 3)) ; Actualizar -> Respuesta recibida
    ExitConError("no_recibio_respuesta")
AdbTap(adbPath, puerto, 270, 750) ; Ver
Sleep, 2500
AdbTap(adbPath, puerto, 397, 820) ; Intercambiar (confirmacion final)
Sleep, 2000
AdbTap(adbPath, puerto, 387, 638) ; Vale (irreversible)
Sleep, 2500
AdbSwipe(adbPath, puerto, 270, 600, 100, 400) ; deslizar para enviar
Sleep, 3000
AdbTap(adbPath, puerto, 270, 920) ; tocar para continuar (Genial!)
Sleep, 2000
AdbTap(adbPath, puerto, 270, 905) ; cerrar cartel de gracias
Sleep, 1500

; ============ Limpieza: eliminar la amistad recien usada ============
AdbTap(adbPath, puerto, 270, 925) ; Comunidad
Sleep, 2000
AdbTap(adbPath, puerto, 65, 830) ; Amigos
Sleep, 2000
AdbTap(adbPath, puerto, 200, 240) ; primer amigo (perfil)
Sleep, 2500
AdbTap(adbPath, puerto, 270, 710) ; toggle "Amigo"
Sleep, 1500
AdbTap(adbPath, puerto, 387, 638) ; confirmar "Vale"
Sleep, 2000

EscribirResultado("OK")
Gdip_Shutdown(pToken)
ExitApp, 0
