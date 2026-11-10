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

global VERSION := "ahk-1.9.23"
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
global CompGP := "", Comp96 := ""   ; shared accounts for the GP farm (eligible) / the 96P pack farm (locked)
global Amigos := ""   ; Discord IDs (comma separated) of friends who can use this member's accounts in the bot
global MiMain := ""   ; this member's own Main friend ID (16 digits): Share/Trade destination in the bot
global Status, Info, Clave, TxtCarpeta, TxtResumen, TxtBan, TxtGP, TxtProx, TxtVer, TxtUser, TxtError, BtnLink, Inicio, LinkBox, LinkTxt, LVCuentas, Barra, BtnMain
global Cambiando := false   ; linked PC: the key box shows ***** until Change is pressed

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
    IniRead, MiMain, %CFG%, main, id, %A_Space%
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
    Caja(12, 234, 250, 122, "Banned accounts", "ED4245")
    Gui, Font, s8 Norm cDCDDDE, Segoe UI
    Gui, Add, Text, x24 y254 w226 h16 vTxtBan, None on this PC
    Gui, Font, s9 Norm cBlack, Segoe UI
    Gui, Add, Button, x24 y276 w110 h28 gAbrirBaneadas vBtnBanAbrir Disabled, Open folder
    Gui, Add, Button, x140 y276 w110 h28 gBorrarBaneadas vBtnBanBorrar Disabled, Delete XML && JSON
    ; ---- column 2: GP farm, proxies, Discord
    Caja(274, 8, 250, 124, "GP farm (reroll)", "FAA61A")
    Gui, Font, s8 Norm cDCDDDE, Segoe UI
    Gui, Add, Text, x286 y28 w226 h62 vTxtGP,
    Gui, Font, s9 Norm cBlack, Segoe UI
    Gui, Add, Button, x286 y96 w226 h26 gCompartirCuentas, Share accounts for reroll
    Caja(274, 140, 250, 82, "Proxies", "B47CF5")
    Gui, Font, s8 Norm cDCDDDE, Segoe UI
    Gui, Add, Text, x286 y160 w226 h16 vTxtProx, Not sharing proxies
    Gui, Font, s9 Norm cBlack, Segoe UI
    Gui, Add, Button, x286 y182 w110 h28 gCompartirProxies, Share proxies
    Gui, Add, Button, x402 y182 w110 h28 gDejarProxies, Stop sharing
    Caja(274, 230, 250, 126, "Discord", "00B0F4")
    Gui, Font, s9 Norm cBlack, Segoe UI
    Gui, Add, Button, x286 y250 w226 h26 gRegistrarMain vBtnMain, % TextoMain()
    Gui, Add, Button, x286 y280 w226 h26 gElegirAmigos, Friends who can use my accounts
    ; ---- column 3: who, status and the main buttons
    Caja(536, 8, 220, 348, "", "FFFFFF")
    logo := LogoMonitorLink()
    if (logo != "")
        Gui, Add, Picture, x606 y14 w80 h80, %logo%
    Gui, Font, s14 Bold cFFFFFF, Segoe UI
    Gui, Add, Text, x546 y96 w200 Center, MONITOR LINK
    Gui, Font, s8 Norm cB9BBBE, Segoe UI
    Gui, Add, Text, x546 y122 w200 Center vTxtVer,
    Gui, Add, Text, x546 y138 w200 Center vTxtUser,
    Gui, Font, s10 Bold cFFFFFF, Segoe UI
    Gui, Add, Text, x546 y156 w200 h32 Center vStatus, ...
    ; Progress while reading/sending the accounts (600+ accounts take a while; without it the window
    ; looked frozen and Windows said "Not responding").
    Gui, Add, Progress, x556 y188 w180 h8 c3BA55C Background2B2D31 vBarra Hidden, 0
    Gui, Font, s9 Bold cBlack, Segoe UI
    Gui, Add, Button, x556 y204 w180 h36 gSyncRerollZenith, Sync reroll for Zenith Rise
    Gui, Font, s10 Bold cBlack, Segoe UI
    Gui, Add, Button, x556 y246 w180 h32 gSincronizar, Sync now
    Gui, Add, Button, x556 y284 w180 h32 gOcultar, Hide
    Gui, Font, s9 Norm cDCDDDE, Segoe UI
    Gui, Add, Checkbox, x560 y326 w180 -Theme vInicio gCambiarInicio, Start with Windows
    GuiControl,, Inicio, % FileExist(A_Startup . "\Monitor Link.lnk") ? 1 : 0
    ; ---- last error (only shows when there is one)
    Gui, Font, s8 Norm cED4245, Segoe UI
    Gui, Add, Text, x12 y362 w744 h30 vTxtError,
    Gui, Font, s9 Norm cBlack, Segoe UI
    Gui, Show, w768 h392, Monitor Link
}

