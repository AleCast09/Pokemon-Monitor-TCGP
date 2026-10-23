// Fast Share / Fast Trade (2026-10-23, pedido de Ale): el mismo Share/Trade a Main, pero sin
// MuMu ni needles -- lo hace el bot nuevo (ptcgp-capturedeluxe) hablando directo con el
// servidor del juego, via scripts/fast_transfer.py. Muestra el progreso paso a paso editando
// un solo mensaje.
//
// APAGADO para todos por defecto: solo aparece si el .env tiene FAST_TRANSFER_ENGINE_DIR
// apuntando a la carpeta del bot nuevo Y el servidor es el propio (esServidorPropio). El bot
// nuevo NUNCA se empaqueta con el release: solo se busca en esa ruta.
//
// .env:
//   FAST_TRANSFER_ENGINE_DIR=C:\Users\...\Desktop\ptcgp-capturedeluxe
//   FAST_TRANSFER_PYTHON=python            (opcional)
//   FAST_TRANSFER_PROXY_FILE=...\proxies.txt (opcional; sin esto va directo, sin proxy)
const fs = require('fs');
const net = require('net');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

const RUTA_SCRIPT = path.join(__dirname, 'scripts', 'fast_transfer.py');
const PUERTO_TUNEL = 9090;

const PASOS = {
    share: [
        ['login', 'Log in to the account'],
        ['friend_request', 'Send friend request'],
        ['accept', 'Your Main accepts'],
        ['share', 'Share the card'],
        ['unfriend', 'Unfriend']
    ],
    trade: [
        ['login', 'Log in to the account'],
        ['friend_request', 'Send friend request'],
        ['accept', 'Your Main accepts'],
        ['offer', 'Offer the card'],
        ['trade_accept', 'Your Main offers a card and accepts'],
        ['confirm', 'Confirm the trade'],
        ['unfriend', 'Unfriend']
    ]
};

// Modos del flujo de /card que tienen version Fast (Gold queda afuera: varias copias).
const MODO_A_FAST = { sharemain: 'share', main: 'trade', friend: 'trade' };

let deps = null;            // inyectadas por bot.js (db, helpers) -- ver init()
let cola = Promise.resolve(); // una operacion a la vez: el login siempre sale de la IP de casa
let enCola = 0;
const corridas = new Map(); // runId -> { hijo, detenido }

function init(dependencias) {
    deps = dependencias;
}

function rutaMotor() {
    const dir = (process.env.FAST_TRANSFER_ENGINE_DIR || '').trim();
    return dir && fs.existsSync(path.join(dir, 'auto_trade.py')) ? dir : null;
}

function habilitado(guildId) {
    return !!deps && !!rutaMotor() && deps.esServidorPropio(guildId);
}

// Boton que va al lado del menu de instancias de MuMu en el flujo de /card.
function filaBoton(guildId, { cartaId, friendId, fileName, modo }) {
    const fast = MODO_A_FAST[modo];
    if (!fast || !habilitado(guildId)) return null;
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`fast_go::${cartaId}::${friendId}::${fileName}::${modo}`.slice(0, 100))
            .setLabel(fast === 'share' ? '⚡ Fast Share (no MuMu)' : '⚡ Fast Trade (no MuMu)')
            .setStyle(ButtonStyle.Success)
    );
}

function puertoAbierto(puerto) {
    return new Promise(resolve => {
        const s = net.connect({ host: '127.0.0.1', port: puerto });
        const fin = ok => { s.destroy(); resolve(ok); };
        s.setTimeout(1500, () => fin(false));
        s.once('connect', () => fin(true));
        s.once('error', () => fin(false));
    });
}

// El motor habla con el juego a traves del tunel local (takasho-proxy, puerto 9090). Si no esta
// prendido se lanza el exe directo, separado del bot (sigue vivo entre corridas), con el mismo
// log que usan los .bat. No se usa _tunnel_manager.bat: desde PM2 no hay consola y su
// "timeout /t" y "start" fallan.
async function asegurarTunel() {
    if (await puertoAbierto(PUERTO_TUNEL)) return true;
    const dir = rutaMotor();
    const dirProxy = path.join(dir, 'proxy');
    const exe = path.join(dirProxy, 'takasho-proxy.exe');
    if (!fs.existsSync(exe)) return false;
    fs.mkdirSync(path.join(dir, 'logs'), { recursive: true });
    const out = fs.openSync(path.join(dir, 'logs', 'proxy_stdout.log'), 'a');
    const err = fs.openSync(path.join(dir, 'logs', 'proxy_stderr.log'), 'a');
    try {
        const hijo = spawn(exe, [], { cwd: dirProxy, detached: true, windowsHide: true, stdio: ['ignore', out, err] });
        hijo.on('error', () => {});
        hijo.unref();
    } finally {
        fs.closeSync(out);
        fs.closeSync(err);
    }
    for (let i = 0; i < 20; i++) {
        if (await puertoAbierto(PUERTO_TUNEL)) return true;
        await new Promise(r => setTimeout(r, 1000));
    }
    return false;
}

