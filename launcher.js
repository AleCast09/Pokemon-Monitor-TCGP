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
        if (fs.existsSync(ruta)) execSync(`attrib +h "${ruta}"`, { windowsHide: true });
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
    exec(`powershell -NoProfile -WindowStyle Hidden -Command "${script}"`, { windowsHide: true }, () => {});
}

const ACCESO_CONFIGURAR_PATH = path.join(__dirname, 'Change token or API key.lnk');

function crearAccesoDirectoConfigurar() {
    if (fs.existsSync(ACCESO_CONFIGURAR_PATH)) return;
    const destino = path.join(__dirname, 'Advanced', 'Reconfigure.bat');
    if (!fs.existsSync(destino)) return;
    const script = `$s = (New-Object -ComObject WScript.Shell).CreateShortcut('${ACCESO_CONFIGURAR_PATH.replace(/'/g, "''")}'); $s.TargetPath = '${destino.replace(/'/g, "''")}'; $s.WorkingDirectory = '${__dirname.replace(/'/g, "''")}'; $s.Save()`;
    exec(`powershell -NoProfile -WindowStyle Hidden -Command "${script.replace(/"/g, '\\"')}"`, { windowsHide: true }, () => {});
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

// BUILD_VERSION (2026-08-23, bug real reportado por un usuario -- wR98): __BUILD_VERSION__ es
// una constante grabada literal en el bundle al compilar (ver scripts/build-exe.js) -- la
// version REAL con la que se compilo este .exe, independiente de lo que version.json diga en
// disco (ese archivo se sobreescribe con la version nueva desde el momento de la descarga,
// antes de que el swap del .exe siquiera se intente -- ver el comentario grande en
// iniciarActualizacion mas abajo). En modo dev (sin bundlear) __BUILD_VERSION__ no existe --
// typeof no tira error sobre un identificador no declarado, a diferencia de usarlo directo.
const BUILD_VERSION = typeof __BUILD_VERSION__ !== 'undefined' ? __BUILD_VERSION__ : null;
const VERSION_JSON_PATH = path.join(__dirname, 'version.json');

function esVersionMasNueva(remota, local) {
    const a = String(remota).split('.').map(Number);
    const b = String(local).split('.').map(Number);
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
        const x = a[i] || 0, y = b[i] || 0;
        if (x > y) return true;
        if (x < y) return false;
    }
    return false;
}

