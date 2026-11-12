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

global VERSION := "ahk-1.9.34"
global LibUltima := ""   ; last time the bot's address was looked up in the address book (Upstash)
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
global Baneadas := {}   ; lent accounts the GP farm marked as likely banned (from the ping)
global UltimaVersionAhk := ""   ; newest Monitor Link published (from the ping)
global BanLocales := "", BtnBanAbrir, BtnBanBorrar   ; banned accounts still on this PC ("" = count again)
global DragoniteRes := "", EstadoOnline := "", HBtnOnline := 0, BtnOnline := ""
global CompGP := "", Comp96 := ""   ; shared accounts for the GP farm (eligible) / the 96P pack farm (locked)
global Amigos := ""   ; Discord IDs (comma separated) of friends who can use this member's accounts in the bot
global MiMain := ""   ; this member's own Main friend ID (16 digits): Share/Trade destination in the bot
global MainVistoOnline := false, MainAusente := 0, ApagandoGp := false, MainDragonite := ""   ; Offline -> GP test -> close (Ale 2026-11-11)
; (Ale 2026-11-12, Arcade and cy asked) The automatic GP test on Offline is OFF. Only on with gpTest=1 under [offline] in the config.
global GpTestOffline := 0
global Status, Info, Clave, TxtCarpeta, TxtResumen, TxtBan, TxtGP, TxtProx, TxtVer, TxtUser, TxtError, BtnLink, Inicio, LinkBox, LinkTxt, LVCuentas, Barra, BtnMain
global Cambiando := false   ; linked PC: the key box shows ***** until Change is pressed

CargarConfig()
CrearVentana()
PintarOnline("")
SetTimer, ConsultarOnlineAhora, -8000
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
    IniRead, MiMain, %CFG%, main, id, %A_Space%
    IniRead, GpTestOffline, %CFG%, offline, gpTest, 0
    GpTestOffline := (GpTestOffline = "1")
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

    ; (Ale 2026-11-10) Ordered like the PTCGPB window: dark, three columns, one box per topic.
    Gui, Color, 202225, 2B2D31
    Gui, Margin, 12, 10
    ; ---- column 1: link, accounts, banned
    Caja(12, 8, 250, 86, "Link this PC", "7983F5", "LinkBox")
    Gui, Font, s8 Norm cDCDDDE, Segoe UI
    Gui, Add, Text, x24 y28 w226 h28 vLinkTxt, In Discord, type /link in Zenith Rise and paste the key here:
    Gui, Font, s9 Norm cFFFFFF, Segoe UI
    Gui, Add, Edit, x24 y60 w158 h23 vClave
    Gui, Font, s9 Norm cBlack, Segoe UI
    Gui, Add, Button, x188 y59 w62 h25 gVincular vBtnLink, Link
    Caja(12, 102, 250, 124, "Accounts", "3BA55C")
    Gui, Font, s8 Norm cDCDDDE, Segoe UI
    Gui, Add, Text, x24 y122 w226 h30 vTxtCarpeta,
    Gui, Add, Text, x24 y154 w226 h30 vTxtResumen,
    Gui, Font, s9 Norm cBlack, Segoe UI
    Gui, Add, Button, x24 y190 w226 h26 gCambiarCarpeta, Change folder
    Caja(12, 234, 250, 82, "Banned accounts", "ED4245")
    Gui, Font, s8 Norm cDCDDDE, Segoe UI
    Gui, Add, Text, x24 y254 w226 h16 vTxtBan, None on this PC
    Gui, Font, s9 Norm cBlack, Segoe UI
    Gui, Add, Button, x24 y276 w110 h28 gAbrirBaneadas vBtnBanAbrir Disabled, Open folder
    Gui, Add, Button, x140 y276 w110 h28 gBorrarBaneadas vBtnBanBorrar Disabled, Delete XML && JSON
    ; ---- column 2: GP farm, proxies, Discord
    Caja(274, 8, 250, 92, "GP farm (reroll)", "FAA61A")
    Gui, Font, s8 Norm cDCDDDE, Segoe UI
    Gui, Add, Text, x286 y28 w226 h30 vTxtGP,
    Gui, Font, s9 Norm cBlack, Segoe UI
    Gui, Add, Button, x286 y64 w226 h26 gCompartirCuentas, Share accounts for reroll
    Caja(274, 108, 250, 82, "Proxies", "B47CF5")
    Gui, Font, s8 Norm cDCDDDE, Segoe UI
    Gui, Add, Text, x286 y128 w226 h16 vTxtProx, Not sharing proxies
    Gui, Font, s9 Norm cBlack, Segoe UI
    Gui, Add, Button, x286 y150 w110 h28 gCompartirProxies, Share proxies
    Gui, Add, Button, x402 y150 w110 h28 gDejarProxies, Stop sharing
    Caja(274, 198, 250, 118, "Discord", "00B0F4")
    Gui, Font, s9 Norm cBlack, Segoe UI
    Gui, Add, Button, x286 y220 w226 h36 gRegistrarMain vBtnMain, % TextoMain()
    Gui, Add, Button, x286 y264 w226 h36 gElegirAmigos, Friends who can use my accounts
    ; ---- column 3: who, status and the main buttons
    Caja(536, 8, 220, 308, "", "FFFFFF")
    logo := LogoMonitorLink()
    if (logo != "")
        Gui, Add, Picture, x614 y28 w64 h64, %logo%
    Gui, Font, s14 Bold cFFFFFF, Segoe UI
    Gui, Add, Text, x546 y106 w200 Center, MONITOR LINK
    Gui, Font, s8 Norm cB9BBBE, Segoe UI
    Gui, Add, Text, x546 y132 w200 Center vTxtVer,
    Gui, Add, Text, x546 y147 w200 Center vTxtUser,
    Gui, Font, s9 Bold cFFFFFF, Segoe UI
    Gui, Add, Text, x540 y165 w212 h18 Center vStatus, ...
    ; Progress while reading/sending the accounts (600+ accounts take a while; without it the window
    ; looked frozen and Windows said "Not responding").
    Gui, Add, Progress, x556 y186 w180 h5 c3BA55C Background2B2D31 vBarra Hidden, 0
    Gui, Font, s9 Bold cBlack, Segoe UI
    Gui, Add, Button, x556 y198 w180 h32 gSyncRerollZenith, Sync reroll for Zenith Rise
    Gui, Font, s10 Bold cBlack, Segoe UI
    Gui, Add, Button, x556 y235 w88 h28 gSincronizar, Sync now
    Gui, Add, Button, x648 y235 w88 h28 gOcultar, Hide
    ; (Ale 2026-11-10) Dragonite online/offline: a small light in the button (green online, red offline).
    Gui, Add, Button, x556 y266 w180 h28 vBtnOnline hwndHBtnOnline gCambiarOnline, Go online
    Gui, Font, s9 Norm cDCDDDE, Segoe UI
    Gui, Add, Checkbox, x586 y300 w130 -Theme vInicio gCambiarInicio, Start with Windows
    GuiControl,, Inicio, % FileExist(A_Startup . "\Monitor Link.lnk") ? 1 : 0
    ; ---- last error (only shows when there is one)
    Gui, Font, s8 Norm cED4245, Segoe UI
    Gui, Add, Text, x12 y322 w744 h26 vTxtError,
    Gui, Font, s9 Norm cBlack, Segoe UI
    Gui, Show, w768 h350, Monitor Link
}

