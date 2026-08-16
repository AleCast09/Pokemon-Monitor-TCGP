# Encuentra y controla la ventana del AHK de una instancia puntual (ej. "4.ahk").
# Usado por bot.js cuando el aviso de heartbeat detecta una instancia
# congelada: "reload" reinicia el script (recarga en caliente, igual que el
# botón Reload/Shift+F5 que ya tiene la herramienta), "close" lo cierra del
# todo (para cuando ya no quedan cuentas de 24h y no tiene sentido seguirlo
# corriendo, ahorra recursos).
param(
    [Parameter(Mandatory=$true)][string]$InstanceId,
    [Parameter(Mandatory=$true)][ValidateSet("reload","close","check")][string]$Action
)

Add-Type @"
using System;
using System.Text;
using System.Text.RegularExpressions;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public class AhkWin {
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc enumProc, IntPtr lParam);
    [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
    [DllImport("user32.dll")] public static extern int GetClassName(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
    [DllImport("user32.dll")] public static extern int GetWindowThreadProcessId(IntPtr hWnd, out int lpdwProcessId);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);

    // Ventana VISIBLE del panel (clase "AutoHotkeyGUI", título corto "{N}.ahk")
    // — sirve para "reload" (le mandamos el atajo de teclado que ya usa).
    public static IntPtr FindVisiblePanel(string exactTitle) {
        IntPtr found = IntPtr.Zero;
        EnumWindows((hWnd, lParam) => {
            var sb = new StringBuilder(256);
            GetWindowText(hWnd, sb, 256);
            if (sb.ToString() == exactTitle) { found = hWnd; return false; }
            return true;
        }, IntPtr.Zero);
        return found;
    }

    // Ventana OCULTA principal del script (clase "AutoHotkey", no
    // "AutoHotkeyGUI" — esa es la del panel visible). Cerrar el panel visible
    // solo dispara GuiClose (que puede solo esconderlo, sin salir de verdad);
    // WM_CLOSE a ESTA ventana es lo que realmente equivale a "Exit" del menú
    // de la bandeja, confirmado por el usuario probando ambos casos en vivo.
    public static IntPtr FindHiddenMain(string instanceId) {
        IntPtr found = IntPtr.Zero;
        var patron = new Regex(@"\\" + Regex.Escape(instanceId) + @"\.ahk\s+-\s+AutoHotkey", RegexOptions.IgnoreCase);
        EnumWindows((hWnd, lParam) => {
            var sbClase = new StringBuilder(256);
            GetClassName(hWnd, sbClase, 256);
            if (sbClase.ToString() == "AutoHotkey") {
                var sbTitulo = new StringBuilder(512);
                GetWindowText(hWnd, sbTitulo, 512);
                if (patron.IsMatch(sbTitulo.ToString())) { found = hWnd; return false; }
            }
            return true;
        }, IntPtr.Zero);
        return found;
    }

    public static int Pid(IntPtr hWnd) {
        int pid; GetWindowThreadProcessId(hWnd, out pid); return pid;
    }
}
"@

if ($Action -eq "check") {
    # Usado por heartbeat.js antes de intentar una recuperacion automatica (2026-08-14, bug
    # real reportado por el usuario): si el AHK de esta instancia ya no esta corriendo -- por
    # ejemplo porque el usuario lo detuvo a mano a proposito -- reiniciar MuMu no sirve de
    # nada (nada va a volver a engancharse) y solo dispara un loop infinito de reinicios cada
    # vez que se cumple el timer de congelamiento. Se busca la ventana oculta principal (la
    # misma que usa "close"), no la visible, porque esa es la que de verdad significa "el
    # script sigue vivo".
    $hwndPrincipal = [AhkWin]::FindHiddenMain($InstanceId)
    if ($hwndPrincipal -eq [IntPtr]::Zero) {
        Write-Output "NOT_FOUND"
        exit 1
    }
    Write-Output "FOUND:$([AhkWin]::Pid($hwndPrincipal))"
    exit 0
}

if ($Action -eq "close") {
    $hwndPrincipal = [AhkWin]::FindHiddenMain($InstanceId)
    if ($hwndPrincipal -eq [IntPtr]::Zero) {
        Write-Output "NOT_FOUND"
        exit 1
    }
    $procId = [AhkWin]::Pid($hwndPrincipal)
    # Mensaje 0x500 ("stop after run") — es la señal oficial que la propia
    # herramienta ya usa para su función de "detener todas las instancias"
    # (confirmado leyendo Include\Utils.ahk: OnMessage(0x500, ...) + el envío
    # real vía SignalStopAfterRun(), PostMessage 0x500 a la ventana oculta
    # ahk_class AutoHotkey de cada instancia). El bucle de "no eligible
    # accounts, waiting" revisa esta señal de inmediato en cada vuelta (no
    # espera el minuto completo) y hace un cierre limpio real
    # (CleanupBeforeExit + ExitApp, sin Reload) — a diferencia de WM_CLOSE o
    # WM_COMMAND, que el script ignoraba por completo.
    [AhkWin]::PostMessage($hwndPrincipal, 0x500, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null
    Write-Output "CLOSED:$procId"
    exit 0
}

# El título corto es siempre "{N}.ahk" (confirmado en vivo contra las
# instancias 4 y 5 corriendo) — más confiable que matchear el path completo,
# que puede variar de PC en PC.
$titulo = "$InstanceId.ahk"
$hwnd = [AhkWin]::FindVisiblePanel($titulo)

if ($hwnd -eq [IntPtr]::Zero) {
    Write-Output "NOT_FOUND"
    exit 1
}

$procId = [AhkWin]::Pid($hwnd)

# Reload: activar la ventana y mandarle el mismo atajo que ya tiene el script
# (Shift+F5) — no reinventamos el mecanismo de recarga, solo lo disparamos
# desde afuera en vez de que el usuario haga clic a mano.
[AhkWin]::ShowWindow($hwnd, 9) | Out-Null  # SW_RESTORE, por si estaba minimizada
[AhkWin]::SetForegroundWindow($hwnd) | Out-Null
Start-Sleep -Milliseconds 300
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.SendKeys]::SendWait("+{F5}")
Write-Output "RELOADED:$procId"
