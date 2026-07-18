; _CaptureNeedle.ahk
; Herramienta para capturar una imagen de referencia ("needle") desde la ventana de una instancia
; de MuMu ya redimensionada a 283x532 (el mismo tamaño que usan los scripts reales). Guarda la
; captura completa como PNG para que después la recortes vos (con Paint u otro editor) y te quede
; solo el botón/elemento que quieras usar como referencia para _SendTradeCard.ahk.
;
; Uso: doble clic y escribe el nombre de la instancia cuando lo pida.
;      _CaptureNeedle.ahk "1"
;
; La imagen se guarda en la carpeta "Needles" (al lado de este script) como capturaN.png.

#SingleInstance force
SetMouseDelay, -1
SetDefaultMouseSpeed, 0
SetBatchLines, -1
SetTitleMatchMode, 3
CoordMode, Pixel, Screen
#NoEnv

if (A_Args.Length() >= 1)
    g_winTitle := A_Args[1]
else {
    InputBox, g_winTitle, Capture Needle, Nombre de la instancia (ejemplo: 1 o Main):
    if (ErrorLevel)
        ExitApp
}

#Include C:\POKEMON\PTCGPB-ALE\Scripts\Include\Config.ahk
#Include C:\POKEMON\PTCGPB-ALE\Scripts\Include\Session.ahk
#Include C:\POKEMON\PTCGPB-ALE\Scripts\Include\Profiler.ahk
#Include C:\POKEMON\PTCGPB-ALE\Scripts\Include\Gdip_All.ahk
#Include C:\POKEMON\PTCGPB-ALE\Scripts\Include\Gdip_Imagesearch.ahk

global pToken := Gdip_Startup()

#Include C:\POKEMON\PTCGPB-ALE\Scripts\Include\Utils.ahk
#Include C:\POKEMON\PTCGPB-ALE\Scripts\Include\AccountMetadata.ahk
#Include C:\POKEMON\PTCGPB-ALE\Scripts\Include\ADB.ahk
#Include C:\POKEMON\PTCGPB-ALE\Scripts\Include\Coords.ahk
#Include C:\POKEMON\PTCGPB-ALE\Scripts\Include\MumuHelper.ahk

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
}
LogInfo(message, logFile := "") {
}
LogWarn(message, logFile := "") {
}
LogError(message, logFile := "") {
}
LogDebug(message, logFile := "") {
}
LogTrace(message, logFile := "") {
}
LogToDiscord(message, screenshotFile := "", ping := false, xmlFile := "", screenshotFile2 := "", altWebhookURL := "", altUserId := "") {
}

global session   := new Session()
global botConfig := new BotConfig()
botConfig.loadSettingsToConfig("ALL")

hwnd := WinExist(g_winTitle . " ahk_class Qt5156QWindowIcon")
if (!hwnd) {
    MsgBox, 16, Capture Needle, No se encontró la ventana de la instancia "%g_winTitle%".`n`nAsegúrate de que esté abierta.
    Gdip_Shutdown(pToken)
    ExitApp
}

WinGet, savedWndStyle, Style, ahk_id %hwnd%
if (savedWndStyle & 0x00C00000)
    WinSet, Style, -0xC00000, ahk_id %hwnd%
WinGetPos, wx, wy, ww, wh, ahk_id %hwnd%
wyOriginal := wy
if (wy < 0)
    wy := 0
if (ww != 283 || wh != 532 || wy != wyOriginal)
    WinMove, ahk_id %hwnd%, , %wx%, %wy%, 283, 532
Sleep, 250

carpetaNeedles := A_ScriptDir . "\Needles"
if (!InStr(FileExist(carpetaNeedles), "D"))
    FileCreateDir, %carpetaNeedles%

pBitmap := from_window(hwnd)
if (!pBitmap) {
    MsgBox, 16, Capture Needle, No se pudo capturar la ventana.
    Gdip_Shutdown(pToken)
    ExitApp
}

n := 1
Loop {
    salida := carpetaNeedles . "\captura" . n . ".png"
    if (!FileExist(salida))
        break
    n++
}
Gdip_SaveBitmapToFile(pBitmap, salida)
Gdip_DisposeImage(pBitmap)
Gdip_Shutdown(pToken)

MsgBox, 64, Capture Needle, Captura guardada en:`n%salida%`n`nAhora abrila con Paint (u otro editor)`, recortá SOLO el botón o zona que quieras usar como referencia (bien ajustado`, sin espacio de sobra alrededor)`, y guardala como PNG con el nombre que te indique.
ExitApp
