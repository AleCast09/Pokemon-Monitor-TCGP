; _AdbUtils.ahk
; Utilidades propias de ADB/ventana MuMu -- sin ningun #Include de la carpeta de
; Kevin (C:\POKEMON\PTCGPB-ALE\Scripts\Include\). Reimplementa desde cero, con
; tecnicas genericas de ADB/Android (documentadas publicamente, no logica
; propietaria de nadie), lo minimo que necesitan nuestros propios scripts de
; automatizacion (_CountShinedust.ahk, _SendTradeCard.ahk, _FinalizeTradeCard.ahk):
; encontrar la ventana de una instancia, resolver su puerto ADB, y tap/swipe/
; screenshot/texto via adb.exe directo.

; Ventana de una instancia de MuMu -- titulo exacto "<nombre> ahk_class Qt5156QWindowIcon"
; (confirmado en vivo contra instancias reales). Una sola linea, generica.
obtenerHwndMuMu(winTitle) {
    return WinExist(winTitle . " ahk_class Qt5156QWindowIcon")
}

; Encuentra adb.exe dentro de la carpeta base de MuMu (mismos candidatos que ya
; usa bot.js en rutaAdbExe()).
resolverRutaAdb(folderPath) {
    candidatos := [folderPath . "\shell\adb.exe", folderPath . "\nx_main\adb.exe"]
    for _, candidato in candidatos {
        if FileExist(candidato)
            return candidato
    }
    return ""
}

; Mismo dato que ya lee bot.js (obtenerPuertoAdbInstancia): vm_config.json de la
; instancia -> vm.nat.port_forward.adb.host_port. Ubica la carpeta por el nombre
; de instancia (winTitle) buscando el extra_config.json con ese playerName, o el
; nombre de carpeta si no hay playerName -- mismo criterio que GetVmDisplayName.
resolverPuertoAdb(folderPath, winTitle) {
    Loop, Files, %folderPath%\vms\*, D
    {
        carpeta := A_LoopFileFullPath
        displayName := ""
        extraConfig := carpeta . "\configs\extra_config.json"
        if FileExist(extraConfig) {
            FileRead, contenidoExtra, %extraConfig%
            RegExMatch(contenidoExtra, """playerName"":\s*""(.*?)""", playerName)
            displayName := playerName1
        }
        if (displayName = "") {
            SplitPath, carpeta, nombreCarpeta
            displayName := nombreCarpeta
        }
        if (displayName = winTitle) {
            vmConfig := carpeta . "\configs\vm_config.json"
            if FileExist(vmConfig) {
                FileRead, contenidoVm, %vmConfig%
                RegExMatch(contenidoVm, """adb"":\s*\{[^\}]*""host_port"":\s*""(\d+)""", puerto)
                return puerto1
            }
        }
    }
    return ""
}

AdbEjecutar(adbPath, puerto, argumentos) {
    device := "127.0.0.1:" . puerto
    comando := """" . adbPath . """ -s " . device . " " . argumentos
    RunWait, %ComSpec% /c "%comando%", , Hide
}

; Sin conversion: todas las coordenadas usadas en los scripts de esta sesion
; (270,925 para Comunidad, etc.) ya son pixeles reales del dispositivo
; (540x960) -- se descubrieron tocando directo con adb mientras se miraban
; capturas, no son coordenadas logicas de ventana. Bug real encontrado
; 2026-07-29: esta funcion todavia aplicaba la formula de escala pensada para
; coordenadas logicas, mandando TODOS los toques de las 6 piezas nuevas a
; posiciones incorrectas (mismo bug que ya se habia corregido en bot.js pero
; no aca).
AdbTap(adbPath, puerto, x, y) {
    AdbEjecutar(adbPath, puerto, "shell input tap " . x . " " . y)
}

; Boton "Atras" de Android (2026-08-30, a pedido explicito del usuario -- caso real visto en
; vivo): algunas pantallas de pantalla completa sin ningun control visible (ej. el efecto que
; aparece al marcar una carta como favorita por primera vez) NO se pueden cerrar con ningun tap
; -- solo con el boton Atras del sistema. Generico, no depende de icono ni texto, funciona en
; cualquier idioma.
AdbKeyBack(adbPath, puerto) {
    AdbEjecutar(adbPath, puerto, "shell input keyevent 4")
}

; Nombre con sufijo "Propio" (no solo "AdbSwipe"): AutoHotkey no distingue
; mayusculas/minusculas en nombres de funcion, y el include\ADB.ahk de Kevin
; ya trae su propia "adbSwipe" -- con el mismo nombre (aunque distinta
; capitalizacion) chocan como "Duplicate function definition" apenas un
; script incluye ambos archivos a la vez (bug real 2026-08-02, encontrado
; armando el reconocimiento de imagen de _CountShinedust.ahk).
AdbSwipePropio(adbPath, puerto, x, y1, y2, duracionMs := 400) {
    AdbEjecutar(adbPath, puerto, "shell input swipe " . x . " " . y1 . " " . x . " " . y2 . " " . duracionMs)
}

; Texto tal cual (sin conversion de coordenadas) -- usado para tipear en cajas
; de busqueda/ID de amigo.
AdbInputText(adbPath, puerto, texto) {
    AdbEjecutar(adbPath, puerto, "shell input text " . texto)
}

