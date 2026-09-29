; _InjectAccountFast.ahk -- creado 2026-08-19, a pedido explicito del usuario.
; Reemplaza el uso de _InjectAccount.ahk (herramienta de Kevin, sin tocarla) SOLO para
; nuestro propio pipeline de Main Trade. Mismo objetivo (force-stop del juego, limpiar
; datos de la cuenta anterior, subir el XML nuevo, reabrir el juego) pero con UNA sola
; conexion "adb shell" persistente en vez de un proceso adb.exe nuevo por cada comando.
;
; Diagnosticado en vivo el mismo dia comparando ambos bots lado a lado: el bot de Kevin
; (Scripts\Include\ADB.ahk, funcion adbWriteRaw) usa exactamente este patron -- una shell
; interactiva abierta una vez (WScript.Shell.Exec), comandos escritos a su StdIn -- y corre
; 3 instancias inyectando cuentas seguidas sin colgarse nunca. _InjectAccount.ahk (script
; SEPARADO de Kevin que veniamos usando nosotros, sin este patron) hace ~20 comandos ADB
; secuenciales via RunAdbRootCommand, cada uno lanzando un adb.exe nuevo con hasta 3
; reintentos -- eso solo, en el mejor caso, ya suma 10-14s, y bajo la misma carga de
; recursos que veniamos viendo hoy (varias instancias pesadas a la vez) alguno de esos
; ~20 procesos nuevos falla/tarda seguido, encadenando reintentos hasta pasarse del
; timeout externo de 90s.
;
; Uso: _InjectAccountFast.ahk "<winTitle>" "<folderPath>" "<rutaXmlCuenta>" "<outputFile>"

#SingleInstance off
SetBatchLines, -1
#NoEnv

if (A_Args.Length() < 4) {
    ExitApp, 1
}

global g_winTitle   := A_Args[1]
global g_folderPath := A_Args[2]
global g_rutaXml    := A_Args[3]
global g_outputFile := A_Args[4]
global g_contadorComandos := 0

#Include %A_ScriptDir%\_AdbUtils.ahk

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
    global procShell
    WriteResult("ERROR: " . motivo)
    try {
        Process, Close, % procShell.ProcessID
    } catch e {
    }
    ExitApp, 3
}

if (!FileExist(g_rutaXml))
    ExitConError("xml_no_encontrado")

adbPath := resolverRutaAdb(g_folderPath)
if (adbPath = "")
    ExitConError("adb_no_encontrado")
puerto := resolverPuertoAdb(g_folderPath, g_winTitle)
if (puerto = "")
    ExitConError("puerto_no_encontrado")

AdbConectar(adbPath, puerto)

device := "127.0.0.1:" . puerto

; Reinicia el daemon adb en modo root (2026-08-19, bug real reproducido en vivo): activar
; "root_permission" en MuMuManager ANTES de prender la instancia (ver lanzarInstanciaMuMu
; en bot.js) no alcanza por si solo -- el daemon adb puede seguir arrancando como usuario
; "shell" igual, y varios de los comandos de mas abajo (rm/cp/chmod/chown en
; /data/data/...) necesitan root de verdad o fallan con "Permission denied". "adb root"
; le pide al daemon que se reinicie como root -- confirmado en vivo que sin este paso el
; script fallaba consistente en el primer "rm" (root_permission activado en MuMu, pero el
; shell seguia reportando uid=2000(shell) hasta este comando).
comandoRoot := """" . adbPath . """ -s " . device . " root"

; Conexion adb shell PERSISTENTE -- una sola, reusada para todos los comandos de esta
; corrida (ver comentario del header). Cada comando se envuelve en "(comando) && echo OK_N
; || echo FAIL_N" -- a diferencia de solo "echo marcador" a ciegas, esto SI distingue un
; comando que realmente fallo de uno que termino bien, igual que el chequeo de ErrorLevel
; que hacia el RunWait de antes (pero sin pagar el costo de un proceso nuevo por comando).
comandoShell := """" . adbPath . """ -s " . device . " shell"
wshShell := ComObjCreate("WScript.Shell")

