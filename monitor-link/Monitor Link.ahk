; Monitor Link (AutoHotkey v1) -- same job as monitor-link.js, but it runs with the AutoHotkey that
; PTCGPB already uses: no unknown .exe, no Windows SmartScreen warning, and anyone can open this file
; in Notepad and read exactly what it does.
;
; What it sends to the Zenith Rise bot:
;   - a summary of your cards: which cards each account has, how many copies, its Shinedust,
;     and the card ids of your wishlist. Never passwords.
;   - ONE account's .xml only when YOU use something in Discord that needs it (Fast Share/Trade/
;     Farm/Refresh, Extract XML). The bot uses it and deletes it.
;
; Put this file inside your PTCGPB folder (next to PTCGPB.ahk) and double-click it.

#NoEnv
#SingleInstance, force
#Persistent
; The summary is ~10 KB per account: the default 64 MB per variable runs out at ~3000 accounts.
#MaxMem 4095
SetBatchLines, -1
FileEncoding, UTF-8
SetWorkingDir, %A_ScriptDir%

global VERSION := "ahk-1.8.2"
global CFG_DIR := A_AppData . "\MonitorLink"
global CFG := CFG_DIR . "\monitor-link-ahk.ini"
global ServerUrl := "", Token := "", UserName := "", LibUrl := "", LibToken := "", Ruta := "", CarpetaJson := ""
global UltimaHuella := "", UltimoEnvio := "", CuentasEnviadas := 0, EnLinea := false, UltimoError := ""
global JobsReq := "", JobsReintento := 0, IndiceXml := "", IndiceDe := ""
; The other community hosts (the ping lists them): they get the same summary, so whichever takes over
; already has your accounts -- even if this PC is off by then.
global Espejos := [], UltimoEspejo := 0
global Status, Info, Clave, BtnLink, Inicio, LinkBox

CargarConfig()
CrearVentana()
if (Token = "") {
    MostrarVinculo(true)
} else {
    MostrarVinculo(false)
    Arrancar()
}
return

; ---------------------------------------------------------------- config
CargarConfig() {
    IniRead, ServerUrl, %CFG%, link, server, %A_Space%
    IniRead, Token, %CFG%, link, token, %A_Space%
    IniRead, UserName, %CFG%, link, user, %A_Space%
    IniRead, LibUrl, %CFG%, link, libUrl, %A_Space%
    IniRead, LibToken, %CFG%, link, libToken, %A_Space%
    IniRead, Ruta, %CFG%, folder, mainPath, %A_Space%
    CarpetaJson := CarpetaJsonDe(Ruta)
    if (CarpetaJson = "") {
        ; Inside the PTCGPB folder it already knows the Main Path.
        CarpetaJson := CarpetaJsonDe(A_ScriptDir)
        Ruta := CarpetaJson != "" ? A_ScriptDir : ""
    }
}

GuardarConfig() {
    FileCreateDir, %CFG_DIR%
    IniWrite, %ServerUrl%, %CFG%, link, server
    IniWrite, %Token%, %CFG%, link, token
    IniWrite, %UserName%, %CFG%, link, user
    IniWrite, %LibUrl%, %CFG%, link, libUrl
    IniWrite, %LibToken%, %CFG%, link, libToken
    IniWrite, %Ruta%, %CFG%, folder, mainPath
}

; ---------------------------------------------------------------- window
CrearVentana() {
    Menu, Tray, NoStandard
    Menu, Tray, Add, Open Monitor Link, AbrirVentana
    Menu, Tray, Add, Exit, Salir
    Menu, Tray, Default, Open Monitor Link
    Menu, Tray, Tip, Monitor Link

    Gui, Margin, 20, 14
    logo := A_ScriptDir . "\GUI\Images\zenith-rise-logo.png"
    if FileExist(logo)
        Gui, Add, Picture, x150 y14 w100 h100, %logo%
    Gui, Font, s16 Bold, Segoe UI
    Gui, Add, Text, xm y+8 w360 Center, MONITOR LINK
    Gui, Font, s9 Norm cGray, Segoe UI
    Gui, Add, Text, xm y+0 w360 Center, Zenith Rise - connects your PC with the Discord bot
    Gui, Font, s11 Bold, Segoe UI
    Gui, Add, Text, xm y+14 w360 Center vStatus, ...
    Gui, Font, s9 Norm cBlack, Segoe UI
    Gui, Add, Text, xm y+6 w360 r4 vInfo,
    Gui, Add, GroupBox, xm y+6 w360 h92 vLinkBox, Link this PC
    Gui, Add, Text, xp+12 yp+22 w336, In Discord, type /link in Zenith Rise and paste the key here:
    Gui, Add, Edit, xp y+6 w250 vClave
    Gui, Add, Button, x+8 yp-1 w78 h24 gVincular vBtnLink, Link
    Gui, Add, Button, xm y+28 w116 h30 gCambiarCarpeta, Change folder
    Gui, Add, Button, x+6 yp w116 h30 gSincronizar, Sync now
    Gui, Add, Button, x+6 yp w116 h30 gOcultar, Hide
    Gui, Add, Checkbox, xm y+12 vInicio gCambiarInicio, Start with Windows
    GuiControl,, Inicio, % FileExist(A_Startup . "\Monitor Link.lnk") ? 1 : 0
    Gui, Show, AutoSize, Monitor Link
}

