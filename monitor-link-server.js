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
    await db.run(`CREATE TABLE IF NOT EXISTS link_proxies (
        discord_id TEXT PRIMARY KEY, lista TEXT, n INTEGER, ts INTEGER)`);
    // Cuentas que el miembro presta al reroll (solo los nombres de archivo; las XML se piden al momento).
    // Amigos (2026-11-06, pedido de Ale): un miembro anota en SU Monitor Link el ID de Discord de un amigo
    // y ese amigo usa el bot con las cuentas del miembro, sin instalar Monitor Link (las XML siguen
    // saliendo solo del Monitor Link del dueño, al momento).
    await db.run(`CREATE TABLE IF NOT EXISTS link_amigos (
        amigo_id TEXT PRIMARY KEY, dueno_id TEXT, ts INTEGER)`);
    if (!asegurarTablas.amigoJuego) {
        try { await db.run(`ALTER TABLE link_amigos ADD COLUMN juego_id TEXT`); } catch (e) { /* ya existe */ }
        asegurarTablas.amigoJuego = true;
    }
    // Main propia del miembro (Monitor Link 1.9.18+, Ale 2026-11-07): destino de Share/Trade y para ver sus
    // cartas aunque no este en el registro de wr98 (Dragonite). Despues se migra a Dragonite.
    await db.run(`CREATE TABLE IF NOT EXISTS link_main (
        discord_id TEXT PRIMARY KEY, main_id TEXT, ts INTEGER)`);
    // Totales de elegibilidad GP de cada miembro (Monitor Link 1.9.8+): solo numeros, para el panel de hosts.
    await db.run(`CREATE TABLE IF NOT EXISTS link_gp (
        discord_id TEXT PRIMARY KEY, n96 INTEGER, ok INTEGER, bloq INTEGER, ts INTEGER)`);
    await db.run(`CREATE TABLE IF NOT EXISTS link_reroll (
        discord_id TEXT PRIMARY KEY, cuentas TEXT, n INTEGER, ts INTEGER)`);
    // Cartas que salieron en el reroll y todavia no llegaron al JSON del miembro (PC apagada, etc.).
    await db.run(`CREATE TABLE IF NOT EXISTS link_reroll_pendiente (
        clave TEXT PRIMARY KEY, discord_id TEXT, archivo TEXT, datos TEXT, ts INTEGER)`);
    // Carpeta elegida en Monitor Link (para 📂 All Main Paths). Columna agregada despues.
    if (!asegurarTablas.carpeta) {
        try { await db.run(`ALTER TABLE link_resumen ADD COLUMN carpeta TEXT`); } catch (e) { /* ya existe */ }
        // 📁 Set My Folder: carpeta pedida desde Discord (Monitor Link la toma en el proximo ping) y,
        // si en esa PC no existe, el motivo para mostrarlo.
        try { await db.run(`ALTER TABLE link_agentes ADD COLUMN carpeta_pedida TEXT`); } catch (e) { /* ya existe */ }
        try { await db.run(`ALTER TABLE link_agentes ADD COLUMN carpeta_error TEXT`); } catch (e) { /* ya existe */ }
        // Wishlist del miembro (ids de cartas de su Cards\wishlist.json), para /wishlist.
        try { await db.run(`ALTER TABLE link_resumen ADD COLUMN wishlist TEXT`); } catch (e) { /* ya existe */ }
        // Ajustes del miembro (monitor_link.json de su PC): lo tradeado por el bot y lo que corrigio la
        // sincronizacion con el juego. Los JSON de Kevin/Leanny nunca se tocan.
        try { await db.run(`ALTER TABLE link_resumen ADD COLUMN ajustes TEXT`); } catch (e) { /* ya existe */ }
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

// Direccion que la libreta da hoy a los Monitor Link (la del host del turno). null si no se pudo leer.
async function direccionPublicada() {
    if (!hayLibreta()) return null;
    try { return String(await redisLibreta('GET', CLAVE_LIBRETA) || '') || null; } catch (e) { return null; }
}

// ---- Todos los hosts reciben los resumenes (2026-10-25, bug real: al apagarse la PC de Ale el host
// de wr98 tomo el turno con la base vacia y "desaparecio la info de todos") ----
// Cada host, activo o en espera, anota su direccion en monitor_link:hosts. El ping le pasa a cada
// Monitor Link las de los demas ("mirrors") y el resumen se manda tambien ahi, asi el host que toma el
// turno ya tiene las cuentas de todos -- tambien las de un Monitor Link que se apago con la otra PC.
const CLAVE_HOSTS = 'monitor_link:hosts';
let _miDireccion = null;
async function anotarHost(nombre, urlPublica) {
    if (!hayLibreta() || !nombre || !urlPublica) return;
    _miDireccion = urlPublica;
    await redisLibreta('HSET', CLAVE_HOSTS, String(nombre), JSON.stringify({ u: urlPublica, ts: Date.now() }))
        .catch(e => console.error('DEBUG: Monitor Link no pudo anotar este host:', e?.message || e));
}
let _espejos = { ts: 0, lista: [] };
async function espejos() {
    if (!hayLibreta()) return [];
    if (Date.now() - _espejos.ts > 60 * 1000) {
        _espejos.ts = Date.now();
        try {
            const plano = await redisLibreta('HGETALL', CLAVE_HOSTS) || [];
            const lista = [];
            for (let i = 0; i + 1 < plano.length; i += 2) {
                try { const h = JSON.parse(plano[i + 1]); if (h.u && Date.now() - (h.ts || 0) < 15 * 60 * 1000) lista.push(h.u); } catch (e) { /* entrada rota */ }
            }
            _espejos.lista = lista;
        } catch (e) { /* se queda con la lista anterior */ }
    }
    return _espejos.lista.filter(u => u !== _miDireccion).sort();
}

// ---- Vinculaciones compartidas entre hosts (2026-10-24, Zenith Bot con varios hosts) ----
// Quien esta vinculado (hash del token -> usuario) vive en Upstash (hash ml:agentes), para que
// cualquier host activo reconozca el Monitor Link de cada miembro. La tabla link_agentes de cada host
// es una copia local: se sincroniza al arrancar y cada 10 min, y si llega un token que no conoce lo
// busca ahi. Los resumenes de cartas no pasan por Upstash (pesan MB): cada Monitor Link los manda a
// todos los hosts (ver anotarHost / espejos).
const CLAVE_AGENTES = process.env.ML_AGENTES_KEY || 'ml:agentes';

// Ultima version publicada de Monitor Link.ahk ({ version, url }), de zenith:release (lo anota
// scripts/publicar-host.js). Cacheada 1 min (Ale 2026-11-06: antes 10 min y las versiones nuevas tardaban).
let _ahk = { ts: 0, valor: null };
async function ultimoAhk() {
    if (Date.now() - _ahk.ts < 60 * 1000) return _ahk.valor;
    _ahk.ts = Date.now();
    try {
        const r = JSON.parse(await redisLibreta('GET', 'zenith:release') || 'null');
        _ahk.valor = r?.ahk?.version && r.ahk.url ? r.ahk : null;
    } catch (e) { /* sin libreta: sin actualizacion automatica */ }
    return _ahk.valor;
}

// Cuentas del miembro marcadas como probablemente baneadas por el GP farm (zenith:baneadas, community-host.js).
// Van en el ping: su Monitor Link las muestra "Banned?". Cacheado 60 s (un HGETALL para todos los pings).
let _baneadas = { ts: 0, plano: [] };
async function baneadasDe(discordId) {
    if (Date.now() - _baneadas.ts > 60 * 1000) {
        _baneadas.ts = Date.now();
        try { _baneadas.plano = await redisLibreta('HGETALL', 'zenith:baneadas') || []; } catch (e) { /* sin libreta */ }
    }
    const prefijo = `${discordId}|`, salida = [];
    for (let i = 0; i < _baneadas.plano.length; i += 2) if (String(_baneadas.plano[i]).startsWith(prefijo)) salida.push(String(_baneadas.plano[i]).slice(prefijo.length));
    return salida.slice(0, 500);
}

// Cuota de Upstash (2026-11-09): las lecturas se guardan 5 min en memoria (los pings de todos los miembros
// leian release, baneadas y la lista de hosts cada 1 min en cada host). Escribir una clave borra lo guardado.
const LECTURAS_LIB = new Set(['GET', 'HGET', 'HGETALL', 'MGET']);
const leidasLib = new Map();
async function redisLibreta(...comando) {
    const op = String(comando[0]).toUpperCase();
    if (LECTURAS_LIB.has(op)) {
        const k = JSON.stringify(comando), g = leidasLib.get(k);
        if (g && Date.now() - g.t < 5 * 60 * 1000) return g.v;
        const v = await redisLibretaDirecto(...comando);
        if (v != null) leidasLib.set(k, { t: Date.now(), v });   // "no existe" no se guarda (vinculacion recien hecha)
        return v;
    }
    const clave = String(comando[1]);
    for (const k of leidasLib.keys()) if (JSON.parse(k)[1] === clave) leidasLib.delete(k);
    return redisLibretaDirecto(...comando);
}
async function redisLibretaDirecto(...comando) {
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
            // Base nueva (2026-11-09): durante 1 dia los demas hosts SUMAN sus vinculaciones en vez de borrar
            // las que no estan, asi no se pierde la de ningun miembro que se vinculo en otro host.
            if (locales.length) await redisLibretaDirecto('SET', 'ml:agentes_fusion', String(Date.now() + 24 * 3600 * 1000)).catch(() => {});
            return;
        }
        const fusion = Number(await redisLibretaDirecto('GET', 'ml:agentes_fusion').catch(() => 0) || 0) > Date.now();
        for (const f of locales) {
            if (remotos.has(f.token_hash)) continue;
            if (fusion) await guardarAgenteCompartido(f.token_hash, f);
            else await db.run(`DELETE FROM link_agentes WHERE token_hash = ?`, [f.token_hash]);
        }
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
    const alVincular = dependencias.alVincular || (async () => {});
    const alDesvincular = dependencias.alDesvincular || (async () => {});
    const alAgregarAmigo = dependencias.alAgregarAmigo || alVincular;
    // Host en espera (community-host.js): no atiende a ningun Monitor Link; al recibir 503 cada uno
    // busca en la libreta la direccion del host que tiene el turno.
    const activo = dependencias.activo || (() => true);
    // Excepcion: el resumen y las proxies se reciben igual en espera (ver anotarHost / espejos).
    // (2026-11-06, Ale) Tambien en espera: GET /jobs y POST /xml, asi cualquier host (no solo el del turno)
    // le pide a Monitor Link 1.9.14+ las cuentas prestadas directo y el GP farm no depende del host del turno.
    app.use('/link', (req, res, next) => (activo()
        || (req.method === 'POST' && ['/summary', '/proxies', '/reroll-accounts', '/friends', '/xml'].includes(req.path))
        || (req.method === 'GET' && req.path === '/jobs')) ? next() : res.status(503).json({ error: 'standby' }));
    sincronizarAgentes();
    setInterval(sincronizarAgentes, 10 * 60 * 1000);
    cargarAmigos();
    const nombreUsuario = dependencias.nombreUsuario || (async () => null);
    const dragoniteDe = dependencias.dragonite || (async () => 'error');
    const avisoGpStop = dependencias.avisoGpStop || (async () => {});
    // Main del miembro para el ping (Offline de Dragonite -> GP test): "My Main ID" de Monitor Link o, si no
    // lo puso, el de Dragonite. Guardado 30 min en memoria (el Upstash de wr98 tiene limite mensual).
    const mainsCache = new Map();
    const mainDelMiembro = async (discordId, guildId) => {
        const propia = await db.get(`SELECT main_id FROM link_main WHERE discord_id = ?`, [String(discordId)]).catch(() => null);
        if (propia?.main_id) return String(propia.main_id);
        const g = mainsCache.get(String(discordId));
        if (g && Date.now() - g.t < 30 * 60 * 1000) return g.v;
        const v = await dragoniteDe(discordId, guildId, 'main').catch(() => null);
        const main = typeof v === 'string' && /^\d{16}$/.test(v) ? v : null;
        mainsCache.set(String(discordId), { t: Date.now(), v: main });
        return main;
    };

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
            alVincular(fila.discord_id, fila.guild_id).catch(e => console.error('DEBUG: rol al vincular:', e?.message || e));
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
            // Reroll: contesta con XML como un pedido normal, pero solo de las cuentas pedidas.
            if (trabajo.accion?.action === 'reroll_xml') {
                const archivos = {};
                for (const nombre of trabajo.accion.files) {
                    const c = datos.files?.[nombre];
                    if (typeof c === 'string' && c.length < 20000 && /name="deviceAccount"/.test(c)) archivos[nombre] = c;
                }
                trabajo.resolver(archivos);
                return res.json({ ok: true, received: Object.keys(archivos).length });
            }
            if (trabajo.accion) {
                trabajo.resolver({
                    ok: !!datos.ok, already: !!datos.already, error: datos.error ? String(datos.error).slice(0, 200) : null,
                    // account_json: el JSON de cartas de una cuenta (Info Accounts lo adjunta en privado).
                    json: typeof datos.json === 'string' && datos.json.length < 10 * 1024 * 1024 ? datos.json : undefined,
                    jsonName: typeof datos.jsonName === 'string' ? datos.jsonName.slice(0, 120) : undefined,
                    // mumu_list: instancias de MuMu de la PC del miembro.
                    instances: Array.isArray(datos.instances) ? datos.instances.slice(0, 50).map(i => ({
                        index: String(i.index).slice(0, 10), name: String(i.name || i.index).slice(0, 60), on: !!i.on
                    })) : undefined
                });
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
            res.json({ ok: true, user: (await nombreUsuario(agente.discord_id)) || agente.discord_id, folder: pedido?.carpeta_pedida || null, ahk: await ultimoAhk(),
                main: await mainDelMiembro(agente.discord_id, agente.guild_id),
                mirrors: await espejos(), banned: await baneadasDe(agente.discord_id),
                // Libreta de direcciones actual (solo lectura): si la base de Upstash cambia (2026-11-09), cada
                // Monitor Link vinculado se pasa solo a la nueva sin volver a vincular.
                lib: process.env.LINK_REDIS_URL && process.env.LINK_REDIS_READONLY_TOKEN
                    ? { u: process.env.LINK_REDIS_URL, t: process.env.LINK_REDIS_READONLY_TOKEN } : null });
        } catch (e) {
            res.status(500).json({ error: 'server_error' });
        }
    });

    // El resumen pesa ~10 KB por cuenta (1200 cuentas = 12 MB): se manda como texto (no pasa por el
    // express.json global del Dashboard, que corta en 100 KB).
    app.post('/link/summary', express.text({ type: 'text/plain', limit: '300mb' }), async (req, res) => {
        try {
            await asegurarTablas();
            const agente = await agenteDe(req);
            if (!agente) return res.status(401).json({ error: 'not_linked' });
            let datos;
            try { datos = JSON.parse(req.body || '{}'); } catch (e) { return res.status(400).json({ error: 'bad_json' }); }
            const cuentas = Array.isArray(datos.accounts) ? datos.accounts : [];
            // Solo campos esperados: nombre de archivo, nombre visible, cartas {id: copias}, Shinedust.
            const limpias = cuentas.slice(0, 20000).map(c => ({
                f: String(c.f || '').slice(0, 120),
                n: String(c.n || '').slice(0, 120),
                d: Number.isFinite(c.d) ? c.d : null,
                c: Object.fromEntries(Object.entries(c.c || {})
                    .filter(([id, n]) => /^[A-Za-z0-9_]{5,40}$/.test(id) && Number.isInteger(n) && n > 0 && n < 100000))
            })).filter(c => c.f);
            const ajustes = limpiarAjustes(datos.adjust);
            // null = ese Monitor Link no manda wishlist (version vieja o no tiene el archivo).
            const wishlist = Array.isArray(datos.wishlist)
                ? JSON.stringify(datos.wishlist.map(String).filter(id => /^[A-Za-z0-9_]{5,40}$/.test(id)).slice(0, 5000))
                : null;
            await db.run(
                `INSERT INTO link_resumen (discord_id, guild_id, datos, cuentas, ts, carpeta, wishlist, ajustes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                 ON CONFLICT(discord_id) DO UPDATE SET guild_id = excluded.guild_id, datos = excluded.datos, cuentas = excluded.cuentas, ts = excluded.ts,
                    carpeta = excluded.carpeta, wishlist = excluded.wishlist, ajustes = COALESCE(excluded.ajustes, link_resumen.ajustes)`,
                [agente.discord_id, agente.guild_id, JSON.stringify(limpias), limpias.length, Date.now(), String(datos.folder || "").slice(0, 300) || null, wishlist,
                    ajustes ? JSON.stringify(ajustes) : null]);
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

    // 🌐 Share proxies (2026-10-30): el miembro comparte SU lista de proxies para el reroll de los
    // hosts. Lista vacia = deja de compartir. Se guardan solo en la base del host (nunca en Discord) y
    // se arma el .txt del motor (ver escribirProxiesMotor).
    app.post('/link/proxies', express.text({ type: 'text/plain', limit: '2mb' }), async (req, res) => {
        try {
            await asegurarTablas();
            const agente = await agenteDe(req);
            if (!agente) return res.status(401).json({ error: 'not_linked' });
            const lista = [...new Set(String(req.body || '').split(/\r?\n/).map(normalizarProxy).filter(Boolean))].slice(0, 5000);
            if (lista.length) {
                await db.run(`INSERT INTO link_proxies (discord_id, lista, n, ts) VALUES (?, ?, ?, ?)
                     ON CONFLICT(discord_id) DO UPDATE SET lista = excluded.lista, n = excluded.n, ts = excluded.ts`,
                    [agente.discord_id, lista.join('\n'), lista.length, Date.now()]);
            } else {
                await db.run(`DELETE FROM link_proxies WHERE discord_id = ?`, [agente.discord_id]);
            }
            await escribirProxiesMotor();
            res.json({ ok: true, proxies: lista.length });
        } catch (e) {
            console.error('DEBUG: Monitor Link /proxies:', e?.message || e);
            res.status(500).json({ error: 'server_error' });
        }
    });

    // 🎲 Share accounts for reroll: los nombres de las cuentas (96+ sobres) que el miembro presta.
    // Lista vacia = deja de prestar. Nunca viajan contraseñas en este paso.
    // Amigos del miembro: { ids: ["discordId", ...] } reemplaza la lista entera (vacia = ninguno).
    app.post('/link/friends', express.text({ type: 'text/plain', limit: '16kb' }), async (req, res) => {
        try {
            await asegurarTablas();
            const agente = await agenteDe(req);
            if (!agente) return res.status(401).json({ error: 'not_linked' });
            let datos;
            try { datos = JSON.parse(req.body || '{}'); } catch (e) { return res.status(400).json({ error: 'bad_json' }); }
            const dueno = String(agente.discord_id);
            // Cada amigo: "discordId" o "discordId:friendIdDelJuego" (16 digitos; Monitor Link 1.9.9+).
            const juegos = {};
            const ids = [...new Set((Array.isArray(datos.ids) ? datos.ids : []).map(x => {
                const m = /^(\d{17,20})(?::(\d{16}))?$/.exec(String(x).replace(/[\s-]/g, ''));
                if (!m) return null;
                if (m[2]) juegos[m[1]] = m[2];
                return m[1];
            }).filter(Boolean))].filter(x => x !== dueno).slice(0, 10);
            const antes = (await db.all(`SELECT amigo_id FROM link_amigos WHERE dueno_id = ?`, [dueno]) || []).map(f => String(f.amigo_id));
            await db.run(`DELETE FROM link_amigos WHERE dueno_id = ?`, [dueno]);
            for (const id of ids) await db.run(`INSERT OR REPLACE INTO link_amigos (amigo_id, dueno_id, ts, juego_id) VALUES (?, ?, ?, ?)`, [id, dueno, Date.now(), juegos[id] || null]);
            await cargarAmigos();
            // Rol Monitor (pedido de Ale): el amigo lo recibe al anotarlo (como al vincular) y lo pierde al
            // quitarlo, salvo que tenga su propio Monitor Link o sea amigo de otro miembro.
            for (const id of ids) alAgregarAmigo(id, agente.guild_id).catch(e => console.error('DEBUG: rol al amigo:', e?.message || e));
            for (const id of antes.filter(x => !ids.includes(x) && !duenoDe(x))) {
                const propio = await db.get(`SELECT 1 AS si FROM link_agentes WHERE discord_id = ?`, [id]);
                if (!propio) alDesvincular(id, agente.guild_id).catch(e => console.error('DEBUG: quitar rol al amigo:', e?.message || e));
            }
            res.json({ ok: true, friends: ids.length });
        } catch (e) {
            res.status(500).json({ error: 'error' });
        }
    });

    // Main propia: { main: "16 digitos" } (vacio = la quita).
    // (Ale 2026-11-10) Boton "Sync reroll for Zenith Rise" de Monitor Link: la configuracion de Group Reroll
    // del bot de Lean (PTCGPB). El webhook NO va en Monitor Link (se descarga publico de GitHub): vive en
    // Upstash zenith:group_webhook y solo se entrega a un Monitor Link vinculado, con el Discord ID de su dueno.
    app.get('/link/reroll-config', async (req, res) => {
        try {
            await asegurarTablas();
            const agente = await agenteDe(req);
            if (!agente) return res.status(401).json({ error: 'not_linked' });
            const webhook = String(await redisLibreta('GET', 'zenith:group_webhook').catch(() => '') || '').trim();
            if (!webhook) return res.status(503).json({ error: 'no_webhook' });
            res.json({
                ok: true,
                discordId: String(agente.discord_id),
                webhook,
                mainIdsURL: 'https://onlineids.zenithrise.workers.dev/elite',
                vipIdsURL: 'https://onlineids.zenithrise.workers.dev/vip-elite',
            });
        } catch (e) {
            res.status(500).json({ error: 'server_error' });
        }
    });

    app.post('/link/main', express.text({ type: 'text/plain', limit: '4kb' }), async (req, res) => {
        try {
            await asegurarTablas();
            const agente = await agenteDe(req);
            if (!agente) return res.status(401).json({ error: 'not_linked' });
            let datos;
            try { datos = JSON.parse(req.body || '{}'); } catch (e) { return res.status(400).json({ error: 'bad_json' }); }
            const main = String(datos.main || '').replace(/\D/g, '');
            if (main && main.length !== 16) return res.status(400).json({ error: 'bad_main' });
            if (main) await db.run(`INSERT OR REPLACE INTO link_main (discord_id, main_id, ts) VALUES (?, ?, ?)`, [String(agente.discord_id), main, Date.now()]);
            else await db.run(`DELETE FROM link_main WHERE discord_id = ?`, [String(agente.discord_id)]);
            await cargarAmigos();
            // (Ale 2026-11-10) Tambien en Dragonite (registro de wr98), con el heartbeat name de su PTCGPB.
            const hb = String(datos.heartbeatName || '').trim().slice(0, 60);
            const dragonite = (main && datos.dragonite) ? await dragoniteDe(agente.discord_id, agente.guild_id, 'register', { main, heartbeatName: hb }).catch(() => 'error') : null;
            res.json({ ok: true, main: main || null, dragonite });
        } catch (e) {
            res.status(500).json({ error: 'error' });
        }
    });

    // Estado actual en Dragonite (boton verde/rojo de Monitor Link): { ok, online, result }.
    app.get('/link/online', async (req, res) => {
        try {
            await asegurarTablas();
            const agente = await agenteDe(req);
            if (!agente) return res.status(401).json({ error: 'not_linked' });
            const r = await dragoniteDe(agente.discord_id, agente.guild_id, 'status').catch(() => 'error');
            if (typeof r === 'object' && r?.result === 'ok') return res.json({ ok: true, online: !!r.online, result: 'ok' });
            res.json({ ok: false, result: typeof r === 'string' ? r : 'error' });
        } catch (e) {
            res.status(500).json({ error: 'server_error' });
        }
    });

    // (Ale 2026-11-10) Online/offline en Dragonite, como los botones del bot de wr98: { online: true|false }.
    app.post('/link/online', express.text({ type: 'text/plain', limit: '1kb' }), async (req, res) => {
        try {
            await asegurarTablas();
            const agente = await agenteDe(req);
            if (!agente) return res.status(401).json({ error: 'not_linked' });
            let datos;
            try { datos = JSON.parse(req.body || '{}'); } catch (e) { return res.status(400).json({ error: 'bad_json' }); }
            const r = await dragoniteDe(agente.discord_id, agente.guild_id, datos.online ? 'online' : 'offline').catch(() => 'error');
            res.json({ ok: r === 'ok', result: r });
        } catch (e) {
            res.status(500).json({ error: 'server_error' });
        }
    });

    // (Ale 2026-11-11) Offline -> GP test -> PTCGPB y MuMu Main cerrados: Monitor Link avisa cada fase
    // ({ phase: start|done|timeout, seconds, mumu }) y el bot lo pone en #logging.
    app.post('/link/gp-stop', express.text({ type: 'text/plain', limit: '1kb' }), async (req, res) => {
        try {
            await asegurarTablas();
            const agente = await agenteDe(req);
            if (!agente) return res.status(401).json({ error: 'not_linked' });
            let datos;
            try { datos = JSON.parse(req.body || '{}'); } catch (e) { return res.status(400).json({ error: 'bad_json' }); }
            const fase = ['start', 'step', 'done', 'timeout'].includes(datos.phase) ? datos.phase : null;
            if (!fase) return res.status(400).json({ error: 'bad_phase' });
            await avisoGpStop(agente.discord_id, agente.guild_id, fase,
                { seconds: Number.isFinite(datos.seconds) ? datos.seconds : 0, mumu: datos.mumu !== false,
                    step: String(datos.step || '').replace(/[`*_~|<>@]/g, '').slice(0, 120),
                    vip: Array.isArray(datos.vip) ? [...new Set(datos.vip.map(String).filter(x => /^\d{16}$/.test(x)))].slice(0, 100) : null,
                    since: Number.isFinite(datos.since) && datos.since > 1.7e9 ? datos.since : 0 }).catch(() => {});
            res.json({ ok: true });
        } catch (e) {
            res.status(500).json({ error: 'server_error' });
        }
    });

    app.post('/link/reroll-accounts', express.text({ type: 'text/plain', limit: '2mb' }), async (req, res) => {
        try {
            await asegurarTablas();
            const agente = await agenteDe(req);
            if (!agente) return res.status(401).json({ error: 'not_linked' });
            let datos;
            try { datos = JSON.parse(req.body || '{}'); } catch (e) { return res.status(400).json({ error: 'bad_json' }); }
            // Cada cuenta: "nombre.xml" o { f, p: packCount, l: lastPackPulled "YYYYMMDDHHMMSS" }.
            const vistas = new Set();
            const cuentas = (Array.isArray(datos.accounts) ? datos.accounts : []).map(c => {
                const f = String((typeof c === 'string' ? c : c?.f) || '').trim();
                if (!/^[^\\/:*?"<>|]{1,120}\.xml$/i.test(f) || vistas.has(f)) return null;
                vistas.add(f);
                return { f, p: Number.isInteger(c?.p) ? c.p : null, l: /^\d{14}$/.test(String(c?.l || '')) ? String(c.l) : null,
                    // e = sobres que le faltan para ser elegible a God Pack (0 = elegible; Monitor Link 1.9.11+: 96 sobres tras una pausa de 30+ dias).
                    e: Number.isInteger(c?.e) && c.e >= 0 && c.e <= 96 ? c.e : null };
            }).filter(Boolean).slice(0, 20000);
            const st = datos.stats;
            const entero = (x) => Number.isInteger(x) && x >= 0 && x < 1e6;
            if (st && entero(st.n96) && entero(st.ok) && entero(st.lock)) {
                await db.run(`INSERT INTO link_gp (discord_id, n96, ok, bloq, ts) VALUES (?, ?, ?, ?, ?)
                     ON CONFLICT(discord_id) DO UPDATE SET n96 = excluded.n96, ok = excluded.ok, bloq = excluded.bloq, ts = excluded.ts`,
                    [agente.discord_id, st.n96, st.ok, st.lock, Date.now()]);
            }
            if (cuentas.length) {
                await db.run(`INSERT INTO link_reroll (discord_id, cuentas, n, ts) VALUES (?, ?, ?, ?)
                     ON CONFLICT(discord_id) DO UPDATE SET cuentas = excluded.cuentas, n = excluded.n, ts = excluded.ts`,
                    [agente.discord_id, JSON.stringify(cuentas), cuentas.length, Date.now()]);
            } else {
                await db.run(`DELETE FROM link_reroll WHERE discord_id = ?`, [agente.discord_id]);
            }
            res.json({ ok: true, accounts: cuentas.length });
        } catch (e) {
            console.error('DEBUG: Monitor Link /reroll-accounts:', e?.message || e);
            res.status(500).json({ error: 'server_error' });
        }
    });

    // De host a host: XML de cuentas prestadas, pedidas al Monitor Link del miembro (que habla con este
    // host, el del turno). Solo para otro host con la clave; las XML no se guardan aca.
    app.post('/link/host/reroll-xml', express.json({ limit: '1mb' }), async (req, res) => {
        if (!esHost(req)) return res.status(401).json({ error: 'not_a_host' });
        try {
            const nombres = (Array.isArray(req.body?.files) ? req.body.files : []).map(String).slice(0, 200);
            const prestadas = new Set(((await cuentasReroll()).find(m => m.discord_id === String(req.body?.discord_id))?.cuentas || []).map(c => c.f));
            const files = await pedirXmlReroll(String(req.body?.discord_id || ''), nombres.filter(n => prestadas.has(n)));
            res.json({ ok: true, files });
        } catch (e) {
            res.status(503).json({ error: e.message === 'offline' ? 'offline' : 'timeout' });
        }
    });

    // De host a host: cartas que salieron en otro host; quedan aca hasta llegar al JSON del miembro.
    app.post('/link/host/pulls', express.json({ limit: '1mb' }), async (req, res) => {
        if (!esHost(req)) return res.status(401).json({ error: 'not_a_host' });
        try {
            await asegurarTablas();
            const { discord_id: id, archivo, datos } = req.body || {};
            const clave = /"key":"([0-9a-f]+)"/.exec(String(datos || ''))?.[1];
            if (!id || !archivo || !clave) return res.status(400).json({ error: 'bad_request' });
            await db.run(`INSERT OR IGNORE INTO link_reroll_pendiente (clave, discord_id, archivo, datos, ts) VALUES (?, ?, ?, ?, ?)`,
                [clave, String(id), String(archivo), String(datos), Date.now()]);
            res.json({ ok: true });
            entregarSobresReroll(String(id)).catch(() => {});
        } catch (e) {
            res.status(500).json({ error: 'server_error' });
        }
    });
}

// Para el reroll de un host que NO tiene el turno: las XML se piden por el host del turno.
async function xmlRerollPorHostActivo(discordId, nombres) {
    return (await llamarHostActivo('/link/host/reroll-xml', { discord_id: String(discordId), files: nombres })).files || {};
}

// Cartas pendientes de ESTE host -> al host del turno (que es el que puede hablar con los Monitor Link).
async function pasarSobresAlHostActivo() {
    await asegurarTablas();
    const filas = await db.all(`SELECT clave, discord_id, archivo, datos FROM link_reroll_pendiente ORDER BY ts`) || [];
    for (const f of filas) {
        try {
            await llamarHostActivo('/link/host/pulls', { discord_id: f.discord_id, archivo: f.archivo, datos: f.datos });
            await db.run(`DELETE FROM link_reroll_pendiente WHERE clave = ?`, [f.clave]);
        } catch (e) { break; }   // el host del turno no contesta: quedan para la proxima
    }
}

// Cuentas prestadas al reroll: [{ discord_id, cuentas: [{ f, p, l }], ts }].
// amigo -> dueño, en memoria (se lee en cada interaccion del bot, sin ir a la base).
const amigos = new Map();
// Main que el miembro registro en SU Monitor Link (null si no puso ninguna).
const mainsPropias = new Map();
const mainDe = (discordId) => mainsPropias.get(String(discordId)) || null;
async function cargarAmigos() {
    try {
        await asegurarTablas();
        const filas = await db.all(`SELECT amigo_id, dueno_id, juego_id FROM link_amigos`) || [];
        amigos.clear();
        for (const f of filas) amigos.set(String(f.amigo_id), { dueno: String(f.dueno_id), juego: f.juego_id ? String(f.juego_id) : null });
        const propias = await db.all(`SELECT discord_id, main_id FROM link_main`) || [];
        mainsPropias.clear();
        for (const f of propias) if (f.main_id) mainsPropias.set(String(f.discord_id), String(f.main_id));
    } catch (e) { /* sin tablas todavia */ }
}

// Dueño cuyas cuentas usa este usuario de Discord (null si no es amigo de nadie).
const duenoDe = (discordId) => amigos.get(String(discordId))?.dueno || null;
// Friend ID del juego que el dueño anoto para ese amigo (null si no puso ninguno).
const juegoDeAmigo = (discordId) => amigos.get(String(discordId))?.juego || null;
// Amigos que anoto un miembro, con su friend ID del juego: [{ discordId, juego }].
const amigosDe = (duenoId) => [...amigos].filter(([, a]) => a.dueno === String(duenoId)).map(([id, a]) => ({ discordId: id, juego: a.juego }));

// Status de cuentas de toda la comunidad para el panel de hosts.
async function estadoCuentasComunidad() {
    await asegurarTablas();
    const resumen = await db.all(`SELECT discord_id, cuentas FROM link_resumen`) || [];
    const gp = await db.all(`SELECT n96, ok, bloq FROM link_gp`) || [];
    const prestadas = await db.all(`SELECT n FROM link_reroll`) || [];
    const vinculados = await db.all(`SELECT ultimo FROM link_agentes`) || [];
    const suma = (filas, k) => filas.reduce((a, f) => a + (Number(f[k]) || 0), 0);
    return {
        miembros: vinculados.length, enLinea: vinculados.filter(v => Date.now() - (v.ultimo || 0) < 3 * 60 * 1000).length,
        cuentas: suma(resumen, 'cuentas'), conDatos: resumen.length,
        n96: suma(gp, 'n96'), elegibles: suma(gp, 'ok'), bloqueadas: suma(gp, 'bloq'), conGp: gp.length,
        prestadas: suma(prestadas, 'n')
    };
}

async function cuentasReroll() {
    await asegurarTablas();
    const filas = await db.all(`SELECT discord_id, cuentas, ts FROM link_reroll ORDER BY discord_id`) || [];
    return filas.map(f => ({ discord_id: f.discord_id, ts: f.ts,
        cuentas: JSON.parse(f.cuentas || '[]').map(c => typeof c === 'string' ? { f: c, p: null, l: null } : c) }));
}

// Lo que salio al abrir sobres en una cuenta prestada: queda pendiente hasta que el Monitor Link del
// miembro lo escriba en SU JSON (pulls[], packCount, lastPackPulled). sobres = [{ timestamp, pack, cards }].
async function anotarSobresReroll(discordId, archivo, sobres, ultimo) {
    await asegurarTablas();
    const clave = crypto.randomBytes(8).toString('hex');
    // avisos/sobre: para el aviso al S4T del dueño (su server personal), uno por sobre; ver avisoS4t
    // en reroll-comunidad.js. sobre = nombre de la expansion ("Dual Fusion"): con eso su s4t pone el logo.
    let nombres = {};
    try { nombres = require('./assets/expansion_names.json'); } catch (e) { /* sin nombres */ }
    const datos = JSON.stringify({ key: clave, last: ultimo,
        sobre: String(nombres[sobres[0]?.pack] || sobres[0]?.pack || ''),
        avisos: sobres.map(s => String(s.aviso || '')),
        pulls: sobres.map(s => ({ timestamp: String(s.timestamp), pack: String(s.pack), cards: (s.cards || []).map(String) })) });
    await db.run(`INSERT INTO link_reroll_pendiente (clave, discord_id, archivo, datos, ts) VALUES (?, ?, ?, ?, ?)`,
        [clave, String(discordId), String(archivo), datos, Date.now()]);
}

// Manda al Monitor Link del miembro las cartas pendientes. Devuelve cuantas entregas quedaron hechas.
// Si su PC esta apagada quedan para la proxima (cada entrega lleva su clave: nunca se escribe dos veces).
async function entregarSobresReroll(discordId) {
    await asegurarTablas();
    const filas = await db.all(`SELECT clave, archivo, datos FROM link_reroll_pendiente WHERE discord_id = ? ORDER BY ts`, [String(discordId)]) || [];
    let hechas = 0;
    for (const f of filas) {
        try {
            const r = await pedirAccion(discordId, { action: 'add_pulls', file: f.archivo, content: Buffer.from(f.datos).toString('base64') }, 30000);
            if (r.ok || r.error === 'account file not found') {
                await db.run(`DELETE FROM link_reroll_pendiente WHERE clave = ?`, [f.clave]);
                if (r.ok) hechas++;
            }
        } catch (e) {
            break; // offline / timeout: el resto queda para la proxima
        }
    }
    return hechas;
}

async function miembrosConSobresPendientes() {
    await asegurarTablas();
    return (await db.all(`SELECT DISTINCT discord_id FROM link_reroll_pendiente`) || []).map(f => f.discord_id);
}

// Pide al Monitor Link del miembro las XML de cuentas que presto al reroll. Monitor Link solo entrega
// las que el miembro marco (lo demas lo rechaza en su PC) y lo anota en su reroll_log.txt.
// Devuelve { nombre: contenido }. Errores: 'offline' o 'timeout' (o un Monitor Link viejo).
async function pedirXmlReroll(discordId, nombres) {
    return await pedirAccion(discordId, { action: 'reroll_xml', files: nombres.map(String) }, 60000);
}

// Formatos aceptados: user:pass@host:port, http://user:pass@host:port y host:port:user:pass (el de
// la mayoria de los planes). Todo sale como user:pass@host:port, el que lee el motor.
// Cuentas de proxies que ya no sirven (2026-11-09, Ale: las de DataImpulse regaladas se quedaron sin
// trafico -> "407 TRAFFIC_EXHAUSTED" y todos los logins fallaban). Se ignoran aunque alguien las siga
// compartiendo. Va la huella (sha256 del usuario sin lo que sigue a "__", primeros 16), no el usuario.
const CUENTAS_PROXY_BLOQUEADAS = new Set(['dd985ff0b1b1192f']);
const proxyBloqueado = (usuario) => CUENTAS_PROXY_BLOQUEADAS.has(
    crypto.createHash('sha256').update(String(usuario).split('__')[0]).digest('hex').slice(0, 16));

function normalizarProxy(linea) {
    const l = String(linea).trim().replace(/^(https?|socks5h?):\/\//i, '');
    if (!l || l.startsWith('#') || /\s/.test(l)) return null;
    let m = /^([^:@]+):([^@]+)@([A-Za-z0-9.-]+):(\d{2,5})$/.exec(l);
    if (m) return proxyBloqueado(m[1]) ? null : `${m[1]}:${m[2]}@${m[3]}:${m[4]}`;
    m = /^([A-Za-z0-9.-]+):(\d{2,5}):([^:@]+):([^@]+)$/.exec(l);
    if (m) return proxyBloqueado(m[3]) ? null : `${m[3]}:${m[4]}@${m[1]}:${m[2]}`;
    return null;
}

// Parte de este host en el GP farm ({ i, n } o null si esta Offline); la pone bot.js (community-host.js).
let parteReroll = async () => ({ i: 0, n: 1 });
const usarParteReroll = (fn) => { parteReroll = fn; };

// Junta las proxies de todos en la carpeta del motor (FAST_TRANSFER_ENGINE_DIR, solo hosts):
//   proxies_comunidad.txt   la bolsa entera
//   proxies_reroll.txt      la parte de ESTE host: todas si es el unico Online para GP farm, la mitad
//                           si son dos (mismo orden en todos los hosts: nunca usan la misma IP a la vez),
//                           vacio si esta Offline. El panel GP y el reroll usan este.
// Devuelve cuantas proxies le tocan a este host.
async function escribirProxiesMotor() {
    const fs = require('fs');
    const path = require('path');
    const motor = (process.env.FAST_TRANSFER_ENGINE_DIR || '').trim();
    if (!motor || !fs.existsSync(motor)) return 0;
    await asegurarTablas();
    const filas = await db.all(`SELECT lista FROM link_proxies ORDER BY discord_id`) || [];
    // normalizarProxy otra vez: saca las cuentas bloqueadas que ya estaban guardadas de antes.
    const todas = [...new Set(filas.flatMap(f => String(f.lista || '').split('\n')).map(normalizarProxy).filter(Boolean))];
    const parte = await parteReroll().catch(() => null);
    const mias = parte ? todas.slice(Math.floor(todas.length * parte.i / parte.n), Math.floor(todas.length * (parte.i + 1) / parte.n)) : [];
    const escribir = (nombre, lineas) => {
        const texto = lineas.join('\n') + (lineas.length ? '\n' : '');
        const ruta = path.join(motor, nombre);
        try { if (fs.readFileSync(ruta, 'utf8') === texto) return; } catch (e) { /* no existia */ }
        fs.writeFileSync(ruta, texto);
    };
    escribir('proxies_comunidad.txt', todas);
    escribir('proxies_reroll.txt', mias);
    return mias.length;
}

// ---- De host a host (2026-10-31): los Monitor Link de los miembros solo hablan con el host que tiene
// el turno. Otro host Online para GP farm le pide a ESE las XML de las cuentas prestadas (y le pasa las
// cartas que salieron). Clave entre hosts: derivada del token de la libreta, que solo tienen los hosts.
const claveHosts = () => process.env.LINK_REDIS_TOKEN ? hash(`zenith-hosts|${process.env.LINK_REDIS_TOKEN}`) : null;
const esHost = (req) => !!claveHosts() && req.headers['x-zenith-host'] === claveHosts();

async function urlHostActivo() {
    return String(await redisLibreta('GET', CLAVE_LIBRETA).catch(() => null) || '').replace(/\/+$/, '') || null;
}

async function llamarHostActivo(ruta, cuerpo) {
    const url = await urlHostActivo();
    if (!url) throw new Error('offline');
    const r = await fetch(`${url}${ruta}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Zenith-Host': claveHosts() },
        body: JSON.stringify(cuerpo), signal: AbortSignal.timeout(90000)
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `host ${r.status}`);
    return j;
}

// Quien comparte y cuantas (para hosts; nunca muestra las proxies).
async function proxiesCompartidas() {
    await asegurarTablas();
    return await db.all(`SELECT discord_id, n, ts FROM link_proxies ORDER BY n DESC`) || [];
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
    for (let i = 0; i < 90 && !esperas.has(discordId); i++) await new Promise(r => setTimeout(r, 500));
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
    // una y la siguiente, o unos segundos despues de que el bot se reinicia y cambia de direccion):
    // si en 45 s no aparece ninguna, esta cerrado. 45 y no 20 (2026-10-29, bug real "Your Monitor Link is
    // not running" y al rato funcionaba): mientras sube el resumen de cientos de cuentas, el Monitor Link
    // no atiende y la espera se cortaba antes de que volviera.
    for (let i = 0; i < 90 && !esperas.has(discordId); i++) await new Promise(r => setTimeout(r, 500));
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
    const crudas = r.cuentas;
    r.cuentas = crudas.map(cuenta => ({ ...cuenta, c: aplicarAjuste(cuenta.c, r.ajustes?.accounts?.[claveCuenta(cuenta.f)]) }));
    const mapaCopias = {};
    for (const cuenta of r.cuentas) {
        for (const [id, n] of Object.entries(cuenta.c || {})) (mapaCopias[id] ||= []).push({ fileName: cuenta.f, cantidad: n });
    }
    for (const id of Object.keys(mapaCopias)) mapaCopias[id].sort((a, b) => b.cantidad - a.cantidad);
    cache.set(String(discordId), { ts: fila.ts, cuentas: r.cuentas, crudas, ajustes: r.ajustes, mapaCopias, wishlist: r.wishlist });
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
        .map(c => ({ nombreCuenta: (c.n && c.n !== '0') ? c.n : c.f, valor: c.d, fileNameXml: c.f, archivoJson: c.f }))
        .sort((a, b) => b.valor - a.valor);
}

// ---- Ajustes del miembro (monitor_link.json en su PC) ----
const claveCuenta = (f) => String(f || '').replace(/\.xml$/i, '').toLowerCase();
const ID_CARTA = /^[A-Za-z0-9_]{5,40}$/;

function limpiarAjustes(a) {
    if (!a || typeof a !== 'object' || typeof a.accounts !== 'object') return null;
    const accounts = {};
    for (const [k, v] of Object.entries(a.accounts).slice(0, 5000)) {
        if (!v || typeof v !== 'object') continue;
        const traded = {};
        for (const [id, n] of Object.entries(v.traded || {})) if (ID_CARTA.test(id) && Number.isInteger(n) && n > 0 && n < 100000) traded[id] = n;
        const lista = (x) => (Array.isArray(x) ? x : []).map(String).filter(id => ID_CARTA.test(id)).slice(0, 5000);
        accounts[claveCuenta(k)] = { traded, notOwned: lista(v.notOwned), extra: lista(v.extra), syncedAt: v.syncedAt ? String(v.syncedAt).slice(0, 40) : null };
    }
    return { version: 1, accounts };
}

// Copias de una cuenta con sus ajustes: JSON - cartas que ya no tiene + las nuevas - lo ya tradeado.
function aplicarAjuste(c, aj) {
    const out = { ...(c || {}) };
    if (!aj) return out;
    for (const id of aj.notOwned || []) delete out[id];
    for (const id of aj.extra || []) if (!out[id]) out[id] = 1;
    for (const [id, n] of Object.entries(aj.traded || {})) {
        if (out[id] === undefined) continue;
        out[id] -= n;
        if (out[id] <= 0) delete out[id];
    }
    return out;
}

// Anota un cambio en los ajustes del miembro y se lo manda a su Monitor Link para que lo guarde.
//   { tipo: 'traded', card, n }               una copia (o n) que el bot transfirio
//   { tipo: 'sync', notOwned: [], extra: [] }  lo que dijo el juego en la ultima sincronizacion
async function anotarAjusteMiembro(discordId, fileName, cambio) {
    discordId = String(discordId);
    await precargar(discordId);
    const actual = cache.get(discordId)?.ajustes || { version: 1, accounts: {} };
    const ajustes = JSON.parse(JSON.stringify(actual));
    const k = claveCuenta(fileName);
    const cuenta = ajustes.accounts[k] || (ajustes.accounts[k] = { traded: {}, notOwned: [], extra: [] });
    if (cambio.tipo === 'traded') {
        cuenta.traded[cambio.card] = (cuenta.traded[cambio.card] || 0) + (cambio.n || 1);
    } else if (cambio.tipo === 'sync') {
        cuenta.notOwned = cambio.notOwned || [];
        cuenta.extra = cambio.extra || [];
        cuenta.syncedAt = new Date().toISOString();
        // Lo tradeado de cartas que ya no estan en el juego ya no hace falta restarlo.
        for (const id of cuenta.notOwned) delete cuenta.traded[id];
    }
    const contenido = JSON.stringify(limpiarAjustes(ajustes), null, 2);
    const r = await pedirAccion(discordId, { action: 'ml_file_write', content: Buffer.from(contenido, 'utf8').toString('base64') }, 30000);
    if (!r.ok) throw new Error(r.error || 'could not save');
    await db.run(`UPDATE link_resumen SET ajustes = ? WHERE discord_id = ?`, [contenido, discordId]);
    cache.delete(discordId);
    await precargar(discordId);
    return true;
}

// Copias SIN ajustes (las del JSON de Kevin/Leanny tal cual), para calcular la sincronizacion.
function cartasCrudasMiembro(discordId, fileName) {
    const c = (cache.get(String(discordId))?.crudas || []).find(x => claveCuenta(x.f) === claveCuenta(fileName));
    return c ? { ...(c.c || {}) } : null;
}

// Cartas {id: copias} de una cuenta del miembro (de su resumen), para 📦 Bulk trade.
function cartasDeCuentaMiembro(discordId, fileName) {
    const sin = (n) => String(n || '').replace(/\.xml$/i, '').toLowerCase();
    const c = (cache.get(String(discordId))?.cuentas || []).find(x => sin(x.f) === sin(fileName));
    return c ? { ...(c.c || {}) } : null;
}

// Todas las cuentas del resumen, con la forma de cuentasJson de fast-transfer.js.
function cuentasDe(discordId) {
    return (cache.get(String(discordId))?.cuentas || []).map(c => ({
        // Un nombre "0" o vacio en el JSON no sirve para reconocer la cuenta: se usa el del archivo.
        archivoJson: c.f, fileNameXml: c.f, nombreCuenta: (c.n && c.n !== '0') ? c.n : c.f, valorJson: typeof c.d === 'number' ? c.d : null
    }));
}

// Para los comandos: resumen subido por un usuario (o null) y si su Monitor Link esta en linea.
async function resumenDe(discordId) {
    await asegurarTablas();
    const fila = await db.get(`SELECT datos, cuentas, ts, wishlist, ajustes FROM link_resumen WHERE discord_id = ?`, [String(discordId)]);
    if (!fila) return null;
    try {
        return { cuentas: JSON.parse(fila.datos), total: fila.cuentas, ts: fila.ts, wishlist: fila.wishlist ? JSON.parse(fila.wishlist) : null,
            ajustes: fila.ajustes ? JSON.parse(fila.ajustes) : null };
    } catch (e) { return null; }
}

async function estadoAgente(discordId) {
    await asegurarTablas();
    const fila = await db.get(`SELECT ultimo FROM link_agentes WHERE discord_id = ?`, [String(discordId)]);
    if (!fila) return { vinculado: false, enLinea: false };
    return { vinculado: true, enLinea: Date.now() - (fila.ultimo || 0) < 3 * 60 * 1000, ultimo: fila.ultimo };
}

// Ultimo Monitor Link publicado ({ version, url }) para el mensaje de bienvenida.
const ultimoMonitorLink = () => ultimoAhk();

module.exports = { estadoCuentasComunidad, duenoDe, juegoDeAmigo, amigosDe, mainDe, direccionPublicada, ultimoMonitorLink, anotarHost, registrar, crearCodigo, armarClave, publicarDireccion, resumenDe, estadoAgente, vinculados, pedirCarpeta, estadoCarpeta, pedirXml, pedirAccion, anotarAjusteMiembro, cartasCrudasMiembro, cartasDeCuentaMiembro, cuentasDe, wishlistDe, resumenTs, precargar, mapaCopiasDe, cuentasPorCartaDe, shinedustDe, proxiesCompartidas, normalizarProxy, cuentasReroll, pedirXmlReroll, anotarSobresReroll, entregarSobresReroll, miembrosConSobresPendientes,
    usarParteReroll, escribirProxiesMotor, xmlRerollPorHostActivo, pasarSobresAlHostActivo };
