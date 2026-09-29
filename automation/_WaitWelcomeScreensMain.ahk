; _WaitWelcomeScreensMain.ahk
; Copia EXCLUSIVA para la instancia Main (2026-08-05, a pedido explicito del usuario).
; Main no tiene ningun inject que le abra el juego solo (a diferencia de la donante, que
; lo abre via _InjectAccount.ahk de Kevin) -- por eso, SOLO esta copia hace "am start" una
; vez al principio para abrir la app. El script compartido _WaitWelcomeScreens.ahk (usado
; por la donante y por Shinedust) NO hace esto -- se saco de ahi porque el juego ya viene
; abierto por el inject, y forzar otro "am start" encima lo crasheaba (confirmado en vivo
; esta noche: sacarlo de ahi arreglo el crash).
;
; Espera a que el juego pase las pantallas que pueden aparecer recien abierto -- titulo
; ("Tap to Start"), carrusel "Welcome back!" (boton "Next"), pagina "special missions"
; (boton "OK"), popup "News" (boton "X") -- hasta detectar una CONFIRMACION POSITIVA de
; haber llegado al menu principal ("Wonder Pick" solo aparece ahi, needle own_mainmenu).
;
; Uso: _WaitWelcomeScreensMain.ahk "<winTitle>" "<folderPath>" "<outputFile>"
;   winTitle   = nombre de la instancia (deberia ser siempre "Main")
;   folderPath = carpeta base de MuMu (ej. "C:\Program Files\Netease\MuMuPlayer")
;   outputFile = ruta donde escribir "OK" o "ERROR: <motivo>"

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

; Abre el juego (2026-08-05): unica vez, sin reintento ni chequeo de por medio -- Main no
; tiene nada mas que lo abra, asi que esta copia SI necesita hacerlo. Un solo "am start",
; sin loop de reintento (eso fue lo que se saco del script compartido por sospecha real de
; causar crashes).
; Apertura verificada (2026-09-19, estilo startPTCGPApp de Kevin -- ver abrirJuegoVerificado en
; _AdbUtils.ahk): solo manda "am start" si el juego esta realmente cerrado, y confirma que abrio.
; No corta si falla -- el loop de bienvenida de abajo sigue intentando igual.
abrirJuegoVerificado(adbPath, puerto)

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

