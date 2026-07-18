; _SendTradeCard.ahk
; FASE 1: desde la pantalla "Search Results" (justo después de que _SendFriendRequest.ahk
; termina de enviar la solicitud de amistad), navega hasta Social Hub > Trade > Select a Friend,
; abre el trade con el amigo, ofrece la primera carta que aparece en "Trade Partner's Wishlist"
; (la carta favorita/deseada del amigo), y se detiene en "Waiting for a Response".
;
; IMPORTANTE: asume que el amigo YA fue aceptado y aparece en "Select a Friend" (camino feliz).
; El reintento para cuando el amigo aún no aparece se agrega después.
;
; Uso: _SendTradeCard.ahk "<winTitle>" "<folderPath>"
;   winTitle   = nombre de la instancia (ej. "1")
;   folderPath = carpeta base de MuMu (ej. "C:\Program Files\Netease\MuMuPlayer")

#SingleInstance off
SetMouseDelay, -1
SetDefaultMouseSpeed, 0
SetBatchLines, -1
SetTitleMatchMode, 3
CoordMode, Pixel, Screen
#NoEnv

if (A_Args.Length() < 2) {
    ExitApp, 1
}

global g_winTitle   := A_Args[1]
global g_folderPath := A_Args[2]

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

; Stubs mínimos (mismo patrón que _SendFriendRequest.ahk) para no arrastrar la GUI de logging.
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
        logFile := LogsDir . "\Log_SendTradeCard.txt"
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

; ============ Secuencia de la Fase 1 ============
LogInfo("Iniciando Fase 1 de trade para instancia " . g_winTitle)

tap(140, 500)   ; 1. Search Results -> X (cerrar)
tap(83, 360)    ; 2. Friend ID Search -> Cancel
tap(140, 500)   ; 3. Add Friend (QR) -> X (cerrar)
tap(140, 500)   ; 4. Friends -> X (cerrar)

; 5. Social Hub -> Trade (icono). Esta pantalla tarda más en cargar que las demás, así que le
; damos más tiempo de espera que al resto de los taps antes de seguir.
adbClick(200, 400)
Sleep, 6000
tap(146, 423)   ; 6. Trade (intro) -> Trade (boton azul)

tap(211, 177)   ; 7. Select a Friend -> Trade (fila del amigo)
tap(142, 423)   ; 7b. "Choose a Card to Trade" (aviso/tutorial) -> OK
tap(50, 350)    ; 8. Choose a Card to Trade -> tap carta favorita (wishlist del amigo)
tap(145, 458)   ; 9. Choose a Card to Trade -> OK
tap(207, 446)   ; 10. Trade Partner: [carta] -> OK

tap(200, 360)   ; 11. "Set this as your card to be traded?" -> OK
tap(206, 376)   ; 11a. OK
Sleep, 2500
tap(140, 440)   ; 11b. OK

; Paso 12: aviso condicional "Only one remaining copy..." (solo si es tu ultima copia de la
; carta). No lo tocamos a ciegas para no mal-clickear la pantalla siguiente si no aparece.

tap(140, 430)   ; 13. "You have offered the card..." -> OK

LogInfo("Fase 1 completa: carta ofrecida, esperando respuesta del compañero.")

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
