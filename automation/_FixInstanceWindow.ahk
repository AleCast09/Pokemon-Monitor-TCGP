; _FixInstanceWindow.ahk
; Arregla el glitch de ventana visible que dejaba una instancia de MuMu antes
; de inyectar (bug real reportado por el usuario 2026-08-01) -- usa las MISMAS
; funciones que ya vive en include/Utils.ahk (copia propia autorizada por
; Kevin, ver _SendTradeCard.ahk), sin arrancar el motor completo de una
; instancia (Scripts/{index}.ahk) para evitar el riesgo de que mas adelante en
; su loop llegue a borrar amigos.
;
; Que hace: guarda que ventana estaba tapando a la de MuMu (si hay alguna),
; le manda un pequeño "resize" (fuerza a Qt a redibujarse bien) y despues
; devuelve esa ventana tapadora a estar arriba de nuevo, sin robarle el foco.
;
; Uso: _FixInstanceWindow.ahk "<winTitle>"
;   winTitle = nombre de la instancia (ej. "1")

#SingleInstance off
SetMouseDelay, -1
SetDefaultMouseSpeed, 0
SetBatchLines, -1
SetTitleMatchMode, 3
CoordMode, Pixel, Screen
#NoEnv

if (A_Args.Length() < 1) {
    ExitApp, 1
}

global g_winTitle := A_Args[1]

; Mismo set de includes que _SendTradeCard.ahk (probado, funciona) -- Utils.ahk
; trae funciones (ej. Delay()) que llaman a cosas de Config/Session/Profiler
; aunque nunca las usemos: AutoHotkey revisa TODO el archivo al cargar, no solo
; lo que se invoca, asi que falta cualquiera de estos tira "call to nonexistent
; function" (bug real encontrado 2026-08-02 con una version mas chica de esto).
#Include %A_ScriptDir%\include\Config.ahk
#Include %A_ScriptDir%\include\Session.ahk
#Include %A_ScriptDir%\include\Profiler.ahk
#Include %A_ScriptDir%\include\Gdip_All.ahk
#Include %A_ScriptDir%\include\Gdip_Imagesearch.ahk

global pToken := Gdip_Startup()

#Include %A_ScriptDir%\include\Utils.ahk
#Include %A_ScriptDir%\include\AccountMetadata.ahk
#Include %A_ScriptDir%\include\ADB.ahk
#Include %A_ScriptDir%\include\Coords.ahk
#Include %A_ScriptDir%\include\MumuHelper.ahk

; Stubs mínimos (mismo patrón que _SendTradeCard.ahk) para no arrastrar la GUI de logging.
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
        logFile := LogsDir . "\Log_FixInstanceWindow.txt"
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

global session   := new Session()
global botConfig := new BotConfig()
botConfig.loadSettingsToConfig("ALL")

windowCoverHwnd := GetMuMuCoverWindowForMaintenance(g_winTitle)
FixInstanceScreen(g_winTitle)
RestoreMuMuCoverWindow(windowCoverHwnd, g_winTitle)

ExitApp, 0
