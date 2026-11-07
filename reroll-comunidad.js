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
// Ajustes opcionales del .env: REROLL_CADA_MIN (10), REROLL_COOLDOWN_HORAS (24), REROLL_LOTE (50).
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
let ppm = null;               // { desde, sobres, propios?, logPos?, pausado?, pausa? } del GP farm
const PPM_PAUSA_MS = 15 * 60 * 1000;   // tras un Stop, el PPM se guarda 15 min por si vuelve a dar Start

const log = (...a) => console.log('[reroll]', ...a);

// d: { ml (monitor-link-server), fastTransfer, activo() (tiene el turno), parte() ({ i, n } o null),
//      marcar(online) (GP farm Online/Offline en Upstash) }
function iniciar(d) {
    deps = d;
    if (!deps.fastTransfer.rutaMotor()) return;
    instalarPanel(deps.fastTransfer.rutaMotor());
    agregarSobresExtra(deps.fastTransfer.rutaMotor());
    aplicarAjustesRecomendados(deps.fastTransfer.rutaMotor());
    borrarTemporalesViejas();
    setInterval(borrarTemporalesViejas, 60 * 60 * 1000);
    instalarArchivoMotor(deps.fastTransfer.rutaMotor(), 'inject.py', ['scripts', 'god_pack', 'inject.py'],
        INJECT_ORIGINAL, '_limit_collectors', 'own accounts follow the Run Mode, ~36 packs/min in total, packs saved as their set (C1)',
        // (2026-11-06, Ale) Un Main quedo con soft ban de amigos: un host con su inject.py propio mandaba a 13 Mains
        // por cuenta sin limite. Sin estos limites se instala el nuestro igual (el suyo queda como .bak-propio).
        // (2026-11-07) Ahora el obligatorio es el tope de PPM de la comunidad (lee reports/ppm_cap.json).
        'UNDER_96_LOCKED_V1');
    // (2026-11-06) Aviso de God Pack que no se perdia al terminar cada tanda del GP farm.
    instalarArchivoMotor(deps.fastTransfer.rutaMotor(), 'discord_notifier.py', ['scripts', 'god_pack', 'discord_notifier.py'],
        '75d4eee05e3bb22f6cfe09ff1c8e935de312fc66b246b9f9d1b8214c4c85b908', 'daemon=False: en el GP farm', 'God Pack alerts always sent',
        // (2026-11-06, Arcade) Sin el webhook de la comunidad sus God Packs no le llegan a KyuremBot: se instala igual
        // aunque este modificado a mano (el suyo queda como .bak-propio).
        'community_gp_webhook');
    // (2026-11-06) PPM del panel de wr98: sigue 15 min despues de un Stop y cuenta tambien el GP farm.
    instalarArchivoMotor(deps.fastTransfer.rutaMotor(), 'ppm_monitor.py', ['scripts', 'god_pack', 'ppm_monitor.py'],
        '2d3767ae2968a2c66e9ac2ec0fb8c0331d486839486a6e1921c756b35299a8f3', 'CACHE_TTL_SEC = 15 * 60', 'PPM kept 15 min after Stop');
    // La parte de proxies cambia cuando otro host entra o sale: se rehace el .txt cada minuto.
    setInterval(() => deps.ml.escribirProxiesMotor().catch(() => {}), 60 * 1000);
    sincronizarPanel();
    setInterval(sincronizarPanel, 20 * 1000);
    setInterval(ciclo, num(process.env.REROLL_CADA_MIN, 10) * 60 * 1000);
    setTimeout(revisarPpm, 60 * 1000);
    setInterval(revisarLlenos, 60 * 1000);
    setInterval(() => copiarWebhookGp().catch(() => {}), 60 * 1000);
    setInterval(() => { try { vigilarGodPacks(); } catch (e) { /* nada */ } }, 20 * 1000);
    setInterval(() => escribirVersion().catch(() => {}), 60 * 1000);
    escribirVersion().catch(() => {});
    copiarWebhookGp().catch(() => {});
    setInterval(() => escribirEstadoPanel().catch(() => {}), 30 * 1000);
    setInterval(() => escribirTopePpm().catch(() => {}), 30 * 1000);
    escribirTopePpm().catch(() => {});
    setInterval(() => escribirSetsSobres().catch(() => {}), 6 * 3600 * 1000);
    escribirSetsSobres().catch(() => {});
}

// Codigo de set de cada sobre (2026-11-07, Ale: el historial de las cuentas mostraba los sobres de Dual Fusion
// como "indefinido"): reports/pack_sets.json { pack_id: "C1" } desde el packmaster de Leanny. inject.py lo usa
// para anotar pulls[] con el set, igual que PTCGPB, y para corregir los que quedaron con el id crudo.
async function escribirSetsSobres() {
    const motor = deps?.fastTransfer.rutaMotor();
    if (!motor) return;
    const pm = await (await fetch(`${LEANNY}/packmaster.json`, { signal: AbortSignal.timeout(30000) })).json();
    const sets = Object.fromEntries(Object.entries(pm).filter(([, p]) => p?.ExpansionID).map(([id, p]) => [id, p.ExpansionID]));
    if (!Object.keys(sets).length) return;
    fs.mkdirSync(path.join(motor, 'reports'), { recursive: true });
    fs.writeFileSync(path.join(motor, 'reports', 'pack_sets.json'), JSON.stringify(sets));
}

// Tope de PPM de la comunidad (2026-11-07, Ale: soft ban de amigos en su Main; "que no pase de 35 o 38 PPM").
// Cada cuenta en GP farm manda solicitud a todos los Mains, asi que el PPM total de los hosts = solicitudes
// por minuto que recibe cada Main. Se reparte PPM_COMUNIDAD (36) entre los hosts en modo God Pack con Start;
// uno solo se lleva todo. inject.py lo lee de reports/ppm_cap.json (si tiene mas de 5 min, no lo usa).
async function escribirTopePpm() {
    const motor = deps?.fastTransfer.rutaMotor();
    if (!motor) return;
    const total = num(process.env.PPM_COMUNIDAD, 40);   // 2026-11-07: 36 -> 20 (soft bans) -> 40 (Ale/Arcade, ya sin rafagas ni amistades sin borrar)
    const hosts = await deps.hostsFarm?.('godpack').catch(() => null);
    if (!Array.isArray(hosts)) return;
    const parte = await deps.parte('godpack').catch(() => null);
    // Este host farmeando sin "Community farm" no figura en la lista: cuenta igual como uno mas.
    const n = Math.max(1, hosts.length + (parte ? 0 : 1));
    fs.mkdirSync(path.join(motor, 'reports'), { recursive: true });
    fs.writeFileSync(path.join(motor, 'reports', 'ppm_cap.json'),
        JSON.stringify({ cap: Math.floor(total / n), total, hosts: n, ts: Date.now() }));
}

