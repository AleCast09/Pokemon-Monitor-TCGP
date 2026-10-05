; _DonorRespondAndFinalize.ahk -- reemplaza donor_respond + finalize_trade_card (Kevin).
; Mapeado 2026-08-03/04. Corre en la donante despues de que Main ya ofrecio su carta
; (_MainAcceptTradeOffer.ahk). Refresca, acepta el intercambio, confirma, desliza la
; carta para enviarla (swipe rapido, confirmado por el usuario) y cierra el aviso final.
; Uso: _DonorRespondAndFinalize.ahk "<winTitle>" "<folderPath>" "<outputFile>"

#SingleInstance off
SetBatchLines, -1
#NoEnv

if (A_Args.Length() < 3) {
    ExitApp, 1
}

global g_winTitle   := A_Args[1]
global g_folderPath := A_Args[2]
; 4to arg opcional (2026-10-04, Friend Trade): "AMIGO" antes del outputFile. Uso: ... "AMIGO" "<outputFile>"
global g_modoExtra := ""
if (A_Args.Length() >= 4) {
    g_modoExtra := A_Args[3]
    global g_outputFile := A_Args[4]
} else {
    global g_outputFile := A_Args[3]
}

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
; mecanismo que _DonorOfferCard.ahk / _SpeedMod.ahk / _WaitWelcomeScreens*.ahk). No fatal si
; no se encuentra.
global g_hwndFast := WinExist(g_winTitle . " ahk_class Qt5156QWindowIcon")

; Log de depuracion (2026-09-23): este script tampoco tenia ninguno -- mismo punto ciego que
; tenia _MainAcceptTradeOffer.ahk hasta hoy. Sin esto, cuando el paso termina con "OK" pero el
; trade queda sin consumir, no hay forma de saber en que punto se quedo.
logDebugFinalize(msg) {
    FileAppend, % A_Hour ":" A_Min ":" A_Sec "." A_MSec " -- " msg "`n", % A_ScriptDir . "\Logs\_donorfinalize_debug.log"
}

