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

; Handle de la ventana real, para el chequeo rapido por captura directa (2026-08-26, mismo
; mecanismo que _SpeedMod.ahk / _WaitWelcomeScreens*.ahk -- ver comentario completo en
; esperarNeedleYTap mas abajo). No fatal si no se encuentra -- este script sigue funcionando
; 100% por ADB como siempre, el chequeo rapido simplemente no se usa en ese caso.
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

; Chequeo rapido por captura directa de ventana (2026-08-26, a pedido explicito del usuario
; -- "hagamoslo ahora como matar el tiempo mejor", mismo mecanismo ya probado en vivo en
; _SpeedMod.ahk y _WaitWelcomeScreens*.ahk: PrintWindow contra la ventana real, ~0ms, contra
; ~150-400ms de pedirle un screenshot al emulador por ADB). Usa needles PROPIOS a la
; resolucion NATIVA de la ventana (sufijo _native, NO son intercambiables con las needles
; ADB de 540x960 que usa el resto de este script). Sin riesgo de regresion: si no hay needle
; nativa para este paso (nombreNeedleNativo = ""), o la ventana no se pudo resolver, o el
; chequeo rapido no matchea, cae sin ningun cambio al chequeo lento de siempre.
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
; Parametros nombreNeedleNativo/variationNativo (2026-08-26): mismo chequeo rapido opcional
; que esperarNeedleYTap (ver comentario completo ahi) -- sin accion, solo devuelve true/false.
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
; Chequeo rapido cableado (2026-08-26): needle propia own_donoroffer_trade_icon_native (el
; tile "Trade" de Social Hub), validada en vivo en _FriendTradeCheckPendingOffer.ahk (misma
; pantalla real, sin falsos positivos cruzados).
if (!esperarNeedleYTap("own_donoroffer_trade_icon", 30, 207, 402, 15000, "own_donoroffer_trade_icon_native", 30))
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

; Chequeo rapido cableado (2026-08-26): needle propia own_maintrade_trade_button_native ya
; validada en vivo hoy mismo contra una captura real de esta pantalla (match perfecto, avg
; 0.00/255, variation 0 alcanza) y cruzada contra 7 capturas de otras pantallas (titulo x2,
; social hub x2, friends x2, menu principal) sin ningun falso positivo -- variation 30 usado
; igual, con margen.
if (!esperarNeedleYTap("own_donoroffer_trade_button", 30, 139, 427, 15000, "own_maintrade_trade_button_native", 30))
    ExitConError("no_aparecio_trade_landing_paso6")
; Causa real encontrada (2026-08-19, bug reproducido en vivo varias veces): el recorte
; original tenia contaminacion en la esquina superior-izquierda (unos 8x6 pixeles de otro
; elemento de fondo que varia), con diferencia de hasta 153/255 ahi -- por eso subir la
; tolerancia a 50 tampoco alcanzaba. Recorte reemplazado por uno mas ajustado que deja solo
; el icono de la lupa, sin esa esquina -- verificado con diferencia 0.00 (pixel por pixel)
; contra 2 capturas reales tomadas en momentos distintos. Tolerancia devuelta a 30.
; Chequeo rapido cableado (2026-08-26): needle propia own_donoroffer_selectfriend_trade_native
; (el pill "Trade" al lado del amigo en "Select a Friend"), validada en vivo -- match exacto
; (variation 0) contra una captura real de esta pantalla, sin ningun falso positivo hasta
; variation 60 contra 10 capturas de otras pantallas (titulo, social hub, friends, home, trade
; landing). Se usa 30 con margen, igual que el resto de needles de este script.
if (!esperarNeedleYTap("own_donoroffer_selectfriend_trade", 30, 213, 179, 15000, "own_donoroffer_selectfriend_trade_native", 30))
    ExitConError("no_aparecio_selectfriend_paso7")

; Popup explicativo "Choose a Card to Trade" -- puede no aparecer siempre. Reintenta unos
; segundos (ver tapSiApareceNeedlePolling) en vez de un chequeo unico -- confirmado en vivo
; que a veces tarda en renderizar y un chequeo de una sola vez se lo perdia.
tapSiApareceNeedlePolling("own_donoroffer_willsend_popup", 141, 436)

; Chequeo rapido cableado (2026-08-26): needle propia own_donoroffer_choosecard_title_native
; (el titulo "Choose a Card to Trade", estable -- no depende de la carta), validada en vivo --
; match exacto (variation 0) contra una captura real y sin ningun falso positivo hasta
; variation 80 contra 11 capturas de otras pantallas.
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
; Recuperacion "vista ampliada" (2026-08-25, bug real reproducido en vivo -- el toque de
; seleccion de arriba a veces deja la carta en vista ampliada/zoom en vez de solo
; seleccionarla con el check -- sospecha del usuario, a confirmar: el Speed Mod a 3x puede
; estar alterando el timing real del toque). Needle own_donoroffer_cardinfo_zoomed (el icono
; "Card Info", SOLO visible en esa vista ampliada -- confirmado en vivo contra 2 capturas
; reales del bug + 1 captura normal sin match). Si aparece: foto de evidencia (mismo criterio
; que _OfferPhoto.png, bot.js la manda a Discord si existe) + UN SOLO toque en la coordenada
; de OK (en la vista ampliada cae en zona vacia debajo de la carta, cierra el zoom) -- SIN
; retocar la carta de nuevo (a pedido explicito del usuario: el toque de mas volvia a caer
; en la carta, no en OK). El flujo normal de mas abajo sigue solo desde aca.
tempFileZoom := A_ScriptDir . "\Logs\_donoroffer_zoomcheck.png"
AdbScreenshot(adbPath, puerto, tempFileZoom)
if (FileExist(tempFileZoom)) {
    pBitmapZoom := Gdip_CreateBitmapFromFile(tempFileZoom)
    if (pBitmapZoom) {
        pNeedleZoom := Gdip_CreateBitmapFromFile(A_ScriptDir . "\Needles\own_donoroffer_cardinfo_zoomed.png")
        vPosZoom := ""
        estaAmpliada := (pNeedleZoom && Gdip_ImageSearch(pBitmapZoom, pNeedleZoom, vPosZoom, 0, 0, 0, 0, 30) = 1)
        if (pNeedleZoom)
            Gdip_DisposeImage(pNeedleZoom)
        if (estaAmpliada) {
            FileCopy, %tempFileZoom%, % StrReplace(g_outputFile, ".txt", "_ZoomRecoveryPhoto.png"), 1
            tap(145, 458)  ; coordenada de OK -- zona vacia en la vista ampliada, cierra el zoom
        }
        Gdip_DisposeImage(pBitmapZoom)
    }
    FileDelete, %tempFileZoom%
}