// Anti doble reroll (2026-11-01, plan de Ale): inject.py anota en reports/collectors_full.jsonl cada main
// que rechazo nuestra solicitud mientras los demas la aceptaban (lista de amigos llena, 99). Cada cuenta
// nuestra queda agregada a un main solo ~30 s y hay a lo sumo ~14 a la vez por host farmeando, asi que un
// main lleno tiene casi todos sus amigos de AFUERA: acepta solicitudes de otro grupo. Por ahora solo se
// avisa (en el canal de hosts); un aviso por main cada 6 h aunque lo detecten varios hosts.
const TOPE_AMIGOS = 99, NUESTRAS_POR_HOST = 14, TOLERANCIA = 5;
const AVISAR_LLENOS = false;   // aviso "Possible double reroll" en 🔒-hosts: apagado (falsos positivos)
let posLlenos = null;
async function revisarLlenos() {
    const motor = deps?.fastTransfer.rutaMotor();
    if (!motor) return;
    // (2026-11-06, Ale) Mains con la lista de amigos llena (o bloqueo de amigos): el motor los saltea 30 min despues
    // de 3 rechazos (reports/collectors_paused_v3.json). Aca se avisa en 🔒-hosts, una vez cada 6 h por Main, para que
    // el dueño borre amigos. (Reemplaza el aviso de "doble reroll", que daba falsos positivos.)
    let pausados = {};
    try { pausados = JSON.parse(fs.readFileSync(path.join(motor, 'reports', 'collectors_paused_v3.json'), 'utf8')).paused || {}; } catch (e) { return; }
    for (const [codigo, hasta] of Object.entries(pausados)) {
        if (Number(hasta) * 1000 < Date.now()) continue;
        if (!await deps.primeraVez?.(`zenith:lleno2:${codigo}`, 6 * 3600).catch(() => false)) continue;
        const legible = /^\d{16}$/.test(codigo) ? codigo.replace(/(\d{4})(?=\d)/g, '$1-') : codigo;
        const nombre = await Promise.resolve(deps.nombreMain?.(codigo)).catch(() => null);
        log(`main refusing friend requests: ${legible}${nombre ? ` (${nombre})` : ''}`);
        await deps.avisar?.(`⚠️ **Main refusing friend requests** — \`${legible}\`${nombre ? ` (**${nombre}**)` : ''} refused our requests 3 times in 15 min. `
            + `Its **friend list is probably full (99)**, it has too many pending requests (not accepting), or a temporary friend soft-ban.\n`
            + `> The farm skips it for 15 min. The owner should check the Main is accepting requests and **remove friends** (keep only God Packs still to pick).`).catch(() => {});
    }
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

// Mismo criterio para inject.py (2026-11-01): tope de 5 collectors online por cuenta, rotando (con 15
// online el PPM caia a un tercio por las 15 amistades que hay que borrar en cada cuenta).
const INJECT_ORIGINAL = '0bbd4dca2728ad2f93d428d51d2ff44d22b72fe6702b256458f91ca3567af938';
// obligatorio (opcional): texto que el archivo del host TIENE que tener; si le falta, se instala el nuestro aunque
// este modificado a mano, y el suyo se guarda como .bak-propio.
function instalarArchivoMotor(motor, archivo, rutaDestino, huellaOriginal, marca, que, obligatorio = null) {
    try {
        const nuevo = fs.readFileSync(path.join(__dirname, 'motor-panel', archivo));
        const destino = path.join(motor, ...rutaDestino);
        const actual = fs.readFileSync(destino);
        if (actual.equals(nuevo)) return;
        const huella = crypto.createHash('sha256').update(actual).digest('hex');
        if (obligatorio && !actual.includes(obligatorio) && huella !== huellaOriginal && !actual.includes(marca)) {
            fs.copyFileSync(destino, `${destino}.bak-propio`);
            fs.writeFileSync(destino, nuevo);
            log(`${archivo} was modified on this PC but lacked a required fix - replaced (yours saved as ${archivo}.bak-propio): ${que}.`);
            return;
        }
        if (huella !== huellaOriginal && !actual.includes(marca)) {
            log(`${archivo} was modified on this PC - not updated. Copy motor-panel/${archivo} by hand to get: ${que}.`);
            return;
        }
        fs.copyFileSync(destino, `${destino}.bak`);
        fs.writeFileSync(destino, nuevo);
        log(`${archivo} updated: ${que}.`);
    } catch (e) { /* sin ese archivo en este motor */ }
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

// El panel todavia esta abriendo las cuentas PROPIAS del host (busy): las prestadas esperan (Ale 2026-11-06).
function panelOcupado(motor) {
    try {
        return JSON.parse(fs.readFileSync(path.join(motor, 'reports', 'community_farm.json'), 'utf8')).busy === true;
    } catch (e) { return false; }
}

// Que cuentas prestadas abre este host segun el "Run Mode" del panel (Ale 2026-11-06):
//   Open Packs Only -> solo las BLOQUEADAS (e > 0), para que junten sus 96 sobres;
//   God Pack        -> solo las ELEGIBLES confirmadas (e === 0).
// Sin el dato (Monitor Link viejo) no se abren en ningun modo.
const soloSobres = (s) => String(s?.run_mode || 'godpack') === 'packs-only';
// Run Mode del panel de este host (motor puede ser null: entonces "godpack").
const modoPanel = (motor) => (motor && ajustesPanel(motor).run_mode) || 'godpack';
let modoAntes = null;
const cuentaDelModo = (c, s) => soloSobres(s) ? c.e > 0 : c.e === 0;

// Cuadro "ACCOUNTS LEFT · OPENED" del God Pack UI (Ale 2026-11-06): las prestadas de ESTE host que quedan
// para abrir en el modo del panel y las que abrio desde el ultimo Start. Va a reports/community_farm_status.json.
let inicioOn = Date.now();
async function escribirEstadoPanel() {
    const motor = deps?.fastTransfer.rutaMotor();
    if (!motor || !panelEncendido(motor)) return;
    const parte = await deps.parte(modoPanel(motor)).catch(() => null);
    if (!parte) return;
    const cooldown = num(process.env.REROLL_COOLDOWN_HORAS, 24) * 3600 * 1000;
    const s = ajustesPanel(motor), estado = leerEstado(motor), abiertas = leerAbiertas(motor), ahora = Date.now();
    let disponibles = 0, abiertasDesdeStart = 0;
    for (const m of await deps.ml.cuentasReroll()) {
        for (const c of m.cuentas) {
            const clave = `${m.discord_id}|${c.f}`;
            if ((abiertas[clave] || 0) >= inicioOn) abiertasDesdeStart++;
            if (miCuenta(m.discord_id, c.f, parte) && cuentaDelModo(c, s)
                && ahora - Math.max(msDeLean(c.l), estado[clave] || 0) >= cooldown) disponibles++;
        }
    }
    fs.writeFileSync(path.join(motor, 'reports', 'community_farm_status.json'),
        JSON.stringify({ available: disponibles, opened: abiertasDesdeStart, mode: s.run_mode || 'godpack', ts: ahora }));
}

// Cada 20 s: el estado Online/Offline del GP farm sigue al panel. Al encenderse arranca una tanda ya.
let panelAntes = null;
async function sincronizarPanel() {
    const motor = deps?.fastTransfer.rutaMotor();
    if (!motor) return;
    const on = panelEncendido(motor);
    const modo = modoPanel(motor);
    // Cambio de Run Mode con el farm prendido: se vuelve a anotar para repartir con los hosts de ese modo.
    if (on && on === panelAntes && modo !== modoAntes) {
        modoAntes = modo;
        await deps.marcar?.(true, modo).catch(() => {});
        log(`Run Mode changed to ${modo} - sharing accounts with the hosts in that mode`);
        return;
    }
    if (on === panelAntes) return;
    panelAntes = on;
    modoAntes = modo;
    await deps.marcar?.(on, modo).catch(() => {});
    log(on ? 'Community farm ON (God Pack UI Start)' : 'Community farm OFF (God Pack UI stopped or closed)');
    if (on) {
        inicioOn = Date.now();   // el cuadro del panel cuenta las abiertas desde este Start
        // Start de nuevo antes de 15 min: el PPM sigue desde donde iba (2026-11-01, idea de wr98).
        if (ppm?.pausa && Date.now() - ppm.pausa.at < PPM_PAUSA_MS) {
            ppm.pausado = (ppm.pausado || 0) + (Date.now() - ppm.pausa.at);
            delete ppm.pausa;
        } else ppm = null;
        if (!ppm) { ppm = { desde: Date.now(), sobres: 0 }; sumarPropios(motor); }
        setTimeout(ciclo, 15 * 1000);
    } else {
        // Stop: ultimo heartbeat en Offline y 0 PPM (solo si estaba farmeando, no al arrancar el bot).
        if (ppm) {
            await enviarPpm(motor, ajustesPanel(motor), true).catch(e => log('PPM report failed:', e?.message || e));
            // Se guarda 15 min por si vuelve a dar Start (cambiar algo del panel no reinicia el PPM).
            sumarPropios(motor);
            ppm.pausa = { at: Date.now() };
        }
    }
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
        const parte = await deps.parte(modoPanel(motor)).catch(() => null);
        if (!parte) {
            if (!ppm?.pausa || Date.now() - ppm.pausa.at >= PPM_PAUSA_MS) ppm = null;
            return;
        }
        // (2026-11-07, Ale) Only Pack (96P de cuentas bloqueadas) no es PPM real de God Packs: no se reporta.
        // Si venia de GP farm, se manda una vez Offline/0 PPM para que LatiasBot no siga mostrando el anterior.
        if (soloSobres(s)) {
            if (ppm && !ppm.pausa) await enviarPpm(motor, s, true).catch(() => {});
            ppm = null;
            return;
        }
        if (!ppm) { ppm = { desde: Date.now(), sobres: 0 }; sumarPropios(motor); }
        await enviarPpm(motor, s, false);
    } catch (e) {
        log('PPM report failed:', e?.message || e);
    } finally {
        setTimeout(revisarPpm, espera * 60 * 1000);
    }
}

// Mismo mensaje que el panel. final = true al darle Stop: todo Offline y 0 PPM, asi LatiasBot te muestra
// apagado al instante en vez de quedarse con el ultimo PPM (2026-11-01, pedido de Ale).
async function enviarPpm(motor, s, final) {
    const webhook = String(s.ppm_webhook || '').trim();
    if (!ppm || !/^https:\/\/(\w+\.)?discord(app)?\.com\/api\/webhooks\//.test(webhook)) return;
    // Con Community farm el panel no manda su PPM: aca va todo junto (tus cuentas + las prestadas).
    // Tus sobres: los que el panel anoto en su log desde el Start (sumarPropios, solo lineas nuevas).
    if (!ppm.pausa) sumarPropios(motor);
    const sobres = ppm.sobres + (ppm.propios || 0);
    const minutos = Math.max(1, (Date.now() - ppm.desde - (ppm.pausado || 0)) / 60000);
    const instancias = 'Main, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10';
    const mensaje = [s.host_name || 'Host', `Online: ${final ? 'none' : instancias}`, `Offline: ${final ? instancias : 'none'}`,
        `Time: ${Math.floor(minutos)}m | Packs: ${sobres} | Avg: ${final ? 0 : Math.round(sobres / minutos * 100) / 100} packs/min`,
        'Version: wrProxy', 'Type: Inject Wonderpick 96P+', `Opening: ${nombreDeSobre(motor, s.pack_id || 'CN001_0010_00_000')}`].join('\n');
    await fetch(webhook, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: mensaje }), signal: AbortSignal.timeout(10000) });
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
// Cuentas que ESTE host abrio de verdad (al menos 1 sobre): { "discordId|archivo": ms } (panel de hosts,
// pedido de Ale 2026-11-06: "cuantos se abrieron en cada host"). Se guardan las ultimas 24 h.
function rutaAbiertas(motor) { return path.join(motor, 'reports', 'reroll_abiertas.json'); }
function leerAbiertas(motor) { try { return JSON.parse(fs.readFileSync(rutaAbiertas(motor), 'utf8')); } catch (e) { return {}; } }
function anotarAbiertas(motor, claves) {
    if (!claves.length) return;
    const ahora = Date.now(), dia = 24 * 3600 * 1000;
    const abiertas = leerAbiertas(motor);
    for (const k of Object.keys(abiertas)) if (ahora - abiertas[k] > dia) delete abiertas[k];
    for (const k of claves) abiertas[k] = ahora;
    try { fs.writeFileSync(rutaAbiertas(motor), JSON.stringify(abiertas)); } catch (e) { /* nada */ }
}
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
// Sobres que el catalogo del motor (scripts/flow/pack_catalog.py, de Miguel) todavia no trae. Se agregan a
// PAID_HOURGLASS_PACKS de cada host al arrancar (asi salen en el God Pack UI y el farm sabe su product_id).
const SOBRES_EXTRA = [
    // 2026-11-07 (Ale, datos de wr98): sobre especial, energia propia (PACK_POWER_SPECIAL), 1 por cuenta.
    '{"name": "Special Pack: First Partners", "expansion_id": "sp1", "sku_id": "SP1_1", "pack_id": "SP001_0010_00_000", "product_id": "PC_PS_2610010_01_01_01", "hg_cost": 0, "power_id": "PACK_POWER_SPECIAL", "default_packs": 1},',
];
function agregarSobresExtra(motor) {
    try {
        const ruta = path.join(motor, 'scripts', 'flow', 'pack_catalog.py');
        let texto = fs.readFileSync(ruta, 'utf8');
        const faltan = SOBRES_EXTRA.filter(l => !texto.includes(`"${JSON.parse(l.replace(/,$/, '')).pack_id}"`));
        if (!faltan.length) return;
        const ini = texto.indexOf('PAID_HOURGLASS_PACKS = [');
        const fin = ini < 0 ? -1 : texto.indexOf('\n]', ini);
        if (fin < 0) { log('pack_catalog.py: PAID_HOURGLASS_PACKS not found - special pack not added'); return; }
        fs.copyFileSync(ruta, `${ruta}.bak-sobres`);
        texto = texto.slice(0, fin) + '\n    # Monitor Pokemon (sobres extra)\n' + faltan.map(l => `    ${l}`).join('\n') + texto.slice(fin);
        fs.writeFileSync(ruta, texto);
        log(`pack_catalog.py: added ${faltan.length} pack(s) (Special Pack: First Partners)`);
    } catch (e) { /* sin catalogo en este motor */ }
}

