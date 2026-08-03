; _CountShinedust.ahk
; Navega desde la pantalla principal del juego hasta el detalle de "Shinedust" en el
; inventario, toma un screenshot, recorta la region donde aparece el numero y lo lee con
; el OCR nativo de Windows. Escribe el resultado (solo digitos, sin comas) en outputFile.
;
; 100% propio (ver _AdbUtils.ahk, _OcrUtils.ahk, lib/Gdip_All.ahk, lib/Gdip_Extra.ahk) --
; ningun archivo de Kevin. Reescrito 2026-07-30 (segunda vez que se rompia por depender de
; la carpeta viva de Kevin -- primero por ruta externa hardcodeada que solo existia en la
; PC de Ale, y de nuevo cuando Kevin actualizo su propio MumuHelper.ahk y choco con
; "Duplicate function definition"). Ya no depende de nada que Kevin pueda cambiar.
;
; Asume que la instancia YA paso las pantallas de bienvenida/carrusel post-inyeccion (ver
; _WaitWelcomeScreens.ahk, separado 2026-08-03 para poder reusar ese chequeo desde
; cualquier flujo, no solo este) y que ya esta en el menu principal.
;
; Uso: _CountShinedust.ahk "<winTitle>" "<folderPath>" "<outputFile>"
;   winTitle   = nombre de la instancia (ej. "1")
;   folderPath = carpeta base de MuMu (ej. "C:\Program Files\Netease\MuMuPlayer")
;   outputFile = ruta donde escribir el resultado (numero) o "ERROR: <motivo>" si falla

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
#Include %A_ScriptDir%\_OcrUtils.ahk
#Include %A_ScriptDir%\lib\Gdip_All.ahk
#Include %A_ScriptDir%\lib\Gdip_Extra.ahk
#Include %A_ScriptDir%\lib\Gdip_Imagesearch.ahk

global pToken := Gdip_Startup()

LogsDir := A_ScriptDir . "\Logs"
if !FileExist(LogsDir)
    FileCreateDir, %LogsDir%

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

; Logico->dispositivo (mismo criterio que _MainProposeFavoriteCard.ahk): las
; coordenadas de este script se calibraron a mano en pantalla logica 283x532
; (estilo Kevin) -- se mantienen esos mismos valores, solo se convierte antes
; de tocar, sin depender de ningun archivo suyo.
tap(x, y, esperaMs := 4000) {
    static convX := 540/283, convY := 960/488, offset := 40
    global adbPath, puerto
    AdbTap(adbPath, puerto, Round(x * convX), Round((y - offset) * convY))
    Sleep, %esperaMs%
}

; ============ Chequeo rapido de popup "News" ============
; Reporte del usuario 2026-08-03: _WaitWelcomeScreens.ahk ya habia confirmado el menu
; principal, pero el popup de "News" podia aparecer recien aca (disparado por un tap de
; Home que ya no se usa, ver mas abajo). Un chequeo rapido antes de seguir, por las dudas.
chequearPopupNews() {
    global adbPath, puerto, LogsDir
    tempFile := LogsDir . "\_shinedust_newscheck.png"
    AdbScreenshot(adbPath, puerto, tempFile)
    if (!FileExist(tempFile))
        return
    pHaystack := Gdip_CreateBitmapFromFile(tempFile)
    FileDelete, %tempFile%
    if (!pHaystack)
        return
    pNeedle := Gdip_CreateBitmapFromFile(A_ScriptDir . "\Needles\own_news_x.png")
    if (pNeedle) {
        vPosXY := ""
        if (Gdip_ImageSearch(pHaystack, pNeedle, vPosXY, 0, 0, 0, 0, 30) = 1)
            tap(141, 478)  ; boton "X" del popup "News"
    }
    Gdip_DisposeImage(pHaystack)
}
chequearPopupNews()

