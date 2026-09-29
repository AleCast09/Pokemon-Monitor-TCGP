; _CheckPendingOffer.ahk -- creado 2026-08-19, a pedido explicito del usuario: si el
; juego se crasheo a mitad de un Main Trade DESPUES de que la donante ya ofrecio su carta
; (la oferta queda pendiente de verdad del lado del servidor, sobrevive al crash), no tiene
; sentido reiniciar TODO el pipeline de cero (mandar solicitud de amistad, aceptarla,
; volver a ofrecer la carta) -- un needle chico y rapido detecta si Main YA tiene esa
; oferta esperando, y si la hay, el pipeline salta derecho al paso de Main aceptando/
; ofreciendo su propia carta.
;
; Needle usada: own_maintrade_offer_received_banner (icono/franja de color, sin texto --
; ya verificada hoy mismo sin falsos positivos contra las pantallas de "Select a Friend" y
; "Trade" vacio, ver _MainAcceptTradeOffer.ahk).
;
; Uso: _CheckPendingOffer.ahk "<winTitle>" "<folderPath>" "<outputFile>"
;   Escribe "OK" si encuentra una oferta pendiente real, "ERROR: no_hay_oferta_pendiente"
;   si no (timeout corto, 6s -- no se demora un Retry normal esperando de mas).

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

