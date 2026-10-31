// Reroll de la comunidad (2026-10-31, plan de Ale): los miembros prestan cuentas con 96+ sobres desde
// Monitor Link ("Share accounts for reroll") y el host que tiene el turno les abre los sobres GRATIS
// con el motor (inject.py) y la bolsa de proxies. Mismo criterio que ⚡ Fast Share:
//   - la XML se pide al Monitor Link del miembro justo antes de abrir, va a una carpeta temporal y
//     se borra al terminar (nunca queda guardada en el host);
//   - el JSON del miembro nunca sale de su PC: el host le devuelve solo las cartas que salieron y
//     Monitor Link las escribe en su JSON (pulls[], packCount, lastPackPulled);
//   - nunca se gastan relojes de los miembros (--hg-cost 0: solo los sobres gratis).
//
// Apagado por defecto: corre solo si el .env tiene REROLL_COMUNIDAD=1, hay motor
// (FAST_TRANSFER_ENGINE_DIR) y este host tiene el turno de la comunidad.
// Ajustes opcionales del .env: REROLL_CADA_MIN (30), REROLL_COOLDOWN_HORAS (24), REROLL_LOTE (20).
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const LEANNY = 'https://leanny.github.io/pocket_tcg_resources/data';
const num = (v, def) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : def);

let deps = null;
let corriendo = false;
let expansionDePack = null;   // pack_id -> codigo del set ("CN001_0010_00_000" -> "C1")

const log = (...a) => console.log('[reroll]', ...a);

function iniciar(d) {
    deps = d;
    if (process.env.REROLL_COMUNIDAD !== '1') return;
    log('Community reroll ON');
    setTimeout(ciclo, 2 * 60 * 1000);
    setInterval(ciclo, num(process.env.REROLL_CADA_MIN, 30) * 60 * 1000);
}

// Ajustes del panel GP de este host (tools/god_pack_gui/settings.json): pack, collectors, Worker URL,
// webhooks, demoras... El reroll usa los mismos, salvo carpetas, proxies y relojes.
function ajustesPanel(motor) {
    try { return JSON.parse(fs.readFileSync(path.join(motor, 'tools', 'god_pack_gui', 'settings.json'), 'utf8')); } catch (e) { return {}; }
}

// Bolsa de proxies de la comunidad (Share proxies); si todavia esta vacia, la del panel.
function archivoProxies(motor, s) {
    const bolsa = path.join(motor, 'proxies_comunidad.txt');
    try { if (fs.readFileSync(bolsa, 'utf8').trim()) return bolsa; } catch (e) { /* no hay */ }
    return s.proxy_file || path.join(motor, 'proxies.txt');
}

// Estado propio: cuando se abrio por ultima vez cada cuenta prestada ("discordId|archivo" -> ms).
function rutaEstado(motor) { return path.join(motor, 'reports', 'reroll_comunidad.json'); }
function leerEstado(motor) { try { return JSON.parse(fs.readFileSync(rutaEstado(motor), 'utf8')); } catch (e) { return {}; } }
function guardarEstado(motor, estado) {
    fs.mkdirSync(path.dirname(rutaEstado(motor)), { recursive: true });
    fs.writeFileSync(rutaEstado(motor), JSON.stringify(estado, null, 1));
}