; Captura la salida de un comando adb (a diferencia de AdbEjecutar, que la descarta) --
; agregada 2026-08-05 para poder chequear si el juego ya esta abierto ANTES de forzar un
; "am start" (ver juegoYaAbierto en _WaitWelcomeScreens.ahk): reporte real del usuario de
; que reforzar la apertura de un juego que ya estaba abierto (recien inyectado) lo
; interrumpia a mitad de carga y lo crasheaba -- mismo patron ya visto y documentado con
; el am start periodico que se saco por el mismo motivo.
AdbEjecutarConSalida(adbPath, puerto, argumentos) {
    device := "127.0.0.1:" . puerto
    tempOut := A_Temp . "\_adb_out_" . A_TickCount . ".txt"
    comando := """" . adbPath . """ -s " . device . " " . argumentos . " > """ . tempOut . """ 2>&1"
    RunWait, %ComSpec% /c "%comando%", , Hide
    salida := ""
    if FileExist(tempOut) {
        FileRead, salida, %tempOut%
        FileDelete, %tempOut%
    }
    return salida
}

; NOTA (2026-08-05): se probo agregar una captura por GDI+ (estilo Kevin, ver
; include\ADB.ahk adbTakeScreenshot) para evitar la contencion del servidor adb compartido
; en paralelo -- SACADA de aca porque rompia cualquier script que incluya _AdbUtils.ahk sin
; tambien incluir Gdip_All.ahk (ej. _CaptureAdbShot.ahk), con un error fatal de "funcion
; inexistente" en tiempo de parseo. Ademas, la prueba en vivo mostro que obtenerHwndMuMu no
; encuentra la ventana de instancias nombradas (ej. "Main") -- hace falta revisar como
; resuelve el handle correcto include\MumuHelper.ahk de Kevin antes de reintentar esto.
AdbScreenshot(adbPath, puerto, outputFile) {
    device := "127.0.0.1:" . puerto
    comando := """" . adbPath . """ -s " . device . " exec-out screencap -p > """ . outputFile . """"
    RunWait, %ComSpec% /c "%comando%", , Hide
}

AdbConectar(adbPath, puerto) {
    device := "127.0.0.1:" . puerto
    comando := """" . adbPath . """ connect " . device
    RunWait, %ComSpec% /c "%comando%", , Hide
}

; capturarVentana (2026-08-25, a pedido explicito del usuario -- "los usuarios me dijeron que
; demora mucho, hagamos que haga match mas rapido"): reemplaza AdbScreenshot para el
; RECONOCIMIENTO de needles (no para tap/swipe, que siguen siendo ADB) -- captura la ventana
; de Windows directo via PrintWindow (misma tecnica que from_window() del bot de Kevin,
; Scripts\Include\Utils.ahk -- la bandera 0x3 = PW_CLIENTONLY|PW_RENDERFULLCONTENT es la que
; hace que esto funcione contra una ventana con render por GPU como MuMu, sin salir todo
; negro). Confirmado en vivo: ~0ms por captura contra 150-400ms+ de AdbScreenshot, porque
; agarra los pixeles que la ventana YA tiene dibujados en pantalla, sin pedirle nada al
; emulador. Devuelve un puntero de bitmap GDI+ (mismo tipo que Gdip_CreateBitmapFromFile) --
; el llamador es responsable de Gdip_DisposeImage() cuando termine, igual que siempre.
;
; OJO: usa DllCall("gdiplus\...") directo, NO llama ninguna funcion de Gdip_All.ahk -- asi
; esta funcion puede vivir en este archivo compartido sin romper los scripts que incluyen
; _AdbUtils.ahk pero NO Gdip_All.ahk (mismo problema ya documentado arriba en el intento
; descartado 2026-08-05). Igual, GDI+ debe estar inicializado (Gdip_Startup() ya llamado)
; antes de usar esto -- todo script que necesite needles ya lo hace de entrada.
;
; La resolucion de esta captura es la NATIVA de la ventana (chica, ~275x532 en vez de los
; 540x960 de un screenshot ADB) -- los needles para usar con esto son propios, recortados a
; esta escala, NO reusan los needles ya existentes (esos estan todos a escala ADB).
capturarVentana(hwnd) {
    if DllCall("IsIconic", "ptr", hwnd)
        DllCall("ShowWindow", "ptr", hwnd, "int", 4)
    VarSetCapacity(Rect, 16)
    DllCall("GetClientRect", "ptr", hwnd, "ptr", &Rect)
    width := NumGet(Rect, 8, "int")
    height := NumGet(Rect, 12, "int")
    if (width < 10 || height < 10)
        return 0
    hdc := DllCall("CreateCompatibleDC", "ptr", 0, "ptr")
    VarSetCapacity(bi, 40, 0)
    NumPut(40, bi, 0, "uint")
    NumPut(width, bi, 4, "uint")
    NumPut(-height, bi, 8, "int")
    NumPut(1, bi, 12, "ushort")
    NumPut(32, bi, 14, "ushort")
    NumPut(0, bi, 16, "uint")
    hbm := DllCall("CreateDIBSection", "ptr", hdc, "ptr", &bi, "uint", 0, "ptr*", pBits:=0, "ptr", 0, "uint", 0, "ptr")
    obm := DllCall("SelectObject", "ptr", hdc, "ptr", hbm, "ptr")
    DllCall("PrintWindow", "ptr", hwnd, "ptr", hdc, "uint", 0x3) ; PW_CLIENTONLY | PW_RENDERFULLCONTENT
    DllCall("gdiplus\GdipCreateBitmapFromHBITMAP", "ptr", hbm, "ptr", 0, "ptr*", pBitmap:=0)
    DllCall("SelectObject", "ptr", hdc, "ptr", obm)
    DllCall("DeleteObject", "ptr", hbm)
    DllCall("DeleteDC", "ptr", hdc)
    return pBitmap
}
