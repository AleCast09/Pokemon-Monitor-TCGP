// Host de la comunidad (2026-10-24, plan de Ale: Zenith Bot con varios hosts -- Ale, wr98, ...).
// Corre el MISMO bot.js, pero como el bot de la comunidad (MONITOR_HOST_MODE=community: solo atiende
// COMMUNITY_GUILD_IDS) y SOLO si ningun otro host esta activo. El candado vive en Upstash
// (LINK_REDIS_*): el host activo lo renueva cada 30 s; si se apaga, a los ~90 s lo toma otro.
// Mientras espera no se conecta a Discord ni levanta nada, asi nunca responden dos a la vez.
//
// Se arranca desde la carpeta del host (la que tiene su .env y su base), por ejemplo con PM2:
//   pm2 start "<repo>\host.js" --name zenith --cwd "<carpeta del host>"
'use strict';
require('dotenv').config();
process.env.MONITOR_HOST_MODE = 'community';

const os = require('os');
const crypto = require('crypto');

const URL_REDIS = (process.env.LINK_REDIS_URL || '').replace(/\/+$/, '');
const TOKEN_REDIS = process.env.LINK_REDIS_TOKEN || '';
const CLAVE = 'zenith:host';
const VIDA_MS = 90 * 1000;
const CADA_MS = 30 * 1000;
// Quien soy (para los avisos): nombre del host del .env o el de la PC, mas un sufijo por arranque.
const YO = `${process.env.HOST_NAME || os.hostname()}#${crypto.randomBytes(3).toString('hex')}`;

// Toma el candado si esta libre o ya es mio (y lo renueva). 1 = soy el host activo.
const SCRIPT = `local v = redis.call('GET', KEYS[1])
if (not v) or v == ARGV[1] then redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[2]) return 1 end
return 0`;

async function redis(...comando) {
    const r = await fetch(URL_REDIS, {
        method: 'POST',
        headers: { Authorization: `Bearer ${TOKEN_REDIS}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(comando),
        signal: AbortSignal.timeout(10000)
    });
    const j = await r.json();
    if (j.error) throw new Error(j.error);
    return j.result;
}

const tomar = async () => (await redis('EVAL', SCRIPT, '1', CLAVE, YO, String(VIDA_MS))) === 1;

let activo = false;
async function ciclo() {
    let mio;
    try {
        mio = await tomar();
    } catch (e) {
        // Sin Upstash no se decide nada: el activo sigue, el que espera sigue esperando.
        console.error(`⚠️ Host lock: Upstash no responde (${e.message})`);
        return;
    }
    if (mio && !activo) {
        activo = true;
        console.log(`👑 ${YO} is now the active community host — starting the bot.`);
        require('./bot.js');
    } else if (!mio && activo) {
        // Otro host lo tomo (por ejemplo, esta PC estuvo sin internet mas de 90 s): este se baja
        // para no responder doble. PM2 lo vuelve a levantar y queda esperando.
        console.log(`🔁 Another host took over — stopping ${YO}.`);
        process.exit(0);
    } else if (!mio) {
        const actual = await redis('GET', CLAVE).catch(() => null);
        console.log(`⏸️ Standby — the active host is ${actual || 'unknown'}. Checking again in ${CADA_MS / 1000} s.`);
    }
}

// Al apagarse bien (pm2 stop, cerrar), suelta el candado para que otro tome el relevo enseguida.
async function soltar() {
    if (activo) await redis('EVAL', `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0`, '1', CLAVE, YO).catch(() => {});
    process.exit(0);
}
process.on('SIGINT', soltar);
process.on('SIGTERM', soltar);

if (!URL_REDIS || !TOKEN_REDIS || !process.env.COMMUNITY_GUILD_IDS) {
    console.error('❌ This host is not set up: LINK_REDIS_URL, LINK_REDIS_TOKEN and COMMUNITY_GUILD_IDS are required (run the host setup).');
    process.exit(1);
}
console.log(`Community host ${YO} starting…`);
ciclo();
setInterval(ciclo, CADA_MS);
