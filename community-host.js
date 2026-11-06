// Turno de host en la comunidad (2026-10-24, plan de Ale: cada host con SU propio bot -- Pokedex! de
// Ale, el bot de wr98, el de un tercero -- y nadie comparte su token).
//
// Todos los hosts estan en Zenith Rise con su bot, pero solo uno tiene el turno: el candado vive en
// Upstash (LINK_REDIS_*), el activo lo renueva cada 30 s y si se apaga, a los ~90 s lo toma otro.
//   - En espera: el bot borra SUS comandos de la comunidad y no contesta nada ahi (en el resto de los
//     servers, por ejemplo el privado de cada uno, sigue igual que siempre).
//   - Al tomar el turno: registra sus comandos y vuelve a publicar los paneles de los canales con sus
//     propios webhooks (los botones de un panel solo los atiende el bot que lo publico), borrando los
//     del bot anterior.
'use strict';
const os = require('os');
const comunidad = require('./community.js');

const CLAVE = 'zenith:host';
const VIDA_MS = 90 * 1000;
const CADA_MS = 30 * 1000;
// Fijo por PC (no por arranque): si el bot se reinicia, recupera su turno al instante.
const YO = String(process.env.HOST_NAME || os.hostname()).trim();

const SCRIPT_TOMAR = `local v = redis.call('GET', KEYS[1])
if (not v) or v == ARGV[1] then redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[2]) return 1 end
return 0`;
const SCRIPT_SOLTAR = `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0`;

let activo = false;
let iniciado = false;
let alTomar = async () => {};
let alSoltar = async () => {};
let vueltas = 0;
let estadoPropio = async () => ({});
let alPanel = async () => {};
let alControl = async () => {};

// Panel de hosts (2026-10-24, pedido de Ale: saber que PC host esta prendida y cual atiende): cada host
// anota su estado en Upstash (hash zenith:hosts) en cada ciclo; el que tiene el turno arma el panel.
const CLAVE_HOSTS = 'zenith:hosts';

const configurado = () => comunidad.hayComunidad() && !!process.env.LINK_REDIS_URL && !!process.env.LINK_REDIS_TOKEN;

async function redis(...comando) {
    const r = await fetch(process.env.LINK_REDIS_URL.replace(/\/+$/, ''), {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.LINK_REDIS_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(comando),
        signal: AbortSignal.timeout(10000)
    });
    const j = await r.json();
    if (j.error) throw new Error(j.error);
    return j.result;
}

// Sin candado configurado (un solo host, como era antes) este host siempre tiene el turno.
function esActivo() {
    return !configurado() || activo;
}

async function ciclo() {
    let mio;
    try {
        mio = (await redis('EVAL', SCRIPT_TOMAR, '1', CLAVE, YO, String(VIDA_MS))) === 1;
    } catch (e) {
        console.error(`⚠️ Community host turn: Upstash not answering (${e.message}) — keeping the current state.`);
        return;
    }
    if (mio && !activo) {
        activo = true;
        console.log(`👑 ${YO} has the community turn — publishing commands and panels.`);
        await alTomar().catch(e => console.error('❌ Taking the community turn:', e?.message || e));
        refrescarControl();
    } else if (!mio && activo) {
        activo = false;
        console.log(`🔁 Another host has the community turn — ${YO} goes on standby.`);
        await alSoltar().catch(e => console.error('❌ Leaving the community turn:', e?.message || e));
        refrescarControl();
    } else if (!mio && !iniciado) {
        const actual = await redis('GET', CLAVE).catch(() => null);
        console.log(`⏸️ Community standby — ${actual || 'another host'} has the turn.`);
        // Comandos que quedaron de antes (se apago sin soltarlos): fuera, asi no aparecen repetidos.
        await alSoltar().catch(() => {});
    }
    iniciado = true;
    // Estado cada 60 s y panel cada 2 min (la cuota gratis de Upstash es de 500k consultas al mes).
    vueltas++;
    if (vueltas % 2 !== 1) return;
    try {
        const estado = await estadoPropio();
        await redis('HSET', CLAVE_HOSTS, YO, JSON.stringify({ ...estado, nombre: YO, turno: activo, ts: Date.now() }));
    } catch (e) { /* el panel no es critico */ }
    if (activo && vueltas % 4 === 1) {
        try { await alPanel(await hostsConocidos()); } catch (e) { console.error('DEBUG: panel de hosts:', e?.message || e); }
    }
    if (vueltas % 4 === 1) refrescarControl();
}