// Se corre una sola vez al arrancar (main(), antes de levantar bot/trading/heartbeat): si
// version.json en disco dice una version mas nueva que la que esta copia REALMENTE es
// (BUILD_VERSION) Y todavia queda un MonitorPokemon.new.exe sin instalar (prueba de que se
// llego a descargar pero el swap nunca se completo, sea por lo que sea -- este bug existia
// antes del reintento automatico de mas abajo, asi que instalaciones que ya se quedaron
// pegadas de esa forma no tienen ningun .pending_update.json para reintentar solas), se
// re-arma el flag desde cero para que el mecanismo de reintento normal lo termine sin que el
// usuario tenga que notar nada raro (boton gris, version rara en el Panel, etc.) y reportarlo.
function sanarSwapIncompletoSiHaceFalta() {
    if (!esSea || !BUILD_VERSION) return;
    try {
        if (fs.existsSync(PENDING_UPDATE_PATH)) return;
        const disco = JSON.parse(fs.readFileSync(VERSION_JSON_PATH, 'utf8'));
        const rutaNueva = path.join(__dirname, 'MonitorPokemon.new.exe');
        if (disco.version && esVersionMasNueva(disco.version, BUILD_VERSION) && fs.existsSync(rutaNueva)) {
            logLinea(`⚠️ Detected an incomplete update from a previous run (this copy is still v${BUILD_VERSION}, disk reports v${disco.version}) -- re-queuing the swap to finish it automatically.`);
            fs.writeFileSync(PENDING_UPDATE_PATH, JSON.stringify({ version: disco.version, listoEn: Date.now() }));
        }
    } catch (e) {}
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

    // Bug real reportado 2026-08-23 (wR98): version.json ya se sobreescribe con la version
    // nueva en el momento de la descarga (update-checker.js, antes de que el swap del .exe
    // siquiera se intente) -- antes ESTA funcion borraba .pending_update.json de entrada, sin
    // saber todavia si el "move" del .bat mas abajo iba a funcionar. Si el .exe viejo quedaba
    // trabado (antivirus escaneandolo) mas de los 30 reintentos (~1 min), el swap fallaba en
    // silencio, el flag ya no existia para reintentar, y el usuario quedaba PARA SIEMPRE
    // corriendo el .exe viejo mientras version.json (y el Panel) mostraban la version nueva --
    // "restart", "kill everything" y "quit" no arreglaban nada porque no habia nada pendiente
    // que reintentar. Ahora el borrado de .pending_update.json pasa a depender del resultado
    // real del swap (lo hace el propio .bat, recien despues del "move"), y se cuentan los
    // intentos fallidos (intentosSwap, guardado en el mismo .pending_update.json) para
    // reintentar solo en el proximo arranque -- hasta 3 veces -- antes de rendirse y avisar
    // con un popup real (antes solo quedaba un update_fallo.txt que nadie revisaba nunca).
    let pendiente = {};
    try { pendiente = JSON.parse(fs.readFileSync(PENDING_UPDATE_PATH, 'utf8')); } catch (e) {}
    const intentosPrevios = Number(pendiente.intentosSwap) || 0;
    const esUltimoIntento = intentosPrevios >= 2;

    cerrando = true;
    logLinea(`🔄 Update ready — replacing the program... (attempt ${intentosPrevios + 1}/3)`);

    await Promise.all(PROCESOS.map((def) => new Promise((resolve) => {
        if (!def.instancia || def.instancia.killed || def.instancia.exitCode !== null) return resolve();
        def.instancia.once('exit', resolve);
        def.instancia.kill();
    })));

    if (!esSea) {
        try { fs.unlinkSync(PENDING_UPDATE_PATH); } catch (e) {}
        logLinea('⚠️ Auto-update only applies to the packaged .exe — skipped in development mode.');
        process.exit(0);
        return;
    }

    // Se guarda el intento incrementado ANTES de correr el .bat (no despues): si el proceso
    // se corta a mitad de camino (apagon, crash), el proximo arranque igual cuenta este
    // intento como gastado en vez de repetirlo infinitamente.
    try {
        fs.writeFileSync(PENDING_UPDATE_PATH, JSON.stringify({ ...pendiente, intentosSwap: intentosPrevios + 1 }));
    } catch (e) {}

    const rutaExe = process.execPath;
    const rutaNueva = path.join(__dirname, 'MonitorPokemon.new.exe');
    const rutaBat = path.join(__dirname, '_update.bat');
    const rutaFalloUpdate = path.join(__dirname, 'update_fallo.txt');
    const rutaPendiente = PENDING_UPDATE_PATH;
    const mensajePopup = esUltimoIntento
        ? 'Monitor Pokemon could not finish updating automatically after 3 tries (the old .exe stayed locked, likely antivirus). Please download the latest version by hand from https://github.com/AleCast09/Pokemon-Monitor-TCGP/releases/latest and replace MonitorPokemon.exe with it.'
        : '';
    // Nota: "timeout" de Windows depende de tener una consola/stdin real y falla
    // (o se saltea) cuando corre sin ventana, como en nuestro caso — por eso las
    // esperas usan "ping" a localhost, el truco clásico que funciona sin consola.
    //
    // Reintento con limite (2026-08-06, bug real reportado por un usuario): si
    // el .exe viejo queda bloqueado (antivirus escaneandolo, o tarda en soltar
    // el handle), antes reintentaba "del" cada 2s PARA SIEMPRE -- ahora corta a
    // los 30 intentos (~1 minuto) por corrida y deja un aviso en update_fallo.txt.
    //
    // .pending_update.json (2026-08-23): solo se borra en el ":ok" (swap realmente
    // confirmado) o en el ":fallo" del 3er intento (esUltimoIntento) -- si falla antes
    // de eso, queda con intentosSwap ya incrementado para que el proximo arranque
    // reintente solo, sin que el usuario tenga que hacer nada.
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
        `del "${rutaPendiente}" 2>nul`,
        `del "${rutaFalloUpdate}" 2>nul`,
        // "start" abre una consola visible por defecto — a diferencia de "Start
        // Monitor Pokemon.bat", que sí lo lanza oculto. Mismo patrón acá para
        // que el relanzamiento tras actualizar quede igual de invisible.
        `powershell -NoProfile -WindowStyle Hidden -Command "Start-Process -FilePath '${rutaExe.replace(/'/g, "''")}' -WorkingDirectory '${__dirname.replace(/'/g, "''")}' -WindowStyle Hidden"`,
        'del "%~f0"',
        'exit',
        ':fallo',
        `echo Could not replace MonitorPokemon.exe - the old file stayed locked for over a minute (likely antivirus). Attempt ${intentosPrevios + 1}/3. > "${rutaFalloUpdate}"`,
        ...(esUltimoIntento ? [
            // Bug real reportado en vivo 2026-08-27 (usuario "Naja"): borrar solo
            // .pending_update.json no alcanzaba -- MonitorPokemon.new.exe seguia existiendo,
            // y sanarSwapIncompletoSiHaceFalta() (arriba en este mismo archivo) lo detecta como
            // "actualizacion incompleta" en el proximo arranque y vuelve a armar el intento
            // desde 0, mostrando el mismo popup para siempre en loop -- exactamente lo que
            // reporto el usuario ("si le doy OK sigue abriendo terminal y muestra este popup de
            // nuevo"). Borrando tambien el .new.exe aca, no queda nada que el chequeo de
            // reparacion pueda encontrar -- el popup se muestra UNA vez de verdad.
            `del "${rutaNueva}" 2>nul`,
            `del "${rutaPendiente}" 2>nul`,
            `powershell -NoProfile -STA -WindowStyle Hidden -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.MessageBox]::Show('${mensajePopup.replace(/'/g, "''")}', 'Monitor Pokemon - Update Failed')"`
        ] : []),
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
        try { exec(`taskkill /pid ${procesoBandeja.pid} /T /F`, { windowsHide: true }); } catch (e) {}
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
    sanarSwapIncompletoSiHaceFalta();

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
