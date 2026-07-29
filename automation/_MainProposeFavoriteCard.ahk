; _MainProposeFavoriteCard.ahk
; Reemplaza a _MainAcceptAndTrade.ahk (a pedido explicito del usuario
; 2026-07-29): en vez de buscar la carta por nombre, Main ofrece la carta
; marcada como Favorita en su propia coleccion. Corre en la instancia Main
; justo despues de que Main.ahk (matado a los 30s de arrancarlo) ya acepto
; la solicitud pendiente de la donante.
;
; Coordenadas y secuencia dadas por el usuario (2026-07-29), todas LOGICAS
; (283x532, mismo sistema que _SendTradeCard.ahk/_FinalizeTradeCard.ahk) --
; usa adbClick/adbSwipe de Kevin (include\ADB.ahk), que ya hacen la
; conversion a pixeles reales del dispositivo internamente.
;
; Uso: _MainProposeFavoriteCard.ahk "<winTitleMain>" "<folderPath>" "<outputFile>"

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

; Stubs minimos (mismo patron que _SendTradeCard.ahk/_SendFriendRequest.ahk)
; para no arrastrar la GUI de logging de Kevin.
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
        logFile := LogsDir . "\Log_MainProposeFavoriteCard.txt"
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
    global pToken, session
    EscribirResultado("ERROR: " . motivo)
    try {
        if (session.get("adbShell"))
            session.get("adbShell").Terminate()
    } catch e {
    }
    try {
        Gdip_Shutdown(pToken)
    } catch e {
    }
    ExitApp, 3
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
if (!hwnd)
    ExitConError("ventana_no_encontrada")

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

tap(X, Y, esperaMs := 4000) {
    adbClick(X, Y)
    Sleep, %esperaMs%
}

; Swipe con presion sostenida entre dos puntos logicos -- misma conversion
; logico->dispositivo que ya aplica adbClick internamente (540/283, 960/488,
; offset 40), asi el gesto cae en el mismo punto que el resto de los toques.
swipe(X, Y1, Y2, duracionMs := 600, esperaMs := 4000) {
    static convX := 540/283, convY := 960/488, offset := 40
    devX  := Round(X * convX)
    devY1 := Round((Y1 - offset) * convY)
    devY2 := Round((Y2 - offset) * convY)
    adbSwipe(devX . " " . devY1 . " " . devX . " " . devY2 . " " . duracionMs)
    Sleep, %esperaMs%
}

; ============ Secuencia (coordenadas dadas por el usuario 2026-07-29) ============
tap(140, 500)          ; 1. presionar 2 veces (inicio)
tap(140, 500)
tap(200, 400)          ; 2. boton intercambiar
tap(140, 380)          ; 2.5
tap(140, 420)          ; 3. boton de vale intercambiar
tap(210, 460)          ; 3.5. boton de intercambiar carta
tap(246, 149)          ; 4. lupa buscar carta
tap(82, 328)           ; 5. boton de favoritos
tap(143, 457)          ; 6. boton de buscar
tap(249, 497)          ; 6.1. boton de ajustes de cartas (corregido 2026-07-29)
tap(200, 346)          ; 6.2. boton de ordenar por mayor cartas
swipe(140, 330, 230)   ; 7. swipe hacia arriba hasta altura 230 (con presion, no toque suelto)
tap(57, 357)           ; 8. selecciona carta a tradear al bot
tap(141, 461)          ; 9. boton de vale
tap(200, 460)          ; 10. boton de vale (confirmar carta)
tap(200, 364, 7000)    ; 11. confirmacion -- 7 segundos (paso mas lento, a pedido del usuario)
tap(140, 430)          ; 12. enviando carta

EscribirResultado("PROPUESTO")
Gdip_Shutdown(pToken)
ExitApp, 0