// ---- Cambio de host a mano (2026-10-25, pedido de Ale: "si se va la luz, que el otro pueda tomar el rol
// con un click"). Cada host tiene su propio mensaje con botones en el canal de hosts (lo publica SU bot,
// asi funciona aunque el otro este apagado): en espera "Take the turn", con el turno "Hand over to X".
function refrescarControl() {
    hostsConocidos().then(h => alControl(h, activo)).catch(e => console.error('DEBUG: control de host:', e?.message || e));
}

// Tomar el turno ya, sin esperar a que venza el del otro. Si el otro sigue prendido, en su proximo
// ciclo (<= 30 s) ve que ya no es suyo y se pasa a espera solo.
async function tomarTurnoYa() {
    await redis('SET', CLAVE, YO, 'PX', String(VIDA_MS));
    ciclo().catch(() => {});
}

// Ceder el turno a otro host prendido: el candado pasa a su nombre y lo toma en su proximo ciclo.
async function cederTurnoA(nombre) {
    if (!activo || !nombre || nombre === YO) return false;
    await redis('SET', CLAVE, String(nombre), 'PX', String(VIDA_MS));
    ciclo().catch(() => {});
    return true;
}

// Donde esta el mensaje de control de cada host (hash zenith:hosts_ctrl, campo = nombre del host).
const controlGuardado = async () => { try { return JSON.parse(await redis('HGET', 'zenith:hosts_ctrl', YO) || 'null'); } catch (e) { return null; } };
const guardarControl = (dato) => redis('HSET', 'zenith:hosts_ctrl', YO, JSON.stringify(dato)).catch(() => {});

// Hosts que alguna vez se anotaron (los que no aparecen hace mas de 30 dias se olvidan).
async function hostsConocidos() {
    const plano = await redis('HGETALL', CLAVE_HOSTS) || [];
    const lista = [];
    for (let i = 0; i + 1 < plano.length; i += 2) {
        try {
            const h = JSON.parse(plano[i + 1]);
            if (Date.now() - (h.ts || 0) > 30 * 24 * 60 * 60 * 1000) { redis('HDEL', CLAVE_HOSTS, plano[i]).catch(() => {}); continue; }
            lista.push({ ...h, enLinea: Date.now() - (h.ts || 0) < 2 * VIDA_MS });
        } catch (e) { /* entrada rota */ }
    }
    return lista.sort((a, b) => (b.turno && b.enLinea) - (a.turno && a.enLinea) || b.enLinea - a.enLinea || (b.ts || 0) - (a.ts || 0));
}

// El mensaje del panel lo puede haber dejado otro bot: se guarda donde esta para borrarlo al cambiar.
let _panel;   // undefined = todavia no se leyo de Upstash
const panelGuardado = async () => {
    if (_panel === undefined) { try { _panel = JSON.parse(await redis('GET', 'zenith:hosts_msg') || 'null'); } catch (e) { return null; } }
    return _panel;
};
const guardarPanel = (dato) => { _panel = dato; return redis('SET', 'zenith:hosts_msg', JSON.stringify(dato)).catch(() => {}); };

// Paneles publicados (2026-10-25, bug real: al cambiar de host se borro el historial de los canales).
// Antes se borraba todo mensaje con botones de otro bot en los ultimos 50 de cada canal, y eso incluia
// los resultados de /card, Shinedust, Fast Farm... Ahora cada host anota aca SUS paneles (los mensajes
// de interfaz que mantiene) y al tomar el turno se borran solo esos, los del otro bot.
const CLAVE_PANELES = 'zenith:paneles';
const anotarPanel = (msgId, canalId, botId) => configurado() && msgId && canalId
    ? redis('HSET', CLAVE_PANELES, String(msgId), JSON.stringify({ c: String(canalId), b: String(botId) })).catch(() => {}) : Promise.resolve();