// Ajustes recomendados del God Pack UI (2026-11-07, Naja + Arcade: mismo motor, sin soft bans): tope de 35
// sobres/min por Main, 6 s de espera para que acepten, 2 s entre cuentas y 1 s entre sobres (el servidor abre
// los dos sobres igual y no da el segundo si el primero es God Pack). Se aplican UNA vez por host (despues cada
// uno puede cambiarlos); el panel los toma al abrirse. El tope de la comunidad (ppm_cap.json) sigue mandando.
const AJUSTES_RECOMENDADOS = { packs_per_min: 35, wait_accept: 6, account_delay: 2, pack_delay: 1 };
function aplicarAjustesRecomendados(motor) {
    // (2026-11-07, Arcade) 20 s de espera bajaba el PPM de 17 a 12 y con 6 s no se perdia ninguna solicitud:
    // a quien todavia tiene los 20 s que puso la v1, se le baja a 6 (si lo cambio a mano, no se toca).
    try {
        const marca2 = path.join(motor, 'reports', 'ajustes_recomendados_v2.done');
        const ruta = path.join(motor, 'tools', 'god_pack_gui', 'settings.json');
        if (!fs.existsSync(marca2) && fs.existsSync(path.join(motor, 'reports', 'ajustes_recomendados_v1.done'))) {
            const s = JSON.parse(fs.readFileSync(ruta, 'utf8'));
            if (Number(s.wait_accept) === 20) {
                s.wait_accept = 6;
                fs.writeFileSync(ruta, JSON.stringify(s, null, 2));
                log('God Pack UI accept wait back to 6 s (20 s was too slow) - reopen the God Pack UI to load it');
            }
            fs.writeFileSync(marca2, new Date().toISOString());
        }
    } catch (e) { /* sin panel en este motor */ }
    try {
        const marca = path.join(motor, 'reports', 'ajustes_recomendados_v1.done');
        if (fs.existsSync(marca)) return;
        const ruta = path.join(motor, 'tools', 'god_pack_gui', 'settings.json');
        const s = JSON.parse(fs.readFileSync(ruta, 'utf8'));
        fs.copyFileSync(ruta, `${ruta}.bak-ajustes`);
        Object.assign(s, AJUSTES_RECOMENDADOS);
        fs.writeFileSync(ruta, JSON.stringify(s, null, 2));
        fs.mkdirSync(path.dirname(marca), { recursive: true });
        fs.writeFileSync(marca, new Date().toISOString());
        log('God Pack UI settings set to the recommended ones (35 packs/min, 20 s accept wait, 2 s between accounts, 1 s between packs) - reopen the God Pack UI to load them');
    } catch (e) { /* sin panel en este motor */ }
}

