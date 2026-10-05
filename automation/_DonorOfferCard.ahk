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
; 5to arg opcional (2026-10-04, Friend Trade): modo extra antes del outputFile -- "AMIGO" = esperar
; a que el amigo acepte la solicitud (puntito rojo en Friends) antes de ofrecer; "AMIGO_YA" = ya
; eran amigos, no hay nada que esperar. Uso: ... "<imagen>" "AMIGO" "<outputFile>"
global g_modoExtra := ""
if (A_Args.Length() >= 5) {
    global g_rutaImagenReferencia := A_Args[3]
    g_modoExtra := A_Args[4]
    global g_outputFile := A_Args[5]
} else if (A_Args.Length() >= 4) {
    global g_rutaImagenReferencia := A_Args[3]
    global g_outputFile := A_Args[4]
} else {
    global g_rutaImagenReferencia := ""
    global g_outputFile := A_Args[3]
}

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
; mecanismo que _SpeedMod.ahk / _WaitWelcomeScreens*.ahk -- ver comentario completo en
; esperarNeedleYTap mas abajo). No fatal si no se encuentra -- este script sigue funcionando
; 100% por ADB como siempre, el chequeo rapido simplemente no se usa en ese caso.
global g_hwndFast := WinExist(g_winTitle . " ahk_class Qt5156QWindowIcon")

; Re-resolucion del handle (2026-09-23): igual que en _WaitWelcomeScreens*.ahk y
; _DonorRespondAndFinalize.ahk. Se resolvia UNA sola vez arriba; si la ventana no existia en ese
; instante o se recreo despues, capturarVentana devuelve 0 para siempre y TODA la comparacion de
; arte (que es lo unico que decide el match del Wishlist) queda ciega sin decir nada.
asegurarHwndFast() {
    global g_hwndFast, g_winTitle
    if (!g_hwndFast || !DllCall("IsWindow", "Ptr", g_hwndFast))
        g_hwndFast := WinExist(g_winTitle . " ahk_class Qt5156QWindowIcon")
    return g_hwndFast
}

