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
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, WebhookClient, MessageFlags, StringSelectMenuBuilder } = require('discord.js');

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
    // Servidor propio, o server de comunidad (community.js) donde ⚡ es la unica forma de operar.
    return !!deps && !!rutaMotor() && (deps.esServidorPropio(guildId) || !!deps.esComunidad?.(guildId));
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
    // 'w' y no 'a' (2026-10-24): el registro del tunel se empieza de cero en cada arranque. Solo anota
    // que pedido se hizo al juego (sin cuentas ni claves), pero sumando sin fin llego a pesar 460 MB.
    const out = fs.openSync(path.join(dir, 'logs', 'proxy_stdout.log'), 'w');
    const err = fs.openSync(path.join(dir, 'logs', 'proxy_stderr.log'), 'w');
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
    // Los pasos aparecen de a uno (pedido de Ale): los hechos con check y el que esta corriendo
    // con ⏳; los que faltan no se muestran.
    const lineas = [];
    for (const [clave, texto] of PASOS[fast]) {
        let est = estados[clave];
        if (!est) {
            if (final || ctx.posicion > 0) break;
            est = 'start';
        }
        let linea = `${final === 'stopped' && est !== 'ok' ? '🚫' : icono(est, mapa)} ${texto}`;
        if (detalles[clave] && final !== 'stopped') linea += `\n　*${detalles[clave]}*`;
        lineas.push(linea);
        if (est !== 'ok') break;
    }
    // Cancel en curso / terminado: que se deshizo (solicitud, amistad, trade abierto).
    if (ctx.cancelando && !final) lineas.push('', `⏳ Cancelling — ${ctx.cancelMsg || 'undoing what was started…'}`);
    // Copias de esta carta en la cuenta (JSON − transferencias del historial), pedido de Ale.
    if (typeof ctx.copias === 'number') {
        lineas.unshift(final === 'ok'
            ? `📦 Copies on this account: x${ctx.copias} − 1 → **x${Math.max(0, ctx.copias - 1)}** left`
            : `📦 Copies on this account: **x${ctx.copias}**`, '');
    }
    let color = 0x3498DB;
    if (final === 'ok') {
        color = 0x2ECC71;
        lineas.push('', `🎉 Done in ${Math.round((Date.now() - inicio) / 1000)}s`);
    } else if (final === 'error') {
        color = 0xE74C3C;
    } else if (final === 'stopped') {
        color = 0x95A5A6;
        lineas.push('', `🚫 Cancelled${ctx.cancelMsg ? ` — ${ctx.cancelMsg}` : ''}`);
    } else if (ctx.posicion > 0) {
        lineas.unshift(`🕒 Queued — position #${ctx.posicion}`, '');
    }
    return new EmbedBuilder()
        .setColor(color)
        .setTitle(titulo.slice(0, 256))
        .setDescription(lineas.join('\n').slice(0, 4000))
        .setFooter({ text: `Card ${cartaId} · From ${fileName} · To ${friendId}`.slice(0, 2048) });
}

// El progreso es un mensaje efimero (solo lo ve quien apreto el boton, con "Dismiss message").
// Su token vence a los 15 min (amistad 5 + trade 10 + cola pueden pasarse): si el resultado
// final ya no se puede editar, se le manda por DM.
async function editar(interaction, payload, final = false) {
    try {
        // Si se arranco desde el mensaje del canal, el progreso es un followUp efimero aparte.
        if (interaction._fastMsgId) await interaction.webhook.editMessage(interaction._fastMsgId, payload);
        else await interaction.editReply(payload);
    } catch (e) {
        if (final) {
            try { await interaction.user.send({ embeds: payload.embeds }); } catch (e2) { /* DMs cerrados */ }
        }
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
        estados: {}, detalles: {}, final: null, inicio: Date.now(), posicion: 0, copias: null
    };
    try { ctx.copias = (await deps.auditarStockCarta(fileName, cartaId))?.disponible ?? null; } catch (e) { /* sin dato */ }
    const filaStop = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`fast_stop::${runId}`).setLabel('✖️ Cancel').setStyle(ButtonStyle.Danger)
    );
    const filaRetry = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`fast_go::${cartaId}::${friendId}::${fileName}::${modo}`.slice(0, 100)).setLabel('🔄 Retry').setStyle(ButtonStyle.Secondary)
    );
    const stopFile = path.join(os.tmpdir(), `fast_transfer_stop_${runId}`);
    try { fs.unlinkSync(stopFile); } catch (e) { /* no existia */ }
    corridas.set(runId, { hijo: null, detenido: false, stopFile });

    ctx.posicion = enCola;
    enCola++;
    await editar(interaction, { content: '', embeds: [construirEmbed(ctx)], components: [filaStop], files: [], attachments: [] });

    const miembro = deps.usuarioComunidad?.() || null;
    const limpiezas = [];
    const turno = cola.then(async () => {
        ctx.posicion = 0;
        if (corridas.get(runId).detenido) { ctx.final = 'stopped'; return; }

        // XML de la cuenta elegida: la carpeta de esta PC, o (comunidad) la que manda su Monitor Link.
        if (miembro) {
            ctx.estados.login = 'start';
            ctx.detalles.login = 'Getting the account from your Monitor Link…';
            await editar(interaction, { embeds: [construirEmbed(ctx)], components: [filaStop] });
        }
        const xmls = await prepararXmls(miembro, [fileName], runId);
        limpiezas.push(xmls.limpiar);
        const rutaXml = rutaXmlDe(xmls.mapa, fileName);
        if (!rutaXml) {
            ctx.estados.login = 'error';
            ctx.detalles.login = xmls.error || (miembro ? `${fileName} was not found in your Saved folder` : `XML ${fileName} not found in the XML Accounts Path`);
            ctx.final = 'error';
            return await editar(interaction, { embeds: [construirEmbed(ctx)], components: [filaRetry] }, true);
        }
        ctx.detalles.login = '';

        if (!(await puertoAbierto(PUERTO_TUNEL))) {
            ctx.estados.login = 'start';
            ctx.detalles.login = 'Starting the tunnel…';
            await editar(interaction, { embeds: [construirEmbed(ctx)], components: [filaStop] });
            if (!(await asegurarTunel())) {
                ctx.estados.login = 'error';
                ctx.detalles.login = 'Could not start the tunnel (port 9090) — open any bot .bat once to check it';
                ctx.final = 'error';
                return await editar(interaction, { embeds: [construirEmbed(ctx)], components: [filaRetry] }, true);
            }
            ctx.detalles.login = '';
        }

        const args = ['--engine-dir', rutaMotor(), '--xml', rutaXml, '--card-id', cartaId, '--target', friendId, '--mode', fast, '--stop-file', stopFile];
        if (process.env.FAST_TRANSFER_PROXY_FILE) args.push('--proxy-file', process.env.FAST_TRANSFER_PROXY_FILE);

        // Las ediciones se encadenan para no pisarse (Discord limita la frecuencia).
        let ultimaEdicion = Promise.resolve();
        const { resultado, ultimas } = await correrMotor(runId, args, ev => {
            ctx.estados[ev.step] = ev.state;
            if (ev.step === 'cancel') {
                ctx.cancelando = true;
                ctx.cancelMsg = ev.state === 'ok' ? ev.msg : '';
            } else {
                ctx.detalles[ev.step] = ev.msg && ev.state !== 'ok' ? ev.msg : '';
            }
            ultimaEdicion = ultimaEdicion.then(() => editar(interaction, { embeds: [construirEmbed(ctx)], components: corridas.get(runId)?.detenido ? [] : [filaStop] }));
        });
        await ultimaEdicion;

        if (corridas.get(runId).detenido) {
            ctx.final = 'stopped';
            return await editar(interaction, { embeds: [construirEmbed(ctx)], components: [filaRetry] }, true);
        }
        if (resultado?.success) {
            ctx.final = 'ok';
            await editar(interaction, { embeds: [construirEmbed(ctx)], components: [] }, true);
            await registrarYResumir(interaction, ctx, modo, resultado.received);
            return;
        }
        ctx.final = 'error';
        // Para revisar despues que paso (pm2 logs bot): las ultimas lineas del motor, sin datos de la cuenta.
        console.error(`DEBUG: ⚡ ${fast} failed (${cartaId}):\n  ` + ultimas.slice(-15).join('\n  '));
        // Si el motor se cayo sin marcar el paso, se muestra la ultima linea de su log.
        if (!Object.values(ctx.estados).includes('error')) {
            const pendiente = PASOS[fast].find(([clave]) => ctx.estados[clave] !== 'ok');
            if (pendiente) {
                ctx.estados[pendiente[0]] = 'error';
                ctx.detalles[pendiente[0]] = (ultimas[ultimas.length - 1] || 'The engine stopped unexpectedly').slice(0, 300);
            }
        }
        return await editar(interaction, { embeds: [construirEmbed(ctx)], components: [filaRetry] }, true);
    }).then(async () => {
        // Mensaje de la carta en el canal: si salio bien queda con una linea de resultado; si fallo
        // o se detuvo se borra (pedido de Ale: en el canal solo quedan los completados). El Retry
        // sigue en el mensaje privado.
        if (!interaction._fastCanal) return;
        try {
            if (ctx.final === 'ok') {
                await interaction.editReply({ content: `<@${interaction.user.id}> ✅ ${interaction._fastCanal} completed.`, components: [] });
            } else {
                await interaction.deleteReply();
            }
        } catch (e) { /* token vencido */ }
    }).catch(e => {
        console.error('DEBUG: Fast Transfer error:', e);
    }).finally(() => {
        enCola = Math.max(0, enCola - 1);
        corridas.delete(runId);
        limpiezas.forEach(f => f());
        try { fs.unlinkSync(stopFile); } catch (e) { /* no se pidio Cancel */ }
    });
    cola = turno;
    return turno;
}