async function panelesDeOtros(botId) {
    if (!configurado()) return [];
    const plano = await redis('HGETALL', CLAVE_PANELES).catch(() => []) || [];
    const lista = [];
    for (let i = 0; i + 1 < plano.length; i += 2) {
        try { const p = JSON.parse(plano[i + 1]); if (p.b !== String(botId)) lista.push({ msg: plano[i], canal: p.c }); } catch (e) { /* entrada rota */ }
    }
    return lista;
}
const olvidarPanel = (msgId) => configurado() ? redis('HDEL', CLAVE_PANELES, String(msgId)).catch(() => {}) : Promise.resolve();

// ---- GP farm Online/Offline (2026-10-31, pedido de Ale) ----
// Cada host marca si esta haciendo reroll (boton en su mensaje de control). Los hosts Online se reparten
// la bolsa de proxies y las cuentas que prestan los miembros: uno solo se lleva todo, dos mitad y mitad.
// Hash zenith:reroll, campo = nombre del host, valor { online, ts }. Cuenta solo si la PC esta prendida.
const CLAVE_REROLL = 'zenith:reroll';

// modo = "Run Mode" del panel GP ("godpack" | "packs-only"): las cuentas se reparten solo entre los hosts
// del MISMO modo (Ale 2026-11-06: uno en Only Pack y otro en GP farm no deben partirse las mismas cuentas).
async function marcarReroll(online, modo = 'godpack') {
    if (online) await redis('HSET', CLAVE_REROLL, YO, JSON.stringify({ online: true, ts: Date.now(), modo: modo || 'godpack' }));
    else await redis('HDEL', CLAVE_REROLL, YO);
}

// Nombres de los hosts Online para reroll y con la PC prendida, en orden fijo (igual en todos los hosts).
// modo (opcional): solo los hosts en ese modo (un host viejo, sin modo, cuenta como "godpack").
async function hostsReroll(modo = null) {
    if (!configurado()) return [];
    const plano = await redis('HGETALL', CLAVE_REROLL) || [];
    const prendidos = new Set((await hostsConocidos()).filter(h => h.enLinea).map(h => h.nombre));
    const lista = [];
    for (let i = 0; i + 1 < plano.length; i += 2) {
        if (!prendidos.has(plano[i])) continue;
        let suModo = 'godpack';
        try { suModo = JSON.parse(plano[i + 1]).modo || 'godpack'; } catch (e) { /* viejo */ }
        if (!modo || suModo === modo) lista.push(plano[i]);
    }
    return lista.sort();
}

// La parte de ESTE host: { i, n, hosts } (i-esimo de n hosts Online), o null si no esta Online.
async function parteReroll(modo = null) {
    const hosts = await hostsReroll(modo);
    const i = hosts.indexOf(YO);
    return i < 0 ? null : { i, n: hosts.length, hosts };
}

// Al apagarse bien (pm2 stop, cerrar), borra sus comandos y suelta el turno para que otro lo tome ya.
async function salir() {
    // Tope duro (2026-10-30): si soltar el turno se cuelga (Discord/Upstash lentos), el proceso
    // quedaba vivo, pm2 no lograba matarlo en Windows y cada restart dejaba una copia vieja del bot
    // contestando comandos con el codigo anterior. 6 s < kill-timeout de pm2 (8 s).
    setTimeout(() => process.exit(0), 6000).unref();
    if (activo) {
        await alSoltar().catch(() => {});
        await redis('EVAL', SCRIPT_SOLTAR, '1', CLAVE, YO).catch(() => {});
    }
    process.exit(0);
}

