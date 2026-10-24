// Asistente del host de la comunidad (Zenith Bot). Dos usos:
//
//   node host-setup.js --make-key   (en la PC de Ale) arma una "clave de host" cifrada con todo lo que
//                                    un host necesita: token de Zenith Bot, IDs de la comunidad, Upstash.
//                                    Se le pasa al host la clave por un lado y la contraseña por otro.
//   node host-setup.js              (en la PC del host, ej. wr98) pide la clave, la contraseña, su
//                                    carpeta PTCGPB y la del bot de Miguel; deja todo listo y lo arranca
//                                    con PM2 (host.js decide solo si queda activo o en espera).
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
    console.log('Zenith Bot (Discord Developer Portal → your app):');
    datos.DISCORD_BOT_TOKEN = await preguntar('  Bot token: ');
    datos.DISCORD_CLIENT_ID = await preguntar('  Application ID: ');
    const contrasena = crypto.randomBytes(9).toString('base64url');
    const clave = cifrar(datos, contrasena);
    const archivo = path.join(RAIZ, 'host-key.txt');
    fs.writeFileSync(archivo, clave + '\n');
    console.log(`\n✅ Host key saved in ${archivo}`);
    console.log(`🔑 Password: ${contrasena}`);
    console.log('\nSend the key file and the password to the host through DIFFERENT channels (for example the file by Discord DM and the password by WhatsApp).');
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

    fs.mkdirSync(CARPETA_HOST, { recursive: true });
    const env = {
        ...datos,
        HOST_NAME: nombre,
        MONITOR_DB_PATH: path.join(CARPETA_HOST, 'host.db'),
        DASHBOARD_PORT: '3006',
        FAST_TRANSFER_ENGINE_DIR: motor
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
        execSync(`pm2 start "${path.join(RAIZ, 'host.js')}" --name zenith --cwd "${CARPETA_HOST}"`, { stdio: 'inherit' });
        execSync('pm2 save', { stdio: 'inherit' });
        console.log('\n🚀 Started. If another host is active, this one waits and takes over when that one goes offline.');
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
