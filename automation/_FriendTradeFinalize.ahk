; _FriendTradeFinalize.ahk -- creado 2026-08-23, a pedido explicito del usuario: copia
; directa de la parte de la donante en Main Trade (_DonorRespondAndFinalize.ahk), sin tocar
; nada de Main. Reemplaza al viejo _FinalizeTradeCard.ahk (a ciegas, sin needles). Corre
; cuando el usuario presiona "Finalize Trade" en Discord -- refresca, acepta el intercambio,
; confirma, desliza la carta para enviarla, y cierra el aviso final. NO apaga la instancia
; (eso lo hace bot.js aparte, mismo criterio que Main Trade).
; Uso: _FriendTradeFinalize.ahk "<winTitle>" "<folderPath>" "<outputFile>"

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
if (adbPath = "")
    ExitConError("adb_no_encontrado")
puerto := resolverPuertoAdb(g_folderPath, g_winTitle)
if (puerto = "")
    ExitConError("puerto_no_encontrado")
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

; Chequeo de cordura (2026-08-04): si el juego crasheo y volvio al titulo, cortar con
; error claro en vez de seguir tocando a ciegas.
verificarNoCrasheado() {
    global adbPath, puerto
    tempFile := A_ScriptDir . "\Logs\_sanity_check.png"
    AdbScreenshot(adbPath, puerto, tempFile)
    if (!FileExist(tempFile))
        return
    crasheado := false
    try {
        pBitmap := Gdip_CreateBitmapFromFile(tempFile)
        pNeedle := Gdip_CreateBitmapFromFile(A_ScriptDir . "\Needles\own_tapstart_logo.png")
        if (pNeedle) {
            vPos := ""
            if (Gdip_ImageSearch(pBitmap, pNeedle, vPos, 0, 0, 0, 0, 75) = 1)
                crasheado := true
        }
        Gdip_DisposeImage(pBitmap)
    } catch e {
    }
    FileDelete, %tempFile%
    if (crasheado)
        ExitConError("juego_crasheo_volvio_al_titulo")
}
verificarNoCrasheado()

; Chequeo rapido por captura directa de ventana (2026-08-26, ver comentario completo en
; _DonorOfferCard.ahk). Sin riesgo de regresion.
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
        encontrado := (Gdip_ImageSearch(pBitmap, pNeedle, vPos, 0, 0, 0, 0, variationNativo) = 1)
        Gdip_DisposeImage(pNeedle)
    }
    Gdip_DisposeImage(pBitmap)
    return encontrado
}

; Bug real confirmado en vivo 2026-08-26 (ver comentario completo en
; _DonorRespondAndFinalize.ahk): el swipe que manda la carta no registra con Speed Mod en 3x.
; No se restaura a 3x despues, a pedido explicito del usuario -- el trade ya esta terminado.
bajarSpeedModA1xSiEstaActivo() {
    global adbPath, puerto
    if (!chequeoRapidoNeedle("own_speedmod_icon", 80))
        return false
    tap(18, 109, 800)
    Sleep, 800
    RunWait, %ComSpec% /c ""%adbPath%" -s 127.0.0.1:%puerto% shell input swipe 363 248 33 248 600", , Hide
    Sleep, 1000
    tap(171, 285, 500)
    return true
}

; Reconocimiento real antes de tocar (2026-08-05, a pedido explicito del usuario): espera
; (poll cada 500ms, hasta timeoutMs) a que la needle de la pantalla ESPERADA aparezca antes
; de tocar -- asi un PC lento no rompe el timing.
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
                    encontrado := (Gdip_ImageSearch(pBitmap, pNeedle, vPos, 0, 0, 0, 0, variation) = 1)
                }
                ; Chequeo de crash EN CADA poll (2026-08-19, bug real reproducido en vivo --
                ; ver comentario completo en _MainAcceptTradeOffer.ahk, mismo fix aplicado a
                ; los 4 scripts del pipeline): reusa la captura ya sacada, solo DETECTA y
                ; corta con error claro -- no reintenta reabrir el juego aca a proposito.
                if (!encontrado) {
                    pCrash := Gdip_CreateBitmapFromFile(A_ScriptDir . "\Needles\own_tapstart_logo.png")
                    if (pCrash) {
                        vPosCrash := ""
                        if (Gdip_ImageSearch(pBitmap, pCrash, vPosCrash, 0, 0, 0, 0, 75) = 1) {
                            Gdip_DisposeImage(pBitmap)
                            ExitConError("juego_crasheo_volvio_al_titulo")
                        }
                    }
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

; Igual que esperarNeedleYTap pero sin ninguna accion al encontrarla (2026-08-09, a pedido
; explicito del usuario: sacar la foto real de la carta justo antes del swipe que la manda --
; deja la pantalla intacta para que el caller saque su propia captura antes de actuar).
esperarNeedleSinAccion(nombreNeedle, variation, timeoutMs := 15000, nombreNeedleNativo := "", variationNativo := 30) {
    global adbPath, puerto, g_winTitle
    inicio := A_TickCount
    Loop {
        if (chequeoRapidoNeedle(nombreNeedleNativo, variationNativo))
            return true
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
                    encontrado := (Gdip_ImageSearch(pBitmap, pNeedle, vPos, 0, 0, 0, 0, variation) = 1)
                }
                Gdip_DisposeImage(pBitmap)
            }
        }
        if (encontrado)
            return true
        if (A_TickCount - inicio > timeoutMs)
            return false
        Sleep, 500
    }
}

