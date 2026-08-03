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