// Historial + resumen final (pedido de Ale): el mismo embed "📦 Transfer completed" que manda el
// Share/Trade con MuMu al canal de Trading -- foto de la carta, cuenta, cantidad antes/despues,
// destino -- mas el tipo (⚡ Fast Share / ⚡ Fast Trade) y, en trade, la carta recibida.
async function registrarYResumir(interaction, ctx, modo, recibida) {
    const { fast, cartaId, fileName, friendId, nombreCarta } = ctx;
    let antes = null;
    try { antes = await deps.auditarStockCarta(fileName, cartaId); } catch (e) { /* sin stock, sigue */ }
    try {
        await deps.registrarTransferenciaCarta(fileName, cartaId, fast === 'share' ? 'share' : modo === 'friend' ? 'friend' : 'main', interaction.user.id, friendId);
        // Comunidad: lo transferido queda en los ajustes del miembro (en su PC), asi cualquier host lo sabe.
        const miembroAj = deps.usuarioComunidad?.();
        if (miembroAj) await deps.anotarAjusteMiembro(miembroAj, fileName, { tipo: 'traded', card: cartaId, n: 1 }).catch(e => console.error('DEBUG: ajuste de trade:', e?.message || e));
    } catch (e) {
        console.error('DEBUG: Fast Transfer no pudo guardar el historial:', e?.message || e);
    }
    try {
        // Share al canal de Share, Trade al de Trading (pedido de Ale); si el de Share no esta
        // configurado, cae al de Trading para no perder el resumen.
        let canal = fast === 'share' ? await deps.obtenerCanalComando(interaction.guildId, 'share-cards') : null;
        if (!canal?.webhook_url) canal = await deps.obtenerCanalComando(interaction.guildId, 'cmd_run_instance');
        if (!canal?.webhook_url) return;
        // Nombre guardado de la cuenta que recibio (lista de amigos de /setup), no el codigo.
        const nombreDestino = (await Promise.resolve(deps.nombreAmigo?.(interaction.guildId, friendId, interaction.user?.id)).catch(() => null))
            || (modo === 'friend' ? 'your friend' : 'your Main');
        let embed, files = [];
        try {
            const payload = await deps.construirEmbedDetalleCarta(cartaId, nombreCarta, await deps.rutaMaster(), null, interaction.guild);
            embed = payload.embeds[0];
            files = payload.files || [];
        } catch (e) {
            embed = new EmbedBuilder();
        }
        // Arriba solo la carta; los datos de la transferencia van detras del boton
        // "📦 Transfer details" (pedido de Ale). El boton lleva todo en su customId, asi sigue
        // funcionando aunque el bot se reinicie: tipo, cuenta, destino, copias antes, fecha y,
        // en trade, la carta recibida.
        embed.setColor(0x2ECC71).setTitle('📦 Transfer completed');
        const ts = Math.floor(Date.now() / 1000).toString(36);
        const idDetalle = ['fast_det', fast === 'share' ? 's' : modo === 'friend' ? 'f' : 't', fileName, friendId,
            antes ? antes.disponible : '', ts, recibida || ''].join('::');
        const fila = idDetalle.length <= 100 ? [new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(idDetalle).setLabel('📦 Transfer details').setStyle(ButtonStyle.Secondary)
        )] : [];
        const aviso = fast === 'share'
            ? `<@${interaction.user.id}> 🎉 Congrats on the share! **${nombreCarta}** was sent to **${nombreDestino}**.`
            : `<@${interaction.user.id}> 🎉 Trade completed! **${nombreCarta}** was sent to **${nombreDestino}**.`;
        await new WebhookClient({ url: canal.webhook_url }).send({
            content: aviso, embeds: [embed], files, components: fila,
            allowedMentions: { users: [interaction.user.id] }
        });
    } catch (e) {
        console.error('DEBUG: Fast Transfer no pudo mandar el resumen:', e?.response?.data || e?.message || e);
    }
}

// ============ ⚡ Fast Farm Tickets (2026-10-23, pedido de Ale) ============
// Los likes a la Community Showcase, sin MuMu: scripts/fast_farm.py hace login con cada cuenta
// XML y manda el like directo al servidor. Usa las MISMAS reglas y tablas que el Farm Tickets de
// siempre (bot.js): tope diario por perfil, cuentas sorteadas entre las que nunca le dieron like
// a ese perfil, y likes_dados se anota solo con el like confirmado por el servidor.
const RUTA_SCRIPT_FARM = path.join(__dirname, 'scripts', 'fast_farm.py');

function filaBotonFarm(guildId, friendId) {
    if (!habilitado(guildId)) return null;
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`fast_farm::${friendId}`).setLabel('⚡ Fast Farm (no MuMu)').setStyle(ButtonStyle.Success)
    );
}

function correrFarm(runId, args, alEvento) {
    return new Promise(resolve => {
        const python = process.env.FAST_TRANSFER_PYTHON || 'python';
        const hijo = spawn(python, ['-X', 'utf8', RUTA_SCRIPT_FARM, ...args], {
            cwd: rutaMotor(), windowsHide: true,
            env: { ...process.env, UTLS_PROXY: '1', PYTHONIOENCODING: 'utf-8' }
        });
        corridas.get(runId).hijo = hijo;
        let resto = '';
        let resultado = null;
        const procesar = linea => {
            if (linea.startsWith('@@FF_RESULT ')) { try { resultado = JSON.parse(linea.slice(12)); } catch (e) { /* ignorar */ } }
            else if (linea.startsWith('@@FF ')) { try { alEvento(JSON.parse(linea.slice(5))); } catch (e) { /* ignorar */ } }
        };
        const leer = buf => {
            resto += buf.toString('utf8');
            const partes = resto.split(/\r?\n/);
            resto = partes.pop();
            partes.forEach(procesar);
        };
        hijo.stdout.on('data', leer);
        hijo.stderr.on('data', leer);
        hijo.on('error', () => {});
        hijo.on('close', () => { if (resto) procesar(resto); resolve(resultado || { liked: [] }); });
    });
}