; Navega a Social Hub -> Trade antes de esperar la pantalla (2026-08-19, bug real
; reproducido en vivo): este script asumia que la donante YA estaba parada en la pantalla
; de "esperando respuesta" (como la deja _DonorOfferCard.ahk en el flujo normal) -- pero si
; el pipeline salto ese paso (oferta pendiente detectada desde antes, ver
; _CheckPendingOffer.ahk) la donante puede estar en cualquier otra pantalla (ej. sobres).
; Seguro tambien en el flujo normal: si ya esta en la pantalla de espera, re-entrar a Trade
; muestra el mismo estado real (servidor, no una pantalla de una sola vez).
; tap(207,402) SACADO (2026-08-26, a pedido explicito del usuario, confirmado en vivo): a esta
; altura del pipeline la donante ya esta DENTRO de Trade (no en Social Hub), asi que ese
; segundo toque caia en una zona vacia sin hacer nada -- solo sumaba 4s de espera al pedo.
tap(141, 511)

; Needle y coordenada recalculadas 2026-08-19 (bug real en vivo, cuenta real): la needle
; vieja (icono "?") ya no matcheaba esta pantalla, y su coordenada de tap tampoco caia
; sobre el boton "View" real -- needle re-recortada del icono "?" fresco de esta pantalla
; real, coordenada recalculada al centro real del boton View (140-400,708-772 en pixeles
; reales de 540x960 -> aprox 141,416 en el sistema logico de este script).
; Chequeo rapido cableado (2026-08-26): needle propia own_donorfinalize_waiting_title_native
; (el badge rojo "!" del boton View), ya validada en _DonorRespondAndFinalize.ahk.
if (!esperarNeedleYTap("own_donorfinalize_waiting_title", 30, 141, 416, 15000, "own_donorfinalize_waiting_title_native", 30))
    ExitConError("no_aparecio_waiting_response_paso1")

; Foto real del trade (2026-08-09, a pedido explicito del usuario -- corregida: se movio de
; la pantalla del swipe a ESTA, "Trade for This Card?", porque ahi se ven las DOS cartas a la
; vez -- la que se manda Y la que se recibe -- en vez de una sola como en el swipe). Se saca
; ANTES de tocar para seguir, mientras la pantalla todavia esta completa. Nombre derivado del
; outputFile (mismo que ya recibe este script como 3er argumento) para que bot.js sepa
; exactamente donde buscarla sin necesitar coordinarse por otro lado.
; Chequeo rapido cableado (2026-08-26): needle propia own_donorfinalize_tradeforcard_title_native,
; ya validada en _DonorRespondAndFinalize.ahk (variation 20, con margen).
if (!esperarNeedleSinAccion("own_donorfinalize_tradeforcard_title", 30, 15000, "own_donorfinalize_tradeforcard_title_native", 20))
    ExitConError("no_aparecio_tradeforcard_paso2")
AdbScreenshot(adbPath, puerto, StrReplace(g_outputFile, ".txt", "_TradePhoto.png"))
tap(206, 459)

; Chequeo rapido cableado (2026-08-26): needle propia own_donorfinalize_confirm_native, ya
; validada en _DonorRespondAndFinalize.ahk.
if (!esperarNeedleYTap("own_donoroffer_cancel_ok", 30, 199, 365, 15000, "own_donorfinalize_confirm_native", 30))
    ExitConError("no_aparecio_confirmar_finalizar_paso3")

; Swipe rapido para enviar la carta (142,397)->(145,157) en logico, convertido a
; dispositivo -- a pedido explicito del usuario, duracion corta (150ms) para que
; registre como swipe real y no como un tap.
; Chequeo rapido cableado (2026-08-26): needle propia own_donorfinalize_swipe_instruction_native,
; ya validada en _DonorRespondAndFinalize.ahk.
if (!esperarNeedleSinAccion("own_donorfinalize_swipe_instruction", 30, 15000, "own_donorfinalize_swipe_instruction_native", 30))
    ExitConError("no_aparecio_instruccion_swipe_paso4")
; Segunda foto de evidencia (2026-08-18, a pedido explicito del usuario): esta pantalla
; ("Swipe the card to send it to your trade partner") muestra la carta sola, justo antes
; de mandarla de verdad -- se guarda ANTES del swipe, mismo criterio que la foto del
; paso 2 (nombre derivado del outputFile para que bot.js sepa donde buscarla).
AdbScreenshot(adbPath, puerto, StrReplace(g_outputFile, ".txt", "_SwipePhoto.png"))
bajarSpeedModA1xSiEstaActivo()
AdbSwipePropio(adbPath, puerto, 274, 702, 230, 150)
Sleep, 3000

; Tercera foto de evidencia (2026-08-22, a pedido explicito del usuario, mostrando una
; captura real de referencia: la pantalla final "Got it!" que confirma que la carta
; realmente se mando -- las 2 fotos anteriores son ambas de ANTES del swipe, esta es la
; UNICA prueba real de que se registro. Se espera la pantalla SIN tocarla todavia (mismo
; patron que esperarNeedleSinAccion ya usa mas arriba) para sacar la foto limpia antes de
; tocar "Tap to Proceed" y avanzar.
if (!esperarNeedleSinAccion("own_donorfinalize_tap_to_proceed", 30, 15000, "own_donorfinalize_tap_to_proceed_native", 30))
    ExitConError("no_aparecio_tap_to_proceed_paso5")
AdbScreenshot(adbPath, puerto, StrReplace(g_outputFile, ".txt", "_SentPhoto.png"))
tap(152, 486)

WriteResult("OK")
Gdip_Shutdown(pToken)
ExitApp, 0
