; _SendFriendRequest.ahk
; Manda la solicitud de amistad al friendId indicado. Copia adaptada del
; _SendFriendRequest.ahk de Kevin (autorizado 2026-07-29, mismo criterio que
; Main.ahk/_SendTradeCard.ahk/_FinalizeTradeCard.ahk): misma logica de
; reconocimiento de imagen (findNeedle/clickUntilNeedle), pero:
;   - recibe el friendId directo por argumento, no lee InjectAccount.ini
;     (Main Trade solo manda UNA solicitud por corrida, no una lista)
;   - sin MsgBox: cualquier fallo escribe "ERROR: <motivo>" en outputFile y
;     termina -- un MsgBox en un proceso headless se quedaria esperando un
;     click que nunca llega
;   - sin el chequeo bloqueante de Settings.ini (Config.ahk ya tolera que no
;     exista, usa valores por defecto)
;
; Uso: _SendFriendRequest.ahk "<winTitle>" "<folderPath>" "<friendId>" "<outputFile>"

#SingleInstance off
SetMouseDelay, -1
SetDefaultMouseSpeed, 0
SetBatchLines, -1
SetTitleMatchMode, 3
CoordMode, Pixel, Screen
#NoEnv

if (A_Args.Length() < 4) {
    ExitApp, 1
}

global g_winTitle   := A_Args[1]
global g_folderPath := A_Args[2]
global g_friendId   := A_Args[3]
global g_outputFile := A_Args[4]

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
        logFile := LogsDir . "\Log_SendFriendRequest.txt"
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
        RestoreMuMuWindow()
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
session.set("dbg_bbox", 0)
session.set("dbg_bboxNpause", 0)
session.set("failSafe", A_TickCount)
session.set("baseTime", 0)

if (!RegExMatch(g_friendId, "^\d{16}$"))
    ExitConError("friend_id_invalido")

hwnd := getMuMuHwnd(g_winTitle)
if (!hwnd)
    ExitConError("ventana_no_encontrada")

global g_mumuHwnd := hwnd
WinGetPos, g_savedWndX, g_savedWndY, g_savedWndW, g_savedWndH, ahk_id %hwnd%
WinGet, g_savedWndStyle, Style, ahk_id %hwnd%
if (g_savedWndStyle & 0x00C00000)
    WinSet, Style, -0xC00000, ahk_id %hwnd%
WinGetPos, wx, wy, ww, wh, ahk_id %hwnd%
if (ww != 283 || wh != 532)
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

; ============ Funciones (copiadas de _SendFriendRequest.ahk de Kevin) ============

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
    Path := A_ScriptDir . "\Needles\" . needleObj.imageName . ".png"
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

tap(X, Y) {
    adbClick(X, Y)
}

clickUntilNeedle(needleName, clickX, clickY, timeoutSec := 30, retryMs := 800) {
    start := A_TickCount
    lastClick := 0
    Loop {
        if (findNeedle(needleName))
            return true
        if ((A_TickCount - lastClick) >= retryMs) {
            tap(clickX, clickY)
            lastClick := A_TickCount
        }
        if ((A_TickCount - start) // 1000 >= timeoutSec)
            return false
        Sleep, 250
    }
    return false
}

SubmitFriendIdSearchAndWait(fid) {
    Sleep, 300
    adbInput(fid)
    Sleep, 500
    tap(187, 365)

    ; Bug real encontrado 2026-07-29 (reporte del usuario: "a veces falla y no
    ; se envia", confirmado con captura mostrando la pantalla "Search Results"
    ; trabada con "Send Request" todavia visible): antes, una vez tocado
    ; "Send Request" una sola vez (sent=true), el toque NUNCA se repetia aunque
    ; el boton siguiera en pantalla (o sea, el toque no habia registrado) --
    ; se quedaba esperando en silencio hasta el timeout de 30s. Ahora reintenta
    ; mientras el boton siga visible, mismo patron que clickUntilNeedle mas
    ; arriba en este archivo -- no se toca ninguna coordenada ni needle de
    ; Kevin, solo la cadencia de reintento. Cooldown subido a 5s (a pedido del
    ; usuario 2026-07-29, mismo dia): con 800ms podia reintentar el toque antes
    ; de que la pantalla terminara de reaccionar al anterior. El cooldown
    ; arranca ANTES del primer toque tambien (no solo entre reintentos).
    lastTapSend := A_TickCount
    start := A_TickCount
    Loop {
        if (findNeedle("Friend_RequestButtonInSearchResult")) {
            if ((A_TickCount - lastTapSend) >= 5000) {
                tap(225, 258) ; movido un poco a la izquierda (2026-07-29): el toque caia en el borde del boton
                lastTapSend := A_TickCount
            }
            Sleep, 250
            continue
        }
        if (findNeedle("Friend_WithdrawButton")) {
            Sleep, 800
            return true
        }
        if (findNeedle("Friend_AcceptedButtonInSearchResult")) {
            Sleep, 800
            return true
        }
        if (findNeedle("Friend_CannotFriendRequest"))
            return false
        if ((A_TickCount - start) // 1000 > 30)
            return false
        if (!lastTapSend)
            adbInputEvent("59 122 67")
        Sleep, 300
    }
}

gotoFriendSearchPanel(timeoutSec := 60) {
    start := A_TickCount
    Loop {
        if (findNeedle("Friend_SearchFriendButton"))
            return true
        if (findNeedle("Common_ActivatedSocialInMainMenu")) {
            tap(38, 460)
        } else if (findNeedle("Friend_AddButtonInFriendList")) {
            tap(240, 120)
            Sleep, 300
        } else {
            tap(155, 425)
        }
        if ((A_TickCount - start) // 1000 >= timeoutSec)
            return false
        Sleep, 400
    }
    return false
}

SendFriendRequestFromMainMenu(fid) {
    if (!clickUntilNeedle("Common_ActivatedSocialInMainMenu", 143, 518, 240, 1500))
        return "no_llego_al_menu_principal"
    if (!gotoFriendSearchPanel(60))
        return "no_llego_al_panel_de_busqueda"
    if (!clickUntilNeedle("Friend_SearchFriendWindowCancelButtonCorner", 75, 440, 20, 1000))
        return "no_abrio_dialogo_agregar_por_id"
    if (!clickUntilNeedle("Friend_FriendIDInputReady", 138, 265, 20, 1000))
        return "no_enfoco_campo_id"
    if (!SubmitFriendIdSearchAndWait(fid))
        return "solicitud_no_confirmada"
    return ""
}

RestoreMuMuWindow() {
    global g_mumuHwnd, g_savedWndX, g_savedWndY, g_savedWndW, g_savedWndH, g_savedWndStyle
    if (!g_mumuHwnd || !WinExist("ahk_id " . g_mumuHwnd))
        return
    if (g_savedWndStyle & 0x00C00000)
        WinSet, Style, +0xC00000, ahk_id %g_mumuHwnd%
    WinMove, ahk_id %g_mumuHwnd%, , %g_savedWndX%, %g_savedWndY%, %g_savedWndW%, %g_savedWndH%
    WinSet, Redraw, , ahk_id %g_mumuHwnd%
}

; ============ Secuencia ============
motivoError := SendFriendRequestFromMainMenu(g_friendId)
if (motivoError != "")
    ExitConError(motivoError)

EscribirResultado("OK")
RestoreMuMuWindow()
try {
    if (session.get("adbShell"))
        session.get("adbShell").Terminate()
} catch e {
}
Gdip_Shutdown(pToken)
ExitApp, 0
