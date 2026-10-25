#!/usr/bin/env node
// Monitor Link (2026-10-23, plan de Ale) -- el programa que cada miembro de la comunidad corre en SU
// PC. Lee la carpeta de cuentas del bot de Kevin/Leanny y le manda al bot de Discord SOLO el resumen
// de sus cartas: que cartas tiene cada cuenta, cuantas copias, y su Shinedust. Nunca manda
// contraseñas. Una XML solo sale de esta PC cuando el mismo miembro usa en Discord algo que la
// necesita (⚡ Share/Trade/Farm/Refresh, Extract XML): se manda solo ESA, y el bot la borra al terminar.
//
// Uso: MonitorLink.exe (o node monitor-link.js) -- la primera vez pide la clave de /link y la carpeta
//      node monitor-link.js --reset    (olvida la vinculacion y la carpeta)
//
// Sin dependencias: solo Node 18+ (fetch incluido).
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const readline = require('readline');

const VERSION = '0.7.0';
const CARPETA_CONFIG = path.join(process.env.APPDATA || os.homedir(), 'MonitorLink');
const RUTA_CONFIG = path.join(CARPETA_CONFIG, 'config.json');
const CADA_PING_MS = 60 * 1000;
const CADA_RESUMEN_MS = 10 * 60 * 1000;

const log = (...a) => console.log(`[${new Date().toLocaleTimeString()}]`, ...a);

function leerConfig() {
    try { return JSON.parse(fs.readFileSync(RUTA_CONFIG, 'utf8')); } catch (e) { return {}; }
}
function guardarConfig(cfg) {
    fs.mkdirSync(CARPETA_CONFIG, { recursive: true });
    fs.writeFileSync(RUTA_CONFIG, JSON.stringify(cfg, null, 2));
}

// Un solo lector para todo el programa: abrir uno nuevo por pregunta pierde lo que ya se escribio
// (y con texto pegado de golpe se comia la segunda respuesta).
let lector = null;
const lineas = [];
const esperando = [];
function preguntar(texto) {
    if (!lector) {
        lector = readline.createInterface({ input: process.stdin, output: process.stdout });
        lector.on('line', (l) => (esperando.length ? esperando.shift()(l.trim()) : lineas.push(l.trim())));
    }
    process.stdout.write(texto);
    if (lineas.length) return Promise.resolve(lineas.shift());
    return new Promise(r => esperando.push(r));
}
function cerrarLector() {
    if (lector) { lector.close(); lector = null; }
}

// ---- Vinculacion con /link ----
// ML1 = direccion|codigo. ML2 = ademas la libreta de direcciones (solo lectura) para seguir
// encontrando al bot aunque su direccion cambie.
function leerClave(clave) {
    const m = /^ML([12])-([A-Za-z0-9_-]+)$/.exec(String(clave).trim());
    if (!m) return null;
    const [url, code, libUrl, libToken] = Buffer.from(m[2], 'base64url').toString('utf8').split('|');
    if (!url || !code) return null;
    return { url: url.replace(/\/+$/, ''), code, libreta: libUrl && libToken ? { url: libUrl, token: libToken } : null };
}

// Si el bot cambio de direccion (se reinicio), la busca en la libreta. true si encontro una nueva.
async function actualizarDireccion(cfg) {
    if (!cfg.libreta) return false;
    try {
        const r = await fetch(`${cfg.libreta.url}/get/monitor_link:url`, { headers: { Authorization: `Bearer ${cfg.libreta.token}` } });
        const nueva = (await r.json())?.result;
        if (nueva && nueva !== cfg.serverUrl) {
            cfg.serverUrl = String(nueva).replace(/\/+$/, '');
            guardarConfig(cfg);
            log(`🔁 The bot moved — found its new address.`);
            return true;
        }
    } catch (e) { /* sin internet: se reintenta en el proximo ciclo */ }
    return false;
}

