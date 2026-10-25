// Asistente del host de la comunidad (Zenith Bot). Dos usos:
//
//   node host-setup.js --make-key   (en la PC de Ale) arma una "clave de host" cifrada con lo que todos
//                                    los hosts comparten: IDs de la comunidad, staff, Upstash. Se le pasa
//                                    al host la clave por un lado y la contraseña por otro.
//   node host-setup.js              (en la PC del host, ej. wr98) pide la clave, la contraseña, SU token
//                                    de bot (el de su propio bot: nunca sale de su PC), su carpeta PTCGPB
//                                    y la del bot de Miguel; deja todo listo y lo arranca con PM2.
//
// El bot de Miguel NO viaja en la clave ni en este repo: cada host autorizado ya lo tiene en su PC.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const readline = require('readline');
const { execSync } = require('child_process');

const RAIZ = __dirname;
const CARPETA_HOST = path.join(process.env.LOCALAPPDATA || os.homedir(), 'MonitorPokemonHost');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const lineas = [];
const esperando = [];
rl.on('line', l => (esperando.length ? esperando.shift()(l.trim()) : lineas.push(l.trim())));
function preguntar(texto) {
    process.stdout.write(texto);
    return lineas.length ? Promise.resolve(lineas.shift()) : new Promise(r => esperando.push(r));
}

// Lo que viaja en la clave (todo lo demas lo pone cada host).
const VARIABLES_COMPARTIDAS = ['COMMUNITY_GUILD_IDS', 'COMMUNITY_STAFF_IDS', 'WR98_REDIS_URL', 'WR98_REDIS_TOKEN',
    'LINK_REDIS_URL', 'LINK_REDIS_TOKEN', 'LINK_REDIS_READONLY_TOKEN', 'GOOGLE_DRIVE_API_KEY'];

function cifrar(datos, clave) {
    const sal = crypto.randomBytes(16), iv = crypto.randomBytes(12);
    const llave = crypto.scryptSync(clave, sal, 32);
    const c = crypto.createCipheriv('aes-256-gcm', llave, iv);
    const cuerpo = Buffer.concat([c.update(JSON.stringify(datos), 'utf8'), c.final()]);
    return 'ZH1-' + Buffer.concat([sal, iv, c.getAuthTag(), cuerpo]).toString('base64url');
}

function descifrar(texto, clave) {
    const b = Buffer.from(String(texto).trim().replace(/^ZH1-/, ''), 'base64url');
    const llave = crypto.scryptSync(clave, b.subarray(0, 16), 32);
    const d = crypto.createDecipheriv('aes-256-gcm', llave, b.subarray(16, 28));
    d.setAuthTag(b.subarray(28, 44));
    return JSON.parse(Buffer.concat([d.update(b.subarray(44)), d.final()]).toString('utf8'));
}

async function armarClave() {
    require('dotenv').config({ path: path.join(RAIZ, '.env'), quiet: true });
    const datos = {};
    for (const v of VARIABLES_COMPARTIDAS) if (process.env[v]) datos[v] = process.env[v];
    if (!datos.COMMUNITY_GUILD_IDS || !datos.LINK_REDIS_URL || !datos.LINK_REDIS_TOKEN) {
        throw new Error('The .env of this PC is missing COMMUNITY_GUILD_IDS or LINK_REDIS_* — they are needed for the host key.');
    }
    const contrasena = crypto.randomBytes(9).toString('base64url');
    const clave = cifrar(datos, contrasena);
    const archivo = path.join(RAIZ, 'host-key.txt');
    fs.writeFileSync(archivo, clave + '\n');
    console.log(`\n✅ Host key saved in ${archivo}`);
    console.log(`🔑 Password: ${contrasena}`);
    console.log('\nSend the key file and the password to the host through DIFFERENT channels (for example the file by Discord DM and the password by WhatsApp).');
}