function productoDeSobre(motor, packId) {
    try {
        const catalogo = fs.readFileSync(path.join(motor, 'scripts', 'flow', 'pack_catalog.py'), 'utf8');
        const id = String(packId).replace(/[^A-Za-z0-9_]/g, '');
        return new RegExp(`"pack_id":\\s*"${id}"[^}]*?"product_id":\\s*"([^"]+)"`).exec(catalogo)?.[1] || '';
    } catch (e) { return ''; }
}

// Sobres de TUS cuentas que abrio el panel desde el Start: cada sobre deja una linea "  cards: ..." en
// reports/god_pack_live.log. (2026-11-07, Ale: wR98 salio con 318 PPM / 6.376 sobres en 20 min.) Antes se contaba
// el log ENTERO, y un log que no se vacia en el Start (panel modificado a mano) sumaba sobres de dias anteriores.
// Ahora se cuenta solo lo nuevo: se recuerda hasta donde se leyo (ppm.logPos) y se suma a ppm.propios. La primera
// lectura solo marca la posicion; si el log se vacio (Start del panel), se vuelve a leer desde el principio.
function sumarPropios(motor) {
    if (!ppm || !motor) return;
    const ruta = path.join(motor, 'reports', 'god_pack_live.log');
    let tam;
    try { tam = fs.statSync(ruta).size; } catch (e) { return; }
    if (ppm.logPos == null) { ppm.logPos = tam; return; }
    if (tam < ppm.logPos) ppm.logPos = 0;
    if (tam === ppm.logPos) return;
    try {
        const desde = Math.max(ppm.logPos, tam - 64 * 1024 * 1024);
        const buf = Buffer.alloc(tam - desde);
        const fd = fs.openSync(ruta, 'r');
        fs.readSync(fd, buf, 0, buf.length, desde);
        fs.closeSync(fd);
        ppm.propios = (ppm.propios || 0) + (buf.toString('utf8').match(/\] {2,}cards: /g) || []).length;
        ppm.logPos = tam;
    } catch (e) { /* se reintenta en el proximo reporte */ }
}

// Para el recuadro del host en Discord: nombre del panel ("Ale Cast") y cuantas cuentas propias tiene.
function infoFarm() {
    const motor = deps?.fastTransfer.rutaMotor();
    if (!motor || !panelEncendido(motor)) return null;
    let propias = 0;
    try { propias = Number(JSON.parse(fs.readFileSync(path.join(motor, 'reports', 'community_farm.json'), 'utf8')).own) || 0; } catch (e) { /* sin dato */ }
    return { nombre: String(ajustesPanel(motor).host_name || '').trim() || null, propias, modo: modoPanel(motor) };
}

// Nombre del sobre para el mensaje de PPM, igual que el panel ("Dual Fusion: Pikachu").
function nombreDeSobre(motor, packId) {
    try {
        const catalogo = fs.readFileSync(path.join(motor, 'scripts', 'flow', 'pack_catalog.py'), 'utf8');
        const id = String(packId).replace(/[^A-Za-z0-9_]/g, '');
        return new RegExp(`"name":\\s*"([^"]+)"[^}]*?"pack_id":\\s*"${id}"`).exec(catalogo)?.[1] || packId;
    } catch (e) { return packId; }
}

