; _MainRefreshAfterTrade.ahk -- creado 2026-08-19, a pedido explicito del usuario: despues
; de que la donante finaliza el trade (_DonorRespondAndFinalize.ahk), Main pasa a "Trade
; agreement reached" (banner AZUL, boton "Trade" -- corregido en vivo, la primera version
; asumia que seguia en "Waiting for a Response" con boton "Refresh", pero ese NO es el
; estado real despues de que la donante finaliza). Este script la lleva a Trade y toca el
; boton final para completar el reconocimiento del trade ya cerrado.
;
; Uso: _MainRefreshAfterTrade.ahk "<winTitle>" "<folderPath>" "<outputFile>"

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

; Log de depuracion (2026-09-24): ultimo script del pipeline que no tenia ninguno.
logDebugRefresh(msg) {
    FileAppend, % A_Hour ":" A_Min ":" A_Sec "." A_MSec " -- " msg "`n", % A_ScriptDir . "\Logs\_mainrefresh_debug.log"
}

tap(x, y, esperaMs := 0) {
    static convX := 540/283, convY := 960/488, offset := 40
    global adbPath, puerto
    AdbTap(adbPath, puerto, Round(x * convX), Round((y - offset) * convY))
    Sleep, %esperaMs%
}

; Navega a Social Hub -> Trade (seguro sin importar en que pantalla haya quedado Main --
; mismo patron ya usado en _CheckPendingOffer.ahk/_DonorRespondAndFinalize.ahk).
tap(141, 511)
tap(207, 421)

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

