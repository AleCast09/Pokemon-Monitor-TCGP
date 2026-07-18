const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { necesitaConfiguracion, ejecutarWizard } = require('./setup-wizard.js');

let esSea = false;
try { esSea = require('node:sea').isSea(); } catch (e) { esSea = false; }

const ENTRY_PATH = path.join(__dirname, 'entry.js');

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
        logLinea(`🔴 [${def.nombre}] se detuvo (code=${code} signal=${signal}) — reiniciando en ${REINTENTO_MS / 1000}s...`);
        setTimeout(() => iniciarProceso(def), REINTENTO_MS);
    });

    hijo.on('error', (err) => {
        logLinea(`❌ [${def.nombre}] error: ${err}`);
    });

    def.instancia = hijo;
}

function cerrarTodo() {
    cerrando = true;
    logLinea('🛑 Cerrando Monitor Pokémon...');
    for (const def of PROCESOS) {
        if (def.instancia && !def.instancia.killed) def.instancia.kill();
    }
    process.exit(0);
}

async function main() {
    if (necesitaConfiguracion()) {
        await ejecutarWizard();
    }

    logLinea('🚀 Monitor Pokémon — iniciando bot, trading y heartbeat...');
    for (const def of PROCESOS) {
        iniciarProceso(def);
    }
}

process.on('SIGINT', cerrarTodo);
process.on('SIGTERM', cerrarTodo);

main();