// Un host con su inject.py modificado a mano (no se reemplaza, ej. wr98) puede no conocer una opcion nueva: si se
// la pasa, argparse cierra el motor al instante y el farm no abre nada (2026-11-06, wr98). Solo se pasan las que
// su inject.py tiene. Se lee el archivo una vez por cambio (fecha de modificacion).
let _injectLeido = { mtime: 0, texto: '' };
function motorConoce(motor, opcion) {
    try {
        const ruta = path.join(motor, 'scripts', 'god_pack', 'inject.py');
        const mtime = fs.statSync(ruta).mtimeMs;
        if (mtime !== _injectLeido.mtime) _injectLeido = { mtime, texto: fs.readFileSync(ruta, 'utf8') };
        return _injectLeido.texto.includes(`"${opcion}"`);
    } catch (e) { return false; }
}

// Amistades que quedaron (2026-11-07, Ale: "tienen lista de 99 otra vez"). Si el motor se corta entre mandar las
// solicitudes y borrarlas (Stop, reinicio o actualizacion del bot, un error), la cuenta queda amiga de TODOS los
// Mains. inject.py anota cada cuenta en reports/fr_pending/ y limpia solo las suyas al arrancar; las PRESTADAS no
// pueden (su XML no queda en el host), asi que aca se le vuelve a pedir la XML al Monitor Link del dueño, se corre
// el motor con --cleanup-only (sin abrir sobres) y la XML se borra otra vez.
async function limpiarPrestadasPendientes(motor) {
    const dir = path.join(motor, 'reports', 'fr_pending');
    let archivos;
    try { archivos = fs.readdirSync(dir); } catch (e) { return; }
    const vivo = run => { try { return Date.now() - fs.statSync(path.join(dir, `_alive_${run}`)).mtimeMs < 2 * 60 * 1000; } catch (e) { return false; } };
    const porDueno = {};
    for (const a of archivos) {
        if (!a.endsWith('.json')) continue;
        let e;
        try { e = JSON.parse(fs.readFileSync(path.join(dir, a), 'utf8')); } catch (err) { continue; }
        if (!e.owner || !e.xml_file || vivo(e.run)) continue;
        (porDueno[e.owner] = porDueno[e.owner] || new Set()).add(e.xml_file);
    }
    const s = ajustesPanel(motor);
    for (const [dueno, set] of Object.entries(porDueno)) {
        if (!panelEncendido(motor)) return;
        const pedidos = [...set];
        let xmls;
        try {
            try { xmls = await deps.ml.pedirXmlReroll(dueno, pedidos); }
            catch (e) { xmls = await deps.ml.xmlRerollPorHostActivo(dueno, pedidos); }
        } catch (e) {
            log(`${dueno}: ${pedidos.length} lent account(s) still friends with the Mains - Monitor Link offline, retrying later`);
            continue;
        }
        const nombres = Object.keys(xmls || {});
        if (!nombres.length) continue;
        if (!await deps.fastTransfer.asegurarTunel()) return;
        const tmp = path.join(os.tmpdir(), `ml_reroll_${crypto.randomBytes(6).toString('hex')}`);
        fs.mkdirSync(tmp, { recursive: true });
        try {
            for (const nombre of nombres) {
                const base = path.basename(nombre).replace(/\.xml$/i, '');
                fs.writeFileSync(path.join(tmp, `${base}.xml`), xmls[nombre]);
            }
            log(`removing leftover Main friendships of ${nombres.length} lent account(s) of ${dueno}`);
            await correrInject(motor, tmp, s, nombres.length, dueno, true);
        } finally {
            fs.rmSync(tmp, { recursive: true, force: true });   // las XML no quedan en el host
        }
    }
}

// Carpetas temporales de tandas cortadas a la fuerza (reinicio del bot): sus XML no deben quedar en el host.
function borrarTemporalesViejas() {
    try {
        for (const d of fs.readdirSync(os.tmpdir())) {
            if (!/^ml_reroll_[0-9a-f]{12}$/.test(d)) continue;
            const ruta = path.join(os.tmpdir(), d);
            if (Date.now() - fs.statSync(ruta).mtimeMs > 2 * 3600 * 1000) fs.rmSync(ruta, { recursive: true, force: true });
        }
    } catch (e) { /* nada */ }
}

function correrInject(motor, dirCuentas, s, cantidad, duenoId, soloLimpiar = false) {
    return new Promise(resolve => {
        const python = deps.fastTransfer.pythonMotor();
        const args = [path.join(motor, 'scripts', 'god_pack', 'inject.py'),
            '--collector-codes', (s.collectors || []).join(',') || 'dummy',
            '--worker-url', s.worker_url || 'https://onlineids.zenithrise.workers.dev/elite',
            // Sobre especial (SP1): 1 por cuenta, usa su propia energia (2026-11-07).
            '--packs', String(/^SP/i.test(s.pack_id || '') ? 1 : (s.packs || 2)),
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
            '--verify-power', ...(motorConoce(motor, '--full-power-only') ? ['--full-power-only'] : []), '--shuffle-proxies',
            '--stop-after-fails', String(s.stop_after_fails || 5),
            // Stop del panel GP: corta la tanda despues de la cuenta en curso (con su limpieza)
            '--stop-file', path.join(motor, 'reports', 'community_farm.stop')];
        if (soloLimpiar) args.push('--cleanup-only');   // solo borra amistades que quedaron (no abre sobres)
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
        // God Packs de la tanda (2026-11-06, Arcade: "another one found, no ping to discord"): se leen de la
        // salida del motor y el bot avisa el mismo, aunque el webhook del panel este vacio o falle.
        const gps = [];
        let resto = '';
        const leer = (d) => {
            escribir(d);
            const lineas = (resto + d.toString('utf8')).split(/\r?\n/);
            resto = lineas.pop();
            for (const l of lineas) {
                const m = /\[([^\]]+)\] pack opened .*<-- GOD PACK (\S+) \(WONDER-PICKABLE\)/.exec(l);
                if (m) gps.push({ cuenta: m[1], nivel: m[2], cartas: '' });
                const c = /\[([^\]]+)\]\s+cards: (.+)$/.exec(l);
                const ultimo = gps[gps.length - 1];
                if (c && ultimo && ultimo.cuenta === c[1] && !ultimo.cartas) ultimo.cartas = c[2];
            }
        };
        hijo.stdout.on('data', leer);
        hijo.stderr.on('data', escribir);
        hijo.on('error', e => { escribir(`[spawn error] ${e?.message || e}\n`); cerrar(); resolve(gps); });
        hijo.on('close', code => { escribir(`[exit ${code}]\n`); cerrar(); resolve(gps); });
    });
}