; Fuerza el tamaño nativo esperado (283x532) apenas arranca (2026-09-04, bug real
; reproducido en vivo -- "no_aparecio_trade_landing_paso6"): _SendFriendRequest.ahk (el
; script que corre justo ANTES en el pipeline) restaura la ventana a su tamaño ORIGINAL
; (grande) al terminar (ver RestoreMuMuWindow ahi) -- pero este script nunca vuelve a
; achicarla, asi que arranca corriendo TODOS sus chequeos nativos (capturarVentana,
; calibrados contra ~275x528) contra una ventana mas grande, haciendolos fallar en
; silencio uno por uno (el peor caso: el popup de "trade terminated", que solo usa el
; camino nativo sin respaldo por ADB, nunca se cierra y tapa el boton del paso siguiente
; para siempre). Mismo WinMove que ya usa _SendFriendRequest.ahk en su propio arranque.
if (g_hwndFast) {
    WinGetPos, , , wFastActual, hFastActual, ahk_id %g_hwndFast%
    if (wFastActual != 283 || hFastActual != 532) {
        WinMove, ahk_id %g_hwndFast%, , , , 283, 532
        Sleep, 200
    }
}

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
    ; Guarda y restaura tambien la POSICION del cursor, no solo el foco de ventana (2026-09-03,
    ; a pedido explicito del usuario -- "no me gustaria hacer un click falso por accidente" tras
    ; ver el cursor real moverse solo mientras el usaba la PC en otra cosa): antes el cursor se
    ; quedaba donde clickeo, visible moviendose solo por la pantalla del usuario. Restaurar la
    ; posicion despues NO elimina el riesgo de que un click manual del usuario se cruce con este
    ; en el instante exacto (siguen compartiendo el mismo cursor fisico) -- pero al menos no deja
    ; el mouse desplazado el resto del tiempo, reduciendo la ventana real de conflicto a los
    ; ~100-200ms que dura el propio MouseClick.
    hwndAnterior := WinExist("A")
    CoordMode, Mouse, Screen
    MouseGetPos, xAnterior, yAnterior
    WinActivate, ahk_id %g_hwndFast%
    WinWaitActive, ahk_id %g_hwndFast%, , 2
    VarSetCapacity(pt, 8, 0)
    NumPut(nativeX, pt, 0, "int")
    NumPut(nativeY, pt, 4, "int")
    DllCall("ClientToScreen", "ptr", g_hwndFast, "ptr", &pt)
    screenX := NumGet(pt, 0, "int")
    screenY := NumGet(pt, 4, "int")
    MouseClick, Left, %screenX%, %screenY%, 1, 0
    MouseMove, %xAnterior%, %yAnterior%, 0
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
            ; Mismo asentamiento que el camino rapido de arriba (2026-09-04, bug real
            ; reproducido en vivo -- "no_aparecio_x_extra_paso3": el toque del paso2 (Cancel/OK
            ; de Friend ID Search) caia sobre la coordenada correcta pero no registraba, dejando
            ; el dialogo abierto para siempre -- mismo patron de bug ya encontrado y arreglado
            ; hoy en _MainAcceptFriendRequest.ahk (2 veces). Esta funcion generica se usa en casi
            ; todos los pasos de este script, asi que este fix cubre todos los call sites de una.
            Sleep, 900
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
        ; Subido de 400 a 900ms (2026-09-04, misma falla reproducida en vivo de nuevo -- 400ms
        ; no alcanzaba consistente, 900ms es el valor que probo funcionar en todo el resto del
        ; pipeline hoy).
        if (chequeoRapidoNeedle("own_donoroffer_trade_icon_native", 30) || chequeoRapidoNeedle("own_donoroffer_notradeagreement_badge_native", 30)) {
            Sleep, 900
            tap(207, 421)
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
                    encontrado := (buscarNeedleZonal(pBitmap, pNeedle, vPos, 30, "own_donoroffer_trade_icon") = 1)
                }
                Gdip_DisposeImage(pBitmap)
            }
        }
        if (encontrado) {
            Sleep, 900
            tap(207, 421)
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
; Confirmado con el engranaje (2026-09-28, pedido de Ale): antes era un toque a ciegas en el
; dragoncito; si ese toque no abria el panel, el deslizamiento caia sobre el juego y la velocidad
; no cambiaba sin que nadie se enterara. Ahora se toca hasta ver el engranaje del panel abierto
; (hasta 3 intentos). Si nunca se abre, no se desliza nada y se deja constancia en el log.
engranajeSpeedModVisible() {
    return chequeoRapidoNeedle("own_speedmod_panel_gear_native", 30)
}

deslizarSpeedMod(direccion) {
    global adbPath, puerto
    abierto := false
    Loop, 3 {
        tap(18, 109, 0)
        t := A_TickCount
        while (A_TickCount - t < 2000) {
            if (engranajeSpeedModVisible()) {
                abierto := true
                break
            }
            Sleep, 150
        }
        if (abierto)
            break
    }
    if (!abierto) {
        logDebugWishlist("speed mod: el panel no se abrio tras 3 toques, NO se cambio la velocidad (" . direccion . ")")
        return false
    }
    Sleep, 400
    if (direccion = "min")
        RunWait, %ComSpec% /c ""%adbPath%" -s 127.0.0.1:%puerto% shell input swipe 363 248 33 248 600", , Hide
    else
        RunWait, %ComSpec% /c ""%adbPath%" -s 127.0.0.1:%puerto% shell input swipe 33 248 363 248 600", , Hide
    Sleep, 1000
    Loop, 3 {
        tap(171, 285, 400)  ; minimizar panel
        if (!engranajeSpeedModVisible())
            break
    }
    logDebugWishlist("speed mod: velocidad cambiada a " . direccion)
    return true
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
        if (buscarNeedleZonal(pBitmap, pNeedle, vPos, variationNativo, nombreNeedleNativo) = 1) {
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
; RETIRADO 2026-09-27 a pedido de Ale: el popup de emblema salia cuando un swipe corto se leia
; como toque, y eso ya se soluciono (velocidad a 1x antes del perfil). La funcion queda vacia para
; no tocar los lugares que la llaman.
; Reusada 2026-09-27 (con Ale, "a un amigo tambien le pasaba"): ahora cierra la pantalla de
; "Player's Featured" (las cartas destacadas del perfil), que se abre si un deslizamiento en el
; perfil se lee como toque justo sobre esa seccion. Ahi no existe el corazon de la wishlist y la
; donante se quedaba trabada. Needle: el icono del ojo tachado de "Hide Buttons" (sin letras;
; la X de abajo no sirve para reconocerla porque es igual a la de la carta abierta). Se cierra
; con la X de abajo. Se llama despues de CADA deslizamiento, igual que antes.
cerrarEmblemPopupSiAparece() {
    if (chequeoRapidoNeedle("own_donoroffer_featured_hide_native", 30)) {
        logDebugWishlist("pantalla Player's Featured abierta por error, tocando X")
        tap(138, 500, 800)
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
; Needle de respaldo por ADB (2026-09-03, bug real reproducido en vivo con Ale: la estrella de
; favorito NO existe en absoluto en una carta que Main no tiene ("Not obtained") -- confirmado
; comparando capturas reales, Repel (que si tiene) muestra estrella+corazon juntos, Magikarp
; (que no tiene) SOLO muestra el corazon "Wishlist". Ningun tiempo de espera arregla esto: el
; icono de la estrella simplemente no esta ahi para tocar. El corazon "Wishlist" (boton de
; agregar ESTA carta al wishlist propio, no un indicador del wishlist de Main) SI esta siempre
; presente en la misma posicion sin importar si la carta esta obtenida o no -- validado en vivo
; con match pixel-perfecto contra las 2 capturas reales, y sin match contra "Select a Friend"
; (maxdiff 99, por encima de cualquier tolerancia razonable). Esta needle es a escala ADB
; (540x960, recortada de un screenshot real), no nativa -- por eso usa AdbScreenshot en vez de
; chequeoRapidoNeedle/capturarVentana.
chequeoCorazonWishlistPorAdb() {
    global adbPath, puerto
    tempFile := A_ScriptDir . "\Logs\_donoroffer_openconfirm_check.png"
    AdbScreenshot(adbPath, puerto, tempFile)
    if (!FileExist(tempFile))
        return false
    encontrado := false
    try {
        pBitmap := Gdip_CreateBitmapFromFile(tempFile)
        pNeedle := Gdip_CreateBitmapFromFile(A_ScriptDir . "\Needles\own_donoroffer_wishlistcard_wishlistbtn_adb.png")
        if (pNeedle) {
            vPos := ""
            encontrado := (buscarNeedleZonal(pBitmap, pNeedle, vPos, 30, "own_donoroffer_wishlistcard_wishlistbtn_adb") = 1)
        }
        Gdip_DisposeImage(pBitmap)
    } catch e {
    }
    FileDelete, %tempFile%
    return encontrado
}

esperarAperturaCartaConfirmada(timeoutMs) {
    inicio := A_TickCount
    Loop {
        if (chequeoRapidoNeedle("own_donoroffer_userprofile_favoritestar_native", 60) || chequeoRapidoNeedle("own_donoroffer_userprofile_favoritestar_marked_native", 60))
            return true
        if (chequeoCorazonWishlistPorAdb())
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
; Reescrito para priorizar el boton Atras de Android (2026-09-03, a pedido explicito del
; usuario: "debio ir al menu principal y presionar trade" -- en vez de depender de encontrar
; un boton X puntual desde una posicion de scroll que puede variar, el boton Atras de Android
; sube un nivel en la pila de navegacion sin importar donde este el scroll, mucho mas directo
; y confiable que buscar+tocar un needle. Confirmado que AdbKeyBack ya se usa en este mismo
; archivo (recuperacion de "vista sin controles" de la estrella) -- mismo mecanismo, ya
; probado. Se manda Atras 2 veces (carta ampliada, si sigue abierta, + perfil) y se confirma
; que de verdad volvimos a "Select a Friend" antes de devolver el control -- si por algun
; motivo no alcanza, cae al metodo viejo (buscar+tocar el boton X) como respaldo.
cerrarPerfilSiEstaAbierto() {
    global adbPath, puerto, g_modoDesmarcar
    if (g_modoDesmarcar)   ; tras desmarcar se apaga la instancia, no hay que volver a ningun lado
        return
    ; Reescrito con mas margen de asentamiento (2026-09-03, bug real reproducido en vivo con
    ; Ale: "le dio doble click al X y no entro en trade del perfil del usuario" -- el chequeo
    ; anterior esperaba solo 700ms fijos antes de decidir si hacia falta un SEGUNDO Atras,
    ; insuficiente bajo carga real -- terminaba mandando un Atras de mas y se pasaba de largo
    ; "Select a Friend" hasta la pantalla generica de Trade (un nivel mas atras de lo debido,
    ; sin forma de "avanzar" de nuevo con el boton Atras). Ahora cada intento hace un POLL real
    ; (hasta 2.5s, revisando cada 300ms) antes de decidir si hace falta otro Atras, en vez de
    ; una espera fija corta -- si la pantalla ya llego, nunca dispara un segundo toque de mas.
    ;
    ; Reescrito otra vez (2026-09-23) con DOS cambios, tras el tercer
    ; "no_aparecio_selectfriend_paso7b" real en vivo con Ale (corrida de las 08:54):
    ;   1) LOG. Esta rutina no escribia una sola linea -- el log saltaba de "carta 3/3" a "FIN"
    ;      con 35 segundos mudos, y por eso las dos correcciones anteriores fueron a ciegas
    ;      ("subir de 3 a 6 swipes"), sin saber nunca cual de las tacticas fallaba.
    ;   2) Reintento estilo Kevin: en vez de 3 Atras contados y despues 6 swipes contados, se
    ;      alternan las tacticas hasta que aparece la pantalla SIGUIENTE ("Select a Friend"),
    ;      con techo de 45s. Y despues de tocar la X se CONFIRMA que llegamos, en vez de
    ;      devolver el control dando por hecho que funciono (eso era lo que dejaba la instancia
    ;      colgada adentro del perfil y hacia fallar el paso siguiente).
    asegurarHwndFast()
    if (chequeoRapidoNeedle("own_donoroffer_selectfriend_trade_native", 30)) {
        logDebugWishlist("cerrarPerfil: ya estabamos en Select a Friend, no hay nada que cerrar")
        return
    }
    inicioTotal := A_TickCount
    sobrepasado := false
    vuelta := 0
    Loop {
        vuelta++
        if (sobrepasado)
            break
        AdbKeyBack(adbPath, puerto)
        logDebugWishlist("cerrarPerfil: vuelta " . vuelta . " -- Atras enviado")
        inicioEspera := A_TickCount
        Loop {
            if (chequeoRapidoNeedle("own_donoroffer_selectfriend_trade_native", 30)) {
                ; Doble confirmacion (2026-09-23, bug real medido en vivo con Ale, corrida de las
                ; 22:09): "vuelta 2 -- Atras enviado" a las .787 y "OK por Atras" a las .868, 80ms
                ; despues. El PRIMER Atras ya habia llegado a Select a Friend pero tardo mas de
                ; los 2.5s del poll en renderizar, asi que se mando un SEGUNDO Atras; justo
                ; despues se detecto la pantalla del primero, con el segundo ya en camino -- y ese
                ; segundo llevo la instancia un nivel mas atras, al Trade genrico. El script
                ; siguio creyendo que estaba en Select a Friend y nadie toco "Trade".
                ; Se reconfirma despues de 900ms: si el Atras de mas ya se aplico, no matchea y
                ; seguimos al respaldo del boton X en vez de devolver el control a ciegas.
                Sleep, 900
                if (chequeoRapidoNeedle("own_donoroffer_selectfriend_trade_native", 30)) {
                    logDebugWishlist("cerrarPerfil: OK por Atras (vuelta " . vuelta . ")")
                    return
                }
                logDebugWishlist("cerrarPerfil: vuelta " . vuelta . " -- parecia Select a Friend pero se paso de largo")
                sobrepasado := true
                break
            }
            ; Chequeo de sobrepaso (2026-09-03): si el Atras ya paso "Select a Friend" de largo
            ; y llego a la pantalla generica de Trade (own_maintrade_trade_button_native, sin
            ; ningun amigo en pantalla), un Atras MAS solo empeoraria las cosas (seguiria
            ; subiendo hacia Social Hub) -- se corta ahi mismo y se cae al respaldo de abajo en
            ; vez de insistir a ciegas.
            if (chequeoRapidoNeedle("own_maintrade_trade_button_native", 30)) {
                logDebugWishlist("cerrarPerfil: OJO -- el Atras se paso de largo hasta Trade generico, se deja de mandar Atras")
                sobrepasado := true
                break
            }
            if (A_TickCount - inicioEspera > 2500)
                break
            Sleep, 300
        }
        if (A_TickCount - inicioTotal > 20000) {
            logDebugWishlist("cerrarPerfil: 20s de Atras sin resultado, se pasa al boton X")
            break
        }
    }
    ; Recuperacion por ADELANTE cuando el Atras se paso de largo (2026-09-23, medido en vivo con
    ; Ale en la corrida de las 23:39): el log mostro la cadena completa -- vuelta 2 detecto el
    ; sobrepaso, pero igual se mando una vuelta 3 de Atras que llevo hasta el Trade generico, y
    ; de ahi las 7 vueltas buscando la X eran imposibles porque ya no habia ningun perfil abierto.
    ; El comentario original de este bloque ya lo anticipaba: pasado "Select a Friend" no hay
    ; forma de volver con Atras. Pero SI se puede avanzar: desde el Trade generico, tocar el
    ; boton Trade devuelve justo a "Select a Friend". Misma coordenada que usa paso6.
    if (sobrepasado) {
        Loop, 3 {
            logDebugWishlist("cerrarPerfil: sobrepasado -- avanzando con el boton Trade (intento " . A_Index . ")")
            tap(139, 427, 1200)
            if (esperarChequeoRapido("own_donoroffer_selectfriend_trade_native", 30, 3000)) {
                logDebugWishlist("cerrarPerfil: OK, se recupero avanzando desde el Trade generico")
                return
            }
        }
        logDebugWishlist("cerrarPerfil: no se pudo recuperar avanzando, se prueba el boton X")
    }

    ; Respaldo (busca+toca el boton X). Ahora se reintenta hasta llegar a "Select a Friend" en
    ; vez de tocar una vez y devolver el control a ciegas, y cada tactica queda logueada.
    inicioX := A_TickCount
    vueltaX := 0
    Loop {
        vueltaX++
        if (esperarChequeoRapido("own_donoroffer_userprofile_close_x_native", 60, 2000)) {
            logDebugWishlist("cerrarPerfil: vuelta X " . vueltaX . " -- X encontrada, tocando (140,500)")
            tap(140, 500, 1000)
            if (esperarChequeoRapido("own_donoroffer_selectfriend_trade_native", 30, 2500)) {
                logDebugWishlist("cerrarPerfil: OK por boton X (vuelta X " . vueltaX . ")")
                return
            }
            logDebugWishlist("cerrarPerfil: se toco la X pero NO aparecio Select a Friend")
        } else {
            logDebugWishlist("cerrarPerfil: vuelta X " . vueltaX . " -- X no visible, subiendo el scroll")
            swipeLogico(250, 200, 450, 600)  ; y1 100 -> 200 (2026-09-23, ver nota de la cortina de notificaciones)
            Sleep, 600
        }
        if (A_TickCount - inicioX > 25000) {
            ; Captura del estado atascado (2026-09-23): tras la corrida de las 20:42 sabemos que
            ; 8 Atras no hacen nada y la X no aparece en ninguna posicion de scroll -- o sea que
            ; la pantalla NO es el perfil que este codigo asume. Sin ver esa pantalla no se puede
            ; arreglar, y se borra sola en cada corrida, asi que se guarda con nombre propio.
            AdbScreenshot(adbPath, puerto, A_ScriptDir . "\Logs\_cerrarperfil_atascado.png")
            logDebugWishlist("cerrarPerfil: SE AGOTO el tiempo sin poder volver a Select a Friend -- captura guardada en Logs\_cerrarperfil_atascado.png")
            return
        }
    }
    ; Cortina de notificaciones (2026-09-23, bug real reproducido en vivo con Ale -- "el juego se
    ; cerro wtf"): el juego NO se habia cerrado. Medido en el momento, pidof devolvia 3132 (proceso
    ; vivo) pero mCurrentFocus era "NotificationShade" -- la cortina de Android tapando el juego.
    ; La causa es este swipe: swipeLogico(250, 100, ...) arrancaba en device y=118, dentro de la
    ; zona de la barra de estado, y un arrastre hacia abajo desde ahi es exactamente el gesto que
    ; abre las notificaciones. Subido el arranque a y=200 logico (device y=315), bien lejos del
    ; borde, conservando 492px de recorrido -- suficiente para el scroll que se busca.
    ; Nota historica (el bucle de 6 swipes contados que habia aca quedo absorbido por el bucle
    ; de arriba): el boton X no es visible desde cualquier posicion de scroll -- si el swipe
    ; hacia el Wishlist quedo mas abajo de lo esperado, primero hay que subir de nuevo antes de
    ; encontrarlo (confirmado en vivo: needle en 0 desde la vista de "Achievements"). El arranque
    ; del swipe es y=100 y no 36 (2026-08-30, bug real): con offset=40, y=36 da una coordenada de
    ; dispositivo NEGATIVA ((36-40)*960/488 ≈ -8), el swipe arrancaba fuera del area tocable y
    ; nunca scrolleaba, dejando la pantalla pegada en "Achievements" para siempre.
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
compararArteCartas(pBitmapVivo, rectVivo, pBitmapReferencia, rectReferencia, grilla := 8, tolerancia := 45, ByRef promedioOut := "") {
    promedioOut := -1
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
    promedioOut := promedio
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

; Espera a que la carta del carrusel TERMINE de asentarse antes de medirla (2026-09-18, bug
; real reproducido en vivo con Ale y confirmado con capturas del carrusel en pleno movimiento:
; el comparador medía mientras la carta seguía deslizándose -- una captura mostraba a Magmar
; saliendo por la izquierda e Igglybuff entrando por la derecha en el MISMO frame, y la
; siguiente mostraba a Igglybuff todavía corrida, sin centrar. Con la carta fuera de su
; posición final, el rect del arte agarra la parte equivocada y nunca puede matchear, aunque
; la carta pedida esté ahí. Eso explica los `matchea=0` en las 3 cartas pese a que la carta
; SI estaba en el wishlist).
; En vez de confiar en un Sleep fijo (900ms, insuficiente cuando la animacion rebota o el PC
; está cargado), toma 2 capturas separadas y las compara ENTRE SI sobre el mismo rect del
; arte: cuando dos capturas seguidas son practicamente identicas, la animacion ya termino.
; Mismo criterio de "verificar en vez de confiar en un timing fijo" que el resto del pipeline.
esperarPantallaQuieta(timeoutMs := 3000) {
    global g_hwndFast
    inicio := A_TickCount
    rectArte := {x: 30, y: 140, w: 215, h: 122}
    Loop {
        pA := capturarVentana(g_hwndFast)
        Sleep, 250
        pB := capturarVentana(g_hwndFast)
        quieta := false
        if (pA && pB)
            quieta := compararArteCartas(pB, rectArte, pA, rectArte, 8, 3)
        if (pA)
            Gdip_DisposeImage(pA)
        if (pB)
            Gdip_DisposeImage(pB)
        if (quieta)
            return true
        if (A_TickCount - inicio > timeoutMs)
            return false
    }
}

; Funcion principal nueva -- ver comentario del bloque completo arriba. Devuelve true si
; encontro y dejo marcada una coincidencia en el Wishlist de Main, false en cualquier otro
; caso (el llamador debe seguir con el metodo viejo a ciegas, SIN cortar el trade).
; Corazon de "View Wishlist" buscado en captura ADB (2026-09-28, bug real en vivo con Ale: en 2
; corridas los 8 deslizamientos dieron "no match" aunque el corazon paso por la pantalla -- la foto
; lo muestra arriba de todo). La captura nativa esta reducida a la mitad; el trazo del corazon mide
; 1 px y, segun en que posicion exacta quede el scroll, se dibuja distinto y la needle nativa solo
; coincidia en algunas posiciones. A 540x960 el trazo se ve siempre igual. Devuelve el CENTRO del
; corazon en coordenadas ADB.
chequeoCorazonPorAdb(ByRef outX, ByRef outY) {
    global adbPath, puerto, g_winTitle
    tempFile := A_ScriptDir . "\Logs\_donoroffer_corazon_check_" . g_winTitle . ".png"
    AdbScreenshot(adbPath, puerto, tempFile)
    if (!FileExist(tempFile))
        return false
    encontrado := false
    try {
        pBitmap := Gdip_CreateBitmapFromFile(tempFile)
        ; 3 versiones del corazon (2026-09-29, bug real en vivo con Ale: el corazon estaba a la
        ; vista y no se reconocio). Aun en la captura ADB, el juego dibuja el trazo del corazon
        ; corrido menos de 1 px segun donde quede el scroll, y los bordes cambian hasta 100 de
        ; tono. Con una sola version y tolerancia 40, en algunas posiciones no coincidia nunca.
        ; A = la de siempre, B = la otra "fase" (recortada de la foto del fallo), C = intermedia.
        ; Tolerancia 55: medido, B da 0 y C da 50 sobre el corazon; fuera del corazon, lo mas
        ; parecido de toda la pantalla da 78 o mas con cualquiera de las tres.
        if (pBitmap) {
            for _, sufijo in ["", "_b", "_c"] {
                pNeedle := Gdip_CreateBitmapFromFile(A_ScriptDir . "\Needles\own_donoroffer_wishlist_heart_adb" . sufijo . ".png")
                if (!pNeedle)
                    continue
                vPos := ""
                ; misma zona para las 3 (se busca por el nombre base)
                hallado := (buscarNeedleZonal(pBitmap, pNeedle, vPos, 55, "own_donoroffer_wishlist_heart_adb") = 1)
                Gdip_DisposeImage(pNeedle)
                if (hallado) {
                    partes := StrSplit(vPos, ",")
                    outX := partes[1] + 12
                    outY := partes[2] + 11
                    encontrado := true
                    break
                }
            }
        }
        if (pBitmap)
            Gdip_DisposeImage(pBitmap)
    } catch e {
    }
    FileDelete, %tempFile%
    return encontrado
}

; Busca el corazon y, si quedo tan arriba que la fila de cartas de la wishlist esta cortada,
; retrocede un poco el scroll y lo vuelve a buscar (en la foto del fallo el corazon quedo en
; Y ADB 121 con las cartas casi fuera de la pantalla).
buscarCorazonWishlist(ByRef outX, ByRef outY) {
    if (!chequeoCorazonPorAdb(outX, outY))
        return false
    Loop, 3 {
        if (outY >= 230)
            return true
        logDebugWishlist("corazon muy arriba (Y ADB=" . outY . "), retrocediendo un poco el scroll")
        swipeLogico(250, 280, 350, 500)
        esperarPantallaQuieta(2500)
        if (!chequeoCorazonPorAdb(outX, outY))
            return false
    }
    return (outY >= 230)
}

; --- Esperar a que el AMIGO acepte la solicitud (2026-10-04, diseño de Ale del 30/09) ---
; Para Friend Trade / Share to Friend: la donante manda la solicitud, vuelve a Comunidad y toca la
; pestaña de abajo (tres personas) cada pocos segundos para que se actualice. Cuando el amigo acepta,
; el boton "Friends" (abajo a la izquierda) muestra un puntito rojo. Tope 15 minutos.
; El puntito se detecta por COLOR, sin needle ni texto: los puntos del juego son rosado-rojo (medidos
; 230,94,137 y 251,82,204). En la zona del boton Friends, sin punto, hay 0 pixeles de ese color en
; Social Hub (ingles) y Comunidad (español). Zona nativa (0,426)-(77,488) = ADB (0,760)-(150,880).
puntoRojoEnAmigos(ByRef cantidadOut := "") {
    global g_hwndFast
    cantidadOut := 0
    asegurarHwndFast()
    pBitmap := capturarVentana(g_hwndFast)
    if (!pBitmap)
        return false
    Gdip_GetImageDimensions(pBitmap, ancho, alto)
    sx := ancho / 275, sy := alto / 528
    ; Zona ajustada con una captura REAL con punto (2026-10-04): el punto cae en nativo (49-52,450-451),
    ; arriba a la derecha del boton Friends, y a esta escala mide ~6 px.
    y := Round(436 * sy), yFin := Round(466 * sy), xFin := Round(70 * sx)
    while (y <= yFin) {
        x := Round(30 * sx)
        while (x <= xFin) {
            c := Gdip_GetPixel(pBitmap, x, y)
            r := (c >> 16) & 0xFF, g := (c >> 8) & 0xFF, b := c & 0xFF
            if (r > 180 && g < 120 && r - b > 30)
                cantidadOut++
            x++
        }
        y++
    }
    Gdip_DisposeImage(pBitmap)
    return (cantidadOut >= 3)
}

esperarAmigoAcepte(timeoutMs) {
    global adbPath, puerto, g_winTitle
    inicio := A_TickCount
    ultimoTapComunidad := 0
    ultimoLog := A_TickCount
    vistoSeguido := 0
    logDebugWishlist("AMIGO: esperando que el amigo acepte la solicitud (tope " . Round(timeoutMs / 60000) . " min)")
    Loop {
        if (puntoRojoEnAmigos(cantidad)) {
            vistoSeguido++
            if (vistoSeguido >= 2) {   ; dos capturas seguidas, para no confundirse con un destello
                logDebugWishlist("AMIGO: puntito rojo en Friends (" . cantidad . " px) -- el amigo acepto")
                AdbScreenshot(adbPath, puerto, A_ScriptDir . "\Logs\_amigo_acepto_" . g_winTitle . ".png")
                return true
            }
        } else {
            vistoSeguido := 0
        }
        if (A_TickCount - inicio > timeoutMs) {
            logDebugWishlist("AMIGO: FALLO -- " . Round(timeoutMs / 60000) . " min sin que el amigo acepte")
            AdbScreenshot(adbPath, puerto, A_ScriptDir . "\Logs\_amigo_no_acepto_" . g_winTitle . ".png")
            return false
        }
        if (A_TickCount - ultimoTapComunidad >= 4000) {
            tap(141, 511)   ; pestaña de abajo (tres personas): recarga Comunidad
            ultimoTapComunidad := A_TickCount
        }
        if (A_TickCount - ultimoLog >= 60000) {
            logDebugWishlist("AMIGO: sigue esperando (" . Round((A_TickCount - inicio) / 60000) . " min)")
            ultimoLog := A_TickCount
        }
        Sleep, 700
    }
}

; --- Share (2026-10-04) ---
; Vista previa "Share Partner": misma carta grande que la de Trade pero 22 px mas arriba (medido en
; la captura real: borde superior en y=186 ADB contra 229 en Trade). Mismo recuadro proporcional del
; dibujo que la wishlist (0.20, 0.16, 0.60, 0.22) y misma tolerancia 9: la correcta da 2-3 y la
; incorrecta mas parecida 22+ (medido en Trade con estas mismas proporciones).
cartaSharePreviewEsLaPedida(ByRef diffOut) {
    global g_hwndFast, g_rutaImagenReferencia
    diffOut := -1
    asegurarHwndFast()
    esperarPantallaQuieta(3000)
    pRef := Gdip_CreateBitmapFromFile(g_rutaImagenReferencia)
    if (!pRef)
        return false
    pVivo := capturarVentana(g_hwndFast)
    matchea := false
    if (pVivo) {
        rectVivo := {x: 88, y: 171, w: 99, h: 51}
        Gdip_GetImageDimensions(pRef, anchoRef, altoRef)
        rectRef := {x: Round(anchoRef * 0.20), y: Round(altoRef * 0.16), w: Round(anchoRef * 0.60), h: Round(altoRef * 0.22)}
        matchea := compararArteCartas(pVivo, rectVivo, pRef, rectRef, 8, 9, diffOut)
        Gdip_DisposeImage(pVivo)
    }
    Gdip_DisposeImage(pRef)
    return matchea
}

flujoShare() {
    global adbPath, puerto, g_outputFile, g_rutaImagenReferencia, g_modoDesmarcar, g_bajarVelocidadEnPerfil, g_favoritoMarcado
    ; S1: tile Share de Comunidad -> pantalla Share (needle: icono verde de dos personas, sin texto)
    logDebugWishlist("share1: tocando el tile Share")
    if (!tocarHastaVerNeedle(73, 410, "own_share_landing_native", 40, 2500, 20000))
        ExitConError("no_aparecio_pantalla_share")
    ; S2: boton azul Share -> "Select a Friend" (needle: lupita del avatar, la misma de Trade)
    logDebugWishlist("share2: tocando el boton Share")
    if (!tocarHastaVerNeedle(141, 421, "own_donoroffer_selectfriend_trade_native", 30, 2500, 15000))
        ExitConError("no_aparecio_selectfriend_share")
    ; S3: wishlist de Main -> estrella dorada en la carta pedida (misma funcion que Main Trade)
    g_favoritoMarcado := intentarMarcarFavoritoPorWishlist(g_rutaImagenReferencia)
    if (!g_favoritoMarcado) {
        logDebugWishlist("share3: CORTE -- no se marco la carta pedida, no se comparte nada")
        cerrarPerfilSiEstaAbierto()
        ExitConError("wishlist_no_se_marco_carta")
    }
    ; S4: boton Share del amigo -> lista de cartas -> lupa -> Favorites -> OK
    if (!esperarNeedleSinAccion("own_donoroffer_selectfriend_trade", 30, 15000, "own_donoroffer_selectfriend_trade_native", 30))
        ExitConError("no_volvio_a_selectfriend_share")
    logDebugWishlist("share4: tocando Share del amigo")
    Sleep, 900
    tap(213, 179)
    Sleep, 2500
    if (!seleccionarCartaPorFavoritos()) {
        logDebugWishlist("share4: CORTE -- el filtro de favoritos fallo, no se comparte nada")
        ExitConError("filtro_favoritos_fallo")
    }
    ; S5: tocar la carta (unica tras el filtro), cerrar el zoom si se abrio, OK
    tap(48, 357)
    Sleep, 600
    Loop, 2 {
        tap(150, 60)
        Sleep, 500
    }
    Sleep, 900
    tap(145, 458)
    ; S6: vista previa "Share Partner": comprobar que es la carta pedida ANTES de compartir (Share no
    ; tiene vuelta atras ni respuesta del otro lado como Trade)
    Sleep, 2500
    diffShare := -1
    if (!cartaSharePreviewEsLaPedida(diffShare)) {
        logDebugWishlist("share6: CORTE -- la carta de la vista previa NO es la pedida (diff=" . Round(diffShare, 1) . ", umbral 9)")
        AdbScreenshot(adbPath, puerto, A_ScriptDir . "\Logs\_share_carta_distinta.png")
        ExitConError("share_carta_no_coincide")
    }
    logDebugWishlist("share6: carta confirmada (diff=" . Round(diffShare, 1) . "), foto y Share")
    AdbScreenshot(adbPath, puerto, StrReplace(g_outputFile, ".txt", "_SharePhoto.png"))
    Sleep, 600
    tap(141, 458)
    ; S7: popup "Are you sure...?" -> OK, reintentando hasta que salga la pantalla del swipe
    Sleep, 1500
    inicioOk := A_TickCount
    ultimoOk := 0
    Loop {
        if (chequeoRapidoNeedle("own_donorfinalize_swipe_instruction_native", 30))
            break
        if (A_TickCount - inicioOk > 15000)
            ExitConError("no_aparecio_swipe_share")
        if (A_TickCount - ultimoOk >= 2500) {
            tap(203, 364)
            ultimoOk := A_TickCount
        }
        Sleep, 300
    }
    ; S8: bajar a 1x (despues de la wishlist la donante volvio a 3x) y swipe, igual que en Trade
    deslizarSpeedMod("min")
    Sleep, 800
    AdbScreenshot(adbPath, puerto, StrReplace(g_outputFile, ".txt", "_ShareSwipePhoto.png"))
    Loop, 3 {
        AdbSwipePropio(adbPath, puerto, 274, 702, 230, 150)
        Sleep, 3000
        if (!chequeoRapidoNeedle("own_donorfinalize_swipe_instruction_native", 30))
            break
        logDebugWishlist("share8: el swipe no entro, reintento " . A_Index)
    }
    inicioVuelta := A_TickCount
    while (A_TickCount - inicioVuelta < 15000 && !chequeoRapidoNeedle("own_share_landing_native", 40))
        Sleep, 300
    Sleep, 1200
    AdbScreenshot(adbPath, puerto, StrReplace(g_outputFile, ".txt", "_ShareSentPhoto.png"))
    logDebugWishlist("share8: carta compartida")
    ; S9: desmarcar por Friends (Share no tiene "Send a thanks?"). Ya esta en 1x. Si falla, la carta
    ; igual quedo compartida: no se corta el resultado.
    g_modoDesmarcar := true
    g_bajarVelocidadEnPerfil := false
    if (llegarAlPerfilDespuesDelTradeo())
        intentarMarcarFavoritoPorWishlist("")
    else
        logDebugWishlist("share9: no se llego al perfil para desmarcar")
}

; Del "Got it!" al perfil de Main (2026-10-01, mapeado en vivo con Ale en la instancia 1). Estilo
; Kevin: en cada vuelta se mira que pantalla hay y se toca lo que toca, cada 2 s como minimo.
; Pantallas, en orden (las del medio solo salen a veces):
;   "Got it!"                -> Tap to Proceed (152,486)
;   registrar en el dex      -> >| (254,500)        [needle Skip de Kevin]
;   dex de la expansion      -> Next (141,478)      [needle Next de Kevin, la pokebola]
;   "Items acquired"         -> OK (141,420)        [needle de Kevin, borde izquierdo del dialogo]
;   "Send a thanks?"         -> portada del perfil (141,203) -> abre el perfil de Main
; "Grand total cards acquired" pasa sola. Cualquier pantalla sin needle propio recibe el toque
; de la portada: en "Send a thanks?" abre el perfil y en las demas cae en un lugar vacio.
llegarAlPerfilDespuesDelTradeo() {
    global adbPath, puerto, g_bajarVelocidadEnPerfil
    asegurarHwndFast()
    inicio := A_TickCount
    ultimoTap := 0
    ; El "Got it!" YA NO se busca (2026-10-04, segunda vez en vivo con Ale): su needle (el fondo lila)
    ; coincide con "Send a thanks?" y su toque (152,486) cae justo sobre la X de ese popup -- lo
    ; cerraba. _DonorRespondAndFinalize ya toco "Tap to Proceed"; si quedara, la portada tambien avanza.
    vacias := 0
    Loop {
        if (chequeoRapidoNeedle("own_donoroffer_userprofile_battlerecord_native", 60)) {
            logDebugWishlist("DESMARCAR: perfil de Main abierto")
            return true
        }
        if (A_TickCount - inicio > 45000) {
            logDebugWishlist("DESMARCAR: FALLO -- 45 s sin llegar al perfil de Main")
            AdbScreenshot(adbPath, puerto, A_ScriptDir . "\Logs\_desmarcar_sin_perfil_" . g_winTitle . ".png")
            return false
        }
        if (A_TickCount - ultimoTap < 2000) {
            Sleep, 250
            continue
        }
        ; Estilo Kevin (1.ahk:4918, pantallas despues de abrir sobre) + espera a que la pantalla
        ; CAMBIE (2026-10-04, bug real en vivo con Ale): el >| se tocaba, a los 2 s el needle todavia
        ; coincidia en plena transicion y el segundo toque caia sobre una carta del dex y la abria.
        ; Ahora se exige ver la pantalla en DOS capturas seguidas antes de tocar, y despues de tocar
        ; se espera (hasta 3 s) a que ese boton desaparezca antes de mirar de nuevo.
        if (pantallaEstable("kevin_pack_skip_native", 40)) {
            logDebugWishlist("DESMARCAR: registrar en el dex, tocando >|")
            Sleep, 700   ; que el boton termine de aparecer y se pueda apretar
            tap(247, 500)
            esperarQueDesaparezca("kevin_pack_skip_native", 40, 3000)
            vacias := 0
        } else if (pantallaEstable("kevin_pack_next_native", 50)) {
            logDebugWishlist("DESMARCAR: dex, tocando Next")
            Sleep, 700
            tap(146, 489)
            esperarQueDesaparezca("kevin_pack_next_native", 50, 3000)
            vacias := 0
        } else if (pantallaEstable("kevin_getitem_dialog_native", 20)) {
            logDebugWishlist("DESMARCAR: 'Items acquired', tocando OK")
            Sleep, 700
            tap(141, 420)
            esperarQueDesaparezca("kevin_getitem_dialog_native", 20, 3000)
            vacias := 0
        } else if (pantallaEstable("own_share_landing_native", 40)) {
            ; Pantalla de Share (despues del swipe de Share, 2026-10-04): a Comunidad por la pestaña
            ; de abajo (tres personas) y de ahi a Friends.
            logDebugWishlist("DESMARCAR: en Share, tocando la pestaña de Comunidad")
            Sleep, 500
            tap(141, 511)
            esperarQueDesaparezca("own_share_landing_native", 40, 3000)
            vacias := 0
        } else if (pantallaEstable("own_friends_lista_native", 40)) {
            ; Camino por Friends (2026-10-04, Ale): Share no tiene "Send a thanks?", y en Trade sirve
            ; de plan B si ese popup se fue. Lista de amigos -> avatar del primero (la donante
            ; normalmente tiene un solo amigo: el que recibe la carta).
            logDebugWishlist("DESMARCAR: lista de Friends, tocando el avatar del amigo")
            g_bajarVelocidadEnPerfil := true   ; por Friends la donante puede venir en 3x
            Sleep, 500
            tap(54, 182)
            esperarQueDesaparezca("own_friends_lista_native", 40, 3000)
            vacias := 0
        } else if (pantallaEstable("own_mainaccept_friends_icon_native", 30)) {
            logDebugWishlist("DESMARCAR: en Comunidad, tocando Friends")
            Sleep, 500
            tap(34, 462)
            esperarQueDesaparezca("own_mainaccept_friends_icon_native", 30, 3000)
            vacias := 0
        } else {
            ; Ninguna pantalla conocida: la portada solo se toca si eso se repite 2 vueltas (no en
            ; medio de una transicion, donde podria caer sobre una carta del dex).
            vacias++
            if (vacias >= 2) {
                logDebugWishlist("DESMARCAR: tocando la portada (141,203)")
                tap(141, 203)
                vacias := 0
            }
        }
        ultimoTap := A_TickCount
    }
}

pantallaEstable(needle, variation) {
    if (!chequeoRapidoNeedle(needle, variation))
        return false
    Sleep, 300
    return chequeoRapidoNeedle(needle, variation)
}

esperarQueDesaparezca(needle, variation, timeoutMs) {
    inicio := A_TickCount
    while (A_TickCount - inicio < timeoutMs && chequeoRapidoNeedle(needle, variation))
        Sleep, 200
    if (chequeoRapidoNeedle(needle, variation)) {
        ; El toque llego pero el juego no apreto el boton (Ale, 2026-10-04): la vuelta siguiente lo
        ; ve todavia ahi y lo vuelve a tocar, en vez de seguir de largo.
        logDebugWishlist("DESMARCAR: el boton sigue ahi, el toque no entro -- se reintenta")
        return false
    }
    Sleep, 600   ; deja aparecer la pantalla siguiente
    return true
}

intentarMarcarFavoritoPorWishlist(rutaImagenReferencia) {
    global g_hwndFast, adbPath, puerto, g_modoDesmarcar, g_bajarVelocidadEnPerfil

    logDebugWishlist("INICIO -- rutaImagenReferencia=" . rutaImagenReferencia . " modoDesmarcar=" . (g_modoDesmarcar ? 1 : 0))

    ; Modo desmarcar (2026-10-01, idea de Ale): despues del tradeo se vuelve a la wishlist de Main
    ; y se apaga TODA estrella dorada, para que la proxima vez el filtro de favoritos solo muestre
    ; la carta nueva. No hay carta que comparar: cada carta cuenta como "no coincide", y la regla
    ; de siempre (no coincide + dorada -> desmarcar) hace el resto.
    pBitmapReferencia := 0
    if (!g_modoDesmarcar) {
        if (rutaImagenReferencia = "" || !FileExist(rutaImagenReferencia)) {
            logDebugWishlist("SALIDA: sin imagen de referencia o archivo no existe")
            return false
        }

        pBitmapReferencia := Gdip_CreateBitmapFromFile(rutaImagenReferencia)
        if (!pBitmapReferencia) {
            logDebugWishlist("SALIDA: Gdip_CreateBitmapFromFile devolvio 0")
            return false
        }
    }

    ; Paso 0: bajar Speed Mod a 1x ANTES de tocar el avatar (2026-08-29, RESTAURADO tras 8
    ; pruebas reales en vivo -- a 3x el swipe de acercamiento al Wishlist nunca llego a
    ; matchear en 5 intentos Y encima abrio el popup de Emblem por accidente; en las 7
    ; pruebas hechas a 1x el popup jamas aparecio). Se habia sacado antes por pedido del
    ; usuario, pero la evidencia en vivo confirma que hace falta para este mecanismo puntual.
    ; En modo desmarcar no hace falta (2026-10-04, Ale): _DonorRespondAndFinalize ya bajo la
    ; velocidad a 1x antes del swipe final, asi que la donante llega en 1x. Ahorra ~3 s.
    ; Excepcion (2026-10-04, probado en vivo): si se llego al perfil por Friends (Share o plan B),
    ; la donante puede venir en 3x y los swipes se pasaban hasta los trofeos -- ahi si se baja.
    if (!g_modoDesmarcar || g_bajarVelocidadEnPerfil) {
        logDebugWishlist("paso0: bajando speed mod a min")
        deslizarSpeedMod("min")
        logDebugWishlist("paso0: listo")
    }

    ; Paso 1: tocar avatar del amigo -- abre su perfil completo. NUNCA usar su foto/nombre
    ; real como needle de confirmacion (dato personal).
    ; En modo desmarcar el perfil ya viene abierto (se entra desde "Send a thanks?").
    if (!g_modoDesmarcar) {
        logDebugWishlist("paso1: tocando avatar (54,151)")
        tap(54, 151, 500)
        cerrarEmblemPopupSiAparece()
    }

    ; Paso 1b: esperar a que el perfil cargue de verdad (needle Battle Record) antes de
    ; swipear -- si arranca antes, un swipe puede leerse como toque y abrir un Emblem por
    ; error (bug real reproducido en vivo 2026-08-28).
    ; Estilo Kevin (2026-09-28, revision con Ale): el avatar se tocaba una sola vez. Si ese toque se
    ; perdia, se esperaban 10 s y la wishlist fallaba. Ahora, si a los 4 s el perfil no abrio y
    ; seguimos en Select a Friend (el perfil no tapa esa pantalla), se vuelve a tocar el avatar.
    battlerecordOk := false
    inicioPerfil := A_TickCount
    ultimoTapAvatar := A_TickCount
    while (A_TickCount - inicioPerfil < 12000) {
        if (chequeoRapidoNeedle("own_donoroffer_userprofile_battlerecord_native", 60)) {
            battlerecordOk := true
            break
        }
        cerrarEmblemPopupSiAparece()
        if (A_TickCount - ultimoTapAvatar >= 4000 && chequeoRapidoNeedle("own_donoroffer_selectfriend_trade_native", 30)) {
            logDebugWishlist("paso1: el perfil no abrio, tocando el avatar de nuevo")
            tap(54, 151)
            ultimoTapAvatar := A_TickCount
        }
        Sleep, 300
    }
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
        ; Esperar a que el perfil deje de moverse (2026-09-28, bug real en vivo con Ale): antes era
        ; un Sleep fijo de 700 ms y UNA sola mirada. A 1x el perfil sigue deslizandose por inercia
        ; mas tiempo; el corazon pasaba de largo sin verse y el siguiente swipe lo empujaba mas
        ; alla -- los 8 intentos fallaban aunque la wishlist se veia. Ademas la posicion del corazon
        ; se usa para tocar la carta de arriba, asi que tiene que tomarse con la pantalla quieta.
        esperarPantallaQuieta(2500)
        cerrarEmblemPopupSiAparece()
        if (buscarCorazonWishlist(foundX, foundY)) {
            matcheoCorazon := true
            logDebugWishlist("paso2: swipe fuerte " . A_Index . " -- MATCH corazon (ADB) en X=" . foundX . " Y=" . foundY)
            break
        }
        logDebugWishlist("paso2: swipe fuerte " . A_Index . " -- no match")
    }
    if (!matcheoCorazon) {
        Loop, 6 {
            swipeLogico(250, 350, 280, 500)
            esperarPantallaQuieta(2500)   ; mismo motivo que en el swipe fuerte de arriba
            cerrarEmblemPopupSiAparece()
            if (buscarCorazonWishlist(foundX, foundY)) {
                matcheoCorazon := true
                logDebugWishlist("paso2: swipe fino " . A_Index . " -- MATCH corazon (ADB) en X=" . foundX . " Y=" . foundY)
                break
            }
            logDebugWishlist("paso2: swipe fino " . A_Index . " -- no match")
        }
    }
    if (!matcheoCorazon) {
        ; Evidencia (2026-09-28): foto de lo que se veia ANTES de cerrar el perfil (no quedaba
        ; ninguna cuando esto fallaba). Queda en Logs\_wishlist_sin_corazon_<instancia>.png.
        AdbScreenshot(adbPath, puerto, A_ScriptDir . "\Logs\_wishlist_sin_corazon_" . g_winTitle . ".png")
        Gdip_DisposeImage(pBitmapReferencia)
        cerrarPerfilSiEstaAbierto()
        deslizarSpeedMod("max")
        logDebugWishlist("SALIDA: corazon nunca matcheo tras 2 swipes (foto en Logs)")
        return false
    }

    ; Paso 3: posicion de la carta 1 -- offset fijo de 67px arriba del corazon (Y nativo ->
    ; Y logico = Ynativo + 40, validado en 4+ corridas con el corazon en posiciones Y
    ; distintas).
    ; Needle del corazon recortado a solo el trazo (2026-09-26, estilo Kevin): el viejo
    ; incluia el borde del boton "View Wishlist", cuyo ancho cambia con el idioma, y no
    ; matcheaba. Su esquina queda 7 px mas abajo que la del viejo, por eso el -7: el toque
    ; sobre la carta cae exactamente donde caia antes.
    ; Desde 2026-09-28 foundY es el CENTRO del corazon en ADB. Pasado a la Y de tap() da la misma
    ; posicion que la formula vieja ((Ynativo - 7 + 40) - 67, validada en muchas corridas):
    ; la carta queda 80 px ADB arriba del centro del corazon.
    yCarta := Round(foundY * 488 / 960)
    logDebugWishlist("paso3: yCarta calculado=" . yCarta . " (tap en 122," . yCarta . ")")

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
    ; x=122 y no 137 (2026-10-04, pregunta de Ale): con 2 cartas en la wishlist quedan centradas como
    ; par y el centro (137) cae en el hueco. 122 cae sobre una carta con 1 (la centrada), 2 (la de la
    ; izquierda) o 3 (la del medio).
    Sleep, 1800
    logDebugWishlist("paso3b: toque 1 en (122," . yCarta . ")")
    tap(122, yCarta, 1500)
    cerrarEmblemPopupSiAparece()
    ; Timeout subido de 6000 a 12000 (2026-09-02, bug real reproducido en vivo con Ale: la
    ; carta SI se abria (confirmado con captura real comparada a mano contra la carta pedida,
    ; 8.1/255 de diferencia -- muy por debajo del umbral de 45, hubiera matcheado bien), pero
    ; el needle de la estrella de favorito no llegaba a confirmar dentro de los 6s, dos veces
    ; seguidas, cortando el trade ANTES de llegar a comparar nada. PC bajo carga (varias
    ; instancias + Chrome/Discord/VSCode abiertos) hace que la animacion de apertura tarde
    ; mas de lo que tardaba cuando se calibro este numero originalmente.
    confirmoApertura := esperarAperturaCartaConfirmada(12000)
    logDebugWishlist("paso3b: confirmacion toque 1 = " . confirmoApertura)
    if (!confirmoApertura) {
        Sleep, 1500
        logDebugWishlist("paso3b: toque 2 (reintento) en (122," . yCarta . ")")
        tap(122, yCarta, 1500)
        cerrarEmblemPopupSiAparece()
        confirmoApertura := esperarAperturaCartaConfirmada(12000)
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

    ; Bug real reportado en vivo 2026-09-15 (confirmado con el usuario mirando la pantalla:
    ; la carta 1 SI era la pedida y aun asi dio matchea=0, reproducido 2 veces seguidas) --
    ; ver log _donoroffer_wishlist_debug.log: en TODAS las corridas completas, el match
    ; solo aparecio nunca en la carta 1, siempre en la 2 o mas tarde. Causa real: las
    ; cartas 2/3 tienen 900ms de sobra antes de compararse (el Sleep del paso 8, de la
    ; animacion del swipe entre una carta y la siguiente) -- la carta 1 se comparaba
    ; INSTANTANEO, en el mismo instante que confirma que abrio, sin darle tiempo al arte
    ; a terminar de renderizarse/animarse. Mismo margen que ya usan las demas.
    Sleep, 900
    encontroMatch := false
    Loop, 3 {
        ; Espera de asentamiento REAL antes de medir (2026-09-18, ver comentario completo de
        ; esperarPantallaQuieta): reemplaza la confianza en los Sleep fijos de antes, que no
        ; alcanzaban cuando la animacion del carrusel seguia en curso.
        quedoQuieta := esperarPantallaQuieta(3000)
        if (!quedoQuieta)
            logDebugWishlist("carta " . A_Index . "/3: OJO -- la pantalla nunca se quedo quieta en 3s, se mide igual")
        ; Paso 6: comparar el arte de la carta actual contra la referencia.
        asegurarHwndFast()
        ; En modo desmarcar no se compara nada (sin referencia): matchea queda en 0.
        pBitmapVivo := g_modoDesmarcar ? 0 : capturarVentana(g_hwndFast)
        matchea := false
        diffCarta := -1
        if (pBitmapVivo) {
            ; Recuadro "celeste" (2026-09-29, medido con Ale sobre 24 cartas de TODOS los tipos:
            ; 1-4 diamantes, ex, Mega ex, 1 y 2 estrellas, shiny 1 y 2, inmersivas, corona,
            ; entrenadores). Antes era la ventana del dibujo entera, que tocaba texto (la linea de
            ; datos del Pokemon, "Evoluciona de...", la etiqueta Mega y, en los entrenadores, la
            ; barra con el NOMBRE) y ese texto cambia con el idioma. Ahora es el centro del dibujo:
            ; fracciones (0.20, 0.16, 0.60, 0.22) de la carta, sin ningun texto.
            ; Carta abierta desde la wishlist, en la ventana nativa: esquina (22,90), 231x322.
            rectVivo := {x: 68, y: 142, w: 139, h: 71}
            ; La referencia se mide EN PROPORCION a su tamano real: ~10% de las imagenes de la
            ; carpeta de Kevin miden 367x512 en vez de 275x384, y con el recuadro fijo en pixeles
            ; se comparaba otra zona de la carta -- esas cartas no coincidian NUNCA.
            Gdip_GetImageDimensions(pBitmapReferencia, anchoRef, altoRef)
            rectReferencia := {x: Round(anchoRef * 0.20), y: Round(altoRef * 0.16), w: Round(anchoRef * 0.60), h: Round(altoRef * 0.22)}
            ; Limite 45 -> 9: la carta correcta dio entre 1,4 y 6,9 en las 24 medidas; la version
            ; mas parecida de otra carta (el mismo Mew en otro color) dio 13,5. Con 45 se podian
            ; aceptar cartas equivocadas (una distinta llego a dar 35).
            matchea := compararArteCartas(pBitmapVivo, rectVivo, pBitmapReferencia, rectReferencia, 8, 9, diffCarta)
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
            ; Marcado VERIFICADO con reintento (2026-09-24, bug real reportado por Ale: "hizo match
            ; pero no lo marco otra vez"). El log de esa corrida lo muestra -- carta 1/3 matcheo
            ; clarisimo (diff=11.80 contra umbral 45) con estabaMarcada=0, o sea que tocaba
            ; marcarla, pero todo este tramo era MUDO y nadie comprobaba el resultado.
            ; Este es ademas el unico punto del pipeline que no usa tap() por ADB: usa
            ; clickMouseReal, que mueve el mouse REAL de la PC y depende de que la ventana este al
            ; frente y sin nada encima. Si algo la tapa en ese instante, el click cae en otro lado
            ; y nadie se entera. Ahora se reintenta hasta 4 veces confirmando que la estrella
            ; quedo dorada, y cada intento queda logueado.
            ; ADB primero, mouse real como respaldo (2026-09-24, probado en vivo con Ale sobre una
            ; carta real del Wishlist -- Magikarp, dos veces, marcando y desmarcando):
            ; `adb shell input swipe X Y X Y 120` (pulsacion SOSTENIDA en un mismo punto) SI marca
            ; la estrella, donde `input tap` falla abriendo la vista sin controles. La diferencia
            ; es el tipo de evento: tap manda un DOWN+UP instantaneo, swipe manda una pulsacion con
            ; duracion, y la app las distingue. El comentario historico de clickMouseReal sigue
            ; siendo cierto para tap/motionevent -- swipe simplemente no se habia probado.
            ; Ventaja real: por ADB no hace falta que la ventana este al frente ni visible, asi que
            ; deja de importar que algo la tape (hoy mismo la cortina de notificaciones de Android
            ; rompio una corrida) y deja de robarle el foco al usuario con WinActivate.
            ; Se deja clickMouseReal como ULTIMO intento porque lleva meses en produccion y porque
            ; ADB tampoco es infalible (visto hoy: Android puede rechazar la inyeccion con
            ; SecurityException de forma intermitente). El log dice cual de los dos funciono.
            marcadaOk := false
            idxCarta := A_Index   ; dentro del Loop de abajo, A_Index pasa a ser el del reintento
            ; Offset (+13,+10) -> (+10,+6) al recortar las dos estrellas a 14x14 estilo Kevin
            ; (2026-09-26, mismo corte en ambas): el toque sigue cayendo en el centro.
            starAdbX := Round((starX + 10) * (540/283))
            starAdbY := Round(((starY + 6) - 40) * (960/488))
            ; Estado buscado segun el caso (2026-10-01, bug real): antes solo se aceptaba "quedo
            ; dorada", asi que al DESMARCAR el primer toque si la apagaba, el chequeo lo tomaba como
            ; fallo y el reintento la volvia a prender -- las favoritas viejas nunca se apagaban.
            quiereMarcada := matchea ? true : false
            accion := quiereMarcada ? "marcada" : "desmarcada"
            Loop, 4 {
                if (A_Index < 4)
                    RunWait, %ComSpec% /c ""%adbPath%" -s 127.0.0.1:%puerto% shell input swipe %starAdbX% %starAdbY% %starAdbX% %starAdbY% 120", , Hide
                else
                    clickMouseReal(starX + 10, starY + 6)
                Sleep, 900
                if (chequeoRapidoNeedle("own_donoroffer_userprofile_favoritestar_marked_native", 60) = quiereMarcada) {
                    logDebugWishlist("carta " . idxCarta . "/3: estrella " . accion . " OK (intento " . A_Index . ", " . ((A_Index < 4) ? "ADB" : "mouse real") . ")")
                    marcadaOk := true
                    break
                }
                logDebugWishlist("carta " . idxCarta . "/3: la estrella no quedo " . accion . " con " . ((A_Index < 4) ? "ADB" : "mouse real") . ", reintento " . A_Index)
            }
            if (!marcadaOk)
                logDebugWishlist("carta " . idxCarta . "/3: OJO -- 4 clicks y la estrella no quedo " . accion)
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

        logDebugWishlist("carta " . A_Index . "/3: matchea=" . matchea . " diff=" . Round(diffCarta, 2) . " (umbral 9) quieta=" . (quedoQuieta ? 1 : 0) . " estabaMarcada=" . estaMarcada)

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
        ; (+20,+13) -> (+7,+5) al recortar la X a 14x14 estilo Kevin (2026-09-26): el recorte
        ; empieza en (13,8) del needle viejo, asi el clic sigue cayendo en el mismo punto.
        clickMouseReal(closeX + 7, closeY + 5)
    Sleep, 1000

    ; Paso 10: cerrar el perfil completo. CORREGIDO (2026-08-30, bug real reproducido en
    ; vivo): el chequeo simple de 8s no alcanzaba si el ultimo swipe entre cartas dejo el
    ; scroll cerca de "Achievements", donde el boton X no es visible -- la instancia quedaba
    ; trabada DENTRO del perfil de Main, rompiendo el proximo Retry desde el principio (la
    ; donante nunca volvia a Social Hub, asi que ni siquiera llegaba a intentar el wishlist de
    ; nuevo). Se usa la misma funcion robusta de los early-return de arriba (sube con swipes
    ; si hace falta antes de buscar el boton).
    ; En modo desmarcar no se cierra el perfil: despues se apaga la instancia (Ale, 2026-10-01).
    ; cerrarPerfilSiEstaAbierto espera volver a "Select a Friend", que aca no existe, y perdia ~50 s.
    if (g_modoDesmarcar) {
        logDebugWishlist("DESMARCAR: FIN -- se revisaron las 3 cartas de la wishlist")
        return true
    }
    cerrarPerfilSiEstaAbierto()

    ; Subir la velocidad al salir del perfil (2026-09-28, pedido de Ale: "es obligatorio que
    ; suba"). La bajada a 1x solo hace falta para los deslizamientos dentro del perfil; antes solo
    ; se volvia a subir si la wishlist fallaba, y en el camino normal la donante se quedaba en 1x
    ; hasta el final. Los pasos siguientes ya manejan la carta agrandada y los popups.
    deslizarSpeedMod("max")

    ; Aviso al usuario (2026-09-03, a pedido explicito del usuario): si se revisaron las 3
    ; cartas del wishlist de verdad (llego hasta aca, no un early-return de arriba por perfil
    ; que no cargo o corazon que nunca aparecio) y ninguna coincidio con la carta pedida, se
    ; deja un marcador para que bot.js avise en el canal de Trading -- de otra forma esto
    ; pasaba en silencio, sin que el usuario supiera que tiene que marcarla de favorito el
    ; mismo a mano.
    if (!encontroMatch) {
        try {
            FileAppend, % "1", % StrReplace(g_outputFile, ".txt", "_WishlistNoMatch.txt")
        } catch e {
        }
    }

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
; Instrumentada con logDebugWishlist (2026-09-03, a pedido explicito del usuario tras un fallo
; real en vivo -- "no le dio en OK cuando busco la carta en favoritas": esta funcion no tenia
; NINGUN log, a diferencia de intentarMarcarFavoritoPorWishlist justo arriba, asi que no habia
; forma de ver en que paso se trababa. Usa el mismo logDebugWishlist ya definido mas arriba en
; este archivo (global, sin necesidad de declarar nada nuevo).
; Tolerancia del + del panel 60 -> 40 (2026-09-26, bug real medido con Ale): con 60 el
; needle daba exactamente 60 en la pantalla de la carta abierta, o sea un match falso, y el
; script podia creer que el panel seguia abierto. Con 40 queda a 20+ de cualquier otra pantalla.
; Toca (x,y) y vuelve a tocar cada intervaloMs hasta ver la needle nativa (estilo Kevin).
tocarHastaVerNeedle(x, y, needle, variation, intervaloMs, timeoutMs) {
    inicio := A_TickCount
    ultimoTap := 0
    Loop {
        if (chequeoRapidoNeedle(needle, variation))
            return true
        if (A_TickCount - inicio > timeoutMs)
            return false
        if (A_TickCount - ultimoTap >= intervaloMs) {
            if (ultimoTap)
                logDebugWishlist("  " . needle . " todavia no aparece, tocando de nuevo (" . x . "," . y . ")")
            tap(x, y)
            ultimoTap := A_TickCount
        }
        Sleep, 250
    }
}

seleccionarCartaPorFavoritos() {
    ; Abrir el panel de filtros (lupa).
    logDebugWishlist("filtroFav paso1: abriendo panel de filtros (247,146)")
    ; Estilo Kevin (2026-09-28, pregunta de Ale "por que fallaria si es la unica lupa"): antes era
    ; UN toque y 8 s de espera; si ese toque se perdia (pantalla terminando de cargar, aviso encima)
    ; nunca se volvia a tocar. Ahora se vuelve a tocar cada 2 s hasta ver el panel abierto.
    if (!tocarHastaVerNeedle(247, 146, "own_donoroffer_filterpanel_plusicon_native", 40, 2000, 10000)) {
        logDebugWishlist("filtroFav paso1: FALLO -- nunca aparecio el panel de filtros")
        return false
    }

    ; Tocar "Favorites". Coordenada corregida en vivo -- (138,326) cae mal en "Cards on
    ; wishlist only".
    logDebugWishlist("filtroFav paso2: panel OK, tocando 'Favorites' (80,330)")
    ; Mismo arreglo que la lupa: se vuelve a tocar si el toque se perdio. Cada 3 s (no menos) para
    ; no desmarcar la casilla si el primer toque si entro y el juego solo tardaba en mostrarla.
    if (!tocarHastaVerNeedle(80, 330, "own_donoroffer_favtoggle_selected_native", 60, 3000, 10000)) {
        logDebugWishlist("filtroFav paso2: FALLO -- el toggle de Favorites nunca se marco")
        return false
    }
    ; (Timeout de 10 s del toggle: 2026-08-30, 5 s no alcanzo en una corrida real.)

    ; OK del filtro. Coordenada corregida en vivo -- (137,424) tambien cae mal.
    ; Confirmacion real agregada (2026-09-04, bug real reproducido en vivo): a diferencia de
    ; paso1/paso2, este toque nunca confirmaba que el panel de verdad se haya cerrado -- solo
    ; asumia "filtro deberia estar aplicado" sin chequear nada, un supuesto que resulto falso
    ; (visto en vivo: el panel de filtros seguia abierto despues, y el toque siguiente a la
    ; carta caia adentro del panel sin efecto, dejando todo trabado ahi). Ahora reintenta el
    ; toque (cooldown 900ms, mismo patron que el resto del pipeline) mientras el panel siga
    ; detectado como abierto, hasta 6s.
    logDebugWishlist("filtroFav paso3: toggle marcado, tocando OK (147,457)")
    inicioOk := A_TickCount
    ultimoTapOk := 0
    Loop {
        if (!chequeoRapidoNeedle("own_donoroffer_filterpanel_plusicon_native", 40)) {
            logDebugWishlist("filtroFav paso3: panel cerrado, filtro aplicado")
            return true
        }
        if (A_TickCount - ultimoTapOk >= 900) {
            tap(147, 457)
            ultimoTapOk := A_TickCount
        }
        if (A_TickCount - inicioOk > 6000) {
            logDebugWishlist("filtroFav paso3: FALLO -- el panel de filtros nunca se cerro")
            return false
        }
        Sleep, 300
    }
}
; ============================================================================

; Logging agregado a estos primeros pasos (2026-09-04, a pedido explicito del usuario tras
; varias fallas seguidas en "no_aparecio_trade_landing_paso6" sin poder ver POR DONDE se
; trababa antes de eso -- estos pasos 1-6 nunca escribian nada en _donoroffer_wishlist_debug.log,
; a diferencia del resto del script. Mismo archivo de log de siempre (logDebugWishlist),
; solo para no crear un log nuevo separado.
; Modo desmarcar (2026-10-01, idea de Ale, recorrido mapeado en vivo en la instancia 1): lo
; lanza _DonorRespondAndFinalize.ahk despues de la foto del "Got it!". En vez de apagarse, la
; donante sigue hasta el perfil de Main y apaga las estrellas doradas de su wishlist.
; Uso: _DonorOfferCard.ahk "<winTitle>" "<folderPath>" "DESMARCAR" "<outputFile>"
global g_modoDesmarcar := (g_rutaImagenReferencia = "DESMARCAR")
global g_bajarVelocidadEnPerfil := false
if (g_modoDesmarcar) {
    if (!llegarAlPerfilDespuesDelTradeo())
        ExitConError("desmarcar_no_llego_al_perfil")
    intentarMarcarFavoritoPorWishlist("")
    WriteResult("OK")
    Gdip_Shutdown(pToken)
    ExitApp, 0
}

logDebugWishlist("paso1: esperando Search Results")
if (!esperarNeedleYTap("own_donoroffer_x_searchresults", 30, 141, 499)) {
    logDebugWishlist("paso1: FALLO -- nunca aparecio Search Results")
    ExitConError("no_aparecio_search_results_paso1")
}
logDebugWishlist("paso2: esperando Friend ID Search")
if (!esperarNeedleYTap("own_donoroffer_cancel_ok", 30, 81, 367)) {
    logDebugWishlist("paso2: FALLO -- nunca aparecio Friend ID Search")
    ExitConError("no_aparecio_friendid_search_paso2")
}
; 1 "X" mas (misma coordenada, 146,504) antes de que el tap de Comunidad funcione de
; verdad -- mapeado en vivo 2026-08-04, quedaba un overlay de por medio. Misma needle de
; X reutilizada (confirmado en vivo 2026-08-05, matchea en ambas pantallas).
logDebugWishlist("paso3: esperando X extra")
if (!esperarNeedleYTap("own_donoroffer_x_searchresults", 30, 146, 504)) {
    logDebugWishlist("paso3: FALLO -- nunca aparecio la X extra")
    ExitConError("no_aparecio_x_extra_paso3")
}
logDebugWishlist("paso4: esperando volver a Comunidad")
if (!esperarNeedleYTap("own_donoroffer_x_searchresults", 30, 146, 504)) {
    logDebugWishlist("paso4: FALLO -- nunca volvio a Comunidad")
    ExitConError("no_aparecio_comunidad_paso4")
}
; Modo ESPERAR_AMIGO (2026-10-04, Friend Trade / Share to Friend, diseño de Ale): ya se cerraron
; las ventanas de la solicitud de Kevin y la donante esta en Comunidad. Espera hasta 15 min a que
; el amigo acepte (puntito rojo en Friends) y termina; el siguiente paso lo lanza el bot.
; Uso: _DonorOfferCard.ahk "<winTitle>" "<folderPath>" "ESPERAR_AMIGO" "<outputFile>"
; Friend Trade (2026-10-04): mismo flujo que Main Trade, pero antes de ir a Trade espera a que el
; AMIGO acepte la solicitud (Main la aceptaba sola con su propio script).
if (g_modoExtra = "AMIGO") {
    if (!esperarAmigoAcepte(15 * 60 * 1000))
        ExitConError("amigo_no_acepto_15min")
}
if (g_rutaImagenReferencia = "ESPERAR_AMIGO") {
    if (!esperarAmigoAcepte(15 * 60 * 1000))
        ExitConError("amigo_no_acepto_15min")
    WriteResult("OK")
    Gdip_Shutdown(pToken)
    ExitApp, 0
}

; Modo SHARE (2026-10-04, trayecto mapeado en vivo con Ale): el MISMO camino de Main Trade, pero por
; el tile Share. Despues del swipe vuelve a la pantalla de Share y desmarca la estrella entrando por
; Friends. Uso: _DonorOfferCard.ahk "<winTitle>" "<folderPath>" "<imagen>" "SHARE" "<outputFile>"
if (g_modoExtra = "SHARE") {
    flujoShare()
    WriteResult("OK")
    Gdip_Shutdown(pToken)
    ExitApp, 0
}

logDebugWishlist("paso5: esperando tile Trade en Social Hub")
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
if (!esperarTradeIconOBadgeRechazo()) {
    logDebugWishlist("paso5: FALLO -- nunca aparecio el tile Trade en Social Hub")
    ExitConError("no_aparecio_socialhub_paso5")
}
logDebugWishlist("paso5: OK, tile Trade tocado -- chequeando popup de trade terminado")

; Popup "The trade has been terminated and no trade agreement was reached" (2026-08-27, a
; pedido explicito del usuario, caso real visto en vivo -- justo el que dispara el badge de
; rechazo de arriba): al entrar a Trade despues de un rechazo, este popup tapa la pantalla
; antes de llegar a la landing normal de Trade. Se cierra tocando OK y de ahi sigue derecho
; el flujo de siempre (la landing de Trade es identica despues). Opcional -- si no aparece
; (caso normal, sin rechazo previo), no hace nada y sigue de largo.
; REESCRITO (2026-09-17, bug real reproducido en vivo con Ale, cuenta cancelada a proposito
; para probar esto): el chequeo viejo era una UNICA foto instantanea con chequeoRapidoNeedle,
; sin reintentos -- si el popup tardaba un instante de mas en renderizar despues del tap del
; tile Trade, este chequeo lo perdia para siempre y el flujo seguia directo a paso6 con el
; popup todavia tapando la pantalla, haciendo fallar "no_aparecio_trade_landing_paso6".
; Ademas su needle (own_donoroffer_tradeterminated_dimmedsprite_native, la mascota de fondo
; atenuada) depende del mismo personaje que resulto ser intermitente en otras pantallas
; (aparece/desaparece en la MISMA pantalla de la MISMA cuenta, ver auditoria de mascota en
; _MainAcceptTradeOffer.ahk) -- no confiable tampoco. Reemplazado por own_maintrade_offered_confirm
; (la curva del boton OK, ya validada e independiente de texto/mascota en otras 2 pantallas)
; en un POLL real de hasta 4s (le da tiempo a la animacion de apertura del popup), en vez de
; una sola foto. Confirmado contra la captura real de este popup: variation=50.
; Timeout subido de 4000 a 10000ms (2026-09-18, bug real reproducido en vivo con Ale): el
; popup en si y el needle estan bien (confirmado con captura limpia despues), pero el cliente
; del juego a veces tarda mas en terminar de renderizar este popup (visto en vivo con un icono
; de carga trabado tapando parte del texto) -- 4s no alcanzaba siempre para ese caso.
; Estilo Kevin (2026-09-27, pedido de Ale): ya NO se espera a ver si sale el popup de "tradeo
; cancelado" (se perdian 10 s en cada tradeo aunque no saliera). En cada vuelta: si esta el popup
; se toca OK; si ya se ve la pantalla de Trade (reloj de Historial) o la de "respuesta recibida"
; (el "!" de View), se sigue al instante. Tope 15 s; si se vence, sigue igual y los pasos de abajo
; deciden. El popup se reconoce por la esquina del OK centrado (own_maintrade_offered_confirm).
; Estable 2,5 s (2026-09-28, mismo bug visto en vivo con el aviso "elige una carta"): la pantalla
; de Trade puede aparecer primero y el popup un instante despues, encima.
inicioLlegada := A_TickCount
llegadaDesde := 0
Loop {
    if (chequeoRapidoNeedle("own_maintrade_trade_button_native", 30)
     || chequeoRapidoNeedle("own_donorfinalize_waiting_title_native", 30)) {
        if (!llegadaDesde)
            llegadaDesde := A_TickCount
        else if (A_TickCount - llegadaDesde >= 2500) {
            logDebugWishlist("paso5: pantalla de Trade estable, sin popup")
            break
        }
    } else {
        llegadaDesde := 0
    }
    if (esperarNeedleSinAccion("own_maintrade_offered_confirm", 50, 1)) {
        llegadaDesde := 0
        logDebugWishlist("popup 'trade terminated' visible, tocando OK")
        Sleep, 900
        tap(140, 380)
        Sleep, 1200
        continue
    }
    if (A_TickCount - inicioLlegada > 15000) {
        logDebugWishlist("OJO: 15 s sin ver la pantalla de Trade, se sigue igual")
        break
    }
    Sleep, 250
}

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
    logDebugWishlist("ya habia una oferta esperando respuesta -- cortando aca (OK)")
    WriteResult("OK")
    Gdip_Shutdown(pToken)
    ExitApp, 0
}
logDebugWishlist("paso6: esperando Trade landing")

; Chequeo rapido cableado (2026-08-26): needle propia own_maintrade_trade_button_native ya
; validada en vivo hoy mismo contra una captura real de esta pantalla (match perfecto, avg
; 0.00/255, variation 0 alcanza) y cruzada contra 7 capturas de otras pantallas (titulo x2,
; social hub x2, friends x2, menu principal) sin ningun falso positivo -- variation 30 usado
; igual, con margen.
if (!esperarNeedleYTap("own_donoroffer_trade_button", 30, 139, 427, 15000, "own_maintrade_trade_button_native", 30)) {
    logDebugWishlist("paso6: FALLO -- nunca aparecio el Trade landing")
    ExitConError("no_aparecio_trade_landing_paso6")
}
logDebugWishlist("paso6: OK, Trade landing confirmado")
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
; ANTES de tocar "Trade" -- ver bloque de funciones nuevas mas arriba. Si falla en un paso
; TECNICO (perfil no cargo, corazon nunca aparecio, etc.) sigue con el metodo viejo a ciegas
; sin cortar el trade -- pero si se revisaron las 3 cartas de verdad y ninguna matcheo, ver
; el corte explicito de abajo.
g_favoritoMarcado := intentarMarcarFavoritoPorWishlist(g_rutaImagenReferencia)

; Bug real reportado en vivo 2026-09-15, a pedido explicito del usuario (viendo la pantalla
; el mismo, reproducido 2 veces seguidas): antes, si se revisaban las 3 cartas del Wishlist
; de verdad y ninguna coincidia con la pedida, el script igual seguia con el metodo a ciegas
; ("mas cantidad primero") y terminaba ofreciendole a Main una carta DISTINTA a la pedida,
; sin que nadie se enterara hasta despues de que el trade ya se mando. El marcador
; _WishlistNoMatch.txt (mismo que ya usa bot.js para avisar "no se encontro la carta,
; ponela de favorito vos" en el canal de Trading) solo se escribe cuando se llego a revisar
; las 3 de verdad -- NO en un early-return tecnico (perfil/corazon) de mas arriba, asi que es
; la senal correcta para distinguir ambos casos. Si existe, se corta el trade aca (en vez de
; seguir a ciegas) -- mejor perder este intento y que el usuario reintente (bot.js ya tiene
; el boton Retry armado para esto) que mandarle a Main una carta que no pidio. NO se borra el
; marcador -- bot.js todavia lo necesita leer para mandar el aviso de "no matcheo" de siempre.
if (FileExist(StrReplace(g_outputFile, ".txt", "_WishlistNoMatch.txt"))) {
    cerrarPerfilSiEstaAbierto()
    ExitConError("wishlist_sin_match")
}

; Sin carta marcada = NO se ofrece nada (2026-09-28, pedido de Ale): antes, si fallaba un paso
; tecnico (perfil no cargo, corazon nunca aparecio, carta no abrio), se seguia a ciegas tocando la
; primera carta; ese toque "confirmaba" el paso y Main terminaba aceptando una carta equivocada.
; Solo se sigue a ciegas si no hay imagen de referencia (llamador viejo, sin carta pedida).
if (!g_favoritoMarcado && g_rutaImagenReferencia != "") {
    logDebugWishlist("CORTE: no se marco la carta pedida -- no se ofrece ninguna carta a ciegas")
    cerrarPerfilSiEstaAbierto()
    ExitConError("wishlist_no_se_marco_carta")
}

if (!esperarNeedleYTap("own_donoroffer_selectfriend_trade", 30, 213, 179, 15000, "own_donoroffer_selectfriend_trade_native", 30))
    ExitConError("no_aparecio_selectfriend_paso7b")

; Popup explicativo "Choose a Card to Trade" -- puede no aparecer siempre. Reintenta unos
; segundos (ver tapSiApareceNeedlePolling) en vez de un chequeo unico -- confirmado en vivo
; que a veces tarda en renderizar y un chequeo de una sola vez se lo perdia.
esperarElegirCartaOAviso()

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
; Si el filtro falla, se corta en vez de tocar a ciegas (2026-09-28, pedido de Ale: sin el filtro
; la carta de (48,357) es cualquiera y Main la aceptaria igual).
if (g_favoritoMarcado && !seleccionarCartaPorFavoritos()) {
    logDebugWishlist("CORTE: el filtro de favoritos fallo -- no se ofrece ninguna carta a ciegas")
    ExitConError("filtro_favoritos_fallo")
}
logDebugWishlist("post-filtro: g_favoritoMarcado=" . g_favoritoMarcado . " -- tocando carta en (48,357)")

; Con el filtro aplicado, la unica carta visible cae en la misma posicion de siempre --
; mismo toque (48,357) sirve para ambos casos (filtrado o a ciegas). Bajar el Speed Mod a 1x
; solo cuando el filtro se aplico de verdad (a 3x, tocar la carta del Wishlist la agranda sin
; querer -- mismo motivo que el paso 0 de intentarMarcarFavoritoPorWishlist).
; Bajada a 1x de aca RETIRADA 2026-09-27 (con Ale): era un toque A CIEGAS redundante. Si hay
; carta favorita marcada, la donante ya esta en 1x desde el paso 0 de
; intentarMarcarFavoritoPorWishlist (y solo vuelve a subir si la wishlist falla, en cuyo caso
; g_favoritoMarcado es falso y esta bajada tampoco corria). Probado ademas con Ale: tocar la
; carta al maximo la selecciona normal, sin agrandarla.
tap(48, 357)
; Salir de la carta agrandada SIN tocar OK (2026-09-27, idea de Ale, probado en vivo en Main):
; si la velocidad esta alta, tocar la carta puede abrirla agrandada. Tocar FUERA de la carta la
; cierra; se toca 2 veces el titulo "Choose a Card to Trade" (150,60): el primero cierra el zoom,
; el segundo ya cae en la pantalla normal, donde el titulo es texto y no hace nada. Un punto en el
; medio no sirve porque la carta agrandada lo tapa. Recien despues se toca OK (paso 10).
; Esperas acortadas 2026-10-03 (Ale: "demora al darle OK despues de escoger la carta"):
; 1000/700/1500 ms -> 600/500/900 ms, ~1,4 s menos por tradeo.
Sleep, 600
Loop, 2 {
    tap(150, 60)
    Sleep, 500
}
; Ya NO se vuelve a subir a "max" aca (2026-09-04, a pedido explicito del usuario, visto en
; vivo repetidas veces): con el Speed Mod devuelta a 3x, el resto del flujo (paso10 en
; adelante -- habilitar OK, confirmar la carta, confirmar el envio) fallaba consistentemente
; sin encontrar needles que estaban visiblemente en pantalla (ej. "Choose a Card to Trade"
; seguia mostrandose pero el chequeo igual reportaba que la pantalla "se perdio"). Se deja en
; 1x por el resto de este script -- ya no queda ningun swipe/toque sensible a la velocidad
; despues de este punto que necesite volver a 3x.
; Recuperacion de "vista ampliada" RETIRADA 2026-09-27 (pedido de Ale): la carta se abria
; ampliada por el Speed Mod a 3x, y eso ya se soluciono bajando la velocidad a 1x antes de
; tocarla (deslizarSpeedMod("min") de arriba). Ademas ahorra una captura ADB por tradeo.

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
; Chequeo de confirmacion sacado (2026-09-04, causa real encontrada en vivo tras 7 fallas
; seguidas en este mismo paso: comparacion pixel a pixel confirmo que la needle
; own_donoroffer_choosecard_title/_native YA NO matchea en ningun lado de la pantalla real
; (mejor diferencia encontrada, 93-125/255, muy por encima de la tolerancia 30 usada aca) --
; el icono que representaba cambio de apariencia con el update del juego de hoy. Ya
; llegamos a esta pantalla por el flujo normal (paso1-9 ya la confirmaron), asi que esta
; segunda confirmacion es puramente defensiva -- con la needle rota, solo garantizaba fallar
; siempre. Se saca del todo y se deja el mismo criterio de "toque a ciegas" que ya se usaba
; para el boton OK en si (ver comentario de paso10 arriba).
logDebugWishlist("paso10: tocando OK a ciegas (sin needle de confirmacion, ver comentario)")
Sleep, 900
tap(145, 458)
; Reintento del OK RETIRADO 2026-09-28 (bug real en vivo con Ale): volvia a tocar OK si 1,5 s
; despues la lupa seguia a la vista, pero a veces la pantalla todavia no habia terminado de
; cambiar; el segundo toque caia sobre la vista previa y desordenaba los pasos siguientes. La
; carta agrandada ya la resuelven los 2 toques en el titulo (150,60) antes del OK.
; Chequeo rapido cableado (2026-08-26): needle propia own_donoroffer_tradepartner_header_native
; ("Trade Partner"), validada en vivo -- match exacto contra una captura real y sin ningun
; falso positivo hasta variation 80 contra 12 capturas de otras pantallas.
logDebugWishlist("paso11: esperando preview de envio (Trade Partner)")
if (!esperarNeedleYTap("own_donoroffer_tradepartner_header", 20, 197, 461, 15000, "own_donoroffer_tradepartner_header_native", 30)) {
    logDebugWishlist("paso11: FALLO -- nunca aparecio el preview de envio")
    ExitConError("no_aparecio_preview_envio_paso11")
}
; Chequeo rapido cableado (2026-08-26): needle propia own_donoroffer_setcard_confirm_native
; (el texto especifico de este popup, "Do you want to set this as your card to be traded?" --
; NO el boton OK generico, que es solo un color solido y dio falsos positivos en vivo contra
; otras pantallas con botones celestes). Validada en vivo: match exacto, sin ningun falso
; positivo hasta variation 80 contra 13 capturas de otras pantallas.
logDebugWishlist("paso12: esperando confirmacion 'set this as your card'")
if (!esperarNeedleYTap("own_donoroffer_cancel_ok", 30, 200, 365, 15000, "own_donoroffer_setcard_confirm_native", 20)) {
    logDebugWishlist("paso12: FALLO -- nunca aparecio la confirmacion de set card")
    ExitConError("no_aparecio_confirmar_set_card_paso12")
}
logDebugWishlist("paso12: OK, carta confirmada")

; Aviso "solo te queda 1 copia" -- puede no aparecer siempre. Pasado a needle real
; (2026-08-05, a pedido del usuario) -- ya no queda ningun chequeo por OCR en este script.
; Chequeo rapido cableado (2026-08-26): needle propia own_donoroffer_remainingcopy_popup_native
; (el texto de advertencia "This will trade a card that you only have one remaining copy of"),
; validada en vivo -- match exacto, sin ningun falso positivo hasta variation 80 contra 14
; capturas de otras pantallas.
; Cambiado de tapSiApareceNeedle (chequeo UNICO) a tapSiApareceNeedlePolling (2026-09-04, bug
; real reproducido en vivo -- captura mostrando el popup "This will trade a card that you only
; have one remaining copy of. Is this OK?" totalmente abierto y sin tocar, bloqueando el resto
; del flujo para siempre): el chequeo unico se lo perdia si el popup tardaba un poco de mas en
; aparecer (ej. la nueva UI de "Number of cards" que agrego el update de hoy, mas lenta en
; renderizar) -- sin reintento, una vez perdido el momento exacto, nunca mas se volvia a
; chequear. tapSiApareceNeedlePolling ya reintenta el chequeo hasta por 10s.
; Estilo Kevin (2026-09-27, pedido de Ale): antes se ESPERABA hasta 10 s por el aviso de "ultima
; copia", que solo sale si la donante da su ULTIMA copia -- con 2 o mas copias se perdian esos
; 10 s en cada tradeo. Ahora, en cada vuelta: si ya salio la confirmacion final (OK centrado) se
; sigue; si esta el aviso de ultima copia, se toca OK. Tope 15 s; el paso 14 de abajo decide.
inicioCopia := A_TickCount
ultimoTapSetCard := A_TickCount
Loop {
    if (esperarNeedleSinAccion("own_maintrade_offered_confirm", 60, 1))
        break
    ; Toque perdido del OK de "set this as your card" (2026-09-28, revision estilo Kevin con Ale):
    ; se tocaba una sola vez; si no entraba, el popup quedaba abierto y aca solo se esperaba.
    if (A_TickCount - ultimoTapSetCard >= 2500 && chequeoRapidoNeedle("own_donoroffer_setcard_confirm_native", 20)) {
        logDebugWishlist("paso12: la confirmacion de set card sigue abierta, tocando OK de nuevo")
        tap(200, 365)
        ultimoTapSetCard := A_TickCount
        continue
    }
    if (esperarNeedleSinAccion("own_donoroffer_remainingcopy_popup", 50, 1)) {
        logDebugWishlist("aviso de ultima copia visible, tocando OK")
        Sleep, 1000   ; antes 2000 (2026-10-03); si el toque no entra, la vuelta siguiente retoca
        tap(204, 383)
        Sleep, 1000
        continue
    }
    if (A_TickCount - inicioCopia > 15000)
        break
    Sleep, 250
}

; Foto real de cuando la donante ofrece la carta (2026-08-18, a pedido explicito del
; usuario -- mismo criterio que la foto que ya saca _DonorRespondAndFinalize.ahk): se saca
; ANTES de tocar, mientras la pantalla de confirmacion todavia esta completa. Nombre
; derivado del outputFile para que bot.js sepa donde buscarla.
; Needle reemplazado (2026-09-16, a pedido explicito del usuario -- el anterior,
; own_donoroffer_offered_text/_native, era literalmente el texto en ingles "You have offered
; the card to your trade partner."). Se probaron e invalidaron primero la flecha de fondo
; (matchea Home/Choose-a-Card desde variation 20/30), la esquina del cuadro de nota y el borde
; del boton OK (ninguno separa limpio) -- la mascota corredora parecia funcionar (validada
; contra 14 capturas de otras pantallas, CERO matches hasta variation=100) pero se DESCARTO al
; dia siguiente (2026-09-17), confirmado en vivo con Ale: la mascota aparece y desaparece en la
; MISMA pantalla de la MISMA cuenta de Main (presente con "Heatmor", ausente con "Pawmot"
; minutos despues) -- no es un elemento fijo del juego, probablemente un cosmetico/animacion
; condicional. Reemplazada por own_maintrade_offered_confirm (la curva redondeada del boton OK,
; needle ya existente y validada del lado de Main, reusada aca porque esta pantalla es
; identica en ambos lados) -- confirmada contra la captura real de la donante (Igglybuff,
; variation=30). Variation subida a 60 por el mismo margen que del lado de Main.
logDebugWishlist("paso14: esperando confirmacion final (offered)")
if (!esperarNeedleSinAccion("own_maintrade_offered_confirm", 60, 15000)) {
    logDebugWishlist("paso14: FALLO -- nunca aparecio la confirmacion final")
    ExitConError("no_aparecio_confirmacion_final_paso14")
}
AdbScreenshot(adbPath, puerto, StrReplace(g_outputFile, ".txt", "_OfferPhoto.png"))
; Sleep antes del toque ciego (2026-08-27, bug real reproducido en vivo en _MainAcceptTradeOffer.ahk,
; mismo patron aca por prevencion): el chequeo rapido nuevo confirma la pantalla casi al
; instante -- mas rapido que lo que el boton OK puede tardar en habilitarse del todo.
Sleep, 700   ; antes 1200 (2026-10-03, Ale: "aqui igual demora"); el bucle de abajo retoca si no entro
tap(136, 438)

; Reintento del OK estilo Kevin (2026-09-23, bug real fotografiado en vivo por Ale: la donante
; se quedo con el popup "You have offered the card..." abierto y el OK sin tocar). El log de esa
; corrida lo muestra claro: el needle matcheo (no hubo FALLO), se saco la foto y se toco OK UNA
; sola vez -- ese toque no entro, el popup se quedo, y paso15 espero 8s una pantalla que ya no
; iba a llegar. Peor todavia: el script igual termino con "FIN: OK, carta ofrecida" y el pipeline
; siguio como si la oferta hubiera quedado confirmada.
; Mismo patron clickUntilNeedle ya aplicado al boton View en _DonorRespondAndFinalize.ahk: se
; reintenta hasta que aparece la pantalla SIGUIENTE ("Waiting for a Response"), y solo se vuelve
; a tocar mientras el popup siga visible -- asi, si el OK ya entro y el juego esta cargando, no
; se toca nada de mas.
; Se usa la via lenta (esperarNeedleSinAccion, captura por ADB) a proposito: estos dos needles
; NO tienen variante _native, asi que chequeoRapidoNeedle devolveria false siempre y el bucle no
; reintentaria nada.
Loop {
    if (esperarNeedleSinAccion("own_donoroffer_waitingresponse_icon", 50, 2000))
        break
    if (!esperarNeedleSinAccion("own_maintrade_offered_confirm", 60, 2000))
        break  ; el popup ya no esta: o entro el OK, o la pantalla cambio sola
    if (A_Index > 6) {
        logDebugWishlist("paso14: OJO -- se toco OK " . A_Index . " veces y el popup sigue ahi")
        break
    }
    logDebugWishlist("paso14: el popup sigue abierto, reintentando OK (intento " . A_Index . ")")
    tap(136, 438)
    Sleep, 1200
}

; Paso 15 (2026-09-16, a pedido explicito del usuario): segunda foto de evidencia, de la
; pantalla "Waiting for a Response" que queda despues de tocar OK arriba -- bot.js arma un
; collage de 2 paneles con esta + _OfferPhoto.png (etiqueta en franja SEPARADA arriba de cada
; imagen, nunca superpuesta). Needle propia own_donoroffer_waitingresponse_icon (el icono
; circular de "Refresh", sin texto -- no toca la carta ni ningun dato personal). Validada
; contra 13 capturas reales de otras pantallas del pipeline: el falso positivo mas cercano
; recien aparece en variation=80, la propia pantalla objetivo matchea desde variation=10-20 en
; una captura de referencia -- pero una corrida real en vivo (2026-09-17, Igglybuff) recien
; matcheo en variation=50 (probablemente una leve diferencia de renderizado/compresion del
; boton Refresh en esa captura puntual). Subido de 30 a 50 para no perder ese margen real visto
; en vivo, todavia con 30 puntos de aire respecto al falso positivo mas cercano (80).
; Best-effort: si por algun motivo esta pantalla no llega a aparecer a tiempo, no corta el
; trade (la oferta ya se mando de verdad en el paso de arriba) -- bot.js manda la foto sola
; (_OfferPhoto.png) si esta segunda captura no existe.
if (esperarNeedleSinAccion("own_donoroffer_waitingresponse_icon", 50, 8000)) {
    AdbScreenshot(adbPath, puerto, StrReplace(g_outputFile, ".txt", "_WaitingResponsePhoto.png"))
    logDebugWishlist("paso15: OK, foto de Waiting for a Response capturada")
} else {
    logDebugWishlist("paso15: nunca aparecio Waiting for a Response a tiempo -- se sigue solo con la primera foto")
}
logDebugWishlist("FIN: OK, carta ofrecida")

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
            ; Antes 2 s fijos + 1 s (2026-10-03, Ale: "demora en hacer click"). Ahora 0,8 s de
            ; asentamiento y, si el toque no entro, la vuelta siguiente lo ve otra vez y retoca.
            Sleep, 800   ; el aviso entra deslizandose; se deja asentar antes de tocar
            tap(141, 436)
            Sleep, 600
            continue
        }
        if (A_TickCount - inicio > 15000)
            return
        Sleep, 250
    }
}
