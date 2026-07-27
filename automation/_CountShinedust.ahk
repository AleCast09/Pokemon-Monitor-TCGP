; _CountShinedust.ahk
; Navega desde la pantalla principal del juego hasta el detalle de "Shinedust" en el
; inventario, toma un screenshot, recorta la region donde aparece el numero y lo lee con
; el OCR nativo de Windows. Escribe el resultado (solo digitos, sin comas) en outputFile.
;
; No es un loop 24/7 (no reintenta con busqueda de imagenes): un solo intento con delays
; fijos, pensado para un chequeo puntual disparado a pedido desde Discord.
;
; Uso: _CountShinedust.ahk "<winTitle>" "<folderPath>" "<outputFile>"
;   winTitle   = nombre de la instancia (ej. "1")
;   folderPath = carpeta base de MuMu (ej. "C:\Program Files\Netease\MuMuPlayer")
;   outputFile = ruta donde escribir el resultado (numero) o "ERROR: <motivo>" si falla

#SingleInstance off
SetMouseDelay, -1
SetDefaultMouseSpeed, 0
SetBatchLines, -1
SetTitleMatchMode, 3
CoordMode, Pixel, Screen
#NoEnv

if (A_Args.Length() < 3) {
    ExitApp, 1
}

global g_winTitle   := A_Args[1]
global g_folderPath := A_Args[2]
global g_outputFile := A_Args[3]

#Include C:\POKEMON\PTCGPB-ALE\Scripts\Include\Config.ahk
#Include C:\POKEMON\PTCGPB-ALE\Scripts\Include\Session.ahk
#Include C:\POKEMON\PTCGPB-ALE\Scripts\Include\Profiler.ahk
#Include C:\POKEMON\PTCGPB-ALE\Scripts\Include\Gdip_All.ahk
#Include C:\POKEMON\PTCGPB-ALE\Scripts\Include\Gdip_Imagesearch.ahk
#Include C:\POKEMON\PTCGPB-ALE\Scripts\Include\Gdip_Extra.ahk
#Include C:\Users\Ale TCG\Documents\Monitor Pokemon\automation\_OcrUtils.ahk

global pToken := Gdip_Startup()

#Include C:\POKEMON\PTCGPB-ALE\Scripts\Include\Utils.ahk
#Include C:\POKEMON\PTCGPB-ALE\Scripts\Include\AccountMetadata.ahk
#Include C:\POKEMON\PTCGPB-ALE\Scripts\Include\ADB.ahk
#Include C:\POKEMON\PTCGPB-ALE\Scripts\Include\Coords.ahk
#Include C:\POKEMON\PTCGPB-ALE\Scripts\Include\MumuHelper.ahk

; Stubs minimos (mismo patron que _SendTradeCard.ahk) para no arrastrar la GUI de logging.
global ScriptDir := RegExReplace(A_LineFile, "\\[^\\]+$")
global LogsDir   := A_ScriptDir . "\Logs"
global Debug := 0
global discordWebhookURL := ""
global discordUserId := ""
global sendAccountXml := 0

CreateStatusMessage(Message, GuiName := "StatusMessage", X := 0, Y := 565, debugOnly := true, Persist := false) {
}
ResetStatusMessage() {
}
LogToFile(message, logFile := "") {
    global LogsDir
    if (logFile = "")
        logFile := LogsDir . "\Log_CountShinedust.txt"
    else
        logFile := LogsDir . "\" . logFile
    FormatTime, readableTime, %A_Now%, MMMM dd, yyyy HH:mm:ss
    try {
        FileAppend, % "[" readableTime "] " message "`n", %logFile%
    } catch e {
    }
}
LogInfo(message, logFile := "") {
    LogToFile("[info] " . message, logFile)
}
LogWarn(message, logFile := "") {
    LogToFile("[warn] " . message, logFile)
}
LogError(message, logFile := "") {
    LogToFile("[error] " . message, logFile)
}
LogDebug(message, logFile := "") {
}
LogTrace(message, logFile := "") {
}
LogToDiscord(message, screenshotFile := "", ping := false, xmlFile := "", screenshotFile2 := "", altWebhookURL := "", altUserId := "") {
}

WriteResult(text) {
    global g_outputFile
    try {
        if (FileExist(g_outputFile))
            FileDelete, %g_outputFile%
        FileAppend, %text%, %g_outputFile%
    } catch e {
    }
}

global session   := new Session()
global botConfig := new BotConfig()
botConfig.loadSettingsToConfig("ALL")

runtimeFolder := botConfig.get("folderPath")
if (runtimeFolder = "" || !InStr(FileExist(runtimeFolder), "D"))
    botConfig.set("folderPath", g_folderPath, "General")

session.set("scriptName", g_winTitle)
session.set("winTitle",   g_winTitle)
session.set("failSafe", A_TickCount)

hwnd := getMuMuHwnd(g_winTitle)
if (!hwnd) {
    LogError("No se encontro la ventana de la instancia: " . g_winTitle)
    WriteResult("ERROR: ventana no encontrada")
    ExitApp, 2
}

global g_mumuHwnd := hwnd
WinGet, savedWndStyle, Style, ahk_id %hwnd%
if (savedWndStyle & 0x00C00000)
    WinSet, Style, -0xC00000, ahk_id %hwnd%
WinGetPos, wx, wy, ww, wh, ahk_id %hwnd%
wyOriginal := wy
if (wy < 0)
    wy := 0
if (ww != 283 || wh != 532 || wy != wyOriginal)
    WinMove, ahk_id %hwnd%, , %wx%, %wy%, 283, 532
Sleep, 180

setADBBaseInfo()
ConnectAdb()
initializeAdbShell()

