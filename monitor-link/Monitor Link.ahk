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

global VERSION := "ahk-1.9.14"
global CFG_DIR := A_AppData . "\MonitorLink"
global CFG := CFG_DIR . "\monitor-link-ahk.ini"
global ServerUrl := "", Token := "", UserName := "", LibUrl := "", LibToken := "", Ruta := "", CarpetaJson := ""
global UltimaHuella := "", UltimoEnvio := "", CuentasEnviadas := 0, EnLinea := false, UltimoError := ""
global JobsReq := "", JobsReintento := 0, IndiceXml := "", IndiceDe := "", IndiceSinPrefijo := {}, IndiceCuentas := ""
; The other community hosts (the ping lists them): they get the same summary, so whichever takes over
; already has your accounts -- even if this PC is off by then.
global Espejos := [], UltimoEspejo := 0
global JobServer := "", JobsEsp := {}, JobsEspRetry := {}   ; job polling of the other hosts
; Share proxies: the member's own proxy list (.txt) for the hosts' reroll. Re-sent when the file changes.
global ProxyFile := "", ProxyHuella := "", ProxiesEnviadas := ""
; Share accounts: the accounts (96+ packs) the member lends to the hosts' reroll. Only their NAMES are
; sent; each .xml is sent when a host is about to open it (like Fast Share) and the host deletes it.
global CFG_REROLL := CFG_DIR . "\reroll_accounts.txt", CFG_REROLL_LOG := CFG_DIR . "\reroll_log.txt"
global CuentasReroll := {}, UltimoReroll := ""
global CompGP := "", Comp96 := ""   ; shared accounts for the GP farm (eligible) / the 96P pack farm (locked)
global Amigos := ""   ; Discord IDs (comma separated) of friends who can use this member's accounts in the bot
global Status, Info, Clave, BtnLink, Inicio, LinkBox, LVCuentas, Barra

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
    IniRead, ProxyFile, %CFG%, proxies, file, %A_Space%
    IniRead, Amigos, %CFG%, friends, ids, %A_Space%
    CuentasReroll := {}
    Loop, Read, %CFG_REROLL%
        if (Trim(A_LoopReadLine) != "")
            CuentasReroll[Trim(A_LoopReadLine)] := true
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
    IniWrite, %ProxyFile%, %CFG%, proxies, file
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
    ; Progress while reading/sending the accounts (600+ accounts take a while; without it the window
    ; looked frozen and Windows said "Not responding").
    Gui, Add, Progress, xm y+4 w360 h10 c1E8E3E vBarra Hidden, 0
    Gui, Font, s9 Norm cBlack, Segoe UI
    Gui, Add, Text, xm y+6 w360 r7 vInfo,
    Gui, Add, GroupBox, xm y+6 w360 h92 vLinkBox, Link this PC
    Gui, Add, Text, xp+12 yp+22 w336, In Discord, type /link in Zenith Rise and paste the key here:
    Gui, Add, Edit, xp y+6 w250 vClave
    Gui, Add, Button, x+8 yp-1 w78 h24 gVincular vBtnLink, Link
    Gui, Add, Button, xm y+28 w116 h30 gCambiarCarpeta, Change folder
    Gui, Add, Button, x+6 yp w116 h30 gSincronizar, Sync now
    Gui, Add, Button, x+6 yp w116 h30 gOcultar, Hide
    Gui, Add, Button, xm y+6 w177 h30 gCompartirProxies, Share proxies
    Gui, Add, Button, x+6 yp w177 h30 gDejarProxies, Stop sharing proxies
    Gui, Add, Button, xm y+6 w360 h30 gCompartirCuentas, Share accounts for reroll (96+ packs)
    Gui, Add, Button, xm y+6 w360 h30 gElegirAmigos, Friends who can use my accounts in Discord
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
        . (ProxyFile != "" ? "`nProxies shared: " . (ProxiesEnviadas != "" ? ProxiesEnviadas : "sending...") : "")
        . (CuentasReroll.Count() ? "`nAccounts shared for reroll: " . CuentasReroll.Count() . (UltimoReroll != "" ? " - last opened " . UltimoReroll : "") : "")
        . (CompGP != "" ? "`nGP farm accounts: " . CompGP . "  -  96P pack farm accounts: " . Comp96 : "")
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
    SubirProxies(true)
return

