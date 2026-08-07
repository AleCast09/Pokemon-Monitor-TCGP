; _CaptureAdbShot.ahk
; Herramienta minima para sacar 1 captura ADB real (540x960, misma escala de dispositivo
; que usan los scripts nuevos de esta sesion -- Shinedust/Main Trade), bajo demanda
; mientras se arman needles en vivo con el usuario. NO usa _CaptureNeedle.ahk (esa es de
; Kevin, captura la VENTANA en escala logica 283x532 -- escala distinta, needle
; incompatible con Gdip_ImageSearch contra las capturas de AdbScreenshot).
;
; Uso: _CaptureAdbShot.ahk "<winTitle>" "<folderPath>" "<outputFile>"

#SingleInstance off
SetBatchLines, -1
#NoEnv

if (A_Args.Length() < 3)
    ExitApp, 1

winTitle   := A_Args[1]
folderPath := A_Args[2]
outputFile := A_Args[3]

#Include %A_ScriptDir%\_AdbUtils.ahk

adbPath := resolverRutaAdb(folderPath)
if (adbPath = "")
    ExitApp, 2
puerto := resolverPuertoAdb(folderPath, winTitle)
if (puerto = "")
    ExitApp, 3
AdbConectar(adbPath, puerto)
AdbScreenshot(adbPath, puerto, outputFile)
ExitApp, 0