async function vincular(cfg) {
    console.log('\nIn Discord, type /link in the community server and copy the key it gives you.');
    while (true) {
        const datos = leerClave(await preguntar('Paste your link key: '));
        if (!datos) { console.log('That doesn\'t look like a link key (it starts with ML1-). Try again.'); continue; }
        try {
            const r = await fetch(`${datos.url}/link/claim`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code: datos.code, version: VERSION })
            });
            const j = await r.json().catch(() => ({}));
            if (!r.ok) {
                console.log(j.error === 'invalid_or_expired_code'
                    ? 'That key is invalid or expired. Run /link again for a new one.'
                    : `Could not link (${j.error || r.status}). Try again.`);
                continue;
            }
            cfg.serverUrl = datos.url;
            cfg.libreta = datos.libreta;
            cfg.token = j.token;
            cfg.user = j.user;
            guardarConfig(cfg);
            console.log(`✅ Linked as ${j.user}.\n`);
            return;
        } catch (e) {
            console.log(`Could not reach the bot (${e.message}). Is the bot's PC on? Try again.`);
        }
    }
}

// ---- Carpeta de cuentas (JSON del bot de Kevin/Leanny: ...\Accounts\Cards\accounts) ----
const SALTAR = new Set(['windows', 'program files', 'program files (x86)', 'programdata', 'appdata',
    'node_modules', '$recycle.bin', 'system volume information', '.git', 'temp']);

function contarJsonDeCuentas(dir) {
    try {
        const archivos = fs.readdirSync(dir).filter(f => f.toLowerCase().endsWith('.json'));
        if (!archivos.length) return 0;
        const muestra = JSON.parse(fs.readFileSync(path.join(dir, archivos[0]), 'utf8'));
        return Array.isArray(muestra?.pulls) ? archivos.length : 0;
    } catch (e) { return 0; }
}

// La carpeta que se pide es la Main Path de siempre (ej. C:\PTCGPB). Se acepta tambien Accounts,
// Accounts\Cards o la ruta larga de Cards\accounts, para no romper a los que ya la pusieron. Devuelve
// la carpeta de los JSON (Accounts\Cards\accounts) o null; de ahi salen las XML (Accounts\Saved) y la
// wishlist (Accounts\Cards\wishlist.json).
function carpetaJsonDe(ruta) {
    if (!ruta) return null;
    const base = String(ruta).trim().replace(/^"|"$/g, '').replace(/[\\/]+$/, '');
    for (const c of [base, path.join(base, 'accounts'), path.join(base, 'Cards', 'accounts'), path.join(base, 'Accounts', 'Cards', 'accounts')]) {
        if (contarJsonDeCuentas(c)) return c;
    }
    return null;
}
const mainDe = (carpetaJson) => path.resolve(carpetaJson, '..', '..', '..');

