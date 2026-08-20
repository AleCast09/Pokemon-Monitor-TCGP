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
tap(141, 511)
tap(207, 402)  ; entra al tile de Trade sin condicion, mismo tap que usa el paso real

; Doble confirmacion (2026-08-19, bug real en vivo: un match aislado, probablemente un
; frame de transicion de pantalla, disparo un salto falso del pipeline entero -- saltandose
; send_friend_request/donor_offer_card sin que hubiera una oferta real). Exige 2 capturas
; seguidas (800ms) antes de confiar en el resultado.
inicio := A_TickCount
encontrado := false
matchesSeguidos := 0
Loop {
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
            pNeedle := Gdip_CreateBitmapFromFile(A_ScriptDir . "\Needles\own_maintrade_unread_badge.png")
            vPos := ""
            unMatch := (pNeedle && Gdip_ImageSearch(pBitmap, pNeedle, vPos, 0, 0, 0, 0, 30) = 1)
            Gdip_DisposeImage(pBitmap)
        }
    }
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
    if (A_TickCount - inicio > 6000)
        break
    Sleep, 500
}

Gdip_Shutdown(pToken)
if (encontrado) {
    WriteResult("OK")
    ExitApp, 0
}
WriteResult("ERROR: no_hay_oferta_pendiente")
ExitApp, 3
