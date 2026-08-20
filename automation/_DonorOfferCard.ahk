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

; Chequeo reforzado con doble confirmacion (2026-08-19, bug real en vivo -- ver comentario
; en el call site). Solo para el chequeo de "ya hay oferta esperando", que es un salto
; binario que se salta TODO el flujo de ofrecer la carta si da un falso positivo. Exige que
; la needle matchee en 2 capturas separadas por 800ms, con tolerancia estricta (15), antes
; de tocar y devolver true.
verificarEsperandoRespuesta(nombreNeedle, x, y) {
    if (!verificarEsperandoRespuestaUnaVez(nombreNeedle))
        return false
    Sleep, 800
    if (!verificarEsperandoRespuestaUnaVez(nombreNeedle))
        return false
    tap(x, y)
    return true
}
verificarEsperandoRespuestaUnaVez(nombreNeedle) {
    global adbPath, puerto
    Sleep, 1200
    tempFile := A_ScriptDir . "\Logs\_donoroffer_check.png"
    AdbScreenshot(adbPath, puerto, tempFile)
    if (!FileExist(tempFile))
        return false
    encontrado := false
    try {
        pBitmap := Gdip_CreateBitmapFromFile(tempFile)
        pNeedle := Gdip_CreateBitmapFromFile(A_ScriptDir . "\Needles\" . nombreNeedle . ".png")
        if (pNeedle) {
            vPos := ""
            encontrado := (Gdip_ImageSearch(pBitmap, pNeedle, vPos, 0, 0, 0, 0, 15) = 1)
        }
        Gdip_DisposeImage(pBitmap)
    } catch e {
    }
    FileDelete, %tempFile%
    return encontrado
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

; Igual que tapSiApareceNeedle pero reintentando por unos segundos en vez de un chequeo
; unico (2026-08-19, bug real reproducido en vivo): el popup explicativo "Choose a Card to
; Trade" a veces tarda un poco en renderizar -- un chequeo de una sola vez podia perderselo
; (justo no estaba todavia en pantalla) y seguir de largo sin tocar OK, dejando el popup
; tapando la pantalla siguiente y rompiendo el proximo chequeo. Si nunca aparece dentro del
; timeout, sigue de largo igual que la version original (no es un error real, el popup
; genuinamente puede no aparecer).
tapSiApareceNeedlePolling(nombreNeedle, x, y, timeoutMs := 10000) {
    global adbPath, puerto
    inicio := A_TickCount
    Loop {
        tempFile := A_ScriptDir . "\Logs\_donoroffer_check.png"
        AdbScreenshot(adbPath, puerto, tempFile)
        encontrado := false
        if (FileExist(tempFile)) {
            try {
                pBitmap := Gdip_CreateBitmapFromFile(tempFile)
                pNeedle := Gdip_CreateBitmapFromFile(A_ScriptDir . "\Needles\" . nombreNeedle . ".png")
                if (pNeedle) {
                    vPos := ""
                    ; Tolerancia subida de 30 a 50 (2026-08-19, bug real en vivo): Gdip_ImageSearch
                    ; compara cada canal R/G/B por separado contra la tolerancia (no el promedio de
                    ; los 3) -- verificado con un diff pixel a pixel real: el borde de la flecha
                    ; tenia un pixel con diferencia de canal individual de 41/255, por eso nunca
                    ; pasaba con 30 pese a que el needle en si es correcto (avg de solo 0.86/255).
                    encontrado := (Gdip_ImageSearch(pBitmap, pNeedle, vPos, 0, 0, 0, 0, 50) = 1)
                }
                Gdip_DisposeImage(pBitmap)
            } catch e {
            }
            FileDelete, %tempFile%
        }
        if (encontrado) {
            ; Espera extra despues del primer match (2026-08-19, a pedido explicito del
            ; usuario): el popup puede seguir animando/deslizandose al entrar justo cuando
            ; recien se detecta -- da tiempo a que termine de asentarse antes de tocar.
            Sleep, 2000
            tap(x, y)
            return true
        }
        if (A_TickCount - inicio > timeoutMs)
            return false
        Sleep, 500
    }
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

; Igual que esperarNeedleYTap pero sin ninguna accion al encontrarla (2026-08-18, a pedido
; explicito del usuario -- mismo patron ya usado en _DonorRespondAndFinalize.ahk): deja la
; pantalla intacta para poder sacar una foto real ANTES de tocar.
esperarNeedleSinAccion(nombreNeedle, variation, timeoutMs := 15000) {
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
        if (encontrado)
            return true
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
;
; REFORZADO (2026-08-19, bug real reproducido en vivo): esta pill needle (una forma chica
; y generica, un pico de burbuja) hizo match FALSO en la pantalla NORMAL de Trade -- el
; script escribia "OK" y cortaba aca mismo sin ofrecer la carta nunca, saltando derecho a
; main_accept_trade_offer. La doble confirmacion (2 capturas, tolerancia 15) NO alcanzo
; -- verificado en vivo con diff pixel a pixel: esta needle es un fondo casi liso, sin
; forma reconocible, y da una diferencia promedio de apenas 3.6/255 contra la pantalla de
; Trade VACIA (sin ninguna oferta real), muy por debajo de cualquier tolerancia razonable.
; No es ruido -- es un match falso CONSTANTE, por eso ninguna cantidad de repeticiones lo
; iba a filtrar. REACTIVADO (2026-08-19, a pedido explicito del usuario): needle vuelta al
; texto real "Waiting for a response" (en ingles, recuperado de HEAD) en vez del recorte de
; fondo liso -- mucho mas distintivo, solo para confirmar rapido que el flujo funciona.
; OJO: esto vuelve a depender de texto en ingles -- si la cuenta esta en otro idioma no va
; a matchear. Pendiente: una vez confirmado que el flujo entero anda, volver a un icono
; real (no un recorte de fondo) para que funcione en cualquier idioma de nuevo.
if (verificarEsperandoRespuesta("own_donoroffer_waitingresponse_pill", 147, 423)) {
    WriteResult("OK")
    Gdip_Shutdown(pToken)
    ExitApp, 0
}

if (!esperarNeedleYTap("own_donoroffer_trade_button", 30, 139, 427))
    ExitConError("no_aparecio_trade_landing_paso6")
; Causa real encontrada (2026-08-19, bug reproducido en vivo varias veces): el recorte
; original tenia contaminacion en la esquina superior-izquierda (unos 8x6 pixeles de otro
; elemento de fondo que varia), con diferencia de hasta 153/255 ahi -- por eso subir la
; tolerancia a 50 tampoco alcanzaba. Recorte reemplazado por uno mas ajustado que deja solo
; el icono de la lupa, sin esa esquina -- verificado con diferencia 0.00 (pixel por pixel)
; contra 2 capturas reales tomadas en momentos distintos. Tolerancia devuelta a 30.
if (!esperarNeedleYTap("own_donoroffer_selectfriend_trade", 30, 213, 179))
    ExitConError("no_aparecio_selectfriend_paso7")

; Popup explicativo "Choose a Card to Trade" -- puede no aparecer siempre. Reintenta unos
; segundos (ver tapSiApareceNeedlePolling) en vez de un chequeo unico -- confirmado en vivo
; que a veces tarda en renderizar y un chequeo de una sola vez se lo perdia.
tapSiApareceNeedlePolling("own_donoroffer_willsend_popup", 141, 436)

if (!esperarNeedleYTap("own_donoroffer_choosecard_title", 30, 48, 357)) {
    ; Red de seguridad (2026-08-19, bug real reproducido en vivo): si el popup "Choose a
    ; Card to Trade" seguia tapando la pantalla (mas lento en renderizar de lo esperado),
    ; este paso nunca iba a encontrar el titulo por mas que espere, sin importar el
    ; timeout. En vez de solo agrandar el numero a ciegas, antes de rendirse de verdad
    ; intenta cerrar el popup una vez mas (por si seguia ahi) y reintenta el chequeo.
    tapSiApareceNeedlePolling("own_donoroffer_willsend_popup", 141, 436, 3000)
    if (!esperarNeedleYTap("own_donoroffer_choosecard_title", 30, 48, 357))
        ExitConError("no_aparecio_choosecard_paso9")
}
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

; Foto real de cuando la donante ofrece la carta (2026-08-18, a pedido explicito del
; usuario -- mismo criterio que la foto que ya saca _DonorRespondAndFinalize.ahk): se saca
; ANTES de tocar, mientras la pantalla de confirmacion todavia esta completa. Nombre
; derivado del outputFile para que bot.js sepa donde buscarla.
if (!esperarNeedleSinAccion("own_donoroffer_offered_text", 30, 15000))
    ExitConError("no_aparecio_confirmacion_final_paso14")
AdbScreenshot(adbPath, puerto, StrReplace(g_outputFile, ".txt", "_OfferPhoto.png"))
tap(136, 438)

WriteResult("OK")
Gdip_Shutdown(pToken)
ExitApp, 0
