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
    // Carpeta elegida en Monitor Link (para 📂 All Main Paths). Columna agregada despues.
    if (!asegurarTablas.carpeta) {
        try { await db.run(`ALTER TABLE link_resumen ADD COLUMN carpeta TEXT`); } catch (e) { /* ya existe */ }
        // 📁 Set My Folder: carpeta pedida desde Discord (Monitor Link la toma en el proximo ping) y,
        // si en esa PC no existe, el motivo para mostrarlo.
        try { await db.run(`ALTER TABLE link_agentes ADD COLUMN carpeta_pedida TEXT`); } catch (e) { /* ya existe */ }
        try { await db.run(`ALTER TABLE link_agentes ADD COLUMN carpeta_error TEXT`); } catch (e) { /* ya existe */ }
        // Wishlist del miembro (ids de cartas de su Cards\wishlist.json), para /wishlist.
        try { await db.run(`ALTER TABLE link_resumen ADD COLUMN wishlist TEXT`); } catch (e) { /* ya existe */ }
        asegurarTablas.carpeta = true;
    }
}

// 📁 Set My Folder: guarda la ruta pedida; Monitor Link la recibe en su proximo ping (cada minuto).
async function pedirCarpeta(discordId, ruta) {
    await asegurarTablas();
    const r = await db.run(`UPDATE link_agentes SET carpeta_pedida = ?, carpeta_error = NULL WHERE discord_id = ?`,
        [String(ruta).trim().replace(/^"|"$/g, '').slice(0, 300), String(discordId)]);
    return (r?.changes ?? 1) > 0;
}

async function estadoCarpeta(discordId) {
    await asegurarTablas();
    return await db.get(`SELECT carpeta_pedida, carpeta_error FROM link_agentes WHERE discord_id = ?`, [String(discordId)]) || null;
}

// Todos los vinculados, para 📂 All Main Paths: carpeta, cuentas, ultimo resumen y si esta en linea.
async function vinculados() {
    await asegurarTablas();
    const filas = await db.all(`SELECT a.discord_id, a.ultimo, r.carpeta, r.cuentas, r.ts
        FROM link_agentes a LEFT JOIN link_resumen r ON r.discord_id = a.discord_id ORDER BY r.cuentas DESC`);
    return (filas || []).map(f => ({
        discordId: f.discord_id, carpeta: f.carpeta || null, cuentas: f.cuentas || 0, ts: f.ts || null,
        enLinea: Date.now() - (f.ultimo || 0) < 3 * 60 * 1000
    }));
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

// ---- Vinculaciones compartidas entre hosts (2026-10-24, Zenith Bot con varios hosts) ----
// Quien esta vinculado (hash del token -> usuario) vive en Upstash (hash ml:agentes), para que
// cualquier host activo reconozca el Monitor Link de cada miembro. La tabla link_agentes de cada host
// es una copia local: se sincroniza al arrancar y cada 10 min, y si llega un token que no conoce lo
// busca ahi. Los resumenes de cartas NO se comparten: cuando cambia el host, cada Monitor Link
// encuentra la direccion nueva en la libreta y vuelve a mandar el suyo solo.
const CLAVE_AGENTES = process.env.ML_AGENTES_KEY || 'ml:agentes';

// Ultima version publicada de Monitor Link.ahk ({ version, url }), de zenith:release (lo anota
// scripts/publicar-host.js). Cacheada 10 min para no gastar consultas en cada ping.
let _ahk = { ts: 0, valor: null };
async function ultimoAhk() {
    if (Date.now() - _ahk.ts < 10 * 60 * 1000) return _ahk.valor;
    _ahk.ts = Date.now();
    try {
        const r = JSON.parse(await redisLibreta('GET', 'zenith:release') || 'null');
        _ahk.valor = r?.ahk?.version && r.ahk.url ? r.ahk : null;
    } catch (e) { /* sin libreta: sin actualizacion automatica */ }
    return _ahk.valor;
}

async function redisLibreta(...comando) {
    const url = process.env.LINK_REDIS_URL, token = process.env.LINK_REDIS_TOKEN;
    if (!url || !token) return null;
    const r = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify(comando), signal: AbortSignal.timeout(10000) });
    const j = await r.json();
    if (j.error) throw new Error(j.error);
    return j.result;
}
const hayLibreta = () => !!(process.env.LINK_REDIS_URL && process.env.LINK_REDIS_TOKEN);

