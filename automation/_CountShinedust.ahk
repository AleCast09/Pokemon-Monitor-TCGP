; _CountShinedust.ahk
; Navega desde la pantalla principal del juego hasta el detalle de "Shinedust" en el
; inventario, toma un screenshot, recorta la region donde aparece el numero y lo lee con
; el OCR nativo de Windows. Escribe el resultado (solo digitos, sin comas) en outputFile.
;
; 100% propio (ver _AdbUtils.ahk, _OcrUtils.ahk, lib/Gdip_All.ahk, lib/Gdip_Extra.ahk) --
; ningun archivo de Kevin. Reescrito 2026-07-30 (segunda vez que se rompia por depender
; de la carpeta viva de Kevin -- primero por ruta externa hardcodeada que solo existia en
; la PC de Ale, y de nuevo cuando Kevin actualizo su propio MumuHelper.ahk y choco con
; "Duplicate function definition"). Ya no depende de nada que Kevin pueda cambiar.
;
; No es un loop 24/7 (sin verificacion de imagen/needle): reintentos simples con delays
; fijos, pensado para un chequeo puntual disparado a pedido desde Discord.
;
; Uso: _CountShinedust.ahk "<winTitle>" "<folderPath>" "<outputFile>"
;   winTitle   = nombre de la instancia (ej. "1")
;   folderPath = carpeta base de MuMu (ej. "C:\Program Files\Netease\MuMuPlayer")
;   outputFile = ruta donde escribir el resultado (numero) o "ERROR: <motivo>" si falla

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
Sleep, 300

; Logico->dispositivo (mismo criterio que _MainProposeFavoriteCard.ahk): las
; coordenadas de este script se calibraron a mano en pantalla logica 283x532
; (estilo Kevin) -- se mantienen esos mismos valores, solo se convierte antes
; de tocar, sin depender de ningun archivo suyo.
tap(x, y, esperaMs := 4000) {
    static convX := 540/283, convY := 960/488, offset := 40
    global adbPath, puerto
    AdbTap(adbPath, puerto, Round(x * convX), Round((y - offset) * convY))
    Sleep, %esperaMs%
}

; ============ Volver al menu principal ============
; Reintentos simples con espera fija (sin verificacion de imagen -- ver nota
; en el encabezado: chequeo puntual, no loop 24/7). Subido de 3 a 4 (a pedido
; del usuario 2026-07-30). El toque de "cerrar popup" es inofensivo si no hay
; ningun popup ahi (cae en zona en blanco normal).
Loop, 4 {
    tap(36, 510)   ; icono "Home" de la barra inferior
    tap(141, 480)  ; cierra popup si aparece (News, etc.)
}

; ============ Navegacion hasta el detalle de Shinedust ============
tap(244, 518)   ; abre menu hamburguesa/configuracion desde la pantalla principal
tap(143, 272)   ; entra a "Items" (la lista ya muestra el shinedust directo, calibrado a mano)

; Reporte del usuario 2026-07-29: la foto se tomaba muy rapido al llegar al
; inventario y el OCR leia numeros mal (la pantalla todavia estaba animando/
; cargando el numero real de shinedust). Espera extra antes de capturar.
Sleep, 10000

; ============ Screenshot + OCR ============
shinedustScreenshotFile := LogsDir . "\" . g_winTitle . "_Shinedust.png"
AdbScreenshot(adbPath, puerto, shinedustScreenshotFile)
Sleep, 500

shineDustValue := ""
try {
    allowedChars := "0123456789,. "
    ocrX := 385
    ocrY := 310
    ocrW := 150
    ocrH := 27

    pBitmapOriginal := Gdip_CreateBitmapFromFile(shinedustScreenshotFile)
    pBitmapFormatted := Gdip_CropResizeGreyscaleContrast(pBitmapOriginal, ocrX, ocrY, ocrW, ocrH, 300, 75)

    shineDustValue := GetTextFromBitmap(pBitmapFormatted, allowedChars)
    Gdip_DisposeImage(pBitmapOriginal)
    Gdip_DisposeImage(pBitmapFormatted)

    shineDustValue := RegExReplace(shineDustValue, "[^\d,]", "")
} catch e {
    shineDustValue := ""
}

if (FileExist(shinedustScreenshotFile))
    FileDelete, %shinedustScreenshotFile%

if (RegExMatch(shineDustValue, "^\d[\d,]*\d$|^\d$")) {
    WriteResult(shineDustValue)
    Gdip_Shutdown(pToken)
    ExitApp, 0
} else {
    WriteResult("ERROR: ocr invalido (" . shineDustValue . ")")
    Gdip_Shutdown(pToken)
    ExitApp, 3
}