MostrarVinculo(mostrar) {
    for _, ctl in ["LinkBox", "Clave", "BtnLink"]
        GuiControl, % mostrar ? "Enable" : "Disable", %ctl%
    PintarEstado()
}

PintarEstado() {
    if (Token = "") {
        Gui, Font, s11 Bold cDA7B00, Segoe UI
        GuiControl, Font, Status
        GuiControl,, Status, Not linked yet
    } else if (EnLinea) {
        Gui, Font, s11 Bold c1E8E3E, Segoe UI
        GuiControl, Font, Status
        GuiControl,, Status, Connected
    } else {
        Gui, Font, s11 Bold cC62828, Segoe UI
        GuiControl, Font, Status
        GuiControl,, Status, Can't reach the bot - retrying
    }
    texto := (UserName != "" ? "Discord user: " . UserName . "`n" : "")
        . "Folder: " . (Ruta != "" ? Ruta : "(not chosen yet - press Change folder)") . "`n"
        . (UltimoEnvio != "" ? "Cards summary: " . CuentasEnviadas . " accounts, sent at " . UltimoEnvio : "Cards summary: not sent yet")
        . (UltimoError != "" ? "`n" . UltimoError : "")
    GuiControl,, Info, %texto%
    Menu, Tray, Tip, % "Monitor Link - " . (Token = "" ? "not linked" : EnLinea ? "connected" : "offline")
}

AbrirVentana:
    Gui, Show
return

Ocultar:
GuiClose:
GuiEscape:
    Gui, Hide
    TrayTip, Monitor Link, Still running here next to the clock. Right-click the icon to exit., 5, 1
return

Salir:
    ExitApp
return

CambiarInicio:
    Gui, Submit, NoHide
    acceso := A_Startup . "\Monitor Link.lnk"
    if (Inicio)
        FileCreateShortcut, %A_AhkPath%, %acceso%, %A_ScriptDir%, "%A_ScriptFullPath%", Monitor Link
    else
        FileDelete, %acceso%
return

CambiarCarpeta:
    FileSelectFolder, elegida, *%Ruta%, 0, Pick your PTCGPB folder (the Main Path, with Accounts inside)
    if (ErrorLevel || elegida = "")
        return
    json := CarpetaJsonDe(elegida)
    if (json = "") {
        MsgBox, 48, Monitor Link, No accounts found there.`n`nPick the PTCGPB folder that has Accounts\Cards\accounts inside.
        return
    }
    Ruta := elegida, CarpetaJson := json, IndiceXml := ""
    GuardarConfig()
    SubirResumen(true)
return

Sincronizar:
    SubirResumen(true)
return