// opciones.alTomar / opciones.alSoltar: lo que hace el bot al ganar o perder el turno.
async function iniciar(opciones) {
    if (!configurado()) return;
    alTomar = opciones.alTomar || alTomar;
    alSoltar = opciones.alSoltar || alSoltar;
    estadoPropio = opciones.estado || estadoPropio;
    alPanel = opciones.panel || alPanel;
    alControl = opciones.control || alControl;
    process.on('SIGINT', salir);
    process.on('SIGTERM', salir);
    // En Windows pm2 stop no manda SIGINT: con --shutdown-with-message manda este aviso (2026-10-25,
    // bug real: tras pm2 stop los comandos del bot quedaban y no respondian).
    process.on('message', (m) => { if (m === 'shutdown') salir(); });
    await ciclo();
    setInterval(ciclo, CADA_MS);
}

// Miembros que prestan cuentas al GP farm (2026-11-01): lo escribe el host del turno con cada panel, para
// LatiasBot (wr98). Clave zenith:miembros = JSON { discordId: { monitorLink, lent, ready, ts } }.
// true solo para el PRIMER host que anota esta clave en `segundos` (SET NX EX): un aviso por evento
// aunque lo detecten varios hosts a la vez.
// Cuentas prestadas probablemente baneadas (2026-11-06, Ale): hash zenith:baneadas, campo "discordId|archivo.xml".
// Las comparten los 3 hosts: ninguno la vuelve a abrir y el Monitor Link del dueño la marca "Banned?".
async function marcarBaneada(discordId, archivo) {
    if (!configurado()) return;
    await redis('HSET', 'zenith:baneadas', `${discordId}|${archivo}`, String(Date.now()));
}
async function baneadas() {
    if (!configurado()) return new Set();
    const plano = await redis('HGETALL', 'zenith:baneadas').catch(() => []) || [];
    const s = new Set();
    for (let i = 0; i < plano.length; i += 2) s.add(plano[i]);
    return s;
}

// Webhook de God Packs de la comunidad (2026-11-06, Ale): lo carga el staff desde 🔒-hosts y cada host lo usa
// cuando el "God Pack Hit Webhook URL" de su panel esta vacio. Vive solo en Upstash (nunca en el repo).
async function guardarWebhookGp(url) {
    if (!configurado()) return false;
    await redis('SET', 'zenith:gp_webhook', String(url || ''));
    return true;
}
async function webhookGp() {
    if (!configurado()) return '';
    try { return String(await redis('GET', 'zenith:gp_webhook') || ''); } catch (e) { return ''; }
}

// Ultima version publicada para los hosts ({ version, commit, ... } de zenith:release), cacheada 60 s.
let _release = { ts: 0, valor: null };
async function ultimaRelease() {
    if (!configurado()) return null;
    if (Date.now() - _release.ts < 60 * 1000) return _release.valor;
    _release.ts = Date.now();
    try { _release.valor = JSON.parse(await redis('GET', 'zenith:release') || 'null'); } catch (e) { /* sin red */ }
    return _release.valor;
}
// "dev"/commit (host de Ale, corre del repo) o la version publicada: ¿es la ultima?
function estaAlDia(version, release) {
    if (!version || !release) return null;
    return version === release.version || (release.commit && version === release.commit);
}

async function primeraVez(clave, segundos) {
    if (!configurado()) return true;
    try { return (await redis('SET', clave, '1', 'NX', 'EX', String(segundos))) === 'OK'; } catch (e) { return false; }
}

const anotarMiembros = (registro) => configurado()
    ? redis('SET', 'zenith:miembros', JSON.stringify(registro)).catch(() => {}) : Promise.resolve();

module.exports = { iniciar, esActivo, nombre: () => YO, panelGuardado, guardarPanel, anotarPanel, panelesDeOtros, olvidarPanel,
    tomarTurnoYa, cederTurnoA, controlGuardado, guardarControl, refrescarControl, marcarReroll, hostsReroll, parteReroll, anotarMiembros, primeraVez, marcarBaneada, baneadas, guardarWebhookGp, webhookGp, ultimaRelease, estaAlDia };