async function guardarAgenteCompartido(tokenHash, fila) {
    if (!hayLibreta()) return;
    await redisLibreta('HSET', CLAVE_AGENTES, tokenHash, JSON.stringify({ d: fila.discord_id, g: fila.guild_id, c: fila.creado, v: fila.version }))
        .catch(e => console.error('DEBUG: Monitor Link no pudo compartir la vinculacion:', e?.message || e));
}

// Copia local <- Upstash. La primera vez (Upstash vacio) sube las vinculaciones que ya existian aca.
async function sincronizarAgentes() {
    if (!hayLibreta()) return;
    try {
        await asegurarTablas();
        const plano = await redisLibreta('HGETALL', CLAVE_AGENTES) || [];
        const remotos = new Map();
        for (let i = 0; i + 1 < plano.length; i += 2) {
            try { remotos.set(plano[i], JSON.parse(plano[i + 1])); } catch (e) { /* entrada rota */ }
        }
        const locales = await db.all(`SELECT token_hash, discord_id, guild_id, creado, version FROM link_agentes`) || [];
        if (!remotos.size) {
            for (const f of locales) await guardarAgenteCompartido(f.token_hash, f);
            return;
        }
        for (const f of locales) if (!remotos.has(f.token_hash)) await db.run(`DELETE FROM link_agentes WHERE token_hash = ?`, [f.token_hash]);
        for (const [th, a] of remotos) {
            await db.run(`INSERT INTO link_agentes (token_hash, discord_id, guild_id, creado, ultimo, version) VALUES (?, ?, ?, ?, 0, ?)
                ON CONFLICT(token_hash) DO NOTHING`, [th, String(a.d), String(a.g || ''), a.c || Date.now(), String(a.v || '')]);
        }
    } catch (e) {
        console.error('DEBUG: Monitor Link no pudo sincronizar las vinculaciones:', e?.message || e);
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
    let fila = await db.get(`SELECT discord_id, guild_id FROM link_agentes WHERE token_hash = ?`, [hash(m[1])]);
    if (!fila && hayLibreta()) {
        // Vinculado en otro host mientras este ya estaba corriendo.
        const a = await redisLibreta('HGET', CLAVE_AGENTES, hash(m[1])).then(t => t && JSON.parse(t)).catch(() => null);
        if (a) {
            await db.run(`DELETE FROM link_agentes WHERE discord_id = ?`, [String(a.d)]);
            await db.run(`INSERT INTO link_agentes (token_hash, discord_id, guild_id, creado, ultimo, version) VALUES (?, ?, ?, ?, ?, ?)`,
                [hash(m[1]), String(a.d), String(a.g || ''), a.c || Date.now(), Date.now(), String(a.v || '')]);
            fila = { discord_id: String(a.d), guild_id: String(a.g || '') };
        }
    }
    if (!fila) return null;
    await db.run(`UPDATE link_agentes SET ultimo = ? WHERE token_hash = ?`, [Date.now(), hash(m[1])]);
    return fila;
}

function registrar(app, dependencias) {
    db = dependencias.db;
    // Host en espera (community-host.js): no atiende a ningun Monitor Link; al recibir 503 cada uno
    // busca en la libreta la direccion del host que tiene el turno.
    const activo = dependencias.activo || (() => true);
    app.use('/link', (req, res, next) => (activo() ? next() : res.status(503).json({ error: 'standby' })));
    sincronizarAgentes();
    setInterval(sincronizarAgentes, 10 * 60 * 1000);
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
            // Un agente por usuario: vincular de nuevo reemplaza al anterior (aca y en los demas hosts).
            const viejos = await db.all(`SELECT token_hash FROM link_agentes WHERE discord_id = ?`, [fila.discord_id]) || [];
            await db.run(`DELETE FROM link_agentes WHERE discord_id = ?`, [fila.discord_id]);
            if (hayLibreta()) {
                const plano = await redisLibreta('HGETALL', CLAVE_AGENTES).catch(() => []) || [];
                for (let i = 0; i + 1 < plano.length; i += 2) {
                    try { if (String(JSON.parse(plano[i + 1]).d) === String(fila.discord_id)) viejos.push({ token_hash: plano[i] }); } catch (e) { /* nada */ }
                }
                for (const v of viejos) await redisLibreta('HDEL', CLAVE_AGENTES, v.token_hash).catch(() => {});
            }
            const token = crypto.randomBytes(32).toString('hex');
            const nuevo = { discord_id: fila.discord_id, guild_id: fila.guild_id, creado: Date.now(), version: String(req.body?.version || '') };
            await db.run(`INSERT INTO link_agentes (token_hash, discord_id, guild_id, creado, ultimo, version) VALUES (?, ?, ?, ?, ?, ?)`,
                [hash(token), nuevo.discord_id, nuevo.guild_id, nuevo.creado, Date.now(), nuevo.version]);
            await guardarAgenteCompartido(hash(token), nuevo);
            res.json({ token, user: (await nombreUsuario(fila.discord_id)) || fila.discord_id });
        } catch (e) {
            console.error('DEBUG: Monitor Link /claim:', e?.message || e);
            res.status(500).json({ error: 'server_error' });
        }
    });

    // Consulta larga del agente: responde apenas haya un pedido de XML, o vacio a los 25 s.
    app.get('/link/jobs', async (req, res) => {
        try {
            await asegurarTablas();
            const agente = await agenteDe(req);
            if (!agente) return res.status(401).json({ error: 'not_linked' });
            const id = agente.discord_id;
            const previa = esperas.get(id);
            if (previa) { clearTimeout(previa.timer); try { previa.res.json({ jobs: [] }); } catch (e) { /* ya cerrada */ } }
            const timer = setTimeout(() => {
                if (esperas.get(id)?.res === res) esperas.delete(id);
                try { res.json({ jobs: [] }); } catch (e) { /* ya cerrada */ }
            }, 25000);
            esperas.set(id, { res, timer });
            req.on('close', () => { if (esperas.get(id)?.res === res) { clearTimeout(timer); esperas.delete(id); } });
            despacharTrabajos(id);
        } catch (e) {
            res.status(500).json({ error: 'server_error' });
        }
    });

    // Respuesta del agente: { id, files: { nombre: contenido }, missing: [...] }.
    app.post('/link/xml', express.text({ type: 'text/plain', limit: '20mb' }), async (req, res) => {
        try {
            await asegurarTablas();
            const agente = await agenteDe(req);
            if (!agente) return res.status(401).json({ error: 'not_linked' });
            let datos;
            try { datos = JSON.parse(req.body || '{}'); } catch (e) { return res.status(400).json({ error: 'bad_json' }); }
            const lista = trabajos.get(agente.discord_id) || [];
            const trabajo = lista.find(t => t.id === datos.id);
            if (!trabajo) return res.json({ ok: false, error: 'unknown_job' });
            clearTimeout(trabajo.timer);
            trabajos.set(agente.discord_id, lista.filter(t => t !== trabajo));
            if (trabajo.accion) {
                trabajo.resolver({ ok: !!datos.ok, already: !!datos.already, error: datos.error ? String(datos.error).slice(0, 200) : null });
                return res.json({ ok: true });
            }
            // Solo lo pedido y con forma de XML de cuenta.
            const archivos = {};
            for (const nombre of trabajo.archivos) {
                const c = datos.files?.[nombre];
                if (typeof c === 'string' && c.length < 20000 && /name="deviceAccount"/.test(c)) archivos[nombre] = c;
            }
            trabajo.resolver(archivos);
            res.json({ ok: true, received: Object.keys(archivos).length });
        } catch (e) {
            res.status(500).json({ error: 'server_error' });
        }
    });

    app.get('/link/ping', async (req, res) => {
        try {
            await asegurarTablas();
            const agente = await agenteDe(req);
            if (!agente) return res.status(401).json({ error: 'not_linked' });
            const pedido = await db.get(`SELECT carpeta_pedida FROM link_agentes WHERE discord_id = ?`, [agente.discord_id]);
            // Si ya esta usando la carpeta pedida, el pedido se cierra aca (Monitor Link no reenvia un
            // resumen que no cambio, asi que /summary nunca lo cerraria).
            const actual = pedido?.carpeta_pedida ? await db.get(`SELECT carpeta FROM link_resumen WHERE discord_id = ?`, [agente.discord_id]) : null;
            if (actual?.carpeta && actual.carpeta.toLowerCase() === pedido.carpeta_pedida.toLowerCase()) {
                await db.run(`UPDATE link_agentes SET carpeta_pedida = NULL, carpeta_error = NULL WHERE discord_id = ?`, [agente.discord_id]);
                pedido.carpeta_pedida = null;
            }
            res.json({ ok: true, user: (await nombreUsuario(agente.discord_id)) || agente.discord_id, folder: pedido?.carpeta_pedida || null, ahk: await ultimoAhk() });
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
            // null = ese Monitor Link no manda wishlist (version vieja o no tiene el archivo).
            const wishlist = Array.isArray(datos.wishlist)
                ? JSON.stringify(datos.wishlist.map(String).filter(id => /^[A-Za-z0-9_]{5,40}$/.test(id)).slice(0, 5000))
                : null;
            await db.run(
                `INSERT INTO link_resumen (discord_id, guild_id, datos, cuentas, ts, carpeta, wishlist) VALUES (?, ?, ?, ?, ?, ?, ?)
                 ON CONFLICT(discord_id) DO UPDATE SET guild_id = excluded.guild_id, datos = excluded.datos, cuentas = excluded.cuentas, ts = excluded.ts, carpeta = excluded.carpeta, wishlist = excluded.wishlist`,
                [agente.discord_id, agente.guild_id, JSON.stringify(limpias), limpias.length, Date.now(), String(datos.folder || "").slice(0, 300) || null, wishlist]);
            // Respuesta al 📁 Set My Folder: si ya se esta usando la carpeta pedida, o si en esa PC no
            // existe (folderError), el pedido se cierra.
            const pedido = await db.get(`SELECT carpeta_pedida FROM link_agentes WHERE discord_id = ?`, [agente.discord_id]);
            if (pedido?.carpeta_pedida) {
                if (datos.folderError) {
                    await db.run(`UPDATE link_agentes SET carpeta_pedida = NULL, carpeta_error = ? WHERE discord_id = ?`,
                        [String(datos.folderError).slice(0, 300), agente.discord_id]);
                } else if (String(datos.folder || '').toLowerCase() === pedido.carpeta_pedida.toLowerCase()) {
                    await db.run(`UPDATE link_agentes SET carpeta_pedida = NULL, carpeta_error = NULL WHERE discord_id = ?`, [agente.discord_id]);
                }
            }
            res.json({ ok: true, accounts: limpias.length });
        } catch (e) {
            console.error('DEBUG: Monitor Link /summary:', e?.message || e);
            res.status(500).json({ error: 'server_error' });
        }
    });
}