; Chequeo rapido (2026-08-25, a pedido explicito del usuario -- "los usuarios me dijeron que
; demora mucho, hagamos que haga match mas rapido"): usa capturarVentana (PrintWindow directo,
; ~0ms) en vez de AdbScreenshot (~150-400ms) para las 2 condiciones MAS frecuentes del loop --
; "ya llego al menu principal" y "esta en la pantalla de titulo, tocar Start". Needles propios
; a esta resolucion (_native, ver _AdbUtils.ahk), verificados en vivo contra capturas reales
; (variation 10 y 20 respectivamente, sin falsos positivos cruzados). Si esto no encuentra
; nada, NO se toca nada a ciegas -- se sigue de largo al chequeo lento de siempre (mas abajo),
; que cubre todos los demas popups sin ningun cambio. Cero riesgo de regresion: en el peor
; caso (el rapido nunca matchea), el loop se comporta exactamente igual que antes.
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
    ultimoTapStart := 0
    ; Contador de intentos seguidos sin reconocer NADA en pantalla (2026-09-18, a pedido
    ; explicito del usuario -- "hagamoslo como el de Kevin"). Bug real reproducido en vivo
    ; varias veces hoy: el juego quedaba CERRADO (escritorio de Android) y este script se
    ; quedaba dando vueltas hasta el timeout esperando pantallas del juego que nunca podian
    ; aparecer -- 37 intentos seguidos de "ningun needle matcheo" contra un escritorio vacio,
    ; y el trade entero moria con timeout_pantallas_bienvenida. Los scripts por-instancia de
    ; Kevin no tienen este problema porque corren en bucle infinito y relanzan el juego si no
    ; lo encuentran; este corria una sola vez y solo sabia esperar.
    ; Ahora, si pasan varios intentos seguidos sin reconocer ninguna pantalla conocida, asume
    ; que el juego no esta corriendo (cerrado o crasheado) y lo relanza, en vez de esperar al
    ; vacio. El contador se reinicia apenas vuelve a reconocer algo.
    sinReconocer := 0
    ultimoRelanzamiento := 0
    hwndRapido := obtenerHwndMuMu(g_winTitle)
    logDebugBienvenida("=== INICIO esperarPantallasBienvenida (needles propios, script Main) ===")
    Loop {
        if (A_TickCount - inicio > timeoutMs) {
            logDebugBienvenida("TIMEOUT alcanzado (" . timeoutMs . "ms)")
            return false
        }
        intento++

        ; Re-resolver el handle dentro del bucle (2026-09-22, bug real medido con Ale: corrida
        ; de las 13:41 con chequeos de 18-19s cada uno y TIMEOUT a los 130s, ninguna linea
        ; [RAPIDO]). El handle se resolvia UNA sola vez antes del Loop; si la ventana de la
        ; instancia todavia no existia en ese instante -- justo lo que pasa cuando la instancia
        ; recien esta arrancando -- quedaba en 0 para toda la corrida y cada vuelta caia a la
        ; via lenta (proceso adb.exe nuevo + captura 540x960 + barrido de needles, ~18s), o sea
        ; ~10 chequeos y solo 3 toques de Start en todo el timeout. Los scripts por instancia de
        ; Kevin no cachean un handle muerto. Es un DllCall, cuesta nada por vuelta.
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
                ; Re-chequeo inmediato antes de tocar (2026-09-03, bug real reproducido en vivo
                ; con Ale -- "Main entra a la Tienda por accidente"): entre el chequeo de arriba
                ; y este punto no pasa nada mas aca, pero el toque de Start (141,452) es el
                ; UNICO toque a ciegas por coordenada fija de todo este pipeline, y cae cerca de
                ; la tarjeta "Tienda" del Home real -- si el juego ya transicion al menu justo
                ; en la ventana entre chequeos (posible durante el cooldown de 8s, mientras el
                ; Home todavia esta terminando de asentarse), este mismo toque cae sobre Home en
                ; vez del titulo. Se vuelve a confirmar "titulo" (no "menu") justo antes de
                ; tocar -- si ya cambio a "menu" en este instante, se salta el toque entero.
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

        ; Se guarda el valor previo para poder detectar, despues del if-chain, si se reconocio
        ; alguna pantalla conocida (cualquier rama menos el else final) y reiniciar el contador.
        sinReconocerPrevio := sinReconocer

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
            Sleep, 5000
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
        ; own_tapstart_hamburger (2026-09-26): mismo cambio que en _WaitWelcomeScreens.ahk
        ; -- ver ahi el comentario completo. En resumen: el icono de menu de la esquina superior
        ; derecha del titulo, sin texto (sirve en cualquier idioma), 25 veces mas chico que
        ; own_tapstart, y buscado ACOTADO a su rectangulo como hace Kevin.
        ; Aca importa todavia mas: el rebote de Main en la pantalla de titulo que nunca pudimos
        ; explicar encaja con que own_tapstart (texto en ingles) nunca matchea en una cuenta en
        ; español, dejando todo el arranque colgado de own_tapstart_logo con tolerancia 75 y un
        ; cooldown de 8 segundos entre toques.
        ; Se SUMA a los dos viejos, no los reemplaza.
        ; own_tapstart (el TEXTO "Tap to Start") retirado 2026-09-27: nunca matcheaba (diff 229
        ; en la instancia en ingles) y es texto. El boton de menu de arriba a la derecha, que ahora
        ; esta en own_tapstart_hamburger y own_tapstart_logo, detecta el titulo en cualquier idioma.
        if (buscarNeedleEnCaptura(pHaystack, "own_tapstart_hamburger", 30, 455, 36, 525, 106)
                || buscarNeedleEnCaptura(pHaystack, "own_tapstart_logo", 75)) {
            ; Cooldown antes de repetir el tap: el logo puede seguir matcheando un rato
            ; despues del primer tap, mientras el juego ya esta a mitad de la transicion.
            if (A_TickCount - ultimoTapStart > 8000) {
                ; Mismo resguardo que en el chequeo rapido de arriba (2026-09-03, ver ese
                ; comentario completo): la tolerancia floja (75) de own_tapstart_logo aca es
                ; justamente la mas propensa a falso positivo contra el Home real (mucho
                ; contenido de color similar en los sobres/cartas) -- se re-confirma con el
                ; chequeo rapido (mas estricto, tolerancia 20) que TODAVIA seguimos en el
                ; titulo antes de tocar a ciegas.
                if (chequeoRapido(hwndRapido) = "menu") {
                    logDebugBienvenida("intento " . intento . " -- ya paso a menu justo antes de tocar Start (chequeo lento), se salta el toque")
                    Gdip_DisposeImage(pHaystack)
                    Sleep, 5000
                    return true
                }
                logDebugBienvenida("intento " . intento . " -- needle 'own_tapstart'/'own_tapstart_logo' -> tap Start (141,452)")
                ultimoTapStart := A_TickCount
                tap(141, 452)
            } else {
                logDebugBienvenida("intento " . intento . " -- needle 'own_tapstart'/'own_tapstart_logo' pero en cooldown, no vuelve a tocar")
                Sleep, 1000
            }
        } else if (buscarNeedleEnCaptura(pHaystack, "own_news_x")) {
            logDebugBienvenida("intento " . intento . " -- needle 'own_news_x' -> tap X (141,478)")
            tap(141, 478)
        ; own_updateapp_title RETIRADO 2026-09-27: era el titulo en texto "How to Update the App".
        ; Esa pantalla tiene la misma X que Noticias en el mismo lugar, y own_news_x (que se
        ; revisa antes) ya la cierra con el mismo toque (141,478). Verificado con captura de Ale.
        ; own_updateapp_store_title RETIRADO 2026-09-27 a pedido de Ale: el juego se instala con un
        ; APK, no por la Play Store, asi que el popup de "version nueva" no tiene solucion automatica
        ; (hay que instalar el APK nuevo a mano). Si sale, el arranque vence y el bot avisa.
        ; own_ingame_error_popup RETIRADO 2026-09-27 a pedido de Ale: si el juego da error al
        ; cargar, el arranque vence su tiempo y bot.js reinicia la instancia y reintenta solo.
        } else if (buscarNeedleEnCaptura(pHaystack, "own_gameclosed", 45)) {
            logDebugBienvenida("intento " . intento . " -- needle 'own_gameclosed' -> tap OK (150,369)")
            tap(150, 369)
        } else {
            ; Nada reconocido en esta vuelta -- ver comentario de sinReconocer arriba.
            sinReconocer++
            ; 8 vueltas seguidas (~8-10s) sin reconocer nada = el juego no esta en pantalla.
            ; Se relanza y se le da margen a que arranque. Se limita a un relanzamiento cada
            ; 25s para no apilar "am start" encima de un juego que ya esta arrancando.
            ; CORREGIDO 2026-09-19: solo relanza si el juego esta REALMENTE cerrado (pidof). La
            ; version de ayer relanzaba a ciegas tras 8 vueltas sin reconocer nada -- el mismo
            ; error que ya se saco dos veces en agosto: una pantalla de carga tambien "no se
            ; reconoce", y relanzar encima del juego cargando lo crashea.
            if (sinReconocer >= 8 && (A_TickCount - ultimoRelanzamiento > 25000) && !juegoCorriendo(adbPath, puerto)) {
                logDebugBienvenida("intento " . intento . " -- juego CERRADO de verdad (pidof vacio): relanzando con apertura verificada")
                abrirJuegoVerificado(adbPath, puerto)
                ultimoRelanzamiento := A_TickCount
                sinReconocer := 0
                Sleep, 3000
            } else {
                logDebugBienvenida("intento " . intento . " -- ningun needle matcheo, esperando (" . sinReconocer . " seguidos)")
                Sleep, 1000
            }
        }
        ; Si el contador no cambio, es porque entro por alguna rama que SI reconocio pantalla
        ; -- se reinicia la racha de "no reconozco nada".
        if (sinReconocer = sinReconocerPrevio)
            sinReconocer := 0
        Gdip_DisposeImage(pHaystack)
    }
}

llego := esperarPantallasBienvenida(130000)
if (!llego)
    ExitConError("timeout_pantallas_bienvenida")

WriteResult("OK")
Gdip_Shutdown(pToken)
ExitApp, 0