; Paso 10 (2026-08-05, a pedido explicito del usuario): NO se puede needlear "OK ya
; habilitado" -- el boton tiene un shimmer de color que cambia de tono en cada captura
; (confirmado en vivo, ni variation 70 lo agarra), y el checkmark de la carta seleccionada
; tiene detras el arte de la carta, que varia constantemente (se comercia una carta
; distinta cada vez). Se reutiliza la misma needle del titulo (estable, no depende de la
; carta) solo para confirmar que seguimos en esta pantalla, y se toca OK a ciegas -- mismo
; criterio que la seleccion de la carta en el paso 9.
; Sleep antes del toque ciego (2026-08-25, bug real reproducido en vivo: el toque a veces
; caia sobre la carta en vez del boton OK -- abria "Card Info" en vez de confirmar --
; porque el boton todavia estaba terminando de habilitarse/renderizar en el instante exacto
; en que la needle del titulo (estable) ya daba OK. Mismo patron ya usado en otros lados de
; este pipeline para esta misma clase de bug: needle SIN tocar + Sleep + tap manual, en vez
; de esperarNeedleYTap (que toca apenas encuentra, sin margen).
if (!esperarNeedleSinAccion("own_donoroffer_choosecard_title", 30, 15000, "own_donoroffer_choosecard_title_native", 30))
    ExitConError("no_aparecio_ok_habilitado_paso10")
Sleep, 1500
tap(145, 458)
; Chequeo rapido cableado (2026-08-26): needle propia own_donoroffer_tradepartner_header_native
; ("Trade Partner"), validada en vivo -- match exacto contra una captura real y sin ningun
; falso positivo hasta variation 80 contra 12 capturas de otras pantallas.
if (!esperarNeedleYTap("own_donoroffer_tradepartner_header", 30, 197, 461, 15000, "own_donoroffer_tradepartner_header_native", 30))
    ExitConError("no_aparecio_preview_envio_paso11")
; Chequeo rapido cableado (2026-08-26): needle propia own_donoroffer_setcard_confirm_native
; (el texto especifico de este popup, "Do you want to set this as your card to be traded?" --
; NO el boton OK generico, que es solo un color solido y dio falsos positivos en vivo contra
; otras pantallas con botones celestes). Validada en vivo: match exacto, sin ningun falso
; positivo hasta variation 80 contra 13 capturas de otras pantallas.
if (!esperarNeedleYTap("own_donoroffer_cancel_ok", 30, 200, 365, 15000, "own_donoroffer_setcard_confirm_native", 20))
    ExitConError("no_aparecio_confirmar_set_card_paso12")

; Aviso "solo te queda 1 copia" -- puede no aparecer siempre. Pasado a needle real
; (2026-08-05, a pedido del usuario) -- ya no queda ningun chequeo por OCR en este script.
; Chequeo rapido cableado (2026-08-26): needle propia own_donoroffer_remainingcopy_popup_native
; (el texto de advertencia "This will trade a card that you only have one remaining copy of"),
; validada en vivo -- match exacto, sin ningun falso positivo hasta variation 80 contra 14
; capturas de otras pantallas.
tapSiApareceNeedle("own_donoroffer_remainingcopy_popup", 204, 383, 30, "own_donoroffer_remainingcopy_popup_native", 30)

; Foto real de cuando la donante ofrece la carta (2026-08-18, a pedido explicito del
; usuario -- mismo criterio que la foto que ya saca _DonorRespondAndFinalize.ahk): se saca
; ANTES de tocar, mientras la pantalla de confirmacion todavia esta completa. Nombre
; derivado del outputFile para que bot.js sepa donde buscarla.
; Chequeo rapido cableado (2026-08-26): needle propia own_donoroffer_offered_text_native
; ("You have offered the card to your trade partner."), validada en vivo -- match exacto,
; sin ningun falso positivo hasta variation 80 contra 15 capturas de otras pantallas.
if (!esperarNeedleSinAccion("own_donoroffer_offered_text", 30, 15000, "own_donoroffer_offered_text_native", 30))
    ExitConError("no_aparecio_confirmacion_final_paso14")
AdbScreenshot(adbPath, puerto, StrReplace(g_outputFile, ".txt", "_OfferPhoto.png"))
; Sleep antes del toque ciego (2026-08-27, bug real reproducido en vivo en _MainAcceptTradeOffer.ahk,
; mismo patron aca por prevencion): el chequeo rapido nuevo confirma la pantalla casi al
; instante -- mas rapido que lo que el boton OK puede tardar en habilitarse del todo.
Sleep, 1200
tap(136, 438)

WriteResult("OK")
Gdip_Shutdown(pToken)
ExitApp, 0