async function ejecutarFarm(interaction, friendId) {
    const runId = `${interaction.id}`;
    const mapa = (await deps.obtenerMapaEmojisGuild(interaction.guild).catch(() => ({}))) || {};
    const ticket = mapa.Cupon_de_tienda_TCGP ? `<:Cupon_de_tienda_TCGP:${mapa.Cupon_de_tienda_TCGP}>` : '🎟️';
    const alias = (await Promise.resolve(deps.nombreAmigo?.(interaction.guildId, friendId, interaction.user?.id)).catch(() => null)) || deps.formatearFriendId(friendId);
    const maximo = deps.farmMaxDiario();
    const stopFile = path.join(os.tmpdir(), `fast_farm_stop_${runId}`);
    try { fs.unlinkSync(stopFile); } catch (e) { /* no existia */ }
    corridas.set(runId, { hijo: null, detenido: false, stopFile });

    const lineas = [];
    let conseguidos = 0;
    let estadoFinal = null;
    const filaCancel = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`fast_farm_stop::${runId}`).setLabel('✖️ Cancel').setStyle(ButtonStyle.Danger)
    );
    const filaVolver = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('farmtickets_volver').setLabel('🔙 Back').setStyle(ButtonStyle.Secondary)
    );
    const pintar = async (pie) => {
        const color = estadoFinal === null ? 0xF0A93A : conseguidos > 0 ? 0x57F287 : 0xE74C3C;
        const embed = new EmbedBuilder().setTitle(`🎟️ ⚡ Fast Farm — ${alias}`).setColor(color)
            .setDescription([...lineas, ...(pie ? ['', pie] : [])].join('\n').slice(0, 4000));
        try {
            await interaction.editReply({ embeds: [embed], components: estadoFinal === null && !corridas.get(runId)?.detenido ? [filaCancel] : [filaVolver] });
        } catch (e) { /* token vencido */ }
    };

    const miembro = deps.usuarioComunidad?.() || null;
    const limpiezas = [];
    enCola++;
    if (enCola > 1) await pintar(`🕒 Queued — position #${enCola - 1}`);
    const turno = cola.then(async () => {
        if (corridas.get(runId).detenido) { estadoFinal = 'stopped'; return; }
        if (!(await puertoAbierto(PUERTO_TUNEL))) {
            await pintar('⏳ Starting the tunnel…');
            if (!(await asegurarTunel())) { estadoFinal = 'error'; lineas.push(`${icono('error', mapa)} Could not start the tunnel (port 9090)`); return; }
        }
        let ronda = 0;
        while (!corridas.get(runId).detenido) {
            const restantes = maximo - (await deps.ticketsFarmeadosHoy(friendId));
            if (restantes <= 0) break;
            const pool = miembro ? deps.cuentasMiembro(miembro).map(c => c.fileNameXml) : await deps.cuentasPoolFarmTickets();
            const usadas = await deps.cuentasYaUsadasParaId(friendId);
            const cuentas = deps.sortearCuentasFarm(pool, usadas, restantes);
            if (!cuentas.length) { lineas.push('⚠️ Ran out of unused accounts for this profile.'); break; }
            ronda++;
            if (ronda > 1) lineas.push('', `**Round ${ronda}**`);
            const args = ['--engine-dir', rutaMotor(), '--target', friendId, '--stop-file', stopFile];
            const xmls = await prepararXmls(miembro, cuentas, `${runId}_${ronda}`);
            limpiezas.push(xmls.limpiar);
            if (xmls.error) { lineas.push(`${icono('error', mapa)} ${xmls.error}`); break; }
            for (const c of cuentas) {
                const ruta = rutaXmlDe(xmls.mapa, c);
                if (ruta) args.push('--account', `${c}|${ruta}`);
            }
            let okRonda = 0;
            const indice = {};
            let edicion = Promise.resolve();
            await correrFarm(runId, args, ev => {
                if (!ev.account) return;
                const nombre = String(ev.account).replace(/\.xml$/i, '');
                let linea;
                if (ev.state === 'start') {
                    linea = `⏳ \`${nombre}\` — logging in and liking…`;
                } else if (ev.state === 'ok') {
                    linea = `${icono('ok', mapa)} \`${nombre}\` — like sent (+1 ${ticket})`;
                    okRonda++;
                    conseguidos++;
                    // Se anota al momento: si despues se corta, lo ya hecho queda guardado.
                    edicion = edicion.then(async () => {
                        await deps.registrarLikeDado(ev.account, friendId);
                        await deps.guardarTandaFarm(friendId, 1);
                    });
                } else {
                    linea = `${icono('error', mapa)} \`${nombre}\` — ${ev.msg || 'failed'}`;
                    // Rechazado por el juego = esa cuenta ya no sirve para este perfil: se anota
                    // para no volver a sortearla (no suma ticket).
                    if (ev.rejected) edicion = edicion.then(() => deps.registrarLikeDado(ev.account, friendId));
                }
                if (indice[ev.account] === undefined) { indice[ev.account] = lineas.length; lineas.push(linea); }
                else lineas[indice[ev.account]] = linea;
                edicion = edicion.then(() => pintar(null));
            });
            await edicion;
            xmls.limpiar();
            if (okRonda === 0) { lineas.push('⚠️ Stopped: no like went through this round.'); break; }
        }
        estadoFinal = corridas.get(runId).detenido ? 'stopped' : 'done';
    }).catch(e => {
        console.error('DEBUG: Fast Farm error:', e);
        estadoFinal = 'error';
    }).then(async () => {
        if (estadoFinal === null) estadoFinal = 'done';
        const hoy = await deps.ticketsFarmeadosHoy(friendId).catch(() => null);
        const pie = [
            estadoFinal === 'stopped' ? '🚫 Cancelled' : null,
            `${ticket} **${conseguidos}** ticket(s) claimed now` + (hoy !== null ? ` · **${hoy}/${maximo}** today` : '')
        ].filter(Boolean).join('\n');
        await pintar(pie);
    }).finally(() => {
        enCola = Math.max(0, enCola - 1);
        corridas.delete(runId);
        limpiezas.forEach(f => f());
        try { fs.unlinkSync(stopFile); } catch (e) { /* no se pidio Cancel */ }
    });
    cola = turno;
    return turno;
}

// ============ ⚡ Fast Shinedust (2026-10-23, pedido de Ale) ============
// Lee Shinedust y Shop Tickets preguntandole al servidor (scripts/fast_dust.py), sin MuMu ni OCR.
// Los valores van a una tabla propia (shinedust_fast) -- los JSON son de Kevin/Leanny y no se
// tocan. /shinedust muestra el valor ⚡ mientras Kevin no haya escrito uno nuevo despues: se
// guarda el valor que tenia el JSON al refrescar, y si el JSON cambio, manda el de Kevin.
const RUTA_SCRIPT_DUST = path.join(__dirname, 'scripts', 'fast_dust.py');
const DUST_DELAY_S = 1.5;           // pausa entre logins (salen todos de la IP de casa)
const DUST_SEG_POR_CUENTA = 4;      // estimado para el ETA: login + consulta + pausa
const DUST_SALTAR_SI_MENOS_DE_MS = 24 * 60 * 60 * 1000; // "Refresh all" salta las refrescadas hace <24 h

async function asegurarTablaDust() {
    await deps.db.run(`CREATE TABLE IF NOT EXISTS shinedust_fast (
        archivo_json TEXT PRIMARY KEY,
        valor        INTEGER,
        tickets      INTEGER,
        ts           INTEGER,
        valor_json   INTEGER
    )`);
    // Inventario completo menos Poke Gold (JSON), agregado despues: la tabla puede venir sin la columna.
    try { await deps.db.run(`ALTER TABLE shinedust_fast ADD COLUMN inventario TEXT`); } catch (e) { /* ya existe */ }
    // Regalos pendientes del buzon y estado ('ok' / 'login_failed': la cuenta no pudo entrar al juego,
    // por ejemplo baneada o borrada), 2026-10-24.
    if (!asegurarTablaDust.estado) {
        try { await deps.db.run(`ALTER TABLE shinedust_fast ADD COLUMN regalos INTEGER`); } catch (e) { /* ya existe */ }
        try { await deps.db.run(`ALTER TABLE shinedust_fast ADD COLUMN estado TEXT`); } catch (e) { /* ya existe */ }
        try { await deps.db.run(`ALTER TABLE shinedust_fast ADD COLUMN error TEXT`); } catch (e) { /* ya existe */ }
        asegurarTablaDust.estado = true;
    }
}

async function filasDust() {
    await asegurarTablaDust();
    const filas = await deps.db.all(`SELECT archivo_json, valor, tickets, ts, valor_json, regalos, estado, error FROM shinedust_fast`);
    const mapa = new Map();
    for (const f of filas || []) mapa.set(f.archivo_json, f);
    return mapa;
}

function leerJson(ruta) {
    try { return JSON.parse(fs.readFileSync(ruta, 'utf8')); } catch (e) { return null; }
}

// Todas las cuentas de la carpeta JSON (tengan o no un valor de Kevin).
function cuentasJson(rutaJson) {
    if (!rutaJson || !fs.existsSync(rutaJson)) return [];
    const salida = [];
    for (const archivo of fs.readdirSync(rutaJson)) {
        if (!archivo.toLowerCase().endsWith('.json')) continue;
        const data = leerJson(path.join(rutaJson, archivo));
        if (!data) continue;
        const fileNameXml = data.metadata?.fileName || archivo;
        salida.push({
            archivoJson: archivo,
            fileNameXml,
            nombreCuenta: data.metadata?.accountName || fileNameXml,
            valorJson: typeof data.metadata?.shinedust?.value === 'number' ? data.metadata.shinedust.value : null
        });
    }
    return salida;
}

// Nombre de XML -> ruta, recorriendo la carpeta UNA vez (son ~1200 archivos en subcarpetas).
function mapaXml(rutaBase) {
    const mapa = new Map();
    const recorrer = (dir, prof) => {
        if (prof > 4) return;
        let entradas;
        try { entradas = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
        for (const e of entradas) {
            const completo = path.join(dir, e.name);
            if (e.isDirectory()) recorrer(completo, prof + 1);
            else if (e.name.toLowerCase().endsWith('.xml')) mapa.set(e.name.toLowerCase(), completo);
        }
    };
    if (rutaBase && fs.existsSync(rutaBase)) recorrer(rutaBase, 0);
    return mapa;
}

function rutaXmlDe(mapa, fileNameXml) {
    const n = String(fileNameXml || '').toLowerCase();
    return mapa.get(n.endsWith('.xml') ? n : `${n}.xml`) || null;
}

// XML de las cuentas a usar. En la comunidad salen del Monitor Link del miembro (nunca de esta PC):
// se piden en el momento, se escriben en una carpeta temporal y limpiar() las borra al terminar.
// Devuelve { mapa, limpiar, error } -- error es el texto para el usuario si no se pudieron traer.
async function prepararXmls(miembro, nombres, runId) {
    if (!miembro) {
        const cfgXml = await deps.db.get(`SELECT webhook_url FROM configs_canales WHERE tipo = 'ruta_xml_cuentas'`);
        return { mapa: mapaXml(cfgXml?.webhook_url), limpiar: () => {}, error: null };
    }
    const dir = path.join(os.tmpdir(), `ml_${runId}`);
    const limpiar = () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* nada */ } };
    let archivos;
    try {
        archivos = await deps.pedirXml(miembro, nombres);
    } catch (e) {
        return { mapa: new Map(), limpiar, error: e.message === 'offline'
            ? 'Your Monitor Link is not running — open it on your PC and try again'
            : 'Your Monitor Link did not answer in time — check it is running and try again' };
    }
    fs.mkdirSync(dir, { recursive: true });
    const mapa = new Map();
    Object.entries(archivos).forEach(([nombre, contenido], i) => {
        const ruta = path.join(dir, `${i}.xml`);
        fs.writeFileSync(ruta, contenido);
        const n = nombre.toLowerCase();
        mapa.set(n.endsWith('.xml') ? n : `${n}.xml`, ruta);
    });
    return { mapa, limpiar, error: null };
}

// Cuentas del usuario: las del resumen de su Monitor Link en la comunidad, las de esta PC si no.
function cuentasPara(miembro, rutaJson) {
    return miembro ? deps.cuentasMiembro(miembro) : cuentasJson(rutaJson);
}