tap(x, y, esperaMs := 0) {
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

; Chequeo rapido por captura directa de ventana (2026-08-26, ver comentario completo en
; _DonorOfferCard.ahk). Sin riesgo de regresion.
chequeoRapidoNeedle(nombreNeedleNativo, variationNativo) {
    global g_hwndFast, g_winTitle
    if (nombreNeedleNativo = "")
        return false
    ; Re-resolver el handle si quedo en 0 o murio (2026-09-22, mismo bug ya medido en vivo en
    ; _WaitWelcomeScreensMain.ahk): se resolvia una sola vez al arrancar el script y, si la
    ; ventana de la instancia todavia no existia en ese instante, TODOS los chequeos rapidos
    ; devolvian false para el resto de la corrida y todo caia a la via lenta por ADB.
    if (!g_hwndFast || !DllCall("IsWindow", "Ptr", g_hwndFast))
        g_hwndFast := WinExist(g_winTitle . " ahk_class Qt5156QWindowIcon")
    if (!g_hwndFast)
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

; Bug real confirmado en vivo 2026-08-26: el swipe que manda la carta (ver call site mas
; abajo) NO registra si el Speed Mod de la instancia esta activo a 3x -- probado 2 veces en
; la misma pantalla real, el MISMO swipe funciono al toque apenas se bajo el multiplicador a
; 1x a mano. Este helper reproduce ese mismo arreglo, pero solo si el icono flotante de Speed
; Mod esta realmente presente (needle own_speedmod_icon, ya validada en _SpeedMod.ahk) -- si
; la cuenta no tiene el mod activo, no toca nada (evita tocar a ciegas de mas en cuentas sin
; el mod). A pedido explicito del usuario: NO se vuelve a subir a 3x despues -- a esta altura
; el trade esta practicamente terminado (solo queda cerrar el "Got it!" final).
bajarSpeedModA1xSiEstaActivo() {
    global adbPath, puerto
    if (!chequeoRapidoNeedle("own_speedmod_icon", 80))
        return false
    tap(18, 109, 800)                    ; icono flotante de Speed Mod (persistente en cualquier pantalla)
    Sleep, 800
    RunWait, %ComSpec% /c ""%adbPath%" -s 127.0.0.1:%puerto% shell input swipe 363 248 33 248 600", , Hide
    Sleep, 1000
    tap(171, 285, 500)                   ; minimizar el panel
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
        ; Sleep de asentamiento antes del toque (2026-08-29, mismo bug real reproducido en vivo
        ; con Speed Mod en 3x que en _MainAcceptFriendRequest.ahk/_DonorOfferCard.ahk hoy mismo):
        ; la needle puede confirmar un frame antes de que el boton este de verdad tocable.
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

; Navega a Social Hub -> Trade antes de esperar la pantalla (2026-08-19, bug real
; reproducido en vivo): este script asumia que la donante YA estaba parada en la pantalla
; de "esperando respuesta" (como la deja _DonorOfferCard.ahk en el flujo normal) -- pero si
; el pipeline salto ese paso (oferta pendiente detectada desde antes, ver
; _CheckPendingOffer.ahk) la donante puede estar en cualquier otra pantalla (ej. sobres).
; Seguro tambien en el flujo normal: si ya esta en la pantalla de espera, re-entrar a Trade
; muestra el mismo estado real (servidor, no una pantalla de una sola vez).
; tap(207,402) repuesto (2026-08-27, bug real reproducido en vivo): se habia sacado un dia
; antes por pedido explicito del usuario, que en ESE momento puntual del pipeline observo que
; caia en zona vacia sin hacer nada (la donante ya estaba dentro de Trade). Pero corriendo
; este script de forma aislada/en otro momento se confirmo que la donante puede estar
; parada en Social Hub de verdad -- sin este segundo toque nunca entra a Trade y esperarNeedleYTap
; de mas abajo nunca encuentra nada. Mismo criterio que el comentario de arriba: un toque en
; una zona vacia es inofensivo, sacarlo no lo es.
; Navegar SOLO si hace falta (2026-09-23, bug real reproducido en vivo con Ale: la donante
; estaba exactamente en el Trade landing con el boton View y su badge rojo -- la pantalla
; perfecta para este script -- y estos dos toques a ciegas la sacaron de ahi antes de mirar
; nada, haciendo fallar paso1 con "no_aparecio_waiting_response_paso1". Se descarto que fuera
; el needle: validado contra la captura real de ese momento, own_donorfinalize_waiting_title
; matchea desde variation=0 en (470,176), perfecto.
; Los toques siguen existiendo para el caso real que los motivo (entrar desde Social Hub si el
; pipeline salto el paso anterior), pero ahora se dan solo si NO estamos ya en la landing.
; Tampoco se navega si ya estamos MAS adelante, en "Trade for This Card?" (2026-09-23, visto
; en vivo en la misma sesion: los dos toques a ciegas metieron a la donante directo en esa
; pantalla, saltandose el View -- si despues se volvieran a dar, la sacarian de ahi otra vez).
; Corregido el mismo dia (2026-09-23): la primera version de esta guarda usaba los needles
; _native (chequeoRapidoNeedle) y esos NUNCA se validaron. Medido en vivo: con la donante en la
; pantalla exacta del Trade landing, la guarda no la reconocia, disparaba igual los dos toques y
; la sacaba de ahi -- el log quedaba en "llegoTradeForCard=0 vioWaiting=0" estando en el lugar
; correcto. El needle de escala ADB own_donorfinalize_waiting_title SI esta comprobado contra
; una captura real de esa pantalla: matchea desde variation=0. Se usa la via lenta, que tarda
; un poco mas pero es la unica verificada.
if (!esperarNeedleSinAccion("own_donorfinalize_waiting_title", 30, 2500)
    && !esperarNeedleSinAccion("own_donorfinalize_tradeforcard_title", 30, 2500)) {
    tap(141, 511)
    tap(207, 421)
}

; Needle y coordenada recalculadas 2026-08-19 (bug real en vivo, cuenta real): la needle
; vieja (icono "?") ya no matcheaba esta pantalla, y su coordenada de tap tampoco caia
; sobre el boton "View" real -- needle re-recortada del icono "?" fresco de esta pantalla
; real, coordenada recalculada al centro real del boton View (140-400,708-772 en pixeles
; reales de 540x960 -> aprox 141,416 en el sistema logico de este script).
; Chequeo rapido cableado (2026-08-26): needle propia own_donorfinalize_waiting_title_native
; (el badge rojo "!" del boton View -- SOLO aparece cuando hay una oferta real esperando, el
; "?" generico de ayuda de la barra de moneda tambien esta en esta pantalla pero matcheaba
; igual la pantalla de Trade VACIA, sin oferta -- descartado por eso). Validado en vivo:
; limpio hasta variation 60 contra 24 capturas de otras pantallas.
; Reintento estilo Kevin (2026-09-22, bug real reportado por Ale con foto -- corrida de las
; 14:09, "Main Trade failed at step donor_respond_finalize (ERROR: no_aparecio_tradeforcard_
; paso2)"): la donante quedo parada en el Trade landing con el boton View TODAVIA visible. El
; badge "!" matcheo y se toco View una sola vez, pero el toque cayo mientras el juego mostraba
; el spinner de carga y se perdio; paso2 se quedo 15s esperando una pantalla que ya nadie iba
; a abrir, porque nadie volvio a tocar. Es exactamente el caso que clickUntilNeedle de Kevin
; resuelve: se reintenta hasta que aparece la pantalla SIGUIENTE, no hasta que desaparece la
; actual (ese fue el error de diseno del 2026-09-03 con tapHastaQueCambie, que se revirtio).
;
; Dos guardas para que ningun toque caiga fuera de lugar:
;   1) primero se pregunta si ya llegamos a "Trade for This Card?" -- si si, corta sin tocar;
;   2) el toque de View lo sigue dando esperarNeedleYTap, que SOLO toca si el badge "!" del
;      boton View esta visible en ese instante -- y ese badge existe unicamente en el Trade
;      landing con oferta esperando. Durante el spinner de carga no matchea nada y no se toca.
; Se conservan los dos nombres de error de antes: si nunca se llego a ver el landing es
; paso1, si se vio pero nunca avanzo es paso2.
; Popup de finalizar colgado de una corrida anterior (2026-09-24, reproducido en vivo con Ale):
; si el script murio antes con ese popup abierto, al volver a arrancar NO lo reconoce -- el popup
; atenua el fondo, asi que ni la flecha curva de "Trade for This Card?" ni el badge del View
; matchean, y el bucle de abajo gira 45s con llegoTradeForCard=0 vioWaiting=0 sin llegar nunca al
; paso3, que es justo el que sabe cerrarlo. Se cierra aca primero, antes de empezar a mirar.
if (esperarNeedleSinAccion("own_donoroffer_cancel_ok", 30, 2500, "own_donorfinalize_confirm_native", 30)) {
    logDebugFinalize("arranque: habia un popup de finalizar abierto de antes, cerrandolo primero")
    Loop, 12 {
        tap(199, 365)
        Sleep, 2000
        if (!esperarNeedleSinAccion("own_donoroffer_cancel_ok", 30, 1500)) {
            logDebugFinalize("arranque: popup previo cerrado (intento " . A_Index . ")")
            break
        }
    }
}

; Friend Trade (2026-10-04, diseño de Ale): Main tocaba Refresh apenas terminaba su parte; el AMIGO
; responde a mano, cuando quiera. La donante sale de "Waiting for a Response" con la X y recarga
; con la pestaña de abajo (tres personas) + el tile Intercambio hasta que aparece la pantalla de
; Trade con "!" y View (respuesta recibida). Tope 15 min. Despues sigue el bucle de siempre.
if (g_modoExtra = "AMIGO") {
    logDebugFinalize("amigo: esperando que el amigo responda la oferta (tope 15 min)")
    inicioAmigo := A_TickCount
    ultimaRecarga := 0
    ultimoLogAmigo := A_TickCount
    Loop {
        if (chequeoRapidoNeedle("own_donorfinalize_waiting_title_native", 30)) {
            logDebugFinalize("amigo: respuesta recibida (View con '!')")
            break
        }
        if (A_TickCount - inicioAmigo > 15 * 60 * 1000) {
            logDebugFinalize("amigo: FALLO -- 15 min sin respuesta del amigo")
            AdbScreenshot(adbPath, puerto, A_ScriptDir . "\Logs\_amigo_no_respondio_" . g_winTitle . ".png")
            ExitConError("amigo_no_respondio_15min")
        }
        if (A_TickCount - ultimaRecarga >= 6000) {
            if (chequeoRapidoNeedle("own_maintrade_refresh_button_native", 30)) {
                tap(141, 500)          ; X de "Waiting for a Response"
                Sleep, 1500
            }
            tap(141, 511)              ; pestaña de abajo (tres personas): recarga Comunidad
            Sleep, 1500
            tap(207, 421)              ; tile Intercambio (abajo del cartel, ver _MainAcceptTradeOffer)
            ultimaRecarga := A_TickCount
        }
        if (A_TickCount - ultimoLogAmigo >= 60000) {
            logDebugFinalize("amigo: sigue esperando (" . Round((A_TickCount - inicioAmigo) / 60000) . " min)")
            ultimoLogAmigo := A_TickCount
        }
        Sleep, 500
    }
}

vioWaiting := false
llegoTradeForCard := false
inicioView := A_TickCount
; BUCLE RAPIDO estilo Kevin (2026-09-28, medido en vivo con Ale: tardaba en tocar View y en
; llegar a Trade). El bucle viejo (mas abajo, ahora solo de respaldo) encadenaba esperas por ADB
; de 2-2,5 s cada una, y en "Trade for This Card?" encima esperaba 2 s COMPLETOS para confirmar
; que el icono de Refresh NO estaba. Ahora cada vuelta hace capturas nativas rapidas y actua
; segun lo que ve, sin esperas fijas:
;   - "!" de View (pantalla de Trade)          -> tocar View
;   - icono de Refresh (Waiting for a Response) -> tocar Refresh
;   - boton azul de Trade SIN icono de Refresh  -> es "Trade for This Card?", se sigue
; La ultima se exige 2 veces seguidas para no confundir un cuadro de transicion.
ultimoTapView := 0
ultimoTapRefresh := 0
vistoTradeForCard := 0
Loop {
    if (chequeoRapidoNeedle("own_donorfinalize_tradeforcard_title_native", 20)
        && !chequeoRapidoNeedle("own_maintrade_refresh_button_native", 30)) {
        vistoTradeForCard++
        if (vistoTradeForCard >= 2) {
            llegoTradeForCard := true
            break
        }
        Sleep, 250
        continue
    }
    vistoTradeForCard := 0
    if (A_TickCount - ultimoTapRefresh >= 3000 && chequeoRapidoNeedle("own_maintrade_refresh_button_native", 30)) {
        logDebugFinalize("paso1: en 'Waiting for a Response', tocando Refresh (227,373)")
        tap(227, 373)
        ultimoTapRefresh := A_TickCount
    } else if (A_TickCount - ultimoTapView >= 2500 && chequeoRapidoNeedle("own_donorfinalize_waiting_title_native", 30)) {
        logDebugFinalize("paso1: pantalla de Trade con '!', tocando View")
        tap(141, 416)
        ultimoTapView := A_TickCount
        vioWaiting := true
    } else if (A_TickCount - ultimoTapRefresh >= 5000 && esperarNeedleSinAccion("own_donoroffer_waitingresponse_icon", 50, 1)) {
        ; Respaldo del Refresh por ADB (una sola captura): la needle nativa del Refresh salio de
        ; Main; si en la donante no coincidiera, esto evita quedarse sin refrescar.
        logDebugFinalize("paso1: Refresh visto por ADB, tocandolo (227,373)")
        tap(227, 373)
        ultimoTapRefresh := A_TickCount
    }
    if (A_TickCount - inicioView > 45000)
        break
    ; 8 s despues de tocar View sin reconocer "Trade for This Card?" -> a la revision por ADB
    ; (2026-10-04, en vivo con Ale: tardo 45 s). El needle rapido es la esquina del boton azul
    ; "Trade", que tiene un brillo animado: a veces no coincide nunca; el de ADB si lo agarra.
    if (vioWaiting && ultimoTapView && A_TickCount - ultimoTapView > 8000)
        break
    Sleep, 250
}
; Respaldo: el bucle viejo por ADB, solo si el rapido no llego (p. ej. sin ventana nativa).
if (!llegoTradeForCard) {
logDebugFinalize("paso1: el bucle rapido no llego a 'Trade for This Card?', probando el bucle por ADB")
inicioView := A_TickCount
Loop {
    ; La flecha curva SOLA no alcanza (2026-09-23, medido en vivo con Ale): el needle
    ; own_donorfinalize_tradeforcard_title matchea "Trade for This Card?" y "Waiting for a
    ; Response" desde EXACTAMENTE la misma tolerancia (20 en las dos), porque las dos pantallas
    ; tienen la misma flecha curva verde de fondo. No es cuestion de bajar el numero: no las
    ; separa a ninguna tolerancia. Eso hacia que el bucle diera llegoTradeForCard=1 estando en
    ; "Waiting for a Response", tocara (206,459) al vacio y paso3 fallara siempre.
    ; Se distingue por AUSENCIA: "Waiting for a Response" tiene el icono de Refresh (needle
    ; own_donoroffer_waitingresponse_icon, ya validado y sin texto) y "Trade for This Card?" no.
    if (esperarNeedleSinAccion("own_donorfinalize_tradeforcard_title", 30, 2500, "own_donorfinalize_tradeforcard_title_native", 20)
        && !esperarNeedleSinAccion("own_donoroffer_waitingresponse_icon", 50, 2000)) {
        llegoTradeForCard := true
        break
    }
    ; "Waiting for a Response" -> tocar Refresh (2026-09-23, visto en vivo con Ale con las dos
    ; instancias lado a lado: Main ya habia ofrecido su carta y estaba en "Esperando respuesta",
    ; pero la donante seguia en "Waiting for a Response" mostrando solo su propia carta, o sea
    ; que todavia no se habia enterado. El encabezado de este script siempre dijo "Refresca,
    ; acepta el intercambio..." pero el bucle solo tocaba View -- nadie tocaba Refresh nunca, asi
    ; que las dos instancias se quedaban esperandose entre si hasta el timeout.
    ; El icono de Refresh (needle sin texto, ya validado) es el que identifica esta pantalla.
    if (esperarNeedleSinAccion("own_donoroffer_waitingresponse_icon", 50, 2000)) {
        logDebugFinalize("paso1: en 'Waiting for a Response', tocando Refresh (227,373)")
        tap(227, 373, 2500)
    }
    if (A_TickCount - inicioView > 45000)
        break
    if (esperarNeedleYTap("own_donorfinalize_waiting_title", 30, 141, 416, 2500, "own_donorfinalize_waiting_title_native", 30))
        vioWaiting := true
}
}
logDebugFinalize("paso1/2: llegoTradeForCard=" . (llegoTradeForCard ? 1 : 0) . " vioWaiting=" . (vioWaiting ? 1 : 0))
if (!llegoTradeForCard)
    ExitConError(vioWaiting ? "no_aparecio_tradeforcard_paso2" : "no_aparecio_waiting_response_paso1")

; Foto real del trade (2026-08-09, a pedido explicito del usuario -- corregida: se movio de
; la pantalla del swipe a ESTA, "Trade for This Card?", porque ahi se ven las DOS cartas a la
; vez -- la que se manda Y la que se recibe -- en vez de una sola como en el swipe). Se saca
; ANTES de tocar para seguir, mientras la pantalla todavia esta completa. Nombre derivado del
; outputFile (mismo que ya recibe este script como 3er argumento) para que bot.js sepa
; exactamente donde buscarla sin necesitar coordinarse por otro lado.
; Chequeo rapido cableado (2026-08-26): needle propia own_donorfinalize_tradeforcard_title_native
; (la flecha curva verde de intercambio, sin arte de carta), validada en vivo -- limpio hasta
; variation 20 contra 30 capturas de otras pantallas (a variation 40 ya choca con las
; pantallas de Trade Partner, que tienen una forma similar de fondo -- se usa 20 con margen).
; La espera de esta pantalla ya la hizo el bucle de View de mas arriba (2026-09-22) -- llegar
; aca significa que "Trade for This Card?" esta confirmada, asi que se saca la foto directo.
logDebugFinalize("paso2: OK, foto del trade y tocando Trade hasta que salga la confirmacion")
AdbScreenshot(adbPath, puerto, StrReplace(g_outputFile, ".txt", "_TradePhoto.png"))
; Reintento del boton "Trade" (2026-09-24, medido en vivo con Ale): era el ultimo toque sin
; proteger de este script. El log de las 10:25 lo muestra -- paso2 toco una sola vez y paso3 se
; quedo 15s esperando una confirmacion que nunca iba a salir. La coordenada es correcta (device
; 393,824, dentro del boton); lo que falla es el mismo overlay de ocupado del juego de siempre.
; Se reintenta hasta que aparece el popup de confirmar, que es la pantalla SIGUIENTE.
Loop, 10 {
    tap(206, 459)
    ; Sin espera fija (2026-10-03, Ale: "al presionar Trade demora"): antes 1,8 s parado antes
    ; de mirar. Ahora mira la confirmacion seguido (captura nativa) y sigue apenas sale.
    tTrade := A_TickCount
    while (A_TickCount - tTrade < 2500 && !chequeoRapidoNeedle("own_donorfinalize_confirm_native", 30))
        Sleep, 150
    if (esperarNeedleSinAccion("own_donoroffer_cancel_ok", 30, 1500, "own_donorfinalize_confirm_native", 30)) {
        logDebugFinalize("paso2: Trade registrado, confirmacion visible (intento " . A_Index . ")")
        break
    }
    logDebugFinalize("paso2: intento " . A_Index . " -- el toque de Trade no registro todavia")
}

; Chequeo rapido cableado (2026-08-26): needle propia own_donorfinalize_confirm_native (el
; icono "?" de ayuda, atenuado detras del popup de confirmar finalizar), validada en vivo --
; limpio hasta variation 40 contra 30 capturas de otras pantallas.
; Reintento del OK hasta que el popup SE CIERRE (2026-09-24, bug real fotografiado por Ale: el
; script reporto "OK" con el popup "Do you want to finalize this trade?" todavia abierto y sin
; tocar). La cadena medida contra esa captura exacta:
;   1) el toque de OK no registro (mismo overlay de ocupado del juego que en paso10 de Main);
;   2) own_donorfinalize_swipe_instruction matchea ESE popup desde variation 50 -- identico al
;      valor con el que matchea la pantalla real del swipe, asi que paso4 lo dio por bueno y
;      deslizo sobre el popup, sin efecto;
;   3) own_donorfinalize_tap_to_proceed matchea el mismo popup desde variation 10 (falso positivo
;      grave, preexistente), asi que paso5 tambien "paso" y el script declaro exito.
; La raiz es (1): si el popup no se cierra, nada de lo de abajo tiene sentido. Por eso ahora se
; confirma su AUSENCIA antes de seguir, en vez de tocar una vez y asumir.
if (!esperarNeedleSinAccion("own_donoroffer_cancel_ok", 30, 15000, "own_donorfinalize_confirm_native", 30))
    {
        logDebugFinalize("paso3: FALLO -- nunca aparecio la confirmacion de finalizar")
        ExitConError("no_aparecio_confirmar_finalizar_paso3")
    }