; ---------------------------------------------------------------- Share proxies (hosts' reroll)
; Your own proxy list goes ONLY to the community hosts (stored on their PC, never posted in Discord).
; One per line: user:pass@host:port or host:port:user:pass. Edit the .txt and it is re-sent by itself.
CompartirProxies:
    FileSelectFile, elegido, 3, %ProxyFile%, Pick your proxies .txt (one proxy per line), Text files (*.txt)
    if (ErrorLevel || elegido = "")
        return
    FileRead, t, %elegido%
    n := ContarProxies(t)
    if (!n) {
        MsgBox, 48, Monitor Link, No proxies found in that file.`n`nOne per line, like:`nuser:pass@host:port`nor`nhost:port:user:pass
        return
    }
    MsgBox, 36, Monitor Link, % "Share " . n . " prox" . (n = 1 ? "y" : "ies") . " with the Zenith Rise hosts for the reroll?`n`nThey are stored only on the hosts' PCs and never posted in Discord. You can stop sharing anytime."
    IfMsgBox, No
        return
    ProxyFile := elegido, ProxyHuella := ""
    GuardarConfig()
    SubirProxies(true)
return

DejarProxies:
    if (ProxyFile = "") {
        MsgBox, 64, Monitor Link, You are not sharing proxies.
        return
    }
    MsgBox, 36, Monitor Link, Stop sharing your proxies? The hosts delete them.
    IfMsgBox, No
        return
    ok := EnviarProxies("")
    ProxyFile := "", ProxyHuella := "", ProxiesEnviadas := ""
    GuardarConfig()
    PintarEstado()
    if (ok)
        MsgBox, 64, Monitor Link, Done - your proxies were removed from the hosts.
    else
        MsgBox, 48, Monitor Link, Could not reach the bot. Try again when it shows Connected.
return

ContarProxies(t) {
    n := 0
    Loop, Parse, t, `n, `r
        if RegExMatch(Trim(A_LoopField), "^((https?|socks5h?)://)?([^:@\s]+:[^@\s]+@[A-Za-z0-9.-]+:\d{2,5}|[A-Za-z0-9.-]+:\d{2,5}:[^:@\s]+:[^@\s]+)$")
            n++
    return n
}

; Only when the file changed (or forced); also to the other hosts, so each one has the full list.
SubirProxies(forzar) {
    if (Token = "" || ProxyFile = "")
        return
    if !FileExist(ProxyFile) {
        ProxiesEnviadas := "file not found (" . ProxyFile . ")"
        PintarEstado()
        return
    }
    FileGetTime, tm, %ProxyFile%
    FileGetSize, tam, %ProxyFile%
    huella := ProxyFile . "|" . tm . "|" . tam
    if (!forzar && huella = ProxyHuella)
        return
    FileRead, t, %ProxyFile%
    if EnviarProxies(t) {
        ProxyHuella := huella
        FormatTime, hora,, HH:mm
        ProxiesEnviadas := ContarProxies(t) . " (sent at " . hora . ")"
    }
    PintarEstado()
}

EnviarProxies(texto) {
    try {
        r := Http("POST", ServerUrl . "/link/proxies", texto, "text/plain; charset=utf-8", Token, 60)
    } catch e {
        return false
    }
    if (r.status = 401) {
        NoVinculado()
        return false
    }
    if (r.status != 200)
        return false
    for _, espejo in Espejos
        try Http("POST", espejo . "/link/proxies", texto, "text/plain; charset=utf-8", Token, 60)
    return true
}

; ---------------------------------------------------------------- Share accounts for reroll
; A God Pack only shows to friends from an account with 96+ packs opened, so the hosts' reroll needs
; accounts like yours. You pick which ones; only their names go to the hosts. When a host is about to
; open one, it asks this program for that .xml (same as Fast Share), uses it and deletes it.
CompartirCuentas:
    if (CarpetaJson = "") {
        MsgBox, 48, Monitor Link, Pick your folder first (Change folder).
        return
    }
    Gui, 2:Destroy
    Gui, 2:+Owner1 +ToolWindow
    Gui, 2:Margin, 14, 12
    Gui, 2:Font, s9, Segoe UI
    Gui, 2:Add, Text, w440, Tick the accounts the hosts can use for the God Pack reroll (only accounts with 96+ packs opened are listed).
    Gui, 2:Font, s9 Bold cC62828, Segoe UI
    Gui, 2:Add, Text, w440 y+6, While an account is shared, do NOT open it on your own instances: the same account in two places at once gets errors.
    Gui, 2:Font, s9 Norm cBlack, Segoe UI
    Gui, 2:Add, Text, w440 y+6, Locked = not God Pack eligible (a 30+ day pause: it needs 96 packs again; GP column = packs still missing). Locked accounts can be shared too: hosts only open them in their pack farm (Open Packs Only) until they are eligible, never in the God Pack farm.
    Gui, 2:Add, ListView, w520 r16 y+8 Checked Grid -Multi vLVCuentas, Account|Packs|GP|Since pause
    Gui, 2:Default
    total := 0, noElegibles := 0, compartidas := 0
    Loop, Files, %CarpetaJson%\*.json
    {
        if (Mod(A_Index, 20) = 0)
            Sleep, -1
        FileRead, t, %A_LoopFileFullPath%
        if !RegExMatch(t, """packCount""\s*:\s*(\d+)", mp)
            continue
        if (mp1 < 96)
            continue
        f := RegExMatch(t, """fileName""\s*:\s*""((?:[^""\\]|\\.)*)""", mf) ? JsonUnesc(mf1) : A_LoopFileName
        ; GP column: OK = God Pack eligible; "Locked N" = still needs N packs after its last 30-day pause.
        faltan := SobresFaltanGP(t, sobres)
        ; Since pause: packs opened after the last 30-day pause out of 96, and how many are missing to reach 96 again.
        desdePausa := sobres >= 96 ? sobres . "/96 OK" : sobres . "/96 (-" . (96 - sobres) . ")"
        if (faltan)
            noElegibles++
        if (CuentasReroll.HasKey(f))
            compartidas++
        LV_Add(CuentasReroll.HasKey(f) ? "Check" : "", f, mp1 + 0, faltan ? "Locked " . faltan . "p" : "OK", desdePausa)
        total++
    }
    LV_ModifyCol(1, 250), LV_ModifyCol(2, "60 Integer SortDesc"), LV_ModifyCol(3, 80), LV_ModifyCol(4, 105)
    Gui, 2:Add, Text, w440 y+6, % total . " accounts with 96+ packs - " . compartidas . " shared now."
    Gui, 2:Add, Text, w440 y+2, % "God Pack eligible: " . (total - noElegibles) . " - locked (not eligible yet): " . noElegibles . "."
    Gui, 2:Add, Button, xm y+8 w100 h28 gMarcarTodas, Tick all
    Gui, 2:Add, Button, x+6 yp w100 h28 gDesmarcarTodas, Untick all
    Gui, 2:Add, Button, x+40 yp w188 h28 Default gGuardarCompartidas, Save and share
    Gui, 1:Default
    Gui, 2:Show, AutoSize, Share accounts for reroll
return

MarcarTodas:
DesmarcarTodas:
    Gui, 2:Default
    LV_Modify(0, A_ThisLabel = "MarcarTodas" ? "Check" : "-Check")
    Gui, 1:Default
return

2GuiClose:
2GuiEscape:
    Gui, 2:Destroy
return

GuardarCompartidas:
    Gui, 2:Default
    nuevas := {}, fila := 0
    while (fila := LV_GetNext(fila, "Checked")) {
        LV_GetText(f, fila, 1)
        nuevas[f] := true
    }
    Gui, 1:Default
    if (nuevas.Count()) {
        MsgBox, 36, Monitor Link, % "Share " . nuevas.Count() . " account(s) with the Zenith Rise hosts for the God Pack reroll?`n`n- Only the names are sent now. Each .xml goes to a host only when it opens that account, and the host deletes it after.`n- Every time a host opens one, it is written in reroll_log.txt (in " . CFG_DIR . ").`n- Don't open these accounts on your own instances while shared.`n- You can untick them anytime."
        IfMsgBox, No
            return
    }
    CuentasReroll := nuevas
    lista := ""
    for f in CuentasReroll
        lista .= f . "`n"
    FileDelete, %CFG_REROLL%
    if (lista != "")
        FileAppend, %lista%, %CFG_REROLL%, UTF-8-RAW
    Gui, 2:Destroy
    ok := EnviarCuentasReroll()
    PintarEstado()
    if (!ok)
        MsgBox, 48, Monitor Link, Saved, but could not reach the bot. It will be sent when it shows Connected.
return

; Friends (2026-11-06, Ale): Discord IDs of people who can use the bot with THIS member's accounts,
; without installing Monitor Link. The .xml files still only leave this PC when the bot asks for one.
; Window with two boxes (Ale): Discord ID on top, Pokemon game friend ID below, and the list of friends.
ElegirAmigos:
    Gui, 3:Destroy
    Gui, 3:+Owner1 +ToolWindow
    Gui, 3:Margin, 14, 12
    Gui, 3:Font, s9, Segoe UI
    Gui, 3:Add, Text, w400, Friends who can use the bot in Zenith Rise with YOUR accounts (cards, Fast Share/Trade, Extract XML). Only add people you trust.
    Gui, 3:Font, s9 Bold, Segoe UI
    Gui, 3:Add, Text, w400 y+10, Discord user ID
    Gui, 3:Font, s9 Norm, Segoe UI
    Gui, 3:Add, Edit, w400 y+3 Number vAmigoDiscord
    Gui, 3:Add, Text, w400 y+2 cGray, Discord: Settings > Advanced > Developer Mode, then right-click the user > Copy User ID
    Gui, 3:Font, s9 Bold, Segoe UI
    Gui, 3:Add, Text, w400 y+10, Pokemon TCG Pocket friend ID (optional)
    Gui, 3:Font, s9 Norm, Segoe UI
    Gui, 3:Add, Edit, w400 y+3 vAmigoJuego
    Gui, 3:Add, Text, w400 y+2 cGray, 16 digits, e.g. 1234-5678-9012-3456. It shows up next to yours when they pick where to send cards.
    Gui, 3:Add, Button, w400 h28 y+8 gAgregarAmigo, Add friend
    Gui, 3:Add, ListView, w400 r6 y+10 Grid -Multi vLVAmigos, Discord ID|Pokemon ID
    Gui, 3:Default
    Loop, Parse, Amigos, `,
    {
        if (A_LoopField = "")
            continue
        partes := StrSplit(A_LoopField, ":")
        LV_Add("", partes[1], partes.Length() > 1 ? partes[2] : "")
    }
    LV_ModifyCol(1, 190), LV_ModifyCol(2, 190)
    Gui, 3:Add, Button, xm y+8 w140 h28 gQuitarAmigo, Remove selected
    Gui, 3:Add, Button, x+120 yp w140 h28 Default gGuardarAmigos, Save
    Gui, 1:Default
    Gui, 3:Show, AutoSize, Friends who can use my accounts
return

3GuiClose:
3GuiEscape:
    Gui, 3:Destroy
return

AgregarAmigo:
    Gui, 3:Submit, NoHide
    Gui, 3:Default
    id := Trim(AmigoDiscord), juego := RegExReplace(AmigoJuego, "\D")
    if !RegExMatch(id, "^\d{17,20}$") {
        Gui, 1:Default
        MsgBox, 48, Monitor Link, The Discord user ID is a long number (17-20 digits).
        return
    }
    if (juego != "" && StrLen(juego) != 16) {
        Gui, 1:Default
        MsgBox, 48, Monitor Link, The Pokemon friend ID has 16 digits (e.g. 1234-5678-9012-3456).
        return
    }
    Loop % LV_GetCount()
    {
        LV_GetText(ya, A_Index, 1)
        if (ya = id) {
            LV_Delete(A_Index)
            break
        }
    }
    if (LV_GetCount() >= 10) {
        Gui, 1:Default
        MsgBox, 48, Monitor Link, You can add up to 10 friends.
        return
    }
    LV_Add("", id, juego)
    GuiControl, 3:, AmigoDiscord
    GuiControl, 3:, AmigoJuego
    Gui, 1:Default
return

QuitarAmigo:
    Gui, 3:Default
    if (fila := LV_GetNext(0))
        LV_Delete(fila)
    Gui, 1:Default
return

GuardarAmigos:
    Gui, 3:Default
    lista := ""
    Loop % LV_GetCount()
    {
        LV_GetText(id, A_Index, 1)
        LV_GetText(juego, A_Index, 2)
        lista .= (lista = "" ? "" : ",") . id . (juego != "" ? ":" . juego : "")
    }
    Gui, 1:Default
    if (lista != "") {
        MsgBox, 36, Monitor Link, % "Let these Discord users use the bot with your accounts?`n`n" . StrReplace(lista, ",", "`n") . "`n`nThey can see your cards, do Fast Share/Trade and Extract XML with your accounts. Only add people you trust."
        IfMsgBox, No
            return
    }
    Gui, 3:Destroy
    Amigos := lista
    IniWrite, %Amigos%, %CFG%, friends, ids
    if !EnviarAmigos()
        MsgBox, 48, Monitor Link, Saved, but could not reach the bot. It will be sent when it shows Connected.
    else
        MsgBox, 64, Monitor Link, % lista = "" ? "Done: no friends can use your accounts now." : "Done: your friends can use the bot with your accounts now."