// Clave de shinedust_fast: en la comunidad lleva el usuario delante (dos miembros pueden tener una
// cuenta con el mismo nombre de archivo).
function claveDust(miembro, archivoJson) {
    return miembro ? `ml:${miembro}:${archivoJson}` : archivoJson;
}

// Para /shinedust: mezcla la lista de Kevin con los valores ⚡ (ver comentario de arriba).
async function mezclarShinedust(resultados, rutaJson) {
    if (!deps || resultados === null) return resultados;
    // Comunidad: las cuentas y los valores ⚡ son los del miembro (su resumen, claves ml:<id>:...).
    const miembro = deps.usuarioComunidad?.() || null;
    let filas;
    try { filas = await filasDust(); } catch (e) { return resultados; }
    if (!filas.size) return resultados;
    const porArchivo = new Map((resultados || []).map(r => [r.archivoJson, r]));
    for (const c of cuentasPara(miembro, rutaJson)) {
        const f = filas.get(claveDust(miembro, c.archivoJson));
        if (!f) continue;
        let r = porArchivo.get(c.archivoJson);
        if (!r && (f.valor !== null || f.estado === 'login_failed')) {
            r = { nombreCuenta: c.nombreCuenta, valor: f.valor ?? c.valorJson ?? 0, fileNameXml: c.fileNameXml, archivoJson: c.archivoJson };
            porArchivo.set(c.archivoJson, r);
        }
        if (!r) continue;
        r.regalos = f.regalos || 0;
        r.estado = f.estado || null;
        r.error = f.error || null;
        const kevinCambio = c.valorJson !== null && f.valor_json !== null && c.valorJson !== f.valor_json;
        if (!kevinCambio && f.valor !== null) r.valor = f.valor;
    }
    return [...porArchivo.values()].sort((a, b) => b.valor - a.valor);
}

function filaBotonesDust(guildId, pagina) {
    if (!habilitado(guildId)) return null;
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`fast_dust_one::${pagina}`).setLabel('⚡ Refresh one').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`fast_dust_page::${pagina}`).setLabel('⚡ Refresh this page').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('fast_dust_all').setLabel('⚡ Refresh all').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`fast_dust_claim::${pagina}`).setLabel('🎁 Claim this page').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('fast_bulk').setLabel('📦 Bulk trade').setStyle(ButtonStyle.Primary)
    );
}

function correrDust(runId, cuentas, alEvento, cobrar = false) {
    return new Promise(resolve => {
        const archivoCuentas = path.join(os.tmpdir(), `fast_dust_${runId}.json`);
        fs.writeFileSync(archivoCuentas, JSON.stringify(cuentas));
        const python = process.env.FAST_TRANSFER_PYTHON || 'python';
        const corrida = corridas.get(runId);
        const hijo = spawn(python, ['-X', 'utf8', RUTA_SCRIPT_DUST, '--engine-dir', rutaMotor(),
            '--accounts-file', archivoCuentas, '--delay', String(DUST_DELAY_S), '--stop-file', corrida.stopFile, '--with-cards', '--with-gifts',
            ...(cobrar ? ['--claim'] : [])], {
            cwd: rutaMotor(), windowsHide: true,
            env: { ...process.env, UTLS_PROXY: '1', PYTHONIOENCODING: 'utf-8' }
        });
        corrida.hijo = hijo;
        let resto = '';
        const procesar = linea => {
            if (linea.startsWith('@@FD ')) { try { alEvento(JSON.parse(linea.slice(5))); } catch (e) { /* ignorar */ } }
        };
        const leer = buf => {
            resto += buf.toString('utf8');
            const partes = resto.split(/\r?\n/);
            resto = partes.pop();
            partes.forEach(procesar);
        };
        hijo.stdout.on('data', leer);
        hijo.stderr.on('data', leer);
        hijo.on('error', () => {});
        hijo.on('close', () => {
            if (resto) procesar(resto);
            try { fs.unlinkSync(archivoCuentas); } catch (e) { /* nada */ }
            resolve();
        });
    });
}

// ---- Sincronizar cartas (2026-10-24, a partir del sync_cards.py del bot de Miguel) ----
// Los JSON del bot de Kevin/Leanny NO se tocan nunca (pedido de Ale: Leanny puede reconstruirlos
// desde cero, como le paso a wr98, y una edicion nuestra se mezclaria o se perderia). Lo que el juego
// dice que la cuenta tiene se guarda como AJUSTE aparte:
//   notOwned = cartas del JSON que la cuenta ya no tiene (se tradearon/regalaron fuera del bot)
//   extra    = cartas que tiene en el juego y el JSON no conoce (recibidas en trades)
// Comunidad: en el archivo propio de Monitor Link en la PC del miembro (monitor_link.json).
// Servidor propio: en la base de esta PC (tabla ajustes_cuentas). Las copias que se muestran son las
// del JSON + estos ajustes - lo ya transferido. (El juego no manda cuantas copias hay, solo cuales.)
function diferenciaColeccion(copiasJson, cartasJuego) {
    const enJuego = new Set(cartasJuego);
    return {
        notOwned: Object.keys(copiasJson).filter(id => !enJuego.has(id)),
        extra: [...enJuego].filter(id => !copiasJson[id])
    };
}

let rutaJsonActual = null;  // la de esta PC (servidor propio); se fija en manejarDust

async function actualizarColeccion(cuenta, ev, miembro, rutaJson) {
    if (miembro) {
        const copias = deps.cartasCrudasMiembro(miembro, cuenta.fileNameXml);
        if (!copias) return;
        await deps.anotarAjusteMiembro(miembro, cuenta.fileNameXml, { tipo: 'sync', ...diferenciaColeccion(copias, ev.cards) });
        return;
    }
    if (!rutaJson) return;
    const data = leerJson(path.join(rutaJson, cuenta.archivoJson));
    if (!data) return;
    const copias = {};
    for (const p of data.pulls || []) for (const id of p.cards || []) copias[id] = (copias[id] || 0) + 1;
    await deps.guardarAjusteLocal(cuenta.fileNameXml, diferenciaColeccion(copias, ev.cards));
}

async function guardarDust(cuenta, ev, miembro = null) {
    await deps.db.run(
        `INSERT INTO shinedust_fast (archivo_json, valor, tickets, ts, valor_json, inventario, regalos, estado, error) VALUES (?, ?, ?, ?, ?, ?, ?, 'ok', NULL)
         ON CONFLICT(archivo_json) DO UPDATE SET valor = excluded.valor, tickets = excluded.tickets, ts = excluded.ts, valor_json = excluded.valor_json,
            inventario = excluded.inventario, regalos = excluded.regalos, estado = 'ok', error = NULL`,
        [claveDust(miembro, cuenta.archivoJson), ev.dust, ev.tickets, Date.now(), cuenta.valorJson, JSON.stringify(ev.inv || {}),
            typeof ev.gifts === 'number' ? ev.gifts : null]
    );
}

async function marcarSinEntrar(cuenta, motivo, miembro = null) {
    await deps.db.run(
        `INSERT INTO shinedust_fast (archivo_json, ts, valor_json, estado, error) VALUES (?, ?, ?, 'login_failed', ?)
         ON CONFLICT(archivo_json) DO UPDATE SET ts = excluded.ts, estado = 'login_failed', error = excluded.error`,
        [claveDust(miembro, cuenta.archivoJson), Date.now(), cuenta.valorJson, String(motivo || '').slice(0, 200)]
    );
}

// Corre el refresco de una lista de cuentas en la cola compartida. alProgreso recibe el estado.
async function refrescarDust(runId, cuentas, alProgreso, miembro = null, opciones = {}) {
    await asegurarTablaDust();
    const estado = { total: cuentas.length, hechas: 0, ok: 0, fallas: 0, ultimo: null, errores: [], inicio: Date.now(),
        cobrados: { gifts: 0, missions: 0 }, sinEntrar: 0 };
    let limpiar = () => {};
    enCola++;
    const turno = cola.then(async () => {
        if (corridas.get(runId)?.detenido) return;
        if (!(await puertoAbierto(PUERTO_TUNEL)) && !(await asegurarTunel())) {
            estado.errores.push('Could not start the tunnel (port 9090)');
            return;
        }
        const porClave = new Map(cuentas.map(c => [c.archivoJson, c]));
        const traidas = await prepararXmls(miembro, cuentas.map(c => c.fileNameXml), runId);
        limpiar = traidas.limpiar;
        if (traidas.error) {
            estado.hechas = estado.fallas = cuentas.length;
            estado.errores.push(traidas.error);
            return;
        }
        const xmls = traidas.mapa;
        const lista = [];
        for (const c of cuentas) {
            const xml = rutaXmlDe(xmls, c.fileNameXml);
            if (xml) lista.push({ key: c.archivoJson, xml });
            else { estado.hechas++; estado.fallas++; estado.errores.push(`${c.nombreCuenta}: XML not found`); }
        }
        let edicion = Promise.resolve();
        await correrDust(runId, lista, ev => {
            if (ev.claimed) { estado.cobrados.gifts += ev.claimed.gifts || 0; estado.cobrados.missions += ev.claimed.missions || 0; }
            if (!ev.key) return;
            const cuenta = porClave.get(ev.key);
            estado.hechas++;
            if (ev.state === 'ok') {
                estado.ok++;
                estado.ultimo = { nombre: cuenta?.nombreCuenta || ev.key, antes: cuenta?.valorJson, dust: ev.dust, tickets: ev.tickets, inv: ev.inv || {} };
                edicion = edicion.then(() => guardarDust(cuenta, ev, miembro)).catch(() => {});
                // Coleccion real del juego -> JSON de la cuenta (sincronizar cartas).
                if (Array.isArray(ev.cards) && ev.cards.length) {
                    edicion = edicion.then(() => actualizarColeccion(cuenta, ev, miembro, rutaJsonActual))
                        .catch(e => console.error('DEBUG: sincronizar cartas:', e?.message || e));
                }
            } else {
                estado.fallas++;
                if (estado.errores.length < 30) estado.errores.push(`${cuenta?.nombreCuenta || ev.key}: ${ev.msg || 'failed'}`);
                // No pudo entrar al juego y no es algo pasajero (hora, IP, tunel, red): queda marcada ⛔.
                if (cuenta && ev.transient === false) {
                    estado.sinEntrar++;
                    edicion = edicion.then(() => marcarSinEntrar(cuenta, ev.msg, miembro)).catch(() => {});
                }
            }
            alProgreso(estado, false);
        }, !!opciones.cobrar);
        await edicion;
    }).catch(e => {
        console.error('DEBUG: Fast Shinedust error:', e);
    }).finally(() => {
        enCola = Math.max(0, enCola - 1);
        limpiar();
    });
    cola = turno;
    await turno;
    estado.detenido = !!corridas.get(runId)?.detenido;
    return estado;
}

