; _MainAcceptTradeOffer.ahk -- reemplaza main_accept_propose (Kevin). Mapeado 2026-08-03/04.
; Corre en Main despues de que la donante ya ofrecio su carta (_DonorOfferCard.ahk).
; Asume que Main quedo parada en Comunidad (donde la dejo _MainAcceptFriendRequest.ahk).
; Ve la oferta pendiente, la acepta, ordena sus propias cartas por cantidad y ofrece la
; que mas tiene (misma rareza que exige el trade).
; Uso: _MainAcceptTradeOffer.ahk "<winTitle>" "<folderPath>" "<outputFile>"

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
#Include %A_ScriptDir%\_EnergiaIntercambio.ahk

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

global g_hwndFast := WinExist(g_winTitle . " ahk_class Qt5156QWindowIcon")

; Log de depuracion (2026-09-23): este script no tenia NINGUNO -- por eso todos los fallos del
; lado de Main habia que deducirlos de capturas sueltas, a diferencia de la donante, que si deja
; un trace completo en _donoroffer_wishlist_debug.log.
logDebugMain(msg) {
    FileAppend, % A_Hour ":" A_Min ":" A_Sec "." A_MSec " -- " msg "`n", % A_ScriptDir . "\Logs\_maintrade_debug.log"
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

; Reconocimiento real antes de tocar (2026-08-05, a pedido explicito del usuario): espera
; (poll cada 500ms, hasta timeoutMs) a que la needle de la pantalla ESPERADA aparezca antes
; de tocar -- asi un PC lento no rompe el timing.
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
                ; Chequeo de crash EN CADA poll, no solo al principio del script (2026-08-19,
                ; bug real reproducido en vivo: el juego se cerro solo a mitad de la
                ; secuencia de Main ofreciendo su carta -- el chequeo unico de arriba
                ; (verificarNoCrasheado, solo al inicio) no lo agarraba, el script se quedaba
                ; pegado hasta el timeout generico del paso, sin decir que fue un crash de
                ; verdad). Reusa la MISMA captura ya sacada para esta vuelta -- no gasta un
                ; screenshot extra. Solo DETECTA y corta con error claro -- a proposito NO
                ; reintenta reabrir el juego aca (historial ya documentado: intentos previos
                ; de auto-reabrir a mitad de un paso parecian empeorar los crashes). Confiar
                ; en el boton Retry para reiniciar todo de cero es mas seguro, y ahora barato
                ; (inyeccion nueva ~2-7s en vez de 90s+).
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

; Igual que esperarNeedleYTap pero sin ninguna accion al encontrarla (2026-08-22, mismo
; patron ya usado en _DonorOfferCard.ahk/_DonorRespondAndFinalize.ahk): deja la pantalla
; intacta para poder sacar una foto real ANTES de tocar.
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

; Paso 1+2 fusionados, v2 (2026-08-18, bug real reproducido en vivo: confirmado que la
; donante SI tenia una oferta real y pendiente -- "Waiting for a Response" de su lado --
; pero Main nunca la detectaba). La v1 de este fix (mas arriba en el historial) todavia
; dependia de ver el aviso transitorio (badge/banner) en Social Hub ANTES de animarse a
; entrar al tile de Trade -- si ese aviso ya se habia apagado (que es lo normal, dura muy
; poco), el script se quedaba esperando en Social Hub para siempre sin nunca entrar a
; Trade, aunque el boton "Ver" real ya estuviera esperando ADENTRO de esa seccion, de forma
; ESTABLE (confirmado en vivo: "Trade offer received" + boton "View" con el "!" rojo, sin
; ningun parpadeo, mientras la oferta siga pendiente). Ahora la logica es mas simple y
; directa: entra al tile de Trade SIEMPRE, sin condicion (es inofensivo hacerlo aunque no
; haya ninguna oferta pendiente -- solo abre la seccion de Trade normal), y recien ADENTRO
; busca el boton "Ver" real con el timeout largo de siempre.
; REFORZADO Y RECONSTRUIDO (2026-08-19, bug real reproducido en vivo, varios intentos):
; own_maintrade_view_button.png (el boton "View" en si) resulto tener SHIMMER -- el mismo
; problema de color que cambia de tono en cada captura ya documentado en otros botones de
; este juego (ver comentarios de "OK ya habilitado" en _DonorOfferCard.ahk/paso10) -- se
; capturo turquesa pero en vivo aparecio azul/violeta, diferencia de canal de hasta 122/255.
; Ni el badge rojo "!" (descartado antes, puede desaparecer en un Retry si ya se vio) ni la
; forma del boton (tambien shimmer, el color forma parte de la forma) sirven. Solucion real:
; dejar de intentar needlear el boton que shimmea, y en cambio confirmar la pantalla con el
; banner verde ESTABLE "Trade offer received" que aparece arriba -- pero solo una franja de
; color solido sin ninguna letra (a pedido explicito del usuario, para no depender de texto
; en ingles), tomada de un borde del banner donde no hay texto. Verificado con diff pixel a
; pixel (metrica por canal, no promedio -- ver leccion tecnica real de este mismo dia) contra
; la pantalla real con oferta (match perfecto) Y contra las pantallas SIN oferta real
; ("Select a Friend" y "Trade" vacio, que tambien tienen verde en su propio header/icono):
; diferencia minima de 154-205/255 en ambas, sin riesgo real de falso positivo. Una vez
; confirmada la pantalla, se toca el boton "View" a ciegas en su coordenada fija (mismo
; criterio que "OK ya habilitado" en el otro script) -- no hace falta encontrar el boton en
; si, solo confirmar que estamos en la pantalla correcta.
esperarViewButtonYTap(timeoutMs := 35000) {
    global adbPath, puerto, g_winTitle
    ; (207,421) y no (207,402) (2026-10-04, bug real en vivo con Ale): con una oferta recibida, el
    ; juego pone el cartel verde "Oferta de intercambio recibida" en la mitad del tile y ese cartel
    ; se come el toque. Se toca abajo, sobre el nombre del tile. Mismo cambio en todos los scripts.
    inicio := A_TickCount
    matchesSeguidos := 0
    ultimoRefresco := A_TickCount
    ultimoTapTile := 0
    Loop {
        ; Estilo Kevin (2026-10-06, en vivo con Ale: 4 toques a Intercambio sin entrar). Los toques
        ; eran a ciegas -- al arrancar y 1,5 s despues de tocar la pestaña Comunidad, en plena
        ; animacion -- y el juego los ignoraba. Ahora: mientras se VEA Comunidad (icono de Amigos,
        ; sin texto) se toca Intercambio cada 2,5 s, hasta que entre.
        if (chequeoRapidoNeedle("own_mainaccept_friends_icon_native", 30)) {
            if (A_TickCount - ultimoTapTile >= 2500) {
                tap(207, 421)
                ultimoTapTile := A_TickCount
                ultimoRefresco := A_TickCount
            }
            Sleep, 300
            if (A_TickCount - inicio > timeoutMs)
                return false
            continue
        }
        ; Recargar la pantalla (2026-09-28, bug real en vivo con Ale): el juego NO actualiza la
        ; pantalla de Intercambio sola. Si Main entraba justo antes de que la oferta llegara del
        ; servidor, se quedaba viendo "Puedes intercambiar cartas con amigos" (sin oferta) y se
        ; vencian los 35 s. Cada 8 s sin ver el "!", sale a Comunidad y vuelve a entrar.
        if (A_TickCount - ultimoRefresco > 8000) {
            logDebugMain("paso1: 8 s sin ver la oferta, saliendo a Comunidad y volviendo a entrar para recargar")
            tap(141, 511, 1500)   ; pestana Comunidad (el tile lo toca la vuelta siguiente, al ver Comunidad)
            ultimoRefresco := A_TickCount
            matchesSeguidos := 0
            continue
        }
        ; Chequeo rapido cableado (2026-08-26): needle propia
        ; own_maintrade_offer_received_banner_native.
        ; Recortada de nuevo (2026-09-25, auditoria de needles con texto en ingles): antes era
        ; la franja con el texto "Trade offer received" -- texto en ingles, y ademas nunca iba
        ; a matchear una cuenta en español ("Oferta de intercambio recibida"). Ahora es el
        ; badge rosado "!" de la esquina del boton Ver (13x13, recorte en 185,405 de la captura
        ; nativa real): sin ninguna letra, sin arte de carta y sin avatar, o sea independiente
        ; del idioma y de la cuenta. Validada contra la pantalla real con oferta (match desde
        ; variation 0, posicion exacta 185,405) y barrida contra 156 capturas nativas de otras
        ; pantallas: CERO falsos positivos, la mas parecida queda a 99/255 (se usa con 30).
        ; Si algun dia el badge no estuviera (oferta ya "leida"), el fallback por ADB de abajo
        ; -- own_maintrade_offer_received_banner, franja de color sin texto -- sigue cubriendo.
        ; Se mantiene intacta la
        ; doble confirmacion (matchesSeguidos >= 2) que ya existia por el bug real de 2026-08-19
        ; -- esto solo cambia DE DONDE sale la captura (rapida en vez de ADB), no la logica.
        ; Popup de tradeo cancelado/sin acuerdo (2026-09-27, pedido de Ale): tapa la pantalla de
        ; Intercambio; se cierra con Vale y se sigue esperando el boton Ver.
        if (chequeoRapidoNeedle("own_maintrade_sinacuerdo_popup_native", 30)) {
            logDebugMain("popup de tradeo cancelado/sin acuerdo visible, tocando Vale")
            tap(137, 381)
            Sleep, 1200
            continue
        }
        encontrado := chequeoRapidoNeedle("own_maintrade_offer_received_banner_native", 30)
        if (!encontrado) {
            tempFile := A_ScriptDir . "\Logs\_step_check_" . g_winTitle . ".png"
            AdbScreenshot(adbPath, puerto, tempFile)
            if (FileExist(tempFile)) {
                pBitmap := Gdip_CreateBitmapFromFile(tempFile)
                FileDelete, %tempFile%
                if (pBitmap) {
                    pView := Gdip_CreateBitmapFromFile(A_ScriptDir . "\Needles\own_maintrade_offer_received_banner.png")
                    vPos := ""
                    encontrado := (pView && buscarNeedleZonal(pBitmap, pView, vPos, 30, "own_maintrade_offer_received_banner") = 1)
                    Gdip_DisposeImage(pBitmap)
                }
            }
        }
        if (encontrado) {
            matchesSeguidos++
            if (matchesSeguidos >= 2) {
                tap(143, 424)
                return true
            }
        } else {
            matchesSeguidos := 0
        }
        if (A_TickCount - inicio > timeoutMs)
            return false
        Sleep, 500
    }
}

if (!esperarViewButtonYTap())
    {
        logDebugMain("FALLO en no_aparecio_oferta_pendiente_paso1")
        ExitConError("no_aparecio_oferta_pendiente_paso1")
    }
logDebugMain("paso1: OK, oferta vista y View tocado")
; Needle reemplazado (2026-09-17, bug real reproducido en vivo con Ale, cuenta de Main en
; ESPAÑOL -- "Oferta de intercambio recibida"): own_maintrade_trade_button_confirm_native
; (chequeo rapido) era el titulo en ingles "Trade Offer Received" -- nunca iba a matchear en
; otro idioma. Encima own_maintrade_trade_button (el needle LENTO por ADB, el que en teoria
; debia servir de respaldo) tampoco matcheaba esta pantalla real -- confirmado con la captura
; real del fallo, "sin match hasta variation=100" -- estaba mal calibrado (recorte de un
; corazon distinto, de otra pantalla).
; Primer reemplazo (el corazon de wishlist de esta pantalla) DESCARTADO tras confirmar en vivo
; con Ale ("es porque la carta se mueve, usa otro"): el corazon tiene una animacion sutil de
; brillo/pulso -- 4 capturas reales de la MISMA pantalla necesitaron variation 10, 60, 100 y 130
; entre si, un needle inestable pese a separar bien de otras pantallas.
; Reemplazado de nuevo por el icono del reloj (badge "2 dias", solo el reloj sin el numero/texto
; -- confirmado PIXEL A PIXEL identico entre 2 capturas reales separadas en el tiempo, sin
; ninguna animacion). Validado contra 15 capturas de otras pantallas del pipeline: el falso
; positivo mas cercano recien aparece en variation=70, la pantalla objetivo matchea desde
; variation=10 en ambas capturas reales -- variation 40 usado aca, margen parejo de los dos
; lados. Sin needle nativa todavia (no se pudo capturar la ventana nativa hoy) -- cae siempre al
; chequeo lento por ADB, un poco mas lento pero funciona en cualquier idioma.
; Reintento de View estilo Kevin (2026-10-08, log real de un usuario: "View tocado" y 16 s despues
; FALLO en paso3). El toque a View se hacia UNA vez; si el juego no lo agarraba, Main se quedaba en
; la pantalla de Intercambio esperando una pantalla que nunca iba a abrir. Ahora, mientras se siga
; viendo el boton View con su "!", se vuelve a tocar cada 2,5 s. Apenas aparece el reloj de la
; pantalla de la oferta, se toca Intercambiar como siempre. Tope 20 s.
inicioP3 := A_TickCount
ultimoTapView := A_TickCount
llegoOferta := false
Loop {
    if (esperarNeedleSinAccion("own_maintrade_trade_button", 40, 1)) {
        llegoOferta := true
        break
    }
    if (A_TickCount - inicioP3 > 20000)
        break
    if (A_TickCount - ultimoTapView >= 2500 && chequeoRapidoNeedle("own_maintrade_offer_received_banner_native", 30)) {
        logDebugMain("paso3: View sigue a la vista, el toque no entro -- tocando View otra vez")
        tap(143, 424)
        ultimoTapView := A_TickCount
    }
    Sleep, 300
}
if (!llegoOferta)
    {
        logDebugMain("FALLO en no_aparecio_intercambiar_button_paso3")
        ExitConError("no_aparecio_intercambiar_button_paso3")
    }
Sleep, 900
tap(204, 460)
logDebugMain("paso3: Intercambiar tocado")
; Chequeo rapido cableado (2026-08-26): needle propia own_maintrade_choosecard_title_native
; (titulo "Choose a Card to Trade", recorte mas ajustado que el de la donante -- ese incluia
; unas lineas de mas que si difieren entre las 2 variantes de esta pantalla, este matchea
; ambas), validada en vivo -- limpio contra 21 capturas de otras pantallas.
if (!esperarNeedleYTap("own_maintrade_choosecard_title", 30, 251, 496, 15000, "own_maintrade_choosecard_title_native", 30))
    {
        logDebugMain("FALLO en no_aparecio_elige_carta_paso4")
        ExitConError("no_aparecio_elige_carta_paso4")
    }
logDebugMain("paso4: elegir carta visible, boton Ordenar tocado")

; Reconocimiento de imagen (2026-08-04, a pedido explicito del usuario): "Por cantidad de
; cartas" alterna asc/desc cada vez que se toca (o puede no estar seleccionada todavia la
; primera vez), asi que no se puede tocar a ciegas -- se revisa hasta 2 veces: si ya esta
; con la flecha hacia ARRIBA (mas cantidad primero, lo que buscamos) no se toca mas; si no,
; se toca y se vuelve a revisar.
estaFlechaArriba() {
    global adbPath, puerto
    tempFile := A_ScriptDir . "\Logs\_ordenar_check.png"
    AdbScreenshot(adbPath, puerto, tempFile)
    if (!FileExist(tempFile))
        return false
    resultado := false
    pOrdenar := Gdip_CreateBitmapFromFile(tempFile)
    FileDelete, %tempFile%
    if (pOrdenar) {
        pFlechaArriba := Gdip_CreateBitmapFromFile(A_ScriptDir . "\Needles\own_sort_up.png")
        if (pFlechaArriba) {
            vPos := ""
            resultado := (buscarNeedleZonal(pOrdenar, pFlechaArriba, vPos, 30, "own_sort_up") = 1)
        }
        Gdip_DisposeImage(pOrdenar)
    }
    return resultado
}