try {
    adbPid := session.get("adbShell").ProcessID
    if (adbPid) {
        WinWait, ahk_pid %adbPid%, , 2
        WinHide, ahk_pid %adbPid%
    }
} catch e {
}

tap(X, Y) {
    adbClick(X, Y)
    Sleep, 4000
}

; ============ Espera robusta a que el juego llegue al menu principal ============
; La inyeccion de cuenta (_InjectAccount.ahk) puede terminar (exit) antes de que el
; juego termine de recargar -- el tiempo real es variable y no conviene adivinarlo con
; una espera fija. En vez de eso, se usa el mismo mecanismo de reconocimiento de imagen
; que ya usa este proyecto (_SendFriendRequest.ahk) para el mismo problema: reintentar un
; tap "seguro" cada 1.5s hasta reconocer una imagen de referencia que solo aparece en el
; menu principal (needle "Common_ActivatedSocialInMainMenu"), con hasta 4 minutos de
; margen. Funciones copiadas de ese mismo patron (no se modifica ningun archivo de Kevin).

GetNeedle(Path) {
    static NeedleBitmaps := Object()
    if (NeedleBitmaps.HasKey(Path))
        return NeedleBitmaps[Path]
    pNeedle := Gdip_CreateBitmapFromFile(Path)
    needleObj := Object()
    needleObj.Path := Path
    needleObj.needle := pNeedle
    NeedleBitmaps[Path] := needleObj
    return needleObj
}

findNeedle(needleName, searchVariation := 20) {
    global needlesDict, g_mumuHwnd
    needleObj := needlesDict.Get(needleName)
    if (!needleObj)
        return false
    pBitmap := from_window(g_mumuHwnd)
    if (!pBitmap)
        return false
    Path := "C:\POKEMON\PTCGPB-ALE\Scripts\Needles\" . needleObj.imageName . ".png"
    pNeedle := GetNeedle(Path)
    vPosXY := ""
    vRet := Gdip_ImageSearch(pBitmap, pNeedle.needle, vPosXY
        , needleObj.coords.startX, needleObj.coords.startY
        , needleObj.coords.endX,   needleObj.coords.endY
        , searchVariation)
    Gdip_DisposeImage(pBitmap)
    if (vRet = 1)
        return vPosXY ? vPosXY : true
    return false
}

clickUntilNeedle(needleName, clickX, clickY, timeoutSec := 30, retryMs := 800) {
    start := A_TickCount
    lastClick := 0
    Loop {
        if (findNeedle(needleName))
            return true
        if ((A_TickCount - lastClick) >= retryMs) {
            adbClick(clickX, clickY)
            lastClick := A_TickCount
        }
        if ((A_TickCount - start) // 1000 >= timeoutSec)
            return false
        Sleep, 250
    }
    return false
}

LogInfo("Esperando a que el juego llegue al menu principal...")
if (!clickUntilNeedle("Common_ActivatedSocialInMainMenu", 143, 518, 240, 1500)) {
    LogError("Timeout (4 min) esperando el menu principal.")
    WriteResult("ERROR: timeout esperando menu principal")
    ExitWithCleanup(4)
}
Sleep, 500

; La needle de arriba confirma que el juego responde (llegamos al Social Hub, no al home
; puro -- "Common_ActivatedSocialInMainMenu" es el icono de Social ya activo en la barra
; inferior). Volvemos al home real con el icono de Home de esa misma barra antes de
; arrancar nuestra propia navegacion.
tap(36, 510)   ; icono "Home" de la barra inferior

; El juego suele mostrar un popup automatico (News, etc.) al volver a home. "back" de
; Android es riesgoso (un segundo back sin popup abierto puede CERRAR el juego entero,
; ya lo vimos pasar) -- en cambio tapeamos directo la posicion de la "X" del popup, que
; es inofensiva si no hay ningun popup ahi (zona en blanco de la pantalla normal).
tap(141, 480)   ; posicion de la "X" de cierre del popup (si aparece)

; ============ Navegacion hasta el detalle de Shinedust ============
LogInfo("Iniciando chequeo de shinedust para instancia " . g_winTitle)

tap(244, 518)   ; abre menu hamburguesa/configuracion desde la pantalla principal
tap(143, 272)   ; entra a "Items" en ese menu (la lista ya muestra el shinedust directo, calibrado a mano contra una cuenta real)

; ============ Screenshot + OCR ============
tempDir := A_ScriptDir . "\Logs"
if !FileExist(tempDir)
    FileCreateDir, %tempDir%

shinedustScreenshotFile := tempDir . "\" . g_winTitle . "_Shinedust.png"
adbTakeScreenshot(shinedustScreenshotFile)
Sleep, 500

shineDustValue := ""
try {
    if (IsFunc("ocr")) {
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
    } else {
        LogError("La funcion ocr() no esta disponible.")
    }
} catch e {
    LogWarn("Fallo el OCR de shinedust: " . e.message)
    shineDustValue := ""
}

if (FileExist(shinedustScreenshotFile))
    FileDelete, %shinedustScreenshotFile%

if (RegExMatch(shineDustValue, "^\d[\d,]*\d$|^\d$")) {
    LogInfo("Shinedust leido: " . shineDustValue)
    WriteResult(shineDustValue)
    ExitWithCleanup(0)
} else {
    LogWarn("OCR no valido, valor crudo: " . shineDustValue)
    WriteResult("ERROR: ocr invalido (" . shineDustValue . ")")
    ExitWithCleanup(3)
}

ExitWithCleanup(code := 0) {
    global pToken, session
    try {
        if (session.get("adbShell"))
            session.get("adbShell").Terminate()
    } catch e {
    }
    try {
        Gdip_Shutdown(pToken)
    } catch e {
    }
    ExitApp, % code
}
