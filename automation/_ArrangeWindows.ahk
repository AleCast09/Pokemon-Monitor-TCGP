; _ArrangeWindows.ahk -- creado 2026-08-19, a pedido explicito del usuario ("igual que el
; bot de Kevin, que acomoda las instancias en orden al prenderlas"). Acomoda las ventanas
; de las instancias de MuMu en una grilla simple (columna x fila via WinMove) -- mismo
; criterio que el boton "Arrange"/Start Bot de PTCGPB.ahk (Kevin): primero la/las
; instancia(s) que se pasen, en el orden dado, 2 columnas.
;
; Cosmetico/best-effort -- si una ventana todavia no existe (instancia recien prendiendo)
; simplemente se la salta, no es un paso del pipeline con pass/fail.
;
; Uso: _ArrangeWindows.ahk "<titulo1>" "<titulo2>" ... (en el orden en que se quieren
; acomodar, ej. "Main" "1")
;
; Uso alternativo (2026-08-21, a pedido explicito del usuario -- una instancia que se
; recupera sola por heartbeat.js quedaba con la ventana mal ubicada/tamaño raro, porque
; ese flujo nunca llamaba a este script): un SOLO argumento numerico (ej. "3", no "Main")
; reacomoda esa instancia puntual a SU propio lugar en la grilla general -- el bot de Kevin
; tiene 2 modos configurables (aclarado por el usuario en vivo): con reroll normal, la
; grilla arranca en "Main" (slot 0) y despues 1,2,3...; con "solo inject +13" no hay
; ventana "Main" en la grilla, arranca directo en 1 (slot 0). Se detecta solo cual modo
; esta activo mirando si existe una ventana "Main" en pantalla en ESTE momento -- si
; existe, la instancia N va al slot N (Main ocupa el 0); si no existe, va al slot N-1.

#SingleInstance off
SetBatchLines, -1
#NoEnv

scaleParam := 283
titleHeight := 40
rowHeight := titleHeight + 492
columnas := 2
borderWidth := 3

; Espera a que CADA ventana exista antes de acomodarla (2026-08-19, bug real en vivo: un
; chequeo unico de WinExist se la perdia seguido porque este script se dispara en paralelo
; justo cuando la instancia recien esta prendiendo, antes de que la ventana termine de
; aparecer -- se la saltaba para siempre sin reintentar). Hasta 20s de margen por ventana.
esperarYAcomodar(titulo, idx) {
    global scaleParam, rowHeight, columnas, borderWidth
    winTitle := titulo . " ahk_class Qt5156QWindowIcon"
    SetTitleMatchMode, 3
    inicio := A_TickCount
    Loop {
        if (WinExist(winTitle)) {
            fila := Floor(idx / columnas)
            col := Mod(idx, columnas)
            x := col * (scaleParam - borderWidth * 2)
            y := fila * rowHeight
            WinMove, %winTitle%,, %x%, %y%, %scaleParam%, %rowHeight%
            return true
        }
        if (A_TickCount - inicio > 20000)
            return false
        Sleep, 1000
    }
}

if (A_Args.Length() = 1 && A_Args[1] is integer) {
    ; Reacomodo de una sola instancia a su propio slot -- detecta si "Main" esta en la
    ; grilla (offset +1) o no (offset 0), ver comentario de arriba.
    SetTitleMatchMode, 3
    tieneMain := WinExist("Main ahk_class Qt5156QWindowIcon")
    offset := tieneMain ? 1 : 0
    esperarYAcomodar(A_Args[1], (A_Args[1] - 1) + offset)
    ExitApp, 0
}

Loop, % A_Args.Length() {
    esperarYAcomodar(A_Args[A_Index], A_Index - 1)
    Sleep, 100
}
ExitApp, 0
