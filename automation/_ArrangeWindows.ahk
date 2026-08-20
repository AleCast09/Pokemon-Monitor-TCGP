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

Loop, % A_Args.Length() {
    esperarYAcomodar(A_Args[A_Index], A_Index - 1)
    Sleep, 100
}
ExitApp, 0
