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
            encontrado := (Gdip_ImageSearch(pBitmap, pNeedle, vPos, 0, 0, 0, 0, variation) = 1)
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
                    encontrado := (Gdip_ImageSearch(pBitmap, pNeedle, vPos, 0, 0, 0, 0, 50) = 1)
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
        encontrado := (Gdip_ImageSearch(pBitmap, pNeedle, vPos, 0, 0, 0, 0, variationNativo) = 1)
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
                    encontrado := (Gdip_ImageSearch(pBitmap, pNeedle, vPos, 0, 0, 0, 0, variation) = 1)
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
tapSiApareceNeedlePolling("own_donoroffer_willsend_popup", 141, 436)

; Chequeos rapidos cableados (2026-08-26): needles nativas ya validadas en vivo en
; _DonorOfferCard.ahk / _FriendTradeOfferCard.ahk -- misma pantalla real, mismo needle.
if (!esperarNeedleYTap("own_donoroffer_choosecard_title", 30, 48, 357, 15000, "own_donoroffer_choosecard_title_native", 30)) {
    tapSiApareceNeedlePolling("own_donoroffer_willsend_popup", 141, 436, 3000)
    if (!esperarNeedleYTap("own_donoroffer_choosecard_title", 30, 48, 357, 15000, "own_donoroffer_choosecard_title_native", 30))
        ExitConError("no_aparecio_choosecard_paso9")
}
if (!esperarNeedleYTap("own_donoroffer_choosecard_title", 30, 145, 458, 15000, "own_donoroffer_choosecard_title_native", 30))
    ExitConError("no_aparecio_ok_habilitado_paso10")
if (!esperarNeedleYTap("own_donoroffer_tradepartner_header", 30, 197, 461, 15000, "own_donoroffer_tradepartner_header_native", 30))
    ExitConError("no_aparecio_preview_envio_paso11")
if (!esperarNeedleYTap("own_donoroffer_cancel_ok", 30, 200, 365, 15000, "own_donoroffer_setcard_confirm_native", 30))
    ExitConError("no_aparecio_confirmar_set_card_paso12")

tapSiApareceNeedle("own_donoroffer_remainingcopy_popup", 204, 383, 30, "own_donoroffer_remainingcopy_popup_native", 30)

if (!esperarNeedleSinAccion("own_donoroffer_offered_text", 30, 15000, "own_donoroffer_offered_text_native", 30))
    ExitConError("no_aparecio_confirmacion_final_paso14")
AdbScreenshot(adbPath, puerto, StrReplace(g_outputFile, ".txt", "_MainOfferPhoto.png"))
tap(136, 438)

WriteResult("OK")
Gdip_Shutdown(pToken)
ExitApp, 0
