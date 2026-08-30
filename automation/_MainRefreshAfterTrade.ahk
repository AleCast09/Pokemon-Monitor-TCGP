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

tap(x, y, esperaMs := 0) {
    static convX := 540/283, convY := 960/488, offset := 40
    global adbPath, puerto
    AdbTap(adbPath, puerto, Round(x * convX), Round((y - offset) * convY))
    Sleep, %esperaMs%
}

; Navega a Social Hub -> Trade (seguro sin importar en que pantalla haya quedado Main --
; mismo patron ya usado en _CheckPendingOffer.ahk/_DonorRespondAndFinalize.ahk).
tap(141, 511)
tap(207, 402)

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
        if (chequeoRapidoNeedle("own_maintrade_agreement_reached_native", 30)) {
            tap(141, 416)
            return true
        }
        ; Chequeo rapido cableado (2026-08-26): needle propia own_maintrade_already_agreed_ok_native
        ; (icono "?" de ayuda, atenuado detras del popup -- el boton OK es color solido y ya se
        ; comprobo que falsea contra otros botones celestes del juego). Validada en vivo --
        ; limpio hasta variation 20 contra 36 capturas de otras pantallas.
        if (chequeoRapidoNeedle("own_maintrade_already_agreed_ok_native", 20)) {
            tap(113, 364, 1500)
            if (A_TickCount - inicio > timeoutMs)
                return false
            continue
        }
        if (chequeoRapidoNeedle("own_maintrade_refresh_button_native", 30)) {
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
                    encontradoAgreement := (Gdip_ImageSearch(pBitmap, pNeedleA, vPos, 0, 0, 0, 0, 30) = 1)
                }
                if (!encontradoAgreement) {
                    pNeedleP := Gdip_CreateBitmapFromFile(A_ScriptDir . "\Needles\own_maintrade_already_agreed_ok.png")
                    if (pNeedleP) {
                        vPos := ""
                        encontradoPopup := (Gdip_ImageSearch(pBitmap, pNeedleP, vPos, 0, 0, 0, 0, 30) = 1)
                    }
                }
                if (!encontradoAgreement && !encontradoPopup) {
                    pNeedleR := Gdip_CreateBitmapFromFile(A_ScriptDir . "\Needles\own_maintrade_refresh_button.png")
                    if (pNeedleR) {
                        vPos := ""
                        encontradoRefresh := (Gdip_ImageSearch(pBitmap, pNeedleR, vPos, 0, 0, 0, 0, 30) = 1)
                    }
                }
                Gdip_DisposeImage(pBitmap)
            }
        }
        if (encontradoAgreement) {
            tap(141, 416)
            return true
        }
        if (encontradoPopup)
            tap(113, 364, 1500)
        else if (encontradoRefresh)
            tap(227, 373, 2000)
        if (A_TickCount - inicio > timeoutMs)
            return false
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
; Chequeo rapido cableado (2026-08-26): needle propia own_donorfinalize_swipe_instruction_native,
; ya validada en _DonorRespondAndFinalize.ahk (misma pantalla real, confirmado en el codigo
; que Main comparte este mismo needle con la donante para este paso).
if (!esperarNeedleSinAccion("own_donorfinalize_swipe_instruction", 30, 15000, "own_donorfinalize_swipe_instruction_native", 30))
    ExitConError("no_aparecio_instruccion_swipe_main")
AdbScreenshot(adbPath, puerto, StrReplace(g_outputFile, ".txt", "_MainSwipePhoto.png"))
bajarSpeedModA1xSiEstaActivo()
AdbSwipePropio(adbPath, puerto, 274, 702, 230, 150)
Sleep, 3000

; Segunda foto de evidencia (2026-08-22, a pedido explicito del usuario, mostrando una
; captura real de referencia: la pantalla final "Got it!" que confirma que la carta
; realmente se mando -- mismo motivo y mismo needle que en _DonorRespondAndFinalize.ahk (es
; la misma pantalla generica del juego, sin importar de que lado se mando la carta). Se
; espera la pantalla de verdad en vez de un Sleep fijo, para no sacar la foto de un cuadro
; intermedio todavia en transicion. No hace falta tocar "Tap to Proceed" aca -- Main se
; apaga solo enseguida (ver apagarInstanciaMuMu en bot.js), no necesita seguir navegando.
if (esperarNeedleSinAccion("own_donorfinalize_tap_to_proceed", 30, 15000, "own_donorfinalize_tap_to_proceed_native", 30))
    AdbScreenshot(adbPath, puerto, StrReplace(g_outputFile, ".txt", "_MainSentPhoto.png"))

WriteResult("OK")
Gdip_Shutdown(pToken)
ExitApp, 0
