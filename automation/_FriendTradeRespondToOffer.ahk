; _FriendTradeRespondToOffer.ahk -- creado 2026-08-23, a pedido explicito del usuario:
; version para Friend Trade (solo la donante, nada de Main -- ese rol no existe aca, el otro
; lado es una persona real) de "responder a una oferta que el amigo ya mando primero".
; Arranca YA parado en la pantalla de Trade con el boton "View" visible (needle
; own_friendtrade_offer_view_badge ya confirmada por _FriendTradeCheckPendingOffer.ahk) --
; toca View, confirma el detalle de la oferta, toca Trade, y de ahi en mas es EXACTAMENTE la
; misma pantalla "Choose a Card to Trade" que ya resuelve _FriendTradeOfferCard.ahk (mismas
; needles de la donante, copiadas tal cual -- confirmado en vivo 2026-08-22 que es la misma
; pantalla sin importar el camino).
; Uso: _FriendTradeRespondToOffer.ahk "<winTitle>" "<folderPath>" "<outputFile>"

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

tapSiApareceNeedle(nombreNeedle, x, y, variation := 30, nombreNeedleNativo := "", variationNativo := 30) {
    global adbPath, puerto
    if (chequeoRapidoNeedle(nombreNeedleNativo, variationNativo)) {
        tap(x, y)
        return true
    }
    Sleep, 1200
    tempFile := A_ScriptDir . "\Logs\_friendrespond_check.png"
    AdbScreenshot(adbPath, puerto, tempFile)
    if (!FileExist(tempFile))
        return
    encontrado := false
    try {
        pBitmap := Gdip_CreateBitmapFromFile(tempFile)
        pNeedle := Gdip_CreateBitmapFromFile(A_ScriptDir . "\Needles\" . nombreNeedle . ".png")
        if (pNeedle) {
            vPos := ""
            encontrado := (buscarNeedleZonal(pBitmap, pNeedle, vPos, variation, nombreNeedle) = 1)
        }
        Gdip_DisposeImage(pBitmap)
    } catch e {
    }
    FileDelete, %tempFile%
    if (encontrado)
        tap(x, y)
    return encontrado
}

tapSiApareceNeedlePolling(nombreNeedle, x, y, timeoutMs := 10000) {
    global adbPath, puerto
    inicio := A_TickCount
    Loop {
        tempFile := A_ScriptDir . "\Logs\_friendrespond_check.png"
        AdbScreenshot(adbPath, puerto, tempFile)
        encontrado := false
        if (FileExist(tempFile)) {
            try {
                pBitmap := Gdip_CreateBitmapFromFile(tempFile)
                pNeedle := Gdip_CreateBitmapFromFile(A_ScriptDir . "\Needles\" . nombreNeedle . ".png")
                if (pNeedle) {
                    vPos := ""
                    encontrado := (buscarNeedleZonal(pBitmap, pNeedle, vPos, 50, nombreNeedle) = 1)
                }
                Gdip_DisposeImage(pBitmap)
            } catch e {
            }
            FileDelete, %tempFile%
        }
        if (encontrado) {
            Sleep, 2000
            tap(x, y)
            return true
        }
        if (A_TickCount - inicio > timeoutMs)
            return false
        Sleep, 500
    }
}

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
        encontrado := (buscarNeedleZonal(pBitmap, pNeedle, vPos, variationNativo, nombreNeedleNativo) = 1)
        Gdip_DisposeImage(pNeedle)
    }
    Gdip_DisposeImage(pBitmap)
    return encontrado
}

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