// Cartas que quedaron sin entregar: el host del turno se las manda a cada Monitor Link; otro host se las
// pasa al del turno.
async function entregarPendientes(idMiembro) {
    // Directo al Monitor Link de cada miembro (1.9.14+ escucha a todos los hosts). Lo que no se pudo
    // entregar (Monitor Link viejo o apagado) y este host no tiene el turno, se pasa al host del turno.
    const ids = idMiembro ? [idMiembro] : await deps.ml.miembrosConSobresPendientes();
    for (const id of ids) await deps.ml.entregarSobresReroll(id).catch(() => {});
    if (!deps.activo()) await deps.ml.pasarSobresAlHostActivo().catch(() => {});
}

// Entregas pendientes en segundo plano (2026-11-06, Ale: "no abre nada, se quedo asi"): con cientos
// pendientes (una por una, hasta 30 s cada una) el ciclo no llegaba a abrir sobres. Ahora corren aparte.
let entregando = false;
function entregarEnFondo() {
    if (entregando) return;
    entregando = true;
    entregarPendientes().catch(() => {}).finally(() => { entregando = false; });
}

// Despues de cada tanda: las cuentas que el motor anoto como probablemente baneadas (reports/banned_accounts.jsonl,
// inject.py) pasan a la lista compartida de los hosts y se avisa en 🔒-hosts mencionando al dueño.
async function revisarBaneadas(motor, desde, duenoId, nombres) {
    let lineas = [];
    try { lineas = fs.readFileSync(path.join(motor, 'reports', 'banned_accounts.jsonl'), 'utf8').split('\n'); } catch (e) { return; }
    const enTanda = new Map(nombres.map(n => [path.basename(n).toLowerCase(), n]));
    const vistas = new Set();
    for (const linea of lineas) {
        let ev;
        try { ev = JSON.parse(linea); } catch (e) { continue; }
        if (Number(ev.ts) < desde) continue;
        const nombre = enTanda.get(String(ev.xml || '').toLowerCase());
        if (!nombre || vistas.has(nombre)) continue;
        vistas.add(nombre);
        await deps.marcarBaneada?.(duenoId, nombre).catch(() => {});
        log(`likely banned: ${nombre} (lent by ${duenoId})`);
        await deps.avisar?.(`⛔ **Likely banned** — <@${duenoId}>'s account \`${nombre}\`: the game refused it on ${ev.proxies || 2}+ different proxies. `
            + `The GP farm won't open it again, and it shows as **Banned?** in their Monitor Link.`).catch(() => {});
    }
}

// Webhook de God Packs de la comunidad (Upstash zenith:gp_webhook, lo carga el staff en 🔒-hosts) -> archivo del
// motor reports/community_gp_webhook.txt: discord_notifier.py lo usa si el panel no tiene webhook propio.
async function copiarWebhookGp() {
    const motor = deps?.fastTransfer.rutaMotor();
    if (!motor || !deps.webhookGp) return;
    const url = String(await deps.webhookGp() || '').trim();
    const ruta = path.join(motor, 'reports', 'community_gp_webhook.txt');
    let actual = '';
    try { actual = fs.readFileSync(ruta, 'utf8').trim(); } catch (e) { /* no existe */ }
    if (url === actual) return;
    fs.mkdirSync(path.dirname(ruta), { recursive: true });
    if (url) fs.writeFileSync(ruta, url); else { try { fs.unlinkSync(ruta); } catch (e) { /* nada */ } }
    log(url ? 'community God Pack webhook updated' : 'community God Pack webhook removed');
}

// Vigilante de God Packs (2026-11-06, Ale: "un GP sin aviso es inaceptable"). Lee los logs del motor (cuentas
// propias: god_pack_live.log; GP farm: reroll_comunidad.log). Si se guardo un God Pack (ACCOUNT SUMMARY ... MATCH)
// y en 2 min no aparece "[discord] God Pack posted" de esa cuenta (motor viejo o modificado, webhook caido...),
// avisa en 🔒-hosts con los datos para publicarlo a mano. Asi ningun God Pack se pierde sin que nadie se entere.
const vigilados = {};      // archivo -> posicion leida
const gpPendientes = {};   // cuenta -> { nivel, cartas, guardado, archivo }
function vigilarGodPacks() {
    const motor = deps?.fastTransfer.rutaMotor();
    if (!motor) return;
    for (const nombre of ['god_pack_live.log', 'reroll_comunidad.log']) {
        const ruta = path.join(motor, 'reports', nombre);
        let tam;
        try { tam = fs.statSync(ruta).size; } catch (e) { continue; }
        if (vigilados[ruta] === undefined) { vigilados[ruta] = tam; continue; }   // al arrancar: solo lo nuevo
        if (tam < vigilados[ruta]) vigilados[ruta] = 0;                          // el panel vacia el log al Start
        if (tam === vigilados[ruta]) continue;
        let texto = '';
        try {
            const fd = fs.openSync(ruta, 'r');
            const buf = Buffer.alloc(Math.min(tam - vigilados[ruta], 8 * 1024 * 1024));
            fs.readSync(fd, buf, 0, buf.length, tam - buf.length);
            fs.closeSync(fd);
            texto = buf.toString('utf8');
        } catch (e) { continue; }
        vigilados[ruta] = tam;
        for (const l of texto.split(/\r?\n/)) {
            let m = /\[([^\]]+)\] pack opened .*<-- GOD PACK (\S+) \(WONDER-PICKABLE\)/.exec(l);
            if (m) { gpPendientes[m[1]] = { ...(gpPendientes[m[1]] || {}), nivel: m[2], archivo: nombre }; continue; }
            m = /\[([^\]]+)\]\s+cards: (.+)$/.exec(l);
            if (m && gpPendientes[m[1]] && !gpPendientes[m[1]].cartas) { gpPendientes[m[1]].cartas = m[2]; continue; }
            m = /\[([^\]]+)\] -- ACCOUNT SUMMARY: .*MATCH: (.+)$/.exec(l);
            if (m && gpPendientes[m[1]]) { gpPendientes[m[1]].guardado = Date.now(); gpPendientes[m[1]].match = m[2]; continue; }
            // (2026-11-07, Arcade: aviso falso) ".*" dejaba que el 1er corchete fuera la HORA, no la cuenta: nunca se borraba.
            m = /\[([^\]]+)\]\s+\[discord\] God Pack posted/.exec(l);
            if (m) delete gpPendientes[m[1]];
        }
    }
    for (const [cuenta, gp] of Object.entries(gpPendientes)) {
        if (!gp.guardado) {   // detectado pero no guardado (debajo del minimo): se olvida a los 10 min
            if (!gp.visto) gp.visto = Date.now();
            else if (Date.now() - gp.visto > 10 * 60 * 1000) delete gpPendientes[cuenta];
            continue;
        }
        if (Date.now() - gp.guardado < 5 * 60 * 1000) continue;   // la foto + el post pueden tardar
        delete gpPendientes[cuenta];
        const host = String(ajustesPanel(motor).host_name || '').trim() || 'this host';
        log(`GOD PACK NOT POSTED to KyuremBot: ${cuenta} (${gp.nivel})`);
        deps.avisar?.(`🚨 **God Pack NOT posted to KyuremBot** — host **${host}**\n`
            + `> Account: \`${cuenta}\` · Rarity: \`${gp.nivel}\` · ${gp.match || ''}\n`
            + (gp.cartas ? `> Cards: ${gp.cartas.slice(0, 700)}\n` : '')
            + `*The engine kept it but no alert reached Discord. Post it by hand and check this host's God Pack UI (Stop + Start loads the latest notifier).*`).catch(() => {});
    }
}