return

EnviarAmigos() {
    if (Token = "")
        return false
    items := ""
    Loop, Parse, Amigos, `,
        if (A_LoopField != "")
            items .= (items = "" ? "" : ",") . """" . A_LoopField . """"
    body := "{""ids"":[" . items . "]}"
    try {
        r := Http("POST", ServerUrl . "/link/friends", body, "text/plain; charset=utf-8", Token, 30)
    } catch e {
        return false
    }
    if (r.status = 401) {
        NoVinculado()
        return false
    }
    for _, espejo in Espejos
        try Http("POST", espejo . "/link/friends", body, "text/plain; charset=utf-8", Token, 30)
    return r.status = 200
}

; Name, packCount and lastPackPulled of each shared account to every host (the active one and the
; others): with the last pack time the host never opens an account that already opened recently.
EnviarCuentasReroll() {
    if (Token = "")
        return false
    datos := {}, bloqueadas := {}, nGP := 0, n96p := 0
    ; Totals for the hosts panel (Ale 2026-11-06): accounts with 96+ packs, how many are God Pack
    ; eligible and how many locked. Only these 3 numbers leave the PC, never the accounts.
    n96 := 0, nOk := 0, nBloq := 0
    if (CarpetaJson != "")
        Loop, Files, %CarpetaJson%\*.json
        {
            if (Mod(A_Index, 20) = 0)
                Sleep, -1
            FileRead, t, %A_LoopFileFullPath%
            if !RegExMatch(t, """fileName""\s*:\s*""((?:[^""\\]|\\.)*)""", mf)
                continue
            f := JsonUnesc(mf1)
            p := RegExMatch(t, """packCount""\s*:\s*(\d+)", mp) ? mp1 : 0
            if (p < 96 && !CuentasReroll.HasKey(f))
                continue
            ; e = packs still missing to be God Pack eligible (0 = eligible); locked accounts are not shared.
            e := SobresFaltanGP(t)
            if (p >= 96) {
                n96++
                if (e)
                    nBloq++
                else
                    nOk++
            }
            if !CuentasReroll.HasKey(f)
                continue
            l := RegExMatch(t, """lastPackPulled""\s*:\s*""(\d+)""", ml) ? ml1 : ""
            ; e > 0 = locked: hosts open it only in their pack farm (Open Packs Only) until it is eligible.
            datos[f] := "{""f"":""" . JsonEsc(f) . """,""p"":" . p . ",""l"":""" . l . """,""e"":" . e . "}"
            if (e)
                n96p++
            else
                nGP++
        }
    items := ""
    for f in CuentasReroll
        items .=(items = "" ? "" : ",") . (datos.HasKey(f) ? datos[f] : """" . JsonEsc(f) . """")
    if (CarpetaJson != "") {
        CompGP := nGP, Comp96 := n96p   ; shown in the main window (Ale 2026-11-06)
        PintarEstado()
    }
    body := "{""accounts"":[" . items . "]"
        . (CarpetaJson != "" ? ",""stats"":{""n96"":" . n96 . ",""ok"":" . nOk . ",""lock"":" . nBloq . "}" : "") . "}"
    try {
        r := Http("POST", ServerUrl . "/link/reroll-accounts", body, "text/plain; charset=utf-8", Token, 60)
    } catch e {
        return false
    }
    if (r.status = 401) {
        NoVinculado()
        return false
    }
    for _, espejo in Espejos
        try Http("POST", espejo . "/link/reroll-accounts", body, "text/plain; charset=utf-8", Token, 60)
    return r.status = 200
}

; A host is about to open some of your shared accounts: send ONLY the ones you shared (anything else
; asked is refused here, on your PC), and write it down in reroll_log.txt.
AtenderReroll(id, lista) {
    archivos := "", faltan := "", enviados := 0, rechazados := 0, nombres := "", p := 1
    while (p := RegExMatch(lista, """((?:[^""\\]|\\.)*)""", mn, p)) {
        p += StrLen(mn)
        nombre := JsonUnesc(mn1)
        if !CuentasReroll.HasKey(nombre) {
            rechazados++
            faltan .= (faltan = "" ? "" : ",") . """" . JsonEsc(nombre) . """"
            continue
        }
        xml := RutaDeXml(nombre)
        contenido := ""
        if (xml != "")
            FileRead, contenido, %xml%
        if (contenido != "") {
            archivos .= (archivos = "" ? "" : ",") . """" . JsonEsc(nombre) . """:""" . JsonEsc(contenido) . """"
            enviados++, nombres .= " " . nombre
        } else {
            faltan .= (faltan = "" ? "" : ",") . """" . JsonEsc(nombre) . """"
        }
    }
    try Http("POST", (JobServer != "" ? JobServer : ServerUrl) . "/link/xml", "{""id"":""" . id . """,""files"":{" . archivos . "},""missing"":[" . faltan . "]}", "text/plain; charset=utf-8", Token, 60)
    FormatTime, ahora,, yyyy-MM-dd HH:mm
    FileAppend, % ahora . "  host opened " . enviados . " account(s) for reroll:" . nombres . (rechazados ? "  (refused " . rechazados . " not shared)" : "") . "`n", %CFG_REROLL_LOG%, UTF-8
    FormatTime, UltimoReroll,, HH:mm
    UltimoReroll .= " (" . enviados . ")"
    PintarEstado()
}

