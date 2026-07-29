; _InjectXml.ahk
; Pieza aislada: inyecta un XML en una instancia por ADB directo (sin Kevin) y
; espera a que el juego termine de cargar hasta el splash "Toca para
; comenzar". No agrega amigos ni maneja popups -- eso son otras piezas
; (_AddFriendAndRequest.ahk / _ClosePopupIfAny.ahk).
;
; Uso: _InjectXml.ahk "<winTitle>" "<folderPath>" "<xmlPath>" "<outputFile>"

#SingleInstance off
SetBatchLines, -1
#NoEnv

if (A_Args.Length() < 4) {
    ExitApp, 1
}

global g_winTitle   := A_Args[1]
global g_folderPath := A_Args[2]
global g_xmlPath    := A_Args[3]
global g_outputFile := A_Args[4]

#Include %A_ScriptDir%\_AdbUtils.ahk
#Include %A_ScriptDir%\_OcrUtils.ahk
#Include %A_ScriptDir%\lib\Gdip_All.ahk
#Include %A_ScriptDir%\lib\Gdip_Extra.ahk

global pToken := Gdip_Startup()

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
    global pToken
    EscribirResultado("ERROR: " . motivo)
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

APP_ID_PTCGP := "jp.pokemon.pokemontcgp"
AdbShellDirecto(puerto, comando) {
    global adbPath
    device := "127.0.0.1:" . puerto
    cmd := """" . adbPath . """ -s " . device . " shell " . comando
    RunWait, %ComSpec% /c "%cmd%", , Hide
}

AdbConectar(adbPath, puerto)
cmdRoot := """" . adbPath . """ -s 127.0.0.1:" . puerto . " root"
RunWait, %ComSpec% /c "%cmdRoot%", , Hide
Sleep, 500

AdbShellDirecto(puerto, "am force-stop " . APP_ID_PTCGP)
Sleep, 200
AdbShellDirecto(puerto, "rm -f /data/data/" . APP_ID_PTCGP . "/shared_prefs/deviceAccount:.xml")
Sleep, 200

prefs := ["BattleUserPrefs", "FeedUserPrefs", "FilterConditionUserPrefs", "HomeBattleMenuUserPrefs"
    , "MissionUserPrefs", "NotificationUserPrefs", "PackUserPrefs", "PvPBattleResumeUserPrefs"
    , "RankMatchPvEResumeUserPrefs", "RankMatchUserPrefs", "SoloBattleResumeUserPrefs", "SortConditionUserPrefs"]
for _, pref in prefs {
    AdbShellDirecto(puerto, "rm -f /data/data/" . APP_ID_PTCGP . "/files/UserPreferences/v1/" . pref)
    Sleep, 100
}

device := "127.0.0.1:" . puerto
cmdPush := """" . adbPath . """ -s " . device . " push """ . g_xmlPath . """ /sdcard/deviceAccount.xml"
RunWait, %ComSpec% /c "%cmdPush%", , Hide
Sleep, 150

AdbShellDirecto(puerto, "mkdir -p /data/data/" . APP_ID_PTCGP . "/shared_prefs")
Sleep, 100
AdbShellDirecto(puerto, "cp /sdcard/deviceAccount.xml /data/data/" . APP_ID_PTCGP . "/shared_prefs/deviceAccount:.xml")
Sleep, 100
AdbShellDirecto(puerto, "chmod 664 /data/data/" . APP_ID_PTCGP . "/shared_prefs/deviceAccount:.xml && chown system:system /data/data/" . APP_ID_PTCGP . "/shared_prefs/deviceAccount:.xml")
Sleep, 200
AdbShellDirecto(puerto, "rm -f /sdcard/deviceAccount.xml")
AdbShellDirecto(puerto, "rm -f /data/data/" . APP_ID_PTCGP . "/files/UserPreferences/v1/MissionUserPrefs")
AdbShellDirecto(puerto, "am start -W -n " . APP_ID_PTCGP . "/com.unity3d.player.UnityPlayerActivity -f 0x10018000")

; ============ Esperar a que salga del splash "Toca para comenzar" ============
CapturarPantalla(puerto) {
    global adbPath
    ruta := A_ScriptDir . "\Logs\_inj_" . puerto . "_" . A_TickCount . ".png"
    AdbScreenshot(adbPath, puerto, ruta)
    return ruta
}
LeerTitulo(puerto) {
    ruta := CapturarPantalla(puerto)
    texto := ""
    if FileExist(ruta) {
        try {
            pBitmapOriginal := Gdip_CreateBitmapFromFile(ruta)
            pBitmapFormatted := Gdip_CropResizeGreyscaleContrast(pBitmapOriginal, 0, 40, 540, 130, 150, 0)
            texto := GetTextFromBitmap(pBitmapFormatted)
            Gdip_DisposeImage(pBitmapOriginal)
            Gdip_DisposeImage(pBitmapFormatted)
        } catch e {
            texto := ""
        }
        FileDelete, %ruta%
    }
    return texto
}

; 8 segundos entre intentos (no 4): el juego puede seguir ocupado cargando
; aunque el splash ya se vea en pantalla, y un toque en ese momento no
; registra -- confirmado en vivo 2026-07-29.
tocoInicio := false
Loop, 12 {
    AdbTap(adbPath, puerto, 270, 820) ; "Toca para comenzar"
    Sleep, 8000
    texto := LeerTitulo(puerto)
    if (!InStr(texto, "Ver.") && !InStr(texto, "Support")) {
        tocoInicio := true
        break
    }
}
if (!tocoInicio)
    ExitConError("no_salio_del_splash")

EscribirResultado("OK")
Gdip_Shutdown(pToken)
ExitApp, 0
