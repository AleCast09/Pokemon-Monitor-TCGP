; _CoordFinder.ahk
; Redimensiona la instancia de MuMu al MISMO tamaño que usa la automatización real (283x532,
; sin borde de ventana) y muestra en vivo las coordenadas X/Y del mouse relativas a esa ventana.
; Así las coordenadas que leas van a coincidir exactamente con las que usará el script real,
; sin importar dónde esté posicionada la ventana en tu pantalla.
;
; Uso: doble clic y escribe el nombre de la instancia (ejemplo: 1 o Main) cuando lo pida.
;      También puedes correrlo con: _CoordFinder.ahk "1"
; Presiona ESC para cerrar.

#SingleInstance force
#Persistent
#NoEnv
SetTitleMatchMode, 3
CoordMode, Mouse, Screen

if (A_Args.Length() >= 1)
    winTitle := A_Args[1]
else {
    InputBox, winTitle, Coord Finder, Nombre de la instancia (ejemplo: 1 o Main):
    if (ErrorLevel)
        ExitApp
}

hwnd := WinExist(winTitle . " ahk_class Qt5156QWindowIcon")
if (!hwnd) {
    MsgBox, 16, Coord Finder, No se encontró la ventana de la instancia "%winTitle%".`n`nAsegúrate de que esté abierta.
    ExitApp
}

WinGet, wStyle, Style, ahk_id %hwnd%
if (wStyle & 0x00C00000)
    WinSet, Style, -0xC00000, ahk_id %hwnd%
WinGetPos, wx, wy, ww, wh, ahk_id %hwnd%
wyOriginal := wy
if (wy < 0)
    wy := 0
if (ww != 283 || wh != 532 || wy != wyOriginal)
    WinMove, ahk_id %hwnd%, , %wx%, %wy%, 283, 532

SetTimer, ShowCoords, 100
return

ShowCoords:
    MouseGetPos, mouseX, mouseY, curWinId
    if (curWinId != hwnd) {
        ToolTip, % "(pasa el mouse sobre la instancia """ . winTitle . """)", mouseX+15, mouseY+15
        return
    }
    WinGetPos, curX, curY, , , ahk_id %hwnd%
    relX := mouseX - curX
    relY := mouseY - curY
    ToolTip, Instancia: %winTitle%`nX: %relX%  Y: %relY%, mouseX+15, mouseY+15
return

Esc::ExitApp