function barra(hechas, total) {
    const llenos = total ? Math.round((hechas / total) * 15) : 0;
    return '▰'.repeat(llenos) + '▱'.repeat(15 - llenos);
}

async function manejarDust(interaction, idForzado = null) {
    const id = idForzado || interaction.customId;
    const rutaJson = (await deps.db.get(`SELECT webhook_url FROM configs_canales WHERE tipo = 'ruta_json_cuentas'`))?.webhook_url;
    rutaJsonActual = rutaJson;
    const miembro = deps.usuarioComunidad?.() || null;

    // Una cuenta: menu con las de la pagina actual del reporte.
    if (interaction.isButton() && id.startsWith('fast_dust_one::')) {
        const pagina = parseInt(id.split('::')[1], 10) || 0;
        await interaction.deferReply({ ephemeral: true });
        const lista = await mezclarShinedust(deps.buscarShinedustTodasCuentas(rutaJson), rutaJson);
        const pag = (lista || []).slice(pagina * 25, pagina * 25 + 25);
        if (!pag.length) {
            await interaction.editReply({ content: '❌ No accounts on this page.' });
            return true;
        }
        const menu = new StringSelectMenuBuilder()
            .setCustomId('fast_dust_pick')
            .setPlaceholder('Which account do you want to refresh?')
            .addOptions(pag.map(r => ({
                label: r.nombreCuenta.slice(0, 100),
                description: `Saved: ${r.valor.toLocaleString('en-US')}`.slice(0, 100),
                value: r.archivoJson.slice(0, 100)
            })));
        await interaction.editReply({ content: '⚡ Refresh one account — straight from the game server, no MuMu.', components: [new ActionRowBuilder().addComponents(menu)] });
        return true;
    }

    if (interaction.isStringSelectMenu() && id === 'fast_dust_pick') {
        const archivo = interaction.values[0];
        const sinXml = (n) => String(n || '').replace(/\.xml$/i, '').toLowerCase();
        const cuenta = cuentasPara(miembro, rutaJson).find(c => c.archivoJson === archivo || sinXml(c.fileNameXml) === sinXml(archivo));
        if (!cuenta) {
            await interaction.update({ content: '❌ That account\'s JSON file is gone.', components: [] });
            return true;
        }
        await interaction.update({ content: `⏳ Refreshing **${cuenta.nombreCuenta}**…`, components: [] });
        const runId = `${interaction.id}`;
        corridas.set(runId, { hijo: null, detenido: false, stopFile: path.join(os.tmpdir(), `fast_dust_stop_${runId}`) });
        const estado = await refrescarDust(runId, [cuenta], () => {}, miembro);
        corridas.delete(runId);
        const mapa = (await deps.obtenerMapaEmojisGuild(interaction.guild).catch(() => ({}))) || {};
        const polvo = mapa.Polvo_iris_TCGP ? `<:Polvo_iris_TCGP:${mapa.Polvo_iris_TCGP}>` : '✨';
        const ticket = mapa.Cupon_de_tienda_TCGP ? `<:Cupon_de_tienda_TCGP:${mapa.Cupon_de_tienda_TCGP}>` : '🎟️';
        let texto;
        if (estado.ok) {
            const u = estado.ultimo;
            const antes = typeof u.antes === 'number' ? `${u.antes.toLocaleString('en-US')} → ` : '';
            // Mismo orden y emojis que el inventario del bot normal (ETIQUETAS_INVENTARIO), sin
            // Poke Gold: el juego no lo manda por esta via, sigue saliendo del OCR de MuMu.
            const lineasInv = [];
            for (const [clave, emoji, etiqueta] of (deps.etiquetasInventario?.() || [])) {
                if (clave.startsWith('pokegold') || typeof u.inv[clave] !== 'number') continue;
                const tag = mapa[emoji] ? `<:${emoji}:${mapa[emoji]}> ` : '';
                lineasInv.push(`${tag}${etiqueta}: **${u.inv[clave].toLocaleString('en-US')}**`);
            }
            texto = `${icono('ok', mapa)} **${u.nombre}**${u.inv.level ? ` (Lv. ${u.inv.level})` : ''}\n` +
                `${polvo} Shinedust: ${antes}**${u.dust.toLocaleString('en-US')}**\n` +
                (lineasInv.length ? lineasInv.join('\n') : `${ticket} Shop Ticket: **${u.tickets}**`) +
                `\n\n*Poké Gold isn't sent by the game this way — it still comes from the normal MuMu check.*`;
        } else {
            texto = `${icono('error', mapa)} **${cuenta.nombreCuenta}** — ${estado.errores[0] || 'failed'}`;
        }
        // El resultado queda a la vista de todos en el canal (pedido de Ale); la lista y los menus
        // siguen privados. Si fallo, el aviso queda solo para quien lo pidio.
        if (estado.ok && interaction._shinedustAlHistorial) {
            // Desde una carta: el resultado se ve aca (como antes) y queda de historial en el canal
            // 🍬 Shinedust, a la vista de todos.
            await interaction.editReply({ content: texto, components: [] });
            const canal = await deps.obtenerCanalComando(interaction.guildId, 'shinedust');
            if (canal?.webhook_url) {
                await new WebhookClient({ url: canal.webhook_url }).send({
                    content: `<@${interaction.user.id}>, here's your account! 🍬\n${texto}`, allowedMentions: { users: [interaction.user.id] }
                }).catch(e => console.error('DEBUG: historial de Shinedust:', e?.message || e));
            }
        } else if (estado.ok) {
            const publicado = await interaction.followUp({ content: `<@${interaction.user.id}>, here's your account! 🍬\n${texto}`, allowedMentions: { users: [interaction.user.id] } }).catch(() => null);
            await interaction.editReply({ content: publicado ? '✅ Posted in the channel.' : texto, components: [] });
        } else {
            await interaction.editReply({ content: texto, components: [] });
        }
        return true;
    }

    // Todas: confirmacion con cantidad y tiempo estimado.
    if (interaction.isButton() && id === 'fast_dust_all') {
        await interaction.deferReply({ ephemeral: true });
        const filas = await filasDust();
        const todas = cuentasPara(miembro, rutaJson);
        const pendientes = todas.filter(c => !(filas.get(claveDust(miembro, c.archivoJson))?.ts > Date.now() - DUST_SALTAR_SI_MENOS_DE_MS));
        const min = Math.ceil((pendientes.length * DUST_SEG_POR_CUENTA) / 60);
        await interaction.editReply({
            content: `⚡ **Refresh all** — **${pendientes.length}** of ${todas.length} account(s)` +
                (todas.length > pendientes.length ? ` (${todas.length - pendientes.length} already refreshed in the last 24 h are skipped)` : '') +
                `.\n⏱️ About **${min} min**. Every login goes out from your home IP, one at a time.\nYou can cancel at any moment.`,
            components: pendientes.length ? [new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('fast_dust_all_go').setLabel('▶️ Start').setStyle(ButtonStyle.Success)
            )] : []
        });
        return true;
    }

    if (interaction.isButton() && id === 'fast_dust_all_go') {
        await interaction.update({ content: '▶️ Started — the progress is in the channel.', components: [] });
        const filas = await filasDust();
        const pendientes = cuentasPara(miembro, rutaJson).filter(c => !(filas.get(claveDust(miembro, c.archivoJson))?.ts > Date.now() - DUST_SALTAR_SI_MENOS_DE_MS));
        await correrLoteDust(interaction, pendientes, 'all accounts');
        return true;
    }

    // Pagina actual del reporte (pedido de Ale): las 25 cuentas que se estan viendo, todas.
    if (interaction.isButton() && id.startsWith('fast_dust_page::')) {
        const pagina = parseInt(id.split('::')[1], 10) || 0;
        const lista = await mezclarShinedust(deps.buscarShinedustTodasCuentas(rutaJson), rutaJson);
        const claves = new Set((lista || []).slice(pagina * 25, pagina * 25 + 25).map(r => r.archivoJson));
        const cuentas = cuentasPara(miembro, rutaJson).filter(c => claves.has(c.archivoJson));
        if (!cuentas.length) {
            await interaction.reply({ content: '❌ No accounts on this page.', ephemeral: true });
            return true;
        }
        await interaction.reply({ content: `▶️ Refreshing page ${pagina + 1} (${cuentas.length} accounts, about ${Math.ceil(cuentas.length * DUST_SEG_POR_CUENTA / 60)} min) — the progress is in the channel.`, ephemeral: true });
        await correrLoteDust(interaction, cuentas, `page ${pagina + 1}`, pagina);
        return true;
    }

    // 🎁 Claim this page: refresca las cuentas de la pagina cobrando regalos y misiones.
    if (interaction.isButton() && id.startsWith('fast_dust_claim::')) {
        const pagina = parseInt(id.split('::')[1], 10) || 0;
        const lista = await mezclarShinedust(deps.buscarShinedustTodasCuentas(rutaJson), rutaJson);
        const claves = new Set((lista || []).slice(pagina * 25, pagina * 25 + 25).map(r => r.archivoJson));
        const cuentas = cuentasPara(miembro, rutaJson).filter(c => claves.has(c.archivoJson));
        if (!cuentas.length) {
            await interaction.reply({ content: '❌ No accounts on this page.', ephemeral: true });
            return true;
        }
        await interaction.reply({ content: `🎁 Claiming gifts and missions on page ${pagina + 1} (${cuentas.length} accounts) — the progress is in the channel.`, ephemeral: true });
        await correrLoteDust(interaction, cuentas, `🎁 claim page ${pagina + 1}`, pagina, { cobrar: true });
        return true;
    }

    if (interaction.isButton() && id.startsWith('fast_dust_stop::')) {
        const corrida = corridas.get(id.replace('fast_dust_stop::', ''));
        if (corrida) {
            corrida.detenido = true;
            try { fs.writeFileSync(corrida.stopFile, 'stop'); } catch (e) { /* nada */ }
        }
        await interaction.deferUpdate();
        return true;
    }
    return false;
}