// Version de este host para el God Pack UI (2026-11-06, Ale: "que se vea en todos lados si esta al dia"):
// reports/monitor_version.json { version, latest, upToDate, ts }. El panel compara con la que tenia al abrirse.
function versionDeEsteHost() {
    try { return fs.readFileSync(path.join(__dirname, 'host-version.txt'), 'utf8').trim(); } catch (e) { /* host de Ale */ }
    try { return require('child_process').execSync('git rev-parse --short HEAD', { cwd: __dirname, windowsHide: true }).toString().trim(); } catch (e) { return 'dev'; }
}
async function escribirVersion() {
    const motor = deps?.fastTransfer.rutaMotor();
    if (!motor) return;
    const version = versionDeEsteHost();
    const release = await (deps.ultimaRelease?.() || Promise.resolve(null)).catch(() => null);
    const alDia = deps.estaAlDia?.(version, release);
    fs.mkdirSync(path.join(motor, 'reports'), { recursive: true });
    fs.writeFileSync(path.join(motor, 'reports', 'monitor_version.json'),
        JSON.stringify({ version, latest: release?.version || null, upToDate: alDia, ts: Date.now() }));
}

let esperarPropias = false;   // las propias del host siguen abriendose: se reintenta en 1 min
async function ciclo() {
    if (corriendo || !deps) return;
    const motor = deps.fastTransfer.rutaMotor();
    const parte = await deps.parte(modoPanel(motor)).catch(() => null);
    if (!motor) return;
    corriendo = true;
    let trabajo = false;
    let pendiente = null;   // tanda siguiente ya preparada (sus XML en una carpeta temporal)   // si abrio alguna tanda: la siguiente arranca enseguida
    try {
        entregarEnFondo();
        if (!parte || !panelEncendido(motor)) return;   // Offline: el panel GP no esta en Start
        if (panelOcupado(motor)) {   // primero las cuentas propias del host; las prestadas despues
            log('own accounts still opening - the lent ones start when they finish');
            esperarPropias = true;
            return;
        }
        await deps.ml.escribirProxiesMotor().catch(() => {});
        await limpiarPrestadasPendientes(motor).catch(e => log('lent cleanup failed:', e?.message || e));

        const cooldown = num(process.env.REROLL_COOLDOWN_HORAS, 24) * 3600 * 1000;
        // (2026-11-06, pedido de Ale: mas PPM) 50 cuentas por miembro y tanda (antes 20).
        const lote = num(process.env.REROLL_LOTE, 50);
        const s = ajustesPanel(motor);
        const estado = leerEstado(motor);
        const miembros = await deps.ml.cuentasReroll();
        // Probablemente baneadas (lista compartida de los hosts): no se vuelven a abrir.
        const baneadasSet = await (deps.baneadas?.() || Promise.resolve(new Set())).catch(() => new Set());
        // Resumen de cada vuelta (2026-11-01: el ciclo fallaba en silencio y parecia que no hacia nada).
        log(`cycle: host ${parte.i + 1}/${parte.n}, ${miembros.length} member(s) lending, ${miembros.reduce((a, m) => a + m.cuentas.length, 0)} account(s)`);
        // (2026-11-07, Arcade: "every time a batch of lent accounts completes, the bot pauses") Las XML de un miembro
        // se piden a su Monitor Link al momento (nunca quedan guardadas en el host), y eso tardaba de 1 s a varios
        // minutos con la tanda anterior ya terminada. Ahora, mientras una tanda abre sobres, ya se piden las XML del
        // siguiente miembro: al terminar, la siguiente arranca enseguida. Cada carpeta temporal se borra igual.
        let idx = 0;
        const preparar = async (m) => {
            const ahora = Date.now();
            // Ale 2026-11-06: solo se abren cuentas CONFIRMADAS elegibles a God Pack (e === 0, Monitor Link 1.9.6+);
            // sin el dato (Monitor Link viejo) o con dias faltantes (e > 0) quedan bloqueadas.
            const listas = m.cuentas.filter(c => miCuenta(m.discord_id, c.f, parte) && cuentaDelModo(c, s)
                && !baneadasSet.has(`${m.discord_id}|${c.f}`)
                && ahora - Math.max(msDeLean(c.l), estado[`${m.discord_id}|${c.f}`] || 0) >= cooldown).slice(0, lote);
            if (!listas.length) { log(`${m.discord_id}: no account ready (cooldown ${cooldown / 3600000} h)`); return null; }
            let xmls;
            try {
                // (2026-11-06, Ale) Siempre directo al Monitor Link del miembro (1.9.14+ escucha a todos los
                // hosts): el farm ya no depende del host del turno. Si ese Monitor Link es viejo y este host no
                // tiene el turno, se prueba como antes, por el host del turno.
                try {
                    xmls = await deps.ml.pedirXmlReroll(m.discord_id, listas.map(c => c.f));
                } catch (e) {
                    if (deps.activo()) throw e;
                    xmls = await deps.ml.xmlRerollPorHostActivo(m.discord_id, listas.map(c => c.f));
                }
            } catch (e) {   // PC del miembro apagada, o Monitor Link viejo y el host del turno no contesta
                log(`${m.discord_id}: could not get the ${listas.length} account file(s) from their Monitor Link: ${e?.message || e}`);
                return null;
            }
            const nombres = Object.keys(xmls || {});
            if (!nombres.length) { log(`${m.discord_id}: asked for ${listas.length} account file(s), got none back`); return null; }
            const dir = path.join(os.tmpdir(), `ml_reroll_${crypto.randomBytes(6).toString('hex')}`);
            fs.mkdirSync(dir, { recursive: true });
            // XML con su nombre original + un JSON vacio al lado: inject.py anota ahi lo que sale.
            for (const nombre of nombres) {
                const base = path.basename(nombre).replace(/\.xml$/i, '');
                fs.writeFileSync(path.join(dir, `${base}.xml`), xmls[nombre]);
                fs.writeFileSync(path.join(dir, `${base}.json`), JSON.stringify({ metadata: {}, pulls: [], registeredCards: [] }));
            }
            return { m, nombres, dir };
        };
        const prepararSiguiente = async () => {
            while (idx < miembros.length && panelEncendido(motor)) {
                const t = await preparar(miembros[idx++]).catch(e => { log('could not prepare a batch:', e?.message || e); return null; });
                if (t) return t;
            }
            return null;
        };
        pendiente = prepararSiguiente();
        while (true) {
            const t = await pendiente;
            pendiente = null;
            if (!t) break;
            const { m, nombres, dir } = t;
            try {
                if (!panelEncendido(motor)) { log('stopped from the God Pack UI'); break; }
                if (!await deps.fastTransfer.asegurarTunel()) { log('tunnel 9090 is down - skipping this cycle'); break; }
                pendiente = prepararSiguiente();   // las XML del siguiente miembro, mientras esta tanda abre
                // (2026-11-06, wr98) Un AUTO-STOP del motor (5 fallos seguidos) escribe community_farm.stop y ese
                // archivo quedaba: cada tanda nueva se cerraba al instante ("stop file detected", 0 cuentas). Si el
                // panel sigue en Start, ese stop es viejo -> se borra. Un Stop de verdad apaga el panel (on:false).
                const stopViejo = path.join(motor, 'reports', 'community_farm.stop');
                if (panelEncendido(motor) && fs.existsSync(stopViejo)) {
                    try { fs.unlinkSync(stopViejo); log('old AUTO-STOP marker removed - the God Pack UI is still on Start'); } catch (e) { /* nada */ }
                }
                log(`opening ${nombres.length} account(s) lent by ${m.discord_id}`);
                trabajo = true;
                const inicioTanda = Date.now();
                const gps = await correrInject(motor, dir, s, nombres.length, m.discord_id);
                // El aviso en Discord lo hace el webhook de God Pack del panel (publicacion de foro con collage,
                // discord_notifier.py); aca solo queda en el log del bot.
                for (const gp of gps || []) log(`GOD PACK ${gp.nivel} on ${gp.cuenta} (lent by ${m.discord_id})`);
                await revisarBaneadas(motor, inicioTanda, m.discord_id, nombres).catch(e => log('banned check failed:', e?.message || e));
                let sobres = 0;
                const abiertasTanda = [];
                for (const nombre of nombres) {
                    const base = path.basename(nombre).replace(/\.xml$/i, '');
                    estado[`${m.discord_id}|${nombre}`] = Date.now();
                    let pulls = [];
                    try { pulls = JSON.parse(fs.readFileSync(path.join(dir, `${base}.json`), 'utf8')).pulls || []; } catch (e) { /* nada */ }
                    if (!pulls.length) continue;
                    abiertasTanda.push(`${m.discord_id}|${nombre}`);
                    // Lean anota el codigo del set ("C1"); toda la corrida abre el mismo sobre.
                    const set = await codigoSet(s.pack_id || 'CN001_0010_00_000');
                    for (const p of pulls) { p.pack = set; p.aviso = avisoS4t(motor, p.cards); }
                    await deps.ml.anotarSobresReroll(m.discord_id, nombre, pulls, leanDeMs(Date.now()));
                    sobres += pulls.length;
                }
                guardarEstado(motor, estado);
                anotarAbiertas(motor, abiertasTanda);
                escribirEstadoPanel().catch(() => {});
                if (ppm) ppm.sobres += sobres;
                log(`${sobres} pack(s) opened for ${m.discord_id}`);
            } finally {
                fs.rmSync(dir, { recursive: true, force: true });   // las XML no quedan en el host
            }
            entregarEnFondo();   // en segundo plano: no frena la siguiente tanda
        }
    } catch (e) {
        log('cycle failed:', e?.message || e);
    } finally {
        // Una tanda que quedo preparada y no se abrio (Stop, tunel caido, error): su carpeta con XML se borra.
        if (pendiente) pendiente.then(t => { if (t) fs.rmSync(t.dir, { recursive: true, force: true }); }).catch(() => {});
        corriendo = false;
        // Tandas seguidas (2026-11-06, pedido de Ale): antes cada tanda terminaba en 2-3 min y el host
        // quedaba parado hasta los 10 min, y ese tiempo muerto bajaba el PPM. Si hubo trabajo, la
        // siguiente arranca a los 30 s; si no quedan cuentas listas, se vuelve al intervalo de siempre.
        if ((trabajo || esperarPropias) && deps?.fastTransfer.rutaMotor() && panelEncendido(deps.fastTransfer.rutaMotor())) setTimeout(ciclo, (esperarPropias ? 60 : 30) * 1000);
        esperarPropias = false;
    }
}

