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
let only = null;              // aviso de Open Packs Only en 🔒-hosts: { id, desde, sobres, propios?, logPos?, miembros }
const PPM_PAUSA_MS = 15 * 60 * 1000;   // tras un Stop, el PPM se guarda 15 min por si vuelve a dar Start

const log = (...a) => console.log('[reroll]', ...a);

// d: { ml (monitor-link-server), fastTransfer, activo() (tiene el turno), parte() ({ i, n } o null),
//      marcar(online) (GP farm Online/Offline en Upstash) }
function iniciar(d) {
    deps = d;
    if (!deps.fastTransfer.rutaMotor()) return;
    instalarPanel(deps.fastTransfer.rutaMotor());
    agregarSobresExtra(deps.fastTransfer.rutaMotor());
    // (2026-11-23) Aparte: dentro de agregarSobresExtra no corria cuando no faltaba ningun sobre (salia antes).
    corregirProductos(deps.fastTransfer.rutaMotor());
    ordenarCatalogo(deps.fastTransfer.rutaMotor());
    aplicarAjustesRecomendados(deps.fastTransfer.rutaMotor());
    borrarTemporalesViejas();
    setInterval(borrarTemporalesViejas, 60 * 60 * 1000);
    setTimeout(() => anotarGpMuertos(deps.fastTransfer.rutaMotor()).catch(e => log('dead God Pack cleanup:', e?.message || e)), 90 * 1000);
    // Cada 5 min (cuota de Upstash: 3 hosts cada 1 min eran ~130k pedidos al mes solo para esto).
    setInterval(() => sincronizarGodPacks().catch(e => log('God Pack list sync failed:', e?.message || e)), 5 * 60 * 1000);
    instalarArchivoMotor(deps.fastTransfer.rutaMotor(), 'inject.py', ['scripts', 'god_pack', 'inject.py'],
        INJECT_ORIGINAL, '_limit_collectors', 'own accounts follow the Run Mode, ~36 packs/min in total, packs saved as their set (C1)',
        // (2026-11-06, Ale) Un Main quedo con soft ban de amigos: un host con su inject.py propio mandaba a 13 Mains
        // por cuenta sin limite. Sin estos limites se instala el nuestro igual (el suyo queda como .bak-propio).
        // (2026-11-07) Ahora el obligatorio es el tope de PPM de la comunidad (lee reports/ppm_cap.json).
        // (2026-11-09) God Packs de Open Packs Only tambien se anotan (con ❌) en la lista del panel.
        // (2026-11-10, Arcade) Una pagina web del proxy ya no cuenta como ban, y si bloquea las solicitudes se
        // reintenta con otro proxy.
        // (2026-11-12, Arcade) Un Main que siempre da 403 ya no hace retirar las demas solicitudes: la cuenta sigue.
        // (2026-11-12) --pack-rotation: varios sobres en Open Packs Only (el panel nuevo lo usa).
        // (2026-11-12) Relojes de arena (gastar todos, lista) y recompensas: solo cuentas propias, desde el panel.
        // (2026-11-16) Bloqueados desde "Who's rerolling" (reports/blocked_ids.json): sin solicitudes.
        // (2026-11-16) /fill96: --scan-only y --pack-targets.
        // (2026-11-17, Zeka) Recompensas 1/15/30 de "30 Days of Gifts" aunque los dias ya estuvieran reclamados.
        // (2026-11-17) Relojes: 15 s entre sobres pagados (mas rapido el juego rechaza el 3.o).
        // (2026-11-17, wR98) Sobres de regalo con cartas de GP ya no dicen "GOD PACK" (no van a Wonder Pick).
        // (2026-11-19, Arcade) God Pack en Open Packs Only: manda solicitudes a los Mains al terminar y las deja.
        // (2026-11-20) Solo cuentas YA elegibles mandan solicitudes por un God Pack de Open Packs Only (V2), y
        // barrido que borra todos los amigos de las cuentas de God Packs muertos (DEAD_GP_CLEANUP_V1).
        // (2026-11-20, Ale) Open Packs Only NUNCA manda solicitudes (se quito GP_LATE_FR del todo).
        // (2026-11-20, Ale) Excepcion: cuentas a 6 sobres o menos de 96 en Open Packs Only / Open 2 van en modo God Pack.
        // (2026-11-22, Ale) RESET_PAUSE_V1: las solicitudes del GP farm esperan durante la pausa del reset diario.
        // (2026-11-22, Ale) UNPICKABLE_LIST_V1: los God Packs con Crown/Shiny/Immersive se anotan (muertos en all god packs).
        // (2026-11-23, Ale) STOP_BETWEEN_PACKS_V1: Stop de /farm para entre sobres, no al terminar la cuenta.
        // (2026-11-23, Ale) SPEND_ALL_STOP96_V1: "Gastar todos los relojes" del panel para en 96P en las cuentas propias.
        // (2026-11-23, Ale) OPEN_X10_V1: Llegar a 96P y Farm 96P abren de a 10 con relojes (una compra x10).
        // (2026-11-24, Arcade) DAILY_LOGIN_V1: cada cuenta hace el login diario del juego (regalos de 30 dias, eventos).
        // (2026-11-24, Ale/Arcade) SOLO_BATTLES_V1: boton "Batallas solo" (con solo_battles_one.py, abajo).
        // (2026-11-25, Arcade) CLAIM_COUNTER_V1: Solo cobrar / Batallas mueven los contadores del panel.
        'CLAIM_COUNTER_V1');
    // (2026-11-24) Batallas solo de una cuenta (lo lanza inject.py --solo-battles).
    instalarArchivoMotor(deps.fastTransfer.rutaMotor(), 'solo_battles_one.py', ['scripts', 'god_pack', 'solo_battles_one.py'],
        '', 'SOLO_BATTLES_V1', 'Solo battles button in the God Pack UI');
    // (2026-11-06) Aviso de God Pack que no se perdia al terminar cada tanda del GP farm.
    instalarArchivoMotor(deps.fastTransfer.rutaMotor(), 'discord_notifier.py', ['scripts', 'god_pack', 'discord_notifier.py'],
        '75d4eee05e3bb22f6cfe09ff1c8e935de312fc66b246b9f9d1b8214c4c85b908', 'daemon=False: en el GP farm', 'God Pack alerts always sent, and each God Pack is listed when you click GOD PACK HITS in the God Pack UI',
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
    setInterval(() => { if (only) actualizarAvisoOnly(false).catch(e => log('Only Pack notice failed:', e?.message || e)); }, AVISO_ONLY_MS);
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
// Pausa del reset diario (Ale 2026-11-22, como el farm de Melody): el juego reinicia a las 06:00 UTC (1:00 AM de Ale,
// que lo ve a la 1:05; Melody pausa 12:30-1:15 AM). De 05:30 a 06:15 UTC el GP farm no manda solicitudes, asi los
// miembros se desconectan y revisan su Wonder Pick. Devuelve el ms en que termina la pausa, o 0 fuera de ella.
// Igual en todos los hosts (va por la hora). (La primera version usaba 21:00 UTC por error.)
function pausaReset(ms = Date.now()) {
    const d = new Date(ms), min = d.getUTCHours() * 60 + d.getUTCMinutes();
    if (min < 5 * 60 + 30 || min >= 6 * 60 + 15) return 0;
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 6, 15);
}

async function escribirTopePpm() {
    const motor = deps?.fastTransfer.rutaMotor();
    if (!motor) return;
    const total = num(process.env.PPM_COMUNIDAD, 45);   // 2026-11-21 (Ale): 40 -> 45 (14 a la vez ya llega al tope; Vortex corrio 48 h a 54 sin 007; techo 60 = 30 solicitudes/min por Main)   // 2026-11-07: 36 -> 20 (soft bans) -> 40 (Ale/Arcade, ya sin rafagas ni amistades sin borrar); 2026-11-12: 45 (Naja fue a 50 sin soft-ban) -> 40 otra vez (Arcade con ban de IP)
    const hosts = await deps.hostsFarm?.('godpack').catch(() => null);
    if (!Array.isArray(hosts)) return;
    const parte = await deps.parte('godpack').catch(() => null);
    // Este host farmeando sin "Community farm" no figura en la lista: cuenta igual como uno mas.
    const n = Math.max(1, hosts.length + (parte ? 0 : 1));
    fs.mkdirSync(path.join(motor, 'reports'), { recursive: true });
    fs.writeFileSync(path.join(motor, 'reports', 'ppm_cap.json'),
        JSON.stringify({ cap: Math.floor(total / n), total, hosts: n, ts: Date.now(), pause_until: pausaReset() }));
    await escribirBloqueados(motor).catch(() => {});
}

// Bloqueados (Ale 2026-11-16, "Who's rerolling" del panel de hosts): IDs del juego a los que ninguna cuenta
// del GP farm manda solicitud. Upstash se lee cada 2 min (cuota); inject.py lee reports/blocked_ids.json.
let _bloqueadosTs = 0;
async function escribirBloqueados(motor) {
    if (!deps.bloqueados || Date.now() - _bloqueadosTs < 2 * 60 * 1000) return;
    _bloqueadosTs = Date.now();
    const ids = [...(await deps.bloqueados()).keys()].filter(id => /^\d{16}$/.test(id));
    fs.writeFileSync(path.join(motor, 'reports', 'blocked_ids.json'), JSON.stringify({ ids, ts: Date.now() }));
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
        // (2026-11-24) Archivo nuevo (no existe en este motor, ej. solo_battles_one.py): se copia directo.
        if (!fs.existsSync(destino) && fs.existsSync(path.dirname(destino))) {
            fs.writeFileSync(destino, nuevo);
            log(`${archivo} installed: ${que}.`);
            return;
        }
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

// God Packs de todos los hosts en el God Pack UI (Ale 2026-11-09). discord_notifier.py anota cada God Pack
// de este motor en reports/gp_hits.jsonl; aca se suben los nuevos a Upstash (con el nombre del host) y se
// baja la lista de la comunidad a reports/gp_hits_all.json, que el panel muestra al dar clic en GOD PACK HITS.
async function sincronizarGodPacks() {
    const motor = deps?.fastTransfer.rutaMotor();
    if (!motor || !deps.subirGodPacks) return;
    const reportes = path.join(motor, 'reports');
    const marca = path.join(reportes, 'gp_hits_synced.txt');   // ts del ultimo God Pack ya subido
    let ultimo = 0;
    try { ultimo = Number(fs.readFileSync(marca, 'utf8')) || 0; } catch (e) { /* primera vez */ }
    let nuevos = [];
    try {
        nuevos = fs.readFileSync(path.join(reportes, 'gp_hits.jsonl'), 'utf8').split('\n')
            .map(l => { try { return JSON.parse(l); } catch (e) { return null; } })
            .filter(h => h && Number(h.ts) > ultimo);
    } catch (e) { /* todavia no salio ninguno */ }
    if (nuevos.length) {
        // Sin la ruta de la foto: es de esta PC. Los demas arman el collage con las cartas.
        const subidos = await deps.subirGodPacks(nuevos.map(({ image, ...h }) => h));
        if (subidos) fs.writeFileSync(marca, String(Math.max(...nuevos.map(h => Number(h.ts)))));
    }
    // Solo se baja una lista cuando cambio su contador (la de antes pesa ~700 KB).
    const v = deps.versionesGodPacks ? await deps.versionesGodPacks() : null;
    const archivo = path.join(reportes, 'gp_hits_all.json');
    if (!v) return;
    if (gpCache.nuevosV !== v.nuevos || !fs.existsSync(archivo)) {
        const l = await deps.godPacksComunidad(false);
        if (l) { gpCache.nuevos = l; gpCache.nuevosV = v.nuevos; gpCache.cambio = true; }
    }
    if (gpCache.viejosV !== v.viejos || !fs.existsSync(archivo)) {
        const l = v.viejos === '0' ? [] : await deps.godPacksComunidad(true);
        if (l) { gpCache.viejos = l; gpCache.viejosV = v.viejos; gpCache.cambio = true; }
    }
    if (gpCache.cambio) {
        fs.writeFileSync(archivo, JSON.stringify([...gpCache.nuevos, ...gpCache.viejos]));
        gpCache.cambio = false;
    }
    await renovarFotosGp(reportes).catch(e => log('God Pack photos links:', e?.message || e));
}
const gpCache = { nuevos: [], viejos: [], nuevosV: null, viejosV: null, cambio: false, fotos: 0 };

// Las fotos de los God Packs de antes estan en Discord (posts de KyuremBot) y sus links vencen a las 24 h:
// cada 12 h este bot pide links nuevos (50 por llamada) y los deja en reports/gp_img_urls.json para el panel.
async function renovarFotosGp(reportes) {
    const token = process.env.DISCORD_BOT_TOKEN;
    const archivo = path.join(reportes, 'gp_img_urls.json');
    if (!token) return;
    const bases = [...new Set([...gpCache.nuevos, ...gpCache.viejos].map(h => h.img).filter(Boolean))];
    if (!bases.length) return;
    let previo = {}, edad = Infinity;
    try { previo = JSON.parse(fs.readFileSync(archivo, 'utf8')); edad = Date.now() - fs.statSync(archivo).mtimeMs; } catch (e) { /* no existe */ }
    const faltan = bases.some(b => !previo[b]);
    // Todo renovado hace < 12 h: nada. Faltan algunos: se reintenta, pero no mas de una vez cada 10 min.
    if (edad < 12 * 3600 * 1000 && (!faltan || edad < 10 * 60 * 1000 || Date.now() - gpCache.fotos < 10 * 60 * 1000)) return;
    const mapa = {};
    for (let i = 0; i < bases.length; i += 50) {
        for (let intento = 0; intento < 5; intento++) {
            const r = await fetch('https://discord.com/api/v10/attachments/refresh-urls', {
                method: 'POST', headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ attachment_urls: bases.slice(i, i + 50) }), signal: AbortSignal.timeout(15000)
            });
            if (r.status === 429) {
                const espera = ((await r.json().catch(() => ({}))).retry_after || 1) * 1000 + 250;
                await new Promise(s => setTimeout(s, espera));
                continue;
            }
            const j = await r.json().catch(() => ({}));
            for (const u of j.refreshed_urls || []) if (u.refreshed) mapa[u.original.split('?')[0]] = u.refreshed;
            break;
        }
    }
    fs.writeFileSync(archivo, JSON.stringify(mapa));
    gpCache.fotos = Date.now();
}