// "20261031010203" (lastPackPulled de Lean, hora local) -> ms.
function msDeLean(l) {
    const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(String(l || ''));
    return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime() : 0;
}
function leanDeMs(ms) {
    const d = new Date(ms), dos = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}${dos(d.getMonth() + 1)}${dos(d.getDate())}${dos(d.getHours())}${dos(d.getMinutes())}${dos(d.getSeconds())}`;
}

async function codigoSet(packId) {
    if (!expansionDePack) {
        try {
            const pm = await (await fetch(`${LEANNY}/packmaster.json`, { signal: AbortSignal.timeout(30000) })).json();
            expansionDePack = Object.fromEntries(Object.entries(pm).map(([id, p]) => [id, p.ExpansionID]));
        } catch (e) { return packId; }
    }
    return expansionDePack[packId] || packId;
}

function correrInject(motor, dirCuentas, s, cantidad) {
    return new Promise(resolve => {
        const python = process.env.FAST_TRANSFER_PYTHON || 'python';
        const args = [path.join(motor, 'scripts', 'god_pack', 'inject.py'),
            '--collector-codes', (s.collectors || []).join(',') || 'dummy',
            '--worker-url', s.worker_url || 'https://onlineids.zenithrise.workers.dev/elite',
            '--packs', String(s.packs || 2),
            '--pack-id', s.pack_id || 'CN001_0010_00_000',
            '--accounts-dir', dirCuentas, '--xml-dir', dirCuentas, '--json-dir', dirCuentas,
            '--proxy-file', archivoProxies(motor, s),
            '--proxy-scheme', s.proxy_scheme || 'http',
            '--cooldown-hours', '0',               // el cooldown lo decide este modulo
            '--wait-accept', String(s.wait_accept ?? 10),
            '--pack-delay', String(s.pack_delay ?? 2),
            '--account-delay', String(s.account_delay ?? 2),
            '--parallel', String(s.parallel || 3),
            '--limit', String(cantidad),
            '--mode', s.run_mode || 'godpack',
            '--farming-mode', s.farming_mode || 'only_gp',
            '--pack-power-min', s.pack_power_min || '1/5',
            '--hg-cost', '0',                      // nunca gastar relojes del miembro
            '--no-quarantine-locked',              // las XML son temporales: no hay nada que mover
            '--verify-power', '--shuffle-proxies',
            '--stop-after-fails', String(s.stop_after_fails || 5)];
        if (s.packs_per_min > 0) args.push('--packs-per-min', String(s.packs_per_min));
        const hijo = spawn(python, ['-X', 'utf8', ...args], {
            cwd: motor, windowsHide: true,
            env: { ...process.env, UTLS_PROXY: '1', PYTHONIOENCODING: 'utf-8' }
        });
        hijo.stdout.on('data', () => {});
        hijo.stderr.on('data', () => {});
        hijo.on('error', () => resolve(false));
        hijo.on('close', () => resolve(true));
    });
}

async function ciclo() {
    if (corriendo || !deps || !deps.activo()) return;
    const motor = deps.fastTransfer.rutaMotor();
    if (!motor) return;
    corriendo = true;
    try {
        // Primero lo que quedo sin entregar (miembro que tenia la PC apagada).
        for (const id of await deps.ml.miembrosConSobresPendientes()) await deps.ml.entregarSobresReroll(id).catch(() => {});

        const cooldown = num(process.env.REROLL_COOLDOWN_HORAS, 24) * 3600 * 1000;
        const lote = num(process.env.REROLL_LOTE, 20);
        const s = ajustesPanel(motor);
        const estado = leerEstado(motor);
        for (const m of await deps.ml.cuentasReroll()) {
            const ahora = Date.now();
            const listas = m.cuentas.filter(c => ahora - Math.max(msDeLean(c.l), estado[`${m.discord_id}|${c.f}`] || 0) >= cooldown).slice(0, lote);
            if (!listas.length) continue;
            if (!await deps.fastTransfer.asegurarTunel()) { log('tunnel 9090 is down - skipping this cycle'); return; }
            let xmls;
            try { xmls = await deps.ml.pedirXmlReroll(m.discord_id, listas.map(c => c.f)); } catch (e) { continue; } // PC apagada
            const nombres = Object.keys(xmls);
            if (!nombres.length) continue;

            const dir = path.join(os.tmpdir(), `ml_reroll_${crypto.randomBytes(6).toString('hex')}`);
            fs.mkdirSync(dir, { recursive: true });
            try {
                // XML con su nombre original + un JSON vacio al lado: inject.py anota ahi lo que sale.
                for (const nombre of nombres) {
                    const base = path.basename(nombre).replace(/\.xml$/i, '');
                    fs.writeFileSync(path.join(dir, `${base}.xml`), xmls[nombre]);
                    fs.writeFileSync(path.join(dir, `${base}.json`), JSON.stringify({ metadata: {}, pulls: [], registeredCards: [] }));
                }
                log(`opening ${nombres.length} account(s) lent by ${m.discord_id}`);
                await correrInject(motor, dir, s, nombres.length);
                let sobres = 0;
                for (const nombre of nombres) {
                    const base = path.basename(nombre).replace(/\.xml$/i, '');
                    estado[`${m.discord_id}|${nombre}`] = Date.now();
                    let pulls = [];
                    try { pulls = JSON.parse(fs.readFileSync(path.join(dir, `${base}.json`), 'utf8')).pulls || []; } catch (e) { /* nada */ }
                    if (!pulls.length) continue;
                    // Lean anota el codigo del set ("C1"); toda la corrida abre el mismo sobre.
                    const set = await codigoSet(s.pack_id || 'CN001_0010_00_000');
                    for (const p of pulls) p.pack = set;
                    await deps.ml.anotarSobresReroll(m.discord_id, nombre, pulls, leanDeMs(Date.now()));
                    sobres += pulls.length;
                }
                guardarEstado(motor, estado);
                log(`${sobres} pack(s) opened for ${m.discord_id}`);
            } finally {
                fs.rmSync(dir, { recursive: true, force: true });   // las XML no quedan en el host
            }
            await deps.ml.entregarSobresReroll(m.discord_id).catch(() => {});
        }
    } catch (e) {
        log('cycle failed:', e?.message || e);
    } finally {
        corriendo = false;
    }
}

module.exports = { iniciar, ciclo };