; (Ale 2026-11-10) Logo of the window (Zekrom), inside this file so it shows with only the .ahk downloaded.
; Written once to %APPDATA%\MonitorLink\logo-v2.png.
LogoMonitorLink() {
    archivoLogo := A_AppData . "\MonitorLink\logo-v2.png"   ; not "ruta": Ruta is a super-global (accounts folder)
    if FileExist(archivoLogo)
        return archivoLogo
    b64 := ""
    b64 .= "iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAMAAAD04JH5AAADAFBMVEUpNVwh+P0sNWMWGCIp/v4j/v4Zgv0YFSApNVknMGQZiv4gN3EiKEsYc/wgK3IbHjkoMFEf/v0XGCcYGzQZFiMpM2ApL1wsNWgWGC0VGj4cID4jLYYmKFBJmfYgOXkTFBsfJkgwNWo1W7wsNV0h"
    b64 .= "KVIeIE0sNW4fJIUtNVY3XsM6Y80aGi5OjPAi8fwNEBsyNW8dJUIpMFgPEiI/acYsOWYvOXMfIEYwOXk/aMAk/PsgSHsiLX8Z/fwrUa8ksfwPFSkjLWwkLngdL2QlLFY5X8keKlkaJ04tPGshhv00WLVCc9Qr+P4cI34gKF8WHEcs4PwVKFY6YdYrTJlNtP0sUbhKk/Uq"
    b64 .= "oPgeNGkcmP1Iiuwaev0sRokwO4EakPsVJEcXmvIWgfM5XM8Yh/g8X7Yt6P09NXUw8f4nTKQ3ZfsgKqgmLUggJncgPIEMCxA5WawRFjIggP08ZN0wNl40ivkgLLQgKZo7ZuQVjO81/v0j6PgcIWggQ6Aoe/YVL180QpYdqvU9aOsWM3AzUaYjNY4fxvpLpfkiQpBs0f1E"
    b64 .= "N35MH0AaHVglPukecfMMHTEgu+49as4QP4k1PYsiN9UwQnUhM6AhKY9VO4odd4UfNsQ3qvotQ4Ap1Pkmu/se2/Q+6/sx5+kvytBDi/kkhvUjW+ogzfA2gPAvyPdDguY3cNQQNkolgJ1aIUFBGzYhauFCmPw5dt0plqZId9xGccorp7UOLDwzvchQl/USQlQot701pekV"
    b64 .= "UpMaZIFuQZcy19tUOHQ+0+MoFykneeMUVmUePrQnj+Y29vQeWb4kQ3QcqeZ0IkATRWQ7VocWW3M9RakQd/FrNnY8XJ0cYaAlg9OKR6c71/c+vvA2udkijJRawPkvndQiW9tdi856Q6QzGTJfJVAeZbTnP0MqZcz7NkchebxvovBhi+U/qcFbqexuuvkvYPNScahw3v5D"
    b64 .= "M2IdbcaKOnwwZocqjrtN1PktP7+iJDv6+0P8/VTMM0Ppgk33tlL011GyYD5rUMhyXOTCkkj95Fbm1zYn/18WAAAACXBIWXMAAA7DAAAOwwHHb6hkAAAgAElEQVR42m2bB0DT59b/QwAhkpJASEhCSgIJGIyEEBkiQsIKIgYCVVBBQEQoS5QhGwoqbSmgKBbZSJEKrYoi"
    b64 .= "ddU966p71Ntar9b2do+733nO8/sF9P3/T9vYy61+P8855znPeUYYXG5407kQr7lzt6Dt2bNn//79Hy5fvmvXrpaW3btbWlpqauCj5PXXl8LfS+Hj9c1vvLG5JCNj3boVGelZVtZWVlZBQUGx8ZfLM5eFhvb21qevzLxcWfHCoLRlMORoDNetx7Yeu903fPny5ftHv322"
    b64 .= "lZhrcpRCLApncLmCgnPn3CmAPTTA0l27d+8qqakpqXnttRqwkn0EAG3zZpAfmjEjM6NlxbqM+mwrYtbW1rE99enpbW09PSOX6+ODBs7m2fIZDIYtMNheAr0njy5fHo6/+9vDo8dQvgDkA3imq/MAgBvu2pTjtWUKYNGBOa9TBOteA1tXUoL6r5v1j+7bnFSekRE60pae"
    b64 .= "saK8JzaWInCwtoqNH/b2ruzpyaqouNApVhIAcEKx0lB7/Nd7PVnZ2fH33vj2Fuo3REkkorSUeQfnMnyBgGtrt3bLHiKPHlgOrt61a1/JCtR/rYXyAOWAzV3l5zd33RtJzyiv7+nvqb+cFRRE+cDKYQFYkFVF/4nJ8fHjGq4tg0EDaH6591s/qN99A4K3ugG8X2uSBKQl"
    b64 .= "r140d95cRl23HzD4ds9F8fXo/zmfAMDSfSUtLa/RVlOz6/XX9+3bVbJvCGI/NFSePnNGRkZGfXxFdiwCkOFbxMZWVAxMPjg7atBoZEqzPkOuHL1/9969e2+g/PKDDQ0FDSaFrNV08+DcefPmzmXMW732ZopdePLaRYv2798A+fcJ0V+6q+W1FZQLXlsHGVmyr6Sm5cz5"
    b64 .= "tpHyGytmzFixYsY6TMI276Ag6yBrB4fs+N8efnt/ovNwmkxii4lH4k8g5Oyz957cpuT3LEox6E0GD5Ho0jzURwAvLy9gSElOOXjgww8/XL6UkgeDGUADtJSUdHUllQydD4XoZrWVo2VmZpaXp7d5O6DnrfofHfz+arRBY/ItLi6WU8KgT0wuHht59PDh5k8+3LNlyzwT"
    b64 .= "28MjTpS8dh5lCACfW+bOW5u4+gDMvuXL58zBz6VL58zZVdNC+b+l5UZ6/N2RkfhYqyBwc/xwfHxWVlZlZaU3Ua+omPzFOUqm0Kdev97OxGnHeAUgbbwfBr9/EdiBqyIPD1FcyrwtqE2MgfNvEaCtjtnz4fIP0VAeAebARMQ6gL/cqI/Pzo6FSMdipCsqIOwk6RysLgw+"
    b64 .= "uJYmVoTVXf/d/fpGTybT2dnZ048oy+XFcqWSmzZ4j6ijJYtFRclrKeebAUAfbMtcr6f7Kf3NmO5TCDW7di1dWtJyA7Ie5jzI45wLciDisSTnNBFhGzt+d69L9YfAMz09/f0D/RlKLlsGlpen4Y2eerSH1j9oKopKPDg9fJyGBOAAIlz8AkvgUvOMJ5mIxQhnZMa6FTfK"
    b64 .= "L9/tR3krHPoCK6uBI51X0tL0Lhs7cjs2+jPlShg8qPsHgkXLOBrKZJprd29TCmA3EzH5zKOfd+CbeQCAsUFLWHJuzxxKn6bYt2/37hIoe5kZmTPAbmSUt1WC81H+wuTYFQOby3cp3VlaFubpzEB1Tx9KPjDQOUKpBPcr5bbKtLG7ZgcsOnhw0dzp4c+be+Dgasa8LZT8"
    b64 .= "gQOL5u5ZTor90ikCuvDD7M/IuFGefmNveR+6vuLExDWT0c3H31lfVpob7OmMgXd2dnPzpAH8Wc6Qg0pb2+JiZcCLeweJ+KKXxj6XzIHVYIzVi8j0IxMAS8Drr9hmnL9vJA2ljwwPZ2XHD1daZPX3Tz44bBC4gbP9PT3DAj093XzcKPMEJxACZz6TDyWYm6fRHDr+3VFK"
    b64 .= "nkz8ea/Kr17LMItTRgEsfWnlAesKDQ3tu1ABa561df9v41cMUW4+0Z5gPmDkgybAn3kiAIuhhFo7euVa5/jkw4fL9+8/CPJz55kBaPm1aIxPlk8BLJ1DrbfwQYFspgBAvx5qnrWFVcWpsUumCDd/Hx9nTzMBpT+NgAAC9ui1BxMnYAHo/+2NNz7cvZsaPQ0wJX/zZuNN"
    b64 .= "BlV7zOMn6/3ml0aP1tvWNpwVG5vdf+LBoVaBH5FGSU+fl0bvRlFgCFJ9FMfvX6jIjh+51wVj2Ly8Zvfcaflp/cbGxpgYAjAVgTlkFSopgd+173yXmeDeSFZsRfbdh78cUqt9o0m2oxR8rgHzIaOfwghMTQ00Hj6V1XMPx/HJJ/BH7a45Q8RBfs/+Pe5U7EF/rdfelhbG"
    b64 .= "lDYFsAt7kIx9EPjzR7to/bvYdcT+9kuh1FJDZTsAgD6ov0MRUPL4fwX6C6L0xs74o6D9ySckikvP1NRQ+Td7/9BQxt6nNELMUyz1DMr9y7+hCXa1wGKXUd5ldj/I92PLEVvxQs3j6XzB+yDjg6Jr3kFLfQddgFxMJrNYoPCI8mzXj/cfpfTRnbt319RsgfHPe3pmaOHM"
    b64 .= "mUNnZhMPeO0lKx1j96su2FWzDtqtZV1dU+4nww+KvXBWKhbxmKjvTIJP9KmPNW4gzpTb5mnijP7tde36I/HoAJAnFaRm3bqnN9eunnsmc+HChTNm1GxBfXei37KX8cXe3VPqy6EQYs+RuXLZSmAAC+2NJ+1OUMW42lKnZbs5o6cRAMMP8u+DnQQAPpRisciYWgfWnjw4"
    b64 .= "shSHPwSDgcYBWqqLKU0hu4ewnM5Yd8YL4v+U6nYA4IMPPti9yzwNIGfe2Jy0MBMYMoEiKdQMYHXikNRGqrP1RADPaQDUf3+NjzOTz7dlRwW2o36d/fGBLvR+BqX39OJP588/+6llHdHPqNmDwzd3WzUI8MUGcxggZx8+TMoklR8ssz50UxaVAZ1qSxspx4+agLQ87QFI"
    b64 .= "AvAK05dJDd9Tf/z+SNI+Wn/Gur1PbreNhCbRf+aKjL1ea933m/VvZBCAL8g6uHzOrl2vf/v220Mw/Ixl0PnOyFgZejebNJ2DrTaWllouTD4fCoAk4DvoAvj08XRzZurJ8MPCj0/G9yYlQSTpUWQMJS2DLprAQC8Hk8BravyvlbcxPvhi75nl34JBSdy998zDH47Cfwv9"
    b64 .= "ZlYPdN0Z0HYHWVsFWXUWWlpaOha7YfZT+u9T9umnkINYjZiBIJ9ae/x+bGUohC7JrD9lGeWZK6DL3Pv06YYW+BUbzhsre70Zu7/97m3KHj58ePToD2+fh99a3x9rYVXZll5ePowLgMPAqNTRScpxoysvrf/pn9DeWUPKIT+1rt1+/pFY7+HLSV2bNvWGlsNwoXlFabDy"
    b64 .= "9PpNvRmvrXitBY1yf3pvT5Y34+1p++GHH97uSsJcDYV2H/pt775hqu09onVydNLm0QAk+T5F+Tt37vzpfaoms9qbjo0PWPVdTkpKqu9t2zQCe7T0etpCezfFQxMZesPseiC5EZoVa2HhzfjuZYCH56lglQ/jfi/IwYH8AhFQOzlZ6pRMst64oQNQ/84dArDGGcqis77u"
    b64 .= "UZ+1d1tbPQAkhXb1jvT0YOuK3au3d2yshTdsmuLrpwhulPcELYCfeTPmPf5uGgDiT7J1ZU+sBegvuHDC28LCIujCWTIH5Ewsw87ggZMnP6ft5Mk1PrA8+AkEx4a9+y63eVduSiIISefbUBrMAs2bsrZyCiGjvhKZ4G9GXeJNM8IPD8vphEnPgh3PggUV462TVkACKeBk"
    b64 .= "I80rxnoHdRgAvvr43Xc/evfjjz/+8rSKo+Fi4zOeBaOv915g0YNRSCrZf3Q4Hjp3CwvrKX0Aiq/PuAHR78kOgh/i34yUxMTEmwcff/vdd9+93UX8D5OwF3fdC6yPtBZ2Qh9iDVXI0saSC/sdPhPC8OPJd4k+2pennZycbFQqVdqpkfOgO2yxwGE4KakLCLpG+ipjY4Om"
    b64 .= "h09Z36b6tqxY2i+QA41rE+vagWL1vHn7a4j+jIz0nkrvbG+HE7D8jg5YB0EZtHGSqsiWQy53W/Mj6sPw8QP1LSE+6kMn2nDgbX0WCyw2JeFO6vxl0kQH/R8Ai1eNsXv/3MQUYtV712Xi+DPTR0Z6IEMh8o5a7RGoAgOjNk42HALAZP7445eU/seof9rR0dES/nFqHdyU"
    b64 .= "DqHP6qt0gCiEdsFy3kMfHryKQA8dcysoCAF2f7i2G/Ub964gGbiwfKQftvIWQZ1aR46KxABQnGx4IM/nO7spv/yS0v+Y1ifmpJtAgPrKBX3eCxZ4j7T1wjJq3rkHWcVmV8b39fVVvuqAIAurEwjg3pSYmHNxbw2pGgvLQ6GVy7awmmx1EvJU6tELVkEDhwFA5csQ8N3W"
    b64 .= "SE4T/S+/RITTp1UqRyH8A1XiwUg6hgAGu2CBhXdfVqyVWd46Nr6trbd3+P+nfwUAdu/eC9ZCla2ZmZf7+8EDFhcOa+EPtrHRDVpVdBZCojlyGT+e/PRzknow9ndhCr77pYoyAJAefoQ5cLSH7BkXOFjTBgQVPW1tI8M92bGx1tavxD9o8LCYAYv1OiyNdNnMLL8LANne"
    b64 .= "sQ+0QtS3UY9XHNHZWDrZ2Cjf//TOz199hPbxl8ACdlIspABgpVCnQOp3dbVVUgBAgPtXh6CK7OG2Hm9rC9haO+BPg6b0rQZHA7gM+gjgxgpquc5swwDEWg+2OvFUjpDhhcdPQRWwdHI6/fmdOz9/9BEQgAd+PPk+ArzvJhMKAdTRUmrJSbsFAKFdbd40Adk/O8RWDsN2"
    b64 .= "xgFIcFWxhvJGEyywPnFYwzUDgAcIQEZ9lje4ygLWfx5HBY63lB46rHWCleDLdz+/8/NnH32FAF+dPPkOqL//fqB/NJejE4IDdGKJpvVWF7iACoIDbdaxfSDvAFUVgxKEaytury2CFlgPXBFzXwbACGSkx2cDgIXDwOEiCccRa4yNlIz/y48++vznP/74DAEg+rAYvPul"
    b64 .= "WMKMjvaT5xXpLIUSiYwtK7rVVQ97CG8qAtYUgoU1+XdEglXlwpHjZzsnBiqsFlzoFOH5GORAy5R+ZnkP6AOA1YSuWSJ0skEA6EQcnU6/+9Vnn/3x9defffXRV59/+vnJ9//j/dM2QmGrxtbPzY8r4iihH2azZaJbR+OhyDlQABQBlYsOmBHWF46cbVVr1brRzsGKSRGb"
    b64 .= "AEDTvG4qBbFGx2Z7W1y4IjLybGizxAB8hPp//vMfH331851PQf8/19johCqhrqg2zM3PD1tyIFBoRL8MTOXglGH2IULF5NlWmFoqoaNO3dp5VsMlACUlNSto/UxYhrNjs7O9rcZ1RrElZj4xp9PggK8++/vXX//575/9/Kc/ff7O9f/8D47aCSuAsClED9sCPt9XIIhQ"
    b64 .= "SAJEY7E0AIqSM1T8gFpUMXitVcvjqSBrhTpHJ7WWYwZoIQ4gBKGQAlADBg6LjEKpzTQAOuDf//rvf37995/v/OnTkwDQXqTWOqrgj2vYe9FVXswXREQUyxUSCTut80QsZiEOeQoAy/mDQ1qdiidEABWmrY2Wl0cAaugqAF1TG7YtWVlWD4pYHKgBTpZm/XdB/7//+te/"
    b64 .= "/fNrADj5Tt3quu7HN/MceQRgRYgrE/Qj5MW+AMAWjXYeuWBN1yIKAHJv4rBOyOOhuIoCgKmrowBKStbBhgWOAkfgIAysP/vEIQ+jEIsA5YDTpz/+6LM//vE3APjbP36+8/ma9uvX424+fx6tFXM4KtPFlpZqhm9EhMK3WB4hkUi4Es6haxMDeHRLH+MGVQwc1+l4gEuZ"
    b64 .= "kFo+tGIqCeEYdB9a1wgcfpx6Md452Klzi+ORMoQMGICP/vj6n3/76//8z7/+fefTNWs8C1an3Xz+WMbTaMQcnunpiosMEAaAYl8kiPBli1vBDQN4nAYM1taDoyT4lLpQaF7A8gjAATyfxG355jfujx1Oi2ve+qJVZOQAL1UGAAAc8Pc/owf+9e/PvvqxWHD18XPDL999"
    b64 .= "XxSQlqZJ8xDlrHuaLEFhuZwAAAsko671MDBUWEMNunBWyysSviyNZqmiAODg6sCBb5bP+eZxoqlIyAlIG/9FLY7jcDg8lZMNDQD6f/76X3/923/9fOdHsVD0/eNva69+t52HADJDgOvFi3agqVBAtxJBXIDJqOHwinijD05UwGI6qisiyY9LBhpFQAPMPXgQAL55fDVO"
    b64 .= "1Gysqqraer9WGyDigG/JWmTj5Hj64z/+DPaPf/7XZ3dOSmzUV7//5aqI8b1Io0lLM5jSZIatF8MliggFeIC4APIRwuArkWnEPN2hzhMVAMAjgzfL079q8vLyuHhQeWDO45sGA8t1Y1luaem5+4e0zXEcEeSXI3GAo9NnXyMA1IA7n8vUhervv/v28c3RNDHopwWXwdF7"
    b64 .= "wUUTeiCCz+fLIxSAIvHF5lHua9BwVLpDD04d1grNqmhStVoK/2i1OkhNBhyUHrgZ0cq/WtdRmtuRCwCj2qpmCAGHmgdOjlIsQV9/DTXoU4m6sLDw6rfLv/teLJbJDGmGst9rFeE5AMBmKwSgKvdVKAIkvqR/hi07IwLSVDfaaoPyUiIu1WqhgKh4aEKdTsvYcnC1c6s4"
    b64 .= "uSksH84cy8pKS48eVlc1i0gIiAdsOD+SJgCWQIm0sFBaaPv8+U2RRsZWAMAOF1NywcUQAwFgsZgwDxRxEjnRL06L8PdhRijYIqGlWgviWi0ULyFPHECZLEDDKVIx5nWLRL7bN24Ms3fJLS3bkVt69GxhVRUBwHYXVmIlbsZ/hM2IxKYQTfb8e5FYplAAgCmsqrYAANiK"
    b64 .= "KQBJhIcEHFDMLC62NcDJKZzoGdlioVaNYxdyxJqAAA8w/AAIHo9hajX4d6fkluXrgwHApaz06HF1MwWASeik1RQzqQMwX57u6tXttq15VyH5FRSAfUNBU9PFagSIYIExAYAtKyb6TDejEc+u/X1YArbYslCq4lDiYM2Q7lVGY3OAmNFqe2n+/JTc3GD9YgAILss9P6aO"
    b64 .= "q4rj0CGQCtGffD6LaUhJUTx/DvMlupXWNxhMwR3V1dUXm9g4+UBfwPdVREg0cpAHAB/PKB9/ypwljlJLFS0f4FG1IxesrGyWXsFgbJ8//1JBR0ewPSQBeCD39phaRAB4kDmwJYbtEBhTkvw8MeLxN88fXxVpDJS8wWTfcQ4AlhRg9YEIwH8XwZZEiGUSdkRxsbO/ZxQl"
    b64 .= "HxjoxoHM49AA7ICqHWWEYIe9BwPGP//SfAogd0dwWelPBIAHAELQ5ygFAgGfUewbdfD51UMAsL1VDPlHeSC8Y+fO6uqckDAEYOkpADZXJilma8AD/npWIA0gUztyxGb/YwjQqqqaPcSM+cQIwI6yYPDCT79qi5oBgAMAlo5cOUMggKs39vfffHO19fHj6CKxhgDA+E0b"
    b64 .= "f992rjqnqYlUYoEnusCXzYbmrFgpIzngD+emcK7nI9BpQT/AwxwDsQgtLi5OJKIAugnArGB7+x2lFx8VaT1EjgRAq8H7P4GgmKPVMK4W677304kRAAlMprDqndsgAg12AgQwekJbwhQAgATUZb7FfvyowNT2diBQ8nQ4+ejRBwTE0fJotAc2drjY2+eHIcC5RyIpuB9X"
    b64 .= "T0uVklzBySVq7lU/2zyeWMiDqxiZjG1QRJkams69BxHYGKUgS5DADRzA5COA2NdZwS5mSgQAUNeeul2j44inACh50Kf+Jw3QVEYAsBice5QmdXQkANo8lLdVcoWFV59/A9NfBwVSowkAfUVUeEH1zvfONTXZwV0lAXDGHOBLAECjCGTBXGQziQcC+UU81A/A/A8IEJnd"
    b64 .= "74FRNNAABS7gfnQBFINHtWpHWLpoALh/U3IKC22/+eb7VmgqYCiaAJkhKsroCg54r6PANVlEATABACasAkNgaG83yPkyP0iB1EB/sY4qfmT8lL44DvLQFBVlBrjUYE8MAXIfzTcD6LgIIOfCCuD4+KBIrVJx0JcymcJUawfjf29bgV1DuEgDhZgt4bthb8yMkLElXEN7"
    b64 .= "nREWRZ9UNDediho/DF9MB98jykgsigZwTdZTALAi5N6+VQgNL6zXQqESAZQaLMBXDaAPcwNyEABqXVH/vY6G5OTwIg1b9hIAwHAV7dcDoyKciQN8AtSWHASg5DH4BpMxPFwfHm4MNwPY6WkPhGEW/gq7cUdct1U4B0gECgvV2NETAE2AIhz0t7333k6X5OTkKABAE7j5"
    b64 .= "yacAUq+3mwz+qZgAGp5W6oguMKe+hykqPLlBDwCAEEUAuu3spwCCS3NvnYIDCUsnSzWnWAAuUKoQQIq7AADQiDUKFtHfdm5jMAAYdGIKwHnKAxG+rOt1+nCQDzSKNNw8LVkGzLlngvGD4yirJQCu+ikAfX5u6Y5H/WfxYBAAfCEHubgISi0pALFYbAh37di5bdvv1U0F"
    b64 .= "OAoZDaDw9Ad9PwECOCvqrrcHpvq78WV5Sltlng7WQQ6HSn8P9L9ZvjYcAbqnAHAmwIqw9dEpiIKlVKwkANAFqCkA1A9gFaD+zuoCV/wDwjVmAJY/HiMK2BI4tzemXk/15EOLplEq8Y/gaS3JzOYAQDiMPhl/q2tKYmMjw5wCYfAXmN5+R+6OWYt/hShYSjlKX6WSgZMA"
    b64 .= "uxlHEgKRAsa/E0pwQQO0hFFG6GRRHspzhDOs/m5QidjG9sCwOk/MX7YMARjFyjyh1pH8AXFRMPLkBtemxLWrV7u7xyDApWT9VAzs9WHBVfkui5/dPa5z5OTBb8dZCPpO+Puhk5LZgf7Oc4kNpuNjY8ft7FgazEEZlucoLPyYBKzr1+39beHqWAlPScCgXYbVAXbxjkVx"
    b64 .= "8GImMbGREg8JCcmhAab0WQoxT2TvMmvxrVMPDkHKc33lssJCGzOAShS+8RwsgSnGK+OPnj57dH8sGdYevKnH0BMAXwnb8/r1QBi60pZrBsDsKNZwZMkpa929vNzd3ZcsWQLyjYlNBMDOjkwDvbHZA+ZMoShsB0Th2KnJwzyoetxoqZQcEiCA0FSAl/VhtWOnboMfHlUO"
    b64 .= "1oK2bAogGgDYCODMg6hw82TUYsJn+vm5RUf7U/IxqI2W07Q10QxgpzcqxDpo3KTaIkGYy45ZsxZvvX/qGk/FOzQ+qtWRnQRkoQe8VagLrrp25O5tLIQX2wbG0gyGaQ/4QwgUCs+6OkMe/CrjcKf0wTxTGlGfjD0EPpu2NuWEMGh9PwXPEeWl0iKjPszFBX2w+Nm9sc7R"
    b64 .= "0clrIpmoCAl0IvuNGzfaXxnrb7sIdQgq0U/DJ+Z7SDAH2WwPRWB7oDMTGhjPukAD3K74yDUEQE70mX7dqB9JvI9/NTUhCAIkJ/v5anD0cCQl1UX46O2DAYA44cmpwUk4zIkjTQQvzhjs0lB77P4IDh9t27lHfRMmCTiAp5F4yDzbAz2dId7+7cYIOdPTX65RkgQg4/e7"
    b64 .= "RPQJAFpOTowZwI6v0Wml5DTGUmcMDtN7hgW7oBMAovrW1me/jv1yxUR6KHt97ZXxu21fbHuPBig9NnjiWgBbJtbqIBVYqeABOM2F+m8rt2X5R+B7Jtr/0amJMaA/e7aXWZ/KA8b8S36GIkoeNiFaDxcXIIBZQRA6OsrKdiyetfXW2HjnFZOhOc40dn/k/E6zPgDMegYu"
    b64 .= "kLF5UqmKzeaTaQCbAYVMbstg+ivYEAA+iIMFNq52h/FHzqZcEFKNWbBkSQzjkh8cyts4UaYNgPATAj1FUNaBveusxbOagGGs8/jk3ctfbCP6237/HZaD0rLqtoHjIg1kqZbHdcbVH/SZaeh6pp8hgiQg6vvX4fhBn3ZBdU7MkiVeqyLdGYwitZQ+CnKS8uxdXKYIwoIh"
    b64 .= "EjvKoIEmGGXVF2+fPw/yBGDbuabq37ftLC0tuzU8OMppFXMs1WxP0gAF+oAwxt42TQA9PXEANQFRngIIyYHRr1q/Yf0qhk5Khk82jjp9sAtNQC1NwWg7YMuKBgVw5zbazlWndKdARSotza2+P2ngFejFQkuhHDpAIBCwbX0x+bkaAUkAAOhujDHrIwAJQMKGDRvWJzCk"
    b64 .= "ZOxORN9I69ME+flA4BIcjLv23I6OUrP+znMdTSkp3ZcKckt35j65O9Yq5DVViXmWWp5/ezvMRAOpfgAgo/Q9/bsTY9wjaX0EwPGvf2vD+vUA4GRDe0CqjiLSwcHTPrAPo2KQW5oL75U6cs+hG0o7Nm5MTen294veWFp68V6n2sZGCAAcuF7hBLan+hvwKSHWHy6bT+Lv"
    b64 .= "mdoIAZg9exoAHADjR/1IBuUAmIBqThitSyYhTRDsUkYCkLuRWFlHR8dGF5cwT0+cWqm5T+4/aIXcKWpqht0sHEDG+QcaBfRrOgabHQ0A4IKUtTExUP/dZyeAJAUQuR4tYZUXw8mJ8oCap0dV3OKysBSCCp0HuJGEw4uyjbS5BAfiKwY4n9WD/sQhG0epqAOPNPDIgRPF"
    b64 .= "kpvfMnLToDGNgP49MQerL9Qd99mLEmZHQgosSUD5hFWrIs0AVAIE6/HIlc+fJggDApewqmYXok/yg8gjAev4/QcnxmCRlcblNsOpkgobaQXTln7QB7/wnT0DUxO9Zm+ZHTl7yxaS/xAKr5AcrwRKHwFICKRqA2qGsQQAAAikCiABdInhaUVqkXl+QI6EIQCcv0RdGxwf"
    b64 .= "nDBxCEAVHiiAB0S+DPOLQrlftP/27d0pa0GTysCE9RsSQmAyhITAvxL9VZgDmAJqlZ4o8lHe19eXRRGAGksmgvP1CD2ZkwXBqA83xUwBX3BlcGJwoqpKrHKUFs3KD6AAJFQA8DkhViC/6MDE1eb0n52w4a233JfMjsyJQQDUhxwgAGrHCFIC9QQACAR8KIU7drgEszhS"
    b64 .= "qaUuwKi311PvxOw8yUkI3/jLiSODE7VlzTD/1IXNszwAgMPjFJsB6BLoX7d6Ov8T3nrzzfVLvNxz3BMSaAe4k1lgo2PrMfUhArQHfH35LEAKi9LBtbVlkcSoR7/DjEJ5PC9hGV8cmZwczZ8FI5eqC4Ww08ckzPNjml/T8ukKNF0AZm94880338J8jDTre8VAEkIFCGBR"
    b64 .= "AHyzPALo9Z4eOuwGtRwFizT9bs4sswmuThyZPBy3uBmulqgl+/8AAAumSURBVKRSR6mQTAIeF3aHNACTAEAFMlfAhPXggDffXFWdA/MRJ8CqSDOAjmU/7QEaAE5cIjiwSsKZvaNMQM7dmFPyfGfBpeMnxkQeMPvEjlJHDTBgxyq2hf0x/ZwYa6Df9rXuuAYSAEr/zYTq"
    b64 .= "avdIagZAcxDCwBmgCNOH25s9YDaWokhKlilYaP+PPotlPP7i+MTkYQ5uVgFAqVIjgBAPlKgpwKcAugnAS+N/862E6kYaYBUBAAGe3t5YlQ8A9i/pR0CTQhZJqY2Yy6ROyqastvNU54MTk9eKYKPCQQ9oHLWO5ECH1oe5iCFw7sYaSFyw/q2/oP5f1kMKmlNglRcAgPOi"
    b64 .= "oB+GvQBMgil5X4lYa16lVfBOHvUx9ajh145PXnkQNDDYWSSGQ2VHKZzk5AkhW4RKxpTJ0QX+KY00QMIG1P/LBx9AEfCKnJ4EMQy1OgA2qsQDwXpfs34ejxo+XNoIPYx6clJn9oDxyovxs0eCFgwMjreKxQCg1cEGBnZfWrFSPk0A8zB6OwXg5TXbrP+FV06M1yosg0jg"
    b64 .= "Be8JOVKJETY1RgRg+Zr1VWpLepWScoz59tTpC5F3Nl47NXZ40HqBReWRCQKggqsbLryh1RTlFctfJvCL7p4GeJMCSIjJ8fJKIAshIMDmiGHgxSm4XIXRHooca1rfxpJqUqVaD31+vp4cQtLpd//4tQErvPs+cmRURDwAb1eh/sJGsFjOMK9EcGAF+nUIAAQJJAPBAbNz"
    b64 .= "crwi12/AXmR9gldMSDXDcDVKFsGNgM1AMO0BX9hI0pemMEU5Vfn5i4GADgB0pWc7L1jBtSC8LjpypQiadThLy+PBAxMlV2NrBsCzVQhAXWIjWYcjzQ6gI7DhLURIcA9JTGSY6q6nwc2JwJhPhwDGL6VuqxBC65G/eDECmPUnzz64YG1B7mQHj2AW8uA0VcNh46P6NN+X"
    b64 .= "APxgHYJdKABEriL6JAIhOe4A8Bba+siYHAC4ZQpuNnAl3Ah7lzBcCmH8aksKAFdJURWMf3G+PUUQNfbiCjwqwW8UgA8GJiZaOWKeNq8YkgClZREkBchjGz9wAI5/FSyBVAWACHwQWR3i7oVrEliCO+gnMoa2xjV7QBZwWfZhWAW5HOySnegU1DbnowcWUwBRnYPXJiuI"
    b64 .= "PiJUjE8eLuIItVwl7ONx/VMo5GQnhvL+0d2gD2KoZtZfH4LNISBtQAeE5OQkbmSs3A+bHg8A8NXrBahvnv8IoOXpFxOAfD0SXBkce1EBbwCo5xEWVkeujRbxYPJxOXnkqwTcNAIQjUUwMLVxiVcCDpaM9y+YAF9EJjbC4hhJ+uHZMTk5OQU5jJVJT+IUHniTzYIU4IvN"
    b64 .= "uwRqo9RM5GdBDLD+TUy86MeHOBSAtfUAXEiCA+RciAAhUPjiSx8owdH+3XVYcDZQ6fbWhi++wAxMbMKccMeGcDYmQNOt84y9e4eOiaLgGIAsQWzttD5U4aIqlAdbDA4wdg7++kN/ZaWFtflyvuKaWqXjwSEOBYC9MLUPhQTornOfTQcbjCS9V10B1Z16wUJI9I8dDYVH"
    b64 .= "rZlnag3GADbqw4GaJXVljB9SNU6BWQTAHgrAqbF7d4fhPYpZH1+66oSQflwxdRBC1mA/JrUZS2kMAbGYGPowIiQmsaH2pjvVHnt5oX7i1tuh9Yy9NTNn/mQKCIDDmAiuip4A9E6tCKbALMry9Q2nxsdGNm3a5O1AXYvDazi45oZlACqAmP5WEdHHb1fglWZ4w0sGJ2O1"
    b64 .= "pvBGACAu8MIELHgSWl/PWDcT7ElcANyzSMSw/jqZb82hUZxywKxZwVW/Dh5H/U19DvCNolhv+I5LfNapUaGMAqBqrx88LpZzW/H4LDzZzpU2PABJRgtPiYkhBLAK5uRgAEJDGag/c+UtuCkV8+BG03LaBVJd1ZQ+Hhl1PkL9YW+Hyr7Y2Mp4sKzBQ2IAYCg5UwB85+7t"
    b64 .= "puRkOzuzstnwZ8kNjXQIAKCx6VlovRlg5tDWogDVoWNXWqd26liEph2wePH98VvogN4+68pNfRZW2cQDE63kGEzJy6MqkJ9zauPqglqUt/t/zdW1oQkeVTfm5DTCy/rEanSAGWDm+flFrbeWnX92RTuFoGt+CeDZ/WuX63vRAd4QBfy+DxD0d+pkeAqkFFMADL+UmEgv"
    b64 .= "11o7u5ec/5J+gatrYhMcE8JHUyI44GWAmbdNteczy1cefXFWrbbEQNiI8qcDsPXUtWfL8G1qnzdCWAeRLBy4wmOTA3VYDcn3mrY3Rq7ysqu1s3sl/mZ914KChoZEEoO1iQXHLr8CsHDlT08WLizv+q3/t4mzWrJZCngJ4NH4sfRly9JDN8WTh2HWhAAeOorZZCOeJ1aS"
    b64 .= "QrR9bWRkjF2tK1HDAb9E4Ep+5roWjyndY9Y23Wp7FQDyYGFm0m9Q6eIvH0vDI7OIKYDFT05duQ0Ay0I3bWrr87ZyoF4HVVApgCcBHFIIbD3r4FsTdibz+C9R6fcSgatdIgFYHZN4rP7VEMycmVmePlJZ2VNfnrny9vxWtZhlBli89W7nLXhvD1a/qS+WKsMI8ABSgHyv"
    b64 .= "T0ktBgxnuCVLtIOnCK5E0C4cTtOTXwUoAHX4yyuRTEIAyJyShxDDW+Ry+MHKlenP0vKmAX4dnH8eHbAsva0yiH6jBCG4cFZFHcXCdxo1ZDl0g/f1iZfiFKxkPQ7dGAUW/koWuDY0zoMWzSuyEcogAThD5MvxETSILyRVYeXKZbdN0wBbTx1/ko52eTjL22L6peLAYQ4b"
    b64 .= "AWAecjl4LA8Pj+H7Df4iUZoRhq0Pj4LbvSgWqUJTSdDQNC8Sd8shTVQMCADKp6fDc9aZtP7KZcc8fMPzzVNwYmtSenpvX19W/Ka2TVlBZoLBNCzB6AE4i9dQachM7ebzhEVpcK+YrGeBAxQsu2S4nKDrYgFwrMZ9SmQIrAS9CDA0MzM9CQdvjgVxwPlaia0AABZjBhxr"
    b64 .= "+Ik433tTPcmCSivyPs7qCC+AAED1FXM1vDy8ICiOFhhaha2tcLEBtxAsYxQ03LVRtbUUQAFcM9Y2EoAlOYnHLgMBg4w+c1qeOGDlTyJOnoDywOLEqmND8F2vLPha77JlK1fWb4IXkmQxnhBqfMnVqlyT5+PvK4LrGViH2BqtFs7NeHGQCCxWeBRlyZQDuu1Mpqa5uFNy"
    b64 .= "x1rc29vLSEo6fwbVM1/Sz5zR8tOxAvsquGDPzw+2bzgzc2Fmej1mIXondFMfusACCzH5bjNDLs6DL7jx2WIZfLtMrNXkwVMRIU8GlzOkkcO7/ijwfUEByIe7FqzGrRKsBjARAOD2k6ZE9zMvOQBY4IspC4eG4MshOVsbGuzjckoyF2YuI/o4E7EcwlPdyvjJQ2LogBCA"
    b64 .= "I4OXGv7R8gAOR8j75dsXrTo4MeMZcRbwWVEemgC4q6y1A/208JSChkbYFkfighxyO7SXkbIdDpJTbt3OMBPg92LW4fs2tKEzZ/Y8ObNwaOVK8/BDcUGA5TArPv7UYRWcyOBmSMwGgEB/N7iv4XAeP4Q1Au5+i6pmVRH3B8BlK7y3CLcPN9WmNLk2JEbCNIyBt8yzz5T3"
    b64 .= "MrZTlvIT7QQiTwOsy8ykOGbS7gcA0IcvDmRn4Wo8psuDMyk4FdbIosnXDJ2Z8MJ0rD924GxzXJGwObesCp3goUF9Uy20JKYCAMDGDBaDAgAoCaUBortxOsK3kFbQ+mYXoGWupPQhPyAA1PcWSDtwahQ2hbYUAPmeob+fXCnsrIBn2a6pRZaiHaVlzQHw2EKTRvTDTWlp"
    b64 .= "dil2tZfgLX1KimtBYrX7mSEaYP6TIRw8vGtc95IHaFtG68/MXJle30OkKYL48aI8GsCPBmAUc8YrFgRVjG2s0jo2l5V5aDzIcxu8LawFgIKCZBPsGVO6uwtSUgqavHZTADln4JslKE8BwPinECAtaffDvyX1En3aeuLvXlMpMQRimbMZgHv4BGydFgwcc2l1FDbvqIJb"
    b64 .= "+6hkSH64LDUZMAftTMndxOBBfVPI7P8FXP08F5Bqs9MAAAAASUVORK5CYII="
    n := 0
    if !DllCall("crypt32\CryptStringToBinary", "Str", b64, "UInt", 0, "UInt", 1, "Ptr", 0, "UInt*", n, "Ptr", 0, "Ptr", 0)
        return ""
    VarSetCapacity(bin, n, 0)
    DllCall("crypt32\CryptStringToBinary", "Str", b64, "UInt", 0, "UInt", 1, "Ptr", &bin, "UInt*", n, "Ptr", 0, "Ptr", 0)
    FileCreateDir, % A_AppData . "\MonitorLink"
    f := FileOpen(archivoLogo, "w", "CP0")   ; CP0: no text marker before the image bytes
    if !IsObject(f)
        return ""
    f.RawWrite(bin, n)
    f.Close()
    return archivoLogo
}