; ---------------------------------------------------------------- linking (/link)
Vincular:
    Gui, Submit, NoHide
    clave := Trim(Clave)
    if !RegExMatch(clave, "^ML([12])-([A-Za-z0-9_-]+)$", m) {
        MsgBox, 48, Monitor Link, That doesn't look like a link key (it starts with ML2-).`n`nType /link in Zenith Rise and copy the whole key.
        return
    }
    partes := StrSplit(Base64UrlDecode(m2), "|")
    if (partes.Length() < 2) {
        MsgBox, 48, Monitor Link, That key is damaged. Type /link again for a new one.
        return
    }
    url := RTrim(partes[1], "/")
    GuiControl, Disable, BtnLink
    cuerpo := "{""code"":""" . JsonEsc(partes[2]) . """,""version"":""" . VERSION . """}"
    r := ""
    try r := Http("POST", url . "/link/claim", cuerpo, "application/json; charset=utf-8")
    ; The bot's address changes when it restarts: if the one in the key is gone, use the current one
    ; from the address book (ML2 keys carry it) and try again.
    if (!IsObject(r) || r.status = 404 && !InStr(r.text, "invalid_or_expired_code") || r.status >= 500) {
        if (partes.Length() >= 4) {
            try {
                lr := Http("GET", partes[3] . "/get/monitor_link:url", "", "", partes[4], 15)
                if (RegExMatch(lr.text, """result""\s*:\s*""([^""]+)""", ml) && RTrim(ml1, "/") != url) {
                    url := RTrim(ml1, "/")
                    try r := Http("POST", url . "/link/claim", cuerpo, "application/json; charset=utf-8")
                }
            }
        }
    }
    if (!IsObject(r)) {
        GuiControl, Enable, BtnLink
        MsgBox, 48, Monitor Link, Could not reach the bot. Is the bot's PC on? Try again.
        return
    }
    GuiControl, Enable, BtnLink
    if (r.status != 200) {
        MsgBox, 48, Monitor Link, % InStr(r.text, "invalid_or_expired_code") ? "That key is invalid or expired (it lasts 10 minutes and works once).`n`nType /link again and press Get a new key." : "Could not link (" . r.status . "). Try again."
        return
    }
    RegExMatch(r.text, """token""\s*:\s*""([0-9a-f]+)""", t)
    RegExMatch(r.text, """user""\s*:\s*""((?:[^""\\]|\\.)*)""", u)
    ServerUrl := url, Token := t1, UserName := JsonUnesc(u1)
    LibUrl := partes.Length() >= 4 ? partes[3] : "", LibToken := partes.Length() >= 4 ? partes[4] : ""
    GuardarConfig()
    GuiControl,, Clave,
    MostrarVinculo(false)
    ; Starts with Windows by default once linked (the member can untick it), so a PC restart
    ; never leaves it closed without them noticing.
    acceso := A_Startup . "\Monitor Link.lnk"
    if !FileExist(acceso)
        FileCreateShortcut, %A_AhkPath%, %acceso%, %A_ScriptDir%, "%A_ScriptFullPath%", Monitor Link
    GuiControl,, Inicio, 1
    if (CarpetaJson = "")
        Gosub, CambiarCarpeta
    Arrancar()
return

Arrancar() {
    EnLinea := true
    SubirResumen(true)
    SetTimer, Ping, 60000
    SetTimer, ResumenPeriodico, 600000
    SetTimer, RevisarTrabajos, 300
}

NoVinculado() {
    SetTimer, Ping, Off
    SetTimer, ResumenPeriodico, Off
    SetTimer, RevisarTrabajos, Off
    Token := "", JobsReq := "", EnLinea := false
    GuardarConfig()
    MostrarVinculo(true)
    Gui, Show
    MsgBox, 48, Monitor Link, This PC is no longer linked.`n`nType /link in Zenith Rise and paste the new key.
}

; ---------------------------------------------------------------- cards summary (no passwords)
ResumenPeriodico:
    SubirResumen(false)
return

SubirResumen(forzar, folderError := "") {
    if (Token = "" || CarpetaJson = "")
        return
    huella := Huella()
    if (!forzar && folderError = "" && huella = UltimaHuella)
        return
    GuiControl,, Status, Reading your accounts...
    cuentas := 0
    body := "{""version"":""" . VERSION . """,""folder"":""" . JsonEsc(Ruta) . """,""accounts"":["
    Loop, Files, %CarpetaJson%\*.json
    {
        FileRead, t, %A_LoopFileFullPath%
        pos := InStr(t, """pulls""")
        if (!pos)
            continue
        f := RegExMatch(t, """fileName""\s*:\s*""((?:[^""\\]|\\.)*)""", mf) ? mf1 : A_LoopFileName
        n := RegExMatch(t, """accountName""\s*:\s*""((?:[^""\\]|\\.)*)""", mn) ? mn1 : f
        d := RegExMatch(t, """shinedust""\s*:\s*\{\s*""value""\s*:\s*(-?\d+)", md) ? md1 : "null"
        cartas := {}
        while (pos := RegExMatch(t, """([A-Z]+_\d+_\d+_\d+)""", mc, pos)) {
            cartas[mc1] := (cartas.HasKey(mc1) ? cartas[mc1] : 0) + 1
            pos += StrLen(mc)
        }
        c := ""
        for id, k in cartas
            c .= (c = "" ? "" : ",") . """" . id . """:" . k
        body .= (cuentas ? "," : "") . "{""f"":""" . f . """,""n"":""" . n . """,""d"":" . d . ",""c"":{" . c . "}}"
        cuentas++
    }
    body .= "]"
    ; Wishlist: Accounts\Cards\wishlist.json, next to Cards\accounts. Only the card ids.
    FileRead, w, % CarpetaPadre(CarpetaJson) . "\wishlist.json"
    if (!ErrorLevel) {
        ids := "", pos := 1
        while (pos := RegExMatch(w, """id""\s*:\s*""([A-Za-z0-9_]+)""", mw, pos)) {
            ids .= (ids = "" ? "" : ",") . """" . mw1 . """"
            pos += StrLen(mw)
        }
        body .= ",""wishlist"":[" . ids . "]"
    }
    ; Own adjustments file (what the bot already traded + what the game sync corrected). The files of
    ; Kevin/Leanny's bot are never written.
    FileRead, aj, % CarpetaPadre(CarpetaJson) . "\monitor_link.json"
    if (!ErrorLevel && SubStr(LTrim(aj, " `t`r`n"), 1, 1) = "{")
        body .= ",""adjust"":" . aj
    if (folderError != "")
        body .= ",""folderError"":""" . JsonEsc(folderError) . """"
    body .= "}"
    try {
        r := Http("POST", ServerUrl . "/link/summary", body, "text/plain; charset=utf-8", Token, 120)
    } catch e {
        SinConexion()
        return
    }
    if (r.status = 401)
        return NoVinculado()
    if (r.status != 200) {
        UltimoError := "Summary not accepted (" . r.status . ")"
        PintarEstado()
        return
    }
    ; The other hosts at most every 30 min (or right away when a host appears): while uploading, this
    ; script can't answer Discord, and the bot said "Monitor Link is not running".
    if (Espejos.Length() && (forzar || A_TickCount - UltimoEspejo > 1800000 || !UltimoEspejo)) {
        for _, espejo in Espejos
            try Http("POST", espejo . "/link/summary", body, "text/plain; charset=utf-8", Token, 120)
        UltimoEspejo := A_TickCount
    }
    UltimaHuella := huella, CuentasEnviadas := cuentas, EnLinea := true, UltimoError := ""
    FormatTime, UltimoEnvio,, HH:mm
    PintarEstado()
}

; Cheap fingerprint (names, sizes and dates) so the full summary is only re-sent when something changed.
Huella() {
    h := Ruta
    Loop, Files, %CarpetaJson%\*.json
        h .= "|" . A_LoopFileName . A_LoopFileSize . A_LoopFileTimeModified
    FileGetTime, tw, % CarpetaPadre(CarpetaJson) . "\wishlist.json"
    FileGetTime, ta, % CarpetaPadre(CarpetaJson) . "\monitor_link.json"
    return h . "|" . tw . "|" . ta
}

; ---------------------------------------------------------------- ping and Set My Folder from Discord
Ping:
    try {
        r := Http("GET", ServerUrl . "/link/ping", "", "", Token, 20)
    } catch e {
        SinConexion()
        return
    }
    if (r.status = 401) {
        NoVinculado()
        return
    }
    if (r.status != 200) {
        SinConexion()
        return
    }
    if (!EnLinea) {
        EnLinea := true
        PintarEstado()
    }
    ActualizarSiHayVersion(r.text)
    ; A host appeared (or changed address): it gets the summary right away.
    nuevos := [], antes := "", ahora := "", pm := 1
    if RegExMatch(r.text, """mirrors""\s*:\s*\[([^\]]*)\]", mm)
        while (pm := RegExMatch(mm1, """(https://[^""]+)""", mu, pm)) {
            nuevos.Push(RTrim(mu1, "/")), ahora .= RTrim(mu1, "/") . "|"
            pm += StrLen(mu)
        }
    for _, espejo in Espejos
        antes .= espejo . "|"
    if (antes != ahora) {
        Espejos := nuevos
        SubirResumen(true)
    }
    if RegExMatch(r.text, """folder""\s*:\s*""((?:[^""\\]|\\.)*)""", mp) {
        pedida := JsonUnesc(mp1)
        if (pedida != Ruta) {
            json := CarpetaJsonDe(pedida)
            if (json != "") {
                Ruta := pedida, CarpetaJson := json, IndiceXml := ""
                GuardarConfig()
                SubirResumen(true)
            } else {
                SubirResumen(true, "No Accounts\Cards\accounts inside " . pedida . " on this PC")
            }
        }
    }
