#!/usr/bin/env node
// Monitor Link (2026-10-23, plan de Ale) -- el programa que cada miembro de la comunidad corre en SU
// PC. Lee la carpeta de cuentas del bot de Kevin/Leanny y le manda al bot de Discord SOLO el resumen
// de sus cartas: que cartas tiene cada cuenta, cuantas copias, y su Shinedust. Nunca manda
// contraseñas ni archivos XML.
//
// Uso: node monitor-link.js            (la primera vez pide la clave de /link y la carpeta)
//      node monitor-link.js --reset    (olvida la vinculacion y la carpeta)
//
// Sin dependencias: solo Node 18+ (fetch incluido).
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const readline = require('readline');

const VERSION = '0.1.0';
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
function leerClave(clave) {
    const m = /^ML1-([A-Za-z0-9_-]+)$/.exec(String(clave).trim());
    if (!m) return null;
    const [url, code] = Buffer.from(m[1], 'base64url').toString('utf8').split('|');
    return url && code ? { url: url.replace(/\/+$/, ''), code } : null;
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
                if (n) encontradas.push({ ruta: completo, cuentas: n });
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
    console.log('Looking for your accounts folder (Accounts\\Cards\\accounts)...');
    const opciones = buscarCarpetas();
    opciones.forEach((o, i) => console.log(`  ${i + 1}. ${o.ruta}  (${o.cuentas} accounts)`));
    while (true) {
        const resp = await preguntar(opciones.length
            ? `Pick a number (1-${opciones.length}) or paste another folder path: `
            : 'Could not find it. Paste the path of your Accounts\\Cards\\accounts folder: ');
        const n = parseInt(resp, 10);
        const ruta = (n >= 1 && n <= opciones.length) ? opciones[n - 1].ruta : resp.replace(/^"|"$/g, '');
        if (ruta && contarJsonDeCuentas(ruta)) {
            cfg.carpetaJson = ruta;
            guardarConfig(cfg);
            console.log(`✅ Using ${ruta}\n`);
            return;
        }
        console.log('That folder has no account files. Try again.');
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
    return { version: VERSION, accounts: cuentas };
}

async function subirResumen(cfg, forzar = false) {
    const resumen = armarResumen(cfg.carpetaJson);
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

async function main() {
    console.log(`Monitor Link v${VERSION}`);
    if (process.argv.includes('--reset')) { try { fs.unlinkSync(RUTA_CONFIG); } catch (e) { /* nada */ } }
    const cfg = leerConfig();
    if (!cfg.token) await vincular(cfg);
    if (!cfg.carpetaJson || !contarJsonDeCuentas(cfg.carpetaJson)) await elegirCarpeta(cfg);
    cerrarLector();
    console.log(`Linked as ${cfg.user}. Running — keep this window open (you can minimize it).\n`);

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
            log(`⚠️ Could not reach the bot (${e.message}). Will retry.`);
        }
    };
    await ciclo(true);
    setInterval(() => ciclo(false), CADA_RESUMEN_MS);
    setInterval(async () => {
        try { await fetch(`${cfg.serverUrl}/link/ping`, { headers: { Authorization: `Bearer ${cfg.token}` } }); }
        catch (e) { /* el resumen ya avisa si no hay conexion */ }
    }, CADA_PING_MS);
}

main().catch(e => { console.error('Monitor Link stopped:', e); process.exitCode = 1; });
