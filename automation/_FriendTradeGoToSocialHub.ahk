; _FriendTradeGoToSocialHub.ahk -- creado 2026-08-23, a pedido explicito del usuario: separado
; de _FriendTradeCheckPendingOffer.ahk para tener un paso propio y reusable que solo navega
; desde "Search Results" (justo despues de que _SendFriendRequest.ahk manda la solicitud)
; hasta Social Hub, cerrando los dialogos intermedios que puede dejar abiertos el juego --
; SIN entrar todavia a Trade. Mismos 4 primeros taps que ya usaba _SendTradeCard.ahk (pasos
; 1-4), ahora en su propio archivo para poder reusarlo antes de cualquier accion futura, no
; solo el chequeo de oferta pendiente.
;
; Uso: _FriendTradeGoToSocialHub.ahk "<winTitle>" "<folderPath>" "<outputFile>"
;   Escribe "OK" siempre que llegue a correr los 4 taps (no verifica pantalla con needle,
;   son dialogos que pueden o no estar abiertos -- cerrar uno que no existe es inofensivo).
;
; Convertido a needle real (2026-08-26, a pedido explicito del usuario -- comparado en vivo
; contra _DonorOfferCard.ahk, que hace este mismo cierre de dialogos con esperarNeedleYTap en
; vez de toques a ciegas con sleep fijo): reusa las mismas needles ya probadas de Main Trade
; (own_donoroffer_x_searchresults, own_donoroffer_cancel_ok), asi que no hace falta ninguna
; captura nueva. Igual que alli, cerrar un dialogo que no esta ahi es inofensivo -- si una
; needle nunca aparece dentro del timeout corto, sigue derecho al paso siguiente en vez de
; cortar con error (a diferencia de Main Trade, donde SI es un error real no encontrarla,
; porque ahi el punto de partida esta mas controlado).

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

global g_hwndFast := WinExist(g_winTitle . " ahk_class Qt5156QWindowIcon")

tap(x, y, esperaMs := 4000) {
    static convX := 540/283, convY := 960/488, offset := 40
    global adbPath, puerto
    AdbTap(adbPath, puerto, Round(x * convX), Round((y - offset) * convY))
    Sleep, %esperaMs%
}

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

; Igual que tapSiApareceNeedle de _DonorOfferCard.ahk: si la needle no matchea dentro del
; timeout corto, no tapea nada y sigue derecho -- el dialogo genuinamente puede no estar ahi.
tapSiApareceNeedle(nombreNeedle, x, y, variation := 30, timeoutMs := 3000, nombreNeedleNativo := "", variationNativo := 30) {
    global adbPath, puerto
    if (chequeoRapidoNeedle(nombreNeedleNativo, variationNativo)) {
        tap(x, y)
        return true
    }
    inicio := A_TickCount
    Loop {
        tempFile := A_ScriptDir . "\Logs\_friendsocialhub_check.png"
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
        Sleep, 300
    }
}

; Sin needle nativa todavia (2026-08-26): estas 3 pantallas de limpieza (Search Results,
; Friend ID Search, Add Friend QR) no se capturaron en vivo a resolucion nativa -- quedan en
; el metodo ADB de siempre por ahora, solo con needle real en vez de toque a ciegas.
tapSiApareceNeedle("own_donoroffer_x_searchresults", 140, 500, 30, 3000)   ; 1. Search Results -> X (cerrar)
tapSiApareceNeedle("own_donoroffer_cancel_ok", 83, 360, 30, 3000)          ; 2. Friend ID Search -> Cancel
tapSiApareceNeedle("own_donoroffer_x_searchresults", 140, 500, 30, 3000)   ; 3. Add Friend (QR) -> X (cerrar)
tapSiApareceNeedle("own_donoroffer_x_searchresults", 140, 500, 30, 3000)   ; 4. Friends -> X (cerrar)

Gdip_Shutdown(pToken)
WriteResult("OK")
ExitApp, 0