// Lote de cuentas (todas o una pagina) con un mensaje de progreso en el canal y Cancel.
async function correrLoteDust(interaction, pendientes, titulo, paginaVolver = 0, opciones = {}) {
    {
        const runId = `${interaction.id}`;
        const stopFile = path.join(os.tmpdir(), `fast_dust_stop_${runId}`);
        try { fs.unlinkSync(stopFile); } catch (e) { /* no existia */ }
        corridas.set(runId, { hijo: null, detenido: false, stopFile });
        const mapa = (await deps.obtenerMapaEmojisGuild(interaction.guild).catch(() => ({}))) || {};
        const polvo = mapa.Polvo_iris_TCGP ? `<:Polvo_iris_TCGP:${mapa.Polvo_iris_TCGP}>` : '✨';
        const filaCancel = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`fast_dust_stop::${runId}`).setLabel('✖️ Cancel').setStyle(ButtonStyle.Danger)
        );
        const armar = (estado, final) => {
            const seg = (Date.now() - estado.inicio) / 1000;
            const resta = estado.hechas ? Math.round(((estado.total - estado.hechas) * seg / estado.hechas) / 60) : null;
            const lineas = [
                `${barra(estado.hechas, estado.total)}  **${estado.hechas}/${estado.total}**`,
                `${icono('ok', mapa)} ${estado.ok}   ${icono('error', mapa)} ${estado.fallas}` + (!final && resta !== null ? `   ⏱️ ~${resta} min left` : '')
            ];
            if (estado.ultimo) lineas.push('', `Last: **${estado.ultimo.nombre}** — ${polvo} ${estado.ultimo.dust.toLocaleString('en-US')}`);
            if (estado.cobrados && (estado.cobrados.gifts || estado.cobrados.missions)) {
                lineas.push(`🎁 Claimed: **${estado.cobrados.gifts}** gift(s) · **${estado.cobrados.missions}** mission(s)`);
            }
            if (estado.sinEntrar) lineas.push(`⛔ **${estado.sinEntrar}** account(s) could not log in (banned or deleted?)`);
            if (final) {
                lineas.push('', estado.detenido ? `🚫 Cancelled — ${estado.ok} account(s) were refreshed and saved.` : `🎉 Done in ${Math.round(seg / 60)} min.`);
                if (estado.errores.length) lineas.push('', '**Failed:**', ...estado.errores.slice(0, 10).map(e => `• ${e}`));
            }
            return new EmbedBuilder().setTitle(`${polvo} ⚡ Refresh Shinedust — ${titulo}`).setColor(final ? (estado.detenido ? 0x95A5A6 : 0x2ECC71) : 0xE91E63)
                .setDescription(lineas.join('\n').slice(0, 4000));
        };
        // Mensaje propio del bot en el canal: se puede editar todo lo que dure (el de la
        // interaccion vence a los 15 min y esto puede tardar mas de una hora).
        const msg = await interaction.channel.send({ embeds: [armar({ total: pendientes.length, hechas: 0, ok: 0, fallas: 0, errores: [], inicio: Date.now() }, false)], components: [filaCancel] });
        let ultimaEdicion = 0;
        const miembro = deps.usuarioComunidad?.() || null;
        const estado = await refrescarDust(runId, pendientes, (est) => {
            if (Date.now() - ultimaEdicion < 4000) return; // Discord limita la frecuencia de ediciones
            ultimaEdicion = Date.now();
            msg.edit({ embeds: [armar(est, false)], components: [filaCancel] }).catch(() => {});
        }, miembro, opciones);
        corridas.delete(runId);
        try { fs.unlinkSync(stopFile); } catch (e) { /* nada */ }
        await msg.edit({ embeds: [armar(estado, true)], components: [new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`shinedust_reporte::${paginaVolver}`).setLabel('🔄 Show updated list').setStyle(ButtonStyle.Secondary)
        )] }).catch(() => {});
    }
}

// ======================== 📦 Bulk trade (2026-10-24, god packs) ========================
// Elegir una cuenta (las que tienen mas cartas raras primero), marcar varias cartas raras y el
// destino: un solo login y una sola amistad, y las cartas se tradean una tras otra (cada trade lo
// acepta la Main en el juego, ofreciendo una carta a cambio).
const bulkPendientes = new Map();   // clave -> { userId, fileName, cartas, ts }

function cartasDeCuenta(miembro, rutaJson, fileNameXml) {
    if (miembro) return deps.cartasMiembro(miembro, fileNameXml) || {};
    const c = cuentasJson(rutaJson).find(x => String(x.fileNameXml).toLowerCase() === String(fileNameXml).toLowerCase());
    const data = c ? leerJson(path.join(rutaJson, c.archivoJson)) : null;
    const copias = {};
    for (const p of data?.pulls || []) for (const id of p.cards || []) copias[id] = (copias[id] || 0) + 1;
    return copias;
}

function rarasTradeables(miembro, rutaJson, rutaMaster, fileNameXml) {
    return Object.entries(cartasDeCuenta(miembro, rutaJson, fileNameXml))
        .map(([id, n]) => ({ id, n, ...deps.infoCartaBulk(id, rutaMaster) }))
        .filter(c => c.rara && c.tradeable);
}

