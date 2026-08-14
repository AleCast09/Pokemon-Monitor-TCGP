// Helper de solo lectura para el panel de control (PowerShell/WinForms no
// tiene forma simple de leer la DB ni de llamar a la API de Discord) — junta
// en un solo JSON todo lo que el panel necesita mostrar: version actual,
// si el token/API key configurados sirven de verdad, y nombre del bot/
// servidor/usuario. Cada dato se resuelve por separado (try/catch propio)
// para que un fallo puntual (ej. token invalido) no tumbe a los demas.
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { DatabaseSync } = require('node:sqlite');

// En el .exe empaquetado, entry.js bundlea este archivo junto con todo lo
// demás (esbuild reemplaza __dirname por la carpeta real del .exe en TODOS
// los módulos por igual, ya no existe una subcarpeta "scripts" separada) -
// por eso no se puede asumir "un nivel arriba de este archivo" como en modo
// desarrollo (donde este script sí vive suelto en scripts/panel-info.js).
const RAIZ = global.__baseDir || path.join(__dirname, '..');

function leerEnv() {
    const ruta = path.join(RAIZ,'.env');
    if (!fs.existsSync(ruta)) return {};
    const valores = {};
    for (const linea of fs.readFileSync(ruta, 'utf8').split(/\r?\n/)) {
        const match = linea.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
        if (match) valores[match[1]] = match[2];
    }
    return valores;
}

function leerVersion() {
    try {
        return JSON.parse(fs.readFileSync(path.join(RAIZ,'version.json'), 'utf8')).version;
    } catch (e) {
        return null;
    }
}

function leerDiscordIdConfigurado() {
    try {
        const db = new DatabaseSync(path.join(RAIZ,'database.db'));
        const fila = db.prepare(`SELECT discord_id FROM configs_canales WHERE discord_id IS NOT NULL AND discord_id != '' LIMIT 1`).get();
        return fila ? fila.discord_id : null;
    } catch (e) {
        return null;
    }
}

function leerCanalActualizaciones() {
    try {
        const db = new DatabaseSync(path.join(RAIZ,'database.db'));
        const fila = db.prepare(`SELECT canal_id FROM configs_canales WHERE tipo = 'actualizaciones' AND canal_id IS NOT NULL LIMIT 1`).get();
        return fila ? fila.canal_id : null;
    } catch (e) {
        return null;
    }
}

// Mismo criterio de comparacion que update-checker.js (chequearActualizaciones)
// - se duplica ese pedacito puntual acá en vez de requerir todo el modulo,
// que arrastra discord.js/database.js pensados para el bot ya corriendo, no
// para una consulta puntual y rapida como esta.
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

async function chequearVersionRemota(versionLocal) {
    try {
        const resp = await axios.get('https://raw.githubusercontent.com/AleCast09/Pokemon-Monitor-TCGP/main/version.json', { timeout: 5000 });
        if (esVersionMasNueva(resp.data.version, versionLocal)) return resp.data.version;
        return null;
    } catch (e) {
        return null;
    }
}

// Direcciones que hay que pegar en "P BOT" (la herramienta de Kevin/Arturo
// que lee el emulador) para que le mande los sobres/heartbeat a este bot -
// mismo cálculo que ya usa setup-wizard.js en la pantalla "Saved" del
// asistente, duplicado acá para que también se vea sin tener que reabrirlo.
function leerUrlsPBot(env) {
    const base = {
        S4T: Number(env.S4T_PORT) || 3000,
        Heartbeat: Number(env.HEARTBEAT_PORT) || 3003
    };
    const rutaAviso = path.join(RAIZ,'Ports in use.txt');
    if (fs.existsSync(rutaAviso)) {
        try {
            const contenido = fs.readFileSync(rutaAviso, 'utf8');
            for (const linea of contenido.split(/\r?\n/)) {
                const match = linea.match(/^(\w+): http:\/\/localhost:(\d+)$/);
                if (match && base[match[1]] !== undefined) base[match[1]] = Number(match[2]);
            }
        } catch (e) { /* se queda con los valores por defecto */ }
    }
    return { s4tUrl: `http://localhost:${base.S4T}`, heartbeatUrl: `http://localhost:${base.Heartbeat}` };
}

// Puerto del dashboard (2026-08-13, bug real encontrado en auditoria): el boton
// "Tutorials" del panel tenia el puerto pisado a mano en el .cs (3005), asi que si esta PC
// tiene DASHBOARD_PORT distinto en el .env, el boton abria una pagina muerta. Mismo criterio
// que DASHBOARD_PORT_BASE en bot.js -- no cubre el auto-fallback en vivo por puerto ocupado
// (eso solo lo sabe el proceso del bot ya corriendo), pero si el override manual del .env.
function leerPuertoDashboard(env) {
    return Number(env.DASHBOARD_PORT) || 3005;
}

async function main() {
    const env = leerEnv();
    const urlsPBot = leerUrlsPBot(env);
    const resultado = {
        version: leerVersion(),
        tokenPresente: !!(env.DISCORD_BOT_TOKEN && env.DISCORD_BOT_TOKEN.trim()),
        apiKeyPresente: !!(env.GOOGLE_DRIVE_API_KEY && env.GOOGLE_DRIVE_API_KEY.trim()),
        tokenValido: null,
        botNombre: null,
        servidorNombre: null,
        usuarioNombre: null,
        s4tUrl: urlsPBot.s4tUrl,
        heartbeatUrl: urlsPBot.heartbeatUrl,
        tutorialsUrl: `http://localhost:${leerPuertoDashboard(env)}/tutorials`,
        updateAvailable: false,
        remoteVersion: null,
        discordChannelUrl: null
    };

    const versionNueva = await chequearVersionRemota(resultado.version);
    if (versionNueva) {
        resultado.updateAvailable = true;
        resultado.remoteVersion = versionNueva;
    }

    if (resultado.tokenPresente) {
        const headers = { Authorization: `Bot ${env.DISCORD_BOT_TOKEN.trim()}` };
        try {
            const yo = await axios.get('https://discord.com/api/v10/users/@me', { headers, timeout: 5000 });
            resultado.tokenValido = true;
            resultado.botNombre = yo.data.username;
        } catch (e) {
            resultado.tokenValido = false;
        }

        if (resultado.tokenValido) {
            try {
                const guilds = await axios.get('https://discord.com/api/v10/users/@me/guilds', { headers, timeout: 5000 });
                if (guilds.data && guilds.data.length) {
                    resultado.servidorNombre = guilds.data[0].name;
                    if (resultado.updateAvailable) {
                        const canalId = leerCanalActualizaciones();
                        if (canalId) resultado.discordChannelUrl = `https://discord.com/channels/${guilds.data[0].id}/${canalId}`;
                    }
                }
            } catch (e) { /* no bloquea el resto */ }

            const discordId = leerDiscordIdConfigurado();
            if (discordId) {
                try {
                    const usuario = await axios.get(`https://discord.com/api/v10/users/${discordId}`, { headers, timeout: 5000 });
                    resultado.usuarioNombre = usuario.data.username;
                } catch (e) { /* no bloquea el resto */ }
            }
        }
    }

    process.stdout.write(JSON.stringify(resultado));
}

main();