; ============ Navegacion hasta el detalle de Shinedust ============
; Ya no se pasa por Home (a pedido explicito del usuario 2026-08-03): para cuando
; _CountShinedust.ahk arranca, _WaitWelcomeScreens.ahk YA confirmo que estamos en una
; pantalla con la barra de navegacion visible (Wonder Pick o la de abrir sobre), asi que
; alcanza con ir directo al menu hamburguesa. Ademas, tocar Home desde la pantalla de abrir
; sobre dispara el popup de "News" de nuevo -- evitarlo de raiz en vez de andar cerrandolo.
tap(243, 511)   ; abre menu hamburguesa/configuracion desde la pantalla principal -- coordenada exacta mapeada en vivo 2026-08-03
tap(136, 272)   ; entra a "Items" (la lista ya muestra el shinedust directo) -- coordenada exacta mapeada en vivo 2026-08-03

; Reporte del usuario 2026-07-29: la foto se tomaba muy rapido al llegar al
; inventario y el OCR leia numeros mal (la pantalla todavia estaba animando/
; cargando el numero real de shinedust). Espera extra antes de capturar.
Sleep, 10000

; ============ Screenshot + OCR ============
; Ademas de Shinedust, se leen otros campos del mismo inventario (a pedido explicito del
; usuario 2026-08-03) -- los primeros 7 entran en la MISMA captura sin scroll (Poke gold x2,
; Shinedust, los 3 tickets y Pack Hourglass). Los siguientes 3 (Wonder Hourglass, Rewind
; Watch, Trade Hourglass) requieren un swipe hacia arriba -- se hace UNA sola vez, con una
; segunda captura aparte, para no correr las coordenadas de los primeros 7. Coordenadas y
; swipe mapeados en vivo contra capturas ADB reales 2026-08-03.
shinedustScreenshotFile := LogsDir . "\" . g_winTitle . "_Shinedust.png"
AdbScreenshot(adbPath, puerto, shinedustScreenshotFile)
Sleep, 500

; Limitacion real encontrada en vivo (2026-08-03): el motor de OCR de Windows a veces no
; detecta un "0" solo cuando queda aislado en un recorte chico -- confirmado que NO es
; cuestion de contraste/resize/ancho (probado con muchas combinaciones, siempre igual). Un
; recorte mas ancho que incluya tambien el TEXTO de la etiqueta (no solo el numero) le da al
; motor mas contexto para detectar el bloque de texto -- ayuda para "9" (pokegold_nonpaid),
; pero no siempre para "0" (sigue fallando en pokegold_paid/specialshopticket incluso asi).
; Donde no se puede arreglar del todo, se deja vacio (no se manda un dato incorrecto) en vez
; de forzar un "0" a ciegas.
leerCampoOcr(pBitmapOriginal, x, y, w, h, resize := 300, contrast := 75) {
    valor := ""
    try {
        allowedChars := "0123456789,. "
        pBitmapFormatted := Gdip_CropResizeGreyscaleContrast(pBitmapOriginal, x, y, w, h, resize, contrast)
        valor := GetTextFromBitmap(pBitmapFormatted, allowedChars)
        Gdip_DisposeImage(pBitmapFormatted)
        valor := RegExReplace(valor, "[^\d,]", "")
    } catch e {
        valor := ""
    }
    return valor
}

pBitmapOriginal := Gdip_CreateBitmapFromFile(shinedustScreenshotFile)

shineDustValue      := leerCampoOcr(pBitmapOriginal, 385, 310, 150, 27)
; Recorte ancho (fila completa, con la etiqueta) en vez de solo el numero -- confirmado en
; vivo que asi el OCR SI detecta un digito solo como "9" (con el recorte angosto de antes no
; lo detectaba nunca, sin importar contraste/resize).
pokeGoldNoPagado    := leerCampoOcr(pBitmapOriginal, 20, 145, 500, 40, 200, 75)
pokeGoldPagado      := leerCampoOcr(pBitmapOriginal, 380, 190, 140, 30)
cuponTienda         := leerCampoOcr(pBitmapOriginal, 380, 425, 140, 30)
cuponTiendaEspecial := leerCampoOcr(pBitmapOriginal, 380, 534, 140, 30)
cuponPremium        := leerCampoOcr(pBitmapOriginal, 20, 600, 500, 70, 200, 0)
packHourglass       := leerCampoOcr(pBitmapOriginal, 55, 845, 100, 35)

Gdip_DisposeImage(pBitmapOriginal)