// ---- XML a pedido (etapa 3) ----
// Cuando un miembro usa algo que necesita la XML de una cuenta suya (⚡ Share/Trade/Farm/Refresh,
// Extract XML), el bot se la pide a SU Monitor Link: este espera trabajos con una consulta larga
// (GET /link/jobs, hasta 25 s) y contesta con POST /link/xml. Las XML viven solo en memoria hasta que
// el que las pidio las usa; nunca se guardan en la base.
const trabajos = new Map();   // discordId -> [{ id, archivos, entregado, resolver, rechazar, timer }]
const esperas = new Map();    // discordId -> { res, timer }   (consulta larga abierta del agente)

function despacharTrabajos(discordId) {
    const espera = esperas.get(discordId);
    const pendientes = (trabajos.get(discordId) || []).filter(t => !t.entregado);
    if (!espera || !pendientes.length) return;
    clearTimeout(espera.timer);
    esperas.delete(discordId);
    pendientes.forEach(t => { t.entregado = true; });
    espera.res.json({ jobs: pendientes.map(t => t.accion ? { id: t.id, ...t.accion } : { id: t.id, files: t.archivos }) });
}

// Accion en la PC del miembro (2026-10-24): por ahora "wishlist_add" (💖 Wishlist en una carta: la
// agrega a SU Accounts\Cards\wishlist.json). Devuelve { ok, already, error }.
// Errores: 'offline' o 'timeout' (un Monitor Link viejo no conoce la accion y no contesta).
async function pedirAccion(discordId, accion, timeoutMs = 20000) {
    discordId = String(discordId);
    const fila = await db.get(`SELECT ultimo FROM link_agentes WHERE discord_id = ?`, [discordId]);
    if (!fila) throw new Error('offline');
    for (let i = 0; i < 10 && !esperas.has(discordId); i++) await new Promise(r => setTimeout(r, 500));
    if (!esperas.has(discordId)) throw new Error('offline');
    return await new Promise((resolver, rechazar) => {
        const trabajo = { id: crypto.randomBytes(8).toString('hex'), accion, entregado: false, resolver };
        trabajo.timer = setTimeout(() => {
            trabajos.set(discordId, (trabajos.get(discordId) || []).filter(t => t !== trabajo));
            rechazar(new Error('timeout'));
        }, timeoutMs);
        trabajos.set(discordId, [...(trabajos.get(discordId) || []), trabajo]);
        despacharTrabajos(discordId);
    });
}

