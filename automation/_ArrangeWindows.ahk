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
pasoFila := rowHeight
columnas := 2
borderWidth := 3

; Espera a que CADA ventana exista antes de acomodarla (2026-08-19, bug real en vivo: un
; chequeo unico de WinExist se la perdia seguido porque este script se dispara en paralelo
; justo cuando la instancia recien esta prendiendo, antes de que la ventana termine de
; aparecer -- se la saltaba para siempre sin reintentar). Hasta 20s de margen por ventana.
;
; rowHeight (tamaño REAL de la ventana, fijo) vs pasoFila (cuanto se corre cada fila en Y,
; puede ser mas chico que rowHeight si hay RowGap negativo -- bug real reportado en vivo
; 2026-08-31: al meter RowGap directo en rowHeight, se achicaba la ventana misma en vez de
; solo acercar las filas entre si, dejando la instancia con un tamaño mas chico que las demas
; y "desconectada" visualmente del panel de AHK, que sigue esperando su tamaño de siempre).
; Reemplaza "Var is Integer" (2026-09-17, bug real reproducido en vivo -- "instancia 1 y Main
; nuevamente se pusieron ambos en el mismo lugar"): el operador `is` de AHK v1 NO es confiable
; dentro de una expresion compuesta con && o entre parentesis (solo funciona bien en su forma
; clasica de comando standalone `if Var is Integer`) -- confirmado con una prueba aislada:
; `("Main" is integer)` devuelve TRUE. Eso hacia que la llamada real de bot.js,
; `_ArrangeWindows.ahk "Main" "1"`, entrara por error a la rama de "un solo indice numerico"
; (linea ~64 de antes) tratando "Main" como si fuera un numero -- esa rama solo procesa el
; primer argumento y corta con ExitApp, asi que "1" (la donante) nunca se acomodaba, quedando
; superpuesta con Main en la posicion que sea que el propio MuMu recordara. Con `esEntero()`
; (RegEx, sin el operador `is`) el chequeo da el resultado correcto para ambos casos.
esEntero(v) {
    return RegExMatch(v, "^-?\d+$") ? true : false
}

esperarYAcomodar(titulo, idx) {
    global scaleParam, rowHeight, pasoFila, columnas, borderWidth
    winTitle := titulo . " ahk_class Qt5156QWindowIcon"
    SetTitleMatchMode, 3
    inicio := A_TickCount
    Loop {
        if (WinExist(winTitle)) {
            fila := Floor(idx / columnas)
            col := Mod(idx, columnas)
            x := col * (scaleParam - borderWidth * 2)
            y := fila * pasoFila
            WinMove, %winTitle%,, %x%, %y%, %scaleParam%, %rowHeight%
            return true
        }
        if (A_TickCount - inicio > 20000)
            return false
        Sleep, 1000
    }
}

if (A_Args.Length() >= 1 && esEntero(A_Args[1])) {
    ; Reacomodo de una sola instancia a su propio slot -- detecta si "Main" esta en la
    ; grilla (offset +1) o no (offset 0), ver comentario de arriba.
    ;
    ; Argumentos 2 y 3 opcionales (agregado 2026-08-31, a pedido explicito del usuario):
    ; columnas reales y RowGap, sacados de Settings.ini de Kevin ([General] Columns= y
    ; [ToolsAndSystem] RowGap=) por heartbeat.js -- antes "columnas" estaba fijo en 2,
    ; asi que cualquiera con mas de 2 columnas configuradas (bug real reportado en vivo,
    ; confirmado: Columns=5) quedaba con instancias mal ubicadas al recuperarse solas.
    if (A_Args.Length() >= 2 && esEntero(A_Args[2]) && A_Args[2] > 0)
        columnas := A_Args[2]
    if (A_Args.Length() >= 3 && esEntero(A_Args[3]))
        pasoFila := rowHeight + A_Args[3]
    ; Argumento 4 opcional (2026-08-31, a pedido explicito del usuario, bug real reportado en
    ; vivo): "1"/"0" explicito de si Main ocupa el slot 0, sacado de runMain= en Settings.ini
    ; (la fuente de verdad real del modo de operacion) en vez de adivinar mirando si una
    ; ventana "Main" EXISTE en pantalla en este instante -- esa deteccion fallaba cuando el
    ; script/hack de Main ya estaba corriendo pero su instancia real todavia no habia
    ; arrancado, o cuando el estado de esa ventana cambiaba entre una llamada y la siguiente,
    ; causando que dos instancias distintas calcularan el mismo offset y chocaran en el mismo
    ; lugar. Sin este argumento (llamadas viejas, o Settings.ini sin ese campo), cae al
    ; chequeo de ventana de siempre.
    if (A_Args.Length() >= 4) {
        tieneMain := (A_Args[4] = "1")
    } else {
        SetTitleMatchMode, 3
        tieneMain := WinExist("Main ahk_class Qt5156QWindowIcon")
    }
    offset := tieneMain ? 1 : 0
    esperarYAcomodar(A_Args[1], (A_Args[1] - 1) + offset)
    ExitApp, 0
}

; Columnas/RowGap opcionales al FINAL de la lista de titulos (agregado 2026-08-31, uso
; puntual: reacomodar TODAS las ventanas de una sola pasada con idx fijo 0,1,2... en vez de
; llamar una por una en modo single-instance -- ese modo recalcula "¿existe Main ahora?" en
; CADA llamada por separado, y si el estado de esa ventana puntual cambia entre una llamada y
; la siguiente [ej. minimizada un instante], dos instancias distintas pueden terminar
; calculando el MISMO offset y choncando en el mismo slot -- bug real visto en vivo).
cantidadTitulos := A_Args.Length()
if (cantidadTitulos >= 3 && esEntero(A_Args[cantidadTitulos]) && esEntero(A_Args[cantidadTitulos - 1])) {
    pasoFila := rowHeight + A_Args[cantidadTitulos]
    columnas := A_Args[cantidadTitulos - 1]
    cantidadTitulos -= 2
}
Loop, % cantidadTitulos {
    esperarYAcomodar(A_Args[A_Index], A_Index - 1)
    Sleep, 100
}
ExitApp, 0