; Apertura VERIFICADA de la shell root (2026-09-19, estilo initializeAdbShell de Kevin en
; include\ADB.ahk). Bug real reproducido en vivo con Ale: con la instancia recien prendida, el
; "adb root" + 1.5s fijos no alcanzaba -- la shell quedaba muerta o como usuario comun, TODOS los
; comandos fallaban, el juego nunca se abria (logcat de Android sin una sola linea del juego) y
; la instancia quedaba en el escritorio de Android. Kevin, en cambio, verifica que la shell este
; viva y si no desconecta, reconecta y reintenta. Aca ademas se confirma que sea root de verdad
; (uid=0), porque los comandos de abajo sobre /data/data lo necesitan.
;
; 2026-09-22 (a pedido explicito de Ale, "hagamoslo como el de Kevin"): dos cambios mas aca.
; 1) Solo se abre una shell nueva si no hay una viva, igual que el guard de initializeAdbShell
;    de Kevin (include\ADB.ahk:229 -- "if (!session.get("adbShell") || Status != 0)"). Antes
;    este Loop abria una shell nueva en CADA vuelta, hasta 6 por inyeccion.
; 2) Se oculta la consola de adb.exe que crea el Exec (ver consolasVisiblesActuales /
;    ocultarConsolaNueva en _AdbUtils.ahk) -- era la ventana negra que Ale fotografio saltando
;    al frente a mitad del trade.
shellOk := false
Loop, 6 {
    RunWait, %ComSpec% /c "%comandoRoot%", , Hide
    Sleep, 1500
    AdbConectar(adbPath, puerto)
    shellViva := false
    try {
        shellViva := (IsObject(procShell) && procShell.Status = 0)
    } catch e {
        shellViva := false
    }
    if (!shellViva) {
        consolasPrevias := consolasVisiblesActuales()
        procShell := wshShell.Exec(comandoShell)
        ocultarConsolaNueva(consolasPrevias)
    }
    Sleep, 500
    if (procShell.Status = 0 && AdbShellComando("id | grep -q uid=0", 8000)) {
        shellOk := true
        break
    }
    try procShell.Terminate()
    RunWait, %ComSpec% /c ""%adbPath%" disconnect %device%", , Hide
    Sleep, 2000
    AdbConectar(adbPath, puerto)
}
if (!shellOk)
    ExitConError("shell_adb_root_no_disponible")

AdbShellComando(comando, timeoutMs := 15000) {
    global procShell, g_contadorComandos
    g_contadorComandos++
    marcadorOk := "OK_" . g_contadorComandos
    marcadorFail := "FAIL_" . g_contadorComandos
    try {
        procShell.StdIn.WriteLine("(" . comando . ") && echo " . marcadorOk . " || echo " . marcadorFail)
    } catch e {
        return false
    }
    inicio := A_TickCount
    Loop {
        if (procShell.Status != 0)
            return false
        if (!procShell.StdOut.AtEndOfStream) {
            linea := procShell.StdOut.ReadLine()
            if InStr(linea, marcadorOk)
                return true
            if InStr(linea, marcadorFail)
                return false
        } else {
            Sleep, 20
        }
        if (A_TickCount - inicio > timeoutMs)
            return false
    }
}