return

; The bot's address changes when it restarts: look it up in the address book.
SinConexion() {
    EnLinea := false
    if (LibUrl != "" && LibToken != "") {
        try {
            r := Http("GET", LibUrl . "/get/monitor_link:url", "", "", LibToken, 15)
            if (RegExMatch(r.text, """result""\s*:\s*""([^""]+)""", ml) && RTrim(ml1, "/") != ServerUrl) {
                ServerUrl := RTrim(ml1, "/"), JobsReq := ""
                GuardarConfig()
                SubirResumen(true)
                return
            }
        }
    }
    PintarEstado()
}

; ---------------------------------------------------------------- account .xml on request
; The bot keeps a request open (up to 25 s) and answers as soon as you use something in Discord that
; needs one of your accounts. Only the files it asks for, by name, are sent.
RevisarTrabajos:
    if (Token = "" || A_TickCount < JobsReintento)
        return
    if (!IsObject(JobsReq)) {
        try {
            JobsReq := ComObjCreate("WinHttp.WinHttpRequest.5.1")
            JobsReq.SetTimeouts(5000, 10000, 30000, 40000)
            JobsReq.Open("GET", ServerUrl . "/link/jobs", true)
            JobsReq.SetRequestHeader("Authorization", "Bearer " . Token)
            JobsReq.Send()
        } catch e {
            JobsReq := "", JobsReintento := A_TickCount + 5000
            SinConexion()
        }
        return
    }
    try {
        listo := JobsReq.WaitForResponse(0)
    } catch e {
        JobsReq := "", JobsReintento := A_TickCount + 5000
        SinConexion()
        return
    }
    if (!listo)
        return
    estado := JobsReq.Status, texto := JobsReq.ResponseText, JobsReq := ""
    if (estado != 200) {
        JobsReintento := A_TickCount + 5000
        SinConexion()
        return
    }
    pos := 1
    while (pos := RegExMatch(texto, """id""\s*:\s*""([0-9a-f]+)""\s*,\s*""files""\s*:\s*\[(.*?)\]", mj, pos)) {
        pos += StrLen(mj)
        AtenderTrabajo(mj1, mj2)
    }
    pos := 1
    while (pos := RegExMatch(texto, """id""\s*:\s*""([0-9a-f]+)""\s*,\s*""action""\s*:\s*""wishlist_add""\s*,\s*""card""\s*:\s*""([A-Za-z0-9_]+)""\s*,\s*""name""\s*:\s*""((?:[^""\\]|\\.)*)""", mw, pos)) {
        pos += StrLen(mw)
        AgregarAWishlist(mw1, mw2, mw3)
    }
    pos := 1
    while (pos := RegExMatch(texto, """id""\s*:\s*""([0-9a-f]+)""\s*,\s*""action""\s*:\s*""mumu_list""", mm, pos)) {
        pos += StrLen(mm)
        ListarMuMu(mm1)
    }
    pos := 1
    while (pos := RegExMatch(texto, """id""\s*:\s*""([0-9a-f]+)""\s*,\s*""action""\s*:\s*""inject""\s*,\s*""file""\s*:\s*""((?:[^""\\]|\\.)*)""\s*,\s*""index""\s*:\s*""(\d+)""\s*,\s*""name""\s*:\s*""((?:[^""\\]|\\.)*)""", mi, pos)) {
        pos += StrLen(mi)
        InyectarEnMuMu(mi1, JsonUnesc(mi2), mi3, JsonUnesc(mi4))
    }
    pos := 1
    while (pos := RegExMatch(texto, """id""\s*:\s*""([0-9a-f]+)""\s*,\s*""action""\s*:\s*""account_json""\s*,\s*""file""\s*:\s*""((?:[^""\\]|\\.)*)""", mjs, pos)) {
        pos += StrLen(mjs)
        MandarJsonCuenta(mjs1, JsonUnesc(mjs2))
    }
    pos := 1
    while (pos := RegExMatch(texto, """id""\s*:\s*""([0-9a-f]+)""\s*,\s*""action""\s*:\s*""write_json""\s*,\s*""file""\s*:\s*""((?:[^""\\]|\\.)*)""\s*,\s*""content""\s*:\s*""([A-Za-z0-9+/=]+)""", mwj, pos)) {
        pos += StrLen(mwj)
        EscribirJsonCuenta(mwj1, JsonUnesc(mwj2), mwj3)
    }
    pos := 1
    while (pos := RegExMatch(texto, """id""\s*:\s*""([0-9a-f]+)""\s*,\s*""action""\s*:\s*""ml_file_write""\s*,\s*""content""\s*:\s*""([A-Za-z0-9+/=]+)""", mfw, pos)) {
        pos += StrLen(mfw)
        GuardarAjustes(mfw1, mfw2)
    }
return

AtenderTrabajo(id, lista) {
    archivos := "", faltan := "", enviados := 0, p := 1
    while (p := RegExMatch(lista, """((?:[^""\\]|\\.)*)""", mn, p)) {
        p += StrLen(mn)
        nombre := JsonUnesc(mn1)
        ; Not "ruta": AHK names ignore case, so it would overwrite the global Ruta (Main Path).
        xml := RutaDeXml(nombre)
        contenido := ""
        if (xml != "")
            FileRead, contenido, %xml%
        if (contenido != "") {
            archivos .= (archivos = "" ? "" : ",") . """" . JsonEsc(nombre) . """:""" . JsonEsc(contenido) . """"
            enviados++
        } else {
            faltan .= (faltan = "" ? "" : ",") . """" . JsonEsc(nombre) . """"
        }
    }
    body := "{""id"":""" . id . """,""files"":{" . archivos . "},""missing"":[" . faltan . "]}"
    try Http("POST", ServerUrl . "/link/xml", body, "text/plain; charset=utf-8", Token, 60)
    TrayTip, Monitor Link, % "Sent " . enviados . " account file(s) you asked for in Discord.", 3, 1
}

; Wishlist button in Discord: adds the card to YOUR Accounts\Cards\wishlist.json (the same file the
; bot of Kevin/Leanny and its Card Database use), then sends the updated summary.
AgregarAWishlist(id, carta, nombreJson) {
    archivo := CarpetaPadre(CarpetaJson) . "\wishlist.json"
    ok := "true", ya := "false", error := ""
    FormatTime, ahora,, yyyy-MM-ddTHH:mm:ss
    item := "{""id"": """ . carta . """, ""name"": """ . nombreJson . """}"
    if (CarpetaJson = "") {
        ok := "false", error := "no folder"
    } else if !FileExist(archivo) {
        texto := "{""version"": 1, ""updatedAt"": """ . ahora . """, ""cards"": [" . item . "]}"
    } else {
        FileRead, texto, %archivo%
        if InStr(texto, """" . carta . """") {
            ya := "true"
        } else {
            abre := InStr(texto, "[", false, InStr(texto, """cards"""))
            cierra := InStr(texto, "]", false, abre)
            if (!abre || !cierra) {
                ok := "false", error := "wishlist.json has an unexpected format"
            } else {
                hayCartas := InStr(SubStr(texto, abre, cierra - abre), "{")
                texto := SubStr(texto, 1, cierra - 1) . (hayCartas ? ", " : "") . item . SubStr(texto, cierra)
                texto := RegExReplace(texto, """updatedAt""\s*:\s*""[^""]*""", """updatedAt"": """ . ahora . """", , 1)
            }
        }
    }
    if (ok = "true" && ya = "false") {
        f := FileOpen(archivo, "w", "UTF-8-RAW")
        if (!IsObject(f)) {
            ok := "false", error := "could not write wishlist.json"
        } else {
            f.Write(texto)
            f.Close()
        }
    }
    body := "{""id"":""" . id . """,""ok"":" . ok . ",""already"":" . ya . (error != "" ? ",""error"":""" . JsonEsc(error) . """" : "") . "}"
    try Http("POST", ServerUrl . "/link/xml", body, "text/plain; charset=utf-8", Token, 30)
    if (ok = "true" && ya = "false") {
        TrayTip, Monitor Link, % "Added to your wishlist: " . JsonUnesc(nombreJson), 3, 1
        SubirResumen(false)
    }
}

; Info Accounts in Discord: the account's card file (Cards\accounts\<id>.json, the one whose
; fileName is this .xml) goes ONLY to its owner, in a private message.
MandarJsonCuenta(id, archivo) {
    buscado := RegExReplace(archivo, "i)\.xml$", "")
    encontrado := "", nombre := ""
    Loop, Files, %CarpetaJson%\*.json
    {
        FileRead, t, %A_LoopFileFullPath%
        if (RegExMatch(t, """fileName""\s*:\s*""([^""]*)""", mf) && RegExReplace(mf1, "i)\.xml$", "") = buscado) {
            encontrado := t, nombre := A_LoopFileName
            break
        }
    }
    if (encontrado = "")
        return ResponderAccion("{""id"":""" . id . """,""ok"":false,""error"":""account file not found""}")
    ResponderAccion("{""id"":""" . id . """,""ok"":true,""jsonName"":""" . JsonEsc(nombre) . """,""json"":""" . JsonEsc(encontrado) . """}")
}

; Adjustments (Accounts\Cards\monitor_link.json): this program's own file, next to Kevin/Leanny's.
GuardarAjustes(id, base64) {
    contenido := Base64UrlDecode(base64)
    if (CarpetaJson = "" || SubStr(contenido, 1, 1) != "{")
        return ResponderAccion("{""id"":""" . id . """,""ok"":false,""error"":""bad content""}")
    f := FileOpen(CarpetaPadre(CarpetaJson) . "\monitor_link.json", "w", "UTF-8-RAW")
    if (!IsObject(f))
        return ResponderAccion("{""id"":""" . id . """,""ok"":false,""error"":""could not write monitor_link.json""}")
    f.Write(contenido)
    f.Close()
    ResponderAccion("{""id"":""" . id . """,""ok"":true}")
}

; Card sync: the bot corrects this account's card file with what the game says it has (cards that
; are no longer there are removed, new ones added, copies kept). A backup <file>.json.bak is kept.
EscribirJsonCuenta(id, archivo, base64) {
    buscado := RegExReplace(archivo, "i)\.xml$", "")
    destino := ""
    Loop, Files, %CarpetaJson%\*.json
    {
        FileRead, t, %A_LoopFileFullPath%
        if (RegExMatch(t, """fileName""\s*:\s*""([^""]*)""", mf) && RegExReplace(mf1, "i)\.xml$", "") = buscado) {
            destino := A_LoopFileFullPath
            break
        }
    }
    if (destino = "")
        return ResponderAccion("{""id"":""" . id . """,""ok"":false,""error"":""account file not found""}")
    contenido := Base64UrlDecode(base64)
    if !InStr(contenido, """pulls""")
        return ResponderAccion("{""id"":""" . id . """,""ok"":false,""error"":""bad content""}")
    FileCopy, %destino%, %destino%.bak, 1
    f := FileOpen(destino, "w", "UTF-8-RAW")
    if (!IsObject(f))
        return ResponderAccion("{""id"":""" . id . """,""ok"":false,""error"":""could not write the file""}")
    f.Write(contenido)
    f.Close()
    ResponderAccion("{""id"":""" . id . """,""ok"":true}")
    SubirResumen(false)
}

; ---------------------------------------------------------------- Inject (MuMu of THIS PC)
; Inject in Discord opens one of your accounts on a MuMu instance of YOUR PC, with the same
; _InjectAccount.ahk of PTCGPB. The .xml never leaves this PC for this.
RutaMuMuManager() {
    for _, disco in StrSplit("CDEFGHIJ")
        for _, carpeta in ["MuMuPlayer", "MuMuPlayerGlobal-12.0"]
            for _, sub in ["nx_main", "shell"] {
                exe := disco . ":\Program Files\Netease\" . carpeta . "\" . sub . "\MuMuManager.exe"
                if FileExist(exe)
                    return exe
            }
    return ""
}

InfoMuMu(manager) {
    salida := A_Temp . "\MonitorLink_mumu.json"
    FileDelete, %salida%
    RunWait, %ComSpec% /c ""%manager%" info -v all > "%salida%"",, Hide
    FileRead, texto, %salida%
    FileDelete, %salida%
    return texto
}

; [{index, name, on}] from MuMuManager (one flat object per instance).
InstanciasMuMu(texto) {
    lista := [], pos := 1
    while (pos := RegExMatch(texto, "\{[^{}]*\}", mo, pos)) {
        pos += StrLen(mo)
        if !RegExMatch(mo, """index""\s*:\s*""?(\d+)", mx)
            continue
        RegExMatch(mo, """name""\s*:\s*""((?:[^""\\]|\\.)*)""", mn)
        lista.Push({index: mx1, name: (mn1 != "" ? mn1 : mx1), on: InStr(mo, """is_android_started"": true") ? 1 : 0})
    }
    return lista
}

ResponderAccion(cuerpo) {
    try Http("POST", ServerUrl . "/link/xml", cuerpo, "text/plain; charset=utf-8", Token, 30)
}

ListarMuMu(id) {
    manager := RutaMuMuManager()
    if (manager = "")
        return ResponderAccion("{""id"":""" . id . """,""ok"":false,""error"":""MuMuPlayer was not found on this PC""}")
    items := ""
    for _, i in InstanciasMuMu(InfoMuMu(manager))
        if (i.name != "NO TOCAR")
            items .= (items = "" ? "" : ",") . "{""index"":""" . i.index . """,""name"":""" . i.name . """,""on"":" . (i.on ? "true" : "false") . "}"
    ResponderAccion("{""id"":""" . id . """,""ok"":true,""instances"":[" . items . "]}")
}

InyectarEnMuMu(id, archivo, index, nombre) {
    error := ""
    xml := RutaDeXml(archivo)
    cuentasDir := CarpetaPadre(CarpetaPadre(CarpetaJson))
    script := cuentasDir . "\_InjectAccount.ahk"
    manager := RutaMuMuManager()
    if (xml = "")
        error := archivo . " was not found in your Saved folder"
    else if !FileExist(script)
        error := "_InjectAccount.ahk was not found in " . cuentasDir
    else if (manager = "")
        error := "MuMuPlayer was not found on this PC"
    if (error = "") {
        TrayTip, Monitor Link, % "Injecting " . archivo . " into instance " . nombre . "...", 3, 1
        ; Turn the instance on (if it is off) and wait until Android is up.
        encendida := false
        for _, i in InstanciasMuMu(InfoMuMu(manager))
            if (i.index = index && i.on)
                encendida := true
        if (!encendida) {
            RunWait, "%manager%" setting -v %index% -k root_permission -val true,, Hide
            SplitPath, manager,, dirManager
            SplitPath, dirManager,, baseMuMu
            exe := baseMuMu . "\shell\MuMuPlayer.exe"
            if !FileExist(exe)
                exe := baseMuMu . "\nx_main\MuMuNxMain.exe"
            if FileExist(exe)
                Run, "%exe%" -v %index%
            else
                Run, "%manager%" control -v %index% launch,, Hide
            limite := A_TickCount + 120000
            while (!encendida && A_TickCount < limite) {
                Sleep, 3000
                for _, i in InstanciasMuMu(InfoMuMu(manager))
                    if (i.index = index && i.on)
                        encendida := true
            }
            if (!encendida)
                error := "the instance did not turn on in 2 minutes"
            else
                Sleep, 5000
        }
    }
    if (error = "") {
        ini := cuentasDir . "\InjectAccount.ini"
        SplitPath, xml,,,, sinExtension
        IniWrite, %xml%, %ini%, UserSettings, selectedFilePath
        IniWrite, %nombre%, %ini%, UserSettings, winTitle
        IniWrite, %sinExtension%, %ini%, UserSettings, fileName
        IniWrite, 0, %ini%, UserSettings, sendFriendRequestAfterInject
        RunWait, "%A_AhkPath%" "%script%" --headless, %cuentasDir%, UseErrorLevel
        if (ErrorLevel = "ERROR")
            error := "could not run _InjectAccount.ahk"
        else if (ErrorLevel != 0)
            error := "_InjectAccount.ahk ended with code " . ErrorLevel
    }
    ResponderAccion("{""id"":""" . id . """,""ok"":" . (error = "" ? "true" : "false") . (error != "" ? ",""error"":""" . JsonEsc(error) . """" : "") . "}")
}

; The .xml files live in Accounts\Saved (numbered subfolders), next to Accounts\Cards.
RutaDeXml(nombre) {
    archivo := RegExMatch(nombre, "i)\.xml$") ? nombre : nombre . ".xml"
    if (!IsObject(IndiceXml) || IndiceDe != CarpetaJson || !IndiceXml.HasKey(archivo))
        ArmarIndiceXml()
    return IndiceXml.HasKey(archivo) ? IndiceXml[archivo] : ""
}

ArmarIndiceXml() {
    IndiceXml := {}, IndiceDe := CarpetaJson
    saved := CarpetaPadre(CarpetaPadre(CarpetaJson)) . "\Saved"
    Loop, Files, %saved%\*.xml, R
        IndiceXml[A_LoopFileName] := A_LoopFileFullPath
}

; ---------------------------------------------------------------- self-update
; "ahk-1.10.0" vs "ahk-1.9.2": true if the first one is newer.
VersionMasNueva(a, b) {
    a := StrSplit(RegExReplace(a, "[^0-9.]"), "."), b := StrSplit(RegExReplace(b, "[^0-9.]"), ".")
    Loop, 3 {
        x := (a[A_Index] = "" ? 0 : a[A_Index]) + 0, y := (b[A_Index] = "" ? 0 : b[A_Index]) + 0
        if (x != y)
            return x > y
    }
    return false
}

; The bot tells (in the ping) the latest published version. If it's different, download it, check it
; is really Monitor Link, replace this file and restart. The link and the window stay the same.
ActualizarSiHayVersion(texto) {
    if !RegExMatch(texto, """ahk""\s*:\s*\{[^}]*""version""\s*:\s*""([^""]+)""[^}]*""url""\s*:\s*""([^""]+)""", ma)
        return
    ; Only to a NEWER version (never back to an older published one).
    if (!VersionMasNueva(ma1, VERSION) || !RegExMatch(ma2, "^https://github\.com/"))
        return
    nuevo := A_Temp . "\MonitorLink_update.ahk"
    UrlDownloadToFile, %ma2%, %nuevo%
    if (ErrorLevel)
        return
    FileRead, contenido, %nuevo%
    if (!InStr(contenido, "global VERSION := """ . ma1 . """") || !InStr(contenido, "MONITOR LINK")) {
        FileDelete, %nuevo%
        return
    }
    FileCopy, %nuevo%, %A_ScriptFullPath%, 1
    FileDelete, %nuevo%
    TrayTip, Monitor Link, Updated to %ma1% - restarting., 3, 1
    Sleep, 1500
    Reload
}

; ---------------------------------------------------------------- folders
; Accepts the Main Path (the PTCGPB folder), Accounts, Accounts\Cards or Accounts\Cards\accounts.
CarpetaJsonDe(ruta) {
    ruta := RTrim(Trim(ruta, " `t"""), "\/")
    if (ruta = "")
        return ""
    for _, c in [ruta, ruta . "\accounts", ruta . "\Cards\accounts", ruta . "\Accounts\Cards\accounts"]
        if (HayCuentas(c))
            return c
    return ""
}