function buscarCarpetas() {
    const encontradas = [];
    const recorrer = (dir, prof) => {
        if (prof > 5) return;
        let entradas;
        try { entradas = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
        for (const e of entradas) {
            if (!e.isDirectory() || SALTAR.has(e.name.toLowerCase())) continue;
            const completo = path.join(dir, e.name);
            if (e.name.toLowerCase() === 'accounts' && path.basename(dir).toLowerCase() === 'cards') {
                const n = contarJsonDeCuentas(completo);
                if (n) encontradas.push({ ruta: mainDe(completo), cuentas: n });
                continue;
            }
            recorrer(completo, prof + 1);
        }
    };
    for (const letra of 'CDEFGHIJ') {
        const raiz = `${letra}:\\`;
        if (fs.existsSync(raiz)) recorrer(raiz, 0);
    }
    return encontradas;
}

async function elegirCarpeta(cfg) {
    console.log('Looking for your bot folder (Main Path, the one with Accounts inside)...');
    const opciones = buscarCarpetas();
    opciones.forEach((o, i) => console.log(`  ${i + 1}. ${o.ruta}  (${o.cuentas} accounts)`));
    while (true) {
        const resp = await preguntar(opciones.length
            ? `Pick a number (1-${opciones.length}) or paste another folder path: `
            : 'Could not find it. Paste your Main Path (the bot folder with Accounts inside): ');
        const n = parseInt(resp, 10);
        const ruta = (n >= 1 && n <= opciones.length) ? opciones[n - 1].ruta : resp.replace(/^"|"$/g, '');
        const json = carpetaJsonDe(ruta);
        if (json) {
            cfg.carpetaJson = json;
            cfg.ruta = ruta;
            guardarConfig(cfg);
            console.log(`✅ Using ${ruta}\n`);
            return;
        }
        console.log('No accounts found there (it needs Accounts\\Cards\\accounts inside). Try again.');
    }
}

// ---- Resumen de cartas (sin contraseñas) ----
function armarResumen(carpeta) {
    const cuentas = [];
    for (const archivo of fs.readdirSync(carpeta)) {
        if (!archivo.toLowerCase().endsWith('.json')) continue;
        let data;
        try { data = JSON.parse(fs.readFileSync(path.join(carpeta, archivo), 'utf8')); } catch (e) { continue; }
        if (!Array.isArray(data?.pulls)) continue;
        const c = {};
        for (const pull of data.pulls) {
            for (const id of (Array.isArray(pull?.cards) ? pull.cards : [])) c[id] = (c[id] || 0) + 1;
        }
        const f = data.metadata?.fileName || archivo;
        cuentas.push({
            f, n: data.metadata?.accountName || f,
            d: typeof data.metadata?.shinedust?.value === 'number' ? data.metadata.shinedust.value : null,
            c
        });
    }
    // Wishlist del bot de Kevin/Leanny: Cards\wishlist.json, al lado de Cards\accounts. Solo los ids.
    let wishlist;
    try {
        const w = JSON.parse(fs.readFileSync(path.join(carpeta, '..', 'wishlist.json'), 'utf8').replace(/^\uFEFF/, ''));
        if (Array.isArray(w?.cards)) wishlist = w.cards.map(c => c?.id || c?.code || c?.cardId || c?.cardID).filter(Boolean);
    } catch (e) { /* sin wishlist */ }
    // Archivo propio de ajustes (lo tradeado por el bot + lo que corrigio la sincronizacion con el juego).
    // Los JSON de Kevin/Leanny no se escriben nunca.
    let adjust;
    try { adjust = JSON.parse(fs.readFileSync(path.join(carpeta, '..', 'monitor_link.json'), 'utf8')); } catch (e) { /* todavia no hay */ }
    return { version: VERSION, folder: carpeta, accounts: cuentas, wishlist, adjust };
}

async function subirResumen(cfg, forzar = false, extra = {}) {
    const resumen = { ...armarResumen(cfg.carpetaJson), folder: cfg.ruta || cfg.carpetaJson, ...extra };
    const texto = JSON.stringify(resumen);
    const huella = crypto.createHash('sha256').update(texto).digest('hex');
    if (!forzar && huella === cfg.ultimaHuella) return;
    const r = await fetch(`${cfg.serverUrl}/link/summary`, {
        method: 'POST', headers: { 'Content-Type': 'text/plain', Authorization: `Bearer ${cfg.token}` }, body: texto
    });
    if (r.status === 401) throw Object.assign(new Error('not_linked'), { noVinculado: true });
    if (!r.ok) throw new Error(`summary ${r.status}`);
    const j = await r.json();
    cfg.ultimaHuella = huella;
    guardarConfig(cfg);
    log(`📤 Sent your cards summary (${j.accounts} accounts).`);
}

// ---- XML a pedido ----
// Las XML estan en ...\Accounts\Saved (en subcarpetas numeradas), al lado de Cardsccounts.
let indiceXml = null;
function carpetaXml(cfg) {
    return path.resolve(cfg.carpetaJson, '..', '..', 'Saved');
}
function armarIndiceXml(cfg) {
    const indice = new Map();
    const recorrer = (dir, prof) => {
        if (prof > 3) return;
        let entradas;
        try { entradas = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
        for (const e of entradas) {
            const completo = path.join(dir, e.name);
            if (e.isDirectory()) recorrer(completo, prof + 1);
            else if (e.name.toLowerCase().endsWith('.xml')) indice.set(e.name.toLowerCase(), completo);
        }
    };
    recorrer(carpetaXml(cfg), 0);
    indiceXml = { carpeta: cfg.carpetaJson, indice };
    return indice;
}
function rutaDeXml(cfg, nombre) {
    const clave = (String(nombre).toLowerCase().endsWith('.xml') ? String(nombre) : `${nombre}.xml`).toLowerCase();
    let indice = indiceXml?.carpeta === cfg.carpetaJson ? indiceXml.indice : armarIndiceXml(cfg);
    if (!indice.has(clave)) indice = armarIndiceXml(cfg);   // cuenta nueva desde el ultimo indice
    return indice.get(clave) || null;
}

// Boton de wishlist en Discord: agrega la carta a SU Accounts\Cards\wishlist.json y manda el resumen nuevo.
async function agregarAWishlist(cfg, trabajo) {
    const archivo = path.resolve(cfg.carpetaJson, '..', 'wishlist.json');
    const respuesta = { id: trabajo.id, ok: true, already: false };
    try {
        let data = { version: 1, cards: [] };
        if (fs.existsSync(archivo)) data = JSON.parse(fs.readFileSync(archivo, 'utf8').replace(/^\uFEFF/, ''));
        if (!Array.isArray(data.cards)) data.cards = [];
        if (data.cards.some(c => (c?.id || c?.code) === trabajo.card)) {
            respuesta.already = true;
        } else {
            data.cards.push({ id: trabajo.card, name: trabajo.name });
            data.updatedAt = new Date().toISOString();
            fs.writeFileSync(archivo, JSON.stringify(data, null, 2));
        }
    } catch (e) {
        respuesta.ok = false;
        respuesta.error = e.message;
    }
    await fetch(`${cfg.serverUrl}/link/xml`, {
        method: 'POST', headers: { 'Content-Type': 'text/plain', Authorization: `Bearer ${cfg.token}` }, body: JSON.stringify(respuesta)
    });
    if (respuesta.ok && !respuesta.already) {
        log(`💖 Added to your wishlist: ${trabajo.name}`);
        await subirResumen(cfg, false).catch(() => {});
    }
}

// Info Accounts en Discord: el JSON de cartas de esa cuenta, solo para su dueño (mensaje privado).
async function mandarJsonCuenta(cfg, trabajo) {
    const buscado = String(trabajo.file || '').replace(/\.xml$/i, '').toLowerCase();
    const respuesta = { id: trabajo.id, ok: false, error: 'account file not found' };
    for (const archivo of fs.readdirSync(cfg.carpetaJson)) {
        if (!archivo.toLowerCase().endsWith('.json')) continue;
        const texto = fs.readFileSync(path.join(cfg.carpetaJson, archivo), 'utf8');
        const f = /"fileName"\s*:\s*"([^"]*)"/.exec(texto)?.[1];
        if (f && f.replace(/\.xml$/i, '').toLowerCase() === buscado) {
            Object.assign(respuesta, { ok: true, error: undefined, jsonName: archivo, json: texto });
            break;
        }
    }
    await fetch(`${cfg.serverUrl}/link/xml`, {
        method: 'POST', headers: { 'Content-Type': 'text/plain', Authorization: `Bearer ${cfg.token}` }, body: JSON.stringify(respuesta)
    });
}

