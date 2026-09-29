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
; NO abre el juego, salvo un unico respaldo muy acotado (2026-08-05: se saco por completo
; cualquier "am start" propio -- Kevin nunca hace esto en sus propios AHK, y quedo como
; sospecha real de la causa de varios crashes en vivo esa noche. 2026-08-19: se repuso UN
; SOLO intento, condicionado a needle propia del escritorio de Android + margen de 20s, ver
; esperarPantallasBienvenida mas abajo -- bug real reproducido en vivo: el inject a veces no
; abre el juego solo, dejando la instancia trabada para siempre sin ningun respaldo). Salvo
; ese caso puntual, el script asume que el juego YA esta abierto (por el inject de Kevin,
; que lo abre solo) y unicamente busca/toca pantallas.

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

; Zona de busqueda opcional (2026-09-26, a pedido de Ale: hacerlo "como el de Kevin"). Por
; defecto x1/y1/x2/y2 valen 0, que para Gdip_ImageSearch significa PANTALLA COMPLETA -- o sea
; que mientras nadie le pase zona, esto se comporta exactamente igual que antes y ninguna
; llamada existente cambia.
; Para que sirve: acotando la busqueda a un rectangulo chico, el needle ya no necesita ser
; unico en toda la pantalla, solo estar EN ESE PUNTO. Por eso los needles de Kevin son de
; 12x4 o 10x7 pixeles y los nuestros de 45x32: no es que los suyos sean mejores, es que el
; suyo busca en una ventanita y el nuestro en los 275x528 enteros.
; Medido en la PC de Ale: una busqueda global que NO matchea cuesta 92 ms; la misma acotada,
; 1.6 ms. En un bucle de arranque, con varias instancias a la vez, eso se multiplica.
buscarNeedleEnCaptura(pHaystack, nombreNeedle, variation := 30, x1 := 0, y1 := 0, x2 := 0, y2 := 0) {
    pNeedle := cargarNeedle(nombreNeedle)
    if (!pNeedle)
        return false
    vPosXY := ""
    ; Sin zona explicita se usa la tabla central de _ZonasNeedles.ahk (2026-09-27, estilo
    ; Kevin): si el needle todavia no tiene zona, busca en pantalla completa como siempre.
    if (!x1 && !y1 && !x2 && !y2)
        return (buscarNeedleZonal(pHaystack, pNeedle, vPosXY, variation, nombreNeedle) = 1)
    vRet := Gdip_ImageSearch(pHaystack, pNeedle, vPosXY, x1, y1, x2, y2, variation)
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

; Chequeo rapido (2026-08-25, a pedido explicito del usuario -- mismo mecanismo ya probado en
; vivo en _WaitWelcomeScreensMain.ahk): capturarVentana (PrintWindow directo, ~0ms) en vez de
; AdbScreenshot (~150-400ms) para las 2 condiciones mas frecuentes -- "ya llego al menu
; principal" y "esta en la pantalla de titulo". Si no encuentra nada, cae sin tocar nada a
; ciegas al chequeo lento de siempre (mas abajo, sin ningun cambio) -- cero riesgo de regresion.
chequeoRapido(hwnd) {
    if (!hwnd)
        return ""
    pBitmap := capturarVentana(hwnd)
    if (!pBitmap)
        return ""
    esMenu := buscarNeedleEnCaptura(pBitmap, "own_mainmenu_navbar_native", 10)
    esTitulo := !esMenu && buscarNeedleEnCaptura(pBitmap, "own_tapstart_logo_native", 20)
    Gdip_DisposeImage(pBitmap)
    if (esMenu)
        return "menu"
    if (esTitulo)
        return "titulo"
    return ""
}

esperarPantallasBienvenida(timeoutMs := 70000) {
    global adbPath, puerto, LogsDir, g_winTitle
    inicio := A_TickCount
    intento := 0
    ultimoReintentoAmStart := 0
    ultimoTapStart := 0
    hwndRapido := obtenerHwndMuMu(g_winTitle)
    logDebugBienvenida("=== INICIO esperarPantallasBienvenida (needles propios) ===")
    Loop {
        if (A_TickCount - inicio > timeoutMs) {
            logDebugBienvenida("TIMEOUT alcanzado (" . timeoutMs . "ms)")
            return false
        }
        intento++

        ; Re-resolver el handle dentro del bucle (2026-09-22) -- mismo bug ya medido en vivo en
        ; _WaitWelcomeScreensMain.ahk (ver comentario completo ahi): el handle se resolvia una
        ; sola vez antes del Loop y, si la ventana de la instancia todavia no existia, quedaba
        ; en 0 toda la corrida y cada vuelta caia a la via lenta (~18s por chequeo).
        if (!hwndRapido || !DllCall("IsWindow", "Ptr", hwndRapido))
            hwndRapido := obtenerHwndMuMu(g_winTitle)

        resultadoRapido := chequeoRapido(hwndRapido)
        if (resultadoRapido = "menu") {
            logDebugBienvenida("intento " . intento . " -- [RAPIDO] YA LLEGO al menu principal, esperando 5s a que termine de cargar")
            Sleep, 5000
            return true
        }
        if (resultadoRapido = "titulo") {
            if (A_TickCount - ultimoTapStart > 8000) {
                ; Re-chequeo inmediato antes de tocar (2026-09-03, mismo bug real reproducido en
                ; vivo con la instancia donante que ya se habia encontrado y arreglado en
                ; _WaitWelcomeScreensMain.ahk -- ver comentario completo ahi. El toque de Start
                ; (141,452) es a ciegas por coordenada fija; si el juego ya paso al menu justo
                ; en la ventana entre chequeos, este mismo toque puede caer sobre contenido real
                ; del Home en vez del titulo. Se reconfirma "titulo" justo antes de tocar.
                resultadoInmediato := chequeoRapido(hwndRapido)
                if (resultadoInmediato = "menu") {
                    logDebugBienvenida("intento " . intento . " -- [RAPIDO] ya paso a menu justo antes de tocar Start, se salta el toque")
                    Sleep, 5000
                    return true
                }
                logDebugBienvenida("intento " . intento . " -- [RAPIDO] needle 'tapstart' -> tap Start (141,452)")
                ultimoTapStart := A_TickCount
                tap(141, 452)
            } else {
                Sleep, 300
            }
            continue
        }

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
        ; own_mainmenu_navbar_home (2026-09-26, a pedido de Ale -- "hagamoslo como el de Kevin"):
        ; el icono de CASA de la barra inferior, recortado de una captura ADB real del menu.
        ; Por que hizo falta: se midieron los TRES needles de esta condicion contra capturas
        ; reales del menu principal y el resultado fue malo.
        ;   own_mainmenu ("Wonder Pick")      -> 142-150 de distancia: no matchea NUNCA
        ;   own_mainmenu_navbar (el viejo)    -> 102-160 de distancia: no matchea NUNCA
        ;   own_mainmenu_packs ("Offering Rates") -> 41 con umbral 45: matchea por 4 puntos
        ; O sea que la unica salida que funcionaba de verdad era la que depende de texto en
        ; INGLES, y por un margen de 4. En una cuenta en español ese texto es otro y no matchea
        ; ninguno de los tres -- el script no detecta el menu y se queda girando hasta el
        ; timeout. Encaja con los problemas de arranque de Main, que esta en español.
        ; El icono de casa no tiene letras, asi que sirve en cualquier idioma. Validado contra
        ; las capturas reales: matchea con variation 0 en el menu y queda a 221-234 de la
        ; pantalla de titulo buscando acotado (a 140 buscando en toda la pantalla, por eso se
        ; acota).
        ; OJO con la escala: este script busca sobre capturas de AdbScreenshot (540x960), NO
        ; sobre la ventana nativa (275x528). Coordenadas y recorte van en escala ADB.
        ; Se SUMA a los tres viejos en vez de reemplazarlos; se sacan cuando este verificado.
        if (buscarNeedleEnCaptura(pHaystack, "own_mainmenu_navbar_home", 30, 35, 895, 105, 960)
         || buscarNeedleEnCaptura(pHaystack, "own_mainmenu_navbar")) {
            ; own_mainmenu ("Wonder Pick") y own_mainmenu_packs ("Offering Rates / Select other
            ; booster packs") retirados 2026-09-27: eran TEXTO en ingles. Las dos casitas (apagada
            ; en navbar_home, encendida en navbar) detectan el menu en cualquier idioma.
            logDebugBienvenida("intento " . intento . " -- YA LLEGO al menu principal, esperando 5s a que termine de cargar")
            Gdip_DisposeImage(pHaystack)
            Sleep, 5000  ; margen para que la pantalla termine de asentarse antes de que el siguiente script empiece a tocar -- pedido del usuario 2026-08-03
            return true
        }

        ; own_next SACADO (2026-09-26, a pedido explicito de Ale). Era el boton "Next" del
        ; tutorial de Wonder Pick: un popup que el juego muestra UNA sola vez por cuenta, la
        ; primera vez que entras despues de mucho tiempo, y que no vuelve a aparecer. Razon de
        ; Ale: "igual siempre salen nuevos, asi que esta demas" -- cada version del juego trae
        ; sus propios popups de novedades, asi que cubrir uno concreto y ya extinto no aporta.
        ; Tampoco se pudo dejar en una version sin texto: no hay ni una sola captura de esa
        ; pantalla entre las 316 guardadas (se busco con tolerancia 90), y como no vuelve a
        ; salir, no hay forma de sacarle una. Su needle era la palabra "Next" recortada, o sea
        ; que en una cuenta en español no matcheaba de todas formas.
        ; Si algun dia aparece un popup nuevo que trabe el arranque, el patron a seguir es el
        ; de own_news_x: needle del boton X (grafico, sin letras) en vez del texto del titulo.
        ; own_ok SE QUEDA (2026-09-26, decidido con Ale tras discutirlo). Es el boton "OK" del
        ; popup de misiones especiales que el juego muestra al arrancar.
        ; Se evaluo quitarlo igual que own_next, porque un barrido contra las 316 capturas
        ; guardadas no encontro ni una con esa pantalla. Pero eso solo prueba que no la tenemos
        ; fotografiada, no que no aparezca: a diferencia del tutorial de Wonder Pick (que sale
        ; UNA vez por cuenta y ya no vuelve), las misiones especiales cambian por temporada, o
        ; sea que este popup SI es recurrente. Si se saca y aparece, no hay nada que lo cierre
        ; y la instancia se queda trabada hasta el timeout.
        ; Dato a favor de dejarlo: el needle SI matcheo contra 5 pantallas del tradeo (sesion
        ; del 2026-09-02) a distancias de 32-60, o sea que la palabra "OK" existe tal cual en
        ; varios botones del juego -- si el popup de misiones usa ese mismo boton, matchea.
        ; PENDIENTE cuando aparezca la pantalla: cambiarlo por un needle sin texto (la X de
        ; cerrar o un icono del popup, patron de own_news_x) y ACOTARLE la zona. Hoy se busca
        ; en pantalla completa y la distancia mas corta contra una pantalla ajena es de 32
        ; contra un umbral de 30: margen de 2 puntos. Acotando sube a decenas.
        ; own_ok RETIRADO 2026-09-27 a pedido de Ale ("no nos sirve"): era la palabra "OK" (texto)
        ; de un popup de misiones que nunca se pudo fotografiar.
        ; own_tapstart_hamburger (2026-09-26, a pedido de Ale -- "hagamoslo como el de
        ; Kevin"): el icono de menu (circulo blanco con tres rayas) de la esquina superior
        ; derecha de la pantalla de titulo. Es el MISMO elemento y la MISMA zona que usa Kevin
        ; en Friend_HamburgerMenuButtonInIntro (Coords.ahk), solo que recortado de una captura
        ; nuestra en vez de copiar su PNG.
        ; Por que se agrega: los otros dos de esta rama son malos por motivos distintos --
        ; own_tapstart es el texto "Tap to Start", que no matchea en una cuenta en español, y
        ; own_tapstart_logo necesita tolerancia 75 (floja, propensa a falso positivo contra el
        ; Home real). Este no tiene texto, asi que sirve en cualquier idioma, y es 25 veces mas
        ; chico (28x30 en escala ADB = 14x15 en escala nativa, contra 170x40 del viejo).
        ; Va ACOTADO a (455,36)-(525,106) en coordenadas ADB -- OJO: este script busca sobre una
        ; captura de AdbScreenshot (540x960), NO sobre la ventana nativa (275x528). Un needle
        ; recortado de una captura nativa aca no matchea NUNCA (error cometido y corregido el
        ; mismo dia).
        ; Lo que gana la zona, medido contra las capturas reales del arranque: buscando en toda
        ; la pantalla, el menu principal queda a 35-49 de distancia con umbral 30 (margen de 5);
        ; acotado al rectangulo, queda a 74-194. De casi-falso-positivo a margen holgado.
        ; Validacion: matchea desde variation 0 en la posicion exacta (476,56) en las capturas
        ; reales de la pantalla de titulo, y NO matchea en ninguna del menu principal.
        ; Se SUMA a los dos viejos en vez de reemplazarlos: si este fallara, el arranque sigue
        ; comportandose exactamente igual que antes. Una vez verificado en vivo se sacan.
        ; own_tapstart (el TEXTO "Tap to Start") retirado 2026-09-27: nunca matcheaba (diff 229
        ; en la instancia en ingles) y es texto. El boton de menu de arriba a la derecha, que ahora
        ; esta en own_tapstart_hamburger y own_tapstart_logo, detecta el titulo en cualquier idioma.
        if (buscarNeedleEnCaptura(pHaystack, "own_tapstart_hamburger", 30, 455, 36, 525, 106)
                || buscarNeedleEnCaptura(pHaystack, "own_tapstart_logo", 75)) {
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
                ; Mismo resguardo que en el chequeo rapido de arriba (2026-09-03, ver ese
                ; comentario completo) -- own_tapstart_logo (tolerancia 75) es el mas propenso a
                ; falso positivo contra el Home real ya cargado.
                if (chequeoRapido(hwndRapido) = "menu") {
                    logDebugBienvenida("intento " . intento . " -- ya paso a menu justo antes de tocar Start (chequeo lento), se salta el toque")
                    Gdip_DisposeImage(pHaystack)
                    Sleep, 5000
                    return true
                }
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
        ; own_updateapp_title RETIRADO 2026-09-27: era el titulo en texto "How to Update the App".
        ; Esa pantalla tiene la misma X que Noticias en el mismo lugar, y own_news_x (que se
        ; revisa antes) ya la cierra con el mismo toque (141,478). Verificado con captura de Ale.
        ; own_updateapp_store_title RETIRADO 2026-09-27 a pedido de Ale: el juego se instala con un
        ; APK, no por la Play Store, asi que el popup de "version nueva" no tiene solucion automatica
        ; (hay que instalar el APK nuevo a mano). Si sale, el arranque vence y el bot avisa.
        ; own_ingame_error_popup RETIRADO 2026-09-27 a pedido de Ale: si el juego da error al
        ; cargar, el arranque vence su tiempo y bot.js reinicia la instancia y reintenta solo.
        } else if (buscarNeedleEnCaptura(pHaystack, "own_gameclosed", 45)) {
            ; Popup "The game closed, but you successfully obtained the items" -- puede
            ; aparecer despues de un force-stop/inyeccion. Needle mapeada en vivo 2026-08-04.
            logDebugBienvenida("intento " . intento . " -- needle 'own_gameclosed' -> tap OK (150,369)")
            tap(150, 369)  ; boton "OK"
        } else if ((A_TickCount - inicio > 20000) && (A_TickCount - ultimoReintentoAmStart > 25000) && (buscarNeedleEnCaptura(pHaystack, "own_android_home_desktop") || !juegoCorriendo(adbPath, puerto))) {
            ; Respaldo acotado (2026-08-19, bug real reproducido en vivo 2 veces seguidas: el
            ; inject de Kevin a veces no llega a abrir el juego solo, dejando la instancia
            ; parada en el escritorio de Android para siempre). A diferencia de los intentos
            ; anteriores (sacados por causar el ciclo de crash+reintento descripto arriba), este
            ; es deliberadamente ACOTADO para no repetir ese bug:
            ; 1) recien puede activarse despues de 20s (nunca confunde una carga lenta normal
            ;    con estar trabado en el launcher);
            ; 2) necesita una needle PROPIA del escritorio de Android (own_android_home_desktop,
            ;    el fondo de pantalla del launcher, no cualquier pantalla no reconocida) --
            ;    nunca se activa solo por "no matcheo nada", como hacia la version vieja;
            ; 3) CON COOLDOWN de 25s entre intentos (2026-09-03, cambiado de "una sola vez por
            ;    ejecucion" -- bug real reproducido en vivo: la primera vez no siempre alcanza a
            ;    abrir el juego de verdad, y como antes esto era estrictamente UNA vez, el
            ;    script se quedaba esperando sin volver a intentar hasta que el timeout general
            ;    de 130s cortaba con error -- "no abre desde varios intentos" del usuario. El
            ;    cooldown (igual que ultimoTapStart mas arriba) evita el ciclo de crash+reintento
            ;    que causo sacarlo del todo en su momento, sin volver a ser estrictamente unico.
            ; 4) (2026-09-19, estilo startPTCGPApp de Kevin) tambien se activa si pidof confirma que
            ;    el juego NO esta corriendo -- no depende solo del fondo del launcher -- y abre con
            ;    abrirJuegoVerificado (solo manda am start si esta cerrado de verdad, confirma que
            ;    abrio y que no crasheo al arrancar, y reintenta), en vez de un am start suelto.
            logDebugBienvenida("intento " . intento . " -- juego cerrado (escritorio o pidof vacio, >20s) -> apertura verificada")
            ultimoReintentoAmStart := A_TickCount
            abrirJuegoVerificado(adbPath, puerto)
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