; Bug real confirmado en vivo 2026-08-26 (ver comentario completo en
; _DonorRespondAndFinalize.ahk): el swipe que manda la carta de Main tambien puede fallar con
; Speed Mod en 3x -- mismo arreglo, sin restaurar despues (a pedido explicito del usuario).
bajarSpeedModA1xSiEstaActivo() {
    global adbPath, puerto
    if (!chequeoRapidoNeedle("own_speedmod_icon", 80))
        return false
    tap(18, 109, 800)
    Sleep, 800
    RunWait, %ComSpec% /c ""%adbPath%" -s 127.0.0.1:%puerto% shell input swipe 363 248 33 248 600", , Hide
    Sleep, 1000
    tap(171, 285, 500)
    return true
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

; Corregido en vivo (2026-08-19): mientras la donante todavia no confirma su lado, Main se
; queda en "Waiting for a Response" con un boton "Refresh" -- ese boton hay que tocarlo para
; que Main consulte al servidor de nuevo (no se actualiza solo). Cuando la donante ya
; finalizo, la siguiente vez que Main toque Refresh sale un popup intermedio ("The trade has
; already been agreed to. Now returning to the Trade screen.") que hay que cerrar con OK --
; recien despues de eso Main cae en la lista de Trade con el banner "Trade agreement reached"
; (verificado en vivo: diff exacto 0 contra la needle ya existente). Este loop toca Refresh
; y, si aparece el popup intermedio, toca su OK, hasta ver el banner de acuerdo alcanzado.
;
; Nota sobre el needle own_maintrade_already_agreed_ok: su boton OK es visualmente parecido
; (mismo widget generico celeste) al de la popup "You have offered the card..." de un paso
; MUY anterior del pipeline (_MainAcceptTradeOffer.ahk) -- verificado que en aislamiento dan
; diff 27 entre si, por debajo de la tolerancia 30 usada. No es un riesgo real: esa otra
; popup ya se cerro y quedo atras varios pasos antes de que este script arranque, nunca
; puede estar en pantalla al mismo tiempo que este loop corre.
esperarAgreementConRefresh(timeoutMs := 45000) {
    global adbPath, puerto, g_winTitle
    inicio := A_TickCount
    Loop {
        ; Chequeo rapido cableado (2026-08-26): needle propia own_maintrade_agreement_reached_native
        ; (badge rojo "!" del boton Trade), validada en vivo -- coincide con el mismo badge que
        ; usa _DonorRespondAndFinalize.ahk para otro paso, pero corren en instancias distintas
        ; (nunca compiten contra la misma captura), asi que es seguro con variation 30 estandar.
        ; Chequeo por ADB PRIMERO para el acuerdo (2026-09-24, medido con Ale): el needle de
        ; escala ADB (own_maintrade_agreement_reached) reconoce la pantalla "Acuerdo alcanzado"
        ; desde variation 0, mientras que su variante _native recien matchea desde 130 y el codigo
        ; la llamaba con 30 -- o sea que el chequeo rapido NUNCA podia detectarlo.
        ; Peor: los dos chequeos nativos de mas abajo terminan en "continue", asi que si alguno da
        ; un falso positivo (no se pueden validar contra capturas de ADB, son de otra escala, y hoy
        ; ya aparecieron tres nativos mal calibrados) el bucle gira para siempre sin llegar nunca a
        ; la via lenta, que es la unica que funciona. Por eso la deteccion del acuerdo se hace
        ; ahora al principio de cada vuelta, sin depender de ningun nativo.
        tempAcuerdo := A_ScriptDir . "\Logs\_agreement_check_" . g_winTitle . ".png"
        AdbScreenshot(adbPath, puerto, tempAcuerdo)
        if (FileExist(tempAcuerdo)) {
            pAcu := Gdip_CreateBitmapFromFile(tempAcuerdo)
            FileDelete, %tempAcuerdo%
            if (pAcu) {
                pNeedleAcu := Gdip_CreateBitmapFromFile(A_ScriptDir . "\Needles\own_maintrade_agreement_reached.png")
                if (pNeedleAcu) {
                    vPosAcu := ""
                    if (buscarNeedleZonal(pAcu, pNeedleAcu, vPosAcu, 30, "own_maintrade_agreement_reached") = 1) {
                        logDebugRefresh("acuerdo detectado por ADB en " . vPosAcu . ", tocando Intercambiar")
                        Gdip_DisposeImage(pNeedleAcu)
                        Gdip_DisposeImage(pAcu)
                        tap(141, 416)
                        return true
                    }
                    Gdip_DisposeImage(pNeedleAcu)
                }
                Gdip_DisposeImage(pAcu)
            }
        }
        if (chequeoRapidoNeedle("own_maintrade_agreement_reached_native", 30)) {
            logDebugRefresh("acuerdo detectado por needle NATIVO, tocando Intercambiar")
            tap(141, 416)
            return true
        }
        ; Chequeo rapido cableado (2026-08-26): needle propia own_maintrade_already_agreed_ok_native
        ; (icono "?" de ayuda, atenuado detras del popup -- el boton OK es color solido y ya se
        ; comprobo que falsea contra otros botones celestes del juego). Validada en vivo --
        ; limpio hasta variation 20 contra 36 capturas de otras pantallas.
        if (chequeoRapidoNeedle("own_maintrade_already_agreed_ok_native", 20)) {
            logDebugRefresh("popup de ya-acordado detectado, cerrandolo")
            tap(113, 364, 1500)
            if (A_TickCount - inicio > timeoutMs)
                return false
            continue
        }
        if (chequeoRapidoNeedle("own_maintrade_refresh_button_native", 30)) {
            logDebugRefresh("boton Actualizar visible, tocandolo")
            tap(227, 373, 2000)
            if (A_TickCount - inicio > timeoutMs)
                return false
            continue
        }
        tempFile := A_ScriptDir . "\Logs\_step_check_" . g_winTitle . ".png"
        AdbScreenshot(adbPath, puerto, tempFile)
        encontradoAgreement := false
        encontradoPopup := false
        encontradoRefresh := false
        if (FileExist(tempFile)) {
            pBitmap := Gdip_CreateBitmapFromFile(tempFile)
            FileDelete, %tempFile%
            if (pBitmap) {
                pNeedleA := Gdip_CreateBitmapFromFile(A_ScriptDir . "\Needles\own_maintrade_agreement_reached.png")
                if (pNeedleA) {
                    vPos := ""
                    encontradoAgreement := (buscarNeedleZonal(pBitmap, pNeedleA, vPos, 30, "own_maintrade_agreement_reached") = 1)
                }
                if (!encontradoAgreement) {
                    pNeedleP := Gdip_CreateBitmapFromFile(A_ScriptDir . "\Needles\own_maintrade_already_agreed_ok.png")
                    if (pNeedleP) {
                        vPos := ""
                        encontradoPopup := (buscarNeedleZonal(pBitmap, pNeedleP, vPos, 45, "own_maintrade_already_agreed_ok") = 1)
                    }
                }
                if (!encontradoAgreement && !encontradoPopup) {
                    pNeedleR := Gdip_CreateBitmapFromFile(A_ScriptDir . "\Needles\own_maintrade_refresh_button.png")
                    if (pNeedleR) {
                        vPos := ""
                        encontradoRefresh := (buscarNeedleZonal(pBitmap, pNeedleR, vPos, 30, "own_maintrade_refresh_button") = 1)
                    }
                }
                Gdip_DisposeImage(pBitmap)
            }
        }
        if (encontradoAgreement) {
            logDebugRefresh("acuerdo detectado por la via lenta (ADB), tocando Intercambiar")
            tap(141, 416)
            return true
        }
        if (encontradoPopup) {
            logDebugRefresh("via lenta: popup de ya-acordado, cerrandolo")
            tap(113, 364, 1500)
        }
        else if (encontradoRefresh) {
            logDebugRefresh("via lenta: boton Actualizar visible, tocandolo")
            tap(227, 373, 2000)
        }
        else
            logDebugRefresh("via lenta: no se reconocio NINGUNA de las 3 pantallas esperadas")
        if (A_TickCount - inicio > timeoutMs) {
            logDebugRefresh("TIMEOUT de " . timeoutMs . "ms sin ver el acuerdo")
            return false
        }
        Sleep, 500
    }
}
if (!esperarAgreementConRefresh(45000))
    ExitConError("no_aparecio_agreement_reached")

; Swipe de la carta de Main (2026-08-19, a pedido explicito del usuario, confirmado en vivo
; contra la pantalla real): despues de tocar "Trade" en el banner de acuerdo alcanzado,
; Main TAMBIEN tiene que deslizar su propia carta para mandarla -- mismo needle y mismo
; swipe que ya usa la donante en _DonorRespondAndFinalize.ahk (own_donorfinalize_swipe_instruction,
; icono generico sin texto, verificado que matchea esta pantalla tambien).
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
; Chequeo rapido cableado (2026-08-26): needle propia own_donorfinalize_swipe_instruction_native,
; ya validada en _DonorRespondAndFinalize.ahk (misma pantalla real, confirmado en el codigo
; que Main comparte este mismo needle con la donante para este paso).
if (!esperarNeedleSinAccion("own_donorfinalize_swipe_instruction", 30, 15000, "own_donorfinalize_swipe_instruction_native", 30))
    ExitConError("no_aparecio_instruccion_swipe_main")
; Asentamiento antes de la foto (2026-09-25, mismo bug que en _DonorRespondAndFinalize.ahk,
; reportado por Ale con la captura al lado: la foto salia con la carta a medio aparecer porque
; el needle matchea durante la animacion de transicion). Se exige verlo dos veces seguidas.
Loop, 8 {
    Sleep, 1200
    if (esperarNeedleSinAccion("own_donorfinalize_swipe_instruction", 30, 1500, "own_donorfinalize_swipe_instruction_native", 30)) {
        logDebugRefresh("foto swipe: pantalla confirmada por segunda vez (intento " . A_Index . ")")
        break
    }
    logDebugRefresh("foto swipe: la pantalla todavia no se asienta (intento " . A_Index . ")")
}
Sleep, 800
AdbScreenshot(adbPath, puerto, StrReplace(g_outputFile, ".txt", "_MainSwipePhoto.png"))
bajarSpeedModA1xSiEstaActivo()
AdbSwipePropio(adbPath, puerto, 274, 702, 230, 150)
; Los 3 s NO sobran (2026-10-04, probado en vivo con Ale): dejan terminar la animacion de la
; carta volando. Sin ellos el needle del "Got it!" (fondo) coincidia en plena animacion y la foto
; salia con la carta en el aire.
Sleep, 3000

; Segunda foto de evidencia (2026-08-22, a pedido explicito del usuario, mostrando una
; captura real de referencia: la pantalla final "Got it!" que confirma que la carta
; realmente se mando -- mismo motivo y mismo needle que en _DonorRespondAndFinalize.ahk (es
; la misma pantalla generica del juego, sin importar de que lado se mando la carta). Se
; espera la pantalla de verdad en vez de un Sleep fijo, para no sacar la foto de un cuadro
; intermedio todavia en transicion. Despues de la foto se cierra la secuencia del juego (ver
; cerrarSecuenciaPostTradeo mas abajo) para que Main no quede con un popup pendiente.
; Needle cambiado a own_donorfinalize_gotit_bg (2026-09-29, bug real con Ale: faltaba la foto
; "Main -- Received" en el resumen). El viejo own_donorfinalize_tap_to_proceed era la esquina de la
; letra G de "Got it!", y el icono flotante del speed mod queda justo encima: nunca coincidia y la
; foto no se sacaba. Mismo arreglo que en _DonorRespondAndFinalize.ahk (parche del fondo lila, sin
; letras). Si aun asi no se confirma, se saca la foto igual para que el resumen no quede vacio.
if (!esperarNeedleSinAccion("own_donorfinalize_gotit_bg", 20, 15000, "own_donorfinalize_gotit_bg_native", 20)) {
    logDebugRefresh("foto final: no se confirmo la pantalla Got it! en 15 s, se saca la foto igual")
    AdbScreenshot(adbPath, puerto, StrReplace(g_outputFile, ".txt", "_MainSentPhoto.png"))
} else
    {
        ; Mismo asentamiento que antes: se confirma 2 veces para que la carta termine de aparecer.
        Loop, 8 {
            Sleep, 1200
            if (esperarNeedleSinAccion("own_donorfinalize_gotit_bg", 20, 1500, "own_donorfinalize_gotit_bg_native", 20)) {
                logDebugRefresh("foto final: pantalla confirmada por segunda vez (intento " . A_Index . ")")
                break
            }
            logDebugRefresh("foto final: la pantalla todavia no se asienta (intento " . A_Index . ")")
        }
        Sleep, 1200
        AdbScreenshot(adbPath, puerto, StrReplace(g_outputFile, ".txt", "_MainSentPhoto.png"))
    }

; Cierre limpio de Main (2026-10-08, pedido de Ale): antes Main se apagaba en el "Got it!" y al
; entrar el usuario le salia un popup pendiente. Ahora termina la secuencia del juego: Tap to Proceed
; -> (carta nueva) primer >| -> dex -> Next -> "Items acquired" OK -> "Send a thanks?" -> X. NO abre
; el perfil. Es de cortesia: si algo no aparece, sale OK igual (el tradeo ya esta hecho).
pantallaEstableMain(needle, variation) {
    if (!chequeoRapidoNeedle(needle, variation))
        return false
    Sleep, 300
    return chequeoRapidoNeedle(needle, variation)
}
vistaContinuaMain(needle, variation, ms) {
    inicio := A_TickCount
    Loop {
        if (!chequeoRapidoNeedle(needle, variation))
            return false
        if (A_TickCount - inicio >= ms)
            return true
        Sleep, 250
    }
}
cerrarSecuenciaPostTradeo() {
    Sleep, 1200
    tap(152, 486)   ; Tap to Proceed
    logDebugRefresh("cierre: Tap to Proceed tocado")
    inicio := A_TickCount
    ultimoChequeoThanks := 0
    inicioComunidad := 0
    while (A_TickCount - inicio < 50000) {
        ; "Send a thanks?" (lupita del avatar, ADB): se cierra con la X y se termina.
        if (A_TickCount - ultimoChequeoThanks >= 1500) {
            ultimoChequeoThanks := A_TickCount
            if (esperarNeedleSinAccion("own_thanks_avatar_lupa", 40, 1)) {
                Loop, 3 {
                    logDebugRefresh("cierre: 'Send a thanks?' visible, tocando la X (intento " . A_Index . ")")
                    Sleep, 500
                    tap(152, 486)
                    Sleep, 1500
                    if (!esperarNeedleSinAccion("own_thanks_avatar_lupa", 40, 1))
                        return true
                }
                return false
            }
        }
        if (pantallaEstableMain("kevin_pack_skip_native", 40)) {
            ; Solo el PRIMER >| (el segundo, sobre el dex, avanza solo y un toque ahi abre una carta).
            logDebugRefresh("cierre: primer >|, tocando")
            Sleep, 700
            tap(247, 500)
            Loop, 4 {
                Sleep, 1000
                if (!chequeoRapidoNeedle("kevin_pack_skip_native", 40) || chequeoRapidoNeedle("kevin_pack_next_native", 50))
                    break
                logDebugRefresh("cierre: el primer >| sigue a la vista, tocandolo otra vez")
                tap(247, 500)
            }
            ; Que el >| del dex no se confunda con el primero: se espera a que se vaya.
            espera := A_TickCount
            while (A_TickCount - espera < 6000 && chequeoRapidoNeedle("kevin_pack_skip_native", 40))
                Sleep, 250
            continue
        }
        if (vistaContinuaMain("kevin_pack_next_native", 50, 1500)) {
            logDebugRefresh("cierre: dex, tocando Next")
            Sleep, 700
            tap(146, 489)
            Sleep, 2000
            continue
        }
        if (pantallaEstableMain("kevin_getitem_dialog_native", 20)) {
            logDebugRefresh("cierre: 'Items acquired', tocando OK")
            Sleep, 700
            tap(141, 420)
            Sleep, 2000
            continue
        }
        ; En Comunidad sin popup: el "Send a thanks?" sale ~6 s despues; si a los 15 s no salio, listo.
        if (chequeoRapidoNeedle("own_mainaccept_friends_icon_native", 30)) {
            if (!inicioComunidad)
                inicioComunidad := A_TickCount
            else if (A_TickCount - inicioComunidad > 15000) {
                logDebugRefresh("cierre: en Comunidad y sin 'Send a thanks?' en 15 s, listo")
                return true
            }
        }
        Sleep, 300
    }
    logDebugRefresh("cierre: 50 s sin ver 'Send a thanks?', se apaga igual")
    return false
}
cerrarSecuenciaPostTradeo()

WriteResult("OK")
Gdip_Shutdown(pToken)
ExitApp, 0