HayCuentas(dir) {
    Loop, Files, %dir%\*.json
    {
        FileRead, t, %A_LoopFileFullPath%
        return InStr(t, """pulls""") ? true : false
    }
    return false
}

CarpetaPadre(ruta) {
    SplitPath, ruta,, padre
    return padre
}

; ---------------------------------------------------------------- helpers
Http(metodo, url, body := "", tipo := "", bearer := "", segundos := 30) {
    req := ComObjCreate("WinHttp.WinHttpRequest.5.1")
    req.SetTimeouts(5000, 10000, 30000, segundos * 1000)
    req.Open(metodo, url, false)
    if (tipo != "")
        req.SetRequestHeader("Content-Type", tipo)
    if (bearer != "")
        req.SetRequestHeader("Authorization", "Bearer " . bearer)
    if (body != "")
        req.Send(body)
    else
        req.Send()
    return {status: req.Status, text: req.ResponseText}
}

JsonEsc(s) {
    s := StrReplace(s, "\", "\\")
    s := StrReplace(s, """", "\""")
    s := StrReplace(s, "`r", "\r")
    s := StrReplace(s, "`n", "\n")
    return StrReplace(s, "`t", "\t")
}

JsonUnesc(s) {
    s := StrReplace(s, "\\", Chr(1))
    s := StrReplace(s, "\""", """")
    s := StrReplace(s, "\/", "/")
    return StrReplace(s, Chr(1), "\")
}

Base64UrlDecode(s) {
    s := StrReplace(StrReplace(s, "-", "+"), "_", "/")
    while (Mod(StrLen(s), 4))
        s .= "="
    n := 0
    DllCall("Crypt32\CryptStringToBinary", "Str", s, "UInt", 0, "UInt", 1, "Ptr", 0, "UInt*", n, "Ptr", 0, "Ptr", 0)
    VarSetCapacity(buf, n, 0)
    DllCall("Crypt32\CryptStringToBinary", "Str", s, "UInt", 0, "UInt", 1, "Ptr", &buf, "UInt*", n, "Ptr", 0, "Ptr", 0)
    return StrGet(&buf, n, "UTF-8")
}
