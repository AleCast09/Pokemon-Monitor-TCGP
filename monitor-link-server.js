// Monitor Link -- lado del bot (2026-10-23, plan de Ale): cada miembro corre "Monitor Link" en SU PC,
// lo vincula a su usuario de Discord con /link y sube el RESUMEN de sus cartas (que cartas y cuantas
// copias tiene cada cuenta, y su Shinedust). Nunca viajan contraseñas ni XML en este paso.
//
// Rutas (en el mismo servidor web del Dashboard, puerto 3005, publico por el tunel de Cloudflare):
//   POST /link/claim    { code }                      -> { token, user }   (canjea el codigo de /link)
//   POST /link/summary  Bearer token, texto JSON      -> { ok, accounts }  (resumen de cartas)
//   GET  /link/ping     Bearer token                  -> { ok, user }
//
// Seguridad: el codigo de /link vence en 10 min y es de un solo uso; el token se guarda solo como
// hash; cada token solo puede escribir el resumen de SU dueño; limite de intentos por IP.
const crypto = require('crypto');
const express = require('express');

const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sin 0/O/1/I para que no se confundan
const VIDA_CODIGO_MS = 10 * 60 * 1000;
const intentosPorIp = new Map(); // ip -> { n, desde }

let db = null;

const hash = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');

async function asegurarTablas() {
    await db.run(`CREATE TABLE IF NOT EXISTS link_codigos (
        codigo TEXT PRIMARY KEY, discord_id TEXT, guild_id TEXT, expira INTEGER)`);
    await db.run(`CREATE TABLE IF NOT EXISTS link_agentes (
        token_hash TEXT PRIMARY KEY, discord_id TEXT, guild_id TEXT, creado INTEGER, ultimo INTEGER, version TEXT)`);
    await db.run(`CREATE TABLE IF NOT EXISTS link_resumen (
        discord_id TEXT PRIMARY KEY, guild_id TEXT, datos TEXT, cuentas INTEGER, ts INTEGER)`);
}

// Codigo de un solo uso para /link. Un usuario solo tiene un codigo vivo a la vez.
async function crearCodigo(discordId, guildId) {
    await asegurarTablas();
    await db.run(`DELETE FROM link_codigos WHERE discord_id = ? OR expira < ?`, [String(discordId), Date.now()]);
    let codigo = '';
    for (const b of crypto.randomBytes(8)) codigo += ALFABETO[b % ALFABETO.length];
    await db.run(`INSERT INTO link_codigos (codigo, discord_id, guild_id, expira) VALUES (?, ?, ?, ?)`,
        [codigo, String(discordId), String(guildId || ''), Date.now() + VIDA_CODIGO_MS]);
    return codigo;
}

// ---- Libreta de direcciones (Upstash propio de Ale, opcional) ----
// La direccion publica del bot (tunel de Cloudflare) cambia en cada reinicio. El bot la anota en la
// libreta al arrancar; Monitor Link guarda la llave de SOLO LECTURA de la libreta y, si no encuentra al
// bot, mira ahi la direccion nueva y sigue solo -- el miembro nunca tiene que vincular de nuevo.
// .env: LINK_REDIS_URL, LINK_REDIS_TOKEN (escritura, solo en el bot), LINK_REDIS_READONLY_TOKEN.
const CLAVE_LIBRETA = 'monitor_link:url';

async function publicarDireccion(urlPublica) {
    const url = process.env.LINK_REDIS_URL, token = process.env.LINK_REDIS_TOKEN;
    if (!url || !token || !urlPublica) return false;
    try {
        const r = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify(['SET', CLAVE_LIBRETA, urlPublica]) });
        return r.ok;
    } catch (e) {
        console.error('DEBUG: Monitor Link no pudo anotar la direccion en la libreta:', e?.message || e);
        return false;
    }
}