// Cuadro "ACCOUNTS LEFT · OPENED" del God Pack UI (Ale 2026-11-06): las prestadas de ESTE host que quedan
// para abrir en el modo del panel y las que abrio desde el ultimo Start. Va a reports/community_farm_status.json.
let inicioOn = Date.now();
// (Ale 2026-11-16) Miembros cuyo Monitor Link no contesto (PC apagada): sus cuentas no cuentan en el panel
// hasta que vuelva a contestar (confundia: "1,061 restantes" que nadie podia abrir).
const mlSinRespuesta = new Map();   // discord_id -> ms del ultimo fallo
const mlApagado = (id) => Date.now() - (mlSinRespuesta.get(String(id)) || 0) < 30 * 60 * 1000;
async function escribirEstadoPanel() {
    const motor = deps?.fastTransfer.rutaMotor();
    if (!motor || !panelEncendido(motor)) return;
    const parte = await deps.parte(modoPanel(motor)).catch(() => null);
    if (!parte) return;
    const cooldown = num(process.env.REROLL_COOLDOWN_HORAS, 24) * 3600 * 1000;
    const s = ajustesPanel(motor), estado = leerEstado(motor), abiertas = leerAbiertas(motor), ahora = Date.now();
    let disponibles = 0, abiertasDesdeStart = 0;
    for (const m of await deps.ml.cuentasReroll()) {
        const apagado = mlApagado(m.discord_id);
        for (const c of m.cuentas) {
            const clave = `${m.discord_id}|${c.f}`;
            if ((abiertas[clave] || 0) >= inicioOn) abiertasDesdeStart++;
            if (!apagado && miCuenta(m.discord_id, c.f, parte) && cuentaDelModo(c, s)
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
        await cambiarAvisoOnly(modo === 'packs-only');
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
        // Only Pack no cuenta PPM (Ale 2026-11-12: Arcade en Only Pack salio en LatiasBot con 92 PPM).
        if (!ppm && modo !== 'packs-only') { ppm = { desde: Date.now(), sobres: 0 }; sumarPropios(motor); }
        setTimeout(ciclo, 15 * 1000);
        await cambiarAvisoOnly(modo === 'packs-only');
    } else {
        await cambiarAvisoOnly(false);
        // Stop: ultimo heartbeat en Offline y 0 PPM (solo si estaba farmeando, no al arrancar el bot).
        if (ppm) {
            await enviarPpm(motor, ajustesPanel(motor), true).catch(e => log('PPM report failed:', e?.message || e));
            // Se guarda 15 min por si vuelve a dar Start (cambiar algo del panel no reinicia el PPM).
            sumarPropios(motor);
            ppm.pausa = { at: Date.now() };
        }
    }
}

// Aviso de Open Packs Only en 🔒-hosts (Ale 2026-11-09): al dar Start en Only Pack se manda una tarjeta (imagen)
// con el sobre, el PPM de Only Pack y las cuentas que le faltan abrir a cada miembro; se edita cada 5 min
// (los numeros bajan) y al dar Stop o cambiar de modo queda en gris, STOPPED. Este PPM no va a LatiasBot.
const AVISO_ONLY_MS = 5 * 60 * 1000;
const nombresMiembros = new Map();
async function nombreMiembro(id) {
    if (!nombresMiembros.has(id)) nombresMiembros.set(id, await deps.nombreMiembro?.(id).catch(() => null) || id);
    return nombresMiembros.get(id);
}
async function cambiarAvisoOnly(encender) {
    try {
        if (encender && !only) {
            only = { id: null, desde: Date.now(), sobres: 0, miembros: [] };
            sumarPropios(deps.fastTransfer.rutaMotor(), only);   // marca desde donde contar los sobres propios
            await actualizarAvisoOnly(false);
        } else if (!encender && only) {
            await actualizarAvisoOnly(true);
            only = null;
        }
    } catch (e) { log('Only Pack notice failed:', e?.message || e); }
}
async function actualizarAvisoOnly(terminado) {
    if (!deps?.avisoOnlyPack || !only) return;
    const motor = deps.fastTransfer.rutaMotor();
    if (!motor) return;
    const s = { ...ajustesPanel(motor), run_mode: 'packs-only' };
    sumarPropios(motor, only);
    if (!terminado) {
        // Cuentas que le faltan abrir a cada miembro en ESTE host (las abiertas entran en su espera de 24 h).
        const parte = await deps.parte('packs-only').catch(() => null);
        if (parte) {
            const cooldown = num(process.env.REROLL_COOLDOWN_HORAS, 24) * 3600 * 1000;
            const estado = leerEstado(motor), ahora = Date.now();
            const baneadasSet = await (deps.baneadas?.() || Promise.resolve(new Set())).catch(() => new Set());
            const miembros = [];
            for (const m of await deps.ml.cuentasReroll()) {
                const quedan = m.cuentas.filter(c => miCuenta(m.discord_id, c.f, parte) && cuentaDelModo(c, s)
                    && !baneadasSet.has(`${m.discord_id}|${c.f}`)
                    && ahora - Math.max(msDeLean(c.l), estado[`${m.discord_id}|${c.f}`] || 0) >= cooldown).length;
                if (quedan) miembros.push({ nombre: await nombreMiembro(m.discord_id), cuentas: quedan });
            }
            only.miembros = miembros;
        }
    }
    const { armarAvisoImagen } = require('./aviso-only-pack.js');
    const { embed, archivo } = await armarAvisoImagen({ motor, packId: s.pack_id || 'CN001_0010_00_000',
        host: s.host_name || os.hostname(), miembros: only.miembros,
        progreso: { sobres: only.sobres + (only.propios || 0), minutos: (Date.now() - only.desde) / 60000 }, terminado });
    only.id = await deps.avisoOnlyPack({ id: only.id, embed, archivo }) || only.id;
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
    // 2026-11-25 (Arcade: "secluded spring is missing"): codigo de engine/config/pack.json, probado abriendo 1 sobre.
    // (Deluxe Pack: ex, AN011 / PC_PS_2509000, responde ABORTED: no se agrega.)
    '{"name": "Secluded Springs", "expansion_id": "a4a", "sku_id": "A4a_1", "pack_id": "AN010_0010_00_000", "product_id": "PC_PS_2508000_01_01_01", "hg_cost": 12},',
];
// (Arcade 2026-11-25: "Lugia is at the end after Dual Fusion instead of after Ho-Oh") Los sobres agregados despues
// quedaban al final de la lista del God Pack UI y de /farm. Cada uno va detras del que le corresponde.
const ORDEN_CATALOGO = [
    ['AN009_0020_00_000', 'AN009_0010_00_000'],   // Lugia despues de Ho-Oh
    ['AN010_0010_00_000', 'AN009_0020_00_000'],   // Secluded Springs despues de Lugia
];
function ordenarCatalogo(motor) {
    try {
        const ruta = path.join(motor, 'scripts', 'flow', 'pack_catalog.py');
        const texto = fs.readFileSync(ruta, 'utf8');
        const nl = texto.includes('\r\n') ? '\r\n' : '\n';
        const lineas = texto.split(/\r?\n/);
        const fila = (id) => lineas.findIndex(l => l.includes(`"pack_id": "${id}"`));
        let cambios = 0;
        for (const [mover, detras] of ORDEN_CATALOGO) {
            const i = fila(mover), j = fila(detras);
            if (i < 0 || j < 0 || i === j + 1) continue;
            const [l] = lineas.splice(i, 1);
            lineas.splice(fila(detras) + 1, 0, l);
            cambios++;
        }
        if (!cambios) return;
        fs.copyFileSync(ruta, `${ruta}.bak-orden`);
        fs.writeFileSync(ruta, lineas.join(nl));
        log(`pack_catalog.py: ${cambios} pack(s) moved to their place in the list (Lugia after Ho-Oh, Secluded Springs)`);
    } catch (e) { /* sin catalogo en este motor */ }
}
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
        log(`pack_catalog.py: added ${faltan.length} pack(s): ${faltan.map(l => JSON.parse(l.replace(/,$/, "")).name).join(", ")}`);
    } catch (e) { /* sin catalogo en este motor */ }
}

