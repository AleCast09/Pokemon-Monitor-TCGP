; _FinalizeTradeCard.ahk
; FASE 2: se ejecuta cuando, desde Discord, se confirma que el compañero ya ofreció su carta.
; Parte de la pantalla "Waiting for a Response" (donde terminó _SendTradeCard.ahk), presiona
; Refresh, confirma el trade, desliza para enviar la carta, y apaga la instancia por completo.
;
; Uso: _FinalizeTradeCard.ahk "<winTitle>" "<folderPath>" "<instanceIndex>"
;   winTitle      = nombre de la instancia (ej. "1")
;   folderPath    = carpeta base de MuMu (ej. "C:\Program Files\Netease\MuMuPlayer")
;   instanceIndex = índice numérico de MuMu (el que usa MuMuManager, ej. "1")

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

global g_winTitle      := A_Args[1]
global g_folderPath    := A_Args[2]
global g_instanceIndex := A_Args[3]

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
    global LogsDir
    if (logFile = "")
        logFile := LogsDir . "\Log_FinalizeTradeCard.txt"
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

runtimeFolder := botConfig.get("folderPath")
if (runtimeFolder = "" || !InStr(FileExist(runtimeFolder), "D"))
    botConfig.set("folderPath", g_folderPath, "General")

session.set("scriptName", g_winTitle)
session.set("winTitle",   g_winTitle)
session.set("failSafe", A_TickCount)

hwnd := getMuMuHwnd(g_winTitle)
if (!hwnd) {
    LogError("No se encontró la ventana de la instancia: " . g_winTitle)
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
    Sleep, 2800
}

swipeUp(X, Y1, Y2, durationMs := 400) {
    adbSwipe(X . " " . Y1 . " " . X . " " . Y2 . " " . durationMs)
    Sleep, 2800
}

; ============ Secuencia de la Fase 2 ============
LogInfo("Iniciando Fase 2 (finalizar trade) para instancia " . g_winTitle)

tap(226, 374)          ; 14. Waiting for a Response -> Refresh
tap(205, 456)           ; 15. Trade for This Card? -> Trade
tap(200, 360)           ; 16. "Finalize this trade?" -> OK
swipeUp(144, 417, 150)  ; 17. Swipe the card to send it to your trade partner (estimado, verificar)

Sleep, 2000
LogInfo("Trade finalizado. Apagando instancia " . g_instanceIndex . "...")

; 18. Apagar la instancia por completo (vía MuMuManager, mismo mecanismo que 'control launch').
managerPath := g_folderPath . "\nx_main\MuMuManager.exe"
if (!FileExist(managerPath))
    managerPath := g_folderPath . "\shell\MuMuManager.exe"
if (FileExist(managerPath)) {
    RunWait, "%managerPath%" control shutdown -v %g_instanceIndex%,, Hide
} else {
    LogWarn("No se encontró MuMuManager.exe para apagar la instancia.")
}

LogInfo("Fase 2 completa: trade finalizado, instancia apagándose.")

ExitWithCleanup(0)

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
