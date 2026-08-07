; _DonorOfferCard.ahk -- reemplaza _SendTradeCard.ahk. Mapeado en vivo 2026-08-03/04.
; Corre en la donante despues de send_friend_request (Kevin). Limpia la UI que deja
; ese script (Search Results / Friend ID Search), navega a Trade, ofrece la carta del
; wishlist de Main (posicion fija, NO needle -- la carta varia por cuenta) y confirma.
; Uso: _DonorOfferCard.ahk "<winTitle>" "<folderPath>" "<outputFile>"

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
#Include %A_ScriptDir%\_OcrUtils.ahk
#Include %A_ScriptDir%\lib\Gdip_All.ahk
#Include %A_ScriptDir%\lib\Gdip_Extra.ahk
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

tap(x, y, esperaMs := 4000) {
    static convX := 540/283, convY := 960/488, offset := 40
    global adbPath, puerto
    AdbTap(adbPath, puerto, Round(x * convX), Round((y - offset) * convY))
    Sleep, %esperaMs%
}

; Chequeo condicional por OCR (no needle -- este popup restante no varia de texto entre
; cuentas, a diferencia de la carta). Si el texto clave no aparece, no tapea nada.
tapSiApareceTexto(textoClave, x, y) {
    global adbPath, puerto
    Sleep, 1200  ; margen para que el popup termine de renderizar antes de la captura
    tempFile := A_ScriptDir . "\Logs\_donoroffer_check.png"
    AdbScreenshot(adbPath, puerto, tempFile)
    if (!FileExist(tempFile))
        return
    encontrado := false
    try {
        pBitmap := Gdip_CreateBitmapFromFile(tempFile)
        pFormatted := Gdip_CropResizeGreyscaleContrast(pBitmap, 0, 200, 540, 400, 100, 0)
        texto := GetTextFromBitmap(pFormatted)
        Gdip_DisposeImage(pBitmap)
        Gdip_DisposeImage(pFormatted)
        encontrado := InStr(texto, textoClave) ? true : false
    } catch e {
        encontrado := false
    }
    FileDelete, %tempFile%
    if (encontrado)
        tap(x, y)
}

; Chequeo condicional por NEEDLE (2026-08-05, a pedido explicito del usuario -- mas solido
; que el OCR para este popup en particular, el texto no varia). Igual que
; tapSiApareceTexto: si la needle no matchea, no tapea nada y sigue derecho.
tapSiApareceNeedle(nombreNeedle, x, y, variation := 30) {
    global adbPath, puerto
    Sleep, 1200
    tempFile := A_ScriptDir . "\Logs\_donoroffer_check.png"
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

; Chequeo de cordura (2026-08-04): si el juego crasheo y volvio al titulo, cortar con
; error claro en vez de seguir tocando a ciegas (ver mismo chequeo en las otras 3 piezas
; nuevas del pipeline de Main Trade).
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

; Reconocimiento real antes de tocar (2026-08-05, a pedido explicito del usuario): espera
; (poll cada 500ms, hasta timeoutMs) a que la needle de la pantalla ESPERADA aparezca antes
; de tocar -- asi un PC lento no rompe el timing.
esperarNeedleYTap(nombreNeedle, variation, x, y, timeoutMs := 15000) {
    global adbPath, puerto, g_winTitle
    inicio := A_TickCount
    Loop {
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

if (!esperarNeedleYTap("own_donoroffer_x_searchresults", 30, 141, 499))
    ExitConError("no_aparecio_search_results_paso1")
if (!esperarNeedleYTap("own_donoroffer_cancel_ok", 30, 81, 367))
    ExitConError("no_aparecio_friendid_search_paso2")
; 1 "X" mas (misma coordenada, 146,504) antes de que el tap de Comunidad funcione de
; verdad -- mapeado en vivo 2026-08-04, quedaba un overlay de por medio. Misma needle de
; X reutilizada (confirmado en vivo 2026-08-05, matchea en ambas pantallas).
if (!esperarNeedleYTap("own_donoroffer_x_searchresults", 30, 146, 504))
    ExitConError("no_aparecio_x_extra_paso3")
if (!esperarNeedleYTap("own_donoroffer_x_searchresults", 30, 146, 504))
    ExitConError("no_aparecio_comunidad_paso4")
if (!esperarNeedleYTap("own_donoroffer_trade_icon", 30, 207, 402))
    ExitConError("no_aparecio_socialhub_paso5")

; Chequeo condicional (2026-08-05, a pedido explicito del usuario): si Main YA ofrecio
; algo antes (de un Retry anterior), esta pantalla no muestra el boton azul normal de
; "Trade" -- en cambio muestra "Waiting for a response" con un boton "View". Needle del
; texto (no del boton, que cambia de color igual que otros ya vistos hoy). Si aparece, la
; donante ya tiene la oferta de Main esperando -- se toca View y se corta el script aca
; mismo (los pasos 6-14 de ofrecer carta ya no aplican, la pantalla resultante es otra).
; Si NO aparece, sigue derecho con el paso 6 de siempre.
if (tapSiApareceNeedle("own_donoroffer_waitingresponse_pill", 147, 423)) {
    WriteResult("OK")
    Gdip_Shutdown(pToken)
    ExitApp, 0
}

if (!esperarNeedleYTap("own_donoroffer_trade_button", 30, 139, 427))
    ExitConError("no_aparecio_trade_landing_paso6")
if (!esperarNeedleYTap("own_donoroffer_selectfriend_trade", 30, 213, 179))
    ExitConError("no_aparecio_selectfriend_paso7")

; Popup explicativo "Choose a Card to Trade" -- puede no aparecer siempre.
tapSiApareceNeedle("own_donoroffer_willsend_popup", 141, 436)

if (!esperarNeedleYTap("own_donoroffer_choosecard_title", 30, 48, 357))
    ExitConError("no_aparecio_choosecard_paso9")
; Paso 10 (2026-08-05, a pedido explicito del usuario): NO se puede needlear "OK ya
; habilitado" -- el boton tiene un shimmer de color que cambia de tono en cada captura
; (confirmado en vivo, ni variation 70 lo agarra), y el checkmark de la carta seleccionada
; tiene detras el arte de la carta, que varia constantemente (se comercia una carta
; distinta cada vez). Se reutiliza la misma needle del titulo (estable, no depende de la
; carta) solo para confirmar que seguimos en esta pantalla, y se toca OK a ciegas -- mismo
; criterio que la seleccion de la carta en el paso 9.
if (!esperarNeedleYTap("own_donoroffer_choosecard_title", 30, 145, 458))
    ExitConError("no_aparecio_ok_habilitado_paso10")
if (!esperarNeedleYTap("own_donoroffer_tradepartner_header", 30, 197, 461))
    ExitConError("no_aparecio_preview_envio_paso11")
if (!esperarNeedleYTap("own_donoroffer_cancel_ok", 30, 200, 365))
    ExitConError("no_aparecio_confirmar_set_card_paso12")

; Aviso "solo te queda 1 copia" -- puede no aparecer siempre. Pasado a needle real
; (2026-08-05, a pedido del usuario) -- ya no queda ningun chequeo por OCR en este script.
tapSiApareceNeedle("own_donoroffer_remainingcopy_popup", 204, 383)

if (!esperarNeedleYTap("own_donoroffer_offered_text", 30, 136, 438))
    ExitConError("no_aparecio_confirmacion_final_paso14")

WriteResult("OK")
Gdip_Shutdown(pToken)
ExitApp, 0
