; _WaitWelcomeScreens.ahk
; Separado de _CountShinedust.ahk (2026-08-03) para poder reusarlo desde
; cualquier flujo que arranque justo despues de una inyeccion (Shinedust,
; Trade, etc.) sin acoplarlo a la logica puntual de cada uno.
;
; Espera a que el juego pase las pantallas que pueden aparecer recien
; inyectada una cuenta -- titulo ("Tap to Start"), carrusel "Welcome back!"
; (boton "Next"), pagina "special missions" (boton "OK"), popup "News" (boton
; "X") -- hasta detectar una CONFIRMACION POSITIVA de haber llegado al menu
; principal ("Wonder Pick" solo aparece ahi, needle own_mainmenu).
;
; Reconocimiento de imagen real (Gdip_ImageSearch, la MISMA libreria publica
; -- MasterFocus, CC BY-SA -- que ya usa nuestro propio _SendFriendRequest.ahk)
; con needles PROPIOS recortados directo de capturas reales de nuestro propio
; pipeline ADB (own_next.png, own_ok.png, own_tapstart.png, own_news_x.png,
; own_mainmenu.png en Needles/) -- ver historial completo de por que no se usan
; los needles de Kevin en el header viejo de _CountShinedust.ahk (git log).
;
; Uso: _WaitWelcomeScreens.ahk "<winTitle>" "<folderPath>" "<outputFile>"
;   winTitle   = nombre de la instancia (ej. "1")
;   folderPath = carpeta base de MuMu (ej. "C:\Program Files\Netease\MuMuPlayer")
;   outputFile = ruta donde escribir "OK" o "ERROR: <motivo>"
;
; NO abre el juego (2026-08-05, a pedido explicito del usuario): se saco por completo
; cualquier "am start" propio (tanto el respaldo inicial como el reintento agregado
; despues) -- Kevin nunca hace esto en sus propios AHK, y quedo como sospecha real de la
; causa de varios crashes en vivo esta noche. Este script asume que el juego YA esta
; abierto (por el inject de Kevin, que lo abre solo) y unicamente busca/toca pantallas.

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


; Logico->dispositivo (mismo criterio que el resto de los scripts propios):
; coordenadas calibradas a mano en pantalla logica 283x532 (estilo Kevin).
tap(x, y, esperaMs := 4000) {
    static convX := 540/283, convY := 960/488, offset := 40
    global adbPath, puerto
    AdbTap(adbPath, puerto, Round(x * convX), Round((y - offset) * convY))
    Sleep, %esperaMs%
}

global _needlesCache := {}
cargarNeedle(nombre) {
    global _needlesCache
    if (_needlesCache.HasKey(nombre))
        return _needlesCache[nombre]
    ruta := A_ScriptDir . "\Needles\" . nombre . ".png"
    p := FileExist(ruta) ? Gdip_CreateBitmapFromFile(ruta) : 0
    _needlesCache[nombre] := p
    return p
}

buscarNeedleEnCaptura(pHaystack, nombreNeedle, variation := 30) {
    pNeedle := cargarNeedle(nombreNeedle)
    if (!pNeedle)
        return false
    vPosXY := ""
    vRet := Gdip_ImageSearch(pHaystack, pNeedle, vPosXY, 0, 0, 0, 0, variation)
    return (vRet = 1)
}

; Log de depuracion TEMPORAL (2026-08-02) -- sacar una vez confirmado.
logDebugBienvenida(msg) {
    global LogsDir, g_winTitle
    FormatTime, ahora,, HH:mm:ss
    try {
        FileAppend, % "[" . ahora . "] [" . g_winTitle . "] " . msg . "`n", % LogsDir . "\_welcomeback_debug.txt"
    } catch e {
    }
}

