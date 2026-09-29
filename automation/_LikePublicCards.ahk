; _LikePublicCards.ahk
; Da UN like a la galeria publica (Community Showcase) del friendId indicado, para farmear
; tickets de tienda. Cada like que RECIBE un perfil le da 1 ticket, con un tope de 5 al dia.
;
; Copia directa de _SendFriendRequest.ahk (que a su vez es copia adaptada del de Kevin,
; autorizado 2026-07-29): MISMO andamiaje, MISMO motor de reconocimiento por imagen
; (findNeedle/clickUntilNeedle con busqueda ACOTADA sobre captura NATIVA), solo cambian los
; pasos del recorrido. Se hizo asi a pedido explicito de Ale: "tiene que ser como el de Kevin,
; asi de rapido".
; Por que es rapido: captura nativa de la ventana (7.8 ms) en vez de captura por ADB (199 ms),
; y busqueda dentro del rectangulo de cada needle (1.6 ms) en vez de en toda la pantalla
; (hasta 92 ms). Unos 10 ms por comprobacion contra los ~290 ms del pipeline de trade.
;
; NO necesita que corra antes ningun script de pantallas de bienvenida: el paso 1 usa el mismo
; clickUntilNeedle de Kevin con 240 segundos de margen, que ya cubre el arranque del juego
; desde la pantalla de titulo.
;
; Manda la solicitud de amistad al friendId indicado. Copia adaptada del
; _SendFriendRequest.ahk de Kevin (autorizado 2026-07-29, mismo criterio que
; Main.ahk/_SendTradeCard.ahk/_FinalizeTradeCard.ahk): misma logica de
; reconocimiento de imagen (findNeedle/clickUntilNeedle), pero:
;   - recibe el friendId directo por argumento, no lee InjectAccount.ini
;     (Main Trade solo manda UNA solicitud por corrida, no una lista)
;   - sin MsgBox: cualquier fallo escribe "ERROR: <motivo>" en outputFile y
;     termina -- un MsgBox en un proceso headless se quedaria esperando un
;     click que nunca llega
;   - sin el chequeo bloqueante de Settings.ini (Config.ahk ya tolera que no
;     exista, usa valores por defecto)
;
; Uso: _LikePublicCards.ahk "<winTitle>" "<folderPath>" "<friendId>" "<outputFile>"

#SingleInstance off
SetMouseDelay, -1
SetDefaultMouseSpeed, 0
SetBatchLines, -1
SetTitleMatchMode, 3
CoordMode, Pixel, Screen
#NoEnv

if (A_Args.Length() < 4) {
    ExitApp, 1
}

global g_winTitle   := A_Args[1]
global g_folderPath := A_Args[2]
global g_friendId   := A_Args[3]
global g_outputFile := A_Args[4]

#Include %A_ScriptDir%\include\Config.ahk
#Include %A_ScriptDir%\include\Session.ahk
#Include %A_ScriptDir%\include\Profiler.ahk
#Include %A_ScriptDir%\include\Gdip_All.ahk
#Include %A_ScriptDir%\include\Gdip_Imagesearch.ahk

global pToken := Gdip_Startup()

#Include %A_ScriptDir%\include\Utils.ahk
#Include %A_ScriptDir%\include\AccountMetadata.ahk
#Include %A_ScriptDir%\include\ADB.ahk
#Include %A_ScriptDir%\include\Coords.ahk
#Include %A_ScriptDir%\include\MumuHelper.ahk

global ScriptDir := RegExReplace(A_LineFile, "\\[^\\]+$")
global LogsDir   := A_ScriptDir . "\Logs"
global Debug := 0
global discordWebhookURL := ""
global discordUserId := ""
global sendAccountXml := 0