// "Clave de vinculacion" = direccion del bot + codigo (+ la libreta de solo lectura si existe), en un
// solo texto para pegar.
function armarClave(urlPublica, codigo) {
    const libUrl = process.env.LINK_REDIS_URL, libRo = process.env.LINK_REDIS_READONLY_TOKEN;
    if (libUrl && libRo) return 'ML2-' + Buffer.from([urlPublica, codigo, libUrl, libRo].join('|')).toString('base64url');
    return 'ML1-' + Buffer.from(`${urlPublica}|${codigo}`).toString('base64url');
}

function demasiadosIntentos(ip) {
    const ahora = Date.now();
    const r = intentosPorIp.get(ip) || { n: 0, desde: ahora };
    if (ahora - r.desde > VIDA_CODIGO_MS) { r.n = 0; r.desde = ahora; }
    r.n++;
    intentosPorIp.set(ip, r);
    return r.n > 20;
}

async function agenteDe(req) {
    const m = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization || '');
    if (!m) return null;
    const fila = await db.get(`SELECT discord_id, guild_id FROM link_agentes WHERE token_hash = ?`, [hash(m[1])]);
    if (!fila) return null;
    await db.run(`UPDATE link_agentes SET ultimo = ? WHERE token_hash = ?`, [Date.now(), hash(m[1])]);
    return fila;
}

function registrar(app, dependencias) {
    db = dependencias.db;
    const nombreUsuario = dependencias.nombreUsuario || (async () => null);

    app.post('/link/claim', express.json(), async (req, res) => {
        try {
            await asegurarTablas();
            const ip = req.headers['cf-connecting-ip'] || req.socket.remoteAddress || '?';
            if (demasiadosIntentos(ip)) return res.status(429).json({ error: 'too_many_attempts' });
            const codigo = String(req.body?.code || '').trim().toUpperCase();
            const fila = await db.get(`SELECT discord_id, guild_id, expira FROM link_codigos WHERE codigo = ?`, [codigo]);
            if (!fila || fila.expira < Date.now()) return res.status(404).json({ error: 'invalid_or_expired_code' });
            await db.run(`DELETE FROM link_codigos WHERE codigo = ?`, [codigo]); // un solo uso
            // Un agente por usuario: vincular de nuevo reemplaza al anterior.
            await db.run(`DELETE FROM link_agentes WHERE discord_id = ?`, [fila.discord_id]);
            const token = crypto.randomBytes(32).toString('hex');
            await db.run(`INSERT INTO link_agentes (token_hash, discord_id, guild_id, creado, ultimo, version) VALUES (?, ?, ?, ?, ?, ?)`,
                [hash(token), fila.discord_id, fila.guild_id, Date.now(), Date.now(), String(req.body?.version || '')]);
            res.json({ token, user: (await nombreUsuario(fila.discord_id)) || fila.discord_id });
        } catch (e) {
            console.error('DEBUG: Monitor Link /claim:', e?.message || e);
            res.status(500).json({ error: 'server_error' });
        }
    });

    app.get('/link/ping', async (req, res) => {
        try {
            await asegurarTablas();
            const agente = await agenteDe(req);
            if (!agente) return res.status(401).json({ error: 'not_linked' });
            res.json({ ok: true, user: (await nombreUsuario(agente.discord_id)) || agente.discord_id });
        } catch (e) {
            res.status(500).json({ error: 'server_error' });
        }
    });

    // El resumen de ~1200 cuentas pesa unos MB: se manda como texto (no pasa por el express.json
    // global del Dashboard, que corta en 100 KB).
    app.post('/link/summary', express.text({ type: 'text/plain', limit: '40mb' }), async (req, res) => {
        try {
            await asegurarTablas();
            const agente = await agenteDe(req);
            if (!agente) return res.status(401).json({ error: 'not_linked' });
            let datos;
            try { datos = JSON.parse(req.body || '{}'); } catch (e) { return res.status(400).json({ error: 'bad_json' }); }
            const cuentas = Array.isArray(datos.accounts) ? datos.accounts : [];
            // Solo campos esperados: nombre de archivo, nombre visible, cartas {id: copias}, Shinedust.
            const limpias = cuentas.slice(0, 5000).map(c => ({
                f: String(c.f || '').slice(0, 120),
                n: String(c.n || '').slice(0, 120),
                d: Number.isFinite(c.d) ? c.d : null,
                c: Object.fromEntries(Object.entries(c.c || {})
                    .filter(([id, n]) => /^[A-Za-z0-9_]{5,40}$/.test(id) && Number.isInteger(n) && n > 0 && n < 100000))
            })).filter(c => c.f);
            await db.run(
                `INSERT INTO link_resumen (discord_id, guild_id, datos, cuentas, ts) VALUES (?, ?, ?, ?, ?)
                 ON CONFLICT(discord_id) DO UPDATE SET guild_id = excluded.guild_id, datos = excluded.datos, cuentas = excluded.cuentas, ts = excluded.ts`,
                [agente.discord_id, agente.guild_id, JSON.stringify(limpias), limpias.length, Date.now()]);
            res.json({ ok: true, accounts: limpias.length });
        } catch (e) {
            console.error('DEBUG: Monitor Link /summary:', e?.message || e);
            res.status(500).json({ error: 'server_error' });
        }
    });
}