// Tickets de compra equivocados en el catalogo de Miguel (2026-11-21, cy: Open 2 de Dialga abrio 0 sobres en
// 2.786 cuentas). Dialga traia uno adivinado (PC_PS_2503000_01_01_01 -> PurchaseV2 INTERNAL); el bueno sigue
// el patron de Palkia (verificado) y se probo abriendo 1 sobre en la cuenta de prueba de Ale.
// (Arcade 2026-11-23: Crimson Blaze no abria) Muchos otros tambien eran adivinados. Los buenos salen de
// engine/config/pack.json del motor (coincide con todos los verificados); Crimson Blaze y Triumphant Light se
// probaron abriendo 1 sobre en la cuenta de prueba. Se corrige cualquier codigo distinto en la linea del sobre.
const PRODUCTOS_CORREGIDOS = [
    { pack_id: 'AN001_0010_00_000', bueno: 'PC_PS_0002010_01_01_01' },   // Genetic Apex: Mewtwo
    { pack_id: 'AN001_0020_00_000', bueno: 'PC_PS_0002010_01_02_01' },   // Genetic Apex: Charizard
    { pack_id: 'AN001_0030_00_000', bueno: 'PC_PS_0002010_01_03_01' },   // Genetic Apex: Pikachu
    { pack_id: 'AN002_0010_00_000', bueno: 'PC_PS_2408010_01_01_01' },   // Mythical Island
    { pack_id: 'AN003_0010_00_000', bueno: 'PC_PS_2409010_01_01_01' },   // Dialga (probado)
    { pack_id: 'AN004_0010_00_000', bueno: 'PC_PS_2502010_01_01_01' },   // Triumphant Light (probado)
    { pack_id: 'AN006_0010_00_000', bueno: 'PC_PS_2504010_01_01_01' },   // Celestial Guardians: Solgaleo
    { pack_id: 'AN006_0020_00_000', bueno: 'PC_PS_2504010_01_02_01' },   // Celestial Guardians: Lunala
    { pack_id: 'AN007_0010_00_000', bueno: 'PC_PS_2505010_01_01_01' },   // Extradimensional Crisis
    { pack_id: 'AN009_0010_00_000', bueno: 'PC_PS_2507000_01_01_01' },   // Wisdom of Sea and Sky: Ho-Oh
    { pack_id: 'AN009_0020_00_000', bueno: 'PC_PS_2507000_01_02_01' },   // Wisdom of Sea and Sky: Lugia
    { pack_id: 'BN002_0010_00_000', bueno: 'PC_PS_2512000_01_01_01' },   // Crimson Blaze (probado)
];
function corregirProductos(motor) {
    try {
        const ruta = path.join(motor, 'scripts', 'flow', 'pack_catalog.py');
        let texto = fs.readFileSync(ruta, 'utf8'), cambios = 0;
        texto = texto.split(/\r?\n/).map(linea => {
            for (const p of PRODUCTOS_CORREGIDOS) {
                if (!linea.includes(`"${p.pack_id}"`)) continue;
                const nueva = linea.replace(/"product_id":\s*"PC_PS_[0-9_]+"/, `"product_id": "${p.bueno}"`);
                if (nueva !== linea) { cambios++; return nueva; }
            }
            return linea;
        }).join(texto.includes('\r\n') ? '\r\n' : '\n');
        if (!cambios) return;
        fs.copyFileSync(ruta, `${ruta}.bak-productos`);
        fs.writeFileSync(ruta, texto);
        log(`pack_catalog.py: fixed ${cambios} wrong product id(s)`);
    } catch (e) { /* sin catalogo en este motor */ }
}

// Ajustes recomendados del God Pack UI (2026-11-07, Naja + Arcade: mismo motor, sin soft bans): tope de 35
// sobres/min por Main, 6 s de espera para que acepten, 2 s entre cuentas y 1 s entre sobres (el servidor abre
// los dos sobres igual y no da el segundo si el primero es God Pack). Se aplican UNA vez por host (despues cada
// uno puede cambiarlos); el panel los toma al abrirse. El tope de la comunidad (ppm_cap.json) sigue mandando.
const AJUSTES_RECOMENDADOS = { packs_per_min: 35, wait_accept: 6, account_delay: 2, pack_delay: 1 };
const PARALLEL_GP_MIN = 14;
function aplicarAjustesRecomendados(motor) {
    // (Ale 2026-11-21) Parallel 14 en God Pack (ver correrInject): tambien en el panel, para las cuentas propias.
    try {
        const marca3 = path.join(motor, 'reports', 'ajustes_recomendados_v3.done');
        const ruta = path.join(motor, 'tools', 'god_pack_gui', 'settings.json');
        if (!fs.existsSync(marca3) && fs.existsSync(ruta)) {
            const s = JSON.parse(fs.readFileSync(ruta, 'utf8'));
            let cambio = false;
            if ((s.run_mode || 'godpack') === 'godpack' && Number(s.parallel) < PARALLEL_GP_MIN) { s.parallel = PARALLEL_GP_MIN; cambio = true; }
            if (s.mode_timing?.godpack && Number(s.mode_timing.godpack.parallel) < PARALLEL_GP_MIN) { s.mode_timing.godpack.parallel = PARALLEL_GP_MIN; cambio = true; }
            if (cambio) {
                fs.copyFileSync(ruta, `${ruta}.bak-parallel`);
                fs.writeFileSync(ruta, JSON.stringify(s, null, 2));
                log(`God Pack UI: ${PARALLEL_GP_MIN} accounts at a time in God Pack mode (was too slow to reach the PPM cap) - reopen the God Pack UI to load it`);
            }
            fs.mkdirSync(path.dirname(marca3), { recursive: true });
            fs.writeFileSync(marca3, new Date().toISOString());
        }
    } catch (e) { /* sin panel en este motor */ }
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
function sumarPropios(motor, obj = ppm) {
    if (!obj || !motor) return;
    const ruta = path.join(motor, 'reports', 'god_pack_live.log');
    let tam;
    try { tam = fs.statSync(ruta).size; } catch (e) { return; }
    if (obj.logPos == null) { obj.logPos = tam; return; }
    if (tam < obj.logPos) obj.logPos = 0;
    if (tam === obj.logPos) return;
    try {
        const desde = Math.max(obj.logPos, tam - 64 * 1024 * 1024);
        const buf = Buffer.alloc(tam - desde);
        const fd = fs.openSync(ruta, 'r');
        fs.readSync(fd, buf, 0, buf.length, desde);
        fs.closeSync(fd);
        obj.propios = (obj.propios || 0) + (buf.toString('utf8').match(/\] {2,}cards: /g) || []).length;
        obj.logPos = tam;
    } catch (e) { /* se reintenta en el proximo reporte */ }
}

