; _FriendTradeCheckPendingOffer.ahk -- creado 2026-08-22, a pedido explicito del usuario:
; mismo chequeo que Main Trade ya tiene (_CheckPendingOffer.ahk) pero adaptado al punto de
; partida real de Friend Trade -- Main arranca desde Social Hub (recien salido de
; _MainAcceptFriendRequest.ahk), Friend Trade arranca desde la pantalla "Search Results"
; (recien salido de _SendFriendRequest.ahk, mismo punto de partida que ya usa
; _SendTradeCard.ahk). Se reusa la navegacion de cierre de dialogos de _SendTradeCard.ahk
; (pasos 1-6, ya probada en produccion) + la misma logica de doble confirmacion de
; _CheckPendingOffer.ahk.
;
; Needle: own_friendtrade_offer_view_badge (2026-08-22, recortada y verificada en vivo contra
; una prueba real -- la needle de Main Trade, own_maintrade_unread_badge, NO matcheaba aca
; (probado directo, resultado 0). La nueva matchea SOLO en la pantalla limpia real con el
; boton "View" visible, y NO matchea contra las 2 pantallas de tutorial que puede mostrar una
; cuenta nueva antes de llegar ahi -- confirma justo el momento en que es seguro actuar, sin
; falsos positivos por el tutorial.
;
; Uso: _FriendTradeCheckPendingOffer.ahk "<winTitle>" "<folderPath>" "<outputFile>"
;   Escribe "OK" si encuentra una oferta pendiente real, "ERROR: no_hay_oferta_pendiente"
;   si no (timeout corto, 6s).

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
#Include %A_ScriptDir%\_ZonasNeedles.ahk
#Include %A_ScriptDir%\lib\Gdip_All.ahk
#Include %A_ScriptDir%\lib\Gdip_Imagesearch.ahk

global pToken := Gdip_Startup()

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
if (adbPath = "") {
    WriteResult("ERROR: adb_no_encontrado")
    ExitApp, 3
}
puerto := resolverPuertoAdb(g_folderPath, g_winTitle)
if (puerto = "") {
    WriteResult("ERROR: puerto_no_encontrado")
    ExitApp, 3
}
AdbConectar(adbPath, puerto)

; Handle de la ventana real, para el chequeo rapido por captura directa (2026-08-26, mismo
; mecanismo que _DonorOfferCard.ahk / _FriendTradeOfferCard.ahk / _SpeedMod.ahk /
; _WaitWelcomeScreens*.ahk). No fatal si no se encuentra.
global g_hwndFast := WinExist(g_winTitle . " ahk_class Qt5156QWindowIcon")

tap(x, y, esperaMs := 4000) {
    static convX := 540/283, convY := 960/488, offset := 40
    global adbPath, puerto
    AdbTap(adbPath, puerto, Round(x * convX), Round((y - offset) * convY))
    Sleep, %esperaMs%
}

; Chequeo unico, sin tap ni loop (2026-08-23) -- para decisiones rapidas de "esto esta o no
; esta ahora mismo", sin gatillar ninguna accion.
buscarNeedle(nombreNeedle, variation) {
    global adbPath, puerto, g_winTitle
    tempFile := A_ScriptDir . "\Logs\_step_check_" . g_winTitle . ".png"
    AdbScreenshot(adbPath, puerto, tempFile)
    encontrado := false
    if (FileExist(tempFile)) {
        pBitmap := Gdip_CreateBitmapFromFile(tempFile)
        FileDelete, %tempFile%
        if (pBitmap) {
            pNeedle := Gdip_CreateBitmapFromFile(A_ScriptDir . "\Needles\" . nombreNeedle . ".png")
            if (pNeedle) {
                vPos := ""
                encontrado := (buscarNeedleZonal(pBitmap, pNeedle, vPos, variation, nombreNeedle) = 1)
                Gdip_DisposeImage(pNeedle)
            }
            Gdip_DisposeImage(pBitmap)
        }
    }
    return encontrado
}

; Chequeo rapido por captura directa de ventana (2026-08-26, ver comentario completo en
; _DonorOfferCard.ahk / _FriendTradeOfferCard.ahk). Sin riesgo de regresion: sin needle
; nativa para el paso, o sin ventana resuelta, o sin match -- cae al chequeo lento de siempre.
chequeoRapidoNeedle(nombreNeedleNativo, variationNativo) {
    global g_hwndFast
    if (nombreNeedleNativo = "" || !g_hwndFast)
        return false
    pBitmap := capturarVentana(g_hwndFast)
    if (!pBitmap)
        return false
    encontrado := false
    pNeedle := Gdip_CreateBitmapFromFile(A_ScriptDir . "\Needles\" . nombreNeedleNativo . ".png")
    if (pNeedle) {
        vPos := ""
        encontrado := (buscarNeedleZonal(pBitmap, pNeedle, vPos, variationNativo, nombreNeedleNativo) = 1)
        Gdip_DisposeImage(pNeedle)
    }
    Gdip_DisposeImage(pBitmap)
    return encontrado
}

; Reconocimiento real antes de tocar (mismo patron que _DonorOfferCard.ahk).
; Parametros nombreNeedleNativo/variationNativo (2026-08-26, opcionales): ver chequeoRapidoNeedle.
esperarNeedleYTap(nombreNeedle, variation, x, y, timeoutMs := 15000, nombreNeedleNativo := "", variationNativo := 30) {
    global adbPath, puerto, g_winTitle
    inicio := A_TickCount
    Loop {
        if (chequeoRapidoNeedle(nombreNeedleNativo, variationNativo)) {
            tap(x, y)
            return true
        }
        tempFile := A_ScriptDir . "\Logs\_step_check_" . g_winTitle . ".png"
        AdbScreenshot(adbPath, puerto, tempFile)
        encontrado := false
        if (FileExist(tempFile)) {
            pBitmap := Gdip_CreateBitmapFromFile(tempFile)
            FileDelete, %tempFile%
            if (pBitmap) {
                pNeedle := Gdip_CreateBitmapFromFile(A_ScriptDir . "\Needles\" . nombreNeedle . ".png")
                if (pNeedle) {
                    vPos := ""
                    encontrado := (buscarNeedleZonal(pBitmap, pNeedle, vPos, variation, nombreNeedle) = 1)
                }
                Gdip_DisposeImage(pBitmap)
            }
        }
        if (encontrado) {
            tap(x, y)
            return true
        }
        if (A_TickCount - inicio > timeoutMs)
            return false
        Sleep, 500
    }
}

; Chequeo del badge directo en Social Hub (2026-08-23, bug real reproducido en vivo, a
; pedido explicito del usuario -- "si aparece eso que tambien abra trade, como segunda
; opcion"): cuando SI hay una oferta pendiente real, el propio icono de "Trade" en Social Hub
; se ve distinto -- le aparece encima un badge rojo "!" + un banner "Trade offer received",
; tapando la needle normal (own_donoroffer_trade_icon, probado hasta variation=130, cero
; match -- el banner realmente cubre el icono, no es un problema de tolerancia). Si aparece
; este badge propio, se abre Trade a ciegas (ya se sabe que hay algo esperando).
; Chequeo rapido cableado (2026-08-26): needle propia own_donoroffer_trade_icon_native (el
; tile "Trade" de Social Hub), validada en vivo -- match exacto contra la captura real, sin
; ningun falso positivo cruzado (los 2 "matches" extra fueron la misma pantalla real
; duplicada por error de nombrado, no una pantalla distinta).
if (buscarNeedle("own_friendtrade_socialhub_pending_badge", 30)) {
    tap(207, 421)
} else if (!esperarNeedleYTap("own_donoroffer_trade_icon", 30, 207, 402, 15000, "own_donoroffer_trade_icon_native", 30)) {
    ExitConError("no_aparecio_socialhub")
}

; Chequeo rapido del badge ANTES del tap ciego de mas abajo (2026-08-23, bug real
; reproducido en vivo): own_donoroffer_trade_icon SI hay oferta pendiente salta derecho a
; "Trade offer received" (con el boton View) -- la pantalla intro que el tap de abajo espera
; nunca aparece. Probado en vivo: ese tap ciego (139,427) cae justo ENCIMA del boton View
; real y lo toca sin querer, avanzando a la pantalla de detalle ANTES de que el chequeo
; principal de mas abajo llegue a ver el badge -- reportaba "sin oferta" aunque SI hubiera
; una real. Este chequeo corto (timeout 3s, sin doble confirmacion -- es solo un atajo, el
; chequeo fuerte de mas abajo confirma en serio) evita pisar el tap ciego cuando la oferta
; ya esta visible de entrada.
badgeYaVisible := false
tempFileAtajo := A_ScriptDir . "\Logs\_friendcheck_atajo_" . g_winTitle . ".png"
AdbScreenshot(adbPath, puerto, tempFileAtajo)
if (FileExist(tempFileAtajo)) {
    pBitmapAtajo := Gdip_CreateBitmapFromFile(tempFileAtajo)
    FileDelete, %tempFileAtajo%
    if (pBitmapAtajo) {
        pNeedleAtajo := Gdip_CreateBitmapFromFile(A_ScriptDir . "\Needles\own_friendtrade_offer_view_badge.png")
        vPosAtajo := ""
        badgeYaVisible := (pNeedleAtajo && buscarNeedleZonal(pBitmapAtajo, pNeedleAtajo, vPosAtajo, 50, "own_friendtrade_offer_view_badge") = 1)
        if (pNeedleAtajo)
            Gdip_DisposeImage(pNeedleAtajo)
        Gdip_DisposeImage(pBitmapAtajo)
    }
}
if (badgeYaVisible) {
    Gdip_Shutdown(pToken)
    WriteResult("OK")
    ExitApp, 0
}

; Paso adicional (2026-08-23): SI NO hay oferta pendiente (chequeo de arriba no la vio),
; own_donoroffer_trade_icon deja parado en la pantalla intro ("You can trade cards with
; friends.", boton grande "Trade") -- hace falta este tap para llegar a "Select a Friend".
; Vuelto a la needle real own_donoroffer_trade_button (139,427) -- (230,290), probado en
; vivo, cae en una zona muerta de la pantalla intro (no le pega al boton real), dejando la
; instancia trabada ahi para siempre. Ya no hace falta la coordenada "segura" alternativa:
; para cuando se llega aca, YA se confirmo 2 veces (badge de Social Hub arriba + este chequeo
; rapido) que no hay oferta pendiente, asi que no hay riesgo real de tocar "View" sin querer.
; Chequeo rapido cableado (2026-08-26): needle propia own_maintrade_trade_button_native, ya
; validada en vivo en _DonorOfferCard.ahk (misma pantalla real de Trade generica).
if (!esperarNeedleYTap("own_donoroffer_trade_button", 30, 139, 427, 15000, "own_maintrade_trade_button_native", 30))
    ExitConError("no_aparecio_trade_landing")

; Tutorial de primera vez (2026-08-22/23, bug real en vivo: una cuenta que entra a Trade por
; primera vez muestra un tutorial de 3 paginas fijas que tapa toda la pantalla real -- sin
; esto, la needle de mas abajo nunca tiene chance de matchear, aunque SI haya una oferta
; pendiente real detras). own_friendtrade_offer_tutorial_help (el icono "?", solo visible en
; la pagina 1) detecta el tutorial -- si aparece, se lo saltea a ciegas (Next, Next, OK),
; siempre son exactamente 3 paginas fijas para cualquier cuenta nueva.
tempFileTutorial := A_ScriptDir . "\Logs\_friendcheck_tutorial_" . g_winTitle . ".png"
AdbScreenshot(adbPath, puerto, tempFileTutorial)
hayTutorial := false
if (FileExist(tempFileTutorial)) {
    pBitmapTutorial := Gdip_CreateBitmapFromFile(tempFileTutorial)
    FileDelete, %tempFileTutorial%
    if (pBitmapTutorial) {
        pNeedleTutorial := Gdip_CreateBitmapFromFile(A_ScriptDir . "\Needles\own_friendtrade_offer_tutorial_help.png")
        vPosTutorial := ""
        hayTutorial := (pNeedleTutorial && buscarNeedleZonal(pBitmapTutorial, pNeedleTutorial, vPosTutorial, 30, "own_friendtrade_offer_tutorial_help") = 1)
        if (pNeedleTutorial)
            Gdip_DisposeImage(pNeedleTutorial)
        Gdip_DisposeImage(pBitmapTutorial)
    }
}
if (hayTutorial) {
    tap(202, 431)   ; pagina 1/3 "Trade Offer Received" -> Next
    tap(202, 431)   ; pagina 2/3 "Choose a Card to Trade" -> Next
    tap(202, 431)   ; pagina 3/3 "Trade agreement reached" -> OK
}

; Doble confirmacion (mismo criterio que _CheckPendingOffer.ahk de Main Trade): exige 2
; capturas seguidas (800ms) antes de confiar en el resultado, para evitar un falso positivo
; de un frame de transicion de pantalla.
inicio := A_TickCount
encontrado := false
matchesSeguidos := 0
Loop {
    tempFile := A_ScriptDir . "\Logs\_friendcheckpending_" . g_winTitle . ".png"
    AdbScreenshot(adbPath, puerto, tempFile)
    unMatch := false
    if (FileExist(tempFile)) {
        pBitmap := Gdip_CreateBitmapFromFile(tempFile)
        FileDelete, %tempFile%
        if (pBitmap) {
            pNeedle := Gdip_CreateBitmapFromFile(A_ScriptDir . "\Needles\own_friendtrade_offer_view_badge.png")
            vPos := ""
            ; variation=50 (2026-08-23, probado en vivo contra 2 capturas reales del boton View
            ; en dias distintos -- con 30 fallaba contra la segunda, hay variacion real de
            ; color entre capturas; con 50 matchean las 2 y sigue sin falsos positivos contra
            ; las 4 pantallas de tutorial, probado hasta variation=90).
            unMatch := (pNeedle && buscarNeedleZonal(pBitmap, pNeedle, vPos, 50, "own_friendtrade_offer_view_badge") = 1)
            Gdip_DisposeImage(pBitmap)
        }
    }
    if (unMatch) {
        matchesSeguidos++
        if (matchesSeguidos >= 2) {
            encontrado := true
            break
        }
        Sleep, 800
        continue
    } else {
        matchesSeguidos := 0
    }
    if (A_TickCount - inicio > 6000)
        break
    Sleep, 500
}

Gdip_Shutdown(pToken)
if (encontrado) {
    WriteResult("OK")
    ExitApp, 0
}
WriteResult("ERROR: no_hay_oferta_pendiente")
ExitApp, 3
