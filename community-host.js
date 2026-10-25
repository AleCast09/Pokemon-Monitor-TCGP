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
    } else if (!mio && activo) {
        activo = false;
        console.log(`🔁 Another host has the community turn — ${YO} goes on standby.`);
        await alSoltar().catch(e => console.error('❌ Leaving the community turn:', e?.message || e));
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
}

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

// Al apagarse bien (pm2 stop, cerrar), borra sus comandos y suelta el turno para que otro lo tome ya.
async function salir() {
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
    process.on('SIGINT', salir);
    process.on('SIGTERM', salir);
    // En Windows pm2 stop no manda SIGINT: con --shutdown-with-message manda este aviso (2026-10-25,
    // bug real: tras pm2 stop los comandos del bot quedaban y no respondian).
    process.on('message', (m) => { if (m === 'shutdown') salir(); });
    await ciclo();
    setInterval(ciclo, CADA_MS);
}

module.exports = { iniciar, esActivo, nombre: () => YO, panelGuardado, guardarPanel, anotarPanel, panelesDeOtros, olvidarPanel };