// Para el recuadro del host en Discord: nombre del panel ("Ale Cast") y cuantas cuentas propias tiene.
function infoFarm() {
    const motor = deps?.fastTransfer.rutaMotor();
    if (!motor || !panelEncendido(motor)) return null;
    let propias = 0;
    try { propias = Number(JSON.parse(fs.readFileSync(path.join(motor, 'reports', 'community_farm.json'), 'utf8')).own) || 0; } catch (e) { /* sin dato */ }
    const s = ajustesPanel(motor);
    return { nombre: String(s.host_name || '').trim() || null, propias, modo: modoPanel(motor),
        sobre: sobresDelPanel(s).map(p => nombreDeSobre(motor, p)).join(' + ') };
}

// Sobres que abre el panel: en Open Packs Only los marcados (pack_ids, varios = las cuentas se turnan); si no, pack_id.
function sobresDelPanel(s) {
    const uno = s.pack_id || 'CN001_0010_00_000';
    if ((s.run_mode || 'godpack') !== 'packs-only' || !Array.isArray(s.pack_ids) || !s.pack_ids.length) return [uno];
    return s.pack_ids.map(String);
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

// (Ale 2026-11-20) God Packs MUERTOS de Open Packs Only (cuentas de menos de 96 sobres): GP_LATE_FR_V1 les mando
// solicitudes a los Mains y las DEJO (13 entre el 19/11 06:54 y el 20/11). Se anotan en reports/fr_pending con
// all_friends: el barrido de siempre entra a cada una y borra todos sus amigos (las prestadas, pidiendo la XML a
// su Monitor Link, como cualquier limpieza). Cada host anota solo los suyos (su gp_hits.jsonl). Una sola vez.
async function anotarGpMuertos(motor) {
    if (!motor) return;
    const marca = path.join(motor, 'reports', 'dead_gp_cleanup_v1.done');
    if (fs.existsSync(marca)) return;
    let hits = [];
    try {
        hits = fs.readFileSync(path.join(motor, 'reports', 'gp_hits.jsonl'), 'utf8').split(/\r?\n/)
            .map(l => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean);
    } catch (e) { /* este host no tuvo God Packs */ }
    const desde = Date.UTC(2026, 10, 19, 11, 50);   // 2026-11-19 06:50 (UTC-5): se publico GP_LATE_FR_V1
    const muertos = hits.filter(h => h.mode === 'packs-only' && Number(h.ts) >= desde && h.xml);
    const s = ajustesPanel(motor);
    const prestadas = muertos.some(h => h.lent) ? await deps.ml.cuentasReroll().catch(() => null) : [];
    if (prestadas === null) return;   // sin la lista de cuentas prestadas: se intenta en el proximo arranque
    const dir = path.join(motor, 'reports', 'fr_pending');
    fs.mkdirSync(dir, { recursive: true });
    let n = 0;
    for (const h of muertos) {
        const base = path.basename(String(h.xml)).replace(/\.xml$/i, '');
        let owner = '';
        if (h.lent) {
            const m = prestadas.find(x => (x.cuentas || []).some(c => claveXml(c.f) === claveXml(h.xml)));
            if (!m) { log(`dead God Pack ${h.name}: lent account not found in any Monitor Link - skipped`); continue; }
            owner = String(m.discord_id);
        }
        const entrada = {
            account_key: base, nickname: h.name || base, account_id: '', target_pids: [], all_friends: true,
            owner, xml_file: `${base}.xml`,
            xml_path: owner ? '' : path.join(s.xml_dir || '', `${base}.xml`),
            json_path: owner ? '' : path.join(s.json_dir || '', `${base}.json`),
            run: 'deadgp', ts: Date.now() / 1000,
        };
        fs.writeFileSync(path.join(dir, `deadgp_${owner || 'own'}__${base.replace(/[^A-Za-z0-9_.()-]/g, '_')}.json`), JSON.stringify(entrada));
        n++;
    }
    fs.writeFileSync(marca, new Date().toISOString());
    if (n) log(`dead God Packs: ${n} account(s) noted to remove their Main friendships (next GP farm round)`);
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

// op (Ale 2026-11-16, /fill96): { modo, gastar (usa los relojes: sin --hg-cost 0), extra: [args], env: {}, stopFile, onLine(linea) }.
function correrInject(motor, dirCuentas, s, cantidad, duenoId, soloLimpiar = false, op = {}) {
    return new Promise(resolve => {
        const python = deps.fastTransfer.pythonMotor();
        const args = [path.join(motor, 'scripts', 'god_pack', 'inject.py'),
            '--collector-codes', (s.collectors || []).join(',') || 'dummy',
            '--worker-url', s.worker_url || 'https://onlineids.zenithrise.workers.dev/elite',
            // Sobre especial (SP1): 1 por cuenta, usa su propia energia (2026-11-07).
            '--packs', String(/^SP/i.test(sobresDelPanel(s)[0]) ? 1 : (s.packs || 2)),
            '--pack-id', sobresDelPanel(s)[0],
            '--accounts-dir', dirCuentas, '--xml-dir', dirCuentas, '--json-dir', dirCuentas,
            '--proxy-file', archivoProxies(motor, s),
            '--proxy-scheme', s.proxy_scheme || 'http',
            '--cooldown-hours', '0',               // el cooldown lo decide este modulo
            '--wait-accept', String(s.wait_accept ?? 10),
            '--pack-delay', String(s.pack_delay ?? 2),
            '--account-delay', String(s.account_delay ?? 2),
            // (Ale 2026-11-21) God Pack: cada cuenta tarda ~74 s y con 7 a la vez un host no pasaba de ~11 PPM aunque su
            // tope fuera 13-20 (la comunidad sacaba ~17 de 40). Minimo 14: el tope de PPM (ppm_cap.json) sigue mandando.
            '--parallel', String(op.parallel || ((op.modo || s.run_mode || 'godpack') === 'godpack' ? Math.max(Number(s.parallel) || 3, PARALLEL_GP_MIN) : (s.parallel || 3))),
            '--limit', String(cantidad),
            '--mode', op.modo || s.run_mode || 'godpack',
            '--farming-mode', s.farming_mode || 'only_gp',
            '--pack-power-min', s.pack_power_min || '1/5',
            ...(op.gastar ? [] : ['--hg-cost', '0']),   // nunca gastar relojes del miembro (salvo /fill96, que lo elige el)
            '--no-quarantine-locked',              // las XML son temporales: no hay nada que mover
            '--verify-power', ...(motorConoce(motor, '--full-power-only') ? ['--full-power-only'] : []), '--shuffle-proxies',
            '--stop-after-fails', String(s.stop_after_fails || 5),
            // Stop del panel GP: corta la tanda despues de la cuenta en curso (con su limpieza)
            '--stop-file', op.stopFile || path.join(motor, 'reports', 'community_farm.stop'), ...(op.extra || [])];
        if (soloLimpiar) args.push('--cleanup-only');   // solo borra amistades que quedaron (no abre sobres)
        if (s.packs_per_min > 0) args.push('--packs-per-min', String(s.packs_per_min));
        // NEAR96_GP_V1 (Ale 2026-11-20): prestadas a 6 sobres o menos de 96 (Open Packs Only y /farm Open 2): el motor
        // las corre en modo God Pack (solicitudes a los Mains; si sale un God Pack, se publica como cualquier otro).
        let archivoNear96 = null;
        if (op.near96 && Object.keys(op.near96).length && motorConoce(motor, '--near96')) {
            archivoNear96 = path.join(os.tmpdir(), `near96_${crypto.randomBytes(6).toString('hex')}.json`);
            try { fs.writeFileSync(archivoNear96, JSON.stringify(op.near96)); args.push('--near96', archivoNear96); }
            catch (e) { archivoNear96 = null; }
        }
        const borrarNear96 = () => { if (archivoNear96) { try { fs.unlinkSync(archivoNear96); } catch (e) { /* nada */ } } };
        const producto = productoDeSobre(motor, sobresDelPanel(s)[0]);
        if (producto) args.push('--product-id', producto);
        // (2026-11-12, Ale/Arcade) Open Packs Only con varios sobres marcados: las cuentas se turnan.
        const rotacion = sobresDelPanel(s);
        if (rotacion.length > 1 && motorConoce(motor, '--pack-rotation')) {
            const partes = rotacion.map(p => { const prod = productoDeSobre(motor, p); return prod ? `${p}:${prod}:${/^SP/i.test(p) ? 1 : (s.packs || 2)}` : ''; }).filter(Boolean);
            if (partes.length > 1) args.push('--pack-rotation', partes.join(','));
        }
        // Lo que dice el motor queda en reports/reroll_comunidad.log (2026-11-01: todas las cuentas daban
        // 0 sobres y no se veia por que). Pasado de 20 MB se rota a .log.1.
        // (Arcade 2026-11-19) /farm va a su propio log: en reroll_comunidad.log lo leia el God Pack UI del host
        // y sumaba esos sobres (y los de regalo) a su PPM y contadores (212 PPM).
        const rutaLog = path.join(motor, 'reports', op.logFile || 'reroll_comunidad.log');
        let salida = null;
        try {
            fs.mkdirSync(path.dirname(rutaLog), { recursive: true });
            if (fs.existsSync(rutaLog) && fs.statSync(rutaLog).size > 20 * 1024 * 1024) fs.renameSync(rutaLog, `${rutaLog}.1`);
            salida = fs.createWriteStream(rutaLog, { flags: 'a' });
            const nombre = String(op.nombre || '').replace(/[\r\n=]/g, ' ').trim();
            salida.write(`\n===== ${new Date().toISOString()} owner=${duenoId} accounts=${cantidad}${op.etiqueta ? ` job=${op.etiqueta}` : ''} python=${python}${nombre ? ` name=${nombre}` : ''} =====\n`);
        } catch (e) { salida = null; }
        const escribir = d => { try { salida?.write(d); } catch (e) { /* sin log */ } };
        const cerrar = () => { try { salida?.end(); } catch (e) { /* sin log */ } };
        const hijo = spawn(python, ['-X', 'utf8', ...args], {
            cwd: motor, windowsHide: true,
            // ZENITH_ACCOUNT_OWNER: el aviso de God Pack en Zenith menciona al dueño de la cuenta prestada.
            env: { ...process.env, UTLS_PROXY: '1', PYTHONIOENCODING: 'utf-8', ZENITH_ACCOUNT_OWNER: String(duenoId || ''), ...(op.env || {}) }
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
                if (op.onLine) { try { op.onLine(l); } catch (e) { /* nada */ } }
                const m = /\[([^\]]+)\] pack opened .*<-- GOD PACK (\S+) \(WONDER-PICKABLE\)/.exec(l);
                if (m) gps.push({ cuenta: m[1], nivel: m[2], cartas: '' });
                const c = /\[([^\]]+)\]\s+cards: (.+)$/.exec(l);
                const ultimo = gps[gps.length - 1];
                if (c && ultimo && ultimo.cuenta === c[1] && !ultimo.cartas) ultimo.cartas = c[2];
            }
        };
        hijo.stdout.on('data', leer);
        hijo.stderr.on('data', escribir);
        hijo.on('error', e => { escribir(`[spawn error] ${e?.message || e}\n`); cerrar(); borrarNear96(); resolve(gps); });
        hijo.on('close', code => { escribir(`[exit ${code}]\n`); cerrar(); borrarNear96(); resolve(gps); });
    });
}

