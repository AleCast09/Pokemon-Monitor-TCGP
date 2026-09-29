; _FriendTradeOfferCard.ahk -- creado 2026-08-23, a pedido explicito del usuario: version
; para Friend Trade (solo la donante, nada de Main) de la parte final de _DonorOfferCard.ahk
; -- ofrece la carta del wishlist del amigo (posicion fija, NO needle -- la carta varia por
; cuenta) y confirma. Reemplaza al viejo _SendTradeCard.ahk (a ciegas, sin needles).
; Arranca YA parado en "Select a Friend" -- _FriendTradeGoToSocialHub.ahk +
; _FriendTradeCheckPendingOffer.ahk hacen la navegacion previa (con needles propias).
; Uso: _FriendTradeOfferCard.ahk "<winTitle>" "<folderPath>" "<outputFile>"

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

; Handle de la ventana real, para el chequeo rapido por captura directa (2026-08-26, mismo
; mecanismo que _DonorOfferCard.ahk / _SpeedMod.ahk / _WaitWelcomeScreens*.ahk -- ver
; comentario completo en esperarNeedleYTap mas abajo). No fatal si no se encuentra -- este
; script sigue funcionando 100% por ADB como siempre, el chequeo rapido simplemente no se usa.
global g_hwndFast := WinExist(g_winTitle . " ahk_class Qt5156QWindowIcon")

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
            encontrado := (buscarNeedleZonal(pBitmap, pNeedle, vPos, 15, nombreNeedle) = 1)
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
; Parametros nombreNeedleNativo/variationNativo (2026-08-26): si matchea el chequeo rapido
; (ver chequeoRapidoNeedle, definida mas abajo -- AHK resuelve funciones globales sin
; importar el orden), toca altiro sin esperar el Sleep+screenshot ADB de siempre.
tapSiApareceNeedle(nombreNeedle, x, y, variation := 30, nombreNeedleNativo := "", variationNativo := 30) {
    global adbPath, puerto
    if (chequeoRapidoNeedle(nombreNeedleNativo, variationNativo)) {
        tap(x, y)
        return true
    }
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
                    encontrado := (buscarNeedleZonal(pBitmap, pNeedle, vPos, 50, nombreNeedle) = 1)
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
            if (buscarNeedleZonal(pBitmap, pNeedle, vPos, 75, "own_tapstart_logo") = 1)
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

; Chequeo rapido por captura directa de ventana (2026-08-26, a pedido explicito del usuario
; -- "ahora necesito que esto lo implementes para friend trade", mismo mecanismo ya probado
; en vivo en _DonorOfferCard.ahk / _SpeedMod.ahk / _WaitWelcomeScreens*.ahk: PrintWindow
; contra la ventana real, ~0ms, contra ~150-400ms de pedirle un screenshot al emulador por
; ADB). Usa needles PROPIOS a la resolucion NATIVA de la ventana (sufijo _native, NO son
; intercambiables con las needles ADB de 540x960 que usa el resto de este script). Sin
; riesgo de regresion: si no hay needle nativa para este paso, o la ventana no se pudo
; resolver, o el chequeo rapido no matchea, cae sin ningun cambio al chequeo lento de siempre.
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

; Reconocimiento real antes de tocar (2026-08-05, a pedido explicito del usuario): espera
; (poll cada 500ms, hasta timeoutMs) a que la needle de la pantalla ESPERADA aparezca antes
; de tocar -- asi un PC lento no rompe el timing.
; Parametros nombreNeedleNativo/variationNativo (2026-08-26, opcionales): si se pasan, cada
; iteracion prueba PRIMERO el chequeo rapido (ver chequeoRapidoNeedle) antes del chequeo
; lento de siempre -- si matchea, toca y devuelve altiro, sin esperar el screenshot ADB de
; esa vuelta. Si no se pasan (default ""), el comportamiento es IDENTICO al de siempre.
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
                ; Chequeo de crash EN CADA poll (2026-08-19, bug real reproducido en vivo --
                ; ver comentario completo en _MainAcceptTradeOffer.ahk, mismo fix aplicado a
                ; los 4 scripts del pipeline): reusa la captura ya sacada, solo DETECTA y
                ; corta con error claro -- no reintenta reabrir el juego aca a proposito.
                if (!encontrado) {
                    pCrash := Gdip_CreateBitmapFromFile(A_ScriptDir . "\Needles\own_tapstart_logo.png")
                    if (pCrash) {
                        vPosCrash := ""
                        if (buscarNeedleZonal(pBitmap, pCrash, vPosCrash, 75, "own_tapstart_logo") = 1) {
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
; Parametros nombreNeedleNativo/variationNativo (2026-08-26): mismo chequeo rapido opcional
; que esperarNeedleYTap (ver comentario completo ahi) -- sin accion, solo devuelve true/false.
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

; _FriendTradeOfferCard.ahk (2026-08-23, a pedido explicito del usuario): recorte de
; _DonorOfferCard.ahk -- SOLO se usa la parte de la donante (nada de Main, ese rol no existe
; en Friend Trade, el otro lado es una persona real). Los pasos 1-6 de arriba (navegar desde
; "Search Results" hasta entrar al tile de Trade + chequeo de oferta pendiente) NO se repiten
; aca -- ya los hacen _FriendTradeGoToSocialHub.ahk + _FriendTradeCheckPendingOffer.ahk (con
; needles propias, ya verificadas en vivo -- su ultimo tap YA entra al tile de Trade). Este
; script arranca asumiendo que la needle de "sin oferta pendiente" ya se confirmo y la
; pantalla real es "Select a Friend" -- empieza directo en el paso 7.
; Causa real encontrada (2026-08-19, bug reproducido en vivo varias veces): el recorte
; original tenia contaminacion en la esquina superior-izquierda (unos 8x6 pixeles de otro
; elemento de fondo que varia), con diferencia de hasta 153/255 ahi -- por eso subir la
; tolerancia a 50 tampoco alcanzaba. Recorte reemplazado por uno mas ajustado que deja solo
; el icono de la lupa, sin esa esquina -- verificado con diferencia 0.00 (pixel por pixel)
; contra 2 capturas reales tomadas en momentos distintos. Tolerancia devuelta a 30.
; Chequeo rapido cableado (2026-08-26): needle propia own_donoroffer_selectfriend_trade_native,
; ya validada en vivo en _DonorOfferCard.ahk (mismo needle, misma pantalla real -- ver ese
; archivo para el detalle de la validacion cruzada).
if (!esperarNeedleYTap("own_donoroffer_selectfriend_trade", 30, 213, 179, 15000, "own_donoroffer_selectfriend_trade_native", 30))
    ExitConError("no_aparecio_selectfriend_paso7")

; Popup explicativo "Choose a Card to Trade" -- puede no aparecer siempre. Reintenta unos
; segundos (ver tapSiApareceNeedlePolling) en vez de un chequeo unico -- confirmado en vivo
; que a veces tarda en renderizar y un chequeo de una sola vez se lo perdia.
esperarElegirCartaOAviso()

; Chequeo rapido cableado (2026-08-26): needle propia own_donoroffer_choosecard_title_native,
; ya validada en vivo en _DonorOfferCard.ahk.
if (!esperarNeedleYTap("own_donoroffer_choosecard_title", 30, 48, 357, 15000, "own_donoroffer_choosecard_title_native", 30)) {
    ; Red de seguridad (2026-08-19, bug real reproducido en vivo): si el popup "Choose a
    ; Card to Trade" seguia tapando la pantalla (mas lento en renderizar de lo esperado),
    ; este paso nunca iba a encontrar el titulo por mas que espere, sin importar el
    ; timeout. En vez de solo agrandar el numero a ciegas, antes de rendirse de verdad
    ; intenta cerrar el popup una vez mas (por si seguia ahi) y reintenta el chequeo.
    tapSiApareceNeedlePolling("own_donoroffer_willsend_popup", 141, 436, 3000)
    if (!esperarNeedleYTap("own_donoroffer_choosecard_title", 30, 48, 357, 15000, "own_donoroffer_choosecard_title_native", 30))
        ExitConError("no_aparecio_choosecard_paso9")
}
; Paso 10 (2026-08-05, a pedido explicito del usuario): NO se puede needlear "OK ya
; habilitado" -- el boton tiene un shimmer de color que cambia de tono en cada captura
; (confirmado en vivo, ni variation 70 lo agarra), y el checkmark de la carta seleccionada
; tiene detras el arte de la carta, que varia constantemente (se comercia una carta
; distinta cada vez). Se reutiliza la misma needle del titulo (estable, no depende de la
; carta) solo para confirmar que seguimos en esta pantalla, y se toca OK a ciegas -- mismo
; criterio que la seleccion de la carta en el paso 9.
; Chequeo rapido cableado (2026-08-26): misma needle nativa que el paso 9 (own_donoroffer_
; choosecard_title_native), ya validada.
if (!esperarNeedleYTap("own_donoroffer_choosecard_title", 30, 145, 458, 15000, "own_donoroffer_choosecard_title_native", 30))
    ExitConError("no_aparecio_ok_habilitado_paso10")
; Chequeo rapido cableado (2026-08-26): needle propia own_donoroffer_tradepartner_header_native,
; ya validada en vivo en _DonorOfferCard.ahk.
if (!esperarNeedleYTap("own_donoroffer_tradepartner_header", 20, 197, 461, 15000, "own_donoroffer_tradepartner_header_native", 30))
    ExitConError("no_aparecio_preview_envio_paso11")
; Chequeo rapido cableado (2026-08-26): needle propia own_donoroffer_setcard_confirm_native
; (el texto especifico de este popup -- NO el boton OK generico, que dio falsos positivos
; en vivo contra otras pantallas con botones celestes, ver _DonorOfferCard.ahk).
if (!esperarNeedleYTap("own_donoroffer_cancel_ok", 30, 200, 365, 15000, "own_donoroffer_setcard_confirm_native", 20))
    ExitConError("no_aparecio_confirmar_set_card_paso12")

; Aviso "solo te queda 1 copia" -- puede no aparecer siempre. Pasado a needle real
; (2026-08-05, a pedido del usuario) -- ya no queda ningun chequeo por OCR en este script.
; Chequeo rapido cableado (2026-08-26): needle propia own_donoroffer_remainingcopy_popup_native,
; ya validada en vivo en _DonorOfferCard.ahk.
tapSiApareceNeedle("own_donoroffer_remainingcopy_popup", 204, 383, 30, "own_donoroffer_remainingcopy_popup_native", 30)

; Foto real de cuando la donante ofrece la carta (2026-08-18, a pedido explicito del
; usuario -- mismo criterio que la foto que ya saca _DonorRespondAndFinalize.ahk): se saca
; ANTES de tocar, mientras la pantalla de confirmacion todavia esta completa. Nombre
; derivado del outputFile para que bot.js sepa donde buscarla.
; Chequeo rapido cableado (2026-08-26): needle propia own_donoroffer_offered_text_native,
; ya validada en vivo en _DonorOfferCard.ahk.
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
AdbScreenshot(adbPath, puerto, StrReplace(g_outputFile, ".txt", "_OfferPhoto.png"))
; Sleep extra antes del tap final (2026-08-23, bug real reproducido en vivo: el tap
; inmediatamente despues del primer match no registraba -- la pantalla probablemente seguia
; asentandose/animando justo al detectarse, mismo criterio ya usado en
; tapSiApareceNeedlePolling de este mismo archivo).
Sleep, 1500
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