; The host opened packs on one of your shared accounts: it sends back ONLY the cards that came out,
; and they are written here into YOUR card file, the way Kevin/Leanny's bot does it (pulls[],
; packCount, lastPackPulled). Your .json never leaves this PC. A backup <file>.json.bak is kept.
AgregarSobres(id, archivo, base64) {
    contenido := Base64UrlDecode(base64)
    if !RegExMatch(contenido, """key""\s*:\s*""([0-9a-f]+)""", mk)
        return ResponderAccion("{""id"":""" . id . """,""ok"":false,""error"":""bad content""}")
    aplicados := CFG_DIR . "\reroll_applied.txt"
    FileRead, ya, %aplicados%
    if InStr(ya, mk1)
        return ResponderAccion("{""id"":""" . id . """,""ok"":true,""already"":true}")
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
    ; One pulls[] entry per pack, in the same layout as the rest of the file.
    nuevos := "", n := 0, p := 1
    while (p := RegExMatch(contenido, "\{""timestamp"":""([^""]*)"",""pack"":""([^""]*)"",""cards"":\[([^\]]*)\]\}", mpk, p)) {
        p += StrLen(mpk)
        cartas := "", pc := 1
        while (pc := RegExMatch(mpk3, """([A-Za-z0-9_]+)""", mc, pc)) {
            pc += StrLen(mc)
            cartas .= (cartas = "" ? "" : ",`n") . "        """ . mc1 . """"
        }
        nuevos .= (nuevos = "" ? "" : ",`n") . "    {`n      ""timestamp"": """ . mpk1 . """,`n      ""pack"": """ . mpk2 . """,`n      ""cards"": [`n" . cartas . "`n      ]`n    }"
        n++
    }
    ultimo := RegExMatch(contenido, """last""\s*:\s*""(\d{14})""", ml) ? ml1 : ""
    abre := RegExMatch(t, """pulls""\s*:\s*\[", mpa)
    if (!n || !abre)
        return ResponderAccion("{""id"":""" . id . """,""ok"":false,""error"":""bad content""}")
    abre += StrLen(mpa) - 1
    cierra := FinDeArreglo(t, abre)
    if (!cierra)
        return ResponderAccion("{""id"":""" . id . """,""ok"":false,""error"":""card file has an unexpected format""}")
    vacio := Trim(SubStr(t, abre + 1, cierra - abre - 1), " `t`r`n") = ""
    t := RTrim(SubStr(t, 1, cierra - 1), " `t`r`n") . (vacio ? "`n" : ",`n") . nuevos . "`n  " . SubStr(t, cierra)
    if RegExMatch(t, """packCount""\s*:\s*(\d+)", mpc)
        t := RegExReplace(t, """packCount""\s*:\s*\d+", """packCount"": " . (mpc1 + n), , 1)
    if (ultimo != "") {
        t := RegExReplace(t, """lastPackPulled""\s*:\s*""\d*""", """lastPackPulled"": """ . ultimo . """", , 1)
        t := RegExReplace(t, """lastLoggedIn""\s*:\s*""\d*""", """lastLoggedIn"": """ . ultimo . """", , 1)
    }
    FileCopy, %destino%, %destino%.bak, 1
    f := FileOpen(destino, "w", "UTF-8-RAW")
    if (!IsObject(f))
        return ResponderAccion("{""id"":""" . id . """,""ok"":false,""error"":""could not write the file""}")
    f.Write(t)
    f.Close()
    FileAppend, % mk1 . "`n", %aplicados%
    FormatTime, ahora,, yyyy-MM-dd HH:mm
    FileAppend, % ahora . "  " . n . " pack(s) opened by the host added to " . archivo . "`n", %CFG_REROLL_LOG%, UTF-8
    ResponderAccion("{""id"":""" . id . """,""ok"":true}")
    AvisarS4T(archivo, contenido, mpc1 + n)
    SubirResumen(false)
}

; The same notice your PTCGPB sends to its S4T for every pack with valuable cards (your personal
; server: channels by rarity, wishlist, God Pack alive/dead), with YOUR S4T settings from your
; Settings.ini. Sent from this PC to your own S4T only; nothing goes to the host's server.
AvisarS4T(archivo, contenido, packs) {
    ini := Ruta . "\Settings.ini"
    IniRead, activo, %ini%, SaveForTrade, s4tEnabled, 0
    IniRead, url, %ini%, SaveForTrade, s4tDiscordWebhookURL, %A_Space%
    if (activo != 1 || url = "" || !RegExMatch(contenido, """avisos""\s*:\s*\[(.*?)\]", ma))
        return
    sobre := RegExMatch(contenido, """sobre""\s*:\s*""([^""]*)""", ms) ? ms1 : ""
    llaves := {"1Star": "s4t1Star", "Trainer": "s4tTrainer", "FullArt": "s4tFullArt", "Rainbow": "s4tRainbow"
        , "Immersive": "s4tImmersive", "Crown": "s4tCrown", "Shiny1Star": "s4tShiny1Star", "Shiny2Star": "s4tShiny2Star"
        , "3Diamond": "s4t3Dmnd", "4Diamond": "s4t4Dmnd"}
    etiquetas := {"1Star": "1 Star", "Trainer": "Trainer", "FullArt": "Full Art", "Rainbow": "Rainbow", "Immersive": "Immersive"
        , "Crown": "Crown", "Shiny1Star": "Shiny 1-Star", "Shiny2Star": "Shiny 2-Star", "3Diamond": "3 Diamond", "4Diamond": "4 Diamond EX"}
    d := Chr(0x1F539)
    emojis := {"1Star": Chr(0x2B50), "Trainer": Chr(0x1F393), "FullArt": Chr(0x1F3A8), "Rainbow": Chr(0x1F308)
        , "Immersive": Chr(0x1F3AC), "Crown": Chr(0x1F451), "Shiny1Star": Chr(0x2728), "Shiny2Star": Chr(0x2728) . Chr(0x2728)
        , "3Diamond": d . d . d, "4Diamond": d . d . d . d}
    p := 1
    while (p := RegExMatch(ma1, """([^""]*)""", mav, p)) {
        p += StrLen(mav)
        bloques := ""
        Loop, Parse, mav1, `;
        {
            partes := StrSplit(A_LoopField, ":", , 3)
            if (partes.Length() < 3 || !llaves.HasKey(partes[1]))
                continue
            IniRead, si, %ini%, SaveForTrade, % llaves[partes[1]], 0
            if (si != 1)
                continue
            bloques .= (bloques = "" ? "" : "`n`n") . emojis[partes[1]] . " " . Chr(0x203A) . "  **" . etiquetas[partes[1]] . " (x" . partes[2] . ")**`n" . partes[3]
        }
        if (bloques = "")
            continue
        texto := Chr(0x1F4E6) . " Pack Opening results " . Chr(0x00B7) . " Instance: 0 (" . packs . " packs " . Chr(0x00B7) . " " . sobre . ")`n`n" . bloques . "`n`nFile name: " . archivo
        ; Multipart like a Discord webhook (the S4T reads payload_json from a form).
        borde := "----MonitorLink" . A_TickCount
        cuerpo := "--" . borde . "`r`nContent-Disposition: form-data; name=""payload_json""`r`n`r`n{""content"":""" . JsonEsc(texto) . """}`r`n--" . borde . "--`r`n"
        try Http("POST", url, cuerpo, "multipart/form-data; boundary=" . borde . "; charset=utf-8", "", 20)
    }
}

; Position of the "]" that closes the array opening at position abre (skips strings), or 0.
FinDeArreglo(t, abre) {
    nivel := 0, enTexto := false, escape := false
    Loop, % StrLen(t) - abre + 1
    {
        i := abre + A_Index - 1
        c := SubStr(t, i, 1)
        if (enTexto) {
            if (escape)
                escape := false
            else if (c = "\")
                escape := true
            else if (c = """")
                enTexto := false
            continue
        }
        if (c = """")
            enTexto := true
        else if (c = "[" || c = "{")
            nivel++
        else if (c = "]" || c = "}") {
            nivel--
            if (nivel = 0)
                return i
        }
    }
    return 0
}

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
    SubirProxies(true)
    EnviarCuentasReroll()   ; always: it also sends the eligibility totals
    if (Amigos != "")
        EnviarAmigos()
    SetTimer, Ping, 60000
    SetTimer, ResumenPeriodico, 600000
    SetTimer, RevisarTrabajos, 300
    SetTimer, RevisarTrabajosEspejos, 500
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
    SubirProxies(false)
    EnviarCuentasReroll()   ; always: it also sends the eligibility totals
    if (Amigos != "")
        EnviarAmigos()
return

SubirResumen(forzar, folderError := "") {
    static Subiendo := false
    ; While uploading the window keeps running timers: never start a second upload on top.
    if (Token = "" || CarpetaJson = "" || Subiendo)
        return
    Subiendo := true
    SubirResumenAhora(forzar, folderError)
    Subiendo := false
}

SubirResumenAhora(forzar, folderError) {
    huella := Huella()
    if (!forzar && folderError = "" && huella = UltimaHuella)
        return
    total := 0
    Loop, Files, %CarpetaJson%\*.json
        total++
    GuiControl,, Status, Reading your accounts... 0`%
    GuiControl,, Barra, 0
    GuiControl, Show, Barra
    cuentas := 0
    body := "{""version"":""" . VERSION . """,""folder"":""" . JsonEsc(Ruta) . """,""accounts"":["
    Loop, Files, %CarpetaJson%\*.json
    {
        ; Every few files: move the bar and let the window repaint and answer clicks.
        if (Mod(A_Index, 5) = 0 && total) {
            pct := Floor(A_Index * 100 / total)
            GuiControl,, Barra, %pct%
            GuiControl,, Status, % "Reading your accounts... " . pct . "% (" . A_Index . "/" . total . ")"
            Sleep, -1
        }
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
    GuiControl,, Barra, 100
    GuiControl,, Status, % "Sending your cards summary (" . cuentas . " accounts)..."
    try {
        r := HttpSinTrabar("POST", ServerUrl . "/link/summary", body, "text/plain; charset=utf-8", Token, 120)
    } catch e {
        GuiControl, Hide, Barra
        SinConexion()
        return
    }
    if (r.status = 401) {
        GuiControl, Hide, Barra
        return NoVinculado()
    }
    if (r.status != 200) {
        GuiControl, Hide, Barra
        UltimoError := "Summary not accepted (" . r.status . ")"
        PintarEstado()
        return
    }
    ; The other hosts at most every 30 min (or right away when a host appears).
    if (Espejos.Length() && (forzar || A_TickCount - UltimoEspejo > 1800000 || !UltimoEspejo)) {
        GuiControl,, Status, Sending to the other hosts...
        for _, espejo in Espejos
            try HttpSinTrabar("POST", espejo . "/link/summary", body, "text/plain; charset=utf-8", Token, 120)
        UltimoEspejo := A_TickCount
    }
    GuiControl, Hide, Barra
    UltimaHuella := huella, CuentasEnviadas := cuentas, EnLinea := true, UltimoError := ""
    FormatTime, UltimoEnvio,, HH:mm
    PintarEstado()
}

; Like Http() but the window keeps answering while it uploads (big summaries take a while), and Discord
; requests keep being served meanwhile.
HttpSinTrabar(metodo, url, body := "", tipo := "", bearer := "", segundos := 30) {
    req := ComObjCreate("WinHttp.WinHttpRequest.5.1")
    req.SetTimeouts(5000, 10000, 30000, segundos * 1000)
    req.Open(metodo, url, true)
    if (tipo != "")
        req.SetRequestHeader("Content-Type", tipo)
    if (bearer != "")
        req.SetRequestHeader("Authorization", "Bearer " . bearer)
    req.Send(body)
    limite := A_TickCount + segundos * 1000
    while !req.WaitForResponse(0) {
        if (A_TickCount > limite)
            throw Exception("timeout")
        Sleep, 50
    }
    return {status: req.Status, text: req.ResponseText}
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
        SubirProxies(true)
        EnviarCuentasReroll()   ; always: it also sends the eligibility totals
        if (Amigos != "")
            EnviarAmigos()
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
                SubirProxies(true)
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
    JobServer := ServerUrl   ; the answers go back to the host that asked
    ProcesarTrabajos(texto)
return

; Jobs from the OTHER hosts (Ale 2026-11-06: every host can ask for lent accounts directly, not only the
; one with the turn). One open request per host; each answer goes back to the host that sent the job.
RevisarTrabajosEspejos:
    if (Token = "")
        return
    for _, espejo in Espejos
        if (espejo != ServerUrl)
            RevisarTrabajosDe(espejo)
return

RevisarTrabajosDe(srv) {
    global
    local req, listo, estado, texto
    if (JobsEspRetry.HasKey(srv) && A_TickCount < JobsEspRetry[srv])
        return
    if (!JobsEsp.HasKey(srv)) {
        try {
            req := ComObjCreate("WinHttp.WinHttpRequest.5.1")
            req.SetTimeouts(5000, 10000, 30000, 40000)
            req.Open("GET", srv . "/link/jobs", true)
            req.SetRequestHeader("Authorization", "Bearer " . Token)
            req.Send()
            JobsEsp[srv] := req
        } catch e {
            JobsEspRetry[srv] := A_TickCount + 15000
        }
        return
    }
    req := JobsEsp[srv]
    try {
        listo := req.WaitForResponse(0)
    } catch e {
        JobsEsp.Delete(srv), JobsEspRetry[srv] := A_TickCount + 15000
        return
    }
    if (!listo)
        return
    estado := req.Status, texto := req.ResponseText
    JobsEsp.Delete(srv)
    if (estado != 200) {   ; an older host in standby answers 503: try again later
        JobsEspRetry[srv] := A_TickCount + 30000
        return
    }
    JobServer := srv
    ProcesarTrabajos(texto)
    JobServer := ServerUrl
}

ProcesarTrabajos(texto) {
    global
    local pos, mj, mj1, mj2, mpl, mpl1, mpl2, mpl3, mr, mr1, mr2, mw, mw1, mw2, mw3, mm, mm1, mi, mi1, mi2, mi3, mi4, mjs, mjs1, mjs2, mwj, mwj1, mwj2, mwj3, mfw, mfw1, mfw2
    pos := 1
    while (pos := RegExMatch(texto, """id""\s*:\s*""([0-9a-f]+)""\s*,\s*""files""\s*:\s*\[(.*?)\]", mj, pos)) {
        pos += StrLen(mj)
        AtenderTrabajo(mj1, mj2)
    }
    pos := 1
    while (pos := RegExMatch(texto, """id""\s*:\s*""([0-9a-f]+)""\s*,\s*""action""\s*:\s*""add_pulls""\s*,\s*""file""\s*:\s*""((?:[^""\\]|\\.)*)""\s*,\s*""content""\s*:\s*""([A-Za-z0-9+/=]+)""", mpl, pos)) {
        pos += StrLen(mpl)
        AgregarSobres(mpl1, JsonUnesc(mpl2), mpl3)
    }
    pos := 1
    while (pos := RegExMatch(texto, """id""\s*:\s*""([0-9a-f]+)""\s*,\s*""action""\s*:\s*""reroll_xml""\s*,\s*""files""\s*:\s*\[(.*?)\]", mr, pos)) {
        pos += StrLen(mr)
        AtenderReroll(mr1, mr2)
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
    }}

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
    try Http("POST", (JobServer != "" ? JobServer : ServerUrl) . "/link/xml", body, "text/plain; charset=utf-8", Token, 60)
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
    try Http("POST", (JobServer != "" ? JobServer : ServerUrl) . "/link/xml", body, "text/plain; charset=utf-8", Token, 30)
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
    try Http("POST", (JobServer != "" ? JobServer : ServerUrl) . "/link/xml", cuerpo, "text/plain; charset=utf-8", Token, 30)
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
; The name in the card file can be out of date (real case 2026-10-31: "290P_..." while the bot had
; already renamed it to "292P_...", or an account renamed by hand), so when the exact name is not
; there it is looked up without the "290P_" pack prefix and then by the account itself (deviceAccount).
RutaDeXml(nombre) {
    archivo := RegExMatch(nombre, "i)\.xml$") ? nombre : nombre . ".xml"
    if (!IsObject(IndiceXml) || IndiceDe != CarpetaJson || !IndiceXml.HasKey(archivo))
        ArmarIndiceXml()
    if IndiceXml.HasKey(archivo)
        return IndiceXml[archivo]
    sin := RegExReplace(archivo, "i)^\d+P_", "")
    if IndiceSinPrefijo.HasKey(sin)
        return IndiceSinPrefijo[sin]
    cuenta := CuentaDeArchivo(archivo)
    if (cuenta != "") {
        if !IsObject(IndiceCuentas)
            ArmarIndiceCuentas()
        if IndiceCuentas.HasKey(cuenta)
            return IndiceCuentas[cuenta]
    }
    return ""
}

ArmarIndiceXml() {
    IndiceXml := {}, IndiceSinPrefijo := {}, IndiceCuentas := "", IndiceDe := CarpetaJson
    saved := CarpetaPadre(CarpetaPadre(CarpetaJson)) . "\Saved"
    Loop, Files, %saved%\*.xml, R
    {
        IndiceXml[A_LoopFileName] := A_LoopFileFullPath
        IndiceSinPrefijo[RegExReplace(A_LoopFileName, "i)^\d+P_", "")] := A_LoopFileFullPath
    }
}

; deviceAccount -> .xml (read once, only when a name could not be found).
ArmarIndiceCuentas() {
    IndiceCuentas := {}
    saved := CarpetaPadre(CarpetaPadre(CarpetaJson)) . "\Saved"
    Loop, Files, %saved%\*.xml, R
    {
        if (Mod(A_Index, 20) = 0)
            Sleep, -1
        FileRead, x, %A_LoopFileFullPath%
        if RegExMatch(x, "name=""deviceAccount"">([^<]+)<", mc)
            IndiceCuentas[Trim(mc1)] := A_LoopFileFullPath
    }
}

; deviceAccount of the account whose card file says fileName = archivo ("" if none).
CuentaDeArchivo(archivo) {
    buscado := RegExReplace(archivo, "i)\.xml$", "")
    Loop, Files, %CarpetaJson%\*.json
    {
        FileRead, t, %A_LoopFileFullPath%
        if (RegExMatch(t, """fileName""\s*:\s*""([^""]*)""", mf) && RegExReplace(mf1, "i)\.xml$", "") = buscado)
            return RegExMatch(t, """deviceAccount""\s*:\s*""([^""]+)""", md) ? md1 : ""
    }
    return ""
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

; God Pack eligibility (2026-11-06, Ale's rule): if 30+ days passed between two packs in a row of the
; account (pulls[] of its .json), it stops being eligible; it is eligible again once it opened 96 PACKS
; after the LAST such pause (a new 30-day pause restarts the count from 0). 30+ days since the last pack
; until today also counts as a pause. Returns the packs still missing (0 = eligible).
SobresFaltanGP(t, ByRef sobres := 0) {
    dias := {}, pos := 1, sobres := 0
    while (pos := RegExMatch(t, """timestamp""\s*:\s*""(\d{4})-(\d{2})-(\d{2})[^""]*""\s*,\s*""pack""", m, pos)) {
        k := (m1 . m2 . m3) + 0
        dias[k] := dias.HasKey(k) ? dias[k] + 1 : 1   ; packs opened that day
        pos += StrLen(m)
    }
    if (!dias.Count())
        return 0   ; no pack history: nothing to judge
    hueco := false, desde := 0, anterior := ""
    for d, n in dias {   ; integer keys: AutoHotkey walks them in order
        if (anterior != "") {
            x := d . "", y := anterior . ""
            EnvSub, x, %y%, Days
            if (x >= 30)
                hueco := true, desde := 0, sobres := 0
        }
        desde++, sobres += n   ; sobres = packs since the last 30-day pause
        anterior := d
    }
    hoy := A_YYYY . A_MM . A_DD, y := anterior . ""
    EnvSub, hoy, %y%, Days
    if (hoy >= 30) {
        sobres := 0   ; the pause is now: counting starts again from 0
        return 96
    }
    if (!hueco)
        return 0
    return sobres >= 96 ? 0 : 96 - sobres
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