if (FileExist(shinedustScreenshotFile))
    FileDelete, %shinedustScreenshotFile%

; ============ Swipe + segunda captura (parte de abajo del inventario) ============
; AdbSwipePropio solo acepta un X fijo (swipe vertical puro, ver _AdbUtils.ahk) -- el swipe
; real mapeado en vivo iba de (269,755) a (261,144), una diferencia de X minima (derivan
; natural del dedo), asi que se usa un X promedio fijo sin perder precision real.
; Duracion mas larga (era 400ms -- reporte del usuario 2026-08-03: a veces el emulador lo
; interpretaba como un tap en vez de un swipe, abriendo el popup de detalle del item que
; quedaba justo debajo del punto de inicio en vez de scrollear la lista).
AdbSwipePropio(adbPath, puerto, 265, 755, 144, 700)
Sleep, 2000

shinedustScreenshotFile2 := LogsDir . "\" . g_winTitle . "_Shinedust2.png"
AdbScreenshot(adbPath, puerto, shinedustScreenshotFile2)
Sleep, 500

wonderHourglass := ""
rewindWatch := ""
tradeHourglass := ""
pBitmapOriginal2 := Gdip_CreateBitmapFromFile(shinedustScreenshotFile2)
if (pBitmapOriginal2) {
    wonderHourglass := leerCampoOcr(pBitmapOriginal2, 55, 495, 100, 35)
    rewindWatch     := leerCampoOcr(pBitmapOriginal2, 55, 650, 100, 35)
    ; Contraste 50 en vez de 75 (confirmado en vivo 2026-08-03: este campo puntual fallaba
    ; justo con 75 pero funcionaba con 0/25/50/100 -- no se entendio del todo por que, se
    ; evita ese valor especifico en vez de insistir).
    tradeHourglass  := leerCampoOcr(pBitmapOriginal2, 55, 805, 100, 35, 300, 50)
    Gdip_DisposeImage(pBitmapOriginal2)
}

if (FileExist(shinedustScreenshotFile2))
    FileDelete, %shinedustScreenshotFile2%

; Solo el Shinedust es critico (es lo unico que ya se usaba antes) -- si algun otro campo
; no se pudo leer bien, se asume "0" en vez de hacer fallar todo el resultado. Confirmado en
; vivo 2026-08-03: el motor de OCR de Windows solo falla en detectar un "0" SOLO y aislado en
; el recorte -- con 2+ digitos (10, 1000, etc.) detecta bien sin problema, asi que un fallo
; de lectura en estos campos secundarios practicamente siempre significa "es un 0 solo".
esNumeroValido(v) {
    return RegExMatch(v, "^\d[\d,]*\d$|^\d$") ? true : false
}
conValorODefaultCero(v) {
    return esNumeroValido(v) ? v : "0"
}

if (esNumeroValido(shineDustValue)) {
    ; JSON armado a mano (sin libreria -- todos los valores son siempre digitos/comas
    ; o vacio, nunca texto libre, asi que no hace falta escapar nada).
    json := "{""shinedust"":""" . shineDustValue . """"
        . ",""pokegold_nonpaid"":""" . conValorODefaultCero(pokeGoldNoPagado) . """"
        . ",""pokegold_paid"":""" . conValorODefaultCero(pokeGoldPagado) . """"
        . ",""shopticket"":""" . conValorODefaultCero(cuponTienda) . """"
        . ",""specialshopticket"":""" . conValorODefaultCero(cuponTiendaEspecial) . """"
        . ",""premiumticket"":""" . conValorODefaultCero(cuponPremium) . """"
        . ",""packhourglass"":""" . conValorODefaultCero(packHourglass) . """"
        . ",""wonderhourglass"":""" . conValorODefaultCero(wonderHourglass) . """"
        . ",""rewindwatch"":""" . conValorODefaultCero(rewindWatch) . """"
        . ",""tradehourglass"":""" . conValorODefaultCero(tradeHourglass) . """"
        . "}"
    WriteResult(json)
    Gdip_Shutdown(pToken)
    ExitApp, 0
} else {
    WriteResult("ERROR: ocr invalido (" . shineDustValue . ")")
    Gdip_Shutdown(pToken)
    ExitApp, 3
}
