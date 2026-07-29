; _OcrCheckRegion.ahk
; Lee el texto de una region de una imagen ya guardada (screenshot) y lo imprime
; por stdout -- para verificar en que pantalla esta el juego sin necesitar mirar
; la imagen. Usa solo nuestras propias utilidades (_OcrUtils.ahk, lib/Gdip_All.ahk),
; sin ningun archivo de Kevin.
;
; Uso: _OcrCheckRegion.ahk "<imagePath>" <x> <y> <w> <h> "<outputFile>"
;   Coordenadas en pixeles reales de la imagen (screenshot de adb, 540x960).
;   Escribe el texto reconocido en outputFile (un .exe de subsistema GUI como
;   AutoHotkeyU64.exe no tiene stdout confiable aunque se lo llame desde una
;   consola -- mismo criterio ya probado en _CountShinedust.ahk).

#SingleInstance off
SetBatchLines, -1
#NoEnv

if (A_Args.Length() < 6) {
    ExitApp, 1
}

imagePath := A_Args[1]
x := A_Args[2]
y := A_Args[3]
w := A_Args[4]
h := A_Args[5]
outputFile := A_Args[6]

#Include %A_ScriptDir%\_OcrUtils.ahk
#Include %A_ScriptDir%\lib\Gdip_All.ahk
#Include %A_ScriptDir%\lib\Gdip_Extra.ahk

pToken := Gdip_Startup()

EscribirResultado(texto) {
    global outputFile
    try {
        if (FileExist(outputFile))
            FileDelete, %outputFile%
        FileAppend, %texto%, %outputFile%
    } catch e {
    }
}

if (!FileExist(imagePath)) {
    EscribirResultado("ERROR: imagen no encontrada")
    Gdip_Shutdown(pToken)
    ExitApp, 2
}

texto := ""
try {
    pBitmapOriginal := Gdip_CreateBitmapFromFile(imagePath)
    pBitmapFormatted := Gdip_CropResizeGreyscaleContrast(pBitmapOriginal, x, y, w, h, 150, 0)
    texto := GetTextFromBitmap(pBitmapFormatted)
    Gdip_DisposeImage(pBitmapOriginal)
    Gdip_DisposeImage(pBitmapFormatted)
} catch e {
    texto := "ERROR: ocr fallo (" . e.message . ")"
}

EscribirResultado(texto)
Gdip_Shutdown(pToken)
ExitApp, 0