; Bug real reportado en vivo 2026-09-16 (el usuario vio el toggle "hacerse demasiado
; rapido" y que despues la X del menu Sort no se tocaba bien): tap() por defecto no
; espera nada (esperaMs=0) -- el loop volvia a sacar captura para revisar
; estaFlechaArriba() en el mismo instante del toque, antes de que la UI terminara de
; reflejar el cambio de flecha, arriesgando una lectura vieja/a mitad de animacion que
; desincroniza el resto del paso. Mismo margen (700ms) que ya usan otros toggles
; similares en estos scripts.
; Espera a que el panel "Ordenar" este REALMENTE abierto antes de mirar la flecha (2026-09-23,
; bug real reproducido en vivo con Ale -- el vio la flecha ya en ARRIBA y el bot igual la toco,
; invirtiendo el orden: quedaban primero las cartas con MENOS copias en vez de las que tienen
; mas). Causa encontrada con la captura que el propio estaFlechaArriba() guarda
; (Logs\_ordenar_check.png): mostraba la lista de cartas ("Elige que carta intercambiar"), NO el
; panel "Ordenar" -- el chequeo corria antes de que el panel terminara de abrir, buscaba una
; flecha en una pantalla donde no hay ninguna, no la encontraba y tocaba igual.
; Se descarto que fuera el needle: medido contra capturas reales de las DOS posiciones, el
; own_sort_up.png actual matchea la flecha arriba desde variation=10 y recien confunde la flecha
; abajo en 120 -- con la tolerancia 30 que usa el codigo, separa perfecto. El needle esta bien;
; lo que fallaba era mirar la pantalla equivocada.
; Se reusa own_maintrade_sortpanel_icon (el icono "#" del panel, sin texto) que ya se usa mas
; abajo para verificar que el panel se cerro.
inicioPanel := A_TickCount
Loop {
    if (panelOrdenarAbierto())
        break
    if (A_TickCount - inicioPanel > 8000)
        break  ; no se pudo confirmar -- se sigue igual, mismo comportamiento que antes
    Sleep, 300
}
logDebugMain("paso5: panel Ordenar abierto (o 8 s sin confirmar)")
Loop, 2 {
    if (estaFlechaArriba())
        break
    tap(233, 348, 700)  ; "Por cantidad de cartas" -- selecciona/alterna hacia flecha arriba
}
logDebugMain("paso5: flecha revisada")

; Cierre VERIFICADO del panel "Ordenar" (2026-09-19, bug real reproducido en vivo con Ale):
; el cierre con la X se habia eliminado el 2026-09-16 al ver que elegir la opcion cerraba el
; panel solo -- pero el juego RECUERDA el orden de la vez anterior: si ya estaba en "cantidad
; flecha arriba", el loop de arriba no toca nada, el panel queda ABIERTO, y los toques a ciegas
; de los pasos siguientes caen encima del panel (Main quedo trabada asi, con el panel abierto).
; Flujo indicado por Ale: si la flecha esta abajo se toca para pasarla arriba (loop de arriba),
; y SIEMPRE se cierra con la X. Aca se confirma de verdad que el panel este abierto antes de
; tocar la X (needle propia own_maintrade_sortpanel_icon, el icono "#" de la primera fila, que
; solo existe dentro del panel -- validado: matchea el panel desde variation 10, cualquier otra
; pantalla recien desde 140+), y se reintenta hasta que desaparezca.
panelOrdenarAbierto() {
    global adbPath, puerto
    tempFile := A_ScriptDir . "\Logs\_sortpanel_check.png"
    AdbScreenshot(adbPath, puerto, tempFile)
    abierto := false
    if (FileExist(tempFile)) {
        pBitmap := Gdip_CreateBitmapFromFile(tempFile)
        FileDelete, %tempFile%
        if (pBitmap) {
            pNeedle := Gdip_CreateBitmapFromFile(A_ScriptDir . "\Needles\own_maintrade_sortpanel_icon.png")
            if (pNeedle) {
                vPos := ""
                abierto := (buscarNeedleZonal(pBitmap, pNeedle, vPos, 40, "own_maintrade_sortpanel_icon") = 1)
                Gdip_DisposeImage(pNeedle)
            }
            Gdip_DisposeImage(pBitmap)
        }
    }
    return abierto
}
Loop, 4 {
    if (!panelOrdenarAbierto())
        break
    Sleep, 500
    tap(140, 501, 800)  ; X del panel "Ordenar"
}
logDebugMain("paso5: panel Ordenar cerrado")

; Paso 5 ELIMINADO (2026-09-16, bug real reproducido en vivo y confirmado paso a paso a
; mano contra la cuenta real de Main): este paso asumia que el panel "Ordenar" se quedaba
; abierto despues de elegir "Por cantidad de cartas", necesitando un toque aparte sobre su
; boton X para cerrarlo. Confirmado en vivo que eso es falso -- el panel se CIERRA SOLO en
; el mismo toque que selecciona la opcion, volviendo directo a la lista ya reordenada. El
; toque a ciegas en (140,501) que hacia este paso (pensado para la X) caia entonces sobre
; lo que sea que hubiera ahi en la lista de cartas real -- normalmente una carta -- en vez
; de una X inexistente, desincronizando el resto del flujo. Ademas la needle en si
; (own_maintrade_x_sort_native) tenia la palabra "Sort" en ingles incrustada, asi que
; nunca iba a matchear contra el panel real "Ordenar" en español -- doble motivo para
; sacarlo en vez de arreglarlo.
; Misma pantalla que el paso 4 -- la carta en si varia por cuenta, no se puede needlear,
; se toca a ciegas (48,357 en la donante / 52,456 aca) ya confirmado el encabezado.
; Needle rapida reutilizada (2026-08-26): own_maintrade_choosecard_title_native, ya validada.
if (!esperarNeedleYTap("own_maintrade_choosecard_title", 30, 52, 456, 15000, "own_maintrade_choosecard_title_native", 30))
    {
        logDebugMain("FALLO en no_aparecio_lista_cartas_paso6")
        ExitConError("no_aparecio_lista_cartas_paso6")
    }
logDebugMain("paso6: carta tocada a ciegas (52,456)")
; Toque en zona neutra (2026-09-27, idea de Ale): si Main tiene el speed mod al maximo, tocar la
; carta puede abrirla AGRANDADA, y ahi no se ve la lupa, asi que el paso de Vale de abajo se
; quedaba esperando. Tocar FUERA de la carta agrandada la cierra; se toca en (150,60), el titulo
; "Elige que carta intercambiar". Probado en vivo con Ale: con la carta agrandada la cierra y la
; carta sigue seleccionada; con la pantalla normal no hace nada (es texto, no boton). OJO: un
; punto en el medio de la pantalla NO sirve, porque la carta agrandada lo tapa (probado: el toque
; en (137,255) caia sobre la carta y no la cerraba). NO se toca Vale a ciegas: sin speed mod eso
; confirmaria la carta antes de tiempo.
; Se toca 2 veces (pedido de Ale): el primero cierra la carta agrandada, el segundo -- ya en la
; pantalla normal -- no hace nada. Asi nunca se depende de tocar Vale para salir del zoom.
Sleep, 1000
Loop, 2 {
    tap(150, 60)
    Sleep, 700
}
; own_maintrade_ok_selected SACADA de aca (2026-08-05, mismo motivo que la donante): el
; boton OK tiene un shimmer de color que cambia de tono en cada captura, no se puede
; needlear de forma confiable. Se reutiliza la needle estable del titulo en su lugar.
; Reintento del OK (2026-09-27, idea de Ale): si con la velocidad al maximo la carta se abre
; agrandada (fondo borroso), el toque en OK (138,460) cae sobre el fondo y solo CIERRA el zoom, dejando la
; pantalla de nuevo en "elegir carta" sin que nadie toque OK. Mientras la lupa de esa pantalla
; siga visible se vuelve a tocar OK (hasta 3 veces). Si la carta no se agrando, al primer chequeo
; ya salio la vista previa (la lupa no esta) y no se toca nada de mas.
reintentarOkSiSigueEnElegirCarta() {
    Loop, 3 {
        Sleep, 1500
        if (!chequeoRapidoNeedle("own_maintrade_choosecard_title_native", 30))
            return
        logDebugMain("paso7: sigue en elegir carta (zoom cerrado o toque perdido), tocando OK otra vez")
        tap(138, 460)
    }
}
if (!esperarNeedleYTap("own_maintrade_choosecard_title", 30, 138, 460, 15000, "own_maintrade_choosecard_title_native", 30))
    {
        logDebugMain("FALLO en no_aparecio_ok_habilitado_paso7")
        ExitConError("no_aparecio_ok_habilitado_paso7")
    }
; Reintento del OK RETIRADO 2026-09-28 (bug real en vivo con Ale): volvia a tocar OK si 1,5 s
; despues la lupa seguia a la vista, pero a veces la pantalla todavia no habia terminado de
; cambiar; el segundo toque caia sobre la vista previa y desordenaba los pasos siguientes. La
; carta agrandada ya la resuelven los 2 toques en el titulo (150,60) antes del OK.
; Chequeo rapido cableado (2026-08-26): needle propia own_maintrade_tradepartner_header_native
; ("Trade Partner" + la barra de moneda/energia de arriba -- el recorte ajustado solo al
; texto daba falso positivo contra la pantalla "Trade Offer Received", que tambien muestra
; "Trade Partner"; ampliado hacia arriba para diferenciarlas). Validada en vivo -- limpio
; hasta variation 40 contra 24 capturas de otras pantallas.
if (!esperarNeedleSinAccion("own_maintrade_tradepartner_header", 20, 15000, "own_maintrade_tradepartner_header_native", 30))
    {
        logDebugMain("FALLO en no_aparecio_preview_envio_paso8")
        ExitConError("no_aparecio_preview_envio_paso8")
    }
Sleep, 900
; Sin energia de intercambio (2026-10-08, Ale): se recupera 1 con relojes (_EnergiaIntercambio.ahk).
if (faltaEnergiaIntercambio()) {
    logDebugMain("paso8: sin energia de intercambio, recuperando con relojes")
    if (!recuperarEnergiaIntercambio())
        ExitConError("sin_energia_intercambio")
    Sleep, 900
}
tap(197, 464)
; Chequeo rapido cableado (2026-08-26): needle propia own_donoroffer_setcard_confirm_native,
; ya validada en _DonorOfferCard.ahk -- matchea exacto tambien esta pantalla del lado de Main
; (mismo popup real, confirmado en vivo).
; Reintento del "Vale" estilo Kevin (2026-09-23, bug real reproducido en vivo con Ale -- la
; corrida de las 21:5x murio aca con "no_aparecio_confirmar_set_card_paso9" y la captura de
; Main mostraba el preview de Pawmot con el boton "Vale" TODAVIA sin tocar). Es el mismo toque
; perdido que ya arreglamos en el OK del popup "offered" (_DonorOfferCard.ahk paso14) y en el
; boton View (_DonorRespondAndFinalize.ahk): el paso anterior toca una sola vez, ese toque no
; registra, y este se queda 15s esperando una pantalla que ya nadie va a abrir.
; Se reintenta el toque del preview hasta que aparece la confirmacion, y solo mientras el
; preview siga en pantalla -- si ya avanzo y el juego esta cargando, no se toca nada de mas.
vioConfirm := false
inicioVale := A_TickCount
Loop {
    if (esperarNeedleSinAccion("own_donoroffer_cancel_ok", 30, 2500, "own_donoroffer_setcard_confirm_native", 20)) {
        vioConfirm := true
        break
    }
    if (A_TickCount - inicioVale > 30000)
        break
    ; el preview sigue ahi -> el "Vale" no entro, se vuelve a tocar
    esperarNeedleYTap("own_maintrade_tradepartner_header", 20, 197, 464, 2500, "own_maintrade_tradepartner_header_native", 30)
}
if (!vioConfirm)
    {
        logDebugMain("FALLO en no_aparecio_confirmar_set_card_paso9")
        ExitConError("no_aparecio_confirmar_set_card_paso9")
    }
tap(198, 367)
; Toque perdido del "Vale" de la confirmacion (2026-09-28, revision estilo Kevin con Ale): se
; tocaba una sola vez y despues se esperaban 15 s. Si la confirmacion sigue a la vista 2,5 s
; despues del toque, se vuelve a tocar, hasta que aparezca la pantalla siguiente.
ultimoTapSetCard := A_TickCount
inicioSetCard := A_TickCount
while (A_TickCount - inicioSetCard < 12000 && !esperarNeedleSinAccion("own_maintrade_offered_confirm", 60, 1)) {
    if (A_TickCount - ultimoTapSetCard >= 2500 && chequeoRapidoNeedle("own_donoroffer_setcard_confirm_native", 20)) {
        logDebugMain("paso9: la confirmacion sigue abierta, tocando Vale de nuevo")
        tap(198, 367)
        ultimoTapSetCard := A_TickCount
    }
    Sleep, 250
}
; Needle propia separada de la donante (2026-08-19, bug real en vivo -- own_donoroffer_offered_text
; era compartida entre este script y _DonorOfferCard.ahk, y la needle vieja ya no matcheaba
; esta pantalla de Main, dejando el boton "OK" sin tocar aunque el paso se reportara ok).
; own_maintrade_offered_confirm es la curva redondeada del boton OK, recortada fresca de
; esta pantalla real (forma, no el color plano que puede tener shimmer).
; Foto de evidencia (2026-08-22, a pedido explicito del usuario): "Main ofrece la carta",
; misma logica que _OfferPhoto.png del lado de la donante -- se espera la pantalla SIN
; tocarla todavia para sacar la foto limpia antes de confirmar con OK.
; Chequeo rapido cambiado de own_donoroffer_offered_text_native a own_donoroffer_offered_mascot
; (2026-09-17, mismo motivo que _DonorOfferCard.ahk -- el needle de texto en ingles nunca iba a
; matchear en una cuenta de Main en otro idioma) -- DESCARTADO el mismo dia, confirmado en vivo
; con Ale: la mascota aparece y desaparece en esta MISMA pantalla de la MISMA cuenta (presente
; con "Main ofreció Heatmor", ausente con "Main ofreció Pawmot" minutos despues) -- no es un
; elemento fijo, probablemente un cosmetico/animacion condicional. Sacada del todo. En su lugar
; se sube la tolerancia del needle LENTO own_maintrade_offered_confirm (la curva del boton OK,
; ya independiente del texto/mascota) de 30 a 60 -- confirmado contra las 2 capturas reales de
; Main (Pawmot variation=50, Heatmor variation=20), sin needle nativa rapida por ahora.
if (!esperarNeedleSinAccion("own_maintrade_offered_confirm", 60, 15000))
    ExitConError("no_aparecio_confirmacion_final_paso10")
AdbScreenshot(adbPath, puerto, StrReplace(g_outputFile, ".txt", "_MainOfferPhoto.png"))
; Sleep antes del toque ciego (2026-08-27, bug real reproducido en vivo): el chequeo rapido
; nuevo confirma la pantalla casi al instante -- mas rapido que el tiempo que el boton OK
; puede tardar en terminar de habilitarse/renderizar del todo, y el toque a ciegas se perdia
; sin registrar nada. Mismo patron ya usado en otros lados de este pipeline para esta misma
; clase de bug (needle SIN tocar + Sleep + tap manual).
Sleep, 1200

; Toca y VERIFICA que el popup se haya cerrado de verdad, con reintento (2026-08-27, bug real
; reproducido en vivo, confirmado con foto de diagnostico: el toque a ciegas caia justo en el
; centro del boton OK -- verificado a mano contra la foto real -- pero el popup seguia
; intacto despues igual, incluso con los Sleep de arriba ya puestos. No es un problema de
; coordenada ni de needle: el toque en si no estaba registrando, probablemente porque el juego
; todavia esta confirmando la oferta con el servidor en ese instante puntual y el boton no es
; realmente interactivo todavia aunque ya se vea listo). En vez de asumir que un solo toque a
; ciegas alcanza (que fue lo que dejaba a Main pegada en el popup, reportando "ok" igual, y
; rompiendo _MainRefreshAfterTrade.ahk mas adelante porque nunca lo encontraba realmente
; cerrado), ahora se re-verifica el mismo needle despues de cada toque y se reintenta hasta 5
; veces antes de darlo por fallado de verdad.
; Chequeo rapido nativo sacado del todo (2026-09-17, misma mascota descartada de arriba --
; no es un elemento fijo, no sirve ni para confirmar presencia ni ausencia del popup). Cae
; siempre al chequeo lento por ADB con own_maintrade_offered_confirm (misma needle y tolerancia
; que el paso10 de arriba, ya independiente de texto/mascota).
popupOfrecidoSigueAhi() {
    global adbPath, puerto
    tempFile := A_ScriptDir . "\Logs\_step_check_verify_ok.png"
    AdbScreenshot(adbPath, puerto, tempFile)
    encontrado := false
    if (FileExist(tempFile)) {
        pBitmap := Gdip_CreateBitmapFromFile(tempFile)
        FileDelete, %tempFile%
        if (pBitmap) {
            pNeedle := Gdip_CreateBitmapFromFile(A_ScriptDir . "\Needles\own_maintrade_offered_confirm.png")
            if (pNeedle) {
                vPos := ""
                encontrado := (buscarNeedleZonal(pBitmap, pNeedle, vPos, 60, "own_maintrade_offered_confirm") = 1)
                Gdip_DisposeImage(pNeedle)
            }
            Gdip_DisposeImage(pBitmap)
        }
    }
    return encontrado
}

; Doble confirmacion + log (2026-09-23, bug real fotografiado en vivo por Ale: el script
; termino con "OK" pero la captura de Main mostraba el popup "Has ofrecido la carta..." con el
; boton "Vale" TODAVIA sin tocar). O sea que popupOfrecidoSigueAhi() dio un FALSO NEGATIVO --
; dijo que el popup ya no estaba cuando seguia en pantalla -- probablemente midiendo justo en
; una animacion. La coordenada esta bien: tap(143,431) cae en device (273,769), centro exacto
; del boton. Ahora se exige ver el popup ausente DOS veces seguidas (separadas 700ms) antes de
; darlo por cerrado, y cada intento queda logueado para no volver a diagnosticar a ciegas.
; 5 intentos x 1s -> 12 x 2s (2026-09-24, medido en vivo con Ale): el log mostro los 5 intentos
; seguidos ("el popup sigue abierto, reintentando Vale") en solo 6.5 segundos, y la captura de
; ese momento muestra por que no alcanzaba -- la pantalla estaba ATENUADA, con el overlay de
; ocupado del juego mientras confirma la oferta con el servidor. La coordenada es correcta
; (device 273,769, centro exacto del boton, que hasta se ve presionado): el toque llega pero el
; juego no lo acepta mientras procesa. Contra eso no sirve tocar mas rapido, sirve darle tiempo.
; 12 x 2s = ~30s de margen, que sigue muy por debajo del timeout del paso.
cerrado := false
Loop, 12 {
    tap(143, 431)
    Sleep, 2000
    if (!popupOfrecidoSigueAhi()) {
        Sleep, 700
        if (!popupOfrecidoSigueAhi()) {
            logDebugMain("paso10: OK registrado, popup cerrado (intento " . A_Index . ")")
            cerrado := true
            break
        }
        logDebugMain("paso10: intento " . A_Index . " -- el popup parecia cerrado pero seguia ahi en la reconfirmacion")
    } else {
        logDebugMain("paso10: intento " . A_Index . " -- el popup sigue abierto, reintentando Vale")
    }
}
if (!cerrado)
    ExitConError("ok_no_registro_paso10_tras_reintentos")

; Paso 11 (2026-09-17, a pedido explicito del usuario -- mismo mecanismo agregado en
; _DonorOfferCard.ahk): segunda foto de evidencia, de la pantalla "Waiting for a Response" que
; queda del lado de Main despues de confirmar su propia oferta. bot.js arma un collage de 2
; paneles con esta + _MainOfferPhoto.png. Del lado de Main esta pantalla muestra AMBAS cartas
; (la de la donante y la de Main, ya que a esta altura las dos ya se ofrecieron) en vez de una
; sola -- mismo needle own_donoroffer_waitingresponse_icon (icono de Refresh, sin texto),
; confirmado en vivo que matchea igual en esta variante de 2 cartas (captura real "Voltorb +
; Wurmple", variation=20). Variation 50 por el mismo margen visto en vivo del lado de la
; donante hoy. Best-effort: si no llega a tiempo, no corta el trade -- bot.js manda la foto
; sola (_MainOfferPhoto.png) si esta segunda captura no existe.
if (esperarNeedleSinAccion("own_donoroffer_waitingresponse_icon", 50, 8000)) {
    AdbScreenshot(adbPath, puerto, StrReplace(g_outputFile, ".txt", "_MainWaitingResponsePhoto.png"))
}

WriteResult("OK")
Gdip_Shutdown(pToken)
ExitApp, 0
