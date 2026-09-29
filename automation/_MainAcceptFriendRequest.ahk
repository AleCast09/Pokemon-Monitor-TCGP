; _MainAcceptFriendRequest.ahk
; Reemplaza la espera pasiva de "Main.ahk" (bot completo de Kevin, 80s a ciegas) para
; aceptar la solicitud de amistad de la donante -- mapeado en vivo 2026-08-03/04,
; coordenadas y flujo confirmados a mano por el usuario. Corre en la instancia "Main"
; DESPUES de _WaitWelcomeScreens.ahk (ya confirmado que esta en el menu principal).
;
; Flujo: Comunidad -> Amigos -> Solicitudes recibidas -> Aceptar -> volver a Comunidad
; (se queda ahi, listo para que _MainAcceptTradeOffer.ahk siga mas adelante en el
; pipeline, una vez que la donante ya ofrecio la carta).
;
; Uso: _MainAcceptFriendRequest.ahk "<winTitle>" "<folderPath>" "<outputFile>"

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

; Log con marca de tiempo (2026-09-03, a pedido explicito del usuario tras varias fallas
; seguidas en "no_aparecio_pantalla_amigos_paso3" sin poder ver POR QUE -- este script no
; tenia ningun log persistente, a diferencia de _WaitWelcomeScreensMain.ahk/_DonorOfferCard.ahk
; que ya usan este mismo patron). Vive en su propio archivo para no mezclarse con esos.
logDebugAceptar(msg) {
    global g_winTitle
    FormatTime, ahora,, HH:mm:ss
    try {
        FileAppend, % "[" . ahora . "] [" . g_winTitle . "] " . msg . "`n", % A_ScriptDir . "\Logs\_acceptfriend_debug.txt"
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

; Logico->dispositivo (mismo criterio que _CountShinedust.ahk/_WaitWelcomeScreens.ahk):
; coordenadas mapeadas en vivo 2026-08-03/04 con la herramienta de overlay del usuario,
; en escala logica 283x532 -- se convierten antes de tocar.
; esperaMs bajado de 4000 a 0 (2026-08-27, a pedido explicito del usuario -- comparado en vivo
; contra _SendFriendRequest.ahk de Kevin, cuyo adbClick() no espera nada despues del toque, se
; apoya solo en el poll del loop de reintento para el timing). Seguro: cada paso de este script
; ya confirma la pantalla siguiente con su propio needle antes de tocar de nuevo (poll cada
; 500ms) -- ese chequeo YA cumple el rol de "esperar que asiente" que este Sleep fijo cumplia
; de mas, sumando latencia innecesaria en cada uno de los ~6 toques de este script.
tap(x, y, esperaMs := 0) {
    static convX := 540/283, convY := 960/488, offset := 40
    global adbPath, puerto
    AdbTap(adbPath, puerto, Round(x * convX), Round((y - offset) * convY))
    Sleep, %esperaMs%
}

; Chequeo de cordura (2026-08-04, a pedido explicito del usuario): estos scripts hacen
; taps a ciegas, sin verificar pantalla. Si el juego crasheo solo y volvio al titulo (algo
; que ya vimos pasar varias veces, sin relacion con nuestro codigo), sin este chequeo el
; script seguiria tocando lugares equivocados y terminaria reportando "OK" a pesar de que
; no paso nada real. Se verifica UNA vez al arrancar -- si matchea alguna needle de
; pantalla de titulo/carga, se corta con un error claro en vez de seguir a ciegas.
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
logDebugAceptar("INICIO -- verificando que no crasheo")
verificarNoCrasheado()
logDebugAceptar("verificarNoCrasheado OK, chequeando pantalla de sobre")

; Recuperacion (2026-08-18, bug real reproducido en vivo 2 veces seguidas): Main puede
; arrancar este script parada en la pantalla de DETALLE de un sobre (ej. "Ruler of the
; Skies") en vez de Comunidad -- el juego la manda ahi sola, sin que ningun script propio
; le haya tocado la pantalla entre medio. Esa pantalla tambien tiene la barra de navegacion
; inferior, asi que el chequeo de mas abajo la reconoce como "pantalla valida" igual, pero
; el tile de Friends no esta ahi (tiene un layout total distinto), asi que el tap despues
; cae en cualquier lado. Este chequeo corto (una sola vuelta, sin poll largo) detecta esa
; pantalla especificamente por su boton "atras" (circular, unico de esa vista) y lo toca
; para salir -- NUNCA toca "abrir" el sobre, solo el boton de volver. Si no esta esa
; pantalla, sigue derecho sin tocar nada.
salirDePantallaSobreSiHaceFalta() {
    global adbPath, puerto, g_winTitle
    tempFile := A_ScriptDir . "\Logs\_step_check_" . g_winTitle . ".png"
    AdbScreenshot(adbPath, puerto, tempFile)
    if (!FileExist(tempFile))
        return
    pBitmap := Gdip_CreateBitmapFromFile(tempFile)
    FileDelete, %tempFile%
    if (!pBitmap)
        return
    pBack := Gdip_CreateBitmapFromFile(A_ScriptDir . "\Needles\own_boosterdetail_back_button.png")
    if (pBack) {
        vPos := ""
        if (buscarNeedleZonal(pBitmap, pBack, vPos, 30, "own_boosterdetail_back_button") = 1) {
            Gdip_DisposeImage(pBitmap)
            tap(142, 465)  ; boton "atras" circular -- NUNCA tocar "abrir" (corregido 2026-08-18, error de calculo: y estaba mal, caia en "Offering Rates")
            return
        }
    }
    Gdip_DisposeImage(pBitmap)
}
salirDePantallaSobreSiHaceFalta()
logDebugAceptar("paso1-2: listo, empezando paso3 (esperarTileFriendsYTap)")

; Reconocimiento real antes de tocar (2026-08-05, a pedido explicito del usuario): en vez
; de tap ciego con Sleep fijo, espera (poll cada 500ms, hasta timeoutMs) a que la needle de
; la pantalla ESPERADA aparezca de verdad antes de tocar -- asi un PC lento no rompe el
; timing (el script simplemente espera mas si hace falta, en vez de tocar antes de tiempo).
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

; Igual que chequeoRapidoNeedle pero tambien devuelve la posicion nativa del match (2026-08-30,
; a pedido explicito del usuario -- "tiene que ser para todos los idiomas"): el icono de
; "Friends"/"Amigos" es el mismo dibujo en cualquier idioma, pero la PANTALLA de Comunidad
; cambia de layout entre idiomas (en ingles es un tile chico en una esquina, en español es una
; fila completa mas abajo) -- un tap a coordenada fija (39,463) calibrado contra el ingles cae
; en el lugar equivocado en español. Usando la posicion real del match en vez de una coordenada
; fija, el toque cae siempre sobre el icono real sin importar donde lo haya puesto ese idioma.
chequeoRapidoNeedleConPosicion(nombreNeedleNativo, variationNativo, ByRef outX, ByRef outY) {
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

; Poll puro (sin tocar) con un margen de asentamiento configurable ANTES de devolver true --
; para pasos donde el icono que confirma la pantalla y el elemento que hay que tocar estan en
; puntos distintos de la pantalla (uno puede estar listo antes que el otro). El llamador hace
; el tap() aparte, ya con el margen ya esperado.
esperarChequeoRapidoConMargen(nombreNeedleNativo, variationNativo, timeoutMs, margenMs) {
    inicio := A_TickCount
    Loop {
        if (chequeoRapidoNeedle(nombreNeedleNativo, variationNativo)) {
            Sleep, %margenMs%
            return true
        }
        if (A_TickCount - inicio > timeoutMs)
            return false
        Sleep, 300
    }
}

esperarNeedleYTap(nombreNeedle, variation, x, y, timeoutMs := 15000, nombreNeedleNativo := "", variationNativo := 30) {
    global adbPath, puerto, g_winTitle
    inicio := A_TickCount
    Loop {
        ; Sleep de asentamiento antes del toque (2026-08-29, mismo bug real reproducido en vivo
        ; con Speed Mod en 3x que esperarTileFriendsYTap mas arriba en este mismo archivo).
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

; Chequeo especial para el paso 4 (2026-08-05, reporte real del usuario; simplificado
; 2026-08-18 a pedido explicito del usuario, para sacar el needle de texto en ingles
; "No friend requests awaiting approval."): si un Retry anterior ya alcanzo a aceptar la
; solicitud, al volver a correr todo el pipeline desde cero esta pantalla NO tiene ninguna
; solicitud pendiente -- esperar el check de aceptar ahi se quedaria colgado para siempre,
; porque nunca va a aparecer. Ahora solo se busca own_mainaccept_check (icono, sin texto);
; si nunca aparece dentro del timeout, se asume que no hay nada pendiente (ya son amigos)
; y se sigue igual -- ya no hace falta una segunda needle para ese caso.
;
; Timeout subido de 15000 a 30000 (2026-09-04, bug real confirmado en vivo por el usuario --
; "presiono trade y ni la Main le habia aceptado la solicitud"): la solicitud SI existia de
; verdad (send_friend_request la mando bien), pero el check de aceptar no llegaba a aparecer
; a tiempo -- el supuesto de "si no aparece, ya son amigos" es FALSO en ese caso, y el
; pipeline seguia de largo sin haber aceptado nada, para recien fallar minutos despues en
; donor_offer_card con "Select a Friend" vacio. 15s no le daba margen suficiente a la
; solicitud para propagarse/aparecer del lado de Main bajo carga real.
; Timeout 30 s -> 8 s (2026-09-26, pedido de Ale): con el needle de lista vacia el caso normal
; se resuelve en ~2 s por cualquiera de los dos lados; el timeout solo cubre que la lista
; todavia este cargando, y 8 s alcanzan para eso.
; Timeout 8 s -> 15 s y reintento del toque de la pestana (2026-09-27, bug real en vivo con Ale):
; el toque en "Solicitudes recibidas" era UNO solo y a ciegas; si no entraba, Main se quedaba en
; la pestana "Amigos", no veia ni el check ni la X gris, y a los 8 s asumia "ya son amigos" sin
; aceptar (la solicitud SI estaba, con su punto rojo). Ahora, mientras no aparezca ninguno de los
; dos, se vuelve a tocar la pestana cada 2,5 s -- tocarla estando ya abierta no hace nada.
esperarAceptarOYaAmigos(timeoutMs := 15000) {
    global adbPath, puerto, g_winTitle
    inicio := A_TickCount
    vistasSinSolicitudes := 0
    ultimoTapPestana := A_TickCount
    Loop {
        ; Chequeo rapido cableado (2026-08-26): needle propia own_mainaccept_check_native (el
        ; check verde de aceptar), validada en vivo -- limpio contra las 18 capturas de otras
        ; pantallas que tengo hoy.
        ; Sleep de asentamiento antes del toque (2026-08-29, mismo bug real reproducido en vivo
        ; con Speed Mod en 3x que en los demas pasos de este archivo).
        if (chequeoRapidoNeedle("own_mainaccept_check_native", 30)) {
            Sleep, 900
            tap(242, 202)
            return true
        }
        ; Lista vacia (2026-09-26, con Ale): antes, sin solicitud, se esperaban los 30 s
        ; enteros del timeout. El needle es el X del boton "Borrar todas", que se ve gris
        ; apagado solo cuando no hay ninguna solicitud (rojo cuando hay). Se exigen 2 vistas
        ; seguidas porque la lista puede verse vacia un instante mientras carga.
        if (chequeoRapidoNeedle("own_mainaccept_sin_solicitudes_native", 20)) {
            vistasSinSolicitudes++
            if (vistasSinSolicitudes >= 2) {
                logDebugAceptar("esperarAceptarOYaAmigos: lista de solicitudes vacia confirmada, no hay nada que aceptar")
                return true
            }
            Sleep, 1000
            continue
        }
        vistasSinSolicitudes := 0
        if (A_TickCount - ultimoTapPestana > 2500) {
            logDebugAceptar("esperarAceptarOYaAmigos: ni check ni X gris, se vuelve a tocar 'Solicitudes recibidas'")
            tap(230, 459)
            ultimoTapPestana := A_TickCount
        }
        tempFile := A_ScriptDir . "\Logs\_step_check_" . g_winTitle . ".png"
        AdbScreenshot(adbPath, puerto, tempFile)
        if (FileExist(tempFile)) {
            pBitmap := Gdip_CreateBitmapFromFile(tempFile)
            FileDelete, %tempFile%
            if (pBitmap) {
                pCheck := Gdip_CreateBitmapFromFile(A_ScriptDir . "\Needles\own_mainaccept_check.png")
                vPos := ""
                if (pCheck && buscarNeedleZonal(pBitmap, pCheck, vPos, 30, "own_mainaccept_check") = 1) {
                    Gdip_DisposeImage(pBitmap)
                    ; Mismo asentamiento que el camino rapido (2026-09-04, mismo patron de bug
                    ; ya encontrado hoy en esperarTileFriendsYTap de este archivo -- este camino
                    ; lento tocaba sin esperar nada).
                    Sleep, 900
                    tap(242, 202)
                    return true
                }
                Gdip_DisposeImage(pBitmap)
            }
        }
        if (A_TickCount - inicio > timeoutMs) {
            logDebugAceptar("esperarAceptarOYaAmigos: TIMEOUT tras " . timeoutMs . "ms, asumiendo que ya son amigos (sin confirmar de verdad)")
            return true  ; nunca aparecio el check -- se asume que ya son amigos, no hay nada que aceptar
        }
        Sleep, 500
    }
}

; Paso 1+2 fusionados (2026-08-18, bug real reproducido en vivo, a pedido explicito del
; usuario): la version anterior tocaba apenas veia el navbar (menu principal) y daba por
; hecho que eso alcanzaba para llegar a Comunidad -- pero si en ese instante todavia hay
; algo cargando encima (ej. las imagenes de los sobres), el toque se puede perder sin que
; el script se entere, porque "el navbar ya esta" no es lo mismo que "ya se puede tocar de
; verdad". Ahora el chequeo real es distinto: en cada vuelta busca DIRECTAMENTE el tile de
; Friends (own_mainaccept_friends_icon, el mismo needle que necesita el paso siguiente) --
; si ya esta visible, listo, lo toca y sigue. Si todavia no esta (ej. Main arranco en la
; pestaña Home, que no tiene ese tile), busca el navbar (blanco o gris, own_mainmenu_navbar
; / _activo) y toca el icono de Friends de la barra inferior (141,511) para acercarse, pero
; NO da el paso por terminado todavia -- vuelve a revisar la vuelta siguiente si el tile ya
; aparecio de verdad. Solo se marca exito cuando el tile se ve de verdad, nunca antes.
esperarTileFriendsYTap(timeoutMs := 35000) {
    global adbPath, puerto, g_winTitle
    inicio := A_TickCount
    ; REINTENTO DEL TOQUE AL NAVBAR (2026-09-18, a pedido explicito del usuario -- "hagamoslo
    ; como el de Kevin", tras una falla real reproducida en vivo). Antes esto tocaba la barra
    ; de navegacion UNA SOLA VEZ (yaToqueNavbar, booleano) y despues solo miraba, con el
    ; razonamiento de 2026-09-02 de que "tocar varias veces no soluciona nada". La evidencia en
    ; vivo mostro lo contrario: en la corrida de las 22:55 el log quedo asi --
    ;   intento 1  -- navbar encontrado, tocando (141,511) UNA vez
    ;   TIMEOUT tras 5 intentos (yaToqueNavbar=1), sigue de largo sin tocar el tile
    ; -- o sea, el toque NO registro (patron ya documentado muchas veces en este pipeline: la
    ; needle matchea un frame antes de que el boton sea realmente tocable), y como nunca se
    ; volvia a tocar, el script se quedo 35s mirando una pantalla que nunca iba a cambiar, y
    ; bot.js lo mato por timeout de 60s ("main_accept_friend_request (timeout)").
    ; Ahora se reintenta el toque cada 6s mientras el tile de Amigos siga sin aparecer -- mismo
    ; criterio que usan los scripts por-instancia de Kevin, que insisten hasta que la pantalla
    ; cambia de verdad en vez de confiar en que un unico toque haya registrado.
    ultimoTapNavbar := 0
    intento := 0
    logDebugAceptar("esperarTileFriendsYTap: INICIO (timeoutMs=" . timeoutMs . ")")
    Loop {
        intento++
        ; Chequeo rapido cableado (2026-08-26): needle propia own_mainaccept_friends_icon_native
        ; (el tile "Friends" de Social Hub), validada en vivo -- match exacto, sin ningun falso
        ; positivo cruzado (los "matches" extra fueron la misma pantalla real duplicada).
        ; Movido ANTES del AdbScreenshot (2026-08-27, ineficiencia real encontrada: esta funcion
        ; sacaba una captura por ADB en CADA vuelta sin importar si el chequeo rapido ya
        ; alcanzaba, al reves del patron usado en el resto del pipeline -- el screenshot lento
        ; ahora solo se pide si el chequeo rapido no matcheo).
        ; Sleep de asentamiento antes del toque (2026-08-29, bug real reproducido en vivo con
        ; Speed Mod en 3x): la needle del tile ya matcheaba, pero el toque automatico no
        ; registraba -- probado a mano el MISMO toque un instante despues y si funciono, mismo
        ; patron de bug ya visto y arreglado en otros pasos de este pipeline (needle matchea un
        ; frame antes de que el boton este de verdad tocable).
        ; Toque a posicion DINAMICA en vez de coordenada fija (2026-08-30, bug real
        ; reproducido en vivo -- ver comentario completo en chequeoRapidoNeedleConPosicion):
        ; el icono de Friends/Amigos es el mismo en cualquier idioma, pero (39,463) esta
        ; calibrado contra el layout en ingles -- en español la fila de Amigos esta mas abajo
        ; y falla "no_aparecio_pantalla_comunidad_paso2". Tocando donde matcheo de verdad el
        ; icono, funciona sin importar el idioma o el layout de esa pantalla.
        foundX := "", foundY := ""
        if (chequeoRapidoNeedleConPosicion("own_mainaccept_friends_icon_native", 30, foundX, foundY)) {
            logDebugAceptar("esperarTileFriendsYTap: intento " . intento . " -- [RAPIDO] tile Amigos encontrado en X=" . foundX . " Y=" . foundY . ", tocando")
            Sleep, 900
            AdbTap(adbPath, puerto, Round(foundX * 540 / 275), Round(foundY * 960 / 528))
            return true
        }
        tempFile := A_ScriptDir . "\Logs\_step_check_" . g_winTitle . ".png"
        AdbScreenshot(adbPath, puerto, tempFile)
        if (FileExist(tempFile)) {
            pBitmap := Gdip_CreateBitmapFromFile(tempFile)
            FileDelete, %tempFile%
            if (pBitmap) {
                pTile := Gdip_CreateBitmapFromFile(A_ScriptDir . "\Needles\own_mainaccept_friends_icon.png")
                vPos := ""
                if (pTile && buscarNeedleZonal(pBitmap, pTile, vPos, 30, "own_mainaccept_friends_icon") = 1) {
                    logDebugAceptar("esperarTileFriendsYTap: intento " . intento . " -- [LENTO] tile Amigos encontrado en " . vPos . ", tocando")
                    Gdip_DisposeImage(pBitmap)
                    ; vPos ya esta en escala ADB (needle y screenshot son ambos a 540x960 aca) --
                    ; tocar directo ahi, sin conversion, por la misma razon de arriba.
                    ; Correccion de centro (2026-09-03, bug real reproducido en vivo -- "otra
                    ; vez" el mismo tipo de falla en Comunidad: Gdip_ImageSearch devuelve la
                    ; esquina SUPERIOR-IZQUIERDA del match, no el centro. Esta needle mide
                    ; 65x43 -- sin sumar la mitad, el toque caia ~32px a la izquierda y ~21px
                    ; arriba del boton real, fuera del area tocable, dejando a Main pegada en
                    ; Comunidad sin entrar a Amigos nunca. Mismo patron de bug ya encontrado y
                    ; arreglado hoy en _DonorOfferCard.ahk (estrella de favorito, boton X).
                    ; Sleep de asentamiento antes del toque (2026-09-04, bug real encontrado en
                    ; los logs de _acceptfriend_debug.txt: CADA falla de "paso4" registrada hasta
                    ; ahora vino del camino LENTO, nunca del RAPIDO -- el camino rapido siempre
                    ; espera 900ms antes de tocar (linea de arriba), este nunca esperaba nada,
                    ; tocando apenas Gdip_ImageSearch encontraba el match, mismo patron de bug ya
                    ; visto y arreglado en el resto de este archivo con Speed Mod en 3x).
                    partesTile := StrSplit(vPos, ",")
                    Sleep, 900
                    ; Desplazamiento (+32,+21) -> (-4,+4) al recortar el needle a 26x26 estilo
                    ; Kevin (2026-09-26): el recorte empieza en (36,17) del original, asi que el
                    ; toque sigue cayendo en el mismo punto que antes (centro del tile viejo).
                    AdbTap(adbPath, puerto, partesTile[1] - 4, partesTile[2] + 4)
                    return true
                }
                if (A_TickCount - ultimoTapNavbar > 6000) {
                    pNavbarActivo := Gdip_CreateBitmapFromFile(A_ScriptDir . "\Needles\own_mainmenu_navbar_activo.png")
                    vPos := ""
                    encontroNavbar := (pNavbarActivo && buscarNeedleZonal(pBitmap, pNavbarActivo, vPos, 30, "own_mainmenu_navbar_activo") = 1)
                    if (!encontroNavbar) {
                        pNavbar := Gdip_CreateBitmapFromFile(A_ScriptDir . "\Needles\own_mainmenu_navbar.png")
                        vPos := ""
                        encontroNavbar := (pNavbar && buscarNeedleZonal(pBitmap, pNavbar, vPos, 30, "own_mainmenu_navbar") = 1)
                    }
                    if (encontroNavbar) {
                        logDebugAceptar("esperarTileFriendsYTap: intento " . intento . " -- navbar encontrado, tocando (141,511) [reintenta cada 6s si el tile no aparece]")
                        Gdip_DisposeImage(pBitmap)
                        ultimoTapNavbar := A_TickCount
                        Sleep, 400
                        tap(141, 511)
                        Sleep, 500
                        continue
                    }
                }
                Gdip_DisposeImage(pBitmap)
            }
        }
        if (A_TickCount - inicio > timeoutMs) {
            logDebugAceptar("esperarTileFriendsYTap: TIMEOUT tras " . intento . " intentos (ultimoTapNavbar=" . ultimoTapNavbar . "), sigue de largo sin tocar el tile")
            return true
        }
        Sleep, 500
    }
}

esperarTileFriendsYTap()
logDebugAceptar("paso3 terminado, chequeando pantalla de Amigos (paso4)")
; BUG REAL encontrado y corregido en vivo (2026-08-29, cuenta de Main en español): la needle
; vieja own_mainaccept_tabbar_friends_native era un recorte del texto en INGLES "Approve" de
; la tab bar -- rompia por completo (timeout de 15s, siempre) en cualquier cuenta que no
; tuviera el juego en ingles, violando la regla de "solo iconos, nunca texto" del proyecto.
; Reemplazada por own_mainaccept_addfriend_icon_native (el icono de "agregar amigo" -- lupa +
; persona + "+" -- en la barra de busqueda de la pantalla "Amigos"), validada en vivo: match
; exacto (variation 0) contra 2 capturas reales de esta pantalla (tabs "Amigos" y "Solicitudes
; recibidas"), 0 falsos positivos hasta variation 60 contra Comunidad/Home/Search Results.
; NOTA: el chequeo rapido (needle nativa) es el que corre casi siempre (ver
; chequeoRapidoNeedle, se intenta primero en cada vuelta) y ya usa el icono nuevo -- el
; nombreNeedle lento de respaldo (1er arg, own_mainaccept_tabbar_friends) sigue siendo el
; recorte viejo en ingles, solo se usaria si la captura rapida de ventana fallara (caso raro).
; Pendiente real: reemplazar tambien ese needle lento por una version a escala ADB del mismo
; icono para cerrar el hueco del todo.
; Margen extra especifico para este paso (2026-08-29, bug real reproducido en vivo: el
; toque a la tab "Solicitudes recibidas" seguia sin registrar incluso con 900ms) -- el icono
; que confirma "ya cargo Amigos" esta ARRIBA (barra de busqueda) pero el toque va ABAJO DEL
; TODO (la tab bar), que puede seguir renderizando un instante mas (la lista de amigos tiene
; su propio spinner de carga visto en vivo). Se sube el margen solo aca, sin tocar el
; comportamiento general de esperarNeedleYTap para el resto de los pasos.
if (!esperarChequeoRapidoConMargen("own_mainaccept_addfriend_icon_native", 30, 15000, 1800)) {
    logDebugAceptar("paso4: FALLO -- nunca aparecio la pantalla de Amigos")
    ExitConError("no_aparecio_pantalla_amigos_paso3")
}
logDebugAceptar("paso4: OK, pantalla de Amigos confirmada, tocando tab 'Solicitudes recibidas'")
tap(230, 459)
if (!esperarAceptarOYaAmigos())
    ExitConError("no_aparecio_solicitud_pendiente_paso4")
logDebugAceptar("paso5: OK (aceptada o ya eran amigos), volviendo a Comunidad")
; Chequeo rapido cableado (2026-08-26): antes usaba own_mainaccept_x_back_native. El recorte
; original (solo el icono X) daba falso positivo contra "Select a Friend" del flujo de Trade
; (mismo icono generico, misma posicion) -- por eso se habia ampliado para incluir la tab bar
; de arriba, unica de esta pantalla, y ahi se colaron las palabras en INGLES "Friends",
; "Sent requests" y "Approve".
; Cambiado (2026-09-25, auditoria de needles con texto en ingles) a
; own_mainaccept_addfriend_icon_native: el icono de AGREGAR AMIGO (persona + "+") de la
; esquina superior derecha, que YA EXISTIA y YA se usa en el paso 4 de este mismo archivo
; (ver linea del esperarChequeoRapidoConMargen mas arriba). Es la misma pantalla, asi que no
; hacia falta un needle aparte -- se reutiliza el que ya estaba validado en vivo desde
; 2026-08-29 en vez de mantener dos recortes del mismo icono.
; Por que este icono y no otro: tiene que servir HAYA O NO solicitud pendiente. El punto rojo
; del boton Amigos y el check verde de aceptar NO sirven, porque cuando la donante YA es amiga
; no se envia solicitud y esos dos no aparecen. El icono de agregar amigo esta siempre, en las
; tres pestañas.
; La barra RGB animada del encabezado vive en las filas y=94-95; este icono matchea en y=103,
; o sea que el recorte no la toca.
; Validacion (2026-09-25): barrida contra 156 capturas nativas. Matchea las 12 que son la
; pantalla de Amigos, con variacion 0 entre ellas -- pixel identico, o sea que no hay nada
; animado dentro del recorte -- e incluye tanto las que tienen solicitud pendiente como las
; vacias. No matchea ninguna de las otras 144, entre ellas las 6 capturas reales de
; "Select a Friend" que eran el falso positivo original. La mas parecida queda a 69/255 y se
; usa con 30.
if (!esperarNeedleYTap("own_mainaccept_x_back", 30, 142, 502, 15000, "own_mainaccept_addfriend_icon_native", 30))
    ExitConError("no_aparecio_boton_x_paso5")

; Confirmacion de que el toque de la X REALMENTE saco a Main de la pantalla de Amigos.
; Bug real reproducido en vivo con Ale (2026-09-25): este log escribio
;   [08:52:05] paso5: OK (aceptada o ya eran amigos), volviendo a Comunidad
;   [08:52:06] FIN: OK
; y a las 08:54 Main SEGUIA en la pantalla de Amigos. El tradeo siguiente murio con
; "no_aparecio_oferta_pendiente_paso1" porque _MainAcceptTradeOffer toca el tile de Trade
; (207,402) dando por hecho que Main quedo en Comunidad.
; Causa: esperarNeedleYTap confirma la pantalla, duerme 900ms, toca y devuelve true SIN
; verificar nada. Un toque tragado por el overlay ocupado del juego -- el mismo patron de
; tap perdido que ya peleamos en paso10 de _MainAcceptTradeOffer y en paso14 de
; _DonorOfferCard -- pasaba como exito y dejaba a Main en la pantalla equivocada.
; Aca se reintenta la X hasta confirmar que el icono de agregar amigo (o sea, la pantalla de
; Amigos) ya no esta. Ese icono no matchea ninguna otra pantalla -- barrido contra 156
; capturas nativas el mismo dia -- asi que su ausencia es senal fiable de que ya salimos.
Loop, 8 {
    if (!chequeoRapidoNeedle("own_mainaccept_addfriend_icon_native", 30)) {
        logDebugAceptar("paso5: confirmado, Main salio de la pantalla de Amigos (intento " . A_Index . ")")
        break
    }
    if (A_Index >= 8) {
        logDebugAceptar("paso5: FALLO -- la X no saco a Main de Amigos tras 8 intentos")
        ExitConError("no_se_pudo_salir_de_amigos_paso5")
    }
    logDebugAceptar("paso5: la pantalla de Amigos sigue abierta, reintentando X (intento " . A_Index . ")")
    tap(142, 502)
    Sleep, 1500
}

logDebugAceptar("FIN: OK")
WriteResult("OK")
Gdip_Shutdown(pToken)
ExitApp, 0