// Pide XML por nombre de archivo al Monitor Link del usuario. Devuelve { nombre: contenido }.
// Errores: 'offline' (su Monitor Link no esta conectado) o 'timeout'.
async function pedirXml(discordId, nombres, timeoutMs = 45000) {
    discordId = String(discordId);
    const fila = await db.get(`SELECT ultimo FROM link_agentes WHERE discord_id = ?`, [discordId]);
    if (!fila) throw new Error('offline');
    // Un Monitor Link abierto siempre tiene una consulta larga esperando (salvo el instante entre
    // una y la siguiente): si en 5 s no aparece ninguna, esta cerrado.
    for (let i = 0; i < 10 && !esperas.has(discordId); i++) await new Promise(r => setTimeout(r, 500));
    if (!esperas.has(discordId)) throw new Error('offline');
    return await new Promise((resolver, rechazar) => {
        const trabajo = { id: crypto.randomBytes(8).toString('hex'), archivos: [...new Set(nombres.map(String))].slice(0, 2000), entregado: false };
        trabajo.resolver = resolver;
        trabajo.rechazar = rechazar;
        trabajo.timer = setTimeout(() => {
            trabajos.set(discordId, (trabajos.get(discordId) || []).filter(t => t !== trabajo));
            rechazar(new Error('timeout'));
        }, timeoutMs);
        trabajos.set(discordId, [...(trabajos.get(discordId) || []), trabajo]);
        despacharTrabajos(discordId);
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
    cache.set(String(discordId), { ts: fila.ts, cuentas: r.cuentas, mapaCopias, wishlist: r.wishlist });
    return true;
}

// Momento del ultimo resumen cargado (para que las caches por usuario se renueven cuando cambia).
function resumenTs(discordId) {
    return cache.get(String(discordId))?.ts || 0;
}

// Ids de la wishlist del miembro, o null si su Monitor Link no la mando.
function wishlistDe(discordId) {
    return cache.get(String(discordId))?.wishlist || null;
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

// Todas las cuentas del resumen, con la forma de cuentasJson de fast-transfer.js.
function cuentasDe(discordId) {
    return (cache.get(String(discordId))?.cuentas || []).map(c => ({
        archivoJson: c.f, fileNameXml: c.f, nombreCuenta: c.n || c.f, valorJson: typeof c.d === 'number' ? c.d : null
    }));
}

// Para los comandos: resumen subido por un usuario (o null) y si su Monitor Link esta en linea.
async function resumenDe(discordId) {
    await asegurarTablas();
    const fila = await db.get(`SELECT datos, cuentas, ts, wishlist FROM link_resumen WHERE discord_id = ?`, [String(discordId)]);
    if (!fila) return null;
    try { return { cuentas: JSON.parse(fila.datos), total: fila.cuentas, ts: fila.ts, wishlist: fila.wishlist ? JSON.parse(fila.wishlist) : null }; } catch (e) { return null; }
}

async function estadoAgente(discordId) {
    await asegurarTablas();
    const fila = await db.get(`SELECT ultimo FROM link_agentes WHERE discord_id = ?`, [String(discordId)]);
    if (!fila) return { vinculado: false, enLinea: false };
    return { vinculado: true, enLinea: Date.now() - (fila.ultimo || 0) < 3 * 60 * 1000, ultimo: fila.ultimo };
}

module.exports = { registrar, crearCodigo, armarClave, publicarDireccion, resumenDe, estadoAgente, vinculados, pedirCarpeta, estadoCarpeta, pedirXml, pedirAccion, cuentasDe, wishlistDe, resumenTs, precargar, mapaCopiasDe, cuentasPorCartaDe, shinedustDe };