// Sincronizar cartas: el bot corrige el JSON de la cuenta (lo que ya no tiene sale, lo nuevo entra,
// las copias se respetan). Queda un respaldo <archivo>.json.bak.
async function escribirJsonCuenta(cfg, trabajo) {
    const buscado = String(trabajo.file || '').replace(/\.xml$/i, '').toLowerCase();
    const respuesta = { id: trabajo.id, ok: false, error: 'account file not found' };
    const contenido = Buffer.from(String(trabajo.content || ''), 'base64').toString('utf8');
    for (const archivo of fs.readdirSync(cfg.carpetaJson)) {
        if (!archivo.toLowerCase().endsWith('.json')) continue;
        const ruta = path.join(cfg.carpetaJson, archivo);
        const texto = fs.readFileSync(ruta, 'utf8');
        const f = /"fileName"\s*:\s*"([^"]*)"/.exec(texto)?.[1];
        if (f && f.replace(/\.xml$/i, '').toLowerCase() === buscado) {
            if (!contenido.includes('"pulls"')) { respuesta.error = 'bad content'; break; }
            fs.writeFileSync(`${ruta}.bak`, texto);
            fs.writeFileSync(ruta, contenido);
            Object.assign(respuesta, { ok: true, error: undefined });
            break;
        }
    }
    await fetch(`${cfg.serverUrl}/link/xml`, {
        method: 'POST', headers: { 'Content-Type': 'text/plain', Authorization: `Bearer ${cfg.token}` }, body: JSON.stringify(respuesta)
    });
    if (respuesta.ok) await subirResumen(cfg, false).catch(() => {});
}

