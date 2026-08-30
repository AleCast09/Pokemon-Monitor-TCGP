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
; 4to arg nuevo y opcional (2026-08-29): ruta de la imagen de referencia de la carta pedida
; en Discord, usada por intentarMarcarFavoritoPorWishlist() mas abajo. Retrocompatible con
; llamadores viejos que todavia solo pasan [nombre, folderPath] (3 args totales con el
; outputFile de siempre) -- en ese caso g_rutaImagenReferencia queda vacio y la funcion nueva
; devuelve false altiro, cayendo al metodo de siempre (a ciegas) sin ningun cambio de
; comportamiento.
if (A_Args.Length() >= 4) {
    global g_rutaImagenReferencia := A_Args[3]
    global g_outputFile := A_Args[4]
} else {
    global g_rutaImagenReferencia := ""
    global g_outputFile := A_Args[3]
}

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

tap(x, y, esperaMs := 0) {
    static convX := 540/283, convY := 960/488, offset := 40
    global adbPath, puerto
    AdbTap(adbPath, puerto, Round(x * convX), Round((y - offset) * convY))
    Sleep, %esperaMs%
}

; Click REAL de mouse de Windows (no toque simulado por ADB) sobre coordenadas NATIVAS de la
; ventana (2026-08-30, bug real reproducido en vivo, muchas pruebas): el icono de favorito
; (estrella) reacciona MAL a `adb shell input tap`/`motionevent` -- en vez de marcar/desmarcar,
; abre una vista de pantalla completa sin ningun control tocable (solo el boton Atras de
; Android saca de ahi, y ademas cancela la marca). Un click real de Windows via
; ClientToScreen+MouseClick (asi es como MuMu traduce un click real del mouse del usuario, un
; camino DISTINTO al que usa la inyeccion de toque de ADB) SI marca la estrella de verdad,
; confirmado en vivo contra Machop y Repel. Usar SOLO para este boton puntual -- el resto del
; pipeline sigue con `tap()`/ADB de siempre, que funciona bien en todos los demas pasos.
clickMouseReal(nativeX, nativeY) {
    global g_hwndFast
    if (!g_hwndFast)
        return false
    ; Traer la ventana al frente antes de clickear (2026-08-30, precaucion de produccion): a
    ; diferencia del resto del pipeline (ADB, toque virtual que no depende de que la ventana
    ; este visible/al frente), esto mueve el mouse REAL de la PC -- si otra ventana tapara la
    ; instancia en ese pixel exacto, el click caeria en el lugar equivocado. Se restaura el
    ; foco anterior despues del click para no interferir con lo que el usuario este haciendo.
    hwndAnterior := WinExist("A")
    WinActivate, ahk_id %g_hwndFast%
    WinWaitActive, ahk_id %g_hwndFast%, , 2
    VarSetCapacity(pt, 8, 0)
    NumPut(nativeX, pt, 0, "int")
    NumPut(nativeY, pt, 4, "int")
    DllCall("ClientToScreen", "ptr", g_hwndFast, "ptr", &pt)
    screenX := NumGet(pt, 0, "int")
    screenY := NumGet(pt, 4, "int")
    CoordMode, Mouse, Screen
    MouseClick, Left, %screenX%, %screenY%, 1, 0
    if (hwndAnterior && hwndAnterior != g_hwndFast)
        WinActivate, ahk_id %hwndAnterior%
    return true
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
        ; Sleep de asentamiento antes del toque (2026-08-29, bug real reproducido en vivo con
        ; Speed Mod en 3x, dos veces en dos scripts distintos hoy mismo -- ver
        ; _MainAcceptFriendRequest.ahk y esperarTradeIconOBadgeRechazo de este mismo archivo):
        ; el chequeo rapido puede confirmar la needle en un frame donde el boton todavia no
        ; esta de verdad tocable -- probado a mano que el MISMO toque un instante despues si
        ; funciona. Aplicado aca en el corazon de la funcion para cubrir TODOS los pasos que
        ; la usan de una sola vez, en vez de parche por parche.
        if (chequeoRapidoNeedle(nombreNeedleNativo, variationNativo)) {
            Sleep, 900
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

; Version de esperarNeedleYTap para el paso 5, con DOS needles alternativas validas para
; confirmar la misma pantalla (2026-08-27, a pedido explicito del usuario -- ver comentario
; completo en el call site mas abajo): el tile "Trade" vacio de siempre, O el mismo tile con
; el badge rojo "No trade agreement reached" si un trade anterior fue rechazado. Cualquiera
; de las dos confirma que estamos en Social Hub, listos para tocar la coordenada de siempre.
esperarTradeIconOBadgeRechazo(timeoutMs := 15000) {
    global adbPath, puerto, g_winTitle
    inicio := A_TickCount
    Loop {
        ; Sleep de asentamiento antes del toque (2026-08-29, bug real reproducido en vivo con
        ; Speed Mod en 3x -- mismo patron ya encontrado y arreglado hoy en
        ; _MainAcceptFriendRequest.ahk): la needle del tile "Trade" ya matcheaba pero el toque
        ; automatico no registraba, dejando el script parado en Social Hub sin avanzar.
        if (chequeoRapidoNeedle("own_donoroffer_trade_icon_native", 30) || chequeoRapidoNeedle("own_donoroffer_notradeagreement_badge_native", 30)) {
            Sleep, 400
            tap(207, 402)
            return true
        }
        tempFile := A_ScriptDir . "\Logs\_step_check_" . g_winTitle . ".png"
        AdbScreenshot(adbPath, puerto, tempFile)
        encontrado := false
        if (FileExist(tempFile)) {
            pBitmap := Gdip_CreateBitmapFromFile(tempFile)
            FileDelete, %tempFile%
            if (pBitmap) {
                pNeedle := Gdip_CreateBitmapFromFile(A_ScriptDir . "\Needles\own_donoroffer_trade_icon.png")
                if (pNeedle) {
                    vPos := ""
                    encontrado := (Gdip_ImageSearch(pBitmap, pNeedle, vPos, 0, 0, 0, 0, 30) = 1)
                }
                Gdip_DisposeImage(pBitmap)
            }
        }
        if (encontrado) {
            Sleep, 400
            tap(207, 402)
            return true
        }
        if (A_TickCount - inicio > timeoutMs)
            return false
        Sleep, 500
    }
}

; ============================================================================
; Bloque nuevo (2026-08-29, a pedido explicito del usuario): seleccion de la carta a ofrecer
; por wishlist+favorito de Main, en vez de a ciegas por posicion. Diseño completo validado en
; vivo contra la cuenta real de Main en 2 sesiones (2026-08-28/29) usando scripts de
; diagnostico sueltos -- ver memoria "project_pending_tasks" punto 60 para el detalle
; completo de cada paso. Las 2 funciones de abajo (intentarMarcarFavoritoPorWishlist y
; seleccionarCartaPorFavoritos) implementan ese diseño ya probado; si CUALQUIER paso falla
; (sin imagen de referencia, perfil no carga, wishlist no aparece, ninguna de las 3
; coincide), devuelven false y el flujo de siempre sigue exactamente igual que antes (a
; ciegas), sin cortar el trade.

; Baja/sube el Speed Mod (ver memoria project_pending_speedmod_swipe_bug): a 3x, tocar una
; carta del Wishlist la deja "agrandada" (zoom) en vez de abrirla normal -- confirmado en
; vivo 2026-08-29. Best-effort, mismo criterio que _SpeedMod.ahk -- si el icono no aparece,
; no corta el flujo. El needle own_speedmod_icon no matcheo de forma confiable en las
; pruebas de hoy pese a que el icono se veia bien en pantalla -- se usa el toque a ciegas en
; (18,109), confirmado funcionando 2 veces en vivo esa misma sesion.
deslizarSpeedMod(direccion) {
    global adbPath, puerto
    tap(18, 109, 900)
    if (direccion = "min")
        RunWait, %ComSpec% /c ""%adbPath%" -s 127.0.0.1:%puerto% shell input swipe 363 248 33 248 600", , Hide
    else
        RunWait, %ComSpec% /c ""%adbPath%" -s 127.0.0.1:%puerto% shell input swipe 33 248 363 248 600", , Hide
    Sleep, 1000
    tap(171, 285, 400)  ; minimizar panel
}

; Swipe vertical en escala logica (229x488), mismo helper usado en los scripts de
; diagnostico de esta semana.
; BUG REAL encontrado y corregido en vivo (2026-08-29): faltaba repetir xAdb como el x2 del
; comando "adb shell input swipe x1 y1 x2 y2 duracion" (5 valores) -- esta version mandaba
; solo 4, asi que adb interpretaba mal los parametros (y2Adb terminaba en el lugar de x2, y
; la duracion real se perdia) y el gesto resultante no era el swipe vertical esperado en
; absoluto. Esto explica la "variabilidad" que se venia viendo en las pruebas de hoy con este
; helper -- no era el juego, era este bug.
swipeLogico(x, y1, y2, durMs) {
    static convX := 540/283, convY := 960/488, offset := 40
    global adbPath, puerto
    xAdb := Round(x * convX)
    y1Adb := Round((y1 - offset) * convY)
    y2Adb := Round((y2 - offset) * convY)
    RunWait, %ComSpec% /c ""%adbPath%" -s 127.0.0.1:%puerto% shell input swipe %xAdb% %y1Adb% %xAdb% %y2Adb% %durMs%", , Hide
}

; Swipe horizontal DENTRO de la vista ampliada de una carta del Wishlist, para pasar a la
; siguiente (coordenadas dadas por el usuario, 600ms confirmado como carrusel lineal -- no
; circular -- con esta duracion).
swipeCardHorizontal() {
    static convX := 540/283, convY := 960/488, offset := 40
    global adbPath, puerto
    x1Adb := Round(220 * convX)
    y1Adb := Round((490 - offset) * convY)
    x2Adb := Round(49 * convX)
    y2Adb := Round((496 - offset) * convY)
    RunWait, %ComSpec% /c ""%adbPath%" -s 127.0.0.1:%puerto% shell input swipe %x1Adb% %y1Adb% %x2Adb% %y2Adb% 600", , Hide
}

; Igual que chequeoRapidoNeedle (definida mas abajo) pero tambien devuelve la posicion
; nativa del match -- usada para calcular la Y de las cartas del Wishlist a partir de donde
; matcheo el corazon, y para tocar la estrella de favorito en su posicion real en vez de una
; coordenada fija sin validar.
chequeoRapidoNeedleConPosicion(nombreNeedleNativo, variationNativo, ByRef outX, ByRef outY) {
    global g_hwndFast
    if (!g_hwndFast)
        return false
    pBitmap := capturarVentana(g_hwndFast)
    if (!pBitmap)
        return false
    encontrado := false
    pNeedle := Gdip_CreateBitmapFromFile(A_ScriptDir . "\Needles\" . nombreNeedleNativo . ".png")
    if (pNeedle) {
        vPos := ""
        if (Gdip_ImageSearch(pBitmap, pNeedle, vPos, 0, 0, 0, 0, variationNativo) = 1) {
            encontrado := true
            partes := StrSplit(vPos, ",")
            outX := partes[1]
            outY := partes[2]
        }
        Gdip_DisposeImage(pNeedle)
    }
    Gdip_DisposeImage(pBitmap)
    return encontrado
}

; Poll de chequeoRapidoNeedle (definida mas abajo) sin ninguna accion -- solo espera a que
; una needle nativa matchee de verdad antes de seguir.
; Cierra el popup de Emblem en CADA vuelta si aparece (2026-08-29, a pedido explicito del
; usuario -- "puede aparecer cada rato, como haremos para que este atento"): asi cualquier
; espera dentro de intentarMarcarFavoritoPorWishlist queda cubierta de forma automatica, sin
; depender de acordarse de llamar cerrarEmblemPopupSiAparece() a mano despues de cada
; tap/swipe puntual.
esperarChequeoRapido(nombreNeedleNativo, variationNativo, timeoutMs) {
    inicio := A_TickCount
    Loop {
        if (chequeoRapidoNeedle(nombreNeedleNativo, variationNativo))
            return true
        cerrarEmblemPopupSiAparece()
        if (A_TickCount - inicio > timeoutMs)
            return false
        Sleep, 300
    }
}

; Cierra el popup de detalle de Emblem si aparece (2026-08-29, bug real reproducido en vivo:
; un swipe corto se puede leer como TOQUE y abre por accidente el detalle de un Emblem al
; azar -- puede pasar varias veces seguidas mientras se ajusta el swipe). Needle propia
; own_donoroffer_emblempopup_close_x_native (el boton X circular, icono generico -- variation
; 30 confirmado sin falsos positivos contra 6 capturas de otras pantallas, empieza a fallar
; recien en variation 60). Se llama despues de CADA swipe en el loop de paso 2 -- si aparece,
; lo cierra y listo, el mismo loop reintenta el swipe en la vuelta siguiente.
cerrarEmblemPopupSiAparece() {
    if (chequeoRapidoNeedle("own_donoroffer_emblempopup_close_x_native", 30)) {
        tap(141, 407, 600)
        return true
    }
    return false
}

; Confirma que una carta del Wishlist esta genuinamente abierta en vista ampliada (2026-08-30,
; bug real reproducido en vivo: el needle usado antes para esto,
; own_donoroffer_wishlistcard_close_x_native, es un boton X GENERICO reusado en muchas
; pantallas del juego -- incluida "Select a Friend", que tiene el MISMO icono en la MISMA
; posicion -- asi que siempre "confirmaba" aunque la carta nunca se hubiera abierto de
; verdad. La estrella de favorito (marcada o sin marcar) SOLO existe en la vista ampliada de
; una carta -- validado en vivo: matchea limpio contra la carta abierta y da 0 contra "Select
; a Friend".
esperarAperturaCartaConfirmada(timeoutMs) {
    inicio := A_TickCount
    Loop {
        if (chequeoRapidoNeedle("own_donoroffer_userprofile_favoritestar_native", 60) || chequeoRapidoNeedle("own_donoroffer_userprofile_favoritestar_marked_native", 60))
            return true
        cerrarEmblemPopupSiAparece()
        if (A_TickCount - inicio > timeoutMs)
            return false
        Sleep, 300
    }
}

; Cierra el perfil si quedo abierto, ANTES de devolver false (2026-08-29, bug real
; reproducido en vivo: los early-return de arriba devolvian false sin cerrar nada, dejando
; la instancia colgada dentro del perfil/Wishlist -- el paso siguiente del pipeline (volver
; a "Select a Friend") nunca encontraba esa pantalla y todo el trade fallaba con
; "no_aparecio_selectfriend_paso7b"). Best-effort con timeout corto -- si no encuentra la
; needle de cierre, no bloquea el retorno (el llamador sigue con el metodo viejo igual).
cerrarPerfilSiEstaAbierto() {
    if (esperarChequeoRapido("own_donoroffer_userprofile_close_x_native", 60, 2000)) {
        tap(140, 500, 1000)
        return
    }
    ; El boton X no es visible desde cualquier posicion de scroll -- si el swipe hacia el
    ; Wishlist quedo mas abajo de lo esperado, primero hay que subir de nuevo antes de
    ; encontrarlo (confirmado en vivo: needle en 0 desde la vista de "Achievements").
    ; Y de arranque corregido de 36 a 100 (2026-08-30, bug real reproducido en vivo): con
    ; offset=40, y=36 da una coordenada de dispositivo NEGATIVA ((36-40)*960/488 ≈ -8) -- el
    ; swipe arrancaba fuera del area tocable y nunca scrolleaba, dejando la pantalla pegada en
    ; "Achievements" para siempre. Confirmado en vivo: con y=100 el swipe sí sube el scroll.
    Loop, 3 {
        swipeLogico(250, 100, 450, 600)
        Sleep, 600
        if (esperarChequeoRapido("own_donoroffer_userprofile_close_x_native", 60, 1500)) {
            tap(140, 500, 1000)
            return
        }
    }
}

; Compara el arte de dos recortes de tamaños distintos reduciendolos a una grilla chica de
; promedios de color y comparando celda por celda (concepto validado visualmente en la
; sesion anterior, ver memoria punto 60 paso 4 -- esta es la primera vez que se escribe como
; funcion real). rectVivo/rectReferencia son objetos {x,y,w,h} en pixeles nativos de cada
; bitmap. ADVERTENCIA: el rect esta calibrado contra una carta Trainer/Item ("Repel") -- las
; cartas de Pokemon tienen un marco/arte con proporciones algo distintas (confirmado
; visualmente en vivo 2026-08-29 con "Machop"), asi que puede necesitar ajuste fino si da
; falsos negativos frecuentes en la práctica.
; Blindada con chequeos de puntero (2026-08-30, bug real reproducido en vivo: el proceso
; terminaba con "codigo_0" y el archivo de resultado vacio -- exit sin ningun WriteResult,
; patron tipico de un crash silencioso en una llamada DLL de GDI+ con un puntero invalido).
; Ninguna de las llamadas de abajo verificaba que el paso anterior haya devuelto un puntero
; valido antes de usarlo -- ahora cada una se chequea, y si algo falla se limpia lo que si se
; alcanzo a crear y devuelve false (nunca match) en vez de crashear el script entero.
compararArteCartas(pBitmapVivo, rectVivo, pBitmapReferencia, rectReferencia, grilla := 8, tolerancia := 45) {
    if (!pBitmapVivo || !pBitmapReferencia)
        return false

    pGrillaVivo := Gdip_CreateBitmap(grilla, grilla)
    pGrillaRef := Gdip_CreateBitmap(grilla, grilla)
    if (!pGrillaVivo || !pGrillaRef) {
        if (pGrillaVivo)
            Gdip_DisposeImage(pGrillaVivo)
        if (pGrillaRef)
            Gdip_DisposeImage(pGrillaRef)
        return false
    }

    pGraphVivo := Gdip_GraphicsFromImage(pGrillaVivo)
    pGraphRef := Gdip_GraphicsFromImage(pGrillaRef)
    if (!pGraphVivo || !pGraphRef) {
        if (pGraphVivo)
            Gdip_DeleteGraphics(pGraphVivo)
        if (pGraphRef)
            Gdip_DeleteGraphics(pGraphRef)
        Gdip_DisposeImage(pGrillaVivo)
        Gdip_DisposeImage(pGrillaRef)
        return false
    }

    Gdip_SetInterpolationMode(pGraphVivo, 7)
    Gdip_SetInterpolationMode(pGraphRef, 7)
    Gdip_DrawImage(pGraphVivo, pBitmapVivo, 0, 0, grilla, grilla, rectVivo.x, rectVivo.y, rectVivo.w, rectVivo.h)
    Gdip_DrawImage(pGraphRef, pBitmapReferencia, 0, 0, grilla, grilla, rectReferencia.x, rectReferencia.y, rectReferencia.w, rectReferencia.h)
    Gdip_DeleteGraphics(pGraphVivo)
    Gdip_DeleteGraphics(pGraphRef)

    sumaDiferencias := 0
    Loop, % grilla {
        y := A_Index - 1
        Loop, % grilla {
            x := A_Index - 1
            c1 := Gdip_GetPixel(pGrillaVivo, x, y)
            c2 := Gdip_GetPixel(pGrillaRef, x, y)
            r1 := (c1 >> 16) & 0xFF, g1 := (c1 >> 8) & 0xFF, b1 := c1 & 0xFF
            r2 := (c2 >> 16) & 0xFF, g2 := (c2 >> 8) & 0xFF, b2 := c2 & 0xFF
            sumaDiferencias += Abs(r1 - r2) + Abs(g1 - g2) + Abs(b1 - b2)
        }
    }
    Gdip_DisposeImage(pGrillaVivo)
    Gdip_DisposeImage(pGrillaRef)
    promedio := sumaDiferencias / (grilla * grilla * 3)
    return (promedio <= tolerancia)
}

; Log de depuracion (2026-08-30, a pedido explicito del usuario -- "contigo si funciona,
; pero cuando lo corro desde el bot no funciona": no se pudo reproducir la diferencia real
; entre correrlo a mano y que lo dispare bot.js, asi que en vez de seguir ajustando timings a
; ciegas, esto deja un rastro con timestamp de cada paso en un archivo aparte que SI persiste
; (a diferencia del outputFile normal, que bot.js borra apenas lo lee) para diagnosticar la
; proxima corrida real con datos concretos.
logDebugWishlist(msg) {
    FileAppend, % A_Hour ":" A_Min ":" A_Sec "." A_MSec " -- " msg "`n", % A_ScriptDir . "\Logs\_donoroffer_wishlist_debug.log"
}

; Funcion principal nueva -- ver comentario del bloque completo arriba. Devuelve true si
; encontro y dejo marcada una coincidencia en el Wishlist de Main, false en cualquier otro
; caso (el llamador debe seguir con el metodo viejo a ciegas, SIN cortar el trade).
intentarMarcarFavoritoPorWishlist(rutaImagenReferencia) {
    global g_hwndFast, adbPath, puerto

    logDebugWishlist("INICIO -- rutaImagenReferencia=" . rutaImagenReferencia)

    if (rutaImagenReferencia = "" || !FileExist(rutaImagenReferencia)) {
        logDebugWishlist("SALIDA: sin imagen de referencia o archivo no existe")
        return false
    }

    pBitmapReferencia := Gdip_CreateBitmapFromFile(rutaImagenReferencia)
    if (!pBitmapReferencia) {
        logDebugWishlist("SALIDA: Gdip_CreateBitmapFromFile devolvio 0")
        return false
    }

    ; Paso 0: bajar Speed Mod a 1x ANTES de tocar el avatar (2026-08-29, RESTAURADO tras 8
    ; pruebas reales en vivo -- a 3x el swipe de acercamiento al Wishlist nunca llego a
    ; matchear en 5 intentos Y encima abrio el popup de Emblem por accidente; en las 7
    ; pruebas hechas a 1x el popup jamas aparecio). Se habia sacado antes por pedido del
    ; usuario, pero la evidencia en vivo confirma que hace falta para este mecanismo puntual.
    logDebugWishlist("paso0: bajando speed mod a min")
    deslizarSpeedMod("min")
    logDebugWishlist("paso0: listo")

    ; Paso 1: tocar avatar del amigo -- abre su perfil completo. NUNCA usar su foto/nombre
    ; real como needle de confirmacion (dato personal).
    logDebugWishlist("paso1: tocando avatar (54,151)")
    tap(54, 151, 500)
    cerrarEmblemPopupSiAparece()

    ; Paso 1b: esperar a que el perfil cargue de verdad (needle Battle Record) antes de
    ; swipear -- si arranca antes, un swipe puede leerse como toque y abrir un Emblem por
    ; error (bug real reproducido en vivo 2026-08-28).
    battlerecordOk := esperarChequeoRapido("own_donoroffer_userprofile_battlerecord_native", 60, 10000)
    logDebugWishlist("paso1b: battlerecord match=" . battlerecordOk)
    if (!battlerecordOk) {
        Gdip_DisposeImage(pBitmapReferencia)
        cerrarPerfilSiEstaAbierto()
        deslizarSpeedMod("max")
        logDebugWishlist("SALIDA: perfil no cargo")
        return false
    }

    ; Paso 2 (2026-08-30, RESTAURADO el fallback tras 2 pruebas reales en vivo donde los 2
    ; swipes fuertes fijos NO alcanzaron -- una vez el corazon nunca matcheo en ninguno de los
    ; 2, otra vez el perfil parecio arrancar el swipe desde una posicion de scroll distinta a
    ; la esperada): 2 swipes fuertes (250,450->36,600ms) primero, y si no alcanzan, hasta 6
    ; swipes CHICOS de ajuste (250,350->280,500ms -- no repetir el fuerte, eso ya se probo que
    ; se pasa de largo del Wishlist si se repite varias veces). Chequeo del corazon (variation
    ; 60, no aceptar solo v80) despues de cada swipe, fuerte o chico.
    foundX := "", foundY := ""
    matcheoCorazon := false
    Loop, 2 {
        swipeLogico(250, 450, 36, 600)
        Sleep, 700
        cerrarEmblemPopupSiAparece()
        if (chequeoRapidoNeedleConPosicion("own_donoroffer_wishlist_heart_native", 75, foundX, foundY)) {
            matcheoCorazon := true
            logDebugWishlist("paso2: swipe fuerte " . A_Index . " -- MATCH corazon en X=" . foundX . " Y=" . foundY)
            break
        }
        logDebugWishlist("paso2: swipe fuerte " . A_Index . " -- no match")
    }
    if (!matcheoCorazon) {
        Loop, 6 {
            swipeLogico(250, 350, 280, 500)
            Sleep, 600
            cerrarEmblemPopupSiAparece()
            if (chequeoRapidoNeedleConPosicion("own_donoroffer_wishlist_heart_native", 75, foundX, foundY)) {
                matcheoCorazon := true
                logDebugWishlist("paso2: swipe fino " . A_Index . " -- MATCH corazon en X=" . foundX . " Y=" . foundY)
                break
            }
            logDebugWishlist("paso2: swipe fino " . A_Index . " -- no match")
        }
    }
    if (!matcheoCorazon) {
        Gdip_DisposeImage(pBitmapReferencia)
        cerrarPerfilSiEstaAbierto()
        deslizarSpeedMod("max")
        logDebugWishlist("SALIDA: corazon nunca matcheo tras 2 swipes")
        return false
    }

    ; Paso 3: posicion de la carta 1 -- offset fijo de 67px arriba del corazon (Y nativo ->
    ; Y logico = Ynativo + 40, validado en 4+ corridas con el corazon en posiciones Y
    ; distintas).
    yCarta := (foundY + 40) - 67
    logDebugWishlist("paso3: yCarta calculado=" . yCarta . " (tap en 137," . yCarta . ")")

    ; Paso 3b: abrir la primera carta -- da igual cual sea, el swipe interno cicla las 3
    ; (carrusel lineal, no circular, confirmado con 600ms). CONFIRMAR que de verdad se abrio
    ; antes de seguir (2026-08-29, bug real reproducido en vivo: el toque a veces no
    ; registraba, y el script seguia de largo igual -- subia la velocidad y comparaba arte
    ; contra la lista sin abrir, en vez de la carta ampliada). Needle: el mismo boton X de
    ; cerrar (own_donoroffer_wishlistcard_close_x_native) SOLO existe en la vista ampliada,
    ; asi que confirma que la carta esta abierta de verdad. Reintenta el toque una vez mas si
    ; hace falta antes de rendirse.
    ; Margen de asentamiento ANTES del toque (2026-08-29/30, bug real reproducido en vivo
    ; varias veces: el toque a mano funcionaba siempre -- incluso reproduciendo la MISMA
    ; formula -- pero el automatico fallaba consistentemente con margenes cortos (400/700ms).
    ; Subido bastante mas -- la diferencia real parece ser el tiempo que pasa entre acciones,
    ; que a mano es mucho mayor de forma natural (varios comandos separados) que en el script
    ; corriendo todo seguido.
    Sleep, 1800
    logDebugWishlist("paso3b: toque 1 en (137," . yCarta . ")")
    tap(137, yCarta, 1500)
    cerrarEmblemPopupSiAparece()
    confirmoApertura := esperarAperturaCartaConfirmada(6000)
    logDebugWishlist("paso3b: confirmacion toque 1 = " . confirmoApertura)
    if (!confirmoApertura) {
        Sleep, 1500
        logDebugWishlist("paso3b: toque 2 (reintento) en (137," . yCarta . ")")
        tap(137, yCarta, 1500)
        cerrarEmblemPopupSiAparece()
        confirmoApertura := esperarAperturaCartaConfirmada(6000)
        logDebugWishlist("paso3b: confirmacion toque 2 = " . confirmoApertura)
        if (!confirmoApertura) {
            Gdip_DisposeImage(pBitmapReferencia)
            cerrarPerfilSiEstaAbierto()
            deslizarSpeedMod("max")
            logDebugWishlist("SALIDA: la carta nunca se confirmo abierta tras 2 toques")
            return false
        }
    }
    logDebugWishlist("paso3b: carta abierta confirmada, empezando loop de comparacion")

    encontroMatch := false
    Loop, 3 {
        ; Paso 6: comparar el arte de la carta actual contra la referencia.
        pBitmapVivo := capturarVentana(g_hwndFast)
        matchea := false
        if (pBitmapVivo) {
            rectVivo := {x: 30, y: 140, w: 215, h: 122}
            rectReferencia := {x: 12, y: 58, w: 250, h: 137}
            matchea := compararArteCartas(pBitmapVivo, rectVivo, pBitmapReferencia, rectReferencia)
            Gdip_DisposeImage(pBitmapVivo)
        }

        ; Paso 7: marcar/desmarcar segun match y estado actual de la estrella (4 casos,
        ; decidido explicitamente por el usuario 2026-08-29):
        ;   match + gris -> marcar | match + dorada -> no tocar
        ;   no match + gris -> no tocar | no match + dorada -> DESMARCAR (evita 2 favoritas
        ;   a la vez al filtrar por Favorites despues).
        starX := "", starY := ""
        estaMarcada := chequeoRapidoNeedleConPosicion("own_donoroffer_userprofile_favoritestar_marked_native", 60, starX, starY)
        if (!estaMarcada)
            chequeoRapidoNeedleConPosicion("own_donoroffer_userprofile_favoritestar_native", 60, starX, starY)

        if (((matchea && !estaMarcada) || (!matchea && estaMarcada)) && starX != "") {
            ; Click REAL de mouse, NO tap por ADB (2026-08-30, bug real reproducido en vivo --
            ; ver comentario completo en clickMouseReal): `adb shell input tap` sobre este icono
            ; puntual abre una vista de pantalla completa sin controles y cancela la marca al
            ; salir. Coordenadas nativas directas del match, sin conversion a logico.
            ; Correccion de centro (2026-08-30, bug real reproducido en vivo -- esta needle mide
            ; 26x20; Gdip_ImageSearch devuelve la esquina superior-izquierda, no el centro, asi
            ; que sin sumar la mitad el click caia corrido y todavia disparaba el bug de la
            ; "vista sin controles" en vez de marcar/desmarcar de verdad).
            clickMouseReal(starX + 13, starY + 10)
            Sleep, 600

            ; Chequeo de seguridad: si por algun motivo SI aparecio la vista sin controles
            ; (ej. mouse no disponible en el entorno donde corre), recuperar con el boton Atras
            ; en vez de dejar la instancia trabada.
            if (!chequeoRapidoNeedle("own_donoroffer_wishlistcard_close_x_native", 60)) {
                Sleep, 1000
                if (!chequeoRapidoNeedle("own_donoroffer_wishlistcard_close_x_native", 60)) {
                    AdbKeyBack(adbPath, puerto)
                    Sleep, 800
                    logDebugWishlist("carta " . A_Index . "/3: vista sin controles tras marcar, mande Atras")
                }
            }
        }

        if (matchea)
            encontroMatch := true

        logDebugWishlist("carta " . A_Index . "/3: matchea=" . matchea . " estabaMarcada=" . estaMarcada)

        ; Paso 8 (2026-08-30, CORREGIDO tras prueba real en vivo -- ver comentario completo en
        ; swipeCardHorizontal): el swipe horizontal pasa a la carta siguiente DENTRO del mismo
        ; carrusel ampliado, SIN cerrar antes -- cerrar primero devuelve al resumen del perfil,
        ; dejando las comparaciones de las cartas 2/3 y 3/3 corriendo contra la pantalla
        ; equivocada (confirmado en vivo: nunca hubo un match real en ningun log completo hasta
        ; este fix). Ahora el swipe va PRIMERO, con la carta todavia abierta, y el cierre pasa
        ; una sola vez al final del loop.
        ; SIEMPRE se revisan las 3, sin cortar en el primer match (decision explicita del
        ; usuario 2026-08-29 -- evita dejar favoritas viejas sin revisar en cartas
        ; posteriores a la que matcheo).
        if (A_Index < 3) {
            swipeCardHorizontal()
            Sleep, 900
            cerrarEmblemPopupSiAparece()
        }
    }

    ; Paso 9: cerrar la carta ampliada, una sola vez, despues de revisar las 3. CORREGIDO
    ; (2026-08-30, bug real reproducido en vivo -- sospecha del usuario, confirmada): el toque
    ; a coordenada fija (140,500) puede caer cerca del borde de la X en vez de justo encima, y
    ; eso dispara el mismo bug de "vista sin controles" ya visto con la estrella (ver
    ; clickMouseReal). Ahora usa la posicion REAL donde matcheo la X + click real de mouse, no
    ; tap por ADB a coordenada fija.
    closeX := "", closeY := ""
    inicioClose := A_TickCount
    encontroClose := false
    Loop {
        if (chequeoRapidoNeedleConPosicion("own_donoroffer_wishlistcard_close_x_native", 60, closeX, closeY)) {
            encontroClose := true
            break
        }
        if (A_TickCount - inicioClose > 8000)
            break
        Sleep, 300
    }
    ; Correccion de centro (2026-08-30, bug real reproducido en vivo -- mismo patron ya
    ; encontrado con la estrella): Gdip_ImageSearch devuelve la esquina SUPERIOR-IZQUIERDA del
    ; match, no el centro -- esta needle mide 40x26, sin sumar la mitad se clickeaba corrido y
    ; disparaba el mismo bug de "vista sin controles" en vez de cerrar de verdad.
    if (encontroClose)
        clickMouseReal(closeX + 20, closeY + 13)
    Sleep, 1000

    ; Paso 10: cerrar el perfil completo. CORREGIDO (2026-08-30, bug real reproducido en
    ; vivo): el chequeo simple de 8s no alcanzaba si el ultimo swipe entre cartas dejo el
    ; scroll cerca de "Achievements", donde el boton X no es visible -- la instancia quedaba
    ; trabada DENTRO del perfil de Main, rompiendo el proximo Retry desde el principio (la
    ; donante nunca volvia a Social Hub, asi que ni siquiera llegaba a intentar el wishlist de
    ; nuevo). Se usa la misma funcion robusta de los early-return de arriba (sube con swipes
    ; si hace falta antes de buscar el boton).
    cerrarPerfilSiEstaAbierto()

    Gdip_DisposeImage(pBitmapReferencia)
    logDebugWishlist("FIN: encontroMatch=" . encontroMatch)
    return encontroMatch
}

; Reemplaza la seleccion a ciegas por posicion (viejo paso 9) -- aplica el filtro nativo
; "Favorites" en el panel de busqueda de "Choose a Card to Trade" para que solo quede
; visible la carta ya marcada por intentarMarcarFavoritoPorWishlist(). Se llama SOLO si esa
; funcion devolvio true. Devuelve true si logro aplicar el filtro (el llamador sigue con el
; toque final de seleccion de siempre, ahora sobre la unica carta filtrada); false si algo
; fallo -- el llamador cae al toque de siempre sin filtro (a ciegas, mismo comportamiento
; que ya existia).
seleccionarCartaPorFavoritos() {
    ; Abrir el panel de filtros (lupa).
    tap(247, 146, 800)
    if (!esperarChequeoRapido("own_donoroffer_filterpanel_plusicon_native", 60, 8000))
        return false

    ; Tocar "Favorites". Coordenada corregida en vivo -- (138,326) cae mal en "Cards on
    ; wishlist only".
    tap(80, 330, 600)
    ; Timeout subido de 5000 a 10000 (2026-08-30, bug real reproducido en vivo): 5s no alcanzo
    ; en una corrida real -- el chequeo se dio por vencido antes de tiempo pese a que el juego
    ; SI habia marcado la casilla bien, dejando el panel de filtros abierto sin tocar OK nunca
    ; (el toque a ciegas de la carta, mas abajo en el flujo, cayo dentro del panel en vez de
    ; sobre una carta). El loop de adentro (esperarChequeoRapido) ya toca apenas matchea, sin
    ; ninguna demora agregada -- subir el limite NO afecta el caso normal (rapido), solo evita
    ; rendirse antes de tiempo en el caso raro donde tarda un poco mas.
    if (!esperarChequeoRapido("own_donoroffer_favtoggle_selected_native", 60, 10000))
        return false

    ; OK del filtro. Coordenada corregida en vivo -- (137,424) tambien cae mal.
    tap(147, 457, 1200)
    return true
}
; ============================================================================

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
; Needle alternativa agregada (2026-08-27, a pedido explicito del usuario, caso real visto en
; vivo): si un trade anterior fue RECHAZADO, este mismo tile "Trade" no aparece vacio -- tiene
; un badge rojo "!" superpuesto (icono generico, sin texto) junto con el texto "No trade
; agreement reached". Mismo tile, misma coordenada de toque de siempre -- solo se agrega el
; reconocimiento de este segundo estado para no depender solo del tile vacio. Needle propia
; own_donoroffer_notradeagreement_badge_native, validada en vivo: limpio contra Social Hub
; normal y contra otra captura de Social Hub, hasta variation 60 (empieza a fallar recien en
; 80, muy por encima de la tolerancia 30 usada aca).
if (!esperarTradeIconOBadgeRechazo())
    ExitConError("no_aparecio_socialhub_paso5")

; Popup "The trade has been terminated and no trade agreement was reached" (2026-08-27, a
; pedido explicito del usuario, caso real visto en vivo -- justo el que dispara el badge de
; rechazo de arriba): al entrar a Trade despues de un rechazo, este popup tapa la pantalla
; antes de llegar a la landing normal de Trade. Se cierra tocando OK y de ahi sigue derecho
; el flujo de siempre (la landing de Trade es identica despues). Opcional -- si no aparece
; (caso normal, sin rechazo previo), no hace nada y sigue de largo.
; Needle propia own_donoroffer_tradeterminated_dimmedsprite_native (mascota de fondo
; atenuada por el popup, sin texto ni datos personales -- la foto/nombre del trade partner en
; este popup NUNCA se usan como needle, varian por cuenta y son datos personales). Validada en
; vivo: match exacto contra 2 capturas reales de este popup, 0 contra Social Hub normal (x2),
; Trade Offer Received y Friends. Coordenada de OK (140,380) tambien confirmada en vivo (cierra
; el popup de verdad, verificado con captura despues del toque).
if (chequeoRapidoNeedle("own_donoroffer_tradeterminated_dimmedsprite_native", 30))
    tap(140, 380)

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
if (!esperarNeedleSinAccion("own_donoroffer_selectfriend_trade", 30, 15000, "own_donoroffer_selectfriend_trade_native", 30))
    ExitConError("no_aparecio_selectfriend_paso7")

; Nuevo (2026-08-29): intenta marcar la carta correcta como favorita en el Wishlist de Main
; ANTES de tocar "Trade" -- ver bloque de funciones nuevas mas arriba. Si falla en
; cualquier paso, sigue con el metodo viejo (a ciegas) sin cortar el trade.
g_favoritoMarcado := intentarMarcarFavoritoPorWishlist(g_rutaImagenReferencia)

if (!esperarNeedleYTap("own_donoroffer_selectfriend_trade", 30, 213, 179, 15000, "own_donoroffer_selectfriend_trade_native", 30))
    ExitConError("no_aparecio_selectfriend_paso7b")

; Popup explicativo "Choose a Card to Trade" -- puede no aparecer siempre. Reintenta unos
; segundos (ver tapSiApareceNeedlePolling) en vez de un chequeo unico -- confirmado en vivo
; que a veces tarda en renderizar y un chequeo de una sola vez se lo perdia.
tapSiApareceNeedlePolling("own_donoroffer_willsend_popup", 141, 436)

; Chequeo rapido cableado (2026-08-26): needle propia own_donoroffer_choosecard_title_native
; (el titulo "Choose a Card to Trade", estable -- no depende de la carta), validada en vivo --
; match exacto (variation 0) contra una captura real y sin ningun falso positivo hasta
; variation 80 contra 11 capturas de otras pantallas.
if (!esperarNeedleSinAccion("own_donoroffer_choosecard_title", 30, 15000, "own_donoroffer_choosecard_title_native", 30)) {
    ; Red de seguridad (2026-08-19, bug real reproducido en vivo): si el popup "Choose a
    ; Card to Trade" seguia tapando la pantalla (mas lento en renderizar de lo esperado),
    ; este paso nunca iba a encontrar el titulo por mas que espere, sin importar el
    ; timeout. En vez de solo agrandar el numero a ciegas, antes de rendirse de verdad
    ; intenta cerrar el popup una vez mas (por si seguia ahi) y reintenta el chequeo.
    tapSiApareceNeedlePolling("own_donoroffer_willsend_popup", 141, 436, 3000)
    if (!esperarNeedleSinAccion("own_donoroffer_choosecard_title", 30, 15000, "own_donoroffer_choosecard_title_native", 30))
        ExitConError("no_aparecio_choosecard_paso9")
}

; Nuevo (2026-08-29): si se marco una carta como favorita en el Wishlist, aplica el filtro
; "Favorites" ANTES de elegir -- si falla en cualquier paso del filtro, cae al toque de
; siempre sin filtro (a ciegas, mismo comportamiento que ya existia).
if (g_favoritoMarcado && !seleccionarCartaPorFavoritos())
    g_favoritoMarcado := false

; Con el filtro aplicado, la unica carta visible cae en la misma posicion de siempre --
; mismo toque (48,357) sirve para ambos casos (filtrado o a ciegas). Bajar el Speed Mod a 1x
; solo cuando el filtro se aplico de verdad (a 3x, tocar la carta del Wishlist la agranda sin
; querer -- mismo motivo que el paso 0 de intentarMarcarFavoritoPorWishlist).
if (g_favoritoMarcado)
    deslizarSpeedMod("min")
tap(48, 357)
if (g_favoritoMarcado)
    deslizarSpeedMod("max")
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