function icono(estado, mapa) {
    if (estado === 'ok') return mapa.nice ? `<:nice:${mapa.nice}>` : '✅';
    if (estado === 'error') return mapa.bad ? `<:bad:${mapa.bad}>` : '❌';
    if (estado === 'start' || estado === 'wait') return '⏳';
    return '⬜';
}

function construirEmbed(ctx) {
    const { fast, estados, detalles, mapa, nombreCarta, cartaId, fileName, friendId, final, inicio } = ctx;
    const ficha = mapa.Ficha_de_intercambio_TCGP ? `<:Ficha_de_intercambio_TCGP:${mapa.Ficha_de_intercambio_TCGP}> ` : '🔄 ';
    const titulo = fast === 'share' ? `🎁 ⚡ Fast Share — ${nombreCarta}` : `${ficha}⚡ Fast Trade — ${nombreCarta}`;
    const lineas = PASOS[fast].map(([clave, texto]) => {
        const est = estados[clave];
        let linea = `${icono(est, mapa)} ${texto}`;
        if (detalles[clave]) linea += `\n　*${detalles[clave]}*`;
        return linea;
    });
    let color = 0x3498DB;
    if (final === 'ok') {
        color = 0x2ECC71;
        lineas.push('', `🎉 Done in ${Math.round((Date.now() - inicio) / 1000)}s`);
    } else if (final === 'error') {
        color = 0xE74C3C;
    } else if (final === 'stopped') {
        color = 0x95A5A6;
        lineas.push('', '⏹️ Stopped');
    } else if (ctx.posicion > 0) {
        lineas.unshift(`🕒 Queued — position #${ctx.posicion}`, '');
    }
    return new EmbedBuilder()
        .setColor(color)
        .setTitle(titulo.slice(0, 256))
        .setDescription(lineas.join('\n').slice(0, 4000))
        .setFooter({ text: `Card ${cartaId} · From ${fileName} · To ${friendId}`.slice(0, 2048) });
}

async function editar(interaction, payload) {
    try {
        await interaction.editReply(payload);
    } catch (e) {
        // El token de la interaccion vence a los 15 min; el mensaje del canal sigue editable.
        try { await interaction.message?.edit(payload); } catch (e2) { /* nada mas que hacer */ }
    }
}

function correrMotor(runId, args, alEvento) {
    return new Promise(resolve => {
        const python = process.env.FAST_TRANSFER_PYTHON || 'python';
        const hijo = spawn(python, ['-X', 'utf8', RUTA_SCRIPT, ...args], {
            cwd: rutaMotor(),
            windowsHide: true,
            env: { ...process.env, UTLS_PROXY: '1', PYTHONIOENCODING: 'utf-8' }
        });
        corridas.get(runId).hijo = hijo;
        let resultado = null;
        let resto = '';
        const ultimas = [];
        const procesar = linea => {
            if (linea.startsWith('@@FT_RESULT ')) {
                try { resultado = JSON.parse(linea.slice(12)); } catch (e) { /* ignorar */ }
            } else if (linea.startsWith('@@FT ')) {
                try { alEvento(JSON.parse(linea.slice(5))); } catch (e) { /* ignorar */ }
            } else if (linea.trim()) {
                ultimas.push(linea);
                if (ultimas.length > 30) ultimas.shift();
            }
        };
        const leer = buf => {
            resto += buf.toString('utf8');
            const partes = resto.split(/\r?\n/);
            resto = partes.pop();
            partes.forEach(procesar);
        };
        hijo.stdout.on('data', leer);
        hijo.stderr.on('data', leer);
        hijo.on('error', e => { ultimas.push(String(e?.message || e)); });
        hijo.on('close', code => {
            if (resto) procesar(resto);
            resolve({ code, resultado, ultimas });
        });
    });
}