// Resumen de cuentas prestadas para el panel de hosts (2026-11-01, pedido de Ale): por miembro,
// { [discordId]: [prestadas en total, las que le tocan a ESTE host, de esas las listas para abrir] }.
// "Listas" = pasaron el cooldown (lastPackPulled de Lean y la ultima apertura de este host).
// null si este host esta Offline para GP farm o no tiene motor.
async function resumenPrestadas() {
    if (!deps) return null;
    const motor = deps.fastTransfer.rutaMotor();
    const parte = await deps.parte(modoPanel(motor)).catch(() => null);
    if (!motor || !parte) return null;
    const cooldown = num(process.env.REROLL_COOLDOWN_HORAS, 24) * 3600 * 1000;
    const estado = leerEstado(motor);
    const abiertas = leerAbiertas(motor);
    const s = ajustesPanel(motor);
    const ahora = Date.now();
    const resumen = {};
    for (const m of await deps.ml.cuentasReroll()) {
        const mias = m.cuentas.filter(c => miCuenta(m.discord_id, c.f, parte));
        const listas = mias.filter(c => cuentaDelModo(c, s) && ahora - Math.max(msDeLean(c.l), estado[`${m.discord_id}|${c.f}`] || 0) >= cooldown).length;
        // 4to: de las de este host, cuantas todavia no son elegibles a God Pack (solo aviso, el farm las abre igual).
        const noElegibles = mias.filter(c => c.e > 0).length;
        // 5to: cuantas abrio ESTE host (al menos 1 sobre) en las ultimas 24 h.
        const abiertasHost = m.cuentas.filter(c => ahora - (abiertas[`${m.discord_id}|${c.f}`] || 0) < 24 * 3600 * 1000).length;
        // 6to: de las de este host, cuantas son elegibles (GP farm). El panel muestra 4to o 6to segun el modo.
        const elegibles = mias.filter(c => c.e === 0).length;
        resumen[m.discord_id] = [m.cuentas.length, mias.length, listas, noElegibles, abiertasHost, elegibles];
    }
    return resumen;
}

module.exports = { iniciar, ciclo, resumenPrestadas, infoFarm };