// ---- Bot de Miguel: Python y sus librerias (el host solo tiene que tener la carpeta descargada) ----
function probarPython(comando) {
    try {
        const v = execSync(`${comando} --version`, { stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
        return /^Python 3\./.test(v) ? v : null;
    } catch (e) { return null; }
}

// Devuelve el comando de Python a usar (o null). Si no hay, lo instala con winget.
function asegurarPython() {
    for (const c of ['python', 'py -3']) if (probarPython(c)) return c;
    console.log('🐍 Python is not installed — installing it (Windows may ask for permission)…');
    try {
        execSync('winget install -e --id Python.Python.3.12 --accept-source-agreements --accept-package-agreements', { stdio: 'inherit' });
    } catch (e) { /* se revisa abajo */ }
    const instalado = path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Python', 'Python312', 'python.exe');
    if (fs.existsSync(instalado) && probarPython(`"${instalado}"`)) return `"${instalado}"`;
    return probarPython('py -3') ? 'py -3' : null;
}

function prepararMotor(motor) {
    const python = asegurarPython();
    if (!python) {
        console.log('⚠️ Could not install Python by itself. Install Python 3.12 from https://www.python.org and run this setup again.');
        return null;
    }
    console.log(`📦 Installing what Miguel's bot needs (${probarPython(python)})… the first time takes a few minutes.`);
    try {
        execSync(`${python} -m pip install -r requirements.txt --disable-pip-version-check`, { cwd: motor, stdio: 'inherit' });
    } catch (e) {
        console.log('⚠️ Some parts of Miguel\'s bot could not be installed. Check your internet connection and run this setup again.');
    }
    // Ruta exacta del python.exe (el bot lo lanza directo, sin pasar por "py -3").
    try { return execSync(`${python} -c "import sys; print(sys.executable)"`).toString().trim(); } catch (e) { return null; }
}

// La hora de la PC tiene que estar bien: si esta corrida, Nintendo rechaza el login
// ("Device datetime is out of alignment").
async function revisarHora() {
    try {
        const r = await fetch('https://www.google.com', { method: 'HEAD', signal: AbortSignal.timeout(10000) });
        const diferencia = Math.abs(Date.now() - new Date(r.headers.get('date')).getTime()) / 1000;
        if (diferencia > 120) {
            console.log(`\n⚠️ This PC's clock is off by ${Math.round(diferencia / 60)} minutes. Fix it or the game will reject the logins:`);
            console.log('   Windows Settings → Time & language → Date & time → turn on "Set time automatically" → Sync now.\n');
        }
    } catch (e) { /* sin internet: no se puede comparar */ }
}

function derivarRutas(main) {
    const base = main.replace(/[\\/]+$/, '');
    return {
        ruta_master: path.join(base, 'Helper'),
        ruta_xml_cuentas: path.join(base, 'Accounts', 'Saved'),
        ruta_json_cuentas: path.join(base, 'Accounts', 'Cards', 'accounts'),
        ruta_wishlist: path.join(base, 'Accounts', 'Cards')
    };
}

async function instalarHost() {
    console.log('Monitor Pokemon — community host setup (Zenith Bot)\n');
    let datos;
    while (!datos) {
        let texto = await preguntar('Paste the host key (starts with ZH1-), or the path of host-key.txt: ');
        texto = texto.replace(/^"|"$/g, '');
        if (fs.existsSync(texto)) texto = fs.readFileSync(texto, 'utf8').trim();
        const contrasena = await preguntar('Password: ');
        try { datos = descifrar(texto, contrasena); } catch (e) { console.log('❌ Wrong key or password. Try again.\n'); }
    }

    // El bot de ESTE host (cada host usa el suyo; su token no viaja en la clave ni sale de esta PC).
    console.log('\nYour own Discord bot (Developer Portal -> your app). It must be in Zenith Rise with Administrator.');
    const tokenBot = await preguntar('  Bot token: ');
    const idApp = await preguntar('  Application ID: ');

    let main = '';
    while (!fs.existsSync(path.join(main, 'Helper', 'cardmaster.json'))) {
        main = (await preguntar('Your PTCGPB folder (Main Path, it has Helper and Accounts inside): ')).replace(/^"|"$/g, '');
        if (!fs.existsSync(path.join(main, 'Helper', 'cardmaster.json'))) console.log('❌ No Helper\\cardmaster.json there.');
    }
    let motor = '';
    while (!fs.existsSync(path.join(motor, 'auto_trade.py'))) {
        motor = (await preguntar('Folder of Miguel\'s bot (ptcgp-capturedeluxe, has auto_trade.py): ')).replace(/^"|"$/g, '');
        if (!fs.existsSync(path.join(motor, 'auto_trade.py'))) console.log('❌ No auto_trade.py there.');
    }
    const nombre = (await preguntar(`Name for this host (shown in the logs) [${os.hostname()}]: `)) || os.hostname();

    const python = prepararMotor(motor);
    await revisarHora();

    fs.mkdirSync(CARPETA_HOST, { recursive: true });
    const env = {
        ...datos,
        DISCORD_BOT_TOKEN: tokenBot,
        DISCORD_CLIENT_ID: idApp,
        HOST_NAME: nombre,
        MONITOR_DB_PATH: path.join(CARPETA_HOST, 'host.db'),
        DASHBOARD_PORT: '3006',
        FAST_TRANSFER_ENGINE_DIR: motor,
        ...(python ? { FAST_TRANSFER_PYTHON: python } : {})
    };
    fs.writeFileSync(path.join(CARPETA_HOST, '.env'), Object.entries(env).map(([k, v]) => `${k}=${v}`).join('\n') + '\n');

    // Rutas del bot (cartas, nombres, imagenes) en la base del host.
    process.env.MONITOR_DB_PATH = env.MONITOR_DB_PATH;
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(env.MONITOR_DB_PATH);
    db.exec(`CREATE TABLE IF NOT EXISTS configs_canales (discord_id TEXT, tipo TEXT, canal_id TEXT, webhook_url TEXT, PRIMARY KEY (discord_id, tipo))`);
    const guild = String(datos.COMMUNITY_GUILD_IDS).split(',')[0].trim();
    for (const [tipo, ruta] of Object.entries(derivarRutas(main))) {
        db.prepare(`INSERT INTO configs_canales (discord_id, tipo, canal_id, webhook_url) VALUES (?, ?, NULL, ?)
            ON CONFLICT(discord_id, tipo) DO UPDATE SET webhook_url = excluded.webhook_url`).run(guild, tipo, ruta);
    }
    db.close();
    console.log(`\n✅ Host ready in ${CARPETA_HOST}`);

    try {
        execSync(`pm2 delete zenith`, { stdio: 'ignore' });
    } catch (e) { /* no estaba */ }
    try {
        execSync(`pm2 start "${path.join(RAIZ, 'host.js')}" --name zenith --cwd "${CARPETA_HOST}" --shutdown-with-message --kill-timeout 8000`, { stdio: 'inherit' });
        execSync('pm2 save', { stdio: 'inherit' });
        // En Windows PM2 no vuelve solo despues de reiniciar la PC: un acceso en Inicio lo levanta
        // (oculto, sin ventana) con lo guardado por "pm2 save".
        const inicio = path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
        if (fs.existsSync(inicio)) {
            fs.writeFileSync(path.join(inicio, 'Monitor Pokemon Host.vbs'),
                'CreateObject("WScript.Shell").Run "cmd /c pm2 resurrect", 0, False\r\n');
            console.log('🔁 It will also start by itself when Windows starts.');
        }
        console.log('\n🚀 Started. If another host has the turn, this one stays on standby (its commands hidden) and takes over when that one goes offline.');
        console.log('   See it with:  pm2 logs zenith');
    } catch (e) {
        console.log('\n⚠️ Could not start it with PM2. Install PM2 (npm i -g pm2) and run this setup again.');
    }
}

(async () => {
    try {
        if (process.argv.includes('--make-key')) await armarClave();
        else await instalarHost();
    } catch (e) {
        console.error('❌', e.message);
        process.exitCode = 1;
    }
    rl.close();
})();