async function ejecutar(interaction, { cartaId, friendId, fileName, modo }) {
    const fast = MODO_A_FAST[modo];
    const runId = `${interaction.id}`;
    const mapa = (await deps.obtenerMapaEmojisGuild(interaction.guild).catch(() => ({}))) || {};
    const ctx = {
        fast, mapa, cartaId, fileName, friendId,
        nombreCarta: (await Promise.resolve(deps.nombreCarta?.(cartaId)).catch(() => null)) || cartaId,
        estados: {}, detalles: {}, final: null, inicio: Date.now(), posicion: 0
    };
    const filaStop = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`fast_stop::${runId}`).setLabel('⏹️ Stop').setStyle(ButtonStyle.Danger)
    );
    const filaRetry = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`fast_go::${cartaId}::${friendId}::${fileName}::${modo}`.slice(0, 100)).setLabel('🔄 Retry').setStyle(ButtonStyle.Secondary)
    );
    corridas.set(runId, { hijo: null, detenido: false });

    ctx.posicion = enCola;
    enCola++;
    await editar(interaction, { content: '', embeds: [construirEmbed(ctx)], components: [filaStop], files: [], attachments: [] });

    const turno = cola.then(async () => {
        ctx.posicion = 0;
        if (corridas.get(runId).detenido) return;

        // Ruta del XML de la cuenta elegida (misma carpeta que usa el resto del bot).
        const cfgXml = await deps.db.get(`SELECT webhook_url FROM configs_canales WHERE tipo = 'ruta_xml_cuentas'`);
        const rutaXml = deps.buscarArchivoXmlPorNombre(cfgXml?.webhook_url, fileName);
        if (!rutaXml) {
            ctx.estados.login = 'error';
            ctx.detalles.login = `XML ${fileName} not found in the XML Accounts Path`;
            ctx.final = 'error';
            return await editar(interaction, { embeds: [construirEmbed(ctx)], components: [filaRetry] });
        }

        if (!(await puertoAbierto(PUERTO_TUNEL))) {
            ctx.estados.login = 'start';
            ctx.detalles.login = 'Starting the tunnel…';
            await editar(interaction, { embeds: [construirEmbed(ctx)], components: [filaStop] });
            if (!(await asegurarTunel())) {
                ctx.estados.login = 'error';
                ctx.detalles.login = 'Could not start the tunnel (port 9090) — open any bot .bat once to check it';
                ctx.final = 'error';
                return await editar(interaction, { embeds: [construirEmbed(ctx)], components: [filaRetry] });
            }
            ctx.detalles.login = '';
        }

        const args = ['--engine-dir', rutaMotor(), '--xml', rutaXml, '--card-id', cartaId, '--target', friendId, '--mode', fast];
        if (process.env.FAST_TRANSFER_PROXY_FILE) args.push('--proxy-file', process.env.FAST_TRANSFER_PROXY_FILE);

        // Las ediciones se encadenan para no pisarse (Discord limita la frecuencia).
        let ultimaEdicion = Promise.resolve();
        const { resultado, ultimas } = await correrMotor(runId, args, ev => {
            ctx.estados[ev.step] = ev.state;
            ctx.detalles[ev.step] = ev.msg && ev.state !== 'ok' ? ev.msg : '';
            ultimaEdicion = ultimaEdicion.then(() => editar(interaction, { embeds: [construirEmbed(ctx)], components: [filaStop] }));
        });
        await ultimaEdicion;

        if (corridas.get(runId).detenido) {
            ctx.final = 'stopped';
            return await editar(interaction, { embeds: [construirEmbed(ctx)], components: [filaRetry] });
        }
        if (resultado?.success) {
            ctx.final = 'ok';
            try {
                await deps.registrarTransferenciaCarta(fileName, cartaId, fast === 'share' ? 'share' : modo === 'friend' ? 'friend' : 'main', interaction.user.id, friendId);
            } catch (e) { console.error('DEBUG: Fast Transfer no pudo guardar el historial:', e?.message || e); }
            return await editar(interaction, { embeds: [construirEmbed(ctx)], components: [] });
        }
        ctx.final = 'error';
        // Si el motor se cayo sin marcar el paso, se muestra la ultima linea de su log.
        if (!Object.values(ctx.estados).includes('error')) {
            const pendiente = PASOS[fast].find(([clave]) => ctx.estados[clave] !== 'ok');
            if (pendiente) {
                ctx.estados[pendiente[0]] = 'error';
                ctx.detalles[pendiente[0]] = (ultimas[ultimas.length - 1] || 'The engine stopped unexpectedly').slice(0, 300);
            }
        }
        return await editar(interaction, { embeds: [construirEmbed(ctx)], components: [filaRetry] });
    }).catch(e => {
        console.error('DEBUG: Fast Transfer error:', e);
    }).finally(() => {
        enCola = Math.max(0, enCola - 1);
        corridas.delete(runId);
    });
    cola = turno;
    return turno;
}

// Devuelve true si la interaccion era de Fast Transfer (bot.js deja de procesarla).
async function manejarInteraccion(interaction) {
    if (!interaction.isButton()) return false;
    const id = interaction.customId;
    if (id.startsWith('fast_stop::')) {
        const corrida = corridas.get(id.replace('fast_stop::', ''));
        if (!corrida) {
            await interaction.reply({ content: 'This run already finished.', ephemeral: true });
            return true;
        }
        corrida.detenido = true;
        if (corrida.hijo?.pid) {
            spawnSync('taskkill', ['/PID', String(corrida.hijo.pid), '/T', '/F'], { windowsHide: true });
        }
        await interaction.reply({ content: '⏹️ Stopping…', ephemeral: true });
        return true;
    }
    if (!id.startsWith('fast_go::')) return false;
    if (!habilitado(interaction.guildId)) {
        await interaction.reply({ content: '❌ Fast Share/Trade is not available here.', ephemeral: true });
        return true;
    }
    const [, cartaId, friendId, fileName, modo] = id.split('::');
    await interaction.deferUpdate();
    ejecutar(interaction, { cartaId, friendId, fileName, modo });
    return true;
}

module.exports = { init, habilitado, filaBoton, manejarInteraccion };