esperarNeedleSinAccion(nombreNeedle, variation, timeoutMs := 15000, nombreNeedleNativo := "", variationNativo := 30) {
    global adbPath, puerto, g_winTitle
    inicio := A_TickCount
    Loop {
        ; Margen de asentamiento (2026-08-27, bug real reproducido en vivo): el chequeo
        ; rapido puede confirmar la pantalla justo en un frame todavia en transicion/fade-in
        ; (la foto de evidencia que el llamador saca justo despues salia en blanco, y en
        ; algunos casos el propio match parecia fallar por agarrar un frame a medio
        ; renderizar). Un Sleep corto ANTES de devolver true le da tiempo a la pantalla real
        ; a terminar de asentarse -- el camino lento de mas abajo no tenia este problema
        ; porque el AdbScreenshot en si ya tardaba lo suficiente.
        if (chequeoRapidoNeedle(nombreNeedleNativo, variationNativo)) {
            Sleep, 600
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
        if (encontrado)
            return true
        if (A_TickCount - inicio > timeoutMs)
            return false
        Sleep, 500
    }
}

; Paso A: tocar "View" (needle own_friendtrade_offer_view_badge ya confirmada por
; _FriendTradeCheckPendingOffer.ahk antes de correr este script -- se toca directo, sin
; volver a verificar).
tap(142, 416)

; Paso B: confirmar que llegamos al detalle real de la oferta (needle propia, verificada en
; vivo 2026-08-22 -- matchea SOLO esta pantalla, cero falsos positivos contra 5 capturas).
if (!esperarNeedleSinAccion("own_friendtrade_offer_detail_message_icon", 30, 10000))
    ExitConError("no_aparecio_detalle_oferta")

; Paso C: tocar "Trade" para aceptar/responder (boton shimmer, confirmado por la needle de
; arriba -- coordenada real medida contra la captura verificada).
tap(209, 457)

; De aca en mas es EXACTAMENTE la misma pantalla "Choose a Card to Trade" que
; _FriendTradeOfferCard.ahk -- mismas needles de la donante, copiadas tal cual.
esperarElegirCartaOAviso()

; Chequeos rapidos cableados (2026-08-26): needles nativas ya validadas en vivo en
; _DonorOfferCard.ahk / _FriendTradeOfferCard.ahk -- misma pantalla real, mismo needle.
if (!esperarNeedleYTap("own_donoroffer_choosecard_title", 30, 48, 357, 15000, "own_donoroffer_choosecard_title_native", 30)) {
    tapSiApareceNeedlePolling("own_donoroffer_willsend_popup", 141, 436, 3000)
    if (!esperarNeedleYTap("own_donoroffer_choosecard_title", 30, 48, 357, 15000, "own_donoroffer_choosecard_title_native", 30))
        ExitConError("no_aparecio_choosecard_paso9")
}
if (!esperarNeedleYTap("own_donoroffer_choosecard_title", 30, 145, 458, 15000, "own_donoroffer_choosecard_title_native", 30))
    ExitConError("no_aparecio_ok_habilitado_paso10")
if (!esperarNeedleYTap("own_donoroffer_tradepartner_header", 20, 197, 461, 15000, "own_donoroffer_tradepartner_header_native", 30))
    ExitConError("no_aparecio_preview_envio_paso11")
if (!esperarNeedleYTap("own_donoroffer_cancel_ok", 30, 200, 365, 15000, "own_donoroffer_setcard_confirm_native", 20))
    ExitConError("no_aparecio_confirmar_set_card_paso12")

tapSiApareceNeedle("own_donoroffer_remainingcopy_popup", 204, 383, 30, "own_donoroffer_remainingcopy_popup_native", 30)

; Chequeo rapido DESACTIVADO a proposito (2026-09-25, auditoria de texto en needles con Ale):
; own_donoroffer_offered_text_native era literalmente la frase en ingles "You have offered the
; card to your trade partner.", asi que nunca podia matchear con el juego en otro idioma.
; Se buscó un reemplazo sin texto en la captura nativa real de esa pantalla y NO hay ninguno
; bueno: la carta cambia en cada trade, el boton tiene degradado (mismo problema que el
; corazon que se descarto el 17/09), el recuadro de la nota lleva texto y las flechas de
; fondo no tienen contraste. En vez de poner un needle malo, se deja vacio el parametro
; nativo: el chequeo cae siempre a la via lenta por ADB, cuyo needle (own_donoroffer_offered_text)
; ya es un recorte sin texto y funciona. Cuesta unos cientos de ms mas por vuelta, nada al lado
; de un falso negativo permanente.
if (!esperarNeedleSinAccion("own_donoroffer_offered_text", 30, 15000))
    ExitConError("no_aparecio_confirmacion_final_paso14")
AdbScreenshot(adbPath, puerto, StrReplace(g_outputFile, ".txt", "_MainOfferPhoto.png"))
; Sleep antes del toque ciego (2026-08-27, bug real reproducido en vivo en
; _MainAcceptTradeOffer.ahk, mismo patron aca por prevencion): ver comentario completo ahi.
Sleep, 1200
tap(136, 438)

WriteResult("OK")
Gdip_Shutdown(pToken)
ExitApp, 0

; Estilo Kevin (2026-09-27, pedido de Ale): antes se ESPERABA hasta 10 s a ver si salia el aviso
; "elige una carta" (flecha verde) y se perdian esos segundos cuando no salia. Ahora, en cada
; vuelta: si ya se ve la pantalla de elegir carta (la lupa) se sigue al instante; si esta el
; aviso, se toca OK. Tope 15 s; despues el chequeo de abajo decide igual que antes.
esperarElegirCartaOAviso() {
    ; Corregido 2026-09-28 (bug real en vivo con Ale): se salia apenas se veia la lupa, pero la
    ; pantalla de elegir carta aparece PRIMERO y el aviso sale un instante DESPUES, encima; la
    ; donante seguia de largo con el aviso abierto y fallaba todo lo de despues. Ahora solo se sale
    ; cuando la lupa se ve estable 2,5 s sin que haya salido el aviso.
    inicio := A_TickCount
    lupaDesde := 0
    Loop {
        if (chequeoRapidoNeedle("own_donoroffer_choosecard_title_native", 30)) {
            if (!lupaDesde)
                lupaDesde := A_TickCount
            else if (A_TickCount - lupaDesde >= 2500)
                return
        } else {
            lupaDesde := 0
        }
        if (esperarNeedleSinAccion("own_donoroffer_willsend_popup", 50, 1)) {
            lupaDesde := 0
            Sleep, 2000   ; el aviso entra deslizandose; se deja asentar antes de tocar
            tap(141, 436)
            Sleep, 1000
            continue
        }
        if (A_TickCount - inicio > 15000)
            return
        Sleep, 250
    }
}