; Reintento generico (2026-09-03, bug real reproducido en vivo con Ale -- "Could not prepare
; the donor instance 1 (ERROR: am_force_stop)"): AdbShellComando no reintentaba nada, un solo
; hipo momentaneo de la conexion adb (visto pasar varias veces hoy con distintos scripts,
; "device offline" y similares) cortaba el force-stop -- el primer comando de toda la
; secuencia -- sin darle ninguna chance de recuperarse solo. 3 intentos con una pausa corta
; entre cada uno, igual de rapido que antes en el caso normal (sin reintento real).
AdbShellComandoConReintento(comando, intentos := 3, timeoutMs := 15000) {
    Loop, %intentos% {
        if (AdbShellComando(comando, timeoutMs))
            return true
        if (A_Index < intentos)
            Sleep, 1000
    }
    return false
}

; Mismos ~20 pasos que loadAccount() en _InjectAccount.ahk de Kevin, en el mismo orden
; (force-stop, borrar cuenta vieja + preferencias de usuario, subir XML nuevo, aplicarlo
; con permisos correctos, reabrir el juego) -- solo cambia COMO se manda cada comando.
UserPreferencesPath := "/data/data/jp.pokemon.pokemontcgp/files/UserPreferences/v1/"
UserPreferences := ["BattleUserPrefs", "FeedUserPrefs", "FilterConditionUserPrefs", "HomeBattleMenuUserPrefs"
    , "MissionUserPrefs", "NotificationUserPrefs", "PackUserPrefs", "PvPBattleResumeUserPrefs"
    , "RankMatchPvEResumeUserPrefs", "RankMatchUserPrefs", "SoloBattleResumeUserPrefs", "SortConditionUserPrefs"]

if (!AdbShellComandoConReintento("am force-stop jp.pokemon.pokemontcgp"))
    ExitConError("am_force_stop")

if (!AdbShellComandoConReintento("rm -f /data/data/jp.pokemon.pokemontcgp/shared_prefs/deviceAccount:.xml"))
    ExitConError("rm_deviceaccount_viejo")

Loop, % UserPreferences.MaxIndex() {
    if (!AdbShellComandoConReintento("rm -f " . UserPreferencesPath . UserPreferences[A_Index]))
        ExitConError("rm_userprefs_" . A_Index)
}

; Unico paso que SI necesita un proceso adb.exe nuevo -- "adb push" es un comando del
; cliente adb en si, no algo que se le pueda escribir a una shell interactiva ya abierta.
; Sigue siendo 1 sola vez (no 20).
comandoPush := """" . adbPath . """ -s " . device . " push """ . g_rutaXml . """ /sdcard/deviceAccount.xml"
RunWait, %ComSpec% /c "%comandoPush%", , Hide
if (ErrorLevel != 0)
    ExitConError("push_xml")

if (!AdbShellComandoConReintento("mkdir -p /data/data/jp.pokemon.pokemontcgp/shared_prefs"))
    ExitConError("mkdir_shared_prefs")

if (!AdbShellComandoConReintento("cp /sdcard/deviceAccount.xml /data/data/jp.pokemon.pokemontcgp/shared_prefs/deviceAccount:.xml"))
    ExitConError("copiar_deviceaccount")

if (!AdbShellComandoConReintento("chmod 664 /data/data/jp.pokemon.pokemontcgp/shared_prefs/deviceAccount:.xml && chown system:system /data/data/jp.pokemon.pokemontcgp/shared_prefs/deviceAccount:.xml"))
    ExitConError("chmod_chown")

if (!AdbShellComandoConReintento("rm -f /sdcard/deviceAccount.xml"))
    ExitConError("limpiar_xml_temporal")

; No bloquea si falla -- mismo criterio que _InjectAccount.ahk (esta linea no chequea su
; propio resultado ahi tampoco).
AdbShellComando("rm -f /data/data/jp.pokemon.pokemontcgp/files/UserPreferences/v1/MissionUserPrefs")

; Apertura verificada (2026-09-19, estilo startPTCGPApp de Kevin -- ver abrirJuegoVerificado en
; _AdbUtils.ahk): antes se mandaba "am start" y se daba por abierto sin comprobarlo. Si el juego
; crasheaba al arrancar, la instancia quedaba en el escritorio de Android y el paso siguiente
; fallaba mucho despues por timeout (visto varias veces en vivo con Ale).
if (!abrirJuegoVerificado(adbPath, puerto))
    ExitConError("abrir_juego")

try {
    Process, Close, % procShell.ProcessID
} catch e {
}

WriteResult("OK")
ExitApp, 0
