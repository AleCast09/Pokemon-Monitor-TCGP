const { spawn, exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const { necesitaConfiguracion, ejecutarWizard } = require('./setup-wizard.js');

let esSea = false;
try { esSea = require('node:sea').isSea(); } catch (e) { esSea = false; }

const ENTRY_PATH = path.join(__dirname, 'entry.js');
const PENDING_UPDATE_PATH = path.join(__dirname, '.pending_update.json');
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
    const mensaje = 'Monitor Pokemon ya esta corriendo en segundo plano. No hace falta abrirlo de nuevo.';
    const script = `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.MessageBox]::Show('${mensaje}', 'Monitor Pokemon')`;
    exec(`powershell -NoProfile -WindowStyle Hidden -Command "${script}"`, () => {});
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
logLinea('======== Nueva sesión ========');

const PROCESOS = [
    { nombre: 'bot', rol: 'bot' },
    { nombre: 'trading', rol: 'trading' },
    { nombre: 'heartbeat', rol: 'heartbeat' }
];

const REINTENTO_MS = 3000;
let cerrando = false;

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
        env: { ...process.env, MONITOR_ROLE: def.rol }
    });

    conectarSalida(hijo, def.nombre);
    logLinea(`🟢 [${def.nombre}] iniciado (pid ${hijo.pid})`);

    hijo.on('exit', (code, signal) => {
        if (cerrando) return;

        if (fs.existsSync(PENDING_UPDATE_PATH)) {
            iniciarActualizacion();
            return;
        }

        logLinea(`🔴 [${def.nombre}] se detuvo (code=${code} signal=${signal}) — reiniciando en ${REINTENTO_MS / 1000}s...`);
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
    logLinea('🔄 Actualización lista — reemplazando el programa...');

    await Promise.all(PROCESOS.map((def) => new Promise((resolve) => {
        if (!def.instancia || def.instancia.killed || def.instancia.exitCode !== null) return resolve();
        def.instancia.once('exit', resolve);
        def.instancia.kill();
    })));

    try { fs.unlinkSync(PENDING_UPDATE_PATH); } catch (e) {}

    if (!esSea) {
        logLinea('⚠️ La auto-actualización solo aplica al .exe empaquetado — se omite en modo desarrollo.');
        process.exit(0);
        return;
    }

    const rutaExe = process.execPath;
    const rutaNueva = path.join(__dirname, 'MonitorPokemon.new.exe');
    const rutaBat = path.join(__dirname, '_actualizar.bat');
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
        `start "" "${rutaExe}"`,
        'del "%~f0"',
        ''
    ].join('\r\n');
    fs.writeFileSync(rutaBat, contenidoBat);

    const proc = spawn('cmd.exe', ['/c', rutaBat], { cwd: __dirname, detached: true, stdio: 'ignore' });
    proc.unref();

    setTimeout(() => process.exit(0), 500);
}

function cerrarTodo() {
    cerrando = true;
    logLinea('🛑 Cerrando Monitor Pokémon...');
    for (const def of PROCESOS) {
        if (def.instancia && !def.instancia.killed) def.instancia.kill();
    }
    liberarLock();
    process.exit(0);
}

async function main() {
    if (yaHayUnaCopiaAbierta()) {
        logLinea('⚠️ Monitor Pokémon ya está abierto — no se abre una segunda copia.');
        avisarYaAbierto();
        process.exit(0);
        return;
    }
    tomarLock();

    while (necesitaConfiguracion()) {
        await ejecutarWizard();
        if (necesitaConfiguracion()) {
            logLinea('⚠️ La configuración se cerró sin guardar el token — se vuelve a abrir.');
        }
    }

    logLinea('🚀 Monitor Pokémon — iniciando bot, trading y heartbeat...');
    for (const def of PROCESOS) {
        iniciarProceso(def);
    }
}

process.on('SIGINT', cerrarTodo);
process.on('SIGTERM', cerrarTodo);

main();