; Titled box with a colored title (-Theme so Windows keeps the color).
Caja(x, y, w, h, titulo, color, var := "") {
    Gui, Font, s9 Bold c%color%, Segoe UI
    if (var != "")
        Gui, Add, GroupBox, x%x% y%y% w%w% h%h% -Theme v%var%, %titulo%
    else
        Gui, Add, GroupBox, x%x% y%y% w%w% h%h% -Theme, %titulo%
}

; (2026-11-09, Ale) The key box is never locked: when the bot moved to a new database the old
; Monitor Links could not find it, and members could not paste a new key without editing the .ini.
; Already linked -> the same box links again with a new key (/link -> Get a new key).
; (Ale 2026-11-10) Linked: the box shows ******** and the button says Change; Change empties it for a new key.
MostrarVinculo(mostrar) {
    if (mostrar || Cambiando) {
        GuiControl,, LinkBox, % mostrar ? "Link this PC" : "Change the link key"
        GuiControl,, LinkTxt, % mostrar ? "In Discord, type /link in Zenith Rise and paste the key here:" : "In Discord: /link -> Get a new key, and paste it here:"
        GuiControl,, Clave,
        GuiControl, Enable, Clave
        GuiControl,, BtnLink, Link
    } else {
        GuiControl,, LinkBox, Linked
        GuiControl,, LinkTxt, This PC is linked. To use a new key, press Change.
        GuiControl,, Clave, ****************************
        GuiControl, Disable, Clave
        GuiControl,, BtnLink, Change
    }
    PintarEstado()
}

