// Reroll de la comunidad (2026-10-31, plan de Ale): los miembros prestan cuentas con 96+ sobres desde
// Monitor Link ("Share accounts for reroll") y los hosts Online para GP farm (boton en el canal de
// hosts) les abren los sobres GRATIS con el motor (inject.py). Uno solo Online se lleva todas las
// cuentas y todas las proxies; dos, mitad y mitad (una cuenta nunca la abren dos hosts). Mismo
// criterio que ⚡ Fast Share:
//   - la XML se pide al Monitor Link del miembro justo antes de abrir, va a una carpeta temporal y
//     se borra al terminar (nunca queda guardada en el host);
//   - el JSON del miembro nunca sale de su PC: el host le devuelve solo las cartas que salieron y
//     Monitor Link las escribe en su JSON (pulls[], packCount, lastPackPulled);
//   - nunca se gastan relojes de los miembros (--hg-cost 0: solo los sobres gratis).
// Los Monitor Link solo hablan con el host del turno: un host Online sin el turno pide las XML (y
// manda las cartas) a traves de el.
//
// Corre solo en un host con motor (FAST_TRANSFER_ENGINE_DIR) y marcado Online para GP farm.
// Ajustes opcionales del .env: REROLL_CADA_MIN (10), REROLL_COOLDOWN_HORAS (24), REROLL_LOTE (20).
// (2026-11-01, pedido de Ale: cada 10 min en vez de 30; una vuelta que no termino hace saltar la siguiente.)
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
let ppm = null;               // { desde, sobres } del GP farm desde que este host esta Online

const log = (...a) => console.log('[reroll]', ...a);

// d: { ml (monitor-link-server), fastTransfer, activo() (tiene el turno), parte() ({ i, n } o null),
//      marcar(online) (GP farm Online/Offline en Upstash) }
function iniciar(d) {
    deps = d;
    if (!deps.fastTransfer.rutaMotor()) return;
    instalarPanel(deps.fastTransfer.rutaMotor());
    // La parte de proxies cambia cuando otro host entra o sale: se rehace el .txt cada minuto.
    setInterval(() => deps.ml.escribirProxiesMotor().catch(() => {}), 60 * 1000);
    sincronizarPanel();
    setInterval(sincronizarPanel, 20 * 1000);
    setInterval(ciclo, num(process.env.REROLL_CADA_MIN, 10) * 60 * 1000);
    setTimeout(revisarPpm, 60 * 1000);
}

// El panel GP con "Community farm" vive en motor-panel/ de este repo y se copia al motor de cada host
// (el motor no se actualiza solo). Solo se reemplaza un panel sin tocar: el original (huella abajo) o
// uno nuestro anterior (marca COMMUNITY_FARM_V1). Uno modificado a mano se deja y se avisa. Copia .bak.
const PANEL_ORIGINAL = 'e3468178b609005e588fd23879ebc95cf7ac22b68b872957b57ad18fa5e35a66';
function instalarPanel(motor) {
    try {
        const nuevo = fs.readFileSync(path.join(__dirname, 'motor-panel', 'god_pack_gui.py'));
        const destino = path.join(motor, 'tools', 'god_pack_gui', 'god_pack_gui.py');
        const actual = fs.readFileSync(destino);
        if (actual.equals(nuevo)) return;
        const huella = crypto.createHash('sha256').update(actual).digest('hex');
        if (huella !== PANEL_ORIGINAL && !actual.includes('COMMUNITY_FARM_V1')) {
            log('God Pack UI was modified on this PC - not updated. Copy motor-panel/god_pack_gui.py by hand to get "Community farm".');
            return;
        }
        fs.copyFileSync(destino, `${destino}.bak`);
        fs.writeFileSync(destino, nuevo);
        log('God Pack UI updated: it now has "Community farm" (Start/Stop for the GP farm).');
    } catch (e) { /* sin panel en este motor */ }
}

// El GP farm corre SOLO con el panel GP en Start con "Community farm" (2026-11-01, pedido de Ale:
// "que el host ejecute el god pack ui, no que se inicie de la nada"). El panel escribe
// reports/community_farm.json { on, ts } y lo renueva cada 30 s; sin renovar 2 min = apagado.
function panelEncendido(motor) {
    try {
        const p = JSON.parse(fs.readFileSync(path.join(motor, 'reports', 'community_farm.json'), 'utf8'));
        return p.on === true && Date.now() - Number(p.ts || 0) < 2 * 60 * 1000;
    } catch (e) { return false; }
}