; (Ale 2026-11-10) Logo of the window (Zekrom), inside this file so it shows with only the .ahk downloaded.
; Written once to %APPDATA%\MonitorLink\logo-v1.png.
LogoMonitorLink() {
    ruta := A_AppData . "\MonitorLink\logo-v1.png"
    if FileExist(ruta)
        return ruta
    b64 := ""
    b64 .= "iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAMAAAD04JH5AAADAFBMVEUoLUkXGjAiov4p//8pNFooL1EoLUwYFiIpNVwh/v4SExwvNWwiKUwZiv4qMFwiKEYoMWQdIz4adf4kKVMm/Pwg+P0uNl0rM1UdHzgsNlkfI4IfI0QTGCoXGz8XHTYtNmcrNGAaGSkgKnEnMFYf"
    b64 .= "OXcrOGMagv4gOHAgIkw5YcgtOmsjLHgRFCMrLk4wNWMaKFUtQX4hhf46Zs4q3v1AacYjLoIZ/v1NjO8dMWYwVbMgK1soTqYce/0g8Pww5P0Zgvgksf4uOHQjPH4ZIEU2W7wwWLkwS5UxOno+aMFIl/Uacvsij/4jLosZJ0wuR44lRZdLm/g0NnApUrUxRYYxQXcxuf0m"
    b64 .= "MG0xxP4gtvY8Y9kvz/0zUaYdo/cbkfxDdNYwSp4s9P1NkvUy/f0nx/stiv0vPY06eO0iSXtHed8h5Pk6Xc8lePcvUqwo6vwkQYohTZ8jK2I8aOgaLV8wg/IdmP49hPc0rvojqP0yW8IYmvIerPRBkPsm2Pk5cdgUJUArmvk2V7EpX8s7V6dDb84gLK0ZHU4rZdcyPIMz"
    b64 .= "UZ8ewPYZjfM4d+Q8X7QtTK8ZdPUqk+w8YL0vbOEz3PUmgt4jOdJUjvE3ZfoxP28haKtLtv1Eg+hANnooPXFMHz437vw4oPcODBIYNW0iOLkeJZci0PcoovAhcOgePJIhQ6skMaAyvvEkb7xIp/snxM0VgfA2zfQqoa0s8/IZH2EkgpceZ3YqltUZ2/MUNEcgd4gWSJEm"
    b64 .= "Pugv4uM2QZhOhN4rqblVrPsbVmcjW+kldMweuOpiouklk6Bszft43/4r0dkazO8aOFwRPIBfIkUrucFMOYVF1vhx1/4ZRFUqjcFevPQzwd0zGi8cRmo/+fksrNk+oecdYZAkhq82VIBNN29tQp6DRJlaPo8kR8FT9/Q5Rqo5gtn57kw6RXhz9/fc/vxZLF3A/PtUf8NG"
    b64 .= "Zp1Dqs9uPITWOEP7PUdUXc1UUK82IUVLc6uCR7SuL0SS+fjXeUiBHTdZOX6D4P+MPn6DM2HRr0k8U+TRehStAAAACXBIWXMAAA7DAAAOwwHHb6hkAAAgAElEQVR42n17CVyTV9Z3IiRAiIQYyEJCEggIhEAQRCEBAoStSEB2ZBfEiqyCIJvssiog6IiWgiA7IiCudd9a"
    b64 .= "lzrWpe52n87b6TJvO53OvDPvfL/v3Ps8QTvf9DtWECv8//ecc88959xzKW5IIlPC3J2QrO6JbHVLMC9WqbwCAlNWO/XU1+fn1/e4b1m7pWl1WNOF/fvXri3NW4EkPKgRpL6xvmFvV9f4V+XxIOXlR78KXn1hy5Yt6elNq1enN9prHTn04qlmTxqdwqfQKVjoNB7PUGAI"
    b64 .= "YmxoSAH4QGDQuNodxMm9qT4kJzABCKhUAY3uTT3q/HrvoNXpazfuh19YSrtWEAQaGhuDWsbHx8PhC586hB+fmJg9XQ40ur9CFNKb3LRMmQstZyqBTnHhs+iYgIsLj0ejAwmBwFiACAQGYh3Up6fv3JmevmVLT0qIG1IBEHDasto73zvIacv+9YD81saNZaXk8pGMNyBs"
    b64 .= "Hyxp5fGJyR65BZm+BQUeycmJz7YgLUSyDO2NaXQaje7iwuaTywd4FzqhB9CEgBISiSgEFoahbzl06NDatek9KaCEhAC3kPzVq3uCepxgLYcAH2QTWnl4+IquPLRs9HuFz8qVK9Oqsj2Sp+fm5h49nZ6evgZS/mzt2rVtKqmDnZ25DBbtwiLxKS48Fzod6wJ9otEoYT27"
    b64 .= "2woDC3enYwKdm/OqN15wqg9pDXTLCcnISKnfvXrLlp1bDq1fD/jrV/n4HKtMquzSlNcBDeCC8Jents89evDcYeDx49u3+6+dArl169a1a09fLD6/Y2fn4MVzoQC+C6kBWD7pC4gCjQKLDOtJqW/auXPnlvTOzeHhXXnVa9O9MyIjI4EAMGhau3EjwK9ff/Rotcbn2C0L"
    b64 .= "g8yqY5XxaRrNMY1Gs3L58qpT0/23dUyaTMbj2Z3t912zJCYP7gC+SmgtZLNdXPSwrwV5AphgMjgMPHAnls7Nm8tKu8r2b9npvhq5ZfqFtVj3b60/eunokGalpt3AxMLA4lZHx7Jl5eXxqWlpaZW5vS+E4FFce66xw9mzZ28Bsu+pW7OzN2dfnL1jV6KzVoX0xLJdKP9B"
    b64 .= "6DRDCk02MRmEtwDisOXQ2o3VpeOlZeNdm8vCu6ph5UvwHZpVPsc8gICFhUFBe2XaDth2qWkd1wweKXn2xlwuV4Dw+0+dAu2fnLmDxMHL0bokJCw9/TcI0HiIQOBkjBPAN2ENHNpYVlZWmleaF56Xl7cJoyP8o0c7NJqOY10+qYMGIBYmBrntlVXto9lVSQVZJyhcYxCu"
    b64 .= "wP7OnaKT167VzN27VHQHVu/F4etiwyAgNA2w6f9RAQIgQDN0KNytJ7Bl7VvVZWWbfMDB8jZtqsaeB/BDQ0erOjTxc0kdx2oMMAMLE4vcXIssv8GFhUUhzxgT4NFePpjzK/C7d/BSP+APc4S1Az0AvzosTMb6TQJxUhpNFovQ9+7ceQhZvLo6D9w7vMsnr7R6PbhfdXWH"
    b64 .= "ZlNd+XbNsdRkv5pMCwMDExP8O+vc3cUTl+8zeYaYgCvrzL17vfcOHry0Pmy4EIzPL2mE8IkINLL+owegkEjpaYS4Y96YvrNz7yHC4QDfB22yFZuqy6rBIbqnk46Fa7p8ND4rusYWwANMTCz87j38fv7EfSbyfWNSuLqLD04evHTpra+aHpd46ay1b69uCsP4Yb/lgygg"
    b64 .= "9IQBQbfIdBSDiFi7sQyHGTBCaXl8XV2SX1ZWTVVlKpZrsMlMDAa//+6lXKZKMAPPQ9CGOK7zbj96dunS2q+a0ht1yl3WDrsBGeHDPh9g/UcCiAIlbHVTU1NYY9ghLGuBxNr9G/NQOCjL6+qo8fPLNLDIysrKzMoCw1uarDGxOHfxMlOVkPPll+dN7UGkhgIQroBLu3zv"
    b64 .= "2YV0JAPW1rpItHIEvxpCnYpC/00Cq5vQqbG6YifGx9tu41pQQl5Z9cayrmNJvVkGgI9sjtaeeRMUz7GN+LI+I1Zuby+XB4TKBTQmE/0w8ZnpnRi/SWltt5vQPpygQKBRR6H8JoGmJvxN7g0th9YSew5RqC4tLd1UvUnjo+lI6oXVW6C4tnDzxmWZ0mqqeSonQMKVSuQB"
    b64 .= "AaEghmwWk8ViMmvnnxE/K72RdD6EfyFsd0+I8DfxIRSnp+NjoKLi0Mb160kK4PrrhzbhWKvpGq/0NQG/Ozd/wpxjZj+1r9nTVCJ1lZiaEvgB5mAALsRB5vcEATBp02oCHrQQtnv37ljhb1kAQnFYOj4ED0HMJYLuW8gKEPouHRzSVCYlJfdeu2WZOXhz8bHKPDouIMHT"
    b64 .= "M8DUVIL/IxhIJPZcHp3Fqn358CuMvmT7MLA+Fjch7TcUAMfxBXA8JMj9CQ3g6HPp4KWD5TsgzEHczbr34LHMzFUeYBoQHQ24+AMWIBAgpTF1t0+cuXH34aVDO9Haw8LIzQfw9Shr2j3A/s8EKHCEUAj4/fvB87DuidB39CBIUlJSroVF1rkbj1XFgI0ho1+jkwRkj2/M"
    b64 .= "nvPzg/i3vnQzRifx0dob2/6/BNBZoCeAdLD+LYi5R98awvAHD07XZGYN3ls8zaDJ9YjRSEzRL/xVaGtr8du9BcnxQ0hpQIBAd98Z1oO139hY0dJS0fObBJAPYHiCBGy+FXlHDx7tHsL4c4Ow9e+9PMxg6/Gj3wEJJVUgkUiiTVUJJfPJz7D11q8vy8MaWL2zVDPujgjU"
    b64 .= "e7dASOvKi2JzfmsbEASAwX5khTyflZq6g6T0ZsKZY3BXwaaaBbyBD2IaDeCurlyaIychJ2A2cT9Cr4ONm5eHCOxdtXz58lKnnt2NQePoTOlaWWRN/y0CLpS9mzeuJWVjtUazfDtkGgcPlsdnW6BTd+E+gyomfB50j9B/DxIN25DLrFWFnj9/3u5mOSy/ehUkR5q8PO/I"
    b64 .= "/M5VK1etXJkXtruxYhwF9L2b1/X/NgE65cqVzRv3YytsXH9paB3a+UDCPwkduxZZi4eNGCy85UxJ/M8+++wdiANSGicgB/Cdn/cC/CYNpKbjDTPdJ2fGAX2lRtPSWN/SRZwo3ckXrf/tKKC/8acrV67s3YzXv/7Sw4PrNOi7NZrUJA/QgMG5WoaRDdf0NT7WQLSpXCI1"
    b64 .= "b0XwDouPyoeqSxH+yvGrY0mpacvRHzXjQbv34hNtRVdHtsGsjv7/HIJLTK5cadmLQ0HZ+NGPjmpWwqFfdcxH4z8IqZ/BmcM2DL4eHykfaeCdd8ANEX7r8OJND/8dQxqMD+npcmQHjc9Kn64Gp73E+rsqayxNzt3+1WFEd0GFAs7K6WJK6fqH73/0/vsPH1569v5H3StX"
    b64 .= "Vg1Czll5rDITzv2F0wwjBgVvPYT/2WeffPLJXz95B+1ESU6O8/ObmaNj5dnZOzS4OMGq60htrwTPGx/vCsfw7R6WlpaZl38Vi6E0ggiEyhIXMZ/y0UcAD/LRBx+Vd8NSklDKgdItIHCXYWQk4kaTCgD4v4J88o4pCgPn++8u5FbV7aiazk5uT61KwtKeXeNXUNMRThZv"
    b64 .= "mqSCTEtLX0uDM3yXX+HT4ABlMjkcFpVOuf6+ngChysoCnPNA8gvfBy7I52IXfOedf/zww6cgn3z2jlwuN0944WvZfit7bGzZDv/4aQ+oyXx9LeE7LeFzTSVa/grQPnwJCvA1uPEGAahMWEIoFPhsNlvMh7pgN1AALXzwsANbsgp0v8Zg/kwm0hzaA1w4+STR77z65t0P"
    b64 .= "P/zw3Xf/8hcWXWDPU83WVI3lrgEd1C3r/mo6NxfwTTA8SEH7sa7wY0kFFpYIPtPX4CL/TRcUsh1l5qGxbtHRYjaPEhkS0vjt9YcP3x/S4P2TjLb/rFh008Ai8zKYgMaVSl1dTQGfkI9tjIxs+DaXe8fq6q5Zrskdqyuvq56uQXqzJPF9fTNzs5NqMDy2wOxlvtDlNQHr"
    b64 .= "2J9+Wr25uvPHz/iQqq0ODomNjGxrbMgD+JWaqtHeTJNzpxmMG1kWWfdhEwqkkG66vvoLif8u4IMcvl+Tuqyu/ZTlGo9yqMbH/LJQqo4JIGOANkwsSVmzcOM0iy2E+lSMc2MXuuNPPzaVbtq06UcZH+q10kONsSDq8ZVIA6l+foOZFicYfMb9LJOsEygKSI2lEte/fIwW"
    b64 .= "/zH8Z4PF6PSt1LplHr6n1qypSSqf9rMgqwUL39zc3AJfPTgoweDcCagLoTYV8gl8F77rjzs3IWkUUxCB0rCQInXFOCqzl3ckDw5mGswrbPhGYIMsMIGNzFga/UqP/y6BT7UxEj8FEyT5QpJseSo3y4DAz/K4lp09mltg+VoMbj5m02hsvgtRH0PiwuY0dmL8Mgc+NCqA"
    b64 .= "QOl4V1eXDyLQMf0ECJw7bQR6ZsxnzYMLGNFe/fAptv/HH7/64Ydv+DZUKhU0wDgxVLdsaNQE5YqEGBhk1bSP1nhkwh4yeY1/H5TvwoaUFWIRwLFd3/lpM8bf1G+N/oKSlwdVSDiKIuAAg4CfdUIhBgKHz9ysRdZ+9ddPvyHc/xWEoU9c+SIgAPzE/Tt2lJfnriEYwEeD"
    b64 .= "zFujBSZrIIBCAklSMDl3X8iDuCdksVk4BRVyfvqRxL+qY+OQjFse4Wj9mkqPzMxMg1kRlY8QTt9n2BjZvPvDpx8iefebV7//5LPPfh8qZ1FFNkYKNsu6H9xv2pfQAHxEwQv+YIKrZwtUwFmaLDwWQtChubgIWWj9NJqjuR6/dJiPFUAhqjAgoOlIBnxLg0URh4qWzgAD"
    b64 .= "2Lz74b9++eV/gMAP//j9J68+5jON5XJDtojqwmEiBtOjBUsmeC0GC3cv3z8xf84g64w1wgcCKPS7uNBkwsgyAr/TQUzWi5BFQKMFEagatMjMtDh3e5fWiBAbm48//PB//vzfv3z4zac//OOnv/6FQRWJar1M7TmGrlIOFAL9fiaWiIAFCUx8yrp7WaRQMBSnFy+eptOW"
    b64 .= "CLjQeDKOkvD/TX3DsCeI86Gs1AfjQxD2QxZYtOYYLRF4F+H/9y/ffPrpP37/408MBfLAqEJ0GhubyTgs63m9ExqQ+wBS6NnLInATKlWkYIj4NFJg9dAU4whvz/Qh/Bkd0j9JIA/32sAC2YMFBRbnTjuKGXoCH3/4P3//wx/+/uf//fSHVz/92MrGBIrGC7lSM44ZF84S"
    b64 .= "3eJNC2T2JQIG586IFVQxIoBcVSGmLYmMxmJTxbW31Z1fhdQi/1sigE7SVZVJNYOZmYNgNUej1/gf/vIHkL//76evfv+T83fXvxbxxdSJFS2BsHwZ14xDZwpPn5gFCmssiEiUNX9aRMJTUcBQLKkATkC22FrIpNPFWqU1C0yjb1pBCwBkffzgk8FHFy/erS22plJJAu9i"
    b64 .= "BQCBT/8RHdpY8vOlr0VarVgb41NE43A4XK6MQ5e5sGsv37hpgaOgycIJkegNeBsbEWUJnykWs0ANZoZMNpuJrUIS2IL6UpCOfX/mtm5X/wmqSiymEvH+43fBARD+v75xVX13Pe7n69B00Oqs7bpiAJ9jDAQ4TI6MaS1CHLKge3ZDQYCLRLBTUcC2IQnA8hGqzNBQJqMx"
    b64 .= "SbcgCUB1DC3ob92U1ta7br+oFVvz+WIb0gLggH//w//530/+oqB99+3t734WC4GATlmkBmiOIdgAC43OplJrT8xmZZ1RiGGfiPQuDEIB3wd8prWQZmhmBm0MM0M9vD4vXN20Zf+3sUqlbcTUkZgHCq2Wb80nCfzy3yB//tenLozD313/9uV9JlurLXZWCgOLmEgDUini"
    b64 .= "wZFBii5jskXiEzcXFeD7CoUREUZAFOARcBRoWTLUQzFDImP+av2ggfSmEJ0y9nwzyOcPFMd3iUkCRh//8meQf336inH48Mvrl362ZjN1tZ7NSlUREGByzM2lhhxHR8CHX1JjDpt6GlJIEl2hQFsRrAmERGwWDzo4xgQBZA9EYClBaWpUiW8XOns2Nx9pHnkgOn7c2pow"
    b64 .= "gZELSoK+efXNYRDe9Z/BhTm6WmfnksCYKBaHqTI3dzXjODK5riAyZkC0uZmjtQgvG8D5QkcsQiFySorAEDfSsAaI5vnrJHWgVhU3MeVsO9V85MjIydpdegIKvitOhrkiNo3NoH+nFYK6dTovL7vCmELIKM1AA+AEBAFXlTn0CqLNOWygYEOiK48fVzo6amHnIga4mQVu"
    b64 .= "gAm8LgwolFr7t9+eaHa2PTJyJKL55Gnr49bwHYiADPpPUlfOS9XP1y98e0BM4OtsJ6KiYgLBB4oxAZlQhvBNTYsDkES78hlGfGLxSitY0pEjthyh2EZEJ5pp4IY8ltDlVwQG3gYCU562R5ojEAEqSUDBhlxQKuUMXPf67vr1l7Wgf45SpyuZGpksikkAMuaIAFPGcuQw"
    b64 .= "BUsEQmUKG7FQTwDhW9k6CtlUEVvfzZOZyfhsCv0NCm+TBCKmPCOa++6LSAJUHliMy3O9cJ323fWX1FqUxSuVyoh9I5PqomJEIMHc3IxJZzK5LJ6raUICtCrkARKRgk3iOwq1sLF37YKPfCBA9BON7ePc3ORKraGMRqSHbxCwAg7NV99m7BJT+VQjBUUAPsPls+O+Y798"
    b64 .= "KWILCQJ2k/sm1YUOKACYm5pLpUxgwKXRwAcCWnNCTe35Ir5Q737WSLTAAKKnWAYEpFJ7t5AUb+/6lMCQyMhYNzdD5AyYQCEQcHa29Wy++vww3j0KPniNIZelePnyJQ0YsYWIgdIrat++qCgv4OLCMYcKGREQgiFczWShOedzQmki9C8xvhbB7yJFzLRH8BK3tnzv4OCK"
    b64 .= "4PyoqCi1+85GHpzRmEBghKctMHBubnjOsEGniYgCChO4KA5/e/1bmYjPZ2uFOqWyOHDyvc8LA5VC8GOOq7nUHpICOqu4lSPlmLW25rTKxbB+Al+/fLCaUmfNBnVCT3UgxDs4KCgoOL/oat9M8IYNKbAjZJiAna0tJnDk83504orFiICAy4cAdEHJAAWgdSlLAkf2vTdl"
    b64 .= "56BjQzLCge6cvT2HRWcWnzeXcSStIDIRsX5kfTg1dilVqpJilVKn5drbS6CpGuldARKsLurbsWNHd9/VEEc4FTEBB1vMALbiA5ERHGRUEc3YUMAzOnyYZcywgWgKP5gD+O+9t89u2EvLRoWlBDq19jKwQfGXrUoz6FaFmooZ2AO05OJLvLy8SopLlDqvOLl8YMCtrT4I"
    b64 .= "8L0RfuqyZUBhxsErLg4RCLQlCUQ0xyzio8SGhywAIfgwg0rli5ELeBXC+vdNOQx7WWMCrhKCAE11/rzSHPBVtXyGAhgQq9+lLB4e9kIUlCXk5Wx9sH79y7AAhavBwRS9BRAB5+YjTy8qjGwYVIidAgrCRxaBn6pF+PtGJjzhJ4r5qLY2C7B3lciYLJlZ6JfQL40uFtIF"
    b64 .= "FIWCzybVj9YP/xgkMBZqv8gUZP/gmKKikyQ+orCsrk9PADwACEw1TzydFxkhAgIBC/ChNEIW0BZj/EKHktteKhEi4KgKgNaRGZOpCkjIaJVIuUw6NO1pVHT+ifnWu1QYfzgwJCMlIyQEEaj3DvbOjyrqW/Yr2QEEAodtE5wJJUDksjp5UcSg8gQ8rvDwYWQN5JTMwOZ9"
    b64 .= "+ybthh/fVhbrqNAZZ8FpGBqACBSfd86RyAQ8Fg+0xuWiqsGGaq3ycggsDGmr3x0U5J1RaOcwMAAq8FZH9XcvS/01A6QBL3ITJBQrd9lGWD24e5rKovFgE6DKAOWhtXbN+0aibB+/mHnw4nkxwncEL2gNlbjSWAlfnpehtbPQiSflugIFsdItox5vOFizOiqqMNAuQQlX"
    b64 .= "elFFM2P/jo8IDDigXQDoWhFDAQSsZh6dEPNZxvexAhCBkonmKc/hG08bRmZ6Z5WIAIsgAE5g+mUOOCUNuhZw4EEvQ37A3q2xx6kiOAZJftREVIYapLDwZF/f2I5l/y51BAEHcw5fgY5yjnMEMCh6tMiinl5E+ZWRyIaqjJiK8Ho+e60BtuHJ3jNaZAGmI6e1VS6RcUzP"
    b64 .= "J9AhGLLR1ZkU9rurxC0lyKkiJmYP/FJPRKn3IInZc7Z7x5vw3XXQX6iDFjMQcHAYkIkVOJVwTHD2jAAKEzMX52/cPG29yxoOc61zhPOdF4/69r0HMnLtppcj01HIdHQMaA2AVCigVSWQR7uCBaCPYQ/haaAtyAkRQBKl9sbwSBfdby78K28nuJfZuH//fkRAylagQtBI"
    b64 .= "sQv8ADOIsIqa6X+w+PZtJURyW9uSM4+qGjD+eyP9vYtaJkskZjqat5q6ukpCzZlc4wApUwDrhxayPADhOzkhC3ir9yD8fExAjdwvdawc+0Bfym7IhLFQ3n6sExGlEEPrGeGckGCLKExNwYaYOPt88cTj27suX5wmlo8IRJy8eVsIjPlM89YAiSQggCkTGMvNIONA4VYe"
    b64 .= "kNFTgQhUBAcHq9XeMTHBQd7wCb5AGhh7+NHDvr7unY2Nevz9FLmYQZZiYrC/J8HAM+LIFOJwZKKo/8WLp91X9iECI5MQC5qLbs3Xwl5jsAIg/AWEqjhcgbE9B64v4Q5NPhCJ1+/kDgRiALhiwwanerWaJJB68IMPPrheX9/YllHfROCvpZDLN2KIigE/IsKZ2JLAYaoZ"
    b64 .= "y+f7sLz3+WQhRKOR5iMPZmuVXnyFCJqlcAAwkfcLYFYD4ctj82H9aBalIiZYvSdm67ZtGzYEpajzgcAYNDKn733wwT8f/twWEpkTlb9l/9rOlnGKHl9R7IkJeHo6IwaeJIOpkRGMPzIZFRk74Dky0nxyvtZm2JMPTeTQnJxQDs64eUwpXj/aAMQwTEXMHnUwxt/qnQJZ"
    b64 .= "QEx/Ujt0Uq89fP/h+9/mYKlPb7kSHk4hK1GGEkEDMHzCcQmM0Nw8csRzYmqqeWRkCv7abcBePgX4kPh62UKapdDChQ1HgHItGROvP64xuAcUsGGDOxBQ73FC+Bsq8vPzg4P29I+BD1bNPfsqvSeqv78tpzUnpmUcLmhJAgxrWDNkeQkJSAlYB4QJjqA9MQF/F4DuaFw9"
    b64 .= "H9w9o7BhONvy+dAB0Jqb41zPWKYzg49esfne3rDYCvcNmMAGJFudguAvvYsevH+w/ODDZyAnH/S39b/oL2oJDz82OkoQYFATANbczEwqxQxINzh+/MgEIgD/D8FLJF4vLt69zLBhRCACkLcwXQXExbmxuSTALYXwPyc4dp2cgtQVGH/rVkQgv+j7Dz766IPrcEl54UIT"
    b64 .= "io9t/X2aY+2zNylEHacCmyegwsXQ3BnrACKCUsRwRL6AJAB2nFSqvHH37pldNjYMKys2EKCKDcmbe3v5gQNxkT3I+CAbtjV4u1eo3Ql8p2BvdCJc/wD68WjGCk8YNfVEXa1LHXswEUUQYDvrCQCDBNiOEc4qqkIhLgZN2AUGBgYkSCTmUvPF2dlFq+N8m8PWVo58MZ9K"
    b64 .= "kxriZFuKIoBbvROGd3ff9rttwU7B+e4Yn1CAuu192IEfXd+il519daUNRTkZKYgAQwzLxhbADMzACs6OCoaRyLEYgOVyU3AOKVQBz2dnbxy30vKNDit2AQExn2tPKgD+0UBGD0lgw+9+97ut3vlBBL4T4Neri37+JxD44P3rpA5K6+quZuQAfj4F70AUgJ3N9AI1hzVk"
    b64 .= "IkZUyL3heJGYY3E1P3P3Rq2tI5+Pdi7gU4WQmC8RcKsPciINAAQ2FKmdsP63VgA+WOBbROCfH/wT66CsbtmyqxM5OVEQpxEBnbPXrwlwiOjENgN8KQFvLlG9febiDa2Qb01lAAdIlMR0Eh/FAElIEEEA4/9uW1G+01asgCCkAHXRV+uvX4e7oY/2pze57+zr67saBZEg"
    b64 .= "A04KCuwAW69iZIIlAkKMzzCiSCVQn5IEVM8vnrl797SYDQSoLJECFMQjCEhxEAICOAYQ+FvVQVuxBcAFQAHqmLGxuu5DFy5cSE+JQjKBQ1FG/h5viIQc52JEIIGEp8FJg/cmWwY/2pwkULI4f+Lmwux9TEDk4kJlMPgC/fgK2OkAKjqAAMa/0uKd76TfhAg/6oE/XCsl"
    b64 .= "Tj/9akYNIYiUDBQ2KAo+jO69QcCFSjY5qMW25nopHp5fPHNuzcLsCURAIXYR8NgKFpfEh5pT7oYIVDhtwPhXtqqDnfRhKL9IHTVTlZSd7AFX7Nlj3VfVGD0qCuPHUGr5HBpNBQTMSXz94aC1dSa8H/AfXzyzuGBiuTB7Rqy1hsKNzeMKWJAHkHFAah8Xi8sukkBLhboH"
    b64 .= "zgEUiIPqizKi+quSkv08PDySk1BFMtZ3NR+NyaFUxXuGUvy1TiZT2ZIE9OtHCnC2QgyQ+d++eGI+C5rfJrM3IOsXUXlsJlfAY5IaAEMdiIUMGLLQrduwArAFtiHZ6g34RWP+WAEYH+WBnU71eyBZmDn56F4vZfh8CUwjFQMBwzfWDwpwtrJytiXw58/czYLmv4nJzXnw"
    b64 .= "QhGbxwcCAp2hHl/uFpkBu3Ar4YGkBRD+hiB1UdTZk/7+/qCD5CoyD91Z/6W6/8Gj3idPYDyIMnP8uA5aiLbOUp4Zj6/HNxLZAr6VbQKh/5sGREP83MUTVL6CQmOj6TEmLvpR3XkgNoNYMoF/xVsdRBBwBwUU1n/V190NKTEJX+ruvfvBo4KsJ1mDBWAXyrqzu5TQuitO"
    b64 .= "kCJ8PQGF1hk0gAmUzN94ZJBJEDC4cR+ydAGdjYoAGoeLTgF7eWjOlxVbCZVj/IaM+gqkjm0bgtUZheoeVCFU9NUR+C3eu5/2oju2Qb+a0eTEeEpH37CjIxgBXIC1tH6sABBwAtWZu98/yfXF+JYGFxVU6B4xWVzc74GyG0LAAbeMIHcCf9u2K2D3KFSWwJmM8fu7G5x2"
    b64 .= "dnaWYvwdpQ1hTxdgLMkiE2ZfE+PHSjspLV1XdUpHOsxjshRL+JAeYAJWCcVv3/3+Xk2u/kriZq0C4g+TRTT+YPkQhA8MhCD747gH4h1YGIR2RIUTVMLIAevgcpVcft/M94NwleO7MOiRHN9dunlvy07KuGZdv9aRxZPRRK8VoCgm8K1sh+/eeDranmuCr4IsfAcvMyhc"
    b64 .= "KZ0lIMoQe3tDGVOn9ILhWSzDDsMOXsoQqMmAAESAqMKT/trek54AAA51SURBVDv8/cmKpK7vZK/FGl+/mt7B3uTyzpaWBhAK3PqvO2sN01g2jP9XARG2L+YfZGdnnzKBi2k0Mjx4QkQXcIEAjn/wG3rXgA8EEAcosVBNHFiPCPQEQUHW779jiUD3ybksE9/c5Llev97k"
    b64 .= "ob17MYEWRGB5xx0qW3yaik5AgsBxAt7K6uzdxcTs7HZfy1O+BgW5Hn69l/k0Y2M6myAgj2zTLx6wHfAH+DSc0bO7HiRFHdWNFYBkWfdTPwtfj9HE+MTe5EQwPmLQ0rIXE1jeNyx63H31segwWSHYkhawOrl4sj27vcZytN3XINM3t+BRLRv5PyZgPJCxNb/EwS5QT4CA"
    b64 .= "RwlMSFRRETpzZuL9kQAJ/8qng5k17f7lQ/H3erOnx4aAABaCQNpV5dV1HWPfXyb8YBdpACvIHZel+mcXnGqvwbeBBvNiOmDzcBwwju3ZmlJCIAYucUBfDheisFgfdeekPyk7qnqfZM5BPVpaNjQ3F1/ejbC37d28mSSwanmfZvnQvcHBi7fRUVhM4k98/7x7+/Yd2aO3"
    b64 .= "cuFKDghknaHCHKqxgA1NLEPj2PqgDETADhPQ48NXdoVo7/fkn32qJ3CtN2uwvLSutBPGlufi+/Y2tGzetm0zEoIA8oPKuYLcpO3d/bUMfgJpgKeLV7eDJLUX4CtBuJO7LOahMpiFAoExzPGEqMwJF0DO95qCXT3MpPcEFeo1UNWbVVAOaGhuumyuvKUBjL+3czMyA0VD"
    b64 .= "wlclVVVWapanbe+7TUkgFFB093kl4Fe2WxJRAC7lTrMxARcUCqEyPx+idDRPANQSDrxIeE3AIRKSE6eeiRkSfzQrM3kILximlufGGrC0YKEcI+BTKzuwM6SldQy72OoV0FeZWnVtNDc3k9TALBuFIJiAEdO4kAzLY2N1Yi0gJxRzVBxzaOF5kTYI3O2+dWtFxtkxf3/w"
    b64 .= "w+nBTI/EIcBG+N1z3RgdqWDz5m2ggY5KEh3jb+93NPTC+BPP+7dXjloUZKemZudaIgoG81QXXIewhMBEwBMcMK8VUWt1qgR4EqFUQVNOT8ArBUoEp3y8DeKTehfmphPLYWJ7CN5hzPWOdXYiWxwtLx8aGqJ0pKZW6v0AEYCoRMdOGFF4p3RVlcdoFfxlavspdBpk3aDK"
    b64 .= "8Ag1Sy7XaWkCGKQUoZs6HZR05uhRhorcFCXKwtVAYI/67ElgkD0496w8Mb5uKDE5OTk7uRc/BhkaSgSJj6dU9l099gb+8pXjM+oJO9vjx22PN6xblZa6PW07qMUf+aFlJhDgQh1GY0e3mhoKWSy+2P6AAq6KdcUquEFRMZnKEofAQAddSWAg6hMEQzIWn5TU2/vW0WlA"
    b64 .= "S0aSiAgk6gUIFMXFhcz06SmsXLlq1aZ1q/LGZ2LUZ0vXgU8i+GX+7e2nMjML/C6KmQQBeSgUaxyWyP7hvftwV6e1hdUXc7TQ0lYO2ymV0JiDOskpP0Pd0h0/Pf3W+vIlAtnJcySBZMyAcgBJ5NUlePgPybp1mzatWofx0wB/tCYXDlCP3tt8cEEIRBI0Tivhsk4/yrqr"
    b64 .= "20W1PnLkuEqlhKa+Dnq0ypLCwOEQiMWFgfl7S/3j0YQoLD07G+Enzc1VZSdmE2QQgTiQA7GgglUrfXxWLRFAAvDb05anLd+eBAldQYGfn0fBvJi2RCA0WkqrPWdi8MLT2si22QputbRwMpV4leh0gXYlbiEhsYGBkRktMKQCE5qJyQR+e9Kt3t4CmBOAlCBz0M+vFxMo"
    b64 .= "ugqLx/Nor9FXLV+H8NOWL4dQ6IFSapTXwmEELSEZ2x4N9B6wd7m8AHla0XGF2MoKrqlUcDJ6eSlrSwodlANwJ+NWWOiW31kNb3Oqh+AEyB5Fk+Jwri588cc//vGLJ0/gzjsLEYgcX0k81vF5bYJVhPmXk/h6AgU3T7twuXSSgKtw3gCS1bt3tIpdVkpHGDCFHjkowK4w"
    b64 .= "sAQRiA0JCckIOlRdXba589n0vd6FLPDkhT/+6b+w/OmPkOZgAuo8nzwfNMvS5fNv6kc7Y1lVDYGPTAATFkIuj02XyhEBJijAElKFk7Yi6nFnWH0JVoASYnGJQ6xbbFtbYUqb2h3NB0Dyc7IXzYj+7U//9ae/weq/+OJJFkQWP0SgAR5UdMHznfb2Ss2/LR92AAxXkvgw"
    b64 .= "YAHBsNaFTecZytFE8e1HxLRQQb+1yHqyEByg5LidEm7YVSqtFpbfllKYkpKRfwgzaKmY6TVY+Nt//e3JAmECsJ7F4CgFKWBF+LH2AkvfU7m5HT7k+tP0+Mt2JJL4fgUwL2ewcFnIFPAMoUPJVV6EmSk8MNQHKnD+3NnL7k6g1y6dVgu3RpzYjIy2FLguSIkKgiGJsrLO"
    b64 .= "4KL+uawvniATICP86QsY1h/NprjFpoyHH7vle6uyo+tYbqoP2orrwPc7OlKrqlJRKZWtVwC8KzExuPiYLuAhAhLh87lTJpiAydMIKv/4559PFk1OoHtCLVtMCwhJAQIZhSn5KWd3Av7mzqDCwue9yAZ/wx74xMIkqyY7m3I1OHLcp8q3Eoa5wjW5SeGalatwTKjM9bXM"
    b64 .= "rYJcqoogUAPrR8eRUkznQXNWYu54+9Gj3DVktm5FtdnV3DA5ORlorRUKoX8UZx7bCB4YYteWX59RhM4hp/rIwML+3qwvvkAqeAKTT4CfmEhZrunTrGzP7dheWVV57FR7l4ZMD07VVN7KTd2xDO8BD4+aXPS6IuvibTabbswTGHOZojODp8jJpYKZ41Qj4ZF9n09O3gEC"
    b64 .= "MFARu9trIARGFWMdQlLy66NiOje7B6e0FRaqZ3qf/AlU8AVoMws2JiKAhmGTLJMSPQo8ruWOHiOOBACvgooe0lkIQgT+GgODhcVaPpuFHucIuMLaWQsyT/CrbDkuMuJbIQITOhjWNOJscfeSR6L7WTuwQ3692nt1cH4KMIhSz9z7YgGmn+DBGOg/sbybkl3VsVwD+i5A"
    b64 .= "tQeMaKLQvyN11Le9Pdt/WWoqge8BE1sGN288toZHgxQ+nwcPCsQnMn0JArkd4Q3WCgX1+MiVyckoHXQQRW7bUiQD6Hp4YMIbGKTUgy8gyQgM2QN7AWRwDibRyodKhyh+UDVXVZ4iR9J821EOn1rlewq9qanyz67B+L6QDN04TeWzaAKaEAaS2HwWdT4TRhdBkzUdXXnD"
    b64 .= "aHRLNAEEJrR8vkK4e0MsXJRCKByY2hMZ0taW0hgY2YYZFKrVV+/NTT/r3rz5EKQn5fGU+OxkP79cPJAFUW0UXD+p/Vau5TWAR0U9Enhok3XxPpUNT9O4XB5cjPCENHrtTcvck89P1rQfC/dp0OLZDV3D55MTcFlvNLClLU5ijmLxwOQeiAcZbW0ZdpGIQFtGhnfM1e5O"
    b64 .= "LN1D8YnTFM2qtLpRS4RvUZMED9VO4ed6lrm5NaM1NTUo/HpkwlimGC7SBOQoSLQrXSC83fvoRes7kTMwQJ13hw8tI8imo2ImC2EKSVgfFBAnlcXBrIADEIhEuyEk0i6yEQi0teXnx1zF+HX+8fHtcxQ4AY6N+p6yWGPi2546CmOp8FrRFw+HZRac8qip8agpgAEtqpDO"
    b64 .= "I+ZAjA0lofYygVDZ/zLu69ivHWCCvkXL5ovQJacq6nM7kY0oIL81Ok7KhO69m/kIEAAGsCMiHSIRfltGkXdwA0rKhvzLp+fuUVb4dFVa+qK83zK3vb3mVlL7qAewIYazMv16PQZvnsDGJ/GBQIC9ITztifv6668PMLUtK/LO8llCHuqtibxihhkM4fmcA9EHjJnyOLe4"
    b64 .= "4s8z0MVtbKxbSEakQ2wbGCMkMsM72B1S9DF4JDo9RoEjqH2NpUVBO4S9HYBekFkA1TieiczyS55O8n9x2oZNNyRec2GRBEiBABPwuTp6YN6KvUo2U8jjorsXhZ0XQxTwZSj0DWlmcfK4geKRjFh8dx2qZwDaKIzKj+kcejadDT+9nAIhN3dNQRWMQoNoKuOTIEWuTMqF"
    b64 .= "11W9SZVp27vPivHyBUv4xhK5MU8m5H39NVPLZeXn+cTUwt5kCbguUF+rlIeFGTnQOJXQE2KlcnuvkT3nQ+Vw4AUMxKKwhK6xQyILi/JjdnZ2w1A45IRoCnkUj6OT+cg6kI5rNb3XKiEj63MQs1ko8OgNQJTlNJrQ9UAt21UgSwcXZLNcUKUigBabjUIRihQADzASWrn2"
    b64 .= "soR9ezICBJD0SewDwBtjveLAIiEQEfcEux/Cb6UpBQU1qV0rfBABAhxJZTxkw+vW1V1VUoVMmMU3BhUsETCWwusyoQsMZrgyvytbkQfTmXRoWxnCL9gMzIwciRzdpieE8rishH2fZwzwpKirzpW7xcYeUA2QDGJiGrrRU2mKX3ZHVzgMNXZp1r0WyEbgY12/ls+ScV3R"
    b64 .= "U643CRjDVbVYDHmhmfEWeJfjxacwaWwa2IhLE7FDz8PliquUywoAAmxP0IAE32tBU/OAW6vbAZUcMiUwhDo4GBjAWTB2DL1khln8xLp1vxbC/BB5YYSC8msCTBaVbRYqYYXAO2zQAB0urylwRvMELF5OqDHc7UAjNbSVy2VH7PsyVkruHsEBiAxxcqX9gThgEKUOrmjo"
    b64 .= "BgLh4atWwRNL/8FsApa0Q8e6bjtQvwufiiaSKVSyLUXcEBnC9TknWs4sQu/AQQNAgMKSGoKtWK6tply4wTYUCENbXV2FUyPnQ5eeRB7AGbi9Dv4AWigs8q7YOZRIySs9eml9dfd0745NoPo0TWp2atq6tI7yZ8NUUD/bxmzKE8YC2NQ3CMAtGcfMNZplh/B9xrU2dBgV"
    b64 .= "Zbaa8wRcPNkBT5Bg/qI11FWqGhnJMSUIwK0GJhAHqaxMfgCCRGBkfkNLN6X6EsjBh2H9fZvWpY2eGvWtSVvVMfbw+n00xMDj8xPemzSUCvhi7hIB1CKGi3JZyV4YCIaDACnJhcdqNeVxXTmcAwQBHjMnwJVmu28yx5VQgFRO4MeFxkl0MtRelUsCQ2Ia/i+SaB+mkmu8"
    b64 .= "YwAAAABJRU5ErkJggg=="
    n := 0
    if !DllCall("crypt32\CryptStringToBinary", "Str", b64, "UInt", 0, "UInt", 1, "Ptr", 0, "UInt*", n, "Ptr", 0, "Ptr", 0)
        return ""
    VarSetCapacity(bin, n, 0)
    DllCall("crypt32\CryptStringToBinary", "Str", b64, "UInt", 0, "UInt", 1, "Ptr", &bin, "UInt*", n, "Ptr", 0, "Ptr", 0)
    FileCreateDir, % A_AppData . "\MonitorLink"
    f := FileOpen(ruta, "w", "CP0")   ; CP0: no text marker before the image bytes
    if !IsObject(f)
        return ""
    f.RawWrite(bin, n)
    f.Close()
    return ruta
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
        Gui, Font, s10 Bold cFAA61A, Segoe UI
        GuiControl, Font, Status
        GuiControl,, Status, Not linked yet
    } else if (EnLinea) {
        Gui, Font, s10 Bold c3BA55C, Segoe UI
        GuiControl, Font, Status
        GuiControl,, Status, Connected
    } else {
        Gui, Font, s10 Bold cED4245, Segoe UI
        GuiControl, Font, Status
        GuiControl,, Status, Can't reach the bot - retrying
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
    if !EnviarMain()
        MsgBox, 48, Monitor Link, Saved, but could not reach the bot. It will be sent when it shows Connected.
    else
        MsgBox, 64, Monitor Link, % MiMain = "" ? "Done: your Main was removed." : "Done: the bot will send your cards to this Main."
return

EnviarMain() {
    if (Token = "")
        return false
    body := "{""main"":""" . MiMain . """}"
    try {
        r := Http("POST", ServerUrl . "/link/main", body, "text/plain; charset=utf-8", Token, 30)
    } catch e {
        return false
    }
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
    if PtcgpbAbierto() {
        MsgBox, 48, Monitor Link, Close the PTCGPB bot first (it saves its own settings when it closes), then press this button again.
        return
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
    webhook := ""
    MsgBox, 64, Monitor Link, Done! Your PTCGPB bot is set up for the Zenith Rise group reroll:`n`n- Group Reroll ON (elite + vip-elite online IDs)`n- Auto GP test every 3600 s (Standard, wait 150 s)`n- Group Discord: your Discord ID + the community webhook`n- Wonderpick: min 2 stars, ignore invalid packs`n- Mode: Inject Wonderpick 96P+ (min 70 packs, most packs first)`n`nThe PTCGPB bot opens now. A copy of your old settings is in Settings.ini.before-zenith.bak
    ; (Ale 2026-11-10) Opens the PTCGPB bot right after.
    SplitPath, ini,, dirBot
    if FileExist(dirBot . "\PTCGPB.ahk")
        Run, "%A_AhkPath%" "%dirBot%\PTCGPB.ahk", %dirBot%
return

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
    LeerBaneadas(r.text)
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