esperarPantallasBienvenida(timeoutMs := 70000) {
    global adbPath, puerto, LogsDir
    inicio := A_TickCount
    intento := 0
    ultimoReintentoAmStart := 0
    ultimoTapStart := 0
    logDebugBienvenida("=== INICIO esperarPantallasBienvenida (needles propios) ===")
    Loop {
        if (A_TickCount - inicio > timeoutMs) {
            logDebugBienvenida("TIMEOUT alcanzado (" . timeoutMs . "ms)")
            return false
        }
        intento++

        ; Nombre unico por instancia (por las dudas, no hace falta con secuencial pero
        ; no molesta dejarlo asi).
        tempFile := LogsDir . "\_welcomeback_check_" . g_winTitle . ".png"
        AdbScreenshot(adbPath, puerto, tempFile)
        if (!FileExist(tempFile)) {
            logDebugBienvenida("intento " . intento . " -- no se pudo sacar captura")
            Sleep, 1000
            continue
        }
        pHaystack := Gdip_CreateBitmapFromFile(tempFile)
        FileDelete, %tempFile%
        if (!pHaystack) {
            logDebugBienvenida("intento " . intento . " -- captura invalida")
            Sleep, 1000
            continue
        }

        ; own_mainmenu = tab "Wonder Pick". own_mainmenu_packs = tab "abrir sobre" (algunas
        ; cuentas arrancan directo en esta pestaña en vez de Wonder Pick -- reporte del
        ; usuario 2026-08-03, needle recortada de una captura real donde el script se quedaba
        ; pegado sin reconocer nada aunque ya habia llegado).
        ; own_mainmenu_packs necesita mas tolerancia que el resto (variation 30 no
        ; alcanza, 45 si -- confirmado en vivo 2026-08-03 contra una captura real): el fondo
        ; de esa pantalla tiene un shimmer animado que se ve a traves de los botones
        ; traslucidos y varia de frame a frame mas de lo que 30 tolera, sin dejar de ser
        ; especifico (0 falsos positivos contra las otras 6 pantallas conocidas ni con 45).
        ; own_mainmenu_navbar (2026-08-04): la barra de navegacion inferior es solo iconos
        ; (sin texto), asi que funciona sin importar el idioma de la cuenta -- a diferencia
        ; de own_mainmenu/own_mainmenu_packs, que dependen de texto en ingles y no matcheaban
        ; en cuentas en español (reporte del usuario, cuenta "Main" en español).
        if (buscarNeedleEnCaptura(pHaystack, "own_mainmenu") || buscarNeedleEnCaptura(pHaystack, "own_mainmenu_packs", 45) || buscarNeedleEnCaptura(pHaystack, "own_mainmenu_navbar")) {
            logDebugBienvenida("intento " . intento . " -- YA LLEGO al menu principal, esperando 5s a que termine de cargar")
            Gdip_DisposeImage(pHaystack)
            Sleep, 5000  ; margen para que la pantalla termine de asentarse antes de que el siguiente script empiece a tocar -- pedido del usuario 2026-08-03
            return true
        }

        if (buscarNeedleEnCaptura(pHaystack, "own_next")) {
            logDebugBienvenida("intento " . intento . " -- needle 'own_next' -> tap Next (136,432)")
            tap(136, 432)  ; boton "Next" (primera pagina del carrusel) -- coordenada exacta mapeada en vivo 2026-08-03
        } else if (buscarNeedleEnCaptura(pHaystack, "own_ok")) {
            logDebugBienvenida("intento " . intento . " -- needle 'own_ok' -> tap OK (203,431)")
            tap(203, 431)  ; boton "OK" (pagina "special missions") -- coordenada exacta mapeada en vivo 2026-08-03
        } else if (buscarNeedleEnCaptura(pHaystack, "own_tapstart") || buscarNeedleEnCaptura(pHaystack, "own_tapstart_logo", 75)) {
            ; own_tapstart_logo (2026-08-04): el texto "Tap to Start" cambia de idioma segun
            ; la cuenta (ej. "Toca para comenzar" en cuentas en español) -- own_tapstart no
            ; matcheaba nunca ahi. own_tapstart_logo recorta solo el logo "Pokemon" (grafico,
            ; no traducido), asi funciona sin importar el idioma de la cuenta.
            ;
            ; Cooldown antes de repetir el tap (2026-08-05): reporte real -- el logo puede
            ; seguir matcheando un rato despues del primer tap, mientras el juego ya esta a
            ; mitad de la transicion de carga. Tocar "Start" de nuevo ENCIMA de esa
            ; transicion parece causar el mismo tipo de crash que ya vimos con el am start
            ; reforzando de mas (mismo patron, "interrumpe una carga real en progreso"). Si
            ; ya tocamos Start hace menos de 8s, esperar en vez de tocar de nuevo.
            if (A_TickCount - ultimoTapStart > 8000) {
                logDebugBienvenida("intento " . intento . " -- needle 'own_tapstart'/'own_tapstart_logo' -> tap Start (141,452)")
                ultimoTapStart := A_TickCount
                tap(141, 452)  ; pantalla de titulo "Tap to Start"
            } else {
                logDebugBienvenida("intento " . intento . " -- needle 'own_tapstart'/'own_tapstart_logo' pero en cooldown, no vuelve a tocar")
                Sleep, 1000
            }
        } else if (buscarNeedleEnCaptura(pHaystack, "own_news_x")) {
            logDebugBienvenida("intento " . intento . " -- needle 'own_news_x' -> tap X (141,478)")
            tap(141, 478)  ; boton "X" del popup "News"
        } else if (buscarNeedleEnCaptura(pHaystack, "own_updateapp_title")) {
            ; Popup "How to Update the App" -- mapeado en vivo 2026-08-07, needle nueva
            ; (nadie la reconocia todavia, se quedaba pegado esperando sin tocar nada). El
            ; boton X cae en la MISMA posicion que el de "News" (mismo template de popup del
            ; juego, confirmado por calculo de coordenadas contra la captura real).
            logDebugBienvenida("intento " . intento . " -- needle 'own_updateapp_title' -> tap X (141,478)")
            tap(141, 478)
        } else if (buscarNeedleEnCaptura(pHaystack, "own_updateapp_store_title")) {
            ; Popup "A new version of the app is available. Please download it from the
            ; store." -- mapeado en vivo 2026-08-07, a pedido explicito del usuario. Tiene 2
            ; botones ("To the Store" y "Tap here if you're unable to update") -- se toca el
            ; segundo (deja seguir sin salir de la app a la tienda, que rompería el flujo).
            logDebugBienvenida("intento " . intento . " -- needle 'own_updateapp_store_title' -> tap 'unable to update' (141,312)")
            tap(141, 312)
        } else if (buscarNeedleEnCaptura(pHaystack, "own_gameclosed")) {
            ; Popup "The game closed, but you successfully obtained the items" -- puede
            ; aparecer despues de un force-stop/inyeccion. Needle mapeada en vivo 2026-08-04.
            logDebugBienvenida("intento " . intento . " -- needle 'own_gameclosed' -> tap OK (150,369)")
            tap(150, 369)  ; boton "OK"
        } else {
            ; OJO (2026-08-03): hubo un intento de "reforzar" la apertura con otro am start
            ; cada 5 intentos si no se reconocia nada -- SACADO, era CONTRAPRODUCENTE: si el
            ; juego solo estaba cargando lento (no trabado de verdad en el launcher), otro am
            ; start por encima lo interrumpia a mitad de carga y lo reiniciaba de verdad --
            ; confirmado en vivo por el usuario (empezo a crashear justo despues de agregar
            ; esto, y antes no pasaba). El am start unico del principio del script alcanza
            ; para el caso real (arranque en frio dejando el launcher visible).
            ;
            ; SACADO de nuevo (2026-08-05, a pedido explicito del usuario): se habia
            ; reagregado un reintento "mas seguro" (solo si el juego estaba confirmado
            ; cerrado), pero el usuario noto que Kevin nunca hace esto en sus propios AHK y
            ; sospecha que ES la causa del crash -- sacado por completo, vuelve a ser solo
            ; el am start unico del principio.
            logDebugBienvenida("intento " . intento . " -- ningun needle matcheo, esperando")
            Sleep, 1000
        }
        Gdip_DisposeImage(pHaystack)
    }
}

; Subido de 70s a 130s (2026-08-05, a pedido del usuario): reporte real en vivo -- un
; ciclo de crash+reintento de am start (ver mas arriba) puede consumir gran parte de los
; 70s originales, dejando muy poco margen para que el juego realmente termine de cargar y
; llegue al menu antes de que se acabe el tiempo. 130s le da margen de sobra incluso si
; pasa un ciclo de recuperacion completo en el medio.
llego := esperarPantallasBienvenida(130000)
if (!llego)
    ExitConError("timeout_pantallas_bienvenida")

WriteResult("OK")
Gdip_Shutdown(pToken)
ExitApp, 0