// ---- Datos derivados del resumen, en memoria (las funciones del bot que los usan son sincronicas) ----
// cache: discordId -> { ts, cuentas, mapaCopias }. precargar() se llama al empezar cada interaccion de
// comunidad; despues mapaCopiasDe/cuentasPorCartaDe/shinedustDe responden al instante.
const cache = new Map();

async function precargar(discordId) {
    await asegurarTablas();
    const fila = await db.get(`SELECT ts FROM link_resumen WHERE discord_id = ?`, [String(discordId)]);
    if (!fila) { cache.delete(String(discordId)); return false; }
    const c = cache.get(String(discordId));
    if (c && c.ts === fila.ts) return true;
    const r = await resumenDe(discordId);
    if (!r) return false;
    const mapaCopias = {};
    for (const cuenta of r.cuentas) {
        for (const [id, n] of Object.entries(cuenta.c || {})) (mapaCopias[id] ||= []).push({ fileName: cuenta.f, cantidad: n });
    }
    for (const id of Object.keys(mapaCopias)) mapaCopias[id].sort((a, b) => b.cantidad - a.cantidad);
    cache.set(String(discordId), { ts: fila.ts, cuentas: r.cuentas, mapaCopias });
    return true;
}

function mapaCopiasDe(discordId) {
    return cache.get(String(discordId))?.mapaCopias || {};
}

function cuentasPorCartaDe(discordId, cartaId) {
    return (mapaCopiasDe(discordId)[cartaId] || []).map(r => ({ ...r }));
}

// Mismo formato que buscarShinedustTodasCuentas de bot.js.
function shinedustDe(discordId) {
    return (cache.get(String(discordId))?.cuentas || [])
        .filter(c => typeof c.d === 'number')
        .map(c => ({ nombreCuenta: c.n || c.f, valor: c.d, fileNameXml: c.f, archivoJson: c.f }))
        .sort((a, b) => b.valor - a.valor);
}

// Para los comandos: resumen subido por un usuario (o null) y si su Monitor Link esta en linea.
async function resumenDe(discordId) {
    await asegurarTablas();
    const fila = await db.get(`SELECT datos, cuentas, ts FROM link_resumen WHERE discord_id = ?`, [String(discordId)]);
    if (!fila) return null;
    try { return { cuentas: JSON.parse(fila.datos), total: fila.cuentas, ts: fila.ts }; } catch (e) { return null; }
}

async function estadoAgente(discordId) {
    await asegurarTablas();
    const fila = await db.get(`SELECT ultimo FROM link_agentes WHERE discord_id = ?`, [String(discordId)]);
    if (!fila) return { vinculado: false, enLinea: false };
    return { vinculado: true, enLinea: Date.now() - (fila.ultimo || 0) < 3 * 60 * 1000, ultimo: fila.ultimo };
}

module.exports = { registrar, crearCodigo, armarClave, publicarDireccion, resumenDe, estadoAgente, precargar, mapaCopiasDe, cuentasPorCartaDe, shinedustDe };