// Cartas que quedaron sin entregar: el host del turno se las manda a cada Monitor Link; otro host se las
// pasa al del turno.
// (Ale 2026-11-20) Miembros con un /farm corriendo: sus sobres se entregan al TERMINAR. Por cada cuenta que recibe,
// Monitor Link vuelve a leer TODAS sus cuentas (Qing: 4.958 archivos) y mientras tanto no atiende: el pedido de la
// tanda siguiente fallaba ("Your Monitor Link did not answer") y el /farm se cortaba. Pasaba solo con los de muchas cuentas.
const farmEnCurso = new Set();
async function entregarPendientes(idMiembro) {
    // Directo al Monitor Link de cada miembro (1.9.14+ escucha a todos los hosts). Lo que no se pudo
    // entregar (Monitor Link viejo o apagado) y este host no tiene el turno, se pasa al host del turno.
    const ids = (idMiembro ? [idMiembro] : await deps.ml.miembrosConSobresPendientes()).filter(id => !farmEnCurso.has(String(id)));
    for (const id of ids) await deps.ml.entregarSobresReroll(id).catch(() => {});
    if (!deps.activo()) await deps.ml.pasarSobresAlHostActivo().catch(() => {});
}

// Entregas pendientes en segundo plano (2026-11-06, Ale: "no abre nada, se quedo asi"): con cientos
// pendientes (una por una, hasta 30 s cada una) el ciclo no llegaba a abrir sobres. Ahora corren aparte.
let entregando = false, entregarOtraVez = false;
function entregarEnFondo() {
    // (2026-11-20) Si ya hay una vuelta en curso, se hace otra al terminar (antes se perdia hasta el proximo llamado).
    if (entregando) { entregarOtraVez = true; return; }
    entregando = true;
    entregarPendientes().catch(() => {}).finally(() => {
        entregando = false;
        if (entregarOtraVez) { entregarOtraVez = false; setTimeout(entregarEnFondo, 5000); }
    });
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
        // (Ale 2026-11-13) Ya no un aviso por cuenta: van todas juntas en el resumen del dia (bot.js, zenith:baneadas).
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
    // 2026-11-09: Upstash sin cuota (o una base nueva vacia) devolvia "" y se BORRABA el webhook del motor:
    // los God Packs dejaban de postearse. Ahora una respuesta vacia nunca lo borra; si la base esta vacia
    // y aca hay uno, se vuelve a guardar en Upstash.
    if (!url) {
        if (actual && deps.guardarWebhookGp && await deps.versionesGodPacks?.().catch(() => null)) {
            await deps.guardarWebhookGp(actual).catch(() => {});
            log('community God Pack webhook was empty in Upstash - saved again from this PC');
        }
        return;
    }
    fs.mkdirSync(path.dirname(ruta), { recursive: true });
    fs.writeFileSync(ruta, url);
    log('community God Pack webhook updated');
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
// (2026-11-09, Ale) En la PC de Ale (corre desde el repo, sin host-version.txt) la version se lee UNA vez al
// arrancar: es la del codigo que corre. Antes se leia el commit actual cada minuto, y cada commit nuevo hacia
// que el panel dijera "updated - close and reopen" o "updating to..." (su bot no se autoactualiza).
const VERSION_AL_ARRANCAR = versionDeEsteHost();
const ES_HOST_DEV = !fs.existsSync(path.join(__dirname, 'host-version.txt'));
async function escribirVersion() {
    const motor = deps?.fastTransfer.rutaMotor();
    if (!motor) return;
    const version = VERSION_AL_ARRANCAR;
    const release = await (deps.ultimaRelease?.() || Promise.resolve(null)).catch(() => null);
    let alDia = deps.estaAlDia?.(version, release);
    // Host de Ale: si su codigo ya incluye lo publicado (va igual o adelante), esta al dia.
    if (alDia === false && ES_HOST_DEV && /^[0-9a-f]{7,40}$/.test(release?.commit || '') && /^[0-9a-f]{7,40}$/.test(version)) {
        try {
            require('child_process').execSync(`git merge-base --is-ancestor ${release.commit} ${version}`, { cwd: __dirname, windowsHide: true, stdio: 'ignore' });
            alDia = true;
        } catch (e) { /* no la incluye: atrasado de verdad */ }
    }
    fs.mkdirSync(path.join(motor, 'reports'), { recursive: true });
    fs.writeFileSync(path.join(motor, 'reports', 'monitor_version.json'),
        JSON.stringify({ version, latest: release?.version || null, upToDate: alDia, ts: Date.now() }));
}

let avisoPausa = false;   // log de la pausa del reset, una vez por pausa
let esperarPropias = false;   // las propias del host siguen abriendose: se reintenta en 1 min
async function ciclo() {
    if (corriendo || !deps) return;
    // (2026-11-08) El candado se toma ANTES de cualquier await: antes se tomaba despues de leer la parte del
    // host, y dos llamadas casi juntas (el temporizador + el reinicio de 30 s) pasaban las dos y abrian la
    // MISMA tanda del mismo miembro dos veces a la vez (la segunda: ABORTED / sin sobres).
    corriendo = true;
    const motor = deps.fastTransfer.rutaMotor();
    const parte = await deps.parte(modoPanel(motor)).catch(() => null);
    if (!motor) { corriendo = false; return; }
    let trabajo = false;
    let pendiente = null;   // tanda siguiente ya preparada (sus XML en una carpeta temporal)   // si abrio alguna tanda: la siguiente arranca enseguida
    try {
        entregarEnFondo();
        if (!parte || !panelEncendido(motor)) return;   // Offline: el panel GP no esta en Start
        // Pausa del reset diario: en modo God Pack no se abren prestadas (Open Packs Only sigue: no manda solicitudes).
        if (modoPanel(motor) === 'godpack' && pausaReset()) {
            if (!avisoPausa) { avisoPausa = true; log(`daily reset pause - GP farm resumes at ${new Date(pausaReset()).toLocaleTimeString()}`); }
            return;
        }
        avisoPausa = false;
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
                mlSinRespuesta.set(String(m.discord_id), Date.now());
                return null;
            }
            mlSinRespuesta.delete(String(m.discord_id));
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
            // NEAR96_GP_V1: en Open Packs Only, las que estan a 6 sobres o menos de 96 van en modo God Pack.
            const near96 = soloSobres(s)
                ? Object.fromEntries(listas.filter(c => Number(c.e) > 0 && Number(c.e) <= 6).map(c => [claveXml(c.f), Number(c.e)]))
                : null;
            return { m, nombres, dir, near96 };
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
                const gps = await correrInject(motor, dir, s, nombres.length, m.discord_id, false, { near96: t.near96 });
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
                if (ppm && !soloSobres(s)) ppm.sobres += sobres;   // los de Only Pack no van al PPM
                if (only) only.sobres += sobres;
                log(`${sobres} pack(s) opened for ${m.discord_id}`);
            } finally {
                fs.rmSync(dir, { recursive: true, force: true });   // las XML no quedan en el host
            }
            entregarEnFondo();   // en segundo plano: no frena la siguiente tanda
            // (2026-11-07, Arcade) El panel volvio a abrir cuentas PROPIAS (las que salieron de su espera de 24 h):
            // van primero. Se corta despues de esta tanda y el ciclo sigue cuando el panel termina.
            if (panelOcupado(motor)) { log('own accounts are opening again - lent accounts wait'); esperarPropias = true; break; }
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

// ======================================================================================================
// /fill96 (Ale 2026-11-16): cada miembro sube SUS cuentas prestadas que no llegan a 96 sobres (o estan en pausa
// de 30 dias), sin que el host tenga que hacer nada. Corre en el host del turno con los proxies del host.
//   1. Revision: entra a cada cuenta (inject.py --scan-only) y guarda relojes LARGE + sobres gratis. No abre nada.
//   2. El miembro elige: "Reach 96 only" (gasta solo lo justo, guarda el resto) o "Spend all hourglasses".
//   3. Open Packs Only con --spend-all-hourglasses (+ --pack-targets en "Reach 96 only").
// Hasta FILL96_MAX miembros a la vez; el resto en cola. Las cuentas en curso quedan marcadas en el estado del
// GP farm (cooldown) para que el farm no las abra al mismo tiempo. Las XML se piden al Monitor Link y se borran.
const FILL96_MAX = num(process.env.FILL96_MAX, 3);
const FILL96_LOTE = 50;
const fill96Trabajos = new Map();   // discordId -> trabajo
const fill96Cola = [];              // discordId en espera
const rutaFill96 = (motor) => path.join(motor, 'reports', 'fill96_scans.json');
function leerRevisiones(motor) { try { return JSON.parse(fs.readFileSync(rutaFill96(motor), 'utf8')); } catch (e) { return {}; } }
function guardarRevisiones(motor, datos) {
    fs.mkdirSync(path.dirname(rutaFill96(motor)), { recursive: true });
    fs.writeFileSync(rutaFill96(motor), JSON.stringify(datos));
}
const claveXml = (f) => path.basename(String(f || '')).toLowerCase().replace(/\.xml$/i, '') + '.xml';

// Cuentas prestadas del miembro que todavia no son elegibles: [{ f, p, faltan }].
// todas = true: tambien las elegibles (sobre especial y reclamar regalos van en TODAS sus cuentas, Ale 2026-11-16).
async function fill96Cuentas(discordId, todas = false) {
    if (!deps) return [];
    const m = (await deps.ml.cuentasReroll()).find(x => x.discord_id === String(discordId));
    const baneadasSet = await (deps.baneadas?.() || Promise.resolve(new Set())).catch(() => new Set());
    return (m?.cuentas || []).filter(c => (todas || Number(c.e) > 0) && !baneadasSet.has(`${discordId}|${c.f}`))
        .map(c => ({ f: c.f, p: Number(c.p) || 0, faltan: Number(c.e), l: c.l }));
}

// Resumen para Discord: cuentas + ultima revision guardada (relojes y sobres gratis de cada una).
async function fill96Resumen(discordId) {
    const motor = deps?.fastTransfer.rutaMotor();
    const cuentas = await fill96Cuentas(discordId);
    const rev = motor ? (leerRevisiones(motor)[String(discordId)] || null) : null;
    const filas = cuentas.map(c => {
        const r = rev?.cuentas?.[claveXml(c.f)];
        if (!r || r.hg < 0) return { ...c, revisada: false };
        const posibles = Math.max(0, r.power) + Math.floor(r.hg / 12);
        const abrir96 = Math.min(c.faltan, posibles);
        // lleno = cuando tiene sus 2 sobres gratis (ms); la energia sigue cargando despues de la revision.
        const llenoEn = r.lleno ? Math.max(0, r.lleno - Date.now()) : -1;
        return { ...c, revisada: true, hg: r.hg, power: Math.max(0, r.power), posibles, llenoEn,
            llega: posibles >= c.faltan, abrir96, hg96: Math.max(0, abrir96 - Math.max(0, r.power)) * 12 };
    });
    // prestadas = todas las que comparte (Zeka 2026-11-16: no compartia ninguna y el bot decia "ya son elegibles").
    const prestadas = cuentas.length ? cuentas.length : (await fill96Cuentas(discordId, true)).length;
    return { cuentas: filas, prestadas, revisadaTs: rev?.ts || 0, trabajo: fill96Estado(discordId) };
}

function fill96Estado(discordId) {
    const t = fill96Trabajos.get(String(discordId));
    if (t) return { ...t.publico, posicion: 0 };
    const i = fill96Cola.indexOf(String(discordId));
    return i >= 0 ? { fase: 'cola', posicion: i + 1 } : null;
}

// tipo: 'scan' | 'open96' | 'openall'. avisar(estadoPublico, final) se llama al avanzar y al terminar.
// (Ale 2026-11-16) Sobres que el miembro puede elegir en /farm (catalogo del motor, el mas nuevo primero).
// Fuera: los especiales (SP, otra energia), Lugia (su product_id es adivinado y el juego lo rechaza) y
// Team Rocket's Ambition (no acepta relojes) y Deluxe Mega (bloqueado, no abre) — Ale 2026-11-16.
const FILL96_SIN = new Set(['AN001_0010_00_000', 'AN009_0020_00_000','BN010_0010_00_000', 'BN011_0010_00_000']);
function fill96Sobres() {
    const motor = deps?.fastTransfer.rutaMotor();
    let catalogo = '';
    try { catalogo = fs.readFileSync(path.join(motor, 'scripts', 'flow', 'pack_catalog.py'), 'utf8'); } catch (e) { return { sobres: [], defecto: '' }; }
    const sobres = [];
    let especial = null;   // sobre especial (First Partners): va aparte, 1 por semana con su propia energia
    for (const m of catalogo.matchAll(/\{"name":\s*"([^"]+)"[^}]*?"pack_id":\s*"([A-Z0-9_]+)"/g)) {
        if (/^SP/i.test(m[2]) && !especial) especial = { name: m[1].replace(/^Special Pack:\s*/i, ''), pack_id: m[2] };
        if (/^SP/i.test(m[2]) || FILL96_SIN.has(m[2]) || sobres.some(x => x.pack_id === m[2])) continue;
        sobres.push({ name: m[1], pack_id: m[2] });
    }
    sobres.reverse();
    const panel = sobresDelPanel(ajustesPanel(motor))[0];
    return { sobres, especial, defecto: sobres.some(x => x.pack_id === panel) ? panel : (sobres[0]?.pack_id || '') };
}

function fill96Iniciar(discordId, tipo, avisar, packId = '', opciones = {}) {
    const id = String(discordId);
    if (fill96Trabajos.has(id) || fill96Cola.includes(id)) return fill96Estado(id);
    const t = { id, tipo, avisar, packId, parar: false, reanudado: !!opciones.reanudado, previo: opciones.previo || null, publico: { fase: tipo === 'scan' ? 'scan' : 'open', tipo, packId, total: 0, hechas: 0, sobres: 0, llegaron: 0, inicio: 0, error: null } };
    fill96Trabajos.set(id, t);
    // (Zeka 2026-11-19) Si ya hay fila, va al final: antes uno nuevo se colaba cuando se liberaba un lugar.
    if (fill96Cola.length || [...fill96Trabajos.values()].filter(x => x.publico.inicio).length >= FILL96_MAX) {
        fill96Trabajos.delete(id);
        fill96Cola.push(id);
        t.publico.fase = 'cola';
        fill96Pendientes.set(id, t);
        guardarFill96();
        return fill96Estado(id);
    }
    correrFill96(t);
    guardarFill96();
    return fill96Estado(id);
}
// (Zeka 2026-11-19) Un reinicio del bot borraba los /farm en curso y la fila sin avisar ("#1 in line" para
// siempre). Se guardan en un archivo y al volver se retoman (fill96Reanudar, lo llama bot.js).
const rutaFill96Pend = () => path.join(__dirname, 'reports', 'fill96_pendientes.json');
let fill96Cargado = false;   // true cuando fill96Reanudar ya leyo la lista guardada
setInterval(() => { if (fill96Trabajos.size || fill96Cola.length) guardarFill96(); }, 60 * 1000).unref?.();
// Lo hecho por un /farm, sumando lo de antes de un reinicio (t.previo).
function progresoFill96(t) {
    const pub = t.publico || {}, pr = t.previo || {};
    if (!pub.inicio && !pr.inicio) return null;
    return { hechas: (pub.hechas || 0) + (pr.hechas || 0), sobres: (pub.sobres || 0) + (pr.sobres || 0),
        llegaron: (pub.llegaron || 0) + (pr.llegaron || 0), inicio: pr.inicio || pub.inicio };
}
function guardarFill96() {
    try {
        // ts (Ale 2026-11-21): latido; al reiniciar solo se retoma lo guardado hace poco (ver fill96Reanudar).
        const ts = Date.now();
        // p (ZERO 2026-11-23): lo que lleva hecho, para mandarle el resumen aunque el bot se reinicie y no se retome.
        // Un /farm con Stop no se retoma tras un reinicio (Ale 2026-11-23).
        const lista = [...[...fill96Trabajos.values()].filter(t => !t.parar).map(t => ({ id: t.id, tipo: t.tipo, packId: t.packId, ts, p: progresoFill96(t) })),
            ...fill96Cola.map(id => fill96Pendientes.get(id)).filter(Boolean).map(t => ({ id: t.id, tipo: t.tipo, packId: t.packId, ts }))]
            .filter(x => x.tipo !== 'scan');
        // (2026-11-21) Antes de retomar los guardados (fill96Reanudar), un /farm nuevo pisaba la lista y se perdian:
        // hasta entonces se conservan los del archivo que todavia no se cargaron.
        if (!fill96Cargado) {
            try {
                const ids = new Set(lista.map(x => x.id));
                for (const x of JSON.parse(fs.readFileSync(rutaFill96Pend(), 'utf8'))) if (x?.id && !ids.has(x.id)) lista.push(x);
            } catch (e) { /* sin archivo */ }
        }
        fs.mkdirSync(path.dirname(rutaFill96Pend()), { recursive: true });
        fs.writeFileSync(rutaFill96Pend(), JSON.stringify(lista));
    } catch (e) { /* no critico */ }
}
// crearAvisar(id) -> avisar(pub, final) para cada trabajo retomado (sin la interaccion original).
// (Ale 2026-11-21: "yo no ejecute /farm y sigue": su /farm de la noche anterior volvio solo al otro dia y le quitaba
// el lugar a los miembros) Solo se retoma si el corte fue corto (< 30 min) y el Monitor Link del miembro esta
// encendido; si no, ese /farm se da por terminado y el lugar queda libre.
const FILL96_REANUDAR_MAX_MS = 30 * 60 * 1000;
// avisarCortado(id, pub): /farm que no se retoma -> resumen de lo que alcanzo a hacer (ZERO 2026-11-23: se cortaba
// sin decir nada).
async function fill96Reanudar(crearAvisar, avisarCortado) {
    let lista = [];
    try { lista = JSON.parse(fs.readFileSync(rutaFill96Pend(), 'utf8')); } catch (e) { fill96Cargado = true; return 0; }
    fill96Cargado = true;
    let n = 0, viejos = 0, apagados = 0;
    let mtime = 0;   // archivos de antes del latido (sin ts): cuenta cuando se guardo por ultima vez
    try { mtime = fs.statSync(rutaFill96Pend()).mtimeMs; } catch (e) { /* nada */ }
    for (const x of lista) {
        if (!x?.id || fill96Trabajos.has(x.id) || fill96Cola.includes(x.id)) continue;
        const cortado = (motivo) => { if (x.p?.inicio && avisarCortado) avisarCortado(x.id, { ...x.p, tipo: x.tipo, packId: x.packId || '', fase: 'stopped', fin: x.ts || mtime, cortado: motivo }); };
        if (Date.now() - (x.ts || mtime) > FILL96_REANUDAR_MAX_MS) { viejos++; cortado('restart'); continue; }
        const st = await deps?.ml?.estadoAgente?.(x.id).catch(() => null);
        if (!st?.enLinea) { apagados++; cortado('monitor_link'); continue; }
        fill96Iniciar(x.id, x.tipo, crearAvisar(x.id), x.packId || '', { reanudado: true, previo: x.p });
        n++;
    }
    if (n) log(`fill96: resumed ${n} /farm job(s) after a restart`);
    if (viejos || apagados) log(`fill96: not resumed - ${viejos} stopped too long ago, ${apagados} with Monitor Link off`);
    guardarFill96();
    return n;
}
const fill96Pendientes = new Map();   // los de la cola, con su trabajo armado
function fill96Siguiente() {
    while (fill96Cola.length && [...fill96Trabajos.values()].filter(x => x.publico.inicio).length < FILL96_MAX) {
        const id = fill96Cola.shift();
        const t = fill96Pendientes.get(id);
        fill96Pendientes.delete(id);
        if (!t) continue;
        t.publico.fase = t.tipo === 'scan' ? 'scan' : 'open';
        fill96Trabajos.set(id, t);
        correrFill96(t);
    }
    guardarFill96();
}
function fill96Parar(discordId) {
    const id = String(discordId);
    const i = fill96Cola.indexOf(id);
    if (i >= 0) { fill96Cola.splice(i, 1); fill96Pendientes.delete(id); guardarFill96(); return true; }
    const t = fill96Trabajos.get(id);
    if (!t) return false;
    t.parar = true;
    t.publico.parando = true;   // /farm muestra "Stopping…" hasta que termina
    try { fs.writeFileSync(t.stopFile, 'stop'); } catch (e) { /* aun no arranco el motor */ }
    return true;
}

async function correrFill96(t) {
    const motor = deps?.fastTransfer.rutaMotor();
    const pub = t.publico;
    pub.inicio = Date.now();
    farmEnCurso.add(String(t.id));   // sus sobres se entregan al terminar (ver entregarPendientes)
    let ultimoAviso = 0;
    const avisar = (final = false) => {
        if (!final && Date.now() - ultimoAviso < 8000) return;
        ultimoAviso = Date.now();
        try { t.avisar?.({ ...pub }, final); } catch (e) { /* nada */ }
    };
    try {
        if (!motor) throw new Error('this host has no engine');
        const s = { ...ajustesPanel(motor), run_mode: 'packs-only' };
        // El sobre que eligio el miembro en /farm (si no, el del panel).
        // (Ale 2026-11-16) Puede elegir varios: las cuentas se turnan (--pack-rotation, una por sobre).
        const _validos = fill96Sobres().sobres.map(x => x.pack_id);
        const _elegidos = [].concat(t.packId || []).map(String).filter(p => _validos.includes(p));
        if (_elegidos.length) { s.pack_id = _elegidos[0]; s.pack_ids = _elegidos; pub.packId = t.tipo === 'claim' ? '' : _elegidos; }
        // special = el sobre especial semanal (1 por cuenta, su propia energia); claim = solo regalos y misiones.
        if (t.tipo === 'special') {
            const sp = fill96Sobres().especial;
            if (!sp) { pub.error = 'no_special'; return; }
            s.pack_id = sp.pack_id; s.pack_ids = [sp.pack_id]; pub.packId = sp.pack_id;
        }
        const cuentas = await fill96Cuentas(t.id, t.tipo === 'special' || t.tipo === 'claim');
        let lista = cuentas;
        let objetivos = null;
        // (Ale 2026-11-16) Dos opciones, sin revision previa:
        //   open2  = solo los 2 sobres gratis, en las cuentas con 24 h desde su ultimo sobre (sin relojes).
        //   open96 = sobres gratis + relojes hasta llegar a 96 (el motor para en lo que le falta a cada una).
        const cooldown = num(process.env.REROLL_COOLDOWN_HORAS, 24) * 3600 * 1000;
        if (t.tipo === 'open2') {
            const estado0 = leerEstado(motor), ahora = Date.now();
            lista = lista.filter(c => ahora - Math.max(msDeLean(c.l), estado0[`${t.id}|${c.f}`] || 0) >= cooldown);
        }
        // (Ale 2026-11-20) Farm 96P retomado tras un reinicio: saltar las cuentas que este host ya proceso (marcadas al
        // empezar cada tanda) en las ultimas 12 h. Sus sobres se entregan al terminar, asi que Monitor Link aun no las
        // ve en 96 y sin esto volvia a abrirlas todas.
        if (t.tipo === 'open96' && t.reanudado) {
            const estado0 = leerEstado(motor), ahora = Date.now(), antes = lista.length;
            lista = lista.filter(c => ahora - (estado0[`${t.id}|${c.f}`] || 0) >= 12 * 3600 * 1000);
            if (antes !== lista.length) log(`fill96: ${t.id} Farm 96P resumed - ${antes - lista.length} account(s) already done, ${lista.length} left`);
        }
        if (t.tipo === 'open96') objetivos = Object.fromEntries(lista.map(c => [claveXml(c.f), c.faltan]));
        pub.total = lista.length;
        pub.elegibles = lista.filter(c => !(Number(c.faltan) > 0)).length;   // tarjeta del canal 96P
        pub.noLlegaron = [];   // open96: [nombre, sobres desde la pausa] de las que no llegaron
        if (!lista.length) { pub.error = t.tipo === 'open2' ? 'none_ready' : 'no_accounts'; return; }
        t.stopFile = path.join(motor, 'reports', `fill96_${t.id}.stop`);
        try { fs.unlinkSync(t.stopFile); } catch (e) { /* no habia */ }
        const archivoScan = path.join(motor, 'reports', `fill96_scan_${t.id}.jsonl`);
        if (t.tipo === 'scan') { try { fs.unlinkSync(archivoScan); } catch (e) { /* no habia */ } }
        const set = await codigoSet(sobresDelPanel(s)[0] || 'CN001_0010_00_000');
        for (let i = 0; i < lista.length && !t.parar; i += FILL96_LOTE) {
            const lote = lista.slice(i, i + FILL96_LOTE);
            let xmls, fallo = null;
            // (Ale 2026-11-20) Monitor Link ocupado (leyendo miles de cuentas) no contesta un rato: hasta 3 intentos,
            // 1 min entre cada uno, antes de dar el /farm por cortado.
            for (let intento = 1; intento <= 3 && !t.parar; intento++) {
                try {
                    try { xmls = await deps.ml.pedirXmlReroll(t.id, lote.map(c => c.f)); }
                    catch (e) { if (deps.activo()) throw e; xmls = await deps.ml.xmlRerollPorHostActivo(t.id, lote.map(c => c.f)); }
                    fallo = null;
                    break;
                } catch (e) {
                    fallo = e;
                    log(`fill96: ${t.id} Monitor Link did not answer (try ${intento}/3): ${e?.message || e}`);
                    // (Ale 2026-11-21) Apagado (PC apagada / Monitor Link cerrado): fuera ya, el lugar pasa al siguiente.
                    // (2026-11-22) Pero solo si no se lo ve hace 3+ min: justo despues de reiniciar el bot o de
                    // actualizarse Monitor Link, tardan en reconectar y se cortaban /farm de miembros conectados.
                    if (String(e?.message || e) === 'offline' && !(await deps.ml.estadoAgente(t.id).catch(() => null))?.enLinea) break;
                    if (intento < 3) await new Promise(r => setTimeout(r, 60 * 1000));
                }
            }
            if (fallo || !xmls) { pub.error = 'monitor_link_offline'; break; }
            const nombres = Object.keys(xmls || {});
            if (!nombres.length) { pub.error = 'monitor_link_offline'; break; }
            if (!await deps.fastTransfer.asegurarTunel()) { pub.error = 'tunnel_down'; break; }
            // Que el GP farm no las abra mientras tanto (su cooldown cuenta desde ahora): solo las de esta tanda.
            // (Especial y reclamar no: no gastan la energia normal, el GP farm las puede abrir igual.)
            if (t.tipo === 'open2' || t.tipo === 'open96') {
                const estado = leerEstado(motor);
                for (const c of lote) estado[`${t.id}|${c.f}`] = Date.now();
                guardarEstado(motor, estado);
            }
            const dir = path.join(os.tmpdir(), `ml_reroll_${crypto.randomBytes(6).toString('hex')}`);
            fs.mkdirSync(dir, { recursive: true });
            try {
                for (const nombre of nombres) {
                    const base = path.basename(nombre).replace(/\.xml$/i, '');
                    fs.writeFileSync(path.join(dir, `${base}.xml`), xmls[nombre]);
                    fs.writeFileSync(path.join(dir, `${base}.json`), JSON.stringify({ metadata: {}, pulls: [], registeredCards: [] }));
                }
                const extra = t.tipo === 'scan' ? ['--scan-only'] : t.tipo === 'open96' ? ['--spend-all-hourglasses', '--claim-rewards'] : t.tipo === 'claim' ? ['--claim-only'] : [];
                if (objetivos) {
                    const archivo = path.join(dir, '_targets.json');
                    fs.writeFileSync(archivo, JSON.stringify(objetivos));
                    extra.push('--pack-targets', archivo);
                }
                log(`fill96 ${t.tipo}: ${nombres.length} account(s) of ${t.id}`);
                await correrInject(motor, dir, s, nombres.length, t.id, false, {
                    modo: 'packs-only', gastar: t.tipo === 'open96', extra, parallel: t.tipo === 'open96' && /^(1|true|si|yes)$/i.test(String(process.env.HOST_PRINCIPAL || '')) ? 10 : 3,   // Farm 96P de a 10: por ahora solo el host de Ale (2026-11-20)
                    stopFile: t.stopFile, logFile: 'farm96.log',
                    // NEAR96_GP_V1: solo Open 2 (Farm 96P abre demasiados, Ale 2026-11-20)
                    near96: t.tipo === 'open2'
                        ? Object.fromEntries(lote.filter(c => Number(c.faltan) > 0 && Number(c.faltan) <= 6).map(c => [claveXml(c.f), Number(c.faltan)]))
                        : null, etiqueta: t.tipo, nombre: await nombreMiembro(t.id).catch(() => ''),
                    env: { FILL96_SCAN_FILE: archivoScan },
                    onLine: (l) => {
                        if (/\[fill96\] scan:/.test(l) || (/-- ACCOUNT SUMMARY:/.test(l) && !/\(claim only\)/.test(l)) || /claim only: done/.test(l)) { pub.hechas++; avisar(); }
                        else if (/\] pack opened cards=/.test(l)) { pub.sobres++; avisar(); }
                    }
                });
                if (t.tipo !== 'scan') {
                    const porArchivo = Object.fromEntries(lote.map(c => [claveXml(c.f), c]));
                    for (const nombre of nombres) {
                        const base = path.basename(nombre).replace(/\.xml$/i, '');
                        let pulls = [];
                        try { pulls = JSON.parse(fs.readFileSync(path.join(dir, `${base}.json`), 'utf8')).pulls || []; } catch (e) { /* nada */ }
                        const c = porArchivo[claveXml(nombre)];
                        if (pulls.length) {
                            for (const p of pulls) { p.pack = set; p.aviso = avisoS4t(motor, p.cards); }
                            await deps.ml.anotarSobresReroll(t.id, nombre, pulls, leanDeMs(Date.now()));
                        }
                        if (!c) continue;
                        if (pulls.length >= c.faltan) pub.llegaron++;
                        else if (t.tipo === 'open96') pub.noLlegaron.push([String(c.f).replace(/\.xml$/i, ''), 96 - c.faltan + pulls.length]);
                    }
                    entregarEnFondo();
                }
            } finally {
                fs.rmSync(dir, { recursive: true, force: true });   // las XML no quedan en el host
            }
        }
        if (t.tipo === 'scan') {
            const cuentasRev = {};
            let lineas = [];
            try { lineas = fs.readFileSync(archivoScan, 'utf8').split('\n'); } catch (e) { /* nada */ }
            for (const l of lineas) {
                try { const d = JSON.parse(l); if (d.xml) cuentasRev[claveXml(d.xml)] = { hg: Number(d.hg), power: Number(d.power), lleno: Number(d.full_in) >= 0 ? Number(d.ts) * 1000 + Number(d.full_in) * 1000 : 0 }; } catch (e) { /* linea rota */ }
            }
            try { fs.unlinkSync(archivoScan); } catch (e) { /* nada */ }
            const todas = leerRevisiones(motor);
            todas[t.id] = { ts: Date.now(), cuentas: { ...(todas[t.id]?.cuentas || {}), ...cuentasRev } };
            guardarRevisiones(motor, todas);
            pub.hechas = Object.keys(cuentasRev).length;
        } else {
            // Despues de abrir, la revision vieja ya no vale (gasto relojes): se borra la de este miembro.
            const todas = leerRevisiones(motor);
            delete todas[t.id];
            guardarRevisiones(motor, todas);
        }
    } catch (e) {
        pub.error = String(e?.message || e);
        log(`fill96 failed for ${t.id}:`, pub.error);
    } finally {
        pub.fase = t.parar ? 'stopped' : 'done';
        pub.fin = Date.now();
        try { if (t.stopFile) fs.unlinkSync(t.stopFile); } catch (e) { /* nada */ }
        fill96Trabajos.delete(t.id);
        farmEnCurso.delete(String(t.id));
        entregarEnFondo();   // ahora si: todos los sobres del /farm a su Monitor Link
        guardarFill96();
        if (t.previo) { const tot = progresoFill96(t); pub.hechas = tot.hechas; pub.sobres = tot.sobres; pub.llegaron = tot.llegaron; pub.inicio = tot.inicio; }
        avisar(true);
        fill96Siguiente();
    }
}

// /farm que estan corriendo ahora (tarjeta fija del canal 96P, Ale 2026-11-19).
function fill96Activos() {
    return [...fill96Trabajos.values()].filter(t => t.publico.inicio && t.publico.fase !== 'cola')
        .map(t => ({ id: t.id, ...t.publico, cola: fill96Cola.length }));
}

module.exports = { pausaReset, iniciar, ciclo, resumenPrestadas, infoFarm, fill96Resumen, fill96Iniciar, fill96Estado, fill96Parar, fill96Sobres, fill96Activos, fill96Reanudar };
