; _EnergiaIntercambio.ahk -- creado 2026-10-08, pedido de Ale: si una cuenta (Main o donante) se
; queda sin energia de intercambio, en la vista previa de la carta sale "Recuperar" (mismo lugar que
; el OK) con un triangulo rojo encima. El bot la recupera solo con relojes y sigue el tradeo:
;   Recuperar -> popup "Energia de intercambio insuficiente" -> "Recuperar hasta la 1.a energia"
;   -> confirmar el uso de relojes (Vale)
; (la opcion mas barata: solo paga lo que le falta a la energia que ya se esta cargando).
; Needles sin letras: own_maintrade_sin_energia (triangulo rojo), own_energia_popup_opcion1 (borde
; verde de la primera opcion), own_energia_confirm_reloj (icono del reloj) y own_energia_recuperada_flecha. Usa tap() y esperarNeedleSinAccion() del script que lo incluye.

logEnergia(msg) {
    FileAppend, % A_Hour ":" A_Min ":" A_Sec "." A_MSec " -- " msg "`n", % A_ScriptDir . "\Logs\_energia_debug.log"
}

; true si la vista previa muestra el aviso de sin energia (se mira 2 veces, el aviso puede tardar).
faltaEnergiaIntercambio() {
    if (esperarNeedleSinAccion("own_maintrade_sin_energia", 40, 1))
        return true
    Sleep, 400
    return esperarNeedleSinAccion("own_maintrade_sin_energia", 40, 1)
}

; Recupera 1 energia. true = de vuelta en la vista previa sin el aviso (ya se puede tocar OK).
recuperarEnergiaIntercambio() {
    global adbPath, puerto, g_winTitle
    logEnergia(g_winTitle . ": sin energia de intercambio, tocando Recuperar")
    vioPopup := false
    Loop, 3 {
        tap(203, 458)   ; "Recuperar" (mismo lugar que el OK)
        if (esperarNeedleSinAccion("own_energia_popup_opcion1", 30, 5000)) {
            vioPopup := true
            break
        }
        logEnergia(g_winTitle . ": el popup no abrio (intento " . A_Index . ")")
    }
    if (!vioPopup) {
        AdbScreenshot(adbPath, puerto, A_ScriptDir . "\Logs\_energia_sin_popup_" . g_winTitle . ".png")
        return false
    }
    inicio := A_TickCount
    ultimoTap := 0
    ultimoVale := 0
    vioVale := false
    while (A_TickCount - inicio < 25000) {
        if (esperarNeedleSinAccion("own_energia_recuperada_flecha", 30, 1)) {
            ; "Energia recuperada!" (2026-10-08, probado en vivo con Ale): su Vale (centro) y listo.
            logEnergia(g_winTitle . ": 'energia recuperada', tocando Vale")
            Sleep, 500
            tap(141, 432)
            Sleep, 1500
            if (!esperarNeedleSinAccion("own_energia_recuperada_flecha", 30, 1)) {
                logEnergia(g_winTitle . ": energia recuperada")
                return true
            }
        } else if (esperarNeedleSinAccion("own_energia_confirm_reloj", 30, 1)) {
            ; "Se consumiran los siguientes objetos... Te parece bien?" (2026-10-08, captura de Ale):
            ; Vale. Needle = solo el icono del reloj, sin la cantidad.
            if (A_TickCount - ultimoVale >= 3000) {
                logEnergia(g_winTitle . ": confirmando el uso de relojes (Vale)")
                Sleep, 500
                tap(203, 432)
                ultimoVale := A_TickCount
                vioVale := true
            }
        } else if (!vioVale && esperarNeedleSinAccion("own_energia_popup_opcion1", 30, 1)) {
            ; Popup de opciones: (re)tocar la opcion 1 cada 3 s, solo ANTES de confirmar (probado en
            ; vivo: despues del Vale el popup sigue a la vista un momento y un segundo toque gastaria
            ; relojes de mas). Si no tiene relojes no pasa nada y se termina por tiempo.
            if (A_TickCount - ultimoTap >= 3000) {
                logEnergia(g_winTitle . ": tocando 'Recuperar hasta la 1.a energia'")
                Sleep, 500
                tap(141, 294)
                ultimoTap := A_TickCount
            }
        } else if (vioVale && !faltaEnergiaIntercambio() && !esperarNeedleSinAccion("own_energia_popup_opcion1", 30, 1)) {
            ; Por si el juego no muestra el popup de "energia recuperada": vista previa sin el aviso.
            Sleep, 1500
            if (!esperarNeedleSinAccion("own_energia_recuperada_flecha", 30, 1) && !faltaEnergiaIntercambio() && !esperarNeedleSinAccion("own_energia_popup_opcion1", 30, 1)) {
                logEnergia(g_winTitle . ": energia recuperada (sin popup final)")
                return true
            }
        }
        Sleep, 500
    }
    logEnergia(g_winTitle . ": FALLO -- 25 s sin recuperar la energia (sin relojes o pantalla desconocida)")
    AdbScreenshot(adbPath, puerto, A_ScriptDir . "\Logs\_energia_fallo_" . g_winTitle . ".png")
    return false
}