// Cada 20 s: el estado Online/Offline del GP farm sigue al panel. Al encenderse arranca una tanda ya.
let panelAntes = null;
async function sincronizarPanel() {
    const motor = deps?.fastTransfer.rutaMotor();
    if (!motor) return;
    const on = panelEncendido(motor);
    if (on === panelAntes) return;
    panelAntes = on;
    await deps.marcar?.(on).catch(() => {});
    log(on ? 'Community farm ON (God Pack UI Start)' : 'Community farm OFF (God Pack UI stopped or closed)');
    if (on) setTimeout(ciclo, 15 * 1000);
    else ppm = null;
}

// PPM del GP farm (2026-11-01, pedido de Ale): Zenith (LatiasBot de wr98) toma el PPM de los mensajes
// del canal de heartbeat. Antes solo lo mandaba el panel GP con Start (scripts/god_pack/ppm_monitor.py),
// asi que el GP farm abria sobres sin que nadie los contara. Ahora el host manda el mismo mensaje, al
// mismo "PPM webhook" y con el mismo "Host name" del panel, cada "PPM Discord Interval" minutos, mientras
// esta Online para GP farm. Si el panel esta corriendo (log vivo), no se manda: dos heartbeats chocan.
async function revisarPpm() {
    let espera = 5;
    try {
        const motor = deps?.fastTransfer.rutaMotor();
        const s = motor ? ajustesPanel(motor) : {};
        espera = num(s.ppm_interval, 5);
        const parte = await deps.parte().catch(() => null);
        if (!parte) { ppm = null; return; }
        if (!ppm) ppm = { desde: Date.now(), sobres: 0 };
        const webhook = String(s.ppm_webhook || '').trim();
        if (!/^https:\/\/(\w+\.)?discord(app)?\.com\/api\/webhooks\//.test(webhook)) return;
        // Con Community farm el panel no manda su PPM: aca va todo junto (tus cuentas + las prestadas).
        const sobres = ppm.sobres + sobresPropios(motor, ppm.desde);
        const minutos = Math.max(1, (Date.now() - ppm.desde) / 60000);
        const mensaje = [s.host_name || 'Host', 'Online: Main, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10', 'Offline: none',
            `Time: ${Math.floor(minutos)}m | Packs: ${sobres} | Avg: ${Math.round(sobres / minutos * 100) / 100} packs/min`,
            'Version: wrProxy', 'Type: Inject Wonderpick 96P+', `Opening: ${nombreDeSobre(motor, s.pack_id || 'CN001_0010_00_000')}`].join('\n');
        await fetch(webhook, { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: mensaje }), signal: AbortSignal.timeout(10000) });
    } catch (e) {
        log('PPM report failed:', e?.message || e);
    } finally {
        setTimeout(revisarPpm, espera * 60 * 1000);
    }
}

// Reparto fijo de cuentas entre los hosts Online: cada cuenta cae siempre en el mismo de n hosts.
const miCuenta = (discordId, archivo, parte) =>
    parseInt(crypto.createHash('md5').update(`${discordId}|${archivo}`).digest('hex').slice(0, 8), 16) % parte.n === parte.i;

// Ajustes del panel GP de este host (tools/god_pack_gui/settings.json): pack, collectors, Worker URL,
// webhooks, demoras... El reroll usa los mismos, salvo carpetas, proxies y relojes.
function ajustesPanel(motor) {
    try { return JSON.parse(fs.readFileSync(path.join(motor, 'tools', 'god_pack_gui', 'settings.json'), 'utf8')); } catch (e) { return {}; }
}