async function manejarBulk(interaction) {
    const id = interaction.customId;
    const miembro = deps.usuarioComunidad?.() || null;
    const rutaJson = (await deps.db.get(`SELECT webhook_url FROM configs_canales WHERE tipo = 'ruta_json_cuentas'`))?.webhook_url;
    const rutaMaster = deps.rutaMaster ? await deps.rutaMaster() : null;

    // 1. Cuenta: las que tienen mas cartas raras tradeables primero (los god packs arriba).
    if (interaction.isButton() && id === 'fast_bulk') {
        await interaction.deferReply({ ephemeral: true });
        const cuentas = cuentasPara(miembro, rutaJson)
            .map(c => ({ c, raras: rarasTradeables(miembro, rutaJson, rutaMaster, c.fileNameXml).length }))
            .filter(x => x.raras > 0)
            .sort((a, b) => b.raras - a.raras)
            .slice(0, 25);
        if (!cuentas.length) {
            await interaction.editReply({ content: '❌ No account has rare tradeable cards (1★ or more).' });
            return true;
        }
        const menu = new StringSelectMenuBuilder().setCustomId('fast_bulk_cuenta').setPlaceholder('Which account? (most rare cards first)')
            .addOptions(cuentas.map(x => ({ label: x.c.nombreCuenta.slice(0, 100), description: `${x.raras} rare tradeable card(s)`, value: x.c.fileNameXml.slice(0, 100) })));
        await interaction.editReply({ content: '📦 **Bulk trade** — pick the account:', components: [new ActionRowBuilder().addComponents(menu),
            new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('sub_volver').setLabel('⬅️ Back').setStyle(ButtonStyle.Secondary))] });
        return true;
    }

    // 2. Cartas (varias)
    if (interaction.isStringSelectMenu() && id === 'fast_bulk_cuenta') {
        const fileName = interaction.values[0];
        const raras = rarasTradeables(miembro, rutaJson, rutaMaster, fileName).slice(0, 25);
        const clave = `${interaction.user.id}:${Date.now().toString(36)}`;
        bulkPendientes.set(clave, { userId: interaction.user.id, fileName, cartas: [], ts: Date.now() });
        const menu = new StringSelectMenuBuilder().setCustomId(`fast_bulk_cartas::${clave}`).setPlaceholder('Which cards? (you can pick several)')
            .setMinValues(1).setMaxValues(raras.length)
            .addOptions(raras.map(c => ({ label: `${c.nombre}`.slice(0, 100), description: `${c.tipo} · x${c.n}`.slice(0, 100), value: c.id })));
        await interaction.update({ content: `📦 **${fileName}** — pick the cards to trade:`, components: [new ActionRowBuilder().addComponents(menu),
            new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('sub_volver').setLabel('⬅️ Back').setStyle(ButtonStyle.Secondary))] });
        return true;
    }

    // 3. Destino
    if (interaction.isStringSelectMenu() && id.startsWith('fast_bulk_cartas::')) {
        const clave = id.split('::')[1];
        const p = bulkPendientes.get(clave);
        if (!p) { await interaction.update({ content: '⏱️ This expired — start again.', components: [] }); return true; }
        p.cartas = interaction.values;
        const destinos = (await deps.destinosTrade(interaction)) || [];
        if (!destinos.length) {
            await interaction.update({ content: interaction._sinDestinosMsg || '❌ No destination found (register your Main first).', components: [] });
            return true;
        }
        const menu = new StringSelectMenuBuilder().setCustomId(`fast_bulk_destino::${clave}`).setPlaceholder('Trade them to…')
            .addOptions(destinos.slice(0, 25).map(d => ({ label: `${d.label || d.id}`.slice(0, 100), description: String(d.id).slice(0, 100), value: String(d.id) })));
        await interaction.update({ content: `📦 **${p.cartas.length}** card(s) from **${p.fileName}** — who receives them?`, components: [new ActionRowBuilder().addComponents(menu),
            new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('sub_volver').setLabel('⬅️ Back').setStyle(ButtonStyle.Secondary))] });
        return true;
    }

    // ⚡ Gold trade (desde una carta de Gold Cards): la MISMA carta varias veces, desde una cuenta que
    // tiene muchas copias. 1) cuenta  2) cuantas copias  3) destino (el mismo paso 4 de Bulk trade).
    if (interaction.isButton() && id.startsWith('fast_gold::')) {
        const cartaId = id.slice('fast_gold::'.length);
        await interaction.deferReply({ ephemeral: true });
        const cuentas = (await deps.cuentasGoldDe(interaction.user.id, cartaId)) || [];
        if (!cuentas.length) {
            await interaction.editReply({ content: '❌ No account has enough copies of this card.' });
            return true;
        }
        const menu = new StringSelectMenuBuilder().setCustomId(`fast_gold_cuenta::${cartaId}`.slice(0, 100)).setPlaceholder('From which account?')
            .addOptions(cuentas.slice(0, 25).map(c => ({ label: c.fileName.slice(0, 100),
                description: (`x${c.cantidad} available` + (c.transferidas ? ` (${c.transferidas} already traded)` : '')).slice(0, 100),
                value: `${c.fileName}::${c.cantidad}`.slice(0, 100) })));
        await interaction.editReply({ content: `⚡ **Gold trade** — ${deps.infoCartaBulk(cartaId, rutaMaster).nombre}: pick the account:`, components: [new ActionRowBuilder().addComponents(menu),
            new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('sub_volver').setLabel('⬅️ Back').setStyle(ButtonStyle.Secondary))] });
        return true;
    }

    if (interaction.isStringSelectMenu() && id.startsWith('fast_gold_cuenta::')) {
        const cartaId = id.slice('fast_gold_cuenta::'.length);
        const [fileName, cantidadTxt] = interaction.values[0].split('::');
        const cantidad = Math.max(1, parseInt(cantidadTxt, 10) || 1);
        const clave = `${interaction.user.id}:${Date.now().toString(36)}`;
        bulkPendientes.set(clave, { userId: interaction.user.id, fileName, cartaId, cartas: [], ts: Date.now() });
        // De mayor a menor: la primera opcion es mandarlas todas (las que pidio el umbral de Gold Cards).
        const opciones = Array.from({ length: Math.min(cantidad, 25) }, (_, i) => Math.min(cantidad, 25) - i)
            .map(n => ({ label: `${n} ${n === 1 ? 'copy' : 'copies'}`, description: n === cantidad ? 'all of them' : `keeps ${cantidad - n}`, value: String(n) }));
        const menu = new StringSelectMenuBuilder().setCustomId(`fast_gold_copias::${clave}`).setPlaceholder('How many copies?').addOptions(opciones);
        await interaction.update({ content: `⚡ **${fileName}** has **x${cantidad}** — how many copies to trade?`, components: [new ActionRowBuilder().addComponents(menu),
            new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('sub_volver').setLabel('⬅️ Back').setStyle(ButtonStyle.Secondary))] });
        return true;
    }

    if (interaction.isStringSelectMenu() && id.startsWith('fast_gold_copias::')) {
        const clave = id.split('::')[1];
        const p = bulkPendientes.get(clave);
        if (!p) { await interaction.update({ content: '⏱️ This expired — start again.', components: [] }); return true; }
        p.cartas = Array(parseInt(interaction.values[0], 10) || 1).fill(p.cartaId);
        const destinos = (await deps.destinosTrade(interaction)) || [];
        if (!destinos.length) {
            await interaction.update({ content: interaction._sinDestinosMsg || '❌ No destination found (register your Main first).', components: [] });
            return true;
        }
        const menu = new StringSelectMenuBuilder().setCustomId(`fast_bulk_destino::${clave}`).setPlaceholder('Trade them to…')
            .addOptions(destinos.slice(0, 25).map(d => ({ label: `${d.label || d.id}`.slice(0, 100), description: String(d.id).slice(0, 100), value: String(d.id) })));
        await interaction.update({ content: `⚡ **${p.cartas.length}** copies from **${p.fileName}** — who receives them?`, components: [new ActionRowBuilder().addComponents(menu),
            new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('sub_volver').setLabel('⬅️ Back').setStyle(ButtonStyle.Secondary))] });
        return true;
    }

    // 4. A correr
    if (interaction.isStringSelectMenu() && id.startsWith('fast_bulk_destino::')) {
        const clave = id.split('::')[1];
        const p = bulkPendientes.get(clave);
        bulkPendientes.delete(clave);
        if (!p) { await interaction.update({ content: '⏱️ This expired — start again.', components: [] }); return true; }
        await interaction.update({ content: '▶️ Starting the bulk trade…', components: [] });
        await ejecutarBulk(interaction, { fileName: p.fileName, cartas: p.cartas, friendId: interaction.values[0], miembro, rutaMaster });
        return true;
    }
    return false;
}

async function ejecutarBulk(interaction, { fileName, cartas, friendId, miembro, rutaMaster }) {
    const runId = `${interaction.id}`;
    const mapa = (await deps.obtenerMapaEmojisGuild(interaction.guild).catch(() => ({}))) || {};
    const stopFile = path.join(os.tmpdir(), `fast_transfer_stop_${runId}`);
    try { fs.unlinkSync(stopFile); } catch (e) { /* no existia */ }
    corridas.set(runId, { hijo: null, detenido: false, stopFile });
    const nombre = (id) => deps.infoCartaBulk(id, rutaMaster).nombre;
    const estados = cartas.map(c => ({ carta: c, icono: '⏳', msg: '' }));
    let indice = -1;
    let paso = 'Logging in…';
    let final = null;
    const filaCancel = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`fast_stop::${runId}`).setLabel('✖️ Cancel').setStyle(ButtonStyle.Danger));
    const pintar = () => {
        const lineas = estados.map((e, i) => `${e.icono} **${nombre(e.carta)}**${cartas.length > 1 && new Set(cartas).size < cartas.length ? ` #${i + 1}` : ''}${e.msg ? ` — ${e.msg}` : ''}`);
        const ok = estados.filter(e => e.icono === icono('ok', mapa)).length;
        const embed = new EmbedBuilder().setTitle(`📦 Bulk trade — ${fileName}`).setColor(final ? (ok ? 0x2ECC71 : 0xE74C3C) : 0xF0A93A)
            .setDescription([...lineas, '', final || `👉 ${paso}`].join('\n').slice(0, 4000));
        return interaction.editReply({ content: '', embeds: [embed], components: final ? [] : [filaCancel] }).catch(() => {});
    };
    enCola++;
    if (enCola > 1) { paso = `🕒 Queued — position #${enCola - 1}`; await pintar(); }
    const limpiezas = [];
    const turno = cola.then(async () => {
        if (corridas.get(runId).detenido) { final = '🚫 Cancelled'; return; }
        paso = miembro ? 'Getting the account from your Monitor Link…' : 'Logging in…';
        await pintar();
        const xmls = await prepararXmls(miembro, [fileName], runId);
        limpiezas.push(xmls.limpiar);
        const rutaXml = rutaXmlDe(xmls.mapa, fileName);
        if (!rutaXml) { final = `${icono('error', mapa)} ${xmls.error || `${fileName} not found`}`; return; }
        if (!(await puertoAbierto(PUERTO_TUNEL)) && !(await asegurarTunel())) { final = `${icono('error', mapa)} Could not start the tunnel (port 9090)`; return; }
        const args = ['--engine-dir', rutaMotor(), '--xml', rutaXml, '--card-ids', cartas.join(','), '--target', friendId, '--mode', 'trade', '--stop-file', stopFile];
        if (process.env.FAST_TRANSFER_PROXY_FILE) args.push('--proxy-file', process.env.FAST_TRANSFER_PROXY_FILE);
        let edicion = Promise.resolve();
        const { resultado } = await correrMotor(runId, args, ev => {
            if (ev.step === 'card') {
                if (ev.state === 'start') { indice++; if (estados[indice]) estados[indice].icono = '🔄'; }
                else if (estados[indice]) estados[indice].icono = icono(ev.state === 'ok' ? 'ok' : 'error', mapa);
            } else if (ev.state === 'error') {
                if (estados[indice]) estados[indice].msg = ev.msg || 'failed';
                else paso = ev.msg || 'failed';
            } else if (ev.msg) {
                paso = ev.msg;
            } else if (ev.step === 'friend_request' && ev.state === 'start') {
                paso = 'Sending the friend request…';
            }
            edicion = edicion.then(pintar);
        });
        await edicion;
        for (const r of resultado?.results || []) {
            if (!r.ok) continue;
            await deps.registrarTransferenciaCarta(fileName, r.card, 'main', interaction.user.id, friendId).catch(() => {});
            if (miembro) await deps.anotarAjusteMiembro(miembro, fileName, { tipo: 'traded', card: r.card, n: 1 }).catch(e => console.error('DEBUG: ajuste de trade:', e?.message || e));
        }
        const ok = (resultado?.results || []).filter(r => r.ok).length;
        if (cartas.length === 1 && estados[0]) estados[0].icono = icono(resultado?.success ? 'ok' : 'error', mapa);
        final = corridas.get(runId)?.detenido ? `🚫 Cancelled — ${ok} traded` : `🎉 Done — **${ok}/${cartas.length}** traded`;
    }).catch(e => {
        console.error('DEBUG: Bulk trade error:', e);
        final = `${icono('error', mapa)} Something went wrong`;
    }).finally(async () => {
        enCola = Math.max(0, enCola - 1);
        corridas.delete(runId);
        limpiezas.forEach(f => f());
        try { fs.unlinkSync(stopFile); } catch (e) { /* nada */ }
        await pintar();
    });
    cola = turno;
    return turno;
}