PintarEstado() {
    ; Banned accounts still on this PC (counted again only when the list or the files change).
    if (BanLocales = "")
        BanLocales := Baneadas.Count() ? ArchivosBaneados().Count() : 0
    GuiControl, % BanLocales ? "Enable" : "Disable", BtnBanAbrir
    GuiControl, % BanLocales ? "Enable" : "Disable", BtnBanBorrar
    if (Token = "") {
        Gui, Font, s9 Bold cFAA61A, Segoe UI
        GuiControl, Font, Status
        GuiControl,, Status, Not linked yet
    } else if (EnLinea) {
        Gui, Font, s9 Bold c3BA55C, Segoe UI
        GuiControl, Font, Status
        GuiControl,, Status, Connected
    } else {
        Gui, Font, s9 Bold cED4245, Segoe UI
        GuiControl, Font, Status
        GuiControl,, Status, Can't reach the bot, retrying
    }
    ; Version line (Ale 2026-11-06): up to date, or updating to the newest one (it installs by itself).
    GuiControl,, TxtVer, % VERSION . (UltimaVersionAhk = "" ? "" : VersionMasNueva(UltimaVersionAhk, VERSION) ? "  -  updating to " . UltimaVersionAhk . "..." : "  -  up to date")
    GuiControl,, TxtUser, % UserName != "" ? "Discord: " . UserName : ""
    GuiControl,, TxtCarpeta, % "Folder: " . (Ruta != "" ? Ruta : "not chosen yet - press Change folder")
    GuiControl,, TxtResumen, % UltimoEnvio != "" ? "Cards summary: " . CuentasEnviadas . " accounts, sent at " . UltimoEnvio : "Cards summary: not sent yet"
    GuiControl,, TxtBan, % BanLocales ? "On this PC: " . BanLocales . " (open or delete them)" : "None on this PC"
    gp := CuentasReroll.Count() ? "Shared: " . CuentasReroll.Count() . " accounts" . (UltimoReroll != "" ? "`nLast opened: " . UltimoReroll : "") : "Not sharing accounts yet"
    if (CompGP != "")
        gp .= "`nGod Pack farm: " . CompGP . "  -  96P pack farm: " . Comp96
    GuiControl,, TxtGP, %gp%
    GuiControl,, TxtProx, % ProxyFile != "" ? "Shared: " . (ProxiesEnviadas != "" ? ProxiesEnviadas : "sending...") : "Not sharing proxies"
    GuiControl,, TxtError, %UltimoError%
    Menu, Tray, Tip, % "Monitor Link - " . (Token = "" ? "not linked" : EnLinea ? "connected" : "offline")
}