async function guardarAjustes(cfg, trabajo) {
    const respuesta = { id: trabajo.id, ok: false, error: 'bad content' };
    const contenido = Buffer.from(String(trabajo.content || ''), 'base64').toString('utf8');
    try {
        JSON.parse(contenido);
        fs.writeFileSync(path.resolve(cfg.carpetaJson, '..', 'monitor_link.json'), contenido);
        Object.assign(respuesta, { ok: true, error: undefined });
    } catch (e) { respuesta.error = e.message; }
    await fetch(`${cfg.serverUrl}/link/xml`, {
        method: 'POST', headers: { 'Content-Type': 'text/plain', Authorization: `Bearer ${cfg.token}` }, body: JSON.stringify(respuesta)
    });
}

async function atenderTrabajo(cfg, trabajo) {
    if (trabajo.action === 'ml_file_write') return guardarAjustes(cfg, trabajo);
    if (trabajo.action === 'wishlist_add') return agregarAWishlist(cfg, trabajo);
    if (trabajo.action === 'write_json') return escribirJsonCuenta(cfg, trabajo);
    if (trabajo.action === 'account_json') return mandarJsonCuenta(cfg, trabajo);
    const files = {};
    const missing = [];
    for (const nombre of trabajo.files || []) {
        const ruta = rutaDeXml(cfg, nombre);
        try { if (ruta) { files[nombre] = fs.readFileSync(ruta, 'utf8'); continue; } } catch (e) { /* cae a missing */ }
        missing.push(nombre);
    }
    await fetch(`${cfg.serverUrl}/link/xml`, {
        method: 'POST', headers: { 'Content-Type': 'text/plain', Authorization: `Bearer ${cfg.token}` },
        body: JSON.stringify({ id: trabajo.id, files, missing })
    });
    const n = Object.keys(files).length;
    log(`🔑 Sent ${n} account file${n === 1 ? '' : 's'} you asked for in Discord${missing.length ? ` (${missing.length} not found)` : ''}.`);
}

