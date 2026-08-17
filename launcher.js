const { spawn, exec, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const { necesitaConfiguracion, ejecutarWizard } = require('./setup-wizard.js');

let esSea = false;
try { esSea = require('node:sea').isSea(); } catch (e) { esSea = false; }

const ENTRY_PATH = path.join(__dirname, 'entry.js');

// Ventana propia oculta (2026-08-08, bug real reportado): si alguien abre MonitorPokemon.exe
// directo por accidente -- en vez de por el Control Panel, que ya lo abre con
// WindowStyle.Hidden -- se veia una consola negra con "Monitor Pokemon" en la barra de
// tareas, y si encima no habia token configurado, el wizard se reabria en bucle sin que
// quedara claro que estaba pasando. Antes el codigo ya DECIA "normally stays hidden" pero
// nada lo ocultaba realmente en este camino. Ahora se relanza a si mismo como proceso hijo
// oculto (windowsHide) y esta copia visible se cierra al toque -- el trabajo real sigue en
// la copia oculta, con el mismo log de siempre (logLinea ya escribe a archivo, no solo consola).
if (!process.env.MONITOR_LAUNCHER_HIDDEN) {
    const argsRelanzar = esSea ? [] : [ENTRY_PATH];
    spawn(process.execPath, argsRelanzar, {
        cwd: __dirname,
        stdio: 'ignore',
        detached: true,
        windowsHide: true,
        env: { ...process.env, MONITOR_LAUNCHER_HIDDEN: '1' }
    }).unref();
    process.exit(0);
}

// Ocultar el .exe motor de la vista (2026-08-08, a pedido explicito del usuario: no quiere
// que los usuarios vean/toquen MonitorPokemon.exe directo, solo el Panel) -- atributo Hidden
// de Windows, se reaplica en cada arranque por si el zip no lo preservo al descomprimir.
try {
    for (const nombre of ['MonitorPokemon.exe', 'bundle.js']) {
        const ruta = path.join(__dirname, nombre);
        if (fs.existsSync(ruta)) execSync(`attrib +h "${ruta}"`);
    }
} catch (e) { /* no critico -- si falla, el archivo sigue funcionando, solo queda visible */ }

const PENDING_UPDATE_PATH = path.join(__dirname, '.pending_update.json');
const PENDING_RESTART_PATH = path.join(__dirname, '.pending_restart.json');
const LOCK_PATH = path.join(__dirname, '.monitor.lock');

// Bug real reportado 2026-08-17: process.kill(pid, 0) solo confirma que EXISTE un proceso con
// ese numero de PID -- no que sea Monitor Pokemon. Windows reutiliza numeros de PID con el
// tiempo (normal en cualquier PC con uso real), asi que despues de suficientes reinicios el
// PID guardado en el lock puede terminar perteneciendo a un proceso completamente distinto
// (Explorer, un servicio, lo que sea) -- yaHayUnaCopiaAbierta() lo tomaba como "sigue abierto"
// y bloqueaba el arranque para siempre, sin que el usuario supiera por que ni como arreglarlo.
// Ahora ademas confirma que ESE PID puntual sea realmente MonitorPokemon.exe.
function procesoExiste(pid) {
    try {
        const salida = execSync(`tasklist /FI "PID eq ${pid}" /FI "IMAGENAME eq MonitorPokemon.exe" /NH`, { windowsHide: true }).toString();
        return salida.toLowerCase().includes('monitorpokemon.exe');
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
    const mensaje = 'Monitor Pokemon is already running in the background. No need to open it again.\n\nIf you want to change the token or add the Google Drive API key, open "MonitorPokemonPanel" and use "Open Token / API Settings".';
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

// v1.5.19 dejo de crear "Monitor Pokemon.lnk" (redundante con MonitorPokemonPanel.exe,
// que ya tiene su propio icono) -- pero quien ya lo tenia de una version vieja se queda
// con el archivo para siempre, porque el auto-update solo agrega/reemplaza archivos,
// nunca borra los que ya no hacen falta. Esto lo limpia solo, sin que el usuario tenga
// que hacer nada ni volver a bajar el zip entero.
const ACCESO_PANEL_VIEJO_PATH = path.join(__dirname, 'Monitor Pokemon.lnk');
function limpiarAccesoDirectoPanelViejo() {
    try { fs.unlinkSync(ACCESO_PANEL_VIEJO_PATH); } catch (e) { /* no existia, nada que limpiar */ }
}

// Carpeta de Inicio de Windows: cualquier acceso directo ahí arranca solo al
// iniciar sesión, sin necesitar permisos de administrador ni una Tarea
// Programada — a diferencia del Programador de Tareas, esto funciona igual
// para cualquier usuario que descargue el programa, no solo en esta PC.
function carpetaInicioWindows() {
    if (!process.env.APPDATA) return null;
    return path.join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
}

// Hasta 2026-07-31 esto CREABA el acceso directo (arrancaba el panel solo con
// Windows) -- a pedido explicito del usuario ("esto no deberia aparecer al
// iniciar la PC") ahora hace lo contrario: si de una version vieja ya quedo
// puesto, lo saca. El bot en si sigue arrancando con Windows via PM2 (eso no
// cambia), solo el panel de control deja de abrirse solo.
function limpiarAccesoDirectoInicioAutomatico() {
    const carpeta = carpetaInicioWindows();
    if (!carpeta) return;
    const rutaAcceso = path.join(carpeta, 'Monitor Pokemon.lnk');
    try { fs.unlinkSync(rutaAcceso); } catch (e) { /* no existia, nada que limpiar */ }
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
        // --use-system-ca se probo para un caso de antivirus interceptando HTTPS,
        // pero es un flag EXPERIMENTAL de Node con bugs reales del lado de
        // Windows: rompe la validacion de certificado contra GitHub con errores
        // internos raros ("Expected values to be equals", "Invalid string
        // length") en vez de un error de red normal -- confirmado en una PC
        // limpia, sin antivirus. Quitado: rompe mas de lo que arregla.
        // windowsHide (bug real reportado 2026-08-08: cada proceso hijo -- bot,
        // trading, heartbeat -- re-lanza el mismo .exe empaquetado, y sin esto
        // cada uno abre su propia ventana de consola visible en la barra de
        // tareas, confundiendo a la gente pensando que es una app aparte).
        windowsHide: true,
        env: { ...process.env, MONITOR_ROLE: def.rol }
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
    const rutaFalloUpdate = path.join(__dirname, 'update_fallo.txt');
    // Nota: "timeout" de Windows depende de tener una consola/stdin real y falla
    // (o se saltea) cuando corre sin ventana, como en nuestro caso — por eso las
    // esperas usan "ping" a localhost, el truco clásico que funciona sin consola.
    //
    // Reintento con limite (2026-08-06, bug real reportado por un usuario): si
    // el .exe viejo queda bloqueado (antivirus escaneandolo, o tarda en soltar
    // el handle), antes reintentaba "del" cada 2s PARA SIEMPRE -- ahora corta a
    // los 30 intentos (~1 minuto) y deja un aviso en update_fallo.txt en vez de
    // quedar en un loop infinito sin ningun indicio de que algo esta mal.
    const contenidoBat = [
        '@echo off',
        'ping 127.0.0.1 -n 4 >nul',
        'set intentos=0',
        ':retry',
        `del "${rutaExe}" 2>nul`,
        `if exist "${rutaExe}" (`,
        '  set /a intentos+=1',
        '  if %intentos% GEQ 30 goto fallo',
        '  ping 127.0.0.1 -n 2 >nul',
        '  goto retry',
        ')',
        `move /y "${rutaNueva}" "${rutaExe}"`,
        // "start" abre una consola visible por defecto — a diferencia de "Start
        // Monitor Pokemon.bat", que sí lo lanza oculto. Mismo patrón acá para
        // que el relanzamiento tras actualizar quede igual de invisible.
        `powershell -NoProfile -WindowStyle Hidden -Command "Start-Process -FilePath '${rutaExe.replace(/'/g, "''")}' -WorkingDirectory '${__dirname.replace(/'/g, "''")}' -WindowStyle Hidden"`,
        'del "%~f0"',
        'exit',
        ':fallo',
        `echo Could not replace MonitorPokemon.exe - the old file stayed locked for over a minute (likely antivirus). Close any antivirus scan on this folder and try Update Now again, or replace the .exe by hand with MonitorPokemon.new.exe. > "${rutaFalloUpdate}"`,
        `powershell -NoProfile -WindowStyle Hidden -Command "Start-Process -FilePath '${rutaExe.replace(/'/g, "''")}' -WorkingDirectory '${__dirname.replace(/'/g, "''")}' -WindowStyle Hidden"`,
        'del "%~f0"',
        ''
    ].join('\r\n');
    fs.writeFileSync(rutaBat, contenidoBat);

    // windowsHide (bug real reportado por un usuario, 2026-08-06): faltaba acá
    // -- sin esto, cmd.exe SIEMPRE abre una consola visible al ejecutar el
    // .bat (el "hidden" de mas abajo es solo para el relanzamiento final del
    // programa, no para esta ventana de cmd en si), y si el reintento tardaba
    // se veia como una ventana negra pegada en loop.
    const proc = spawn('cmd.exe', ['/c', rutaBat], { cwd: __dirname, detached: true, stdio: 'ignore', windowsHide: true });
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

// Limpieza de seguridad (2026-08-08, a pedido explicito del usuario): un usuario reporto
// haber visto el token/API real en una captura del PDF viejo de tutoriales via Foxit PDF
// Reader. Los tutoriales ya no se distribuyen como PDF, pero cada instalacion existente
// todavia tiene esos PDF viejos en disco. Se hace ACA (no solo en bot.js) porque launcher.js
// es el entrypoint real de un doble click -- si todavia no hay token configurado, el wizard
// se abre en un loop y bot.js nunca llega a correr, asi que la limpieza de bot.js sola no
// alcanzaba para instalaciones sin configurar. Corre siempre, en cada arranque; despues de
// la primera vez no encuentra nada y no hace nada.
function borrarPdfTutorialesViejos() {
    try {
        const carpetaTutorialesPdf = path.join(__dirname, 'assets', 'tutoriales');
        if (fs.existsSync(carpetaTutorialesPdf)) {
            for (const archivo of fs.readdirSync(carpetaTutorialesPdf)) {
                if (/\.pdf$/i.test(archivo)) {
                    fs.unlinkSync(path.join(carpetaTutorialesPdf, archivo));
                    console.log(`Seguridad: PDF de tutorial viejo borrado del disco -- ${archivo}`);
                }
            }
        }
        const pdfSuelto = path.join(__dirname, 'TUTORIAL MONITOR POKEMON.pdf');
        if (fs.existsSync(pdfSuelto)) {
            fs.unlinkSync(pdfSuelto);
            console.log('Seguridad: PDF de tutorial viejo borrado del disco -- TUTORIAL MONITOR POKEMON.pdf');
        }
    } catch (e) {
        console.error('Seguridad: no se pudo borrar los PDF viejos de tutoriales:', e.message);
    }
}

async function main() {
    borrarPdfTutorialesViejos();
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
    limpiarAccesoDirectoPanelViejo();
    limpiarAccesoDirectoInicioAutomatico();
    iniciarBandejaSistema();

    logLinea('🚀 Monitor Pokémon — starting bot, trading and heartbeat...');
    for (const def of PROCESOS) {
        iniciarProceso(def);
    }
}

process.on('SIGINT', cerrarTodo);
process.on('SIGTERM', cerrarTodo);

main();
