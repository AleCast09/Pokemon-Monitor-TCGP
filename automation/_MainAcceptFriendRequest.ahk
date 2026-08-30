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
        if (Gdip_ImageSearch(pBitmap, pBack, vPos, 0, 0, 0, 0, 30) = 1) {
            Gdip_DisposeImage(pBitmap)
            tap(142, 465)  ; boton "atras" circular -- NUNCA tocar "abrir" (corregido 2026-08-18, error de calculo: y estaba mal, caia en "Offering Rates")
            return
        }
    }
    Gdip_DisposeImage(pBitmap)
}
salirDePantallaSobreSiHaceFalta()

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
        encontrado := (Gdip_ImageSearch(pBitmap, pNeedle, vPos, 0, 0, 0, 0, variationNativo) = 1)
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

; Chequeo especial para el paso 4 (2026-08-05, reporte real del usuario; simplificado
; 2026-08-18 a pedido explicito del usuario, para sacar el needle de texto en ingles
; "No friend requests awaiting approval."): si un Retry anterior ya alcanzo a aceptar la
; solicitud, al volver a correr todo el pipeline desde cero esta pantalla NO tiene ninguna
; solicitud pendiente -- esperar el check de aceptar ahi se quedaria colgado para siempre,
; porque nunca va a aparecer. Ahora solo se busca own_mainaccept_check (icono, sin texto);
; si nunca aparece dentro del timeout, se asume que no hay nada pendiente (ya son amigos)
; y se sigue igual -- ya no hace falta una segunda needle para ese caso.
esperarAceptarOYaAmigos(timeoutMs := 15000) {
    global adbPath, puerto, g_winTitle
    inicio := A_TickCount
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
        tempFile := A_ScriptDir . "\Logs\_step_check_" . g_winTitle . ".png"
        AdbScreenshot(adbPath, puerto, tempFile)
        if (FileExist(tempFile)) {
            pBitmap := Gdip_CreateBitmapFromFile(tempFile)
            FileDelete, %tempFile%
            if (pBitmap) {
                pCheck := Gdip_CreateBitmapFromFile(A_ScriptDir . "\Needles\own_mainaccept_check.png")
                vPos := ""
                if (pCheck && Gdip_ImageSearch(pBitmap, pCheck, vPos, 0, 0, 0, 0, 30) = 1) {
                    Gdip_DisposeImage(pBitmap)
                    tap(242, 202)
                    return true
                }
                Gdip_DisposeImage(pBitmap)
            }
        }
        if (A_TickCount - inicio > timeoutMs)
            return true  ; nunca aparecio el check -- se asume que ya son amigos, no hay nada que aceptar
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
    Loop {
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
                if (pTile && Gdip_ImageSearch(pBitmap, pTile, vPos, 0, 0, 0, 0, 30) = 1) {
                    Gdip_DisposeImage(pBitmap)
                    ; vPos ya esta en escala ADB (needle y screenshot son ambos a 540x960 aca) --
                    ; tocar directo ahi, sin conversion, por la misma razon de arriba.
                    partesTile := StrSplit(vPos, ",")
                    AdbTap(adbPath, puerto, partesTile[1], partesTile[2])
                    return true
                }
                pNavbarActivo := Gdip_CreateBitmapFromFile(A_ScriptDir . "\Needles\own_mainmenu_navbar_activo.png")
                vPos := ""
                if (pNavbarActivo && Gdip_ImageSearch(pBitmap, pNavbarActivo, vPos, 0, 0, 0, 0, 30) = 1) {
                    Gdip_DisposeImage(pBitmap)
                    Sleep, 400
                    tap(141, 511)
                    Sleep, 500
                    continue
                }
                pNavbar := Gdip_CreateBitmapFromFile(A_ScriptDir . "\Needles\own_mainmenu_navbar.png")
                vPos := ""
                if (pNavbar && Gdip_ImageSearch(pBitmap, pNavbar, vPos, 0, 0, 0, 0, 30) = 1) {
                    Gdip_DisposeImage(pBitmap)
                    Sleep, 400
                    tap(141, 511)
                    Sleep, 500
                    continue
                }
                Gdip_DisposeImage(pBitmap)
            }
        }
        if (A_TickCount - inicio > timeoutMs)
            return false
        Sleep, 500
    }
}

if (!esperarTileFriendsYTap())
    ExitConError("no_aparecio_pantalla_comunidad_paso2")
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
if (!esperarChequeoRapidoConMargen("own_mainaccept_addfriend_icon_native", 30, 15000, 1800))
    ExitConError("no_aparecio_pantalla_amigos_paso3")
tap(230, 459)
if (!esperarAceptarOYaAmigos())
    ExitConError("no_aparecio_solicitud_pendiente_paso4")
; Chequeo rapido cableado (2026-08-26): needle propia own_mainaccept_x_back_native. El recorte
; original (solo el icono X) daba falso positivo contra "Select a Friend" del flujo de Trade
; (mismo icono generico, misma posicion) -- ampliado para incluir la tab bar "Friends/Sent
; requests/Approve" de arriba, unica de esta pantalla. Limpio hasta variation 60 contra 19
; capturas de otras pantallas.
if (!esperarNeedleYTap("own_mainaccept_x_back", 30, 142, 502, 15000, "own_mainaccept_x_back_native", 30))
    ExitConError("no_aparecio_boton_x_paso5")

WriteResult("OK")
Gdip_Shutdown(pToken)
ExitApp, 0