CreateStatusMessage(Message, GuiName := "StatusMessage", X := 0, Y := 565, debugOnly := true, Persist := false) {
}
ResetStatusMessage() {
}
LogToFile(message, logFile := "") {
    global LogsDir
    if (logFile = "")
        logFile := LogsDir . "\Log_LikePublicCards.txt"
    else
        logFile := LogsDir . "\" . logFile
    ; Con el nombre de la instancia delante (2026-09-26): las N copias del script escriben en
    ; el MISMO archivo, y sin esta marca es imposible saber cual dejo cada linea -- se vio en
    ; vivo con dos instancias, las dos escribieron "INICIO" y una murio despues sin que se
    ; pudiera saber cual.
    global g_winTitle
    FormatTime, readableTime, %A_Now%, MMMM dd, yyyy HH:mm:ss
    try {
        FileAppend, % "[" readableTime "] [" g_winTitle "] " message "`n", %logFile%
    } catch e {
    }
}
LogInfo(message, logFile := "") {
    LogToFile("[info] " . message, logFile)
}
LogWarn(message, logFile := "") {
    LogToFile("[warn] " . message, logFile)
}
LogError(message, logFile := "") {
    LogToFile("[error] " . message, logFile)
}
LogDebug(message, logFile := "") {
}
LogTrace(message, logFile := "") {
}
LogToDiscord(message, screenshotFile := "", ping := false, xmlFile := "", screenshotFile2 := "", altWebhookURL := "", altUserId := "") {
}

global g_yaEranAmigos := false

EscribirResultado(texto) {
    global g_outputFile
    try {
        if (FileExist(g_outputFile))
            FileDelete, %g_outputFile%
        FileAppend, %texto%, %g_outputFile%
    } catch e {
    }
}

ExitConError(motivo) {
    global pToken, session
    EscribirResultado("ERROR: " . motivo)
    try {
        RestoreMuMuWindow()
        if (session.get("adbShell"))
            session.get("adbShell").Terminate()
    } catch e {
    }
    try {
        Gdip_Shutdown(pToken)
    } catch e {
    }
    ExitApp, 3
}

global session   := new Session()
global botConfig := new BotConfig()
botConfig.loadSettingsToConfig("ALL")

runtimeFolder := botConfig.get("folderPath")
if (runtimeFolder = "" || !InStr(FileExist(runtimeFolder), "D"))
    botConfig.set("folderPath", g_folderPath, "General")

session.set("scriptName", g_winTitle)
session.set("winTitle",   g_winTitle)
session.set("dbg_bbox", 0)
session.set("dbg_bboxNpause", 0)
session.set("failSafe", A_TickCount)
session.set("baseTime", 0)

if (!RegExMatch(g_friendId, "^\d{16}$"))
    ExitConError("friend_id_invalido")

hwnd := getMuMuHwnd(g_winTitle)
if (!hwnd)
    ExitConError("ventana_no_encontrada")

global g_mumuHwnd := hwnd
WinGetPos, g_savedWndX, g_savedWndY, g_savedWndW, g_savedWndH, ahk_id %hwnd%
WinGet, g_savedWndStyle, Style, ahk_id %hwnd%
if (g_savedWndStyle & 0x00C00000)
    WinSet, Style, -0xC00000, ahk_id %hwnd%
WinGetPos, wx, wy, ww, wh, ahk_id %hwnd%
if (ww != 283 || wh != 532)
    WinMove, ahk_id %hwnd%, , %wx%, %wy%, 283, 532
Sleep, 180

setADBBaseInfo()
ConnectAdb()
initializeAdbShell()

try {
    adbPid := session.get("adbShell").ProcessID
    if (adbPid) {
        WinWait, ahk_pid %adbPid%, , 2
        WinHide, ahk_pid %adbPid%
    }
} catch e {
}

; ============ Funciones (copiadas de _SendFriendRequest.ahk de Kevin) ============

GetNeedle(Path) {
    static NeedleBitmaps := Object()
    if (NeedleBitmaps.HasKey(Path))
        return NeedleBitmaps[Path]
    pNeedle := Gdip_CreateBitmapFromFile(Path)
    needleObj := Object()
    needleObj.Path := Path
    needleObj.needle := pNeedle
    NeedleBitmaps[Path] := needleObj
    return needleObj
}