// Devuelve true si la interaccion era de Fast Transfer (bot.js deja de procesarla).
async function manejarInteraccion(interaction) {
    const id = interaction.customId || '';
    if (id.startsWith('fast_bulk') || id.startsWith('fast_gold')) {
        if (!habilitado(interaction.guildId)) {
            await interaction.reply({ content: '❌ Fast trades are not available here.', ephemeral: true });
            return true;
        }
        return await manejarBulk(interaction);
    }
    if (id.startsWith('fast_dust')) {
        if (!habilitado(interaction.guildId)) {
            await interaction.reply({ content: '❌ Fast Shinedust is not available here.', ephemeral: true });
            return true;
        }
        return await manejarDust(interaction);
    }
    if (!interaction.isButton()) return false;
    if (id.startsWith('fast_stop::')) {
        const corrida = corridas.get(id.replace('fast_stop::', ''));
        if (!corrida) {
            await interaction.reply({ content: 'This run already finished.', ephemeral: true });
            return true;
        }
        // Cancel ordenado: el script ve el archivo, corta la espera y deshace lo empezado
        // (trade abierto, solicitud de amistad, amistad). Si en 60 s no termino, se mata.
        corrida.detenido = true;
        try { fs.writeFileSync(corrida.stopFile, 'stop'); } catch (e) { /* sigue con el kill */ }
        const hijo = corrida.hijo;
        if (hijo?.pid) {
            setTimeout(() => {
                if (hijo.exitCode === null) spawnSync('taskkill', ['/PID', String(hijo.pid), '/T', '/F'], { windowsHide: true });
            }, 60000);
        }
        // Sin mensaje aparte: se quita el boton del mismo progreso y el script muestra
        // "Cancelling…" y despues lo que deshizo.
        await interaction.update({ components: [] });
        return true;
    }
    if (id.startsWith('fast_farm_stop::')) {
        const corrida = corridas.get(id.replace('fast_farm_stop::', ''));
        if (corrida) {
            // Termina la cuenta en curso y no sigue con las demas.
            corrida.detenido = true;
            try { fs.writeFileSync(corrida.stopFile, 'stop'); } catch (e) { /* nada */ }
        }
        await interaction.deferUpdate();
        return true;
    }
    if (id.startsWith('fast_farm::')) {
        if (!habilitado(interaction.guildId)) {
            await interaction.reply({ content: '❌ Fast Farm is not available here.', ephemeral: true });
            return true;
        }
        await interaction.deferUpdate();
        ejecutarFarm(interaction, id.replace('fast_farm::', ''));
        return true;
    }
    if (id.startsWith('fast_det::')) {
        const [, tipo, fileName, friendId, antes, ts, recibida] = id.split('::');
        const nombreDestino = (await Promise.resolve(deps.nombreAmigo?.(interaction.guildId, friendId, interaction.user?.id)).catch(() => null))
            || (tipo === 'f' ? 'your friend' : 'your Main');
        const lineas = [
            `⚡ Type: ${tipo === 's' ? 'Fast Share' : 'Fast Trade'}`,
            `📄 Account: \`${fileName}\``
        ];
        if (antes !== '') lineas.push(`📦 Quantity: x${antes} − 1 → x${Math.max(0, Number(antes) - 1)} left`);
        lineas.push(`🏠 ${tipo === 's' ? 'Shared to' : 'Sent to'}: ${nombreDestino}`);
        if (recibida) {
            const nombreRecibida = (await Promise.resolve(deps.nombreCarta?.(recibida)).catch(() => null)) || recibida;
            lineas.push(`🎁 Received: ${nombreRecibida}`);
        }
        lineas.push(`📅 Date: <t:${parseInt(ts, 36)}:f>`);
        await interaction.reply({
            embeds: [new EmbedBuilder().setColor(0x2ECC71).setTitle('📦 Transfer details').setDescription(lineas.join('\n'))],
            ephemeral: true
        });
        return true;
    }
    if (!id.startsWith('fast_go::')) return false;
    if (!habilitado(interaction.guildId)) {
        await interaction.reply({ content: '❌ Fast Share/Trade is not available here.', ephemeral: true });
        return true;
    }
    const [, cartaId, friendId, fileName, modo] = id.split('::');
    const etiqueta = MODO_A_FAST[modo] === 'share' ? '⚡ Fast Share' : '⚡ Fast Trade';
    // Respuesta efimera: el progreso lo ve solo quien apreto el boton.
    if (interaction.message?.flags?.has(MessageFlags.Ephemeral) && id.startsWith('fast_go::') && interaction.message?.embeds?.[0]?.title?.includes('⚡ Fast')) {
        // Retry desde el mensaje privado del progreso: otro mensaje privado.
        await interaction.deferReply({ ephemeral: true });
    } else {
        // Desde el mensaje de la carta en el canal: se le sacan los menus y el Cancel (si no,
        // quedaban vivos y "Cancel" mostraba "nothing was injected" despues de un Fast exitoso)
        // y el progreso va en un mensaje privado aparte.
        await interaction.update({ content: `<@${interaction.user.id}> ${etiqueta} running — the progress is only shown to you.`, components: [] });
        const privado = await interaction.followUp({ content: '⏳ Starting…', ephemeral: true });
        interaction._fastMsgId = privado.id;
        interaction._fastCanal = etiqueta;
    }
    ejecutar(interaction, { cartaId, friendId, fileName, modo });
    return true;
}

// Hay algun ⚡ corriendo o en fila (para no reiniciar el host en medio, ver host-updater.js).
const ocupado = () => enCola > 0 || corridas.size > 0;

// 👛 Shinedust de una carta en la comunidad: la cuenta elegida se refresca con ⚡ (directo del juego,
// sin MuMu de nadie). El select trae el nombre de la XML de la cuenta.
const refrescarCuentaElegida = (interaction) => {
    interaction._shinedustAlHistorial = true;
    return manejarDust(interaction, 'fast_dust_pick');
};

// 📋 Info Accounts en la comunidad: lee en vivo (⚡, sin MuMu) el inventario de una cuenta del miembro.
// Devuelve { datos: { nombre, dust, tickets, inv } } o { error }.
async function leerInventarioCuenta(miembro, nombreXml) {
    await asegurarTablaDust();
    const sinXml = (n) => String(n || '').replace(/\.xml$/i, '').toLowerCase();
    const cuenta = cuentasPara(miembro, null).find(c => sinXml(c.fileNameXml) === sinXml(nombreXml));
    if (!cuenta) return { error: 'account not found in your Monitor Link summary' };
    const runId = `info_${Date.now()}`;
    corridas.set(runId, { hijo: null, detenido: false, stopFile: path.join(os.tmpdir(), `fast_dust_stop_${runId}`) });
    const estado = await refrescarDust(runId, [cuenta], () => {}, miembro);
    corridas.delete(runId);
    return estado.ok ? { datos: estado.ultimo } : { error: estado.errores[0] || 'could not read the account' };
}

module.exports = { ocupado, refrescarCuentaElegida, leerInventarioCuenta, init, habilitado, filaBoton, filaBotonFarm, filaBotonesDust, mezclarShinedust, manejarInteraccion };