AbrirVentana:
    Gui, Show
    SetTimer, ConsultarOnlineAhora, -500
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
    Gui, 2:Add, Text, w440, Tick the accounts the hosts can use for the reroll. Accounts with fewer than 96 packs are listed too: hosts open them in their pack farm until they reach 96, then they move to the God Pack farm by themselves.
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
        f := RegExMatch(t, """fileName""\s*:\s*""((?:[^""\\]|\\.)*)""", mf) ? JsonUnesc(mf1) : A_LoopFileName
        ; GP column: OK = God Pack eligible; "Locked N" = still needs N packs after its last 30-day pause.
        faltan := SobresFaltanGP(t, sobres)
        ; Since pause: packs opened after the last 30-day pause out of 96, and how many are missing to reach 96 again.
        desdePausa := sobres >= 96 ? sobres . "/96 OK" : sobres . "/96 (-" . (96 - sobres) . ")"
        if (faltan)
            noElegibles++
        if (CuentasReroll.HasKey(f))
            compartidas++
        LV_Add(CuentasReroll.HasKey(f) ? "Check" : "", f, mp1 + 0, Baneadas.HasKey(f) ? "Banned?" : faltan ? "Locked " . faltan . "p" : "OK", desdePausa)
        total++
    }
    LV_ModifyCol(1, 250), LV_ModifyCol(2, "60 Integer SortDesc"), LV_ModifyCol(3, 80), LV_ModifyCol(4, 105)
    Gui, 2:Add, Text, w440 y+6, % total . " accounts - " . compartidas . " shared now."
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
; Likely banned accounts (the hosts' GP farm saw the game refuse them on 2+ proxies): marked "Banned?"
; in Share accounts, and a notification the first time each one shows up.
LeerBaneadas(texto) {
    if !RegExMatch(texto, """banned""\s*:\s*\[([^\]]*)\]", mb)
        return
    nuevas := {}, avisar := "", p := 1
    while (p := RegExMatch(mb1, """((?:[^""\\]|\\.)*)""", mn, p)) {
        p += StrLen(mn)
        f := JsonUnesc(mn1)
        nuevas[f] := true
        if !Baneadas.HasKey(f)
            avisar .= "`n" . f
    }
    Baneadas := nuevas
    if (avisar != "") {
        TrayTip, Monitor Link, % "Likely banned account(s) - the game refused them on several proxies:" . avisar, 20, 2
        BanLocales := ""   ; recount the files on this PC
        PintarEstado()
    }
}

; ---------------------------------------------------------------- banned accounts (Ale 2026-11-06)
; Banned folder = Accounts\Banned (next to Saved and Cards).
CarpetaBaneadas() {
    return CarpetaJson = "" ? "" : CarpetaPadre(CarpetaPadre(CarpetaJson)) . "\Banned"
}

; Each banned account on this PC: { xml: path or "", json: path or "" } (in Saved or already in Banned).
ArchivosBaneados() {
    salida := {}
    if (!Baneadas.Count() || CarpetaJson = "")
        return salida
    jsons := {}
    Loop, Files, %CarpetaJson%\*.json
    {
        FileRead, t, %A_LoopFileFullPath%
        if RegExMatch(t, """fileName""\s*:\s*""((?:[^""\\]|\\.)*)""", mf)
            jsons[RegExReplace(JsonUnesc(mf1), "i)\.xml$", "")] := A_LoopFileFullPath
    }
    ban := CarpetaBaneadas()
    for f in Baneadas {
        base := RegExReplace(f, "i)\.xml$", "")
        xml := FileExist(ban . "\" . base . ".xml") ? ban . "\" . base . ".xml" : RutaDeXml(f)
        json := FileExist(ban . "\" . base . ".json") ? ban . "\" . base . ".json" : (jsons.HasKey(base) ? jsons[base] : "")
        if (xml != "" || json != "")
            salida[f] := {xml: xml, json: json}
    }
    return salida
}

; Open folder: the banned accounts' XML + JSON move to Accounts\Banned (out of Saved, so no bot uses
; them) and the folder opens.
AbrirBaneadas:
    ban := CarpetaBaneadas()
    if (ban = "") {
        MsgBox, 48, Monitor Link, Pick your folder first (Change folder).
        return
    }
    FileCreateDir, %ban%
    movidas := 0
    for f, a in ArchivosBaneados() {
        base := RegExReplace(f, "i)\.xml$", "")
        if (a.xml != "" && !InStr(a.xml, ban . "\")) {
            FileMove, % a.xml, % ban . "\" . base . ".xml", 1
            movidas += !ErrorLevel
        }
        if (a.json != "" && !InStr(a.json, ban . "\"))
            FileMove, % a.json, % ban . "\" . base . ".json", 1
    }
    IndiceXml := "", BanLocales := ""
    PintarEstado()
    Run, explorer.exe "%ban%"
    if (movidas)
        TrayTip, Monitor Link, % movidas . " banned account(s) moved to " . ban, 5, 1
return

; Delete: the banned accounts' XML + JSON go to the Recycle Bin (recoverable) and stop being shared.
BorrarBaneadas:
    archivos := ArchivosBaneados()
    if (!archivos.Count()) {
        MsgBox, 64, Monitor Link, No banned account files on this PC.
        return
    }
    MsgBox, 36, Monitor Link, % "Send the XML and JSON of " . archivos.Count() . " likely banned account(s) to the Recycle Bin?`n`nThey stop being shared. You can restore them from the Recycle Bin if it was a mistake."
    IfMsgBox, No
        return
    borradas := 0
    for f, a in archivos {
        if (a.xml != "") {
            FileRecycle, % a.xml
            borradas += !ErrorLevel
        }
        if (a.json != "")
            FileRecycle, % a.json
        CuentasReroll.Delete(f)
    }
    lista := ""
    for f in CuentasReroll
        lista .= f . "`n"
    FileDelete, %CFG_REROLL%
    if (lista != "")
        FileAppend, %lista%, %CFG_REROLL%, UTF-8-RAW
    IndiceXml := "", BanLocales := ""
    EnviarCuentasReroll()
    PintarEstado()
    MsgBox, 64, Monitor Link, % borradas . " banned account(s) sent to the Recycle Bin."
return

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

; My Main ID (Ale 2026-11-07): the member's own Main, so the bot can send cards to it (Share/Trade) and show
; their cards even if they are not in wR98's registration panel yet.
TextoMain() {
    return MiMain = "" ? "My Main ID (needed for Share/Trade) - not set" : "My Main ID: " . RegExReplace(MiMain, "(\d{4})(?=\d)", "$1-")
}

RegistrarMain:
    actual := MiMain = "" ? "" : RegExReplace(MiMain, "(\d{4})(?=\d)", "$1-")
    InputBox, nuevo, My Main ID, Your Main's Pokemon TCG Pocket friend ID (16 digits`, e.g. 1234-5678-9012-3456).`nThe bot sends your cards there (Share/Trade).`n`nLeave it empty and press OK to remove it., , 420, 190, , , , , %actual%
    if ErrorLevel
        return
    nuevo := RegExReplace(nuevo, "\D")
    if (nuevo != "" && StrLen(nuevo) != 16) {
        MsgBox, 48, Monitor Link, The friend ID has 16 digits (e.g. 1234-5678-9012-3456).
        return
    }
    MiMain := nuevo
    IniWrite, %MiMain%, %CFG%, main, id
    GuiControl,, BtnMain, % TextoMain()
    if !EnviarMain(true)
        MsgBox, 48, Monitor Link, Saved, but could not reach the bot. It will be sent when it shows Connected.
    else
        MsgBox, 64, Monitor Link, % MiMain = "" ? "Done: your Main was removed." : "Done: the bot will send your cards to this Main." . TextoDragonite(DragoniteRes, "register")
return

EnviarMain(dragonite := false) {
    DragoniteRes := ""
    if (Token = "")
        return false
    body := "{""main"":""" . MiMain . """"
    ; (Ale 2026-11-10) Also in Dragonite (wr98's register), with the heartbeat name of this PC's PTCGPB bot.
    if (dragonite && MiMain != "") {
        hb := ""
        ini := BuscarSettingsPtcgpb()
        if (ini != "")
            IniRead, hb, %ini%, General, heartBeatName, %A_Space%
        body .= ",""dragonite"":true,""heartbeatName"":""" . JsonEsc(Trim(hb)) . """"
    }
    body .= "}"
    try {
        r := Http("POST", ServerUrl . "/link/main", body, "text/plain; charset=utf-8", Token, 30)
    } catch e {
        return false
    }
    if RegExMatch(r.text, """dragonite""\s*:\s*""(\w+)""", dr)
        DragoniteRes := dr1
    if (r.status = 401) {
        NoVinculado()
        return false
    }
    for _, espejo in Espejos
        try Http("POST", espejo . "/link/main", body, "text/plain; charset=utf-8", Token, 30)
    return r.status = 200
}

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

; ---------------------------------------------------------------- Sync reroll for Zenith Rise (Ale 2026-11-10)
; Writes the community Group Reroll setup into the PTCGPB bot (Settings.ini): online IDs lists, auto GP test,
; this member's Discord ID + the community webhook (asked to the bot: it is never inside this file),
; Wonderpick detection and the Inject Wonderpick 96P+ mode.
SyncRerollZenith:
    if (Token = "") {
        MsgBox, 48, Monitor Link, Link this PC first (type /link in Zenith Rise).
        return
    }
    ini := BuscarSettingsPtcgpb()
    if (ini = "") {
        FileSelectFile, ini, 3, %A_ScriptDir%, Choose the Settings.ini of your PTCGPB bot, Settings (Settings.ini)
        if (ini = "")
            return
    }
    ; (Ale 2026-11-11) PTCGPB open: close it here (it saves its own settings when it closes, so before
    ; writing them) and a new one opens at the end, instead of asking the member to close it.
    if PtcgpbAbierto() {
        GuiControl,, Status, Zenith Rise: closing the open PTCGPB bot...
        CerrarPtcgpb()
        Sleep, 1500
        if PtcgpbAbierto() {
            MsgBox, 48, Monitor Link, Could not close the PTCGPB bot. Close it yourself and press this button again.
            return
        }
    }
    r := ""
    try r := Http("GET", ServerUrl . "/link/reroll-config", "", "", Token, 20)
    if (!IsObject(r) || r.status != 200) {
        if (IsObject(r) && r.status = 401) {
            NoVinculado()
            return
        }
        MsgBox, 48, Monitor Link, % "Could not get the Zenith Rise setup from the bot" . (IsObject(r) ? " (" . r.status . ")" : "") . ". Try again in a minute."
        return
    }
    RegExMatch(r.text, """discordId""\s*:\s*""(\d+)""", d)
    RegExMatch(r.text, """webhook""\s*:\s*""([^""]*)""", w)
    RegExMatch(r.text, """mainIdsURL""\s*:\s*""([^""]*)""", m)
    RegExMatch(r.text, """vipIdsURL""\s*:\s*""([^""]*)""", v)
    webhook := JsonUnesc(w1), mainUrl := JsonUnesc(m1), vipUrl := JsonUnesc(v1)
    if (d1 = "" || webhook = "" || mainUrl = "") {
        MsgBox, 48, Monitor Link, The bot sent an incomplete setup. Try again in a minute.
        return
    }
    FileCopy, %ini%, %ini%.before-zenith.bak, 1
    ; Group Reroll
    IniWrite, 1, %ini%, GroupReroll, groupRerollEnabled
    IniWrite, %mainUrl%, %ini%, GroupReroll, mainIdsURL
    IniWrite, %vipUrl%, %ini%, GroupReroll, vipIdsURL
    IniWrite, 1, %ini%, GroupReroll, autoUseGPTest
    IniWrite, 3600, %ini%, GroupReroll, TestTime
    IniWrite, 0, %ini%, GroupReroll, hasUnopenedPack
    IniWrite, 150, %ini%, GroupReroll, gpTestWaitTime
    ; Group Reroll Discord (only this part of Discord Settings)
    IniWrite, %d1%, %ini%, GroupReroll, groupRerollDiscordUserId
    IniWrite, %webhook%, %ini%, GroupReroll, groupRerollDiscordWebhookURL
    IniWrite, 0, %ini%, GroupReroll, groupRerollSendAccountXml
    ; Wonderpick card detection: Min GP 2 stars, ignore invalid packs, the rest off
    IniWrite, 2, %ini%, Wonderpick, minStars
    IniWrite, 1, %ini%, Wonderpick, InvalidCheck
    IniWrite, 0, %ini%, Wonderpick, FullArtCheck
    IniWrite, 0, %ini%, Wonderpick, TrainerCheck
    IniWrite, 0, %ini%, Wonderpick, RainbowCheck
    IniWrite, 0, %ini%, Wonderpick, WishlistCheck
    IniWrite, 0, %ini%, Wonderpick, PseudoGodPack
    ; Bot mode
    IniWrite, Inject Wonderpick 96P+, %ini%, General, deleteMethod
    IniWrite, 70, %ini%, General, injectWonderpickMinPacks
    IniWrite, PacksDesc, %ini%, UserSettings, injectSortMethod
    ; Instance settings (Ale 2026-11-10): no reroll instances, only the Main injecting.
    IniWrite, 0, %ini%, General, Instances
    IniWrite, 0, %ini%, General, Columns
    IniWrite, 10, %ini%, General, instanceStartDelay
    IniWrite, 1, %ini%, General, runMain
    IniWrite, 1, %ini%, General, Mains
    IniWrite, 0, %ini%, General, packMethod
    IniWrite, 0, %ini%, General, openExtraPack
    IniWrite, 0, %ini%, General, spendHourGlass
    webhook := ""
    if (MiMain != "")
        EnviarMain(true)
    online := DragoniteOnline(true)
    if (online = "ok")
        PintarOnline("on")
    MsgBox, 64, Monitor Link, % "Done! Your PTCGPB bot is set up for the Zenith Rise group reroll:`n`n- Group Reroll ON (elite + vip-elite online IDs)`n- Auto GP test every 3600 s (Standard, wait 150 s)`n- Group Discord: your Discord ID + the community webhook`n- Wonderpick: min 2 stars, ignore invalid packs`n- Mode: Inject Wonderpick 96P+ (min 70 packs, most packs first), 0 instances + 1 Main`n`nThe PTCGPB bot opens now, launches MuMu and starts by itself. A copy of your old settings is in Settings.ini.before-zenith.bak" . TextoDragonite(online, "online")
    ; (Ale 2026-11-10) Opens the PTCGPB bot right after.
    SplitPath, ini,, dirBot
    if FileExist(dirBot . "\PTCGPB.ahk")
        AbrirYArrancarPtcgpb(dirBot)
return

; (Ale 2026-11-10) Online / offline in Dragonite (wr98's list of online Mains), like his Discord buttons.
; Returns the bot's answer: ok, full, not_registered, no_role, rivals, error ("" = bot not reached).
DragoniteOnline(online) {
    if (Token = "")
        return ""
    r := ""
    try r := Http("POST", ServerUrl . "/link/online", online ? "{""online"":true}" : "{""online"":false}", "text/plain; charset=utf-8", Token, 20)
    if (!IsObject(r))
        return ""
    if (r.status = 401) {
        NoVinculado()
        return ""
    }
    RegExMatch(r.text, """result""\s*:\s*""(\w+)""", x)
    return x1 != "" ? x1 : "error"
}

TextoDragonite(res, accion) {
    if (res = "")
        return accion = "register" ? "" : "`n`nDragonite: could not reach the bot. Use the Online button in Discord."
    if (res = "ok")
        return accion = "register" ? "`n`nAlso saved in Dragonite." : accion = "online" ? "`n`nYou are ONLINE in Dragonite." : "`n`nYou are OFFLINE in Dragonite."
    if (res = "id_used")
        return "`n`nDragonite: that ID is already registered by another member."
    if (res = "no_role")
        return "`n`nDragonite: you need a group role (Trainer, Gym Leader, Elite Four) in Discord."
    if (res = "not_registered")
        return "`n`nDragonite: set My Main ID first (Discord box), then press this again."
    if (res = "full")
        return "`n`nDragonite: your group already has 25 online. Try again later."
    if (res = "rivals")
        return "`n`nDragonite: Rivals use their own sessions. Use the buttons in Discord."
    return "`n`nDragonite: something failed. Use the buttons in Discord."
}

CambiarOnline:
    if (Token = "") {
        MsgBox, 48, Monitor Link, Link this PC first (type /link in Zenith Rise).
        return
    }
    quiere := EstadoOnline != "on"
    PintarOnline("wait")
    res := DragoniteOnline(quiere)
    if (res = "ok") {
        PintarOnline(quiere ? "on" : "off")
        ; Offline with the Main running: GP test, then PTCGPB and MuMu Main close (Ale 2026-11-11).
        if (!quiere && GpTestOffline && MainCorriendo() != "")
            SetTimer, ApagarConGpTestYa, -100
    }
    else {
        ConsultarOnline()
        MsgBox, 48, Monitor Link, % SubStr(TextoDragonite(res, quiere ? "online" : "offline"), 3)
    }
return

; ---------------------------------------------------------------- Offline -> GP test -> close (Ale 2026-11-11)
; Going Offline (this window's button, or Dragonite's button in Discord) while the PTCGPB Main runs:
; the Main does a Standard GP test (removes the friends, keeps the God Pack ones) and stops by itself
; ("Run GP Test then Stop"), then PTCGPB and the MuMu "Main" instance close and Discord gets a message.
; Dragonite's button is wr98's bot: it is noticed because this Main leaves the public online list.

; PID of the PTCGPB Main.ahk running on this PC ("" = not running). dir = the PTCGPB folder.
MainCorriendo(ByRef dir := "") {
    ; AutoHotkeyUX.exe = the AutoHotkey launcher: its command line also names Main.ahk, but it is not the Main.
    for p in ComObjGet("winmgmts:").ExecQuery("SELECT ProcessId, CommandLine FROM Win32_Process WHERE Name LIKE 'AutoHotkey%' AND NOT Name LIKE 'AutoHotkeyUX%'")
        if RegExMatch(p.CommandLine, "i)([A-Z]:\\(?:(?![A-Z]:\\)[^""])*?)\\Scripts\\Main\.ahk", m) {
            dir := m1
            return p.ProcessId
        }
    return ""
}

VigilarOfflineMain:
    if (ApagandoGp || Token = "")
        return
    miId := MiMain != "" ? MiMain : MainDragonite
    if (miId = "" || MainCorriendo() = "") {
        MainVistoOnline := false, MainAusente := 0
        return
    }
    listas := "", leidas := 0
    for _, u in ["https://onlineids.zenithrise.workers.dev/elite", "https://onlineids.zenithrise.workers.dev/vip-elite"] {
        r := ""
        try r := Http("GET", u, "", "", "", 15)
        if (IsObject(r) && r.status = 200 && RegExMatch(r.text, "\d{16}"))
            listas .= r.text . "`n", leidas++
    }
    if (!leidas)
        return   ; list not reachable / empty: never stop on that
    if InStr(listas, miId) {
        MainVistoOnline := true, MainAusente := 0
        return
    }
    ; Two checks in a row without this Main (1 min apart) = it went Offline.
    if (MainVistoOnline && ++MainAusente >= 2) {
        if GpTestOffline
            SetTimer, ApagarConGpTestYa, -100
        else {
            ; No GP test: only the button shows Offline (Dragonite's button in Discord).
            MainVistoOnline := false, MainAusente := 0
            PintarOnline("off")
        }
    }
return

ApagarConGpTestYa:
    ApagarConGpTest()
return

ApagarConGpTest() {
    global ApagandoGp, MainVistoOnline, MainAusente
    if ApagandoGp
        return
    pid := MainCorriendo(dirBot)
    if (pid = "" || dirBot = "")
        return
    ApagandoGp := true, MainVistoOnline := false, MainAusente := 0
    PintarOnline("off")   ; Offline from Dragonite too: the button shows it (Ale 2026-11-11)
    online := InicioProceso(pid)   ; when this Main started = start of the online session (Ale 2026-11-11)
    inicio := A_TickCount
    AvisarGpStop("start")
    TrayTip, Monitor Link, % "You are Offline: running a GP test. PTCGPB and MuMu Main close after it.", 6, 1
    ini := dirBot . "\Settings.ini", logMain := dirBot . "\Logs\Log_Main.txt"
    FileGetSize, desde, %logMain%
    IniRead, antes, %ini%, Extra, stopPreferenceMain, %A_Space%
    IniWrite, gp_test, %ini%, Extra, stopPreferenceMain
    ; Stop button of the Main toolbar (with stopPreferenceMain=gp_test it runs the GP test, then stops).
    pulsado := false
    WinGet, lista, List, ahk_class AutoHotkeyGUI ahk_pid %pid%
    Loop, %lista% {
        h := lista%A_Index%
        ControlGet, b, Hwnd,, Stop (Shift+F10), ahk_id %h%
        if b {
            PostMessage, 0xF5, 0, 0,, ahk_id %b%   ; BM_CLICK
            pulsado := true
            break
        }
    }
    if !pulsado
        Send, +{F10}
    ; Wait until Main.ahk ends by itself (up to 10 min; normally 4-6 min), showing the step and the countdown (Ale 2026-11-11).
    VentanaGpTest("Step 1/3: Favouriting VIP friends...", inicio)
    pasoEnviado := "", envioPaso := 0
    Loop {
        Process, Exist, %pid%
        if (!ErrorLevel || A_TickCount - inicio >= 10 * 60000)
            break
        paso := "Step 1/3: Favouriting VIP friends..."
        f := FileOpen(logMain, "r")
        if IsObject(f) {
            f.Seek(desde + 0)
            nuevo := f.Read()
            f.Close()
            if InStr(nuevo, "GP Test: done")
                paso := "GP Test done!"
            else if InStr(nuevo, "GP Test: removing non-VIP friends")
                paso := "Step 3/3: Removing non-VIP friends..."
        }
        if InStr(paso, "Step 1/3") {
            ; The Main shows its countdown only on screen: read it from its status window.
            DetectHiddenText, On
            WinGet, ventanas, List, ahk_pid %pid%
            Loop, %ventanas% {
                WinGetText, t, % "ahk_id " . ventanas%A_Index%
                if RegExMatch(t, "Waiting for instances to remove friends \((\d+)s\)", ms) {
                    paso := "Step 2/3: Waiting for friends to be removed - " . ms1 . "s"
                    break
                }
            }
        }
        VentanaGpTest(paso, inicio)
        ; Same step to Discord (the message is edited live): when the step changes, or every 15 s.
        clavePaso := SubStr(paso, 1, 9)
        if (clavePaso != pasoEnviado || A_TickCount - envioPaso >= 15000) {
            pasoEnviado := clavePaso, envioPaso := A_TickCount
            AvisarGpStop("step", Round((A_TickCount - inicio) / 1000), true, paso)
        }
        Sleep, 1000
    }
    hecho := false
    f := FileOpen(logMain, "r")
    if IsObject(f) {
        f.Seek(desde + 0)
        hecho := InStr(f.Read(), "GP Test: done") > 0
        f.Close()
    }
    if (MainCorriendo() = pid)
        Process, Close, %pid%
    VentanaGpTest(hecho ? "GP Test done! Closing PTCGPB and MuMu..." : "The GP test did not finish. Closing PTCGPB and MuMu...", inicio)
    ; PTCGPB window (its close also stops any script it started), then the MuMu "Main" instance.
    ; After Start Bot the PTCGPB window is hidden (tray): look for hidden windows too, and if it is still
    ; open after 30 s close the process (Ale 2026-11-11: it stayed open and Sync reroll refused to start).
    CerrarPtcgpb()
    if (antes = "" || antes = "ERROR")
        IniDelete, %ini%, Extra, stopPreferenceMain
    else
        IniWrite, %antes%, %ini%, Extra, stopPreferenceMain
    mumu := false
    manager := RutaMuMuManager()
    if (manager != "")
        for _, i in InstanciasMuMu(InfoMuMu(manager))
            if (i.name = "Main") {
                RunWait, % """" . manager . """ control -v " . i.index . " shutdown",, Hide
                mumu := true
            }
    VentanaGpTest(hecho ? "Done! GP Test finished, PTCGPB and MuMu closed." : "The GP test did not finish (stuck, cancelled or 10 min). PTCGPB and MuMu closed.", inicio, true)
    ; God Packs kept as friends = the VIP list the Main used (vip_ids.txt + manual_vip_ids.txt), IDs only.
    vip := "", nVip := 0
    for _, archivoVip in [dirBot . "\vip_ids.txt", dirBot . "\manual_vip_ids.txt"] {
        FileRead, tv, %archivoVip%
        pv := 1
        while (nVip < 100 && (pv := RegExMatch(tv, "\b(\d{16})\b", mv, pv))) {
            pv += StrLen(mv)
            if !InStr(vip, """" . mv1 . """")
                vip .= (vip = "" ? "" : ",") . """" . mv1 . """", nVip++
        }
    }
    AvisarGpStop(hecho ? "done" : "timeout", Round((A_TickCount - inicio) / 1000), mumu, hecho ? "" : paso, vip, online)
    TrayTip, Monitor Link, % hecho ? "GP test finished. PTCGPB and MuMu Main closed." : "The GP test did not finish in 10 min. PTCGPB and MuMu Main closed anyway.", 6, 1
    ApagandoGp := false
}

; Closes PTCGPB (and the scripts it started). By process, not by title (the window is not always called
; "Arturo's PTCGP BOT", and after Start Bot it can be hidden): close its window, then Exit like the tray
; menu, and as a last resort end the process.
CerrarPtcgpb() {
    dirs := ""
    DetectHiddenWindows, On
    for p in ComObjGet("winmgmts:").ExecQuery("SELECT ProcessId, CommandLine FROM Win32_Process WHERE Name LIKE 'AutoHotkey%' AND NOT Name LIKE 'AutoHotkeyUX%'")
        if RegExMatch(p.CommandLine, "i)([A-Z]:\\(?:(?![A-Z]:\\)[^""])*?)\\PTCGPB\.ahk", md) {
            dirs .= md1 . "\Scripts\|"
            ppid := p.ProcessId
            WinClose, ahk_class AutoHotkeyGUI ahk_pid %ppid%
            Process, WaitClose, %ppid%, 20
            if ErrorLevel {
                PostMessage, 0x111, 65307,,, ahk_class AutoHotkey ahk_pid %ppid%   ; tray menu Exit
                Process, WaitClose, %ppid%, 10
            }
            if ErrorLevel
                Process, Close, %ppid%
        }
    ; The Main (and instances) of THAT PTCGPB folder, if any is left (never another PTCGPB folder).
    for p in ComObjGet("winmgmts:").ExecQuery("SELECT ProcessId, CommandLine FROM Win32_Process WHERE Name LIKE 'AutoHotkey%'")
        if RegExMatch(p.CommandLine, "i)([A-Z]:\\(?:(?![A-Z]:\\)[^""])*?\\Scripts\\)(?:Main\d*|\d+)\.ahk", ms)
            && InStr("|" . dirs, "|" . ms1 . "|")
            Process, Close, % p.ProcessId
    DetectHiddenWindows, Off
}

; Unix time (seconds) when a process started, from WMI ("20261111123500.123456-300": local time + offset in min).
InicioProceso(pid) {
    for p in ComObjGet("winmgmts:").ExecQuery("SELECT CreationDate FROM Win32_Process WHERE ProcessId = " . pid) {
        cd := p.CreationDate
        t := SubStr(cd, 1, 14)
        EnvSub, t, 19700101000000, Seconds
        return t - SubStr(cd, 22) * 60
    }
    return 0
}

; Small always-on-top window while the Offline GP test runs: the step, the Main's countdown and the time.
VentanaGpTest(paso, inicio, final := false) {
    static creada := false, hTitulo := 0, hPaso := 0, hTiempo := 0
    if !creada {
        Gui, GpTest:New, +AlwaysOnTop +ToolWindow -MinimizeBox, Monitor Link - GP Test
        Gui, GpTest:Color, 1E1E1E
        Gui, GpTest:Font, s12 Bold cFFD54F, Segoe UI
        Gui, GpTest:Add, Text, x16 y12 w440 h26 hwndhTitulo, GP Test running - please don't touch the bot
        Gui, GpTest:Font, s11 Norm cFFFFFF, Segoe UI
        Gui, GpTest:Add, Text, x16 y46 w440 h24 hwndhPaso
        Gui, GpTest:Font, s9 cAAAAAA, Segoe UI
        Gui, GpTest:Add, Text, x16 y78 w440 h20 hwndhTiempo
        Gui, GpTest:Show, w472 h108 NoActivate
        creada := true
    }
    if final
        GuiControl, GpTest:, %hTitulo%, GP Test finished
    GuiControl, GpTest:, %hPaso%, %paso%
    s := (A_TickCount - inicio) // 1000
    GuiControl, GpTest:, %hTiempo%, % "Time: " . (s // 60) . ":" . Format("{:02}", Mod(s, 60))
        . (final ? "" : "    -    PTCGPB and MuMu close by themselves at the end")
    if final {
        creada := false
        SetTimer, CerrarVentanaGpTest, -15000
    }
}

CerrarVentanaGpTest:
    Gui, GpTest:Destroy
return

; Tells the bot (message in #logging). fase: start | done | timeout.
AvisarGpStop(fase, segundos := 0, mumu := true, paso := "", vip := "", desde := 0) {
    if (Token = "")
        return
    body := "{""phase"":""" . fase . """,""seconds"":" . (segundos + 0) . ",""mumu"":" . (mumu ? "true" : "false")
        . (paso != "" ? ",""step"":""" . JsonEsc(paso) . """" : "")
        . (fase != "start" && fase != "step" ? ",""vip"":[" . vip . "],""since"":" . (desde + 0) : "") . "}"
    try Http("POST", ServerUrl . "/link/gp-stop", body, "text/plain; charset=utf-8", Token, 10)
}

; Asks the bot once (when the window opens / at start), not on a timer: wr98's Upstash has a monthly limit.
ConsultarOnline() {
    if (Token = "")
        return PintarOnline("")
    r := ""
    try r := Http("GET", ServerUrl . "/link/online", "", "", Token, 15)
    if (IsObject(r) && r.status = 200 && RegExMatch(r.text, """online""\s*:\s*(true|false)", x))
        return PintarOnline(x1 = "true" ? "on" : "off")
    PintarOnline("")
}

ConsultarOnlineAhora:
    ConsultarOnline()
return

; estado: "on" (green light, "Go offline"), "off" (red, "Go online"), "wait" or "" (grey).
PintarOnline(estado) {
    EstadoOnline := estado
    color := estado = "on" ? "3BA55C" : estado = "off" ? "ED4245" : "747F8D"
    texto := estado = "on" ? "Go offline" : estado = "wait" ? "..." : "Go online"
    GuiControl,, BtnOnline, %texto%
    LuzEnBoton(HBtnOnline, texto, color)
}

; Text + a small light right after it, the text centered in the button. The light is drawn at run time at
; the end of a transparent strip (text width + gap on both sides) centered over the text (image list, align
; center), so it lands just after the text on any screen scale.
LuzEnBoton(hB, texto, color) {
    static tok := 0, ilViejo := 0
    if (!tok) {
        VarSetCapacity(si, 24, 0), NumPut(1, si, 0, "UInt")
        DllCall("LoadLibrary", "Str", "gdiplus")
        DllCall("gdiplus\GdiplusStartup", "Ptr*", tok, "Ptr", &si, "Ptr", 0)
    }
    hf := DllCall("SendMessage", "Ptr", hB, "UInt", 0x31, "Ptr", 0, "Ptr", 0, "Ptr")
    hdc := DllCall("GetDC", "Ptr", hB, "Ptr")
    old := DllCall("SelectObject", "Ptr", hdc, "Ptr", hf, "Ptr")
    VarSetCapacity(sz, 8, 0)
    DllCall("GetTextExtentPoint32", "Ptr", hdc, "Str", texto, "Int", StrLen(texto), "Ptr", &sz)
    tw := NumGet(sz, 0, "Int"), th := NumGet(sz, 4, "Int")
    DllCall("SelectObject", "Ptr", hdc, "Ptr", old)
    DllCall("ReleaseDC", "Ptr", hB, "Ptr", hdc)
    d := Round(th * 0.62), gap := Round(d * 1.1)
    w := tw + 2 * (gap + d), h := d
    bmp := 0, g := 0
    DllCall("gdiplus\GdipCreateBitmapFromScan0", "Int", w, "Int", h, "Int", 0, "Int", 0x26200A, "Ptr", 0, "Ptr*", bmp)
    DllCall("gdiplus\GdipGetImageGraphicsContext", "Ptr", bmp, "Ptr*", g)
    DllCall("gdiplus\GdipSetSmoothingMode", "Ptr", g, "Int", 4)
    rgb := "0x" . color
    for _, capa in [[0x5A000000 | rgb, 0, d], [0xFF000000 | rgb, d * 0.18, d * 0.64], [0x96FFFFFF, d * 0.32, d * 0.2]] {
        br := 0
        DllCall("gdiplus\GdipCreateSolidFill", "UInt", capa[1], "Ptr*", br)
        DllCall("gdiplus\GdipFillEllipse", "Ptr", g, "Ptr", br, "Float", w - d + capa[2], "Float", capa[2], "Float", capa[3], "Float", capa[3])
        DllCall("gdiplus\GdipDeleteBrush", "Ptr", br)
    }
    DllCall("gdiplus\GdipDeleteGraphics", "Ptr", g)
    hIcon := 0
    DllCall("gdiplus\GdipCreateHICONFromBitmap", "Ptr", bmp, "Ptr*", hIcon)
    DllCall("gdiplus\GdipDisposeImage", "Ptr", bmp)
    il := DllCall("comctl32\ImageList_Create", "Int", w, "Int", h, "UInt", 0x21, "Int", 1, "Int", 0, "Ptr")
    DllCall("comctl32\ImageList_ReplaceIcon", "Ptr", il, "Int", -1, "Ptr", hIcon)
    DllCall("DestroyIcon", "Ptr", hIcon)
    VarSetCapacity(bil, A_PtrSize + 20, 0)
    NumPut(il, bil, 0, "Ptr")
    NumPut(4, bil, A_PtrSize + 16, "UInt")   ; BUTTON_IMAGELIST_ALIGN_CENTER
    SendMessage, 0x1602, 0, &bil,, ahk_id %hB%   ; BCM_SETIMAGELIST
    if (ilViejo)
        DllCall("comctl32\ImageList_Destroy", "Ptr", ilViejo)
    ilViejo := il
}

; (Ale 2026-11-10) Opens PTCGPB, presses Launch all Mumu, waits for MuMu and presses Start Bot (and Yes on
; its "Confirm Bot Settings" box). The buttons are pressed by their text in the PTCGPB window.
AbrirYArrancarPtcgpb(dirBot) {
    ; (Ale 2026-11-10) A 10 s countdown (shown over the PTCGPB window) before each button, and every click is
    ; checked in the PTCGPB log ("User action | ...") and retried: the first version clicked once while
    ; PTCGPB was still loading and nothing happened.
    log := dirBot . "\Logs\Log_PTCGPB.txt"
    Run, "%A_AhkPath%" "%dirBot%\PTCGPB.ahk", %dirBot%
    ventana := "Arturo's PTCGP BOT ahk_class AutoHotkeyGUI"
    WinWait, %ventana%,, 60
    if ErrorLevel {
        TrayTip, Monitor Link, The PTCGPB window did not open. Press Launch all Mumu and Start Bot yourself., 8, 2
        return
    }
    CuentaRegresiva(ventana, 10, "Launch all Mumu")
    if !ApretarBotonPtcgpb(ventana, "Launch all Mumu", log, "User action | Launch all MuMu") {
        AvisoArranque(ventana, "Could not press Launch all Mumu. Press it and Start Bot yourself.")
        return
    }
    ; (Ale 2026-11-11) Start Bot only once Android of the "Main" instance is up: with a fixed 45 s, a slow
    ; MuMu boot left Main.ahk without ADB ("cannot connect 127.0.0.1:...") and the Main never started.
    EsperarMainMuMu(ventana)
    CuentaRegresiva(ventana, 20, "Start Bot")
    if !ApretarBotonPtcgpb(ventana, "Start Bot", log, "User action | Start Bot", true) {
        AvisoArranque(ventana, "Could not press Start Bot. Press it yourself.")
        return
    }
    AvisoArranque(ventana, "Zenith Rise reroll started!")
}

; Waits (up to 3 min) until MuMuManager says Android of the instance named "Main" started. Without
; MuMuManager it just waits 45 s, like before.
EsperarMainMuMu(ventana) {
    manager := RutaMuMuManager()
    if (manager = "") {
        CuentaRegresiva(ventana, 25, "Start Bot")
        return
    }
    inicio := A_TickCount
    while (A_TickCount - inicio < 180000) {
        for _, i in InstanciasMuMu(InfoMuMu(manager))
            if (i.name = "Main" && i.on)
                return
        AvisoArranque(ventana, "waiting for MuMu Main to start (" . Round((A_TickCount - inicio) / 1000) . "s)...", 0)
        Sleep, 3000
    }
}

; Countdown in the PTCGPB window, under "CC BY-NC 4.0 international license" (also in the Monitor Link
; status). (Ale 2026-11-10) It writes into that text of the PTCGPB panel, so the user sees it right there.
CuentaRegresiva(ventana, segundos, boton) {
    Loop, %segundos% {
        AvisoArranque(ventana, boton . " in " . (segundos - A_Index + 1) . "s...", 0)
        Sleep, 1000
    }
}

AvisoArranque(ventana, texto, quitar := 6000) {
    global LicenciaPtcgpb
    GuiControl,, Status, % "Zenith Rise: " . texto
    if !LicenciaPtcgpb || !WinExist("ahk_id " . LicenciaPtcgpb)
        ControlGet, LicenciaPtcgpb, Hwnd,, CC BY-NC 4.0 international license, %ventana%
    if LicenciaPtcgpb {
        ControlMove,,,,, 48, ahk_id %LicenciaPtcgpb%
        ControlSetText,, % "CC BY-NC 4.0 international license`n`nZenith Rise: " . texto, ahk_id %LicenciaPtcgpb%
        RedibujarLicencia()
    } else {
        ; panel text not found: tooltip over the PTCGPB window, as before
        CoordMode, ToolTip, Screen
        WinGetPos, wx, wy, ww,, %ventana%
        if (wx = "")
            wx := A_ScreenWidth // 2 - 150, wy := 40, ww := 300
        ToolTip, % "Zenith Rise: " . texto, % wx + ww // 2 - 110, % wy + 40, 19
    }
    SetTimer, QuitarAvisoArranque, % quitar ? -quitar : "Off"
}

QuitarAvisoArranque:
    ToolTip,,,, 19
    if LicenciaPtcgpb && WinExist("ahk_id " . LicenciaPtcgpb)
        ControlSetText,, CC BY-NC 4.0 international license, ahk_id %LicenciaPtcgpb%
    RedibujarLicencia()
return

; The PTCGPB text has a transparent background: without repainting what is behind it, every new text was
; drawn over the old one and the countdown looked blurry (Ale 2026-11-11).
RedibujarLicencia() {
    global LicenciaPtcgpb
    if !LicenciaPtcgpb
        return
    padre := DllCall("GetParent", "Ptr", LicenciaPtcgpb, "Ptr")
    VarSetCapacity(r, 16, 0)
    DllCall("GetWindowRect", "Ptr", LicenciaPtcgpb, "Ptr", &r)
    DllCall("MapWindowPoints", "Ptr", 0, "Ptr", padre, "Ptr", &r, "UInt", 2)
    ; RDW_INVALIDATE | RDW_ERASE | RDW_ALLCHILDREN | RDW_UPDATENOW, only the text's area
    DllCall("RedrawWindow", "Ptr", padre, "Ptr", &r, "Ptr", 0, "UInt", 0x185)
}

; Presses a PTCGPB button by its text and waits for PTCGPB to write it in its log; up to 3 tries.
; Start Bot also asks "Confirm Bot Settings" (Yes) before it is logged.
ApretarBotonPtcgpb(ventana, texto, log, marca, confirmar := false) {
    FileGetSize, desde, %log%
    Loop, 3 {
        WinWait, %ventana%,, 10
        ControlClick, %texto%, %ventana%,,,, NA
        if ErrorLevel {
            ControlGet, h, Hwnd,, %texto%, %ventana%
            if h
                PostMessage, 0xF5, 0, 0,, ahk_id %h%   ; BM_CLICK
        }
        Loop, 20 {
            Sleep, 500
            if (confirmar && WinExist("Confirm Bot Settings ahk_class #32770"))
                ControlClick, Button1, Confirm Bot Settings ahk_class #32770
            f := FileOpen(log, "r")
            if IsObject(f) {
                f.Seek(desde + 0)
                nuevo := f.Read()
                f.Close()
                if InStr(nuevo, marca)
                    return true
            }
        }
    }
    return false
}

; (Ale 2026-11-10) All the XMLs in Accounts\Saved\1 (the other numbered folders are the instances of the
; PTCGPB bot and stay, empty). Banned accounts go to Accounts\Banned instead. A name that is already in
; 1 is left where it is. Nothing is moved while PTCGPB is open (it is using the files).
OrdenarXmlCarpeta1() {
    if (CarpetaJson = "" || PtcgpbAbierto())
        return
    saved := CarpetaPadre(CarpetaPadre(CarpetaJson)) . "\Saved"
    destino := saved . "\1"
    if !FileExist(saved)
        return
    FileCreateDir, %destino%
    ; banned first (same as Banned: open folder, without opening Explorer)
    ban := CarpetaBaneadas()
    for f, a in ArchivosBaneados() {
        FileCreateDir, %ban%
        base := RegExReplace(f, "i)\.xml$", "")
        if (a.xml != "" && !InStr(a.xml, ban . "\"))
            FileMove, % a.xml, % ban . "\" . base . ".xml", 1
        if (a.json != "" && !InStr(a.json, ban . "\"))
            FileMove, % a.json, % ban . "\" . base . ".json", 1
    }
    movidas := 0
    Loop, Files, %saved%\*.xml, R
    {
        if (A_LoopFileDir = destino)
            continue
        rel := SubStr(A_LoopFileDir, StrLen(saved) + 2)   ; "" (loose), "2", "10", "tmp", ...
        if (rel != "" && !RegExMatch(rel, "^\d+$"))
            continue   ; only the numbered instance folders and loose files; never tmp or others
        if FileExist(destino . "\" . A_LoopFileName)
            continue
        FileMove, %A_LoopFileFullPath%, %destino%\%A_LoopFileName%
        movidas += !ErrorLevel
    }
    if (movidas) {
        IndiceXml := "", BanLocales := ""
        TrayTip, Monitor Link, % movidas . " account(s) moved to Saved\1", 5, 1
    }
}

; Settings.ini of the PTCGPB bot: next to Monitor Link, or above the chosen accounts folder.
BuscarSettingsPtcgpb() {
    if FileExist(A_ScriptDir . "\Settings.ini") && FileExist(A_ScriptDir . "\PTCGPB.ahk")
        return A_ScriptDir . "\Settings.ini"
    dir := Ruta
    Loop, 5 {
        if (dir = "")
            break
        if FileExist(dir . "\Settings.ini") && FileExist(dir . "\PTCGPB.ahk")
            return dir . "\Settings.ini"
        SplitPath, dir,, padre
        if (padre = dir)
            break
        dir := padre
    }
    return ""
}

PtcgpbAbierto() {
    for p in ComObjGet("winmgmts:").ExecQuery("SELECT CommandLine FROM Win32_Process WHERE Name LIKE 'AutoHotkey%'")
        if InStr(p.CommandLine, "PTCGPB.ahk")
            return true
    return false
}

; ---------------------------------------------------------------- linking (/link)
Vincular:
    if (Token != "" && !Cambiando) {
        Cambiando := true
        MostrarVinculo(false)
        GuiControl, Focus, Clave
        return
    }
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
    Cambiando := false
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
    if (MiMain != "")
        EnviarMain()
    SetTimer, Ping, 60000
    SetTimer, ResumenPeriodico, 600000
    SetTimer, RevisarTrabajos, 300
    SetTimer, RevisarTrabajosEspejos, 500
    SetTimer, VigilarOfflineMain, 60000
}

NoVinculado() {
    SetTimer, Ping, Off
    SetTimer, ResumenPeriodico, Off
    SetTimer, RevisarTrabajos, Off
    Token := "", JobsReq := "", EnLinea := false, Cambiando := false
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
    if (MiMain != "")
        EnviarMain()
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
    OrdenarXmlCarpeta1()
    huella := Huella()
    if (!forzar && folderError = "" && huella = UltimaHuella)
        return
    total := 0
    Loop, Files, %CarpetaJson%\*.json
        total++
    GuiControl,, Status, Reading accounts 0`%
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
            GuiControl,, Status, % "Reading accounts " . pct . "% (" . A_Index . "/" . total . ")"
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
    GuiControl,, Status, % "Sending summary (" . cuentas . ")..."
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
        GuiControl,, Status, Sending to other hosts...
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
    LeerBaneadas(r.text)
    ; Main registered in Dragonite (or My Main ID): to notice Offline from Dragonite's button.
    MainDragonite := RegExMatch(r.text, """main""\s*:\s*""(\d{16})""", mmd) ? mmd1 : ""
    ; The address book (Upstash) can move to a new database: the bot sends the current one and it's kept.
    if (RegExMatch(r.text, """lib""\s*:\s*\{\s*""u""\s*:\s*""(https://[^""]+)""\s*,\s*""t""\s*:\s*""([^""]+)""", mlib)
        && (mlib1 != LibUrl || mlib2 != LibToken)) {
        LibUrl := mlib1, LibToken := mlib2, LibUltima := ""
        GuardarConfig()
    }
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
        if (MiMain != "")
            EnviarMain()
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
    global LibUltima
    EnLinea := false
    ; 2026-11-09: without a limit every Monitor Link that couldn't reach the bot asked the address book
    ; every 5 s (~17,000 times a day each) and used up the month of Upstash in 9 days. Now once every 2 min.
    if (LibUrl != "" && LibToken != "" && (LibUltima = "" || A_TickCount - LibUltima >= 120000)) {
        LibUltima := A_TickCount
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
    if (UltimaVersionAhk != ma1) {   ; shown in the main window: up to date or updating
        UltimaVersionAhk := ma1
        PintarEstado()
    }
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
    ; (Ale 2026-11-07) An account with fewer than 96 packs IN TOTAL is not eligible either: it needs to reach 96.
    if RegExMatch(t, """packCount""\s*:\s*(\d+)", mpc) && (mpc1 + 0 < 96) {
        sobres := mpc1 + 0
        return 96 - sobres
    }
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