findNeedle(needleName, searchVariation := 20) {
    global needlesDict, g_mumuHwnd
    needleObj := needlesDict.Get(needleName)
    if (!needleObj)
        return false
    pBitmap := from_window(g_mumuHwnd)
    if (!pBitmap)
        return false
    Path := A_ScriptDir . "\Needles\" . needleObj.imageName . ".png"
    pNeedle := GetNeedle(Path)
    vPosXY := ""
    vRet := Gdip_ImageSearch(pBitmap, pNeedle.needle, vPosXY
        , needleObj.coords.startX, needleObj.coords.startY
        , needleObj.coords.endX,   needleObj.coords.endY
        , searchVariation)
    Gdip_DisposeImage(pBitmap)
    if (vRet = 1)
        return vPosXY ? vPosXY : true
    return false
}

tap(X, Y) {
    adbClick(X, Y)
}

clickUntilNeedle(needleName, clickX, clickY, timeoutSec := 30, retryMs := 800) {
    start := A_TickCount
    lastClick := 0
    Loop {
        if (findNeedle(needleName))
            return true
        if ((A_TickCount - lastClick) >= retryMs) {
            tap(clickX, clickY)
            lastClick := A_TickCount
        }
        if ((A_TickCount - start) // 1000 >= timeoutSec)
            return false
        Sleep, 250
    }
    return false
}

; ============ Pasos del farmeo de likes ============
; Reescrito 2026-09-26 usando los needles y coordenadas de KEVIN, tras descubrir que su bot ya
; tiene esto implementado en showcaseLikes() (Scripts\Include\FriendManager.ahk). Sus needles
; ya estaban registrados en nuestro propio Coords.ahk (lineas 77-81) desde antes.
; Se usan los suyos porque estan probados en produccion, sus zonas estan calibradas, y sobre
; todo porque Friend_CompleteClickShowcaseLike captura el pulgar YA MARCADO -- la confirmacion
; de que el like entro, que de otro modo habria costado gastar un like real e irreversible.
;
; Sus coordenadas y las que yo habia deducido coincidian casi exactamente (OK: 200,364 contra
; 203,364), lo que confirma que la conversion de tap() era el error que teniamos.
;
; Diferencia con el suyo: el suyo recorre una lista de IDs de un .txt en una sola pasada. El
; nuestro da UN like por corrida, porque el motor de bot.js necesita saber el resultado de
; cada cuenta por separado para decidir si quemarla en el historial.

; Sube la velocidad del juego (2026-09-26). REESCRITO tras ver el panel real en una captura de
; Ale: el speed mod de su MuMu es un DESLIZADOR ("Speed Game Multiplier: 1" con una barra), no
; los botones 1x/2x/3x que esperan los needles de Kevin (Common_SpeedMod1x/2x/3x). Esos needles
; son de una version anterior del mod. Por eso la primera version tocaba y no pasaba nada:
; buscaba botones que en ese panel no existen, y el log lo repetia corrida tras corrida con
; "no aparecio el menu".
; Esta version copia el mecanismo de nuestro propio _SpeedMod.ahk, que ya funciona en el
; autotrade: espera a ver el icono, abre el panel, ARRASTRA el deslizador y lo minimiza.
; Tolerante a fallo a proposito: si el panel no aparece, se sigue a velocidad normal. Ir mas
; lento molesta; cortar la corrida por no poder acelerar seria peor.
; ESTILO KEVIN (2026-09-29, pedido de Ale): antes se esperaba a VER el dragoncito, pero es
; semitransparente y su needle casi nunca coincidia (log del 29/09: "el icono no esta visible" en
; 4 de 5 instancias, que siguieron a velocidad normal). Kevin (Step 2 de su _SendFriendRequest)
; toca el boton del speed mod en su lugar fijo HASTA ver el menu abierto. Aca igual: se toca
; (18,109) y se confirma con el engranaje del panel (own_speedmod_panel_gear_native, solido,
; probado en vivo en la donante). Despues se arrastra el deslizador y se minimiza hasta que el
; engranaje desaparezca. Tolerante a fallo: si el panel no abre, se sigue a velocidad normal.
engranajeSpeedModVisible() {
    global g_mumuHwnd
    static pGear := 0
    if (!pGear)
        pGear := Gdip_CreateBitmapFromFile(A_ScriptDir . "\Needles\own_speedmod_panel_gear_native.png")
    if (!pGear)
        return false
    pBitmap := from_window(g_mumuHwnd)
    if (!pBitmap)
        return false
    vPos := ""
    visto := (Gdip_ImageSearch(pBitmap, pGear, vPos, 0, 0, 0, 0, 30) = 1)
    Gdip_DisposeImage(pBitmap)
    return visto
}

; STEP 2 DE KEVIN, tal cual (2026-09-29, pedido de Ale: "que Kevin haga eso en nuestro bot, solo
; la velocidad"). Copia de su Accounts\_SendFriendRequest.ahk:
;     FindImageAndClick("Common_SpeedModMenuButton", 18, 109, , 2000)
;     FindImageAndClick(GetSpeedModNeedle(n), GetSpeedModClickX(n), GetSpeedModClickY(n))
;     Delay(1) / adbClick_wbb(51, 297) / Delay(1)
; FindImageAndClick de Kevin = tocar hasta ver la imagen, que es nuestro clickUntilNeedle. Sus
; needles (speedmodMenu, Two, Three...) y coordenadas ya estaban en include\Coords.ahk; las
; imagenes se copiaron de su Scripts\Needles. Kevin usa 3x; Ale pidio x2.
SubirVelocidad(esperaMs := 4000) {
    ; Tocar el boton del speed mod cada 2 s (igual que Kevin) hasta ver SU menu. Tambien se corta
    ; si se ve nuestro engranaje: significa que el panel ya abrio pero es el del deslizador, y
    ; seguir tocando solo lo abriria y cerraria.
    inicio := A_TickCount
    ultimoTap := 0
    menuKevin := false
    Loop {
        if (findNeedle("Common_SpeedModMenuButton")) {
            menuKevin := true
            break
        }
        if (engranajeSpeedModVisible())
            break
        if (A_TickCount - inicio > esperaMs)
            break
        if (A_TickCount - ultimoTap >= 2000) {
            tap(18, 109)
            ultimoTap := A_TickCount
        }
        Sleep, 200
    }
    if (menuKevin) {
        n := 3   ; x3, igual que Kevin (Ale lo confirmo el 2026-09-29)
        if (clickUntilNeedle(GetSpeedModNeedle(n), GetSpeedModClickX(n), GetSpeedModClickY(n), 10, 800)) {
            Sleep, 1000
            tap(51, 297)
            Sleep, 1000
            LogInfo("speed mod: velocidad x" . n . " (metodo de Kevin)")
            return true
        }
        LogInfo("speed mod: menu de Kevin abierto pero no aparecio el boton x" . n . ", probando el deslizador")
        return SubirVelocidadDeslizador(3000)
    }
    LogInfo("speed mod: el menu de Kevin no aparecio, probando el deslizador")
    return SubirVelocidadDeslizador(3000)
}

; Respaldo: nuestro metodo del deslizador (panel "Speed Game Multiplier"), por si el panel no es
; el de botones que esperan las imagenes de Kevin.
SubirVelocidadDeslizador(esperaMs := 4000) {
    inicio := A_TickCount
    abierto := engranajeSpeedModVisible()
    while (!abierto && A_TickCount - inicio < esperaMs) {
        tap(18, 109)    ; boton del speed mod (el dragoncito), lugar fijo
        t := A_TickCount
        while (A_TickCount - t < 1300) {
            if (engranajeSpeedModVisible()) {
                abierto := true
                break
            }
            Sleep, 150
        }
    }
    if (!abierto) {
        LogInfo("speed mod: el panel no se abrio todavia")
        return false
    }
    Sleep, 400
    ; Arrastra el deslizador de punta a punta. Coordenadas en escala ADB, las mismas que usa
    ; _SpeedMod.ahk y que estan probadas en el autotrade.
    adbSwipeCrudo(33, 248, 363, 248, 600)
    Sleep, 1000
    Loop, 3 {
        tap(171, 285)   ; minimiza el panel
        Sleep, 400
        if (!engranajeSpeedModVisible())
            break
    }
    LogInfo("speed mod: velocidad subida (panel confirmado)")
    return true
}

adbSwipeCrudo(x1, y1, x2, y2, durMs) {
    global session
    adbWriteRaw("input swipe " . x1 . " " . y1 . " " . x2 . " " . y2 . " " . durMs)
    waitadb()
}

DarLikeAlPerfil(fid) {
    LogInfo("INICIO -- friendId=" . fid)

    ; Velocidad a 2x nada mas abrir la app, ANTES del Tap to Start (2026-09-26, decidido con
    ; Ale: "al subir la velocidad por 2 el toque ya no afectaria en el tap start"). La logica es
    ; que si se hace despues, el menu del dragoncito compite con los toques de navegacion.
    ; CORREGIDO 2026-09-26: antes esperaba hasta 60 s al icono, y en algunas instancias el
    ; icono no se ve en la pantalla de Tap to Start -- se quedaban quietas un minuto mientras
    ; las otras ya terminaban. Ahora se mira solo 4 s; si no esta, se sigue navegando y se
    ; vuelve a intentar al llegar a Comunidad, donde el icono ya siempre es visible.
    ; 2026-09-29 (pedido de Ale: "ni bien abre el juego, de frente sube la velocidad antes del tap
    ; start"): igual que Kevin, que espera la pantalla de arranque y RECIEN ahi sube la velocidad.
    ; Antes eran 4 s y, si el juego tardaba mas en abrir, se rendia. Ahora insiste hasta 60 s: el
    ; dragoncito aparece apenas abre el juego, y el panel se confirma con el engranaje.
    velocidadSubida := SubirVelocidad(60000)


    ; Paso 1: llegar a Comunidad. Mismo llamado que Kevin -- 240s tocando la pestaña hasta que
    ; el icono se enciende. Esto YA cubre el arranque del juego desde la pantalla de titulo,
    ; por eso este script no necesita ningun script previo de pantallas de bienvenida.
    if (!clickUntilNeedle("Common_ActivatedSocialInMainMenu", 143, 518, 240, 1500)) {
        LogWarn("FALLO -- no_llego_a_comunidad")
        return "no_llego_a_comunidad"
    }
    LogInfo("paso1: en Comunidad")
    if (!velocidadSubida)
        SubirVelocidad(5000)

    ; CORREGIDO 2026-09-26 (bug real: "no dio tap en la lupa"). Yo habia emparejado cada toque
    ; con el needle equivocado. FindImageAndClick de Kevin toca PRIMERO y despues confirma con
    ; el needle, igual que nuestro clickUntilNeedle -- pero el needle que confirma tiene que ser
    ; el de la pantalla a la que SE LLEGA, no el de la que se deja.
    ; Con mi version, el paso 2 tocaba el tile de Showcases esperando ver el needle del DIALOGO
    ; de busqueda, que no puede aparecer hasta tocar la lupa. Resultado: se quedaba tocando el
    ; tile para siempre y nunca llegaba a la lupa.
    ; El emparejamiento correcto, leido de showcaseLikes() de Kevin:
    ;     toca tile (152,335)  -> confirma Friend_CommunityShowcaseMain  (la lupa)
    ;     toca lupa (224,467)  -> confirma Friend_FriendIDSearchWindow   (el dialogo)
    ;     toca campo (143,268) -> confirma Friend_ShowcaseIDInputFormBlank

    ; Paso 2: entrar a Community Showcases -- se confirma viendo la lupa del buscador por ID.
    if (!clickUntilNeedle("Friend_CommunityShowcaseMain", 152, 335, 60, 1500)) {
        LogWarn("FALLO -- no_entro_a_showcases")
        return "no_entro_a_showcases"
    }
    LogInfo("paso2: en Community Showcases")

    ; Paso 3: tocar la LUPA para abrir el dialogo de busqueda por ID.
    if (!clickUntilNeedle("Friend_FriendIDSearchWindow", 224, 467, 30, 1500)) {
        LogWarn("FALLO -- no_abrio_el_dialogo_de_id")
        return "no_abrio_el_dialogo_de_id"
    }
    LogInfo("paso3: dialogo de busqueda por ID abierto")

    ; Paso 4: enfocar el campo de texto. NO corta la corrida si el needle no matchea
    ; (2026-09-26, bug real: las dos instancias fallaban aqui con "no_enfoco_el_campo_de_id"
    ; pese a haber abierto el dialogo bien). Friend_ShowcaseIDInputFormBlank tiene su zona en
    ; (150,490)-(218,514), o sea el BORDE INFERIOR de la pantalla -- no el campo, que esta a
    ; media altura. Es la barra que dibuja el teclado de Android al abrirse, y eso depende del
    ; teclado que tenga cada instancia, asi que no es fiable como condicion de corte.
    ; Se toca igual y se sigue: la confirmacion de verdad viene al final, cuando el perfil
    ; carga y el pulgar se marca. Si el ID no entro, el perfil no aparece y ahi si falla -- y
    ; falla en seguro, sin quemar la cuenta.
    ; Espera bajada de 8 s a 2 s (2026-09-29, Ale: "al pegar la id demora bastante"). En sus
    ; instancias este needle NUNCA coincide (el log lo dice en todas las corridas), asi que
    ; siempre se esperaban los 8 s completos tocando el campo. 2 s alcanzan para que abra el
    ; teclado; el like confirmado al final sigue siendo la verificacion real.
    if (!clickUntilNeedle("Friend_ShowcaseIDInputFormBlank", 143, 268, 2, 1200))
        LogInfo("campo de id tocado (sin confirmacion por needle), se escribe el id")
    adbInput(fid)
    Sleep, 800
    adbClick(200, 364)   ; OK -- coordenada exacta de Kevin
    Sleep, 1500

    ; Paso 5 y 6: dar el like y CONFIRMARLO.
    ; Friend_CompleteClickShowcaseLike es el pulgar YA MARCADO, asi que clickUntilNeedle hace
    ; las dos cosas de una: toca el pulgar y solo devuelve true cuando lo ve marcado. Si el
    ; toque se pierde, reintenta. Si nunca se marca, devuelve false y la cuenta NO se quema.
    if (!clickUntilNeedle("Friend_CompleteClickShowcaseLike", 160, 195, 45, 2000)) {
        LogWarn("FALLO -- el_like_no_se_registro")
        return "el_like_no_se_registro"
    }

    LogInfo("LIKE CONFIRMADO")
    return ""
}

; ============ Secuencia ============
motivoError := DarLikeAlPerfil(g_friendId)
if (motivoError != "")
    ExitConError(motivoError)

LogInfo("FIN: OK")
EscribirResultado("OK")
try {
    RestoreMuMuWindow()
    if (session.get("adbShell"))
        session.get("adbShell").Terminate()
} catch e {
}
Gdip_Shutdown(pToken)
ExitApp, 0

RestoreMuMuWindow() {
    global g_mumuHwnd, g_savedWndX, g_savedWndY, g_savedWndW, g_savedWndH, g_savedWndStyle
    if (!g_mumuHwnd || !WinExist("ahk_id " . g_mumuHwnd))
        return
    if (g_savedWndStyle & 0x00C00000)
        WinSet, Style, +0xC00000, ahk_id %g_mumuHwnd%
    WinMove, ahk_id %g_mumuHwnd%, , %g_savedWndX%, %g_savedWndY%, %g_savedWndW%, %g_savedWndH%
    WinSet, Redraw, , ahk_id %g_mumuHwnd%
}