logDebugFinalize("paso3: popup de finalizar visible, tocando OK hasta que se cierre")
cerradoPopupFinal := false
Loop, 12 {
    tap(199, 365)
    ; Antes 2 s fijos: ahora espera a que el "?" atenuado de detras del popup deje de verse
    ; (popup cerrado) y recien confirma por ADB como siempre.
    Sleep, 600
    tOk := A_TickCount
    while (A_TickCount - tOk < 2500 && chequeoRapidoNeedle("own_donorfinalize_confirm_native", 30))
        Sleep, 150
    if (!esperarNeedleSinAccion("own_donoroffer_cancel_ok", 30, 1500)) {
        logDebugFinalize("paso3: OK registrado, popup cerrado (intento " . A_Index . ")")
        cerradoPopupFinal := true
        break
    }
    logDebugFinalize("paso3: intento " . A_Index . " -- el popup de finalizar sigue abierto")
}
if (!cerradoPopupFinal)
    {
        logDebugFinalize("paso3: FALLO -- 12 intentos y el popup de finalizar nunca se cerro")
        ExitConError("ok_no_registro_paso3_tras_reintentos")
    }

; Aviso a bot.js (2026-09-28, idea de Ale): la donante ya confirmo el trade. Con este archivo el
; bot arranca el paso de Main (Actualizar + su swipe) YA, en paralelo con el swipe de la donante,
; en vez de esperar a que la donante termine todo (se ganaban ~30 s).
FileAppend, OK, % StrReplace(g_outputFile, ".txt", "_Confirmado.txt")

