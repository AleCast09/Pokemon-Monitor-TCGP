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

; Logico->dispositivo (mismo criterio que _CountShinedust.ahk/_WaitWelcomeScreens.ahk):
; coordenadas mapeadas en vivo 2026-08-03/04 con la herramienta de overlay del usuario,
; en escala logica 283x532 -- se convierten antes de tocar.
tap(x, y, esperaMs := 4000) {
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

; Reconocimiento real antes de tocar (2026-08-05, a pedido explicito del usuario): en vez
; de tap ciego con Sleep fijo, espera (poll cada 500ms, hasta timeoutMs) a que la needle de
; la pantalla ESPERADA aparezca de verdad antes de tocar -- asi un PC lento no rompe el
; timing (el script simplemente espera mas si hace falta, en vez de tocar antes de tiempo).
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

; Chequeo especial para el paso 4 (2026-08-05, reporte real del usuario): si un Retry
; anterior ya alcanzo a aceptar la solicitud, al volver a correr todo el pipeline desde
; cero esta pantalla NO tiene ninguna solicitud pendiente ("No friend requests awaiting
; approval") -- esperar el check de aceptar ahi se queda colgado para siempre, porque
; nunca va a aparecer. Se chequean las 2 needles posibles cada vuelta: si aparece el check,
; toca para aceptar; si aparece "sin solicitudes pendientes", ya estan de amigos, no toca
; nada y sigue derecho igual.
esperarAceptarOYaAmigos(timeoutMs := 15000) {
    global adbPath, puerto, g_winTitle
    inicio := A_TickCount
    Loop {
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
                pNoReq := Gdip_CreateBitmapFromFile(A_ScriptDir . "\Needles\own_mainaccept_no_requests.png")
                vPos := ""
                if (pNoReq && Gdip_ImageSearch(pBitmap, pNoReq, vPos, 0, 0, 0, 0, 30) = 1) {
                    Gdip_DisposeImage(pBitmap)
                    return true  ; ya son amigos (de un Retry anterior) -- no hay nada que aceptar
                }
                Gdip_DisposeImage(pBitmap)
            }
        }
        if (A_TickCount - inicio > timeoutMs)
            return false
        Sleep, 500
    }
}

; Timeout subido de 15s (default de la funcion) a 35s (2026-08-09, bug real reproducido en
; vivo): Main SI estaba en el menu principal poco despues de que este paso fallara con
; timeout -- solo tardo un poco mas en asentarse de lo que 15s le daba de margen. Mismo
; criterio que el resto de la sesion: mas margen para pantallas que a veces tardan un poco
; mas en renderizar, sin cambiar nada para quien ya la reconoce rapido (sigue apenas la ve).
if (!esperarNeedleYTap("own_mainmenu_navbar", 30, 146, 504, 35000))
    ExitConError("no_aparecio_menu_principal_paso1")
if (!esperarNeedleYTap("own_mainaccept_friends_icon", 30, 39, 463))
    ExitConError("no_aparecio_pantalla_comunidad_paso2")
if (!esperarNeedleYTap("own_mainaccept_tabbar_friends", 30, 230, 459))
    ExitConError("no_aparecio_pantalla_amigos_paso3")
if (!esperarAceptarOYaAmigos())
    ExitConError("no_aparecio_solicitud_pendiente_paso4")
if (!esperarNeedleYTap("own_mainaccept_x_back", 30, 142, 502))
    ExitConError("no_aparecio_boton_x_paso5")

WriteResult("OK")
Gdip_Shutdown(pToken)
ExitApp, 0