// Consulta larga: queda esperando hasta 25 s a que Discord pida algo, y vuelve a esperar.
async function esperarTrabajos(cfg) {
    while (true) {
        try {
            const r = await fetch(`${cfg.serverUrl}/link/jobs`, { headers: { Authorization: `Bearer ${cfg.token}` } });
            if (!r.ok) throw new Error(`jobs ${r.status}`);
            const { jobs } = await r.json();
            for (const t of jobs || []) await atenderTrabajo(cfg, t).catch(e => log(`⚠️ Could not send an account file (${e.message}).`));
        } catch (e) {
            // El bot se reinicio (cambia de direccion) o no tiene el turno: se busca la direccion
            // actual en la libreta al momento, asi no queda un minuto sin poder atender pedidos.
            if (await actualizarDireccion(cfg)) { subirResumen(cfg, true).catch(() => {}); continue; }
            await new Promise(r => setTimeout(r, 5000));
        }
    }
}

async function main() {
    console.log(`Monitor Link v${VERSION}`);
    if (process.argv.includes('--reset')) { try { fs.unlinkSync(RUTA_CONFIG); } catch (e) { /* nada */ } }
    const cfg = leerConfig();
    // Una vez vinculado queda vinculado: solo se vuelve a preguntar si no hay vinculacion, si la
    // carpeta ya no existe, o si el miembro pide cambiarla (--change-folder).
    if (!cfg.token) await vincular(cfg);
    if (process.argv.includes('--change-folder') || !cfg.carpetaJson || !contarJsonDeCuentas(cfg.carpetaJson)) await elegirCarpeta(cfg);
    cerrarLector();
    console.log(`Linked as ${cfg.user} · folder: ${cfg.carpetaJson}`);
    console.log('Running — keep this window open (you can minimize it).');
    console.log('To use another folder later, start it with --change-folder.\n');

    const ciclo = async (forzar) => {
        try {
            await subirResumen(cfg, forzar);
        } catch (e) {
            if (e.noVinculado) {
                console.log('This PC is no longer linked. Run /link again.');
                delete cfg.token; guardarConfig(cfg);
                await vincular(cfg);
                return ciclo(true);
            }
            // Puede que el bot se haya reiniciado con otra direccion: se busca en la libreta.
            if (await actualizarDireccion(cfg)) return ciclo(true);
            log(`⚠️ Could not reach the bot (${e.message}). Will retry.`);
        }
    };
    await ciclo(true);
    esperarTrabajos(cfg);
    setInterval(() => ciclo(false), CADA_RESUMEN_MS);
    setInterval(async () => {
        try {
            const r = await fetch(`${cfg.serverUrl}/link/ping`, { headers: { Authorization: `Bearer ${cfg.token}` } });
            if (!r.ok && r.status !== 401 && await actualizarDireccion(cfg)) ciclo(true);
            // 📁 Set My Folder desde Discord: si pidio otra carpeta, se cambia (si existe en esta PC).
            const pedida = r.ok ? (await r.json().catch(() => ({}))).folder : null;
            if (pedida && pedida.toLowerCase() !== String(cfg.ruta || cfg.carpetaJson).toLowerCase()) {
                const json = carpetaJsonDe(pedida);
                if (json) {
                    cfg.carpetaJson = json;
                    cfg.ruta = pedida;
                    guardarConfig(cfg);
                    log(`📁 Folder changed from Discord: ${pedida}`);
                    await subirResumen(cfg, true);
                } else {
                    log(`⚠️ Discord asked for ${pedida}, but there are no account files there. Keeping the current folder.`);
                    await subirResumen(cfg, true, { folderError: `No Accounts\\Cards\\accounts inside ${pedida} on this PC` });
                }
            }
        } catch (e) {
            if (await actualizarDireccion(cfg)) ciclo(true);
        }
    }, CADA_PING_MS);
}

process.title = 'Monitor Link';
// Como .exe se abre con doble clic: si algo falla, la ventana queda abierta para leer el error.
main().catch(async e => {
    console.error('Monitor Link stopped:', e?.message || e);
    process.exitCode = 1;
    await preguntar('\nPress Enter to close.');
    cerrarLector();
});