; Log con marca de tiempo (2026-09-03, a pedido explicito del usuario -- "arreglalo para darle
; retry": este script no dejaba ningun rastro de por que no detectaba una oferta que
; genuinamente estaba pendiente del lado del servidor, forzando un reintento completo del
; pipeline entero en vez de saltar directo al paso de aceptar. Mismo patron ya usado en los
; demas scripts de este pipeline hoy.
logDebugPending(msg) {
    global g_winTitle
    FormatTime, ahora,, HH:mm:ss
    try {
        FileAppend, % "[" . ahora . "] [" . g_winTitle . "] " . msg . "`n", % A_ScriptDir . "\Logs\_checkpending_debug.txt"
    } catch e {
    }
}

adbPath := resolverRutaAdb(g_folderPath)
if (adbPath = "") {
    WriteResult("ERROR: adb_no_encontrado")
    ExitApp, 3
}
puerto := resolverPuertoAdb(g_folderPath, g_winTitle)
if (puerto = "") {
    WriteResult("ERROR: puerto_no_encontrado")
    ExitApp, 3
}
AdbConectar(adbPath, puerto)

tap(x, y, esperaMs := 4000) {
    static convX := 540/283, convY := 960/488, offset := 40
    global adbPath, puerto
    AdbTap(adbPath, puerto, Round(x * convX), Round((y - offset) * convY))
    Sleep, %esperaMs%
}

; Navega a Social Hub primero (2026-08-19, bug real reproducido en vivo): este script
; puede correr como PRIMER paso del pipeline (salto por oferta pendiente, sin pasar antes
; por main_accept_friend_request, que es el que normalmente deja a Main parada en Social
; Hub) -- si Main arranca en su pantalla default de sobres en vez de Social Hub, el tap de
; Trade de mas abajo cae en un sobre random en su lugar. Mismo tap ya usado en
; _MainAcceptFriendRequest.ahk para el mismo icono del navbar.
; Navegacion estilo Kevin (2026-09-27, bug real en vivo con Ale): antes eran dos toques a
; ciegas con 4s entre uno y otro. Main recien llegaba al menu y seguia cargando, el primer toque
; (Comunidad) no entro y el segundo cayo en la TIENDA, que en el menu principal esta justo en
; (207,402). Ahora cada toque se repite hasta ver la pantalla siguiente, como clickUntilNeedle.
; Needles elegidos con una oferta pendiente real en pantalla:
;  - Comunidad: el boton Amigos. NO el icono del tile Intercambio, que con oferta pendiente queda
;    tapado por la cinta verde y el "!" y no matchea.
;  - Intercambio: el reloj de Historial (sin oferta) O el "!" del boton Ver (con oferta; con
;    oferta el reloj se corre a la derecha y no matchea). Con uno de los dos alcanza.
verNeedleNativo(nombre, variation := 30) {
    global g_winTitle
    hwnd := obtenerHwndMuMu(g_winTitle)
    if (!hwnd)
        return false
    pBitmap := capturarVentana(hwnd)
    if (!pBitmap)
        return false
    encontrado := false
    pNeedle := Gdip_CreateBitmapFromFile(A_ScriptDir . "\Needles\" . nombre . ".png")
    if (pNeedle) {
        vPos := ""
        encontrado := (buscarNeedleZonal(pBitmap, pNeedle, vPos, variation, nombre) = 1)
        Gdip_DisposeImage(pNeedle)
    }
    Gdip_DisposeImage(pBitmap)
    return encontrado
}

; Toca (x,y) hasta que aparezca alguno de los needles (separados por |). Mira cada 300ms y
; vuelve a tocar cada reintentoMs mientras no aparezca.
tocarHastaVer(x, y, needles, timeoutMs := 20000, reintentoMs := 2500) {
    inicio := A_TickCount
    ultimoToque := 0
    Loop {
        ; El popup de tradeo cancelado puede tapar cualquier pantalla: se cierra apenas aparece.
        if (verNeedleNativo("own_maintrade_sinacuerdo_popup_native")) {
            logDebugPending("popup de tradeo cancelado/sin acuerdo visible, tocando Vale")
            tap(137, 381, 1200)
            continue
        }
        for _, n in StrSplit(needles, "|") {
            if (verNeedleNativo(n))
                return true
        }
        if (A_TickCount - inicio > timeoutMs)
            return false
        if (A_TickCount - ultimoToque >= reintentoMs) {
            tap(x, y, 0)
            ultimoToque := A_TickCount
        }
        Sleep, 300
    }
}

logDebugPending("INICIO -- navegando a Social Hub")
if (tocarHastaVer(141, 511, "own_mainaccept_friends_icon_native"))
    logDebugPending("Comunidad confirmada (boton Amigos)")
else
    logDebugPending("OJO -- no se confirmo Comunidad en 20s, se intenta igual")
if (tocarHastaVer(207, 402, "own_maintrade_trade_button_native|own_maintrade_offer_received_banner_native"))
    logDebugPending("Intercambio confirmado (reloj o !)")
else
    logDebugPending("OJO -- no se confirmo la pantalla de Intercambio en 20s, se chequea igual")
; Popup "este intercambio se ha cancelado y no se ha alcanzado un acuerdo" (2026-09-27, pedido
; de Ale "por si las dudas"): sale al entrar a Intercambio despues de un tradeo cancelado y tapa
; la pantalla. Se toca Vale hasta que se cierre. Despues NO se vuelve a tocar el tile: ya se esta
; en Intercambio, y (207,402) ahi cae cerca del boton Ver.
inicioPopup := A_TickCount
while (verNeedleNativo("own_maintrade_sinacuerdo_popup_native") && A_TickCount - inicioPopup < 10000) {
    logDebugPending("popup de tradeo cancelado/sin acuerdo visible, tocando Vale")
    tap(137, 381, 1200)
}
; Margen de asentamiento extra (2026-09-03, bug real reproducido en vivo -- "arreglalo para
; darle retry": una oferta real ya confirmada del lado del servidor no se detectaba, forzando
; un reintento completo innecesario del pipeline entero. Los 2 tap()s de arriba ya traen su
; propio Sleep de 4000ms cada uno, pero en un PC bajo carga la pantalla de Trade puede tardar
; un poco mas en asentarse del todo antes de que el badge sea visible -- un poco de margen
; extra aca no cuesta nada (este script corre ANTES que el resto del pipeline pesado).
Sleep, 1000

; Doble confirmacion (2026-08-19, bug real en vivo: un match aislado, probablemente un
; frame de transicion de pantalla, disparo un salto falso del pipeline entero -- saltandose
; send_friend_request/donor_offer_card sin que hubiera una oferta real). Exige 2 capturas
; seguidas (800ms) antes de confiar en el resultado.
; Timeout subido de 6000 a 15000ms (2026-09-03, mismo bug de arriba): 6s de margen total para
; juntar 2 confirmaciones separadas por 800ms cada una dejaba muy poco lugar para que la
; pantalla de Trade termine de cargar del todo bajo carga real del sistema -- el chequeo se
; rendia antes de tiempo y el pipeline hacia un reintento completo (send_friend_request +
; donor_offer_card de cero) en vez de saltar directo a aceptar una oferta que YA estaba ahi.
inicio := A_TickCount
encontrado := false
matchesSeguidos := 0
; Corte temprano (2026-09-28, visto en vivo con Ale): sin oferta, este bucle buscaba el "!" 15 s
; completos y Main arrancaba tarde a aceptar la solicitud. El reloj de Historial en su lugar
; normal solo existe cuando NO hay oferta (con oferta se corre a la derecha y no matchea); si se
; ve 3 s seguidos sin ningun "!", no hay oferta.
sinOfertaDesde := 0
intento := 0
Loop {
    intento++
    tempFile := A_ScriptDir . "\Logs\_checkpending_" . g_winTitle . ".png"
    AdbScreenshot(adbPath, puerto, tempFile)
    unMatch := false
    if (FileExist(tempFile)) {
        pBitmap := Gdip_CreateBitmapFromFile(tempFile)
        FileDelete, %tempFile%
        if (pBitmap) {
            ; Cambiado del banner verde al badge rojo "sin leer" (2026-08-19, bug real en
            ; vivo -- idea del usuario): el banner verde matcheaba CUALQUIER oferta
            ; pendiente vieja sin relacion (la cuenta de Main acumulo muchos trades de
            ; prueba en el dia), saltando el flujo real por error. El badge "sin leer" es
            ; mucho mas especifico a la oferta de ESTE intento -- una oferta vieja que ya
            ; se vio/proceso durante el dia ya no lo muestra, aunque el banner verde siga
            ; ahi. Limitacion conocida: si el pipeline crasheo justo DESPUES de ver la
            ; oferta pero antes de terminar, este badge tambien se habra limpiado -- caso
            ; mas raro que el problema real que causaba.
            ; own_maintrade_unread_badge RETIRADO 2026-09-27 (con Ale): es el "!" del tile de Intercambio
            ; en Comunidad, pero aca ya se esta DENTRO de Intercambio y ese tile no existe; ademas sale
            ; igual con un tradeo cancelado. La oferta la detecta solo el "!" del boton Ver (abajo).
            unMatch := false
            ; Segunda needle agregada (2026-09-04, bug real reproducido en vivo -- confirmado
            ; a mano con /Retry manual de _CheckPendingOffer.ahk contra una oferta real
            ; visiblemente pendiente, con el boton "Ver" mostrando su propio "!" -- esta
            ; funcion igual reportaba "no_hay_oferta_pendiente"): own_maintrade_unread_badge
            ; deja de matchear en cuanto la oferta se abrio/toco una vez (ya no es "sin leer"
            ; de verdad), pero el boton "Ver" sigue mostrando SU PROPIO "!" mientras la oferta
            ; siga genuinamente sin resolver. Needle propia own_maintrade_ver_badge (icono
            ; "!" en circulo rojo, recortado del boton "Ver", sin texto), verificada con
            ; diff pixel a pixel: match perfecto (0/255) contra la captura real, sin match
            ; contra Home ni la pantalla de detalle Aceptar/Rechazar (maxdiff 156-161).
            if (!unMatch) {
                pNeedle2 := Gdip_CreateBitmapFromFile(A_ScriptDir . "\Needles\own_maintrade_ver_badge.png")
                if (pNeedle2) {
                    vPos2 := ""
                    unMatch := (buscarNeedleZonal(pBitmap, pNeedle2, vPos2, 30, "own_maintrade_ver_badge") = 1)
                    Gdip_DisposeImage(pNeedle2)
                }
            }
            Gdip_DisposeImage(pBitmap)
        }
    }
    logDebugPending("intento " . intento . " -- unMatch=" . unMatch . " matchesSeguidos=" . matchesSeguidos)
    if (unMatch) {
        matchesSeguidos++
        if (matchesSeguidos >= 2) {
            encontrado := true
            break
        }
        Sleep, 800
        continue
    } else {
        matchesSeguidos := 0
    }
    if (!unMatch && verNeedleNativo("own_maintrade_trade_button_native")) {
        if (!sinOfertaDesde)
            sinOfertaDesde := A_TickCount
        else if (A_TickCount - sinOfertaDesde >= 3000) {
            logDebugPending("reloj de Historial 3 s sin ningun '!' -- no hay oferta pendiente")
            break
        }
    } else {
        sinOfertaDesde := 0
    }
    if (A_TickCount - inicio > 15000)
        break
    Sleep, 500
}

; Evidencia de lo que estaba mirando cuando NO encuentra nada (2026-09-24, a pedido de Ale
; despues de que este chequeo devolviera unMatch=0 en todas las corridas): el script saca una
; captura en cada intento y la BORRA, asi que era imposible distinguir dos causas muy distintas
; -- que haya entrado al Trade y los needles no reconozcan el badge, o que nunca haya llegado y
; estuviera mirando otra pantalla. Ahora, cuando no encuentra, guarda la ultima captura con
; nombre propio para poder mirarla despues.
if (!encontrado) {
    capturaFallo := A_ScriptDir . "\Logs\_checkpending_fallo_" . g_winTitle . ".png"
    AdbScreenshot(adbPath, puerto, capturaFallo)
    logDebugPending("FIN -- no se encontro oferta; captura de lo que veia guardada en Logs\_checkpending_fallo_" . g_winTitle . ".png")
}
logDebugPending("FIN -- encontrado=" . encontrado)
Gdip_Shutdown(pToken)
if (encontrado) {
    WriteResult("OK")
    ExitApp, 0
}
WriteResult("ERROR: no_hay_oferta_pendiente")
ExitApp, 3
