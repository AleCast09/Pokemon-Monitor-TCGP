# Icono de bandeja del sistema para Monitor Pokemon.
# Corre como un proceso PowerShell aparte, lanzado por launcher.js — no tiene
# nada del bot en si (bot/trading/heartbeat siguen siendo hijos de
# launcher.js), solo da una forma visual de saber que esta corriendo y un
# menu para Configuracion/Reiniciar/Salir, en vez de un .bat de consola oculta
# sin ningun indicio visible de que el programa sigue vivo.
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$raiz = Split-Path -Parent $MyInvocation.MyCommand.Path
$rutaIcono = Join-Path $raiz "assets\tray_icon.ico"
$rutaPendienteRestart = Join-Path $raiz ".pending_restart.json"
$rutaLock = Join-Path $raiz ".monitor.lock"
$rutaAccesoInicio = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\Startup\Monitor Pokemon.lnk"

$notifyIcon = New-Object System.Windows.Forms.NotifyIcon
$notifyIcon.Icon = New-Object System.Drawing.Icon($rutaIcono)
$notifyIcon.Text = "Monitor Pokemon - running"
$notifyIcon.Visible = $true

$menu = New-Object System.Windows.Forms.ContextMenuStrip

$itemConfigurar = $menu.Items.Add("Reconfigure (token / API key)")
$itemConfigurar.Add_Click({
    Start-Process -FilePath (Join-Path $raiz "Advanced\Reconfigure.bat") -WorkingDirectory $raiz
})

$itemReiniciar = $menu.Items.Add("Restart bot")
$itemReiniciar.Add_Click({
    # Mismo mecanismo que ya usa Reconfigure.bat: dejar este archivo como
    # señal — launcher.js ya lo revisa cada 2s y reinicia bot/trading/heartbeat
    # solo, no hace falta ninguna plomeria nueva de ese lado.
    Set-Content -Path $rutaPendienteRestart -Value "1"
    $notifyIcon.ShowBalloonTip(3000, "Monitor Pokemon", "Restarting bot, trading and heartbeat...", [System.Windows.Forms.ToolTipIcon]::Info)
})

$menu.Items.Add("-") | Out-Null

$itemSalir = $menu.Items.Add("Quit Monitor Pokemon")
$itemSalir.Add_Click({
    Get-Process MonitorPokemon -ErrorAction SilentlyContinue | Stop-Process -Force
    Remove-Item -Path $rutaAccesoInicio -ErrorAction SilentlyContinue
    Remove-Item -Path $rutaLock -ErrorAction SilentlyContinue
    $notifyIcon.Visible = $false
    $notifyIcon.Dispose()
    [System.Windows.Forms.Application]::Exit()
})

$notifyIcon.ContextMenuStrip = $menu

# Doble click = mismo acceso rapido que ya existe para cambiar token/API key.
$notifyIcon.Add_DoubleClick({
    Start-Process -FilePath (Join-Path $raiz "Advanced\Reconfigure.bat") -WorkingDirectory $raiz
})

[System.Windows.Forms.Application]::Run()