// La parte de la bolsa de proxies de ESTE host (proxies_reroll.txt); si la bolsa esta vacia, la del panel.
function archivoProxies(motor, s) {
    const mia = path.join(motor, 'proxies_reroll.txt');
    try { if (fs.readFileSync(mia, 'utf8').trim()) return mia; } catch (e) { /* no hay */ }
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

// Para el aviso al S4T del DUEÑO de la cuenta (su server personal): por cada tipo del bot de Lean,
// cuantas cartas y sus nombres -> "1Star:2:Venusaur (x2);Crown:1:Fuecoco ex". Su Monitor Link arma el
// mensaje con SUS filtros de S4T (Settings.ini de su PTCGPB) y lo manda a SU s4t. Mismo criterio que
// scripts/god_pack/s4t_notifier.py del motor.
let cartasMotor = null;
function avisoS4t(motor, cards) {
    if (!cartasMotor) {
        cartasMotor = {};
        try {
            for (const c of JSON.parse(fs.readFileSync(path.join(motor, 'statics', 'cards.json'), 'utf8'))) {
                const partes = String(c.image || '').replace(/^c/, '').split('_');
                if (partes.length >= 4) cartasMotor[partes.slice(0, 4).join('_')] = { r: String(c.rarity || ''), n: String(c.name || '') };
            }
        } catch (e) { /* sin cards.json: sin aviso */ }
    }
    const TIPO = { C: '1Diamond', U: '2Diamond', R: '3Diamond', RR: '4Diamond', AR: '1Star', SAR: 'Rainbow', IM: 'Immersive', UR: 'Crown', S: 'Shiny1Star', SSR: 'Shiny2Star' };
    const ORDEN = ['1Diamond', '2Diamond', '3Diamond', '4Diamond', '1Star', 'Trainer', 'FullArt', 'Rainbow', 'Immersive', 'Crown', 'Shiny1Star', 'Shiny2Star'];
    const porTipo = {};
    for (const id of cards || []) {
        const c = cartasMotor[id];
        if (!c) continue;
        const t = c.r === 'SR' ? (String(id).startsWith('TR_') ? 'Trainer' : 'FullArt') : TIPO[c.r];
        if (!t) continue;
        (porTipo[t] ||= new Map()).set(c.n, (porTipo[t].get(c.n) || 0) + 1);
    }
    return ORDEN.filter(t => porTipo[t]).map(t => {
        const nombres = [...porTipo[t]].map(([n, k]) => (k > 1 ? `${n} (x${k})` : n).replace(/[;:"\\]/g, ''));
        return `${t}:${[...porTipo[t].values()].reduce((a, b) => a + b, 0)}:${nombres.join(', ')}`;
    }).join(';');
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

// Ticket de compra (product_id) del sobre, sacado de scripts/flow/pack_catalog.py del motor. Sin
// --product-id, inject.py usa el de Team Rocket y el juego rechaza cualquier otro sobre con
// PurchaseV2 INTERNAL (2026-11-01: el GP farm nunca abria Dual Fusion por esto; el panel si lo pasa).
function productoDeSobre(motor, packId) {
    try {
        const catalogo = fs.readFileSync(path.join(motor, 'scripts', 'flow', 'pack_catalog.py'), 'utf8');
        const id = String(packId).replace(/[^A-Za-z0-9_]/g, '');
        return new RegExp(`"pack_id":\\s*"${id}"[^}]*?"product_id":\\s*"([^"]+)"`).exec(catalogo)?.[1] || '';
    } catch (e) { return ''; }
}

// Sobres de TUS cuentas que abrio el panel desde que se encendio el Community farm: cada sobre deja
// una linea "  cards: ..." en reports/god_pack_live.log (el panel lo vacia en cada Start).
function sobresPropios(motor, desde) {
    try {
        const ruta = path.join(motor, 'reports', 'god_pack_live.log');
        if (fs.statSync(ruta).mtimeMs < desde) return 0;
        return (fs.readFileSync(ruta, 'utf8').match(/\] {2,}cards: /g) || []).length;
    } catch (e) { return 0; }
}

// Para el recuadro del host en Discord: nombre del panel ("Ale Cast") y cuantas cuentas propias tiene.
function infoFarm() {
    const motor = deps?.fastTransfer.rutaMotor();
    if (!motor || !panelEncendido(motor)) return null;
    let propias = 0;
    try { propias = Number(JSON.parse(fs.readFileSync(path.join(motor, 'reports', 'community_farm.json'), 'utf8')).own) || 0; } catch (e) { /* sin dato */ }
    return { nombre: String(ajustesPanel(motor).host_name || '').trim() || null, propias };
}

// Nombre del sobre para el mensaje de PPM, igual que el panel ("Dual Fusion: Pikachu").
function nombreDeSobre(motor, packId) {
    try {
        const catalogo = fs.readFileSync(path.join(motor, 'scripts', 'flow', 'pack_catalog.py'), 'utf8');
        const id = String(packId).replace(/[^A-Za-z0-9_]/g, '');
        return new RegExp(`"name":\\s*"([^"]+)"[^}]*?"pack_id":\\s*"${id}"`).exec(catalogo)?.[1] || packId;
    } catch (e) { return packId; }
}

function correrInject(motor, dirCuentas, s, cantidad, duenoId) {
    return new Promise(resolve => {
        const python = deps.fastTransfer.pythonMotor();
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
            '--stop-after-fails', String(s.stop_after_fails || 5),
            // Stop del panel GP: corta la tanda despues de la cuenta en curso (con su limpieza)
            '--stop-file', path.join(motor, 'reports', 'community_farm.stop')];
        if (s.packs_per_min > 0) args.push('--packs-per-min', String(s.packs_per_min));
        const producto = productoDeSobre(motor, s.pack_id || 'CN001_0010_00_000');
        if (producto) args.push('--product-id', producto);
        // Lo que dice el motor queda en reports/reroll_comunidad.log (2026-11-01: todas las cuentas daban
        // 0 sobres y no se veia por que). Pasado de 20 MB se rota a .log.1.
        const rutaLog = path.join(motor, 'reports', 'reroll_comunidad.log');
        let salida = null;
        try {
            fs.mkdirSync(path.dirname(rutaLog), { recursive: true });
            if (fs.existsSync(rutaLog) && fs.statSync(rutaLog).size > 20 * 1024 * 1024) fs.renameSync(rutaLog, `${rutaLog}.1`);
            salida = fs.createWriteStream(rutaLog, { flags: 'a' });
            salida.write(`\n===== ${new Date().toISOString()} owner=${duenoId} accounts=${cantidad} python=${python} =====\n`);
        } catch (e) { salida = null; }
        const escribir = d => { try { salida?.write(d); } catch (e) { /* sin log */ } };
        const cerrar = () => { try { salida?.end(); } catch (e) { /* sin log */ } };
        const hijo = spawn(python, ['-X', 'utf8', ...args], {
            cwd: motor, windowsHide: true,
            // ZENITH_ACCOUNT_OWNER: el aviso de God Pack en Zenith menciona al dueño de la cuenta prestada.
            env: { ...process.env, UTLS_PROXY: '1', PYTHONIOENCODING: 'utf-8', ZENITH_ACCOUNT_OWNER: String(duenoId || '') }
        });
        hijo.stdout.on('data', escribir);
        hijo.stderr.on('data', escribir);
        hijo.on('error', e => { escribir(`[spawn error] ${e?.message || e}\n`); cerrar(); resolve(false); });
        hijo.on('close', code => { escribir(`[exit ${code}]\n`); cerrar(); resolve(true); });
    });
}

// Cartas que quedaron sin entregar: el host del turno se las manda a cada Monitor Link; otro host se las
// pasa al del turno.
async function entregarPendientes(idMiembro) {
    if (!deps.activo()) return deps.ml.pasarSobresAlHostActivo().catch(() => {});
    const ids = idMiembro ? [idMiembro] : await deps.ml.miembrosConSobresPendientes();
    for (const id of ids) await deps.ml.entregarSobresReroll(id).catch(() => {});
}

async function ciclo() {
    if (corriendo || !deps) return;
    const motor = deps.fastTransfer.rutaMotor();
    const parte = await deps.parte().catch(() => null);
    if (!motor) return;
    corriendo = true;
    try {
        await entregarPendientes();
        if (!parte || !panelEncendido(motor)) return;   // Offline: el panel GP no esta en Start
        await deps.ml.escribirProxiesMotor().catch(() => {});

        const cooldown = num(process.env.REROLL_COOLDOWN_HORAS, 24) * 3600 * 1000;
        const lote = num(process.env.REROLL_LOTE, 20);
        const s = ajustesPanel(motor);
        const estado = leerEstado(motor);
        const miembros = await deps.ml.cuentasReroll();
        // Resumen de cada vuelta (2026-11-01: el ciclo fallaba en silencio y parecia que no hacia nada).
        log(`cycle: host ${parte.i + 1}/${parte.n}, ${miembros.length} member(s) lending, ${miembros.reduce((a, m) => a + m.cuentas.length, 0)} account(s)`);
        for (const m of miembros) {
            if (!panelEncendido(motor)) { log('stopped from the God Pack UI'); break; }
            const ahora = Date.now();
            const listas = m.cuentas.filter(c => miCuenta(m.discord_id, c.f, parte)
                && ahora - Math.max(msDeLean(c.l), estado[`${m.discord_id}|${c.f}`] || 0) >= cooldown).slice(0, lote);
            if (!listas.length) { log(`${m.discord_id}: no account ready (cooldown ${cooldown / 3600000} h)`); continue; }
            if (!await deps.fastTransfer.asegurarTunel()) { log('tunnel 9090 is down - skipping this cycle'); return; }
            let xmls;
            try {
                xmls = deps.activo()
                    ? await deps.ml.pedirXmlReroll(m.discord_id, listas.map(c => c.f))
                    : await deps.ml.xmlRerollPorHostActivo(m.discord_id, listas.map(c => c.f));
            } catch (e) {   // PC del miembro apagada, o el host del turno no contesta
                log(`${m.discord_id}: could not get the ${listas.length} account file(s) ${deps.activo() ? 'from their Monitor Link' : 'through the host with the turn'}: ${e?.message || e}`);
                continue;
            }
            const nombres = Object.keys(xmls);
            if (!nombres.length) { log(`${m.discord_id}: asked for ${listas.length} account file(s), got none back`); continue; }

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
                await correrInject(motor, dir, s, nombres.length, m.discord_id);
                let sobres = 0;
                for (const nombre of nombres) {
                    const base = path.basename(nombre).replace(/\.xml$/i, '');
                    estado[`${m.discord_id}|${nombre}`] = Date.now();
                    let pulls = [];
                    try { pulls = JSON.parse(fs.readFileSync(path.join(dir, `${base}.json`), 'utf8')).pulls || []; } catch (e) { /* nada */ }
                    if (!pulls.length) continue;
                    // Lean anota el codigo del set ("C1"); toda la corrida abre el mismo sobre.
                    const set = await codigoSet(s.pack_id || 'CN001_0010_00_000');
                    for (const p of pulls) { p.pack = set; p.aviso = avisoS4t(motor, p.cards); }
                    await deps.ml.anotarSobresReroll(m.discord_id, nombre, pulls, leanDeMs(Date.now()));
                    sobres += pulls.length;
                }
                guardarEstado(motor, estado);
                if (ppm) ppm.sobres += sobres;
                log(`${sobres} pack(s) opened for ${m.discord_id}`);
            } finally {
                fs.rmSync(dir, { recursive: true, force: true });   // las XML no quedan en el host
            }
            await entregarPendientes(m.discord_id);
        }
    } catch (e) {
        log('cycle failed:', e?.message || e);
    } finally {
        corriendo = false;
    }
}

// Resumen de cuentas prestadas para el panel de hosts (2026-11-01, pedido de Ale): por miembro,
// { [discordId]: [prestadas en total, las que le tocan a ESTE host, de esas las listas para abrir] }.
// "Listas" = pasaron el cooldown (lastPackPulled de Lean y la ultima apertura de este host).
// null si este host esta Offline para GP farm o no tiene motor.
async function resumenPrestadas() {
    if (!deps) return null;
    const motor = deps.fastTransfer.rutaMotor();
    const parte = await deps.parte().catch(() => null);
    if (!motor || !parte) return null;
    const cooldown = num(process.env.REROLL_COOLDOWN_HORAS, 24) * 3600 * 1000;
    const estado = leerEstado(motor);
    const ahora = Date.now();
    const resumen = {};
    for (const m of await deps.ml.cuentasReroll()) {
        const mias = m.cuentas.filter(c => miCuenta(m.discord_id, c.f, parte));
        const listas = mias.filter(c => ahora - Math.max(msDeLean(c.l), estado[`${m.discord_id}|${c.f}`] || 0) >= cooldown).length;
        resumen[m.discord_id] = [m.cuentas.length, mias.length, listas];
    }
    return resumen;
}

module.exports = { iniciar, ciclo, resumenPrestadas, infoFarm };