; Swipe rapido para enviar la carta (142,397)->(145,157) en logico, convertido a
; dispositivo -- a pedido explicito del usuario, duracion corta (150ms) para que
; registre como swipe real y no como un tap.
; REEMPLAZADO 2026-09-16 (a pedido explicito del usuario, "necesito que todo sea para
; cualquier idioma, asi lo hace kevin"): el needle original tenia el texto en INGLES
; "Swipe the card to send it to your..." incrustado -- nunca iba a matchear con una
; cuenta donante en otro idioma. Recorte nuevo: las 2 flechas dobles hacia arriba que
; indican el swipe (icono puro, sin texto, arriba de la carta). Validado contra captura
; real: matchea la pantalla correcta desde variation=10, y recien empieza a dar falsos
; positivos en otras 5 capturas (Trade for This Card?, confirmar finalizar, Comunidad,
; Oferta recibida de Main, Waiting for a Response) a partir de variation=50 -- margen
; de sobra dejando variation=30 como el resto de needles del proyecto. Originales
; (con el texto en ingles) guardados como *_OLD_ENGLISH.png.bak por si hace falta
; comparar.
; Tolerancia 30 -> 60 (2026-09-23, bug real reproducido en vivo con Ale: la corrida de las
; 20:55 murio aca con "no_aparecio_instruccion_swipe_paso4"). Medido contra una captura REAL de
; esta pantalla (Logs\_donorfinalize_test_output2_SwipePhoto.png, del 27/08): el needle nuevo
; -- el que reemplazo al viejo con texto en ingles -- matchea recien desde variation=50, y el
; viejo matcheaba desde 20. Al cambiar el archivo nadie subio el numero, asi que quedo llamado
; con 30 y NUNCA podia matchear: el paso fallaba siempre, no por timing. 60 deja los mismos 10
; puntos de margen que tenia el needle anterior (20 -> 30).
if (!esperarNeedleSinAccion("own_donorfinalize_swipe_instruction", 30, 15000, "own_donorfinalize_swipe_instruction_native", 30))
    {
        logDebugFinalize("paso4: FALLO -- nunca aparecio la instruccion del swipe")
        ExitConError("no_aparecio_instruccion_swipe_paso4")
    }
; Segunda foto de evidencia (2026-08-18, a pedido explicito del usuario): esta pantalla
; ("Swipe the card to send it to your trade partner") muestra la carta sola, justo antes
; de mandarla de verdad -- se guarda ANTES del swipe, mismo criterio que la foto del
; paso 2 (nombre derivado del outputFile para que bot.js sepa donde buscarla).
; Mismo asentamiento que en paso5 (2026-09-25, bug real reportado por Ale): la foto del swipe
; salia con la pantalla "Trade for This Card?" todavia visible y un spinner de carga encima, o
; sea capturada en plena transicion. El needle del swipe matchea esa pantalla con el mismo valor
; que la suya propia, asi que no se separan por tolerancia -- pero si por tiempo: la pantalla del
; trade desaparece y la del swipe se queda. Se exige verla dos veces seguidas antes de la foto.
Loop, 8 {
    Sleep, 1200
    if (esperarNeedleSinAccion("own_donorfinalize_swipe_instruction", 30, 1500, "own_donorfinalize_swipe_instruction_native", 30)) {
        logDebugFinalize("paso4: pantalla del swipe confirmada por segunda vez (intento " . A_Index . ")")
        break
    }
    logDebugFinalize("paso4: la pantalla del swipe todavia no se asienta, esperando (intento " . A_Index . ")")
}
Sleep, 800
logDebugFinalize("paso4: OK, instruccion del swipe visible, sacando foto y deslizando")
AdbScreenshot(adbPath, puerto, StrReplace(g_outputFile, ".txt", "_SwipePhoto.png"))

; Bajar Speed Mod a 1x si esta activo (2026-08-26, bug real confirmado en vivo -- ver
; comentario largo mas abajo en bajarSpeedModA1xSiEstaActivo): con el juego a 3x el swipe de
; abajo NO registra. No hace falta volver a subirlo despues -- a esta altura el trade ya esta
; practicamente terminado, solo queda la pantalla de "Got it!" para cerrar (a pedido explicito
; del usuario, no restaurar).
bajarSpeedModA1xSiEstaActivo()

AdbSwipePropio(adbPath, puerto, 274, 702, 230, 150)
; Los 3 s NO sobran (2026-10-04, probado en vivo con Ale): dejan terminar la animacion de la
; carta volando. Sin ellos el needle del "Got it!" (fondo) coincidia en plena animacion y la foto
; salia con la carta en el aire.
Sleep, 3000

; Tercera foto de evidencia (2026-08-22, a pedido explicito del usuario, mostrando una
; captura real de referencia: la pantalla final "Got it!" que confirma que la carta
; realmente se mando -- las 2 fotos anteriores son ambas de ANTES del swipe, esta es la
; UNICA prueba real de que se registro. Se espera la pantalla SIN tocarla todavia (mismo
; patron que esperarNeedleSinAccion ya usa mas arriba) para sacar la foto limpia antes de
; tocar "Tap to Proceed" y avanzar.
if (!esperarNeedleSinAccion("own_donorfinalize_gotit_bg", 20, 15000, "own_donorfinalize_gotit_bg_native", 20))
    {
        logDebugFinalize("paso5: FALLO -- nunca aparecio el tap to proceed")
        ExitConError("no_aparecio_tap_to_proceed_paso5")
    }
; Esperar a que la pantalla "Got it!" se ASIENTE antes de la foto (2026-09-25, bug real
; reportado por Ale con las dos capturas al lado: la foto salia con la carta a medio aparecer,
; toda lavada, en vez de la pantalla ya formada. El needle own_donorfinalize_tap_to_proceed
; matchea desde variation 10 (falso positivo medido ayer contra el popup de finalizar), asi que
; dispara durante la animacion de entrada y la captura sale a mitad del fundido.
; Se exige ver el needle DOS veces seguidas separadas por 1.2s, mas un margen final, para que
; la carta este completamente renderizada cuando se saca la foto.
Loop, 8 {
    Sleep, 1200
    if (esperarNeedleSinAccion("own_donorfinalize_gotit_bg", 20, 1500, "own_donorfinalize_gotit_bg_native", 20)) {
        logDebugFinalize("paso5: pantalla final confirmada por segunda vez (intento " . A_Index . ")")
        break
    }
    logDebugFinalize("paso5: la pantalla final todavia no se asienta, esperando (intento " . A_Index . ")")
}
Sleep, 1200
logDebugFinalize("paso5: OK, carta enviada, sacando foto final")
AdbScreenshot(adbPath, puerto, StrReplace(g_outputFile, ".txt", "_SentPhoto.png"))
; Sleep antes del toque ciego (2026-08-27, bug real reproducido en vivo en
; _MainAcceptTradeOffer.ahk, mismo patron aca por prevencion).
Sleep, 1200
tap(152, 486)

WriteResult("OK")
Gdip_Shutdown(pToken)
ExitApp, 0
