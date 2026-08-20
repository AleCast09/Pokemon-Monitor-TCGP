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

tap(x, y, esperaMs := 4000) {
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

; Reconocimiento real antes de tocar (2026-08-05, a pedido explicito del usuario): espera
; (poll cada 500ms, hasta timeoutMs) a que la needle de la pantalla ESPERADA aparezca antes
; de tocar -- asi un PC lento no rompe el timing.
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
    tap(207, 402)  ; entra al tile de Trade sin condicion
    inicio := A_TickCount
    matchesSeguidos := 0
    Loop {
        tempFile := A_ScriptDir . "\Logs\_step_check_" . g_winTitle . ".png"
        AdbScreenshot(adbPath, puerto, tempFile)
        encontrado := false
        if (FileExist(tempFile)) {
            pBitmap := Gdip_CreateBitmapFromFile(tempFile)
            FileDelete, %tempFile%
            if (pBitmap) {
                pView := Gdip_CreateBitmapFromFile(A_ScriptDir . "\Needles\own_maintrade_offer_received_banner.png")
                vPos := ""
                encontrado := (pView && Gdip_ImageSearch(pBitmap, pView, vPos, 0, 0, 0, 0, 30) = 1)
                Gdip_DisposeImage(pBitmap)
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
    ExitConError("no_aparecio_oferta_pendiente_paso1")
if (!esperarNeedleYTap("own_maintrade_trade_button", 30, 204, 460))
    ExitConError("no_aparecio_intercambiar_button_paso3")
if (!esperarNeedleYTap("own_maintrade_choosecard_title", 30, 251, 496))
    ExitConError("no_aparecio_elige_carta_paso4")

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
            resultado := (Gdip_ImageSearch(pOrdenar, pFlechaArriba, vPos, 0, 0, 0, 0, 30) = 1)
        }
        Gdip_DisposeImage(pOrdenar)
    }
    return resultado
}

Loop, 2 {
    if (estaFlechaArriba())
        break
    tap(233, 348)  ; "Por cantidad de cartas" -- selecciona/alterna hacia flecha arriba
}

if (!esperarNeedleYTap("own_maintrade_x_sort", 30, 140, 501))
    ExitConError("no_aparecio_menu_ordenar_paso5")
; Misma pantalla que el paso 4 -- la carta en si varia por cuenta, no se puede needlear,
; se toca a ciegas (48,357 en la donante / 52,456 aca) ya confirmado el encabezado.
if (!esperarNeedleYTap("own_maintrade_choosecard_title", 30, 52, 456))
    ExitConError("no_aparecio_lista_cartas_paso6")
; own_maintrade_ok_selected SACADA de aca (2026-08-05, mismo motivo que la donante): el
; boton OK tiene un shimmer de color que cambia de tono en cada captura, no se puede
; needlear de forma confiable. Se reutiliza la needle estable del titulo en su lugar.
if (!esperarNeedleYTap("own_maintrade_choosecard_title", 30, 138, 460))
    ExitConError("no_aparecio_ok_habilitado_paso7")
if (!esperarNeedleYTap("own_maintrade_tradepartner_header", 30, 197, 464))
    ExitConError("no_aparecio_preview_envio_paso8")
if (!esperarNeedleYTap("own_donoroffer_cancel_ok", 30, 198, 367))
    ExitConError("no_aparecio_confirmar_set_card_paso9")
; Needle propia separada de la donante (2026-08-19, bug real en vivo -- own_donoroffer_offered_text
; era compartida entre este script y _DonorOfferCard.ahk, y la needle vieja ya no matcheaba
; esta pantalla de Main, dejando el boton "OK" sin tocar aunque el paso se reportara ok).
; own_maintrade_offered_confirm es la curva redondeada del boton OK, recortada fresca de
; esta pantalla real (forma, no el color plano que puede tener shimmer).
if (!esperarNeedleYTap("own_maintrade_offered_confirm", 30, 143, 431))
    ExitConError("no_aparecio_confirmacion_final_paso10")

WriteResult("OK")
Gdip_Shutdown(pToken)
ExitApp, 0
