const { spawn, exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const { necesitaConfiguracion, ejecutarWizard } = require('./setup-wizard.js');

let esSea = false;
try { esSea = require('node:sea').isSea(); } catch (e) { esSea = false; }

const ENTRY_PATH = path.join(__dirname, 'entry.js');
const PENDING_UPDATE_PATH = path.join(__dirname, '.pending_update.json');
const PENDING_RESTART_PATH = path.join(__dirname, '.pending_restart.json');
const LOCK_PATH = path.join(__dirname, '.monitor.lock');

function procesoExiste(pid) {
    try {
        process.kill(pid, 0);
        return true;
    } catch (e) {
        return false;
    }
}

function yaHayUnaCopiaAbierta() {
    if (!fs.existsSync(LOCK_PATH)) return false;
    const pidGuardado = parseInt(fs.readFileSync(LOCK_PATH, 'utf8').trim(), 10);
    if (!pidGuardado || !procesoExiste(pidGuardado)) return false;
    return true;
}

function avisarYaAbierto() {
    // Se usa un MessageBox de .NET vía PowerShell en vez de mshta.exe: mshta es
    // una herramienta vieja de Windows que Defender/EDR suele cerrar sola por
    // ser muy usada históricamente en malware — nada confiable para esto.
    const mensaje = 'Monitor Pokemon is already running in the background. No need to open it again.\n\nIf you want to change the token or add the Google Drive API key, open "Monitor Pokemon" (the control panel) and use "Open Api y token change".';
    const script = `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.MessageBox]::Show('${mensaje}', 'Monitor Pokemon')`;
    exec(`powershell -NoProfile -WindowStyle Hidden -Command "${script}"`, () => {});
}

const ACCESO_CONFIGURAR_PATH = path.join(__dirname, 'Change token or API key.lnk');

function crearAccesoDirectoConfigurar() {
    if (fs.existsSync(ACCESO_CONFIGURAR_PATH)) return;
    const destino = path.join(__dirname, 'Advanced', 'Reconfigure.bat');
    if (!fs.existsSync(destino)) return;
    const script = `$s = (New-Object -ComObject WScript.Shell).CreateShortcut('${ACCESO_CONFIGURAR_PATH.replace(/'/g, "''")}'); $s.TargetPath = '${destino.replace(/'/g, "''")}'; $s.WorkingDirectory = '${__dirname.replace(/'/g, "''")}'; $s.Save()`;
    exec(`powershell -NoProfile -WindowStyle Hidden -Command "${script.replace(/"/g, '\\"')}"`, () => {});
}

const ACCESO_PANEL_PATH = path.join(__dirname, 'Monitor Pokemon.lnk');

// Acceso directo con icono propio (no un .bat pelado) para abrir el panel de
// control — el .bat sigue siendo lo que realmente corre por dentro (hace
// falta para poner MONITOR_ROLE y lanzar PowerShell), pero lo que el usuario
// ve y usa es este acceso directo con cara de aplicación real.
function crearAccesoDirectoPanel() {
    if (fs.existsSync(ACCESO_PANEL_PATH)) return;
    const destino = path.join(__dirname, 'Open Control Panel.bat');
    if (!fs.existsSync(destino)) return;
    const rutaIcono = path.join(__dirname, 'assets', 'tray_icon.ico');
    const script = `$s = (New-Object -ComObject WScript.Shell).CreateShortcut('${ACCESO_PANEL_PATH.replace(/'/g, "''")}'); $s.TargetPath = '${destino.replace(/'/g, "''")}'; $s.WorkingDirectory = '${__dirname.replace(/'/g, "''")}'; $s.IconLocation = '${rutaIcono.replace(/'/g, "''")}'; $s.Save()`;
    exec(`powershell -NoProfile -WindowStyle Hidden -Command "${script.replace(/"/g, '\\"')}"`, () => {});
}

// Carpeta de Inicio de Windows: cualquier acceso directo ahí arranca solo al
// iniciar sesión, sin necesitar permisos de administrador ni una Tarea
// Programada — a diferencia del Programador de Tareas, esto funciona igual
// para cualquier usuario que descargue el programa, no solo en esta PC.
function carpetaInicioWindows() {
    if (!process.env.APPDATA) return null;
    return path.join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
}

function crearAccesoDirectoInicioAutomatico() {
    const carpeta = carpetaInicioWindows();
    if (!carpeta) return;
    const rutaAcceso = path.join(carpeta, 'Monitor Pokemon.lnk');
    if (fs.existsSync(rutaAcceso)) return;
    // Antes apuntaba directo a "Start Monitor Pokemon.bat" (todo oculto, sin
    // ninguna ventana visible al arrancar Windows). Ahora apunta al panel de
    // control — el panel arranca el bot solo si hace falta (mismo resultado
    // de siempre) pero deja una ventana real con botones en vez de que todo
    // sea invisible.
    const destino = path.join(__dirname, 'Open Control Panel.bat');
    if (!fs.existsSync(destino)) return;
    // WindowStyle 7 = minimizado — la consola del .bat/PowerShell no se ve,
    // pero la ventana real del panel (WinForms) sí se muestra igual.
    const script = `$s = (New-Object -ComObject WScript.Shell).CreateShortcut('${rutaAcceso.replace(/'/g, "''")}'); $s.TargetPath = '${destino.replace(/'/g, "''")}'; $s.WorkingDirectory = '${__dirname.replace(/'/g, "''")}'; $s.WindowStyle = 7; $s.Save()`;
    exec(`powershell -NoProfile -WindowStyle Hidden -Command "${script.replace(/"/g, '\\"')}"`, () => {});
}

function tomarLock() {
    fs.writeFileSync(LOCK_PATH, String(process.pid));
}

function liberarLock() {
    try { fs.unlinkSync(LOCK_PATH); } catch (e) {}
}

const LOGS_DIR = path.join(__dirname, 'logs');
fs.mkdirSync(LOGS_DIR, { recursive: true });
const logStream = fs.createWriteStream(path.join(LOGS_DIR, 'monitor.log'), { flags: 'a' });

function logLinea(texto) {
    console.log(texto);
    logStream.write(`[${new Date().toISOString()}] ${texto}\n`);
}

logLinea('');
logLinea('======== New session ========');
logLinea('This window is Monitor Pokémon running — it normally stays hidden,');
logLinea('if you see it, you can safely minimize it. Closing it with X shuts down the bot.');

const PROCESOS = [
    { nombre: 'bot', rol: 'bot' },
    { nombre: 'trading', rol: 'trading' },
    { nombre: 'heartbeat', rol: 'heartbeat' }
];

const REINTENTO_MS = 3000;
let cerrando = false;
let reiniciandoPorConfig = false;

function conectarSalida(hijo, nombre) {
    const manejar = (data, etiqueta) => {
        const texto = data.toString().replace(/\r?\n$/, '');
        for (const linea of texto.split(/\r?\n/)) {
            logStream.write(`[${new Date().toISOString()}] [${nombre}]${etiqueta} ${linea}\n`);
        }
    };
    hijo.stdout.on('data', (d) => manejar(d, ''));
    hijo.stderr.on('data', (d) => manejar(d, ' [err]'));
}

function iniciarProceso(def) {
    if (cerrando) return;

    const args = esSea ? [] : [ENTRY_PATH];
    const hijo = spawn(process.execPath, args, {
        cwd: __dirname,
        stdio: ['ignore', 'pipe', 'pipe'],
        // --use-system-ca: ademas de la lista de certificados que Node trae de
        // fabrica, tambien confia en el almacen de certificados de Windows. Sin
        // esto, un antivirus que inspecciona HTTPS (inyectando su propio
        // certificado raiz, cosa que Windows SI confia pero Node no) rompe
        // silenciosamente cualquier request HTTPS del bot (ej. "Check for
        // Updates") aunque el resto de la PC navegue sin problema.
        env: { ...process.env, MONITOR_ROLE: def.rol, NODE_OPTIONS: [process.env.NODE_OPTIONS, '--use-system-ca'].filter(Boolean).join(' ') }
    });

    conectarSalida(hijo, def.nombre);
    logLinea(`🟢 [${def.nombre}] started (pid ${hijo.pid})`);

    hijo.on('exit', (code, signal) => {
        if (cerrando || reiniciandoPorConfig) return;

        if (fs.existsSync(PENDING_UPDATE_PATH)) {
            iniciarActualizacion();
            return;
        }

        logLinea(`🔴 [${def.nombre}] stopped (code=${code} signal=${signal}) — restarting in ${REINTENTO_MS / 1000}s...`);
        setTimeout(() => iniciarProceso(def), REINTENTO_MS);
    });

    hijo.on('error', (err) => {
        logLinea(`❌ [${def.nombre}] error: ${err}`);
    });

    def.instancia = hijo;
}

async function iniciarActualizacion() {
    if (cerrando) return;
    cerrando = true;
    logLinea('🔄 Update ready — replacing the program...');

    await Promise.all(PROCESOS.map((def) => new Promise((resolve) => {
        if (!def.instancia || def.instancia.killed || def.instancia.exitCode !== null) return resolve();
        def.instancia.once('exit', resolve);
        def.instancia.kill();
    })));

    try { fs.unlinkSync(PENDING_UPDATE_PATH); } catch (e) {}

    if (!esSea) {
        logLinea('⚠️ Auto-update only applies to the packaged .exe — skipped in development mode.');
        process.exit(0);
        return;
    }

    const rutaExe = process.execPath;
    const rutaNueva = path.join(__dirname, 'MonitorPokemon.new.exe');
    const rutaBat = path.join(__dirname, '_update.bat');
    // Nota: "timeout" de Windows depende de tener una consola/stdin real y falla
    // (o se saltea) cuando corre sin ventana, como en nuestro caso — por eso las
    // esperas usan "ping" a localhost, el truco clásico que funciona sin consola.
    const contenidoBat = [
        '@echo off',
        'ping 127.0.0.1 -n 4 >nul',
        ':retry',
        `del "${rutaExe}" 2>nul`,
        `if exist "${rutaExe}" (`,
        '  ping 127.0.0.1 -n 2 >nul',
        '  goto retry',
        ')',
        `move /y "${rutaNueva}" "${rutaExe}"`,
        // "start" abre una consola visible por defecto — a diferencia de "Start
        // Monitor Pokemon.bat", que sí lo lanza oculto. Mismo patrón acá para
        // que el relanzamiento tras actualizar quede igual de invisible.
        `powershell -NoProfile -WindowStyle Hidden -Command "Start-Process -FilePath '${rutaExe.replace(/'/g, "''")}' -WorkingDirectory '${__dirname.replace(/'/g, "''")}' -WindowStyle Hidden"`,
        'del "%~f0"',
        ''
    ].join('\r\n');
    fs.writeFileSync(rutaBat, contenidoBat);

    const proc = spawn('cmd.exe', ['/c', rutaBat], { cwd: __dirname, detached: true, stdio: 'ignore' });
    proc.unref();

    setTimeout(() => process.exit(0), 500);
}

// "Reconfigure.bat" corre en un proceso aparte (no este launcher), así que no
// puede reiniciar bot/trading/heartbeat directamente — en vez de eso deja
// este archivo como señal, y acá se revisa cada 2s. Sin esto, un cambio como
// activar HD no se aplicaba hasta cerrar y volver a abrir todo el programa a
// mano, porque cada proceso solo lee el .env una vez, al arrancar.
async function reiniciarProcesosPorConfig() {
    if (cerrando || reiniciandoPorConfig) return;
    reiniciandoPorConfig = true;
    logLinea('🔄 Configuration changed — restarting bot, trading and heartbeat...');

    await Promise.all(PROCESOS.map((def) => new Promise((resolve) => {
        if (!def.instancia || def.instancia.killed || def.instancia.exitCode !== null) return resolve();
        def.instancia.once('exit', resolve);
        def.instancia.kill();
    })));

    reiniciandoPorConfig = false;
    for (const def of PROCESOS) {
        iniciarProceso(def);
    }
}

setInterval(() => {
    if (cerrando || reiniciandoPorConfig) return;
    if (!fs.existsSync(PENDING_RESTART_PATH)) return;
    try { fs.unlinkSync(PENDING_RESTART_PATH); } catch (e) {}
    reiniciarProcesosPorConfig();
}, 2000);

// El panel de control puede descargar una actualización por su cuenta (rol
// "apply_update", corre aparte y no es hijo de este launcher) — a diferencia
// del botón de Discord (que dispara esto mismo porque el propio bot.js hace
// process.exit() tras descargar), acá nadie "sale" para que se note el
// archivo, así que se revisa cada 2s igual que .pending_restart.json.
// iniciarActualizacion() ya es segura de llamar de mas (chequea "cerrando"
// al toque) por si el usuario dispara la misma actualización desde Discord
// Y desde el panel casi al mismo tiempo.
setInterval(() => {
    if (cerrando || reiniciandoPorConfig) return;
    if (!fs.existsSync(PENDING_UPDATE_PATH)) return;
    iniciarActualizacion();
}, 2000);

let procesoBandeja = null;

// Icono en la bandeja del sistema (junto al reloj) — antes el programa corría
// totalmente invisible (solo una consola oculta), sin ninguna señal de que
// seguía vivo ni forma rápida de reiniciarlo/salir sin buscar los .bat. Corre
// como un proceso de PowerShell aparte (mismo patrón ya usado en este archivo
// para el MessageBox de "ya está abierto"), no forma parte de PROCESOS porque
// no es parte del bot en sí — es solo la interfaz visual.
function iniciarBandejaSistema() {
    const rutaTray = path.join(__dirname, 'tray.ps1');
    if (!fs.existsSync(rutaTray)) return;
    try {
        procesoBandeja = spawn('powershell.exe', ['-NoProfile', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-File', rutaTray], {
            cwd: __dirname,
            stdio: 'ignore',
            detached: true
        });
        procesoBandeja.on('error', (err) => logLinea(`❌ [tray] error: ${err}`));
        procesoBandeja.unref();
    } catch (e) {
        logLinea(`❌ [tray] no se pudo iniciar el ícono de bandeja: ${e}`);
    }
}

function cerrarTodo() {
    cerrando = true;
    logLinea('🛑 Shutting down Monitor Pokémon...');
    for (const def of PROCESOS) {
        if (def.instancia && !def.instancia.killed) def.instancia.kill();
    }
    if (procesoBandeja && !procesoBandeja.killed) {
        try { exec(`taskkill /pid ${procesoBandeja.pid} /T /F`); } catch (e) {}
    }
    liberarLock();
    process.exit(0);
}

async function main() {
    if (yaHayUnaCopiaAbierta()) {
        logLinea('⚠️ Monitor Pokémon is already open — not opening a second copy.');
        avisarYaAbierto();
        process.exit(0);
        return;
    }
    tomarLock();

    while (necesitaConfiguracion()) {
        await ejecutarWizard();
        if (necesitaConfiguracion()) {
            logLinea('⚠️ Configuration was closed without saving the token — reopening it.');
        }
    }
    crearAccesoDirectoConfigurar();
    crearAccesoDirectoPanel();
    crearAccesoDirectoInicioAutomatico();
    iniciarBandejaSistema();

    logLinea('🚀 Monitor Pokémon — starting bot, trading and heartbeat...');
    for (const def of PROCESOS) {
        iniciarProceso(def);
    }
}

process.on('SIGINT', cerrarTodo);
process.on('SIGTERM', cerrarTodo);

main();
