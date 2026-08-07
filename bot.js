// Ver entry.js para el detalle -- se repite aca porque quien corre bot.js
// directo (PM2 en un dev PC) no pasa por entry.js.
require('dns').setDefaultResultOrder('ipv4first');
require('net').setDefaultAutoSelectFamily(false);

require('dotenv').config();
const { 
    Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder,
    ButtonStyle, EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle,
    ChannelType, PermissionsBitField, StringSelectMenuBuilder, SlashCommandBuilder, REST, Routes,
    AttachmentBuilder, WebhookClient
} = require('discord.js');
const axios = require('axios');
const express = require('express');
const crypto = require('crypto');
const FormData = require('form-data');
const { exec, execSync, execFileSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const sharp = require('./native-require.js')('sharp');
const PDFDocument = require('pdfkit');
const db = require('./database.js');

const heartbeatScript = require('./heartbeat.js');
const configScript = require('./config.js');
const { chequearActualizaciones, avisarActualizacionAplicadaSiHaceFalta, obtenerVersionLocal, obtenerVersionRemota, esVersionMasNueva, descargarActualizacion, describirError, notasParaEmbed } = require('./update-checker.js');
const { obtenerMapaEmojisGuild, FUENTES_EMOJIS } = require('./guild-emojis.js');
const { iniciarAutoSyncCardTypes } = require('./card-types-sync.js');
iniciarAutoSyncCardTypes();

const TOKEN = process.env.DISCORD_BOT_TOKEN;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID || null;
if (!TOKEN) {
    console.error('❌ DISCORD_BOT_TOKEN is not set. Create a .env file with DISCORD_BOT_TOKEN or set the environment variable.');
    process.exit(1);
}

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

// Webhook fijo del canal de feedback del dueño — todos los usuarios que
// corren su propia copia del bot mandan sus sugerencias/reportes acá, para
// tener todo centralizado en un solo lugar en vez de revisar servidor por
// servidor. Guardado en base64 (no en texto plano) para que no aparezca con
// una búsqueda de texto directa sobre el .exe/bundle.js — no es seguridad
// real (se puede decodificar), pero sube la barrera de "grep casual".
const FEEDBACK_WEBHOOK_B64 = 'aHR0cHM6Ly9kaXNjb3JkLmNvbS9hcGkvd2ViaG9va3MvMTUyODU3ODYwMDM4MTU4MzQ2My9sZllQS2dTWUQtWTc2NThHLU1aUTNwZmxVTVZ1Vmo3SjVvVm5mQzZyMzNCbm5FaEVBcWctYkFOQkhibjFmTzRyVm1TTA==';
const FEEDBACK_WEBHOOK_URL = Buffer.from(FEEDBACK_WEBHOOK_B64, 'base64').toString('utf8');
const FEEDBACK_COOLDOWN_MS = 5 * 60 * 1000;

// Discord no permite adjuntar archivos dentro de un modal — el adjunto se
// recibe en la interacción del slash command (antes de abrir el modal) y se
// guarda acá de paso hasta que llega el submit del modal, que es una
// interacción distinta. Se limpia solo a los 10 minutos por si el usuario
// abre el modal y nunca lo manda.
const imagenFeedbackPendiente = new Map();
const FEEDBACK_IMAGEN_TTL_MS = 10 * 60 * 1000;

function tienePermisosGestion(interaction) {
    if (!interaction || !interaction.guild) return false;
    if (interaction.user?.id && interaction.guild?.ownerId && interaction.user.id === interaction.guild.ownerId) return true;
    return interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageGuild) || interaction.memberPermissions?.has(PermissionsBitField.Flags.Administrator);
}

const COMANDO_CONFIG = {
    card_all: { tipo: 'cmd_card_all', label: 'All Cards', titulo: '⚡ All Cards', descripcion: 'Exclusive channel for /card.' },
    card_wishlist: { tipo: 'cmd_card_wishlist', label: 'Cards Wishlist', titulo: '💖 Cards Wishlist', descripcion: 'Exclusive channel for /wishlist.' },
    extract_xlm: { tipo: 'cmd_extract_xlm', label: 'Extract XML', titulo: '📄 Extract XML', descripcion: 'Exclusive channel for /extract xml.' },
    run_instance: { tipo: 'cmd_run_instance', label: 'Trading', titulo: '🔄 Trading', descripcion: 'Exclusive channel for /run instance.' },
    card_gold: { tipo: 'cmd_card_gold', label: 'Gold Cards', titulo: '🏆 Gold Cards', descripcion: 'Exclusive channel for /goldcards.' }
};

const ETIQUETAS_TIPO_WEBHOOK = {
    's4t': 'S4T (General)',
    's4t-categoria': 'S4T (By Category)',
    '3-diamond': '3 Diamonds',
    '4-diamond': '4 Diamonds',
    '1-star': '1 Star',
    '1-star-shiny': '1 Star Shiny',
    '2-star-trainer': '2 Star Trainer',
    '2-star-rainbow': '2 Star Rainbow',
    '2-star-full-art': '2 Star Full Art',
    '2-star-shiny': '2 Star Shiny',
    'immersive': 'Immersive',
    'crown-rare': 'Crown Rare',
    'wishlist': 'Wishlist',
    'godpack-general': 'God Pack General',
    'godpack-alive': 'God Pack Alive',
    'godpack-dead': 'God Pack Dead',
    'heartbeat': 'Heartbeat',
    'actualizaciones': 'Updates',
    'tutoriales': 'Tutorials',
    'apoyo': 'Donate',
    'cmd_setup': 'Settings',
    'cmd_build_embed': 'Build Embed',
    'cmd_build_webhooks': 'Build Webhooks',
    'shinedust': 'Shinedust',
    'cmd_card_gold': 'Gold Cards',
    'info_accounts': 'Info Accounts'
};
// Nombre por defecto que se le pone al webhook AL CREARLO (no confundir con
// ETIQUETAS_TIPO_WEBHOOK, que es solo para mostrar en las listas de /webhook)
// — a pedido del usuario, reemplaza el genérico "Bot {tipo}" por algo
// presentable. Si un tipo no está acá, se sigue usando el genérico de
// siempre. No afecta webhooks que ya existen y siguen funcionando bien (Sync
// Channels no los toca), ni pisa el nombre que un usuario ya se puso a mano
// con /webhook (aplicarPersonalizacionWebhookSiExiste siempre manda encima).
const NOMBRES_DEFAULT_WEBHOOK = {
    's4t': 'S4T TCGP',
    's4t-categoria': 'S4T Category TCGP',
    'wishlist': 'Wishlist TCGP',
    '3-diamond': 'Card 3 Diamond 🔷',
    '4-diamond': 'Card 4 Diamond 💠',
    '1-star': 'Card 1 Star ⭐',
    '1-star-shiny': 'Card 1 Star Shiny 🌟',
    '2-star-trainer': 'Card 2 Star Trainer ⭐⭐',
    '2-star-rainbow': 'Card 2 Star Rainbow 🌈',
    '2-star-full-art': 'Card 2 Star Full Art 🎨',
    '2-star-shiny': 'Card 2 Star Shiny ✨',
    'immersive': 'Card Immersive 🌌',
    'crown-rare': 'Card Crown Rare 👑',
    'heartbeat': 'Heartbeat ❤️',
    'cmd_build_embed': 'Build Embed 🔧',
    'cmd_build_webhooks': 'Build Webhooks 🔗',
    'cmd_setup': 'Settings ⚙',
    'actualizaciones': 'Updates 🔔',
    'tutoriales': 'Tutorials 📚',
    'apoyo': 'Donate ☕',
    'cmd_feedback': 'Feedback 📝',
    'godpack-general': 'God Pack General 📦',
    'godpack-alive': 'God Pack Alive 👼',
    'godpack-dead': 'God Pack Dead ☠️',
    'cmd_card_wishlist': 'Wishlist 💖',
    'cmd_card_all': 'AllCards ⚡',
    'cmd_extract_xlm': 'Extract XML 📄',
    'cmd_run_instance': 'Trading 🔄',
    'shinedust': 'Shinedust 🍬',
    'info_accounts': 'Info Accounts 📋'
};
function nombreDefaultWebhook(tipo) {
    return NOMBRES_DEFAULT_WEBHOOK[tipo] || `Bot ${tipo}`;
}

// Nombre "bonito" para el archivo descargado al presionar el boton de un
// tutorial (2026-08-06, a pedido explicito del usuario -- antes todos
// bajaban como "cmd_xxx.pdf", el slug interno del tipo de canal).
const NOMBRES_TUTORIAL_DESCARGA = {
    cmd_setup: 'Bot General',
    cmd_build_embed: 'Build Embed',
    cmd_build_webhooks: 'Build Webhooks',
    cmd_card_wishlist: 'Cards Wishlist',
    cmd_card_all: 'All Cards',
    cmd_extract_xlm: 'Extract XML',
    shinedust: 'Shinedust',
    cmd_card_gold: 'Gold Cards',
    info_accounts: 'Info Accounts',
    cmd_run_instance: 'Automatic Trading'
};
function nombreTutorialDescarga(tipo) {
    return `${NOMBRES_TUTORIAL_DESCARGA[tipo] || tipo}.pdf`;
}

// Foto por defecto por tipo (misma logica que el nombre: solo pisa el generico
// de siempre, nunca lo que un usuario ya se puso a mano con /webhook). Ruta
// relativa a la raiz del proyecto — discord.js acepta un path de archivo local
// directo en "avatar" al crear un webhook, igual que ya se usa en otros lados
// del proyecto para adjuntos.
const AVATARES_DEFAULT_WEBHOOK = {
    'actualizaciones': path.join(__dirname, 'assets', 'element', 'camp.png'),
    'tutoriales': path.join(__dirname, 'assets', 'element', 'Tuto.png'),
    'heartbeat': path.join(__dirname, 'assets', 'element', 'heart.png'),
    'apoyo': path.join(__dirname, 'assets', 'element', 'kofi_me.png'),
    'cmd_feedback': path.join(__dirname, 'assets', 'element', 'poke_feed.png'),
    'cmd_build_embed': path.join(__dirname, 'assets', 'element', 'settings.png'),
    'cmd_build_webhooks': path.join(__dirname, 'assets', 'element', 'settings.png'),
    'cmd_setup': path.join(__dirname, 'assets', 'element', 'settings.png'),
    '3-diamond': path.join(__dirname, 'assets', 'element', 'Poké_Ball_EP.png'),
    '4-diamond': path.join(__dirname, 'assets', 'element', 'Poké_Ball_EP.png'),
    '1-star': path.join(__dirname, 'assets', 'element', 'Poké_Ball_EP.png'),
    '1-star-shiny': path.join(__dirname, 'assets', 'element', 'Poké_Ball_EP.png'),
    '2-star-trainer': path.join(__dirname, 'assets', 'element', 'Ultra_Ball_EP.png'),
    '2-star-rainbow': path.join(__dirname, 'assets', 'element', 'Ultra_Ball_EP.png'),
    '2-star-full-art': path.join(__dirname, 'assets', 'element', 'Ultra_Ball_EP.png'),
    '2-star-shiny': path.join(__dirname, 'assets', 'element', 'Ultra_Ball_EP.png'),
    'immersive': path.join(__dirname, 'assets', 'element', 'Master_Ball_EP.png'),
    'crown-rare': path.join(__dirname, 'assets', 'element', 'Master_Ball_EP.png'),
    'wishlist': path.join(__dirname, 'assets', 'element', 'Master_Ball_EP.png'),
    's4t-categoria': path.join(__dirname, 'assets', 'element', 'Honor_Ball_EP.png'),
    's4t': path.join(__dirname, 'assets', 'element', 'pokerotom.png'),
    'godpack-general': path.join(__dirname, 'assets', 'element', 'Moneda_set_especial_02_TCGP.png'),
    'godpack-alive': path.join(__dirname, 'assets', 'element', 'Moneda_set_especial_01_TCGP.png'),
    'godpack-dead': path.join(__dirname, 'assets', 'element', 'Moneda_Poké_Ball_TCGP.png'),
    'cmd_run_instance': path.join(__dirname, 'assets', 'element', 'Ficha_de_intercambio_TCGP.png'),
    'cmd_extract_xlm': path.join(__dirname, 'assets', 'element', 'Rango_Principiante_TCGP.png'),
    'cmd_card_all': path.join(__dirname, 'assets', 'element', 'Rango_Super_Ball_TCGP.png'),
    'cmd_card_wishlist': path.join(__dirname, 'assets', 'element', 'Rango_Master_Ball_TCGP.png'),
    'cmd_card_gold': path.join(__dirname, 'assets', 'element', 'Rango_Ultra_Ball_TCGP.png'),
    'shinedust': path.join(__dirname, 'assets', 'element', 'Rango_Master_Ball_TCGP.png'),
    'info_accounts': path.join(__dirname, 'assets', 'element', 'Rango_Poké_Ball_TCGP.png')
};
function avatarDefaultWebhook(tipo) {
    return AVATARES_DEFAULT_WEBHOOK[tipo] || 'https://i.imgur.com/gK1q9yS.png';
}

function etiquetaTipoWebhook(tipo) {
    if (ETIQUETAS_TIPO_WEBHOOK[tipo]) return ETIQUETAS_TIPO_WEBHOOK[tipo];
    const comando = Object.values(COMANDO_CONFIG).find(c => c.tipo === tipo);
    if (comando) return comando.label;
    return tipo.replace(/^cmd_/, '').replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// Lista de webhooks reales (excluye rutas de carpeta y marcadores de categoría,
// que reusan la misma tabla pero guardan un path o 'N/A' en vez de una URL).
async function obtenerWebhooksReales(userId) {
    return db.all(
        `SELECT tipo, canal_id, webhook_url FROM configs_canales WHERE discord_id = ? AND webhook_url LIKE 'https://discord.com/api/webhooks/%' ORDER BY tipo`,
        [userId]
    );
}

// Un webhook borrado (por lo que sea, incluso fuera de este bot) sigue
// guardado en la DB con su URL de siempre — Discord no avisa, solo empieza a
// devolver 404 "Unknown Webhook" al usarlo.
//
// Bug real encontrado 2026-07-23: este chequeo corre cada 60s contra TODOS
// los webhooks de TODOS los usuarios (~25-30 por usuario) — cualquier error
// transitorio (timeout de red, 429 rate limit de Discord, un 5xx puntual) se
// trataba exactamente igual que un 404 real, así que un simple hipo de red
// bastaba para reportar un webhook como "caído" cuando en realidad seguía
// vivo (el usuario no había tocado nada). Ahora solo se considera
// "confirmado caído" un 404 real; cualquier otro error se ignora (se asume
// que sigue vivo, se vuelve a chequear en el próximo ciclo).
async function webhookEstaVivo(url) {
    try {
        await axios.get(url, { timeout: 8000 });
        return true;
    } catch (e) {
        if (e?.response?.status === 404) return false;
        return true; // error transitorio — no lo tratamos como confirmado caído
    }
}

// Chequeo periódico proactivo: en vez de esperar a que alguien note un canal
// roto y corra "Sincronizar Canales" a ciegas, el bot avisa apenas detecta un
// webhook caído — "acá está roto, corré Sync Channels para repararlo". Solo
// avisa una vez por webhook caído (no en cada repetición) hasta que se
// repare; si vuelve a caerse después de reparado, se re-avisa como algo nuevo.
async function chequearWebhooksCaidos(client) {
    try {
        const usuarios = await db.all(`SELECT DISTINCT discord_id FROM configs_canales WHERE webhook_url LIKE 'https://discord.com/api/webhooks/%'`);
        for (const { discord_id } of usuarios) {
            const webhooks = await obtenerWebhooksReales(discord_id);
            const caidos = [];
            for (const w of webhooks) {
                if (!(await webhookEstaVivo(w.webhook_url))) caidos.push(w.tipo);
            }

            const claveReportados = 'webhooks_caidos_reportados';
            const filaReportados = await db.get(`SELECT estado FROM configs_extras WHERE discord_id = ? AND tipo = ?`, [discord_id, claveReportados]);
            let yaReportados = [];
            try { yaReportados = filaReportados ? JSON.parse(filaReportados.estado) : []; } catch (e) { yaReportados = []; }

            const nuevosCaidos = caidos.filter(t => !yaReportados.includes(t));
            if (nuevosCaidos.length > 0) {
                const etiquetas = nuevosCaidos.map(t => etiquetaTipoWebhook(t)).join(', ');
                // Además de decir QUÉ está roto, se linkea directo al canal de
                // Settings — a pedido del usuario, para poder ir con un clic y
                // correr "Sync Channels" en vez de tener que buscarlo a mano.
                const filaSetup = await db.get(
                    `SELECT canal_id FROM configs_canales WHERE discord_id = ? AND tipo = 'cmd_setup'`,
                    [discord_id]
                );
                const linkCanal = filaSetup?.canal_id ? ` in <#${filaSetup.canal_id}>` : '';
                const mensaje = { content: `⚠️ **Webhook(s) down:** ${etiquetas}\n\nRun **Sync Channels**${linkCanal} via \`/setup\` to repair automatically — nothing is lost, it just needs to recreate the connection.` };

                // Siempre por DM, nunca al canal de Updates — a pedido explícito
                // del usuario, ese canal es solo para avisos de actualización del
                // bot en sí, no para chequeos de salud/errores como este.
                try {
                    const usuario = await client.users.fetch(discord_id);
                    await usuario.send(mensaje);
                } catch (e) { /* si no se puede DM (el usuario cerró los DMs del bot), se pierde este aviso puntual */ }
            }

            await db.run(
                `INSERT INTO configs_extras (discord_id, tipo, estado) VALUES (?, ?, ?) ON CONFLICT(discord_id, tipo) DO UPDATE SET estado = ?`,
                [discord_id, claveReportados, JSON.stringify(caidos), JSON.stringify(caidos)]
            );
        }
    } catch (e) {
        console.error('DEBUG: error chequeando webhooks caídos:', e?.message || e);
    }
}

// Cuando un webhook se recrea (porque el guardado murió, o Sync Channels lo
// reemplaza), Discord genera uno con una URL/ID totalmente nuevos — no hay
// forma de "revivir" el mismo webhook con su nombre/foto de siempre. Sin este
// respaldo, cualquier personalización hecha con /webhook (nombre, foto) se
// perdía cada vez que el webhook subyacente cambiaba, obligando a rehacerla a
// mano. Se guarda la URL de la foto (no la imagen ya codificada) para no
// inflar la base de datos — se vuelve a descargar y codificar recién cuando
// hace falta re-aplicarla.
async function guardarPersonalizacionWebhook(discordId, tipo, cambios) {
    const claveEstado = `webhook_custom_${tipo}`;
    const filaActual = await db.get(`SELECT estado FROM configs_extras WHERE discord_id = ? AND tipo = ?`, [discordId, claveEstado]);
    let actual = {};
    try { actual = filaActual ? JSON.parse(filaActual.estado) : {}; } catch (e) { actual = {}; }
    const combinado = { ...actual, ...cambios };
    await db.run(
        `INSERT INTO configs_extras (discord_id, tipo, estado) VALUES (?, ?, ?) ON CONFLICT(discord_id, tipo) DO UPDATE SET estado = ?`,
        [discordId, claveEstado, JSON.stringify(combinado), JSON.stringify(combinado)]
    );
}

async function aplicarPersonalizacionWebhookSiExiste(discordId, tipo, webhookUrl) {
    try {
        const fila = await db.get(`SELECT estado FROM configs_extras WHERE discord_id = ? AND tipo = ?`, [discordId, `webhook_custom_${tipo}`]);
        if (!fila) return;
        const datos = JSON.parse(fila.estado);
        const payload = {};
        if (datos.name) payload.name = datos.name;
        if (datos.avatarUrl?.startsWith('data:')) {
            // Ya es un data URI listo (viene de /webhook con imagen adjunta
            // directa) — no hay nada que volver a descargar.
            payload.avatar = datos.avatarUrl;
        } else if (datos.avatarUrl) {
            const img = await axios.get(datos.avatarUrl, {
                responseType: 'arraybuffer', timeout: 8000,
                maxContentLength: 8 * 1024 * 1024, maxBodyLength: 8 * 1024 * 1024
            });
            const mime = img.headers['content-type'] || '';
            if (mime.startsWith('image/')) payload.avatar = `data:${mime};base64,${Buffer.from(img.data).toString('base64')}`;
        }
        if (Object.keys(payload).length) await axios.patch(webhookUrl, payload);
    } catch (e) {
        // Si falla (URL de foto ya no responde, etc.), el webhook nuevo se
        // queda con el nombre por defecto — no rompe la sincronización por esto.
        console.error(`DEBUG: no se pudo reaplicar la personalización del webhook (${tipo}):`, e?.message || e);
    }
}

async function construirPanelListaWebhooks(userId) {
    const filas = await obtenerWebhooksReales(userId);
    const embed = new EmbedBuilder()
        .setTitle('🔗 Configured Webhooks')
        .setColor(0x5865F2)
        .setDescription(
            filas.length
                ? filas.map(f => `🔹 **${etiquetaTipoWebhook(f.tipo)}** — <#${f.canal_id}>`).join('\n')
                : 'No webhooks synced yet. Use "Sync Channels" in /setup first.'
        );

    const componentes = [];
    // Un select menu de Discord admite maximo 25 opciones — con mas de 25
    // webhooks reales, los que sobraban quedaban invisibles en el dropdown
    // (aunque la lista de arriba ya los mostrara a todos). Se arma un menu
    // aparte por cada tanda de 25 para que ninguno quede sin forma de
    // seleccionarse.
    for (let i = 0; i < filas.length; i += 25) {
        const tanda = filas.slice(i, i + 25);
        const menu = new StringSelectMenuBuilder()
            .setCustomId(i === 0 ? 'webhook_seleccionar' : `webhook_seleccionar_${i / 25 + 1}`)
            .setPlaceholder(filas.length > 25 ? `Select a webhook to edit (${i + 1}-${i + tanda.length})` : 'Select a webhook to edit')
            .addOptions(tanda.map(f => ({
                label: `Webhook - ${etiquetaTipoWebhook(f.tipo)}`.slice(0, 100),
                value: f.tipo
            })));
        componentes.push(new ActionRowBuilder().addComponents(menu));
    }
    if (fs.existsSync(rutaTutorialPdf('cmd_build_webhooks'))) {
        componentes.push(new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('tutorial_pdf::cmd_build_webhooks').setLabel('📄 Tutorial').setStyle(ButtonStyle.Secondary)
        ));
    }

    const archivos = [];
    if (fs.existsSync(SYMBOL_EMBEDS_PATH)) {
        embed.setThumbnail('attachment://symbol.png');
        archivos.push(new AttachmentBuilder(SYMBOL_EMBEDS_PATH, { name: 'symbol.png' }));
    }

    return { embeds: [embed], components: componentes, files: archivos };
}

async function construirPanelDetalleWebhook(userId, tipo, opciones = {}) {
    const fila = await db.get(`SELECT canal_id, webhook_url FROM configs_canales WHERE discord_id = ? AND tipo = ?`, [userId, tipo]);
    if (!fila) return null;

    let infoWebhook = null;
    try {
        const resp = await axios.get(fila.webhook_url);
        infoWebhook = resp.data;
    } catch (e) { /* si falla, mostramos igual con los datos que ya tenemos guardados */ }

    const nombreActual = infoWebhook?.name || `Bot ${tipo}`;
    const avatarUrl = infoWebhook?.avatar
        ? `https://cdn.discordapp.com/avatars/${infoWebhook.id}/${infoWebhook.avatar}.png`
        : null;

    // Ojo: TODO webhook auto-creado ya sale con un avatar de placeholder puesto
    // desde su creación (ver createWebhook({avatar: 'https://i.imgur.com/...'})),
    // así que "¿tiene avatar?" es casi siempre true — no alcanza para saber si
    // el USUARIO lo personalizó a propósito con /webhook. Se chequea contra el
    // registro real de personalización guardado (guardarPersonalizacionWebhook)
    // en vez de la sola presencia de un avatar en el webhook en vivo.
    const filaPersonalizado = await db.get(`SELECT estado FROM configs_extras WHERE discord_id = ? AND tipo = ?`, [userId, `webhook_custom_${tipo}`]);
    let tienePersonalizacion = false;
    try { tienePersonalizacion = !!(filaPersonalizado && JSON.parse(filaPersonalizado.estado)?.avatarUrl); } catch (e) { tienePersonalizacion = false; }

    const embed = new EmbedBuilder()
        .setTitle(`🔗 Webhook - ${etiquetaTipoWebhook(tipo)}`)
        .setColor(opciones.guardado ? 0x2ECC71 : 0x5865F2)
        .setDescription(
            (opciones.guardado ? '✅ **Saved.**\n\n' : '') +
            (opciones.error ? `❌ **${opciones.error}**\n\n` : '') +
            `**Channel:** <#${fila.canal_id}>\n**Current name:** ${nombreActual}`
        );
    // Si el usuario ya personalizó el avatar con /webhook, mostrar ESE (útil
    // para ver qué foto tiene antes de cambiarla) — el logo genérico de
    // Pokémon queda solo como respaldo mientras siga con el placeholder
    // de fábrica.
    const archivos = [];
    if (tienePersonalizacion && avatarUrl) {
        embed.setThumbnail(avatarUrl);
    } else if (fs.existsSync(SYMBOL_EMBEDS_PATH)) {
        embed.setThumbnail('attachment://symbol.png');
        archivos.push(new AttachmentBuilder(SYMBOL_EMBEDS_PATH, { name: 'symbol.png' }));
    }

    const filaBotones = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`webhook_modificar::${tipo}`).setLabel('✏️ Edit name/avatar').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('webhook_volver').setLabel('🔙 Back').setStyle(ButtonStyle.Secondary)
    );

    // "attachments: []" solo hace falta cuando ESTA pantalla no trae ningún
    // archivo propio — ahí limpia el adjunto viejo que traía la lista de
    // webhooks (pantalla anterior), que si no se queda pegado suelto. Pero si
    // SÍ hay un archivo nuevo (el logo de respaldo), no hay que mandarlo:
    // Discord interpreta "attachments: []" junto con "files" como "no dejar
    // ningún adjunto", y el logo nuevo termina sin mostrarse.
    const payload = { embeds: [embed], components: [filaBotones], files: archivos };
    if (!archivos.length) payload.attachments = [];
    return payload;
}

function normalizarComando(interaction) {
    const key = interaction?.commandName?.toLowerCase();
    if (key === 'card') return 'card_all';
    if (key === 'wishlist') return 'card_wishlist';
    if (key === 'extract') return interaction?.options?.getSubcommand?.(false) === 'xml' ? 'extract_xlm' : null;
    if (key === 'run') return interaction?.options?.getSubcommand?.(false) === 'instance' ? 'run_instance' : null;
    if (key === 'goldcards') return 'card_gold';
    return COMANDO_CONFIG[key] ? key : null;
}

async function obtenerCanalComando(userId, tipo) {
    return db.get(
        `SELECT canal_id, webhook_url FROM configs_canales WHERE discord_id = ? AND tipo = ? AND webhook_url NOT IN ('N/A', 'local') ORDER BY rowid DESC LIMIT 1`,
        [userId, tipo]
    );
}

async function guardarCanalComando(userId, tipo, canalId, webhookUrl) {
    await db.run(
        `INSERT INTO configs_canales (discord_id, tipo, canal_id, webhook_url) VALUES (?, ?, ?, ?)
         ON CONFLICT(discord_id, tipo) DO UPDATE SET canal_id = excluded.canal_id, webhook_url = excluded.webhook_url`,
        [userId, tipo, canalId, webhookUrl]
    );
}

function construirEmbedComando(commandKey, user) {
    const cfg = COMANDO_CONFIG[commandKey];
    return new EmbedBuilder()
        .setColor(commandKey === 'wishlist' ? 0xE91E63 : 0x3498DB)
        .setTitle(cfg.titulo)
        .setDescription(`Command run by <@${user.id}>.`)
        .setTimestamp();
}

const WISHLIST_POR_PAGINA = 15;

function construirEmbedWishlistInicio(user, mapaEmojis = {}) {
    const tagWishlist = tagTipoBot('icono_wishlist', mapaEmojis);
    return new EmbedBuilder()
        .setTitle('🔍 | Wishlist Card Search:')
        .setDescription(
            `Your wishlist is right here!!  <@${user.id}>.\n\n` +
            `Press the button to see the full list of your saved wishlist.${tagWishlist ? ' ' + tagWishlist : ''}\n\n`+
            `Details: \n\n` +
            `1- View all expansions!\n` +
            `2- Search cards by expansion!\n` +
            `3- Search cards by name!\n` +
            `4- View details of each card!\n` +
            `5- View image of each card!\n`
        )
        .setColor(0xE91E63)
        .setFooter({ text: " Bot By Ale Cast ୨♡୧" })
        .setTimestamp();
}

function leerJsonSeguro(ruta) {
    try {
        let contenido = fs.readFileSync(ruta, 'utf8');
        if (contenido.charCodeAt(0) === 0xFEFF) contenido = contenido.slice(1);
        return JSON.parse(contenido);
    } catch (e) {
        return null;
    }
}

function resolverArchivoWishlist(rutaWishlist) {
    if (!rutaWishlist || !fs.existsSync(rutaWishlist)) return null;
    if (fs.lstatSync(rutaWishlist).isDirectory()) {
        const inferida = path.join(rutaWishlist, 'wishlist.json');
        return fs.existsSync(inferida) ? inferida : null;
    }
    return rutaWishlist;
}

function obtenerCartasWishlist(rutaWishlistCfg, rutaMasterCfg) {
    const archivoWishlist = resolverArchivoWishlist(rutaWishlistCfg?.webhook_url);
    if (!archivoWishlist) return null;

    const wishlistData = leerJsonSeguro(archivoWishlist);
    const ids = Array.isArray(wishlistData?.cards)
        ? wishlistData.cards.map(c => c?.id || c?.code || c?.cardId || c?.cardID).filter(Boolean)
        : [];

    const rutaMaster = rutaMasterCfg?.webhook_url;
    const cardmaster = rutaMaster ? leerJsonSeguro(path.join(rutaMaster, 'cardmaster.json')) : null;
    const en_US = rutaMaster ? leerJsonSeguro(path.join(rutaMaster, 'en_US.json')) : null;
    const cardMap = rutaMaster ? cargarCardMap(rutaMaster) : null;
    const expansiones = construirMapaExpansiones(en_US);

    const cartas = ids.map(id => {
        const nameKey = cardmaster?.[id]?.Name;
        const nombre = normalizarNombreExBot((nameKey && en_US?.[nameKey]) ? en_US[nameKey] : id);
        const expansionId = cardMap?.[id]?.ExpansionID;
        const expansion = expansionId ? (expansiones[expansionId] || expansionId) : 'No expansion';
        const categoria = categoriaDesdeInfo(cardmaster?.[id]);
        const tipoRareza = tipoRarezaDesdeInfo(cardmaster?.[id]);
        return { id, nombre, expansion, categoria, tipoRareza };
    });

    cartas.sort((a, b) => a.expansion.localeCompare(b.expansion) || a.nombre.localeCompare(b.nombre));
    return cartas;
}

function obtenerTodasLasCartas(rutaMasterCfg) {
    const rutaMaster = rutaMasterCfg?.webhook_url;
    if (!rutaMaster) return null;
    const cardmaster = leerJsonSeguro(path.join(rutaMaster, 'cardmaster.json'));
    if (!cardmaster) return null;

    const en_US = leerJsonSeguro(path.join(rutaMaster, 'en_US.json'));
    const cardMap = cargarCardMap(rutaMaster);
    const expansiones = construirMapaExpansiones(en_US);

    const cartas = Object.keys(cardmaster).map(id => {
        const info = cardmaster[id];
        const nombre = normalizarNombreExBot((info?.Name && en_US?.[info.Name]) ? en_US[info.Name] : id);
        const expansionId = cardMap?.[id]?.ExpansionID;
        const expansion = expansionId ? (expansiones[expansionId] || expansionId) : 'No expansion';
        const categoria = categoriaDesdeInfo(info);
        const tipoRareza = tipoRarezaDesdeInfo(info);
        return { id, nombre, expansion, categoria, tipoRareza };
    });

    cartas.sort((a, b) => a.expansion.localeCompare(b.expansion) || a.nombre.localeCompare(b.nombre));
    return cartas;
}

// Cachea la lista completa (3305 cartas) en memoria por ruta_master — el
// autocompletado de /card dispara una consulta por cada tecla que se escribe,
// releer y reconstruir cardmaster.json/en_US.json/cardmap.json en cada una
// sería innecesariamente lento.
let _todasCartasCacheBot = null;
async function obtenerTodasLasCartasCacheadas() {
    const rutaMasterCfg = await db.get(`SELECT webhook_url FROM configs_canales WHERE tipo = 'ruta_master'`);
    const rutaMaster = rutaMasterCfg?.webhook_url;
    if (!rutaMaster) return { cartas: null, rutaMasterPath: null };
    if (!_todasCartasCacheBot || _todasCartasCacheBot.ruta !== rutaMaster) {
        _todasCartasCacheBot = { ruta: rutaMaster, cartas: obtenerTodasLasCartas(rutaMasterCfg) };
    }
    return { cartas: _todasCartasCacheBot.cartas, rutaMasterPath: rutaMaster };
}

// Umbral de copias para que una carta cuente como "Gold" -- configurable por
// usuario (a pedido explicito, ya no hardcodeado a 10) via el boton "⚙️
// Threshold" en el panel de Gold Cards. UMBRAL_GOLD_CARD_DEFAULT es solo el
// valor inicial para quien nunca lo cambió.
const UMBRAL_GOLD_CARD_DEFAULT = 10;

async function obtenerUmbralGold(discordId) {
    const fila = await db.get(`SELECT estado FROM configs_extras WHERE discord_id = ? AND tipo = 'umbral_gold'`, [discordId]);
    const valor = fila ? parseInt(fila.estado, 10) : NaN;
    return Number.isFinite(valor) && valor > 0 ? valor : UMBRAL_GOLD_CARD_DEFAULT;
}

async function guardarUmbralGold(discordId, umbral) {
    await db.run(
        `INSERT INTO configs_extras (discord_id, tipo, estado) VALUES (?, 'umbral_gold', ?) ON CONFLICT(discord_id, tipo) DO UPDATE SET estado = ?`,
        [discordId, String(umbral), String(umbral)]
    );
}

// Catalogo completo (mismo que allcards) pero filtrado a solo las cartas que
// YA califican como Gold en al menos una cuenta (umbral configurable) -- a
// pedido explicito del usuario, para que el dropdown de seleccion de
// /goldcards no muestre cartas que nadie tiene completas.
let _cartasGoldCacheBot = null;
async function obtenerCartasGoldCacheadas(discordId) {
    const { cartas, rutaMasterPath } = await obtenerTodasLasCartasCacheadas();
    if (cartas === null) return { cartas: null, rutaMasterPath: null, mapaCopias: null, umbral: UMBRAL_GOLD_CARD_DEFAULT };

    const umbral = await obtenerUmbralGold(discordId);
    const rutaJsonCfg = await db.get(`SELECT webhook_url FROM configs_canales WHERE tipo = 'ruta_json_cuentas'`);
    const claveCache = `${rutaMasterPath}::${rutaJsonCfg?.webhook_url || ''}::${umbral}`;
    if (!_cartasGoldCacheBot || _cartasGoldCacheBot.clave !== claveCache) {
        const mapaCopias = construirMapaCopiasPorCarta(rutaJsonCfg?.webhook_url);
        const cartasGold = mapaCopias ? cartas.filter(c => cuentasGoldParaCarta(mapaCopias, c.id, umbral).length > 0) : [];
        _cartasGoldCacheBot = { clave: claveCache, cartas: cartasGold, mapaCopias };
    }
    return { cartas: _cartasGoldCacheBot.cartas, rutaMasterPath, mapaCopias: _cartasGoldCacheBot.mapaCopias, umbral };
}

// Banners al azar (2026-08-06, a pedido explicito del usuario): en vez del
// banner fijo, cada vez que se corre el comando se elige una imagen distinta
// de una carpeta de ilustraciones local (misma PC, subidas tambien a
// github.com/AleCast09/Pokemon-Icon-Wallpapers). Si la carpeta no esta
// disponible (o esta vacia), cae de vuelta al banner fijo pasado como default.
function elegirBannerAleatorio(carpeta, rutaDefault) {
    try {
        if (fs.existsSync(carpeta)) {
            const archivos = fs.readdirSync(carpeta).filter(f => /\.(png|jpe?g|webp)$/i.test(f));
            if (archivos.length) {
                const elegido = archivos[Math.floor(Math.random() * archivos.length)];
                return path.join(carpeta, elegido);
            }
        }
    } catch (e) {
    }
    return rutaDefault;
}
const CARPETA_FUNDAS_ALLCARDS = 'C:\\Users\\Ale TCG\\Pictures\\pokemon\\Pokemon Fundas';
function elegirBannerAllCardsAleatorio() {
    return elegirBannerAleatorio(CARPETA_FUNDAS_ALLCARDS, path.join(__dirname, 'assets', 'embeds', 'card_banner.png'));
}
const CARPETA_PORTADAS_WISHLIST = 'C:\\Users\\Ale TCG\\Pictures\\pokemon\\Pokemon Portadas';
function elegirBannerWishlistAleatorio() {
    return elegirBannerAleatorio(CARPETA_PORTADAS_WISHLIST, path.join(__dirname, 'assets', 'embeds', 'wishlist_banner.png'));
}
// Imagen "de disculpa" (2026-08-06, a pedido explicito del usuario): cuando
// una carta buscada en Gold Cards todavia no tiene su borde dorado subido al
// Drive, en vez de mostrar la version SIN dorar (confuso -- parece que ya
// califica) se muestra una imagen al azar de nuestro propio repositorio de
// ilustraciones + un aviso pidiendo disculpas.
const CARPETA_ICONS_GOLD_SORRY = 'C:\\Users\\Ale TCG\\Pictures\\pokemon\\Pokemon Icons';
function elegirImagenDisculpaGoldAleatoria() {
    return elegirBannerAleatorio(CARPETA_ICONS_GOLD_SORRY, null);
}

function construirEmbedAllCardsInicio(user) {
    return new EmbedBuilder()
        .setTitle('⚡ Pokemon TCGP Library ⚡')
        .setDescription(
            `**Command run by <@${user.id}>.\n\n**` +
            `__Select an option below:__\n\n` +
            `1-› TCGP Expansions Panel.\n`+
            `2-› Category of each card by rarity.\n`+
            `3-› View each card, quantity & XML.\n`
        )
        .setColor(0x3498DB)
        .setFooter({ text: " Bot By Ale Cast ୨♡୧" })
        .setTimestamp();
}

function construirEmbedGoldCardsInicio(user) {
    return new EmbedBuilder()
        .setTitle('🏆 Gold Cards')
        .setDescription(
            `**Command run by <@${user.id}>.\n\n**` +
            `__Select an option below:__\n\n` +
            `1-› TCGP Expansions Panel.\n` +
            `2-› Category of each card by rarity.\n` +
            `3-› Only cards with 10+ copies in at least one account show up — those are the ones that turn Gold in-game.\n`
        )
        .setColor(0xF0A93A)
        .setFooter({ text: " Bot By Ale Cast ୨♡୧" })
        .setTimestamp();
}

// Gold Cards depende sí o sí de la API de Google Drive (las imágenes con
// borde dorado SOLO existen en la carpeta "Gold Frames" del Drive de Kevin,
// no hay ningún otro lado de donde sacarlas) -- a pedido explícito del
// usuario, se corta con un aviso claro en vez de dejar que falle en silencio
// mostrando la carta sin la imagen dorada.
function advertenciaGoldSinApi() {
    const embed = new EmbedBuilder()
        .setTitle('⚠️ Google Drive API key required')
        .setDescription(
            'Gold Cards needs a **Google Drive API key** configured — the gold-bordered card images only exist in a Drive folder, there\'s no other source for them.\n\n' +
            'Set it up in **Settings** (see the tutorial below), then try again.'
        )
        .setColor(0xE74C3C);
    return { embeds: [embed], components: [filaBotonesConTutorial('cmd_setup')] };
}

const SYMBOL_EMBEDS_PATH = path.join(__dirname, 'assets', 'embeds', 'symbol.png');

// Un PDF por tipo de canal (mismo criterio que un asset fijo) — se lee del
// disco recién cuando alguien presiona el botón "Tutorial", nunca queda
// pegado a un mensaje que se reubica/reenvía solo.
function rutaTutorialPdf(tipo) {
    return path.join(__dirname, 'assets', 'tutoriales', `${tipo}.pdf`);
}

function filaBotonesConTutorial(tipoTutorial, ...botonesPrincipales) {
    const botones = [...botonesPrincipales];
    if (fs.existsSync(rutaTutorialPdf(tipoTutorial))) {
        botones.push(new ButtonBuilder().setCustomId(`tutorial_pdf::${tipoTutorial}`).setLabel('📄 Tutorial').setStyle(ButtonStyle.Secondary));
    }
    return new ActionRowBuilder().addComponents(...botones);
}

// AttachmentBuilder guarda el contenido en .attachment — puede ser un Buffer
// (imagen generada) o una ruta de archivo en disco (asset fijo). enviarOEditarInterfaz
// necesita saber cuál de las dos es para armar el FormData.
function archivosDesdeAttachmentBuilders(files = []) {
    return files.map(a => (
        Buffer.isBuffer(a.attachment)
            ? { buffer: a.attachment, filename: a.name }
            : { ruta: a.attachment, filename: a.name }
    ));
}

function construirEmbedResumenExpansiones(cartas, opciones = {}) {
    const prefijo = opciones.prefijo || 'allcards';
    const conteo = {};
    for (const c of cartas) conteo[c.expansion] = (conteo[c.expansion] || 0) + 1;
    const expansiones = Object.keys(conteo).sort((a, b) => a.localeCompare(b));

    const lineas = expansiones.map((exp, i) => `${i + 1}. **${exp}** — ${conteo[exp]} cards`);

    const embed = new EmbedBuilder()
        .setTitle('📋 All Expansions')
        .setDescription((lineas.join('\n') || 'No expansions found.') + '\n\n🔎 **Select an expansion below:**')
        .setColor(0x3498DB)
        .setFooter({ text: `${expansiones.length} expansions • ${cartas.length} total cards` });

    const componentes = [];
    if (expansiones.length) {
        const menu = new StringSelectMenuBuilder()
            .setCustomId(`${prefijo}_expansion_seleccion`)
            .setPlaceholder('Select an expansion')
            .addOptions(expansiones.slice(0, 25).map(exp => ({ label: exp.slice(0, 100), value: exp })));
        componentes.push(new ActionRowBuilder().addComponents(menu));
    }

    const payload = { embeds: [embed], components: componentes };
    if (fs.existsSync(SYMBOL_EMBEDS_PATH)) {
        embed.setThumbnail('attachment://symbol.png');
        payload.files = [new AttachmentBuilder(SYMBOL_EMBEDS_PATH, { name: 'symbol.png' })];
    } else {
        payload.attachments = [];
    }
    return payload;
}

function construirEmbedListaCartas(cartas, pagina, opciones = {}) {
    const prefijo = opciones.prefijo || 'wishlist';
    const titulo = opciones.titulo || '📋 Your Wishlist';
    const vacioTexto = opciones.vacioTexto || 'No cards saved in your wishlist.';
    const mapaEmojis = opciones.mapaEmojis || {};

    const totalPaginas = Math.max(1, Math.ceil(cartas.length / WISHLIST_POR_PAGINA));
    const paginaSegura = Math.min(Math.max(pagina, 0), totalPaginas - 1);
    const inicio = paginaSegura * WISHLIST_POR_PAGINA;
    const items = cartas.slice(inicio, inicio + WISHLIST_POR_PAGINA);

    let listaTexto = vacioTexto;
    if (items.length) {
        const bloques = [];
        let expansionActual = null;
        let lineas = [];
        items.forEach((carta, i) => {
            if (carta.expansion !== expansionActual) {
                if (lineas.length) bloques.push(lineas.join('\n'));
                lineas = [`**${carta.expansion}**`];
                expansionActual = carta.expansion;
            }
            const emojiTexto = formatearCategoriaConIcono(carta.tipoRareza, mapaEmojis) || textoSinEmoji(carta.categoria);
            lineas.push(`${inicio + i + 1}. ${carta.nombre} — ${emojiTexto}`);
        });
        if (lineas.length) bloques.push(lineas.join('\n'));
        listaTexto = bloques.join('\n\n');
    }

    const embed = new EmbedBuilder()
        .setTitle(titulo)
        .setDescription(listaTexto + (items.length ? '\n\n🔎 **Search card:** select an expansion below.' : ''))
        .setColor(0xE91E63)
        .setFooter({ text: `Page ${paginaSegura + 1} of ${totalPaginas} • ${cartas.length} cards` });

    const fila = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`${prefijo}_pagina_${paginaSegura - 1}`).setLabel('◀️ Previous').setStyle(ButtonStyle.Secondary).setDisabled(paginaSegura <= 0),
        new ButtonBuilder().setCustomId(`${prefijo}_pagina_${paginaSegura + 1}`).setLabel('Next ▶️').setStyle(ButtonStyle.Secondary).setDisabled(paginaSegura >= totalPaginas - 1)
    );

    const componentes = [fila];
    const expansiones = [...new Set(cartas.map(c => c.expansion))].sort((a, b) => a.localeCompare(b));
    if (expansiones.length) {
        const menu = new StringSelectMenuBuilder()
            .setCustomId(`${prefijo}_expansion_seleccion`)
            .setPlaceholder('Select an expansion')
            .addOptions(expansiones.slice(0, 25).map(exp => ({ label: exp.slice(0, 100), value: exp })));
        componentes.push(new ActionRowBuilder().addComponents(menu));
    }

    return { embeds: [embed], components: componentes, attachments: [] };
}

const WISHLIST_EXPANSION_POR_PAGINA = 25;

// Texto sin el emoji Unicode genérico al principio (ej. "🔷 3 Diamantes" ->
// "3 Diamantes") para usar junto al emoji custom real de Discord, que se
// adjunta aparte vía el campo `emoji` de la opción — Discord no renderiza tags
// de emoji custom si van pegados como texto plano (ni en label ni, sobre todo,
// en description, donde ni el Unicode se ve bien).
function textoSinEmoji(texto) {
    return texto.replace(/^[^\p{L}\p{N}]+\s*/u, '').trim();
}

// Arma el campo `emoji` real de una opción de menú a partir de la clave de
// rareza (ej. '2-star-full-art') — null si no hay emoji custom cargado.
function emojiOpcionPorTipoRareza(tipoRareza, mapaEmojis) {
    const config = RAREZA_ICONOS_CARTAS[tipoRareza];
    const emojiId = config ? mapaEmojis[config.emoji] : null;
    return emojiId ? { id: emojiId, name: config.emoji } : null;
}

// Orden de progresión de rareza (de menos a más rara), a pedido del usuario,
// en vez de alfabético.
const ORDEN_RAREZA = [
    '1-diamond', '2-diamond', '3-diamond', '4-diamond',
    '1-star', '2-star-trainer', '2-star-full-art', '2-star-rainbow', 'immersive',
    '1-star-shiny', '2-star-shiny', 'crown-rare'
];

// Paso intermedio entre "elegir expansión" y "elegir carta": agrupa las cartas
// de esa expansión por categoría (rareza) para no tener que scrollear una
// lista enorme de entrada — a pedido del usuario.
function construirEmbedCategoriasPorExpansion(cartas, expansion, opciones = {}) {
    const prefijo = opciones.prefijo || 'wishlist';
    const contexto = opciones.contexto || 'your wishlist';
    const mapaEmojis = opciones.mapaEmojis || {};
    const filtradas = cartas.filter(c => c.expansion === expansion);

    const conteo = {};
    const tipoPorCategoria = {};
    for (const c of filtradas) {
        conteo[c.categoria] = (conteo[c.categoria] || 0) + 1;
        if (!tipoPorCategoria[c.categoria]) {
            tipoPorCategoria[c.categoria] = c.tipoRareza;
        }
    }
    const ordenDe = (cat) => {
        const idx = ORDEN_RAREZA.indexOf(tipoPorCategoria[cat]);
        return idx === -1 ? ORDEN_RAREZA.length : idx;
    };
    const categorias = Object.keys(conteo).sort((a, b) => ordenDe(a) - ordenDe(b));

    const lineas = categorias.map(cat => {
        const emojiTexto = formatearCategoriaConIcono(tipoPorCategoria[cat], mapaEmojis) || textoSinEmoji(cat);
        return `${emojiTexto} — ${conteo[cat]} cards`;
    });

    const embed = new EmbedBuilder()
        .setTitle(`🔎 ${expansion}`)
        .setDescription((lineas.join('\n') || 'No cards found.') + `\n\n🔎 **Select a category** \n(${filtradas.length} cards in ${contexto}):`)
        .setColor(0xE91E63)
        .setFooter({ text: `${categorias.length} category(s)` });

    const componentes = [];
    if (categorias.length) {
        const menu = new StringSelectMenuBuilder()
            .setCustomId(`${prefijo}_categoria_seleccion`)
            .setPlaceholder('Select a category')
            .addOptions(categorias.slice(0, 25).map(cat => {
                const opcion = {
                    label: `${textoSinEmoji(cat)} (${conteo[cat]})`.slice(0, 100),
                    value: `${expansion}::${cat}`.slice(0, 100)
                };
                const emoji = emojiOpcionPorTipoRareza(tipoPorCategoria[cat], mapaEmojis);
                if (emoji) opcion.emoji = emoji;
                return opcion;
            }));
        componentes.push(new ActionRowBuilder().addComponents(menu));
    }
    componentes.push(new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`${prefijo}_volver_expansiones`).setLabel('🔙 Back').setStyle(ButtonStyle.Secondary)
    ));

    const payload = { embeds: [embed], components: componentes };
    const rutaLogo = buscarLogoExpansionBot(expansion);
    if (rutaLogo) {
        // Nombre de archivo fijo sin espacios — Discord rechaza la URL
        // "attachment://" si el nombre del logo (ej. "Everyday Wonders.png")
        // trae espacios sin codificar.
        const extension = path.extname(rutaLogo) || '.png';
        embed.setThumbnail(`attachment://logo${extension}`);
        payload.files = [new AttachmentBuilder(rutaLogo, { name: `logo${extension}` })];
    } else {
        payload.attachments = [];
    }
    return payload;
}

async function construirEmbedCartasPorExpansion(cartas, expansion, categoria, pagina = 0, opciones = {}) {
    const prefijo = opciones.prefijo || 'wishlist';
    const contexto = opciones.contexto || 'your wishlist';
    const mapaEmojisCartas = opciones.mapaEmojis || {};

    const filtradas = cartas.filter(c => c.expansion === expansion && c.categoria === categoria);

    // Bug real: en categorías como "4 Diamonds", cada carta repite el tag de
    // emoji custom 4 veces (uno por diamante) — con 25 cartas por página como
    // en las demás categorías, el texto del embed supera los 4096 caracteres
    // que permite Discord y .setDescription() tira una excepción que dejaba
    // la interacción colgada para siempre ("no carga"). El tamaño de página
    // ahora se ajusta según cuántas veces se repite el emoji en esta categoría
    // específica, para que nunca se pase del límite sin importar cuántos
    // diamantes/estrellas tenga.
    const cantidadEmoji = RAREZA_ICONOS_CARTAS[filtradas[0]?.tipoRareza]?.cantidad || 1;
    // ~40 caracteres por cada tag de emoji personalizado repetido, +55 de
    // margen por nombre/numeración/separadores de cada línea — con 3600
    // caracteres de presupuesto (dejando ~500 de margen para el encabezado y
    // el pie del embed sobre el límite real de 4096), nunca se pasa del
    // límite sin importar la categoría. Nunca sube de 25 tampoco, porque el
    // menú desplegable de Discord no admite más de 25 opciones.
    const porPagina = Math.max(10, Math.min(WISHLIST_EXPANSION_POR_PAGINA, Math.floor(3600 / (55 + 40 * cantidadEmoji))));
    const totalPaginas = Math.max(1, Math.ceil(filtradas.length / porPagina));
    const paginaSegura = Math.min(Math.max(pagina, 0), totalPaginas - 1);
    const inicio = paginaSegura * porPagina;
    const items = filtradas.slice(inicio, inicio + porPagina);

    const listaTexto = items.map((c, i) => {
        const emojiTexto = formatearCategoriaConIcono(c.tipoRareza, mapaEmojisCartas) || textoSinEmoji(c.categoria);
        return `${inicio + i + 1}. ${c.nombre} — ${emojiTexto}`;
    }).join('\n');

    // El título del embed no puede renderizar emojis custom de Discord (es texto
    // plano) — por eso la categoría con su emoji real va como primera línea de
    // la descripción en vez de en el título.
    const categoriaConEmoji = (filtradas[0] && formatearCategoriaConIcono(filtradas[0].tipoRareza, mapaEmojisCartas)) || textoSinEmoji(categoria);
    const embed = new EmbedBuilder()
        .setTitle(`🔎 ${expansion}`)
        .setDescription(`${categoriaConEmoji}\n\n${listaTexto}\n\n🔎 **Select the card you're looking for** \n(${filtradas.length} cards in ${contexto}):`)
        .setColor(0xE91E63)
        .setFooter({ text: `Page ${paginaSegura + 1} of ${totalPaginas}` });

    const menu = new StringSelectMenuBuilder()
        .setCustomId(`${prefijo}_carta_seleccion::${expansion}::${categoria}::${paginaSegura}`)
        .setPlaceholder('Select a card')
        .addOptions(items.map((c, i) => {
            const opcion = {
                label: `${inicio + i + 1}. ${c.nombre}`.slice(0, 100),
                description: textoSinEmoji(c.categoria).slice(0, 100),
                value: c.id
            };
            const emoji = emojiOpcionPorTipoRareza(c.tipoRareza, mapaEmojisCartas);
            if (emoji) opcion.emoji = emoji;
            return opcion;
        }));

    const componentes = [new ActionRowBuilder().addComponents(menu)];

    const filaNavegacion = [
        new ButtonBuilder().setCustomId(`${prefijo}_volver_categorias::${expansion}`).setLabel('🔙 Back').setStyle(ButtonStyle.Secondary)
    ];
    if (totalPaginas > 1) {
        filaNavegacion.push(
            new ButtonBuilder().setCustomId(`${prefijo}_expansion_pagina_${paginaSegura - 1}::${expansion}::${categoria}`).setLabel('◀️ Previous').setStyle(ButtonStyle.Secondary).setDisabled(paginaSegura <= 0),
            new ButtonBuilder().setCustomId(`${prefijo}_expansion_pagina_${paginaSegura + 1}::${expansion}::${categoria}`).setLabel('Next ▶️').setStyle(ButtonStyle.Secondary).setDisabled(paginaSegura >= totalPaginas - 1)
        );
    }
    componentes.push(new ActionRowBuilder().addComponents(...filaNavegacion));

    const payload = { embeds: [embed], components: componentes };
    const archivosExtra = [];

    const rutaLogo = buscarLogoExpansionBot(expansion);

    // Collage con la imagen real de cada carta de esta pagina + badge de
    // cantidad total (a pedido explicito del usuario 2026-07-30). Si no hay
    // rutaMasterPath (Data Master Path sin configurar) simplemente no se
    // arma -- la lista de texto de arriba sigue funcionando igual sin esto.
    if (opciones.rutaMasterPath) {
        let collageBuffer = await generarCollageCartas(items, opciones.rutaMasterPath, opciones.mapaCopias, opciones.prefijo === 'goldcards');
        // Logo de la expansion arriba del collage (a pedido explicito del
        // usuario 2026-07-31), en vez de solo un thumbnail chico en la
        // esquina -- misma tecnica que ya usa s4t.js (componerLogoSobreImagen).
        if (collageBuffer && rutaLogo) {
            collageBuffer = await componerLogoSobreImagenBot(collageBuffer, rutaLogo);
        } else if (rutaLogo) {
            const extension = path.extname(rutaLogo) || '.png';
            embed.setThumbnail(`attachment://logo${extension}`);
            archivosExtra.push(new AttachmentBuilder(rutaLogo, { name: `logo${extension}` }));
        }
        if (collageBuffer) {
            embed.setImage('attachment://collage.png');
            archivosExtra.push(new AttachmentBuilder(collageBuffer, { name: 'collage.png' }));
        }
    } else if (rutaLogo) {
        const extension = path.extname(rutaLogo) || '.png';
        embed.setThumbnail(`attachment://logo${extension}`);
        archivosExtra.push(new AttachmentBuilder(rutaLogo, { name: `logo${extension}` }));
    }

    if (archivosExtra.length) {
        payload.files = archivosExtra;
    } else {
        payload.attachments = [];
    }
    return payload;
}

function cargarCardMap(rutaMaster) {
    if (!rutaMaster) return null;
    const candidatos = [
        path.join(rutaMaster, 'cardmap.json'),
        path.join(rutaMaster, 'Helper', 'cardmap.json'),
        path.join(rutaMaster, 'CardImageCache', 'cardmap.json')
    ];
    for (const candidato of candidatos) {
        const data = leerJsonSeguro(candidato);
        if (data) return data;
    }
    return null;
}

function construirMapaExpansiones(en_US) {
    const mapa = {};
    if (!en_US) return mapa;
    for (const key of Object.keys(en_US)) {
        const match = key.match(/^EXPANSION_NAME_(\d+)$/);
        if (match) {
            const codigo = en_US[key];
            mapa[codigo] = en_US[`EXPANSION_NAME_LONG_${match[1]}`] || codigo;
        }
    }
    return mapa;
}

function encontrarImagenPorIllustration(rutaMaster, illustrationId) {
    if (!rutaMaster || !illustrationId) return null;
    const ruta = path.join(rutaMaster, 'CardImageCache', `${illustrationId}.png`);
    return fs.existsSync(ruta) ? ruta : null;
}

// Ultimo respaldo cuando la carpeta local del usuario no tiene la carta
// (tipico el mismo dia que sale una expansion nueva, antes de que alguien la
// suba a mano) -- a pedido explicito del usuario 2026-07-31. Repositorio
// propio (no de un tercero) con las 3546 imagenes en baja calidad, mismo
// nombre de archivo (IllustrationID) que ya usa CardImageCache. Se guarda
// DIRECTO en CardImageCache (no en una carpeta aparte propia del bot) -- asi
// no duplica peso, y una vez bajada queda indistinguible de una imagen que
// el usuario ya tenia, sin volver a pegarle a la red por la misma carta.
const REPO_CARTAS_BASE_BOT = 'https://raw.githubusercontent.com/AleCast09/Pokemon-TCGP-Card-Image/main';
async function obtenerImagenRepoCartasBot(rutaMaster, illustrationId) {
    if (!rutaMaster || !illustrationId) return null;
    const dirCache = path.join(rutaMaster, 'CardImageCache');
    const rutaCache = path.join(dirCache, `${illustrationId}.png`);
    if (fs.existsSync(rutaCache)) return rutaCache;
    try {
        const resp = await axios.get(`${REPO_CARTAS_BASE_BOT}/${illustrationId}.png`, { responseType: 'arraybuffer', timeout: 8000 });
        fs.mkdirSync(dirCache, { recursive: true });
        fs.writeFileSync(rutaCache, resp.data);
        return rutaCache;
    } catch (e) {
        return null;
    }
}

// Misma caché en disco que usa s4t.js (assets/drive_cache) — arte HD real desde
// el Drive público (ver s4t.js para la explicación completa). Si falla (sin API
// key, sin internet, o la expansión todavía no subió), devuelve null y el que
// llama cae a encontrarImagenPorIllustration().
const GOOGLE_DRIVE_API_KEY_BOT = process.env.GOOGLE_DRIVE_API_KEY || '';
const GOOGLE_DRIVE_HD_ENABLED_BOT = process.env.GOOGLE_DRIVE_HD_ENABLED !== 'false';
const DRIVE_ROOT_FOLDER_ID_BOT = '1-JIeAcBXoRn1r_SFgoqO8ZG2KPp2ss9U';
const DRIVE_CACHE_DIR_BOT = path.join(__dirname, 'assets', 'drive_cache');
const DRIVE_FOLDER_MAP_PATH_BOT = path.join(__dirname, 'assets', 'drive_folder_map.json');

let _driveFolderMapCacheBot = null;
async function refrescarMapaCarpetasDriveBot() {
    if (!GOOGLE_DRIVE_API_KEY_BOT) return {};
    try {
        const resp = await axios.get('https://www.googleapis.com/drive/v3/files', {
            params: { q: `'${DRIVE_ROOT_FOLDER_ID_BOT}' in parents`, key: GOOGLE_DRIVE_API_KEY_BOT, fields: 'files(id,name)', pageSize: 200 },
            timeout: 5000
        });
        const mapa = {};
        for (const f of resp.data.files || []) {
            const guion = f.name.indexOf('-');
            if (guion === -1) continue;
            mapa[f.name.substring(0, guion)] = f.id;
        }
        if (Object.keys(mapa).length === 0) {
            registrarErrorDriveHd('normal', '(listado de carpetas)', 'raiz_drive_vino_vacia', `la API respondio OK pero 0 subcarpetas -- la key probablemente no tiene acceso a la carpeta raiz del Drive (¿esta compartida como "Cualquiera con el enlace"?)`);
        }
        _driveFolderMapCacheBot = mapa;
        fs.writeFileSync(DRIVE_FOLDER_MAP_PATH_BOT, JSON.stringify(mapa, null, 2));
        return mapa;
    } catch (e) {
        registrarErrorDriveHd('normal', '(listado de carpetas)', 'excepcion_listando_raiz', `HTTP ${e?.response?.status || '?'} — ${e?.message || e}`);
        return _driveFolderMapCacheBot || {};
    }
}

async function obtenerMapaCarpetasDriveBot() {
    if (_driveFolderMapCacheBot) return _driveFolderMapCacheBot;
    try {
        if (fs.existsSync(DRIVE_FOLDER_MAP_PATH_BOT)) {
            _driveFolderMapCacheBot = JSON.parse(fs.readFileSync(DRIVE_FOLDER_MAP_PATH_BOT, 'utf8'));
            return _driveFolderMapCacheBot;
        }
    } catch (e) { /* caché corrupto, se reconstruye abajo */ }
    return await refrescarMapaCarpetasDriveBot();
}

// A pedido explicito del usuario 2026-07-30: Drive HD para cartas normales es
// opt-in (default apagado) -- descargar en HD el catalogo entero puede sumar
// varios GB con el tiempo, y no todos quieren gastar ese espacio solo para
// mirar cartas normales. Las doradas NO pasan por este chequeo (siguen abajo,
// en obtenerImagenGoldBot): no tienen ninguna otra fuente, el borde dorado
// solo existe en Drive.
async function driveHdRegularHabilitado() {
    const fila = await db.get(`SELECT status FROM estados_modulos WHERE nombre = 'drive_hd_regular'`);
    return fila?.status === 'on';
}

// Log persistente de fallas del Drive HD (2026-08-06, a pedido explicito del
// usuario): antes solo quedaba un console.log que se perdia apenas el bot
// corria oculto/en pm2 -- para usuarios sin acceso comodo a una consola, esto
// escribe cada falla a un .txt simple abrible con doble click, para
// diagnosticar sin pedirles que abran CMD/PowerShell.
const RUTA_LOG_DRIVE_HD = path.join(__dirname, 'drive_hd_errores.txt');
function registrarErrorDriveHd(origen, cartaId, motivo, detalle = '') {
    try {
        const linea = `[${new Date().toLocaleString()}] (${origen}) carta=${cartaId} motivo=${motivo}${detalle ? ' — ' + detalle : ''}\n`;
        fs.appendFileSync(RUTA_LOG_DRIVE_HD, linea);
    } catch (e) {
    }
    console.log(`DEBUG: Drive HD (${origen}) carta=${cartaId} motivo=${motivo}`, detalle);
}

async function obtenerImagenHDBot(cardMap, cartaId, forzar = false) {
    const info = cardMap?.[cartaId];
    if (!info?.ExpansionID || !info?.CollectionNumber || !GOOGLE_DRIVE_API_KEY_BOT || !GOOGLE_DRIVE_HD_ENABLED_BOT) return null;
    if (!forzar && !(await driveHdRegularHabilitado())) return null;

    const localId = String(info.CollectionNumber).padStart(3, '0');
    const dirCache = path.join(DRIVE_CACHE_DIR_BOT, info.ExpansionID);
    const rutaCache = path.join(dirCache, `${localId}.png`);
    if (fs.existsSync(rutaCache)) return rutaCache;

    try {
        let mapaCarpetas = await obtenerMapaCarpetasDriveBot();
        let subfolderId = mapaCarpetas[info.ExpansionID];
        if (!subfolderId) {
            mapaCarpetas = await refrescarMapaCarpetasDriveBot();
            subfolderId = mapaCarpetas[info.ExpansionID];
        }
        if (!subfolderId) {
            registrarErrorDriveHd('normal', cartaId, 'carpeta_expansion_no_encontrada', info.ExpansionID);
            return null;
        }

        const busqueda = await axios.get('https://www.googleapis.com/drive/v3/files', {
            params: { q: `'${subfolderId}' in parents and name contains '${info.ExpansionID}-${localId}'`, key: GOOGLE_DRIVE_API_KEY_BOT, fields: 'files(id,name)', pageSize: 5 },
            timeout: 5000
        });
        const archivo = (busqueda.data.files || [])[0];
        if (!archivo) {
            registrarErrorDriveHd('normal', cartaId, 'archivo_no_encontrado_en_carpeta', `${info.ExpansionID}-${localId}`);
            return null;
        }

        const descarga = await axios.get(`https://www.googleapis.com/drive/v3/files/${archivo.id}`, {
            params: { alt: 'media', key: GOOGLE_DRIVE_API_KEY_BOT },
            responseType: 'arraybuffer', timeout: 8000
        });
        fs.mkdirSync(dirCache, { recursive: true });
        fs.writeFileSync(rutaCache, descarga.data);
        return rutaCache;
    } catch (e) {
        registrarErrorDriveHd('normal', cartaId, 'excepcion', `HTTP ${e?.response?.status || '?'} — ${e?.message || e}`);
        return null;
    }
}

// Misma logica que obtenerImagenHDBot, pero contra la carpeta "Gold Frames"
// (id fijo, confirmado 2026-07-27 con la API key ya configurada) -- carpeta
// hermana de la raiz normal, con la misma estructura de subcarpetas por
// expansion, usada solo para las imagenes con borde dorado de /goldcards.
const DRIVE_GOLD_ROOT_FOLDER_ID_BOT = '1QPbJC376ZzsuCY_ME62G8Mq9_eMHL8XA';
const DRIVE_CACHE_DIR_GOLD_BOT = path.join(__dirname, 'assets', 'drive_cache_gold');
const DRIVE_FOLDER_MAP_PATH_GOLD_BOT = path.join(__dirname, 'assets', 'drive_folder_map_gold.json');

let _driveFolderMapCacheGoldBot = null;
async function refrescarMapaCarpetasDriveGoldBot() {
    if (!GOOGLE_DRIVE_API_KEY_BOT) return {};
    try {
        const resp = await axios.get('https://www.googleapis.com/drive/v3/files', {
            params: { q: `'${DRIVE_GOLD_ROOT_FOLDER_ID_BOT}' in parents`, key: GOOGLE_DRIVE_API_KEY_BOT, fields: 'files(id,name)', pageSize: 200 },
            timeout: 5000
        });
        const mapa = {};
        for (const f of resp.data.files || []) {
            const guion = f.name.indexOf('-');
            if (guion === -1) continue;
            mapa[f.name.substring(0, guion)] = f.id;
        }
        if (Object.keys(mapa).length === 0) {
            registrarErrorDriveHd('gold', '(listado de carpetas)', 'raiz_drive_vino_vacia', `la API respondio OK pero 0 subcarpetas -- la key probablemente no tiene acceso a la carpeta raiz "Gold Frames" del Drive`);
        }
        _driveFolderMapCacheGoldBot = mapa;
        fs.writeFileSync(DRIVE_FOLDER_MAP_PATH_GOLD_BOT, JSON.stringify(mapa, null, 2));
        return mapa;
    } catch (e) {
        registrarErrorDriveHd('gold', '(listado de carpetas)', 'excepcion_listando_raiz', `HTTP ${e?.response?.status || '?'} — ${e?.message || e}`);
        return _driveFolderMapCacheGoldBot || {};
    }
}

async function obtenerMapaCarpetasDriveGoldBot() {
    if (_driveFolderMapCacheGoldBot) return _driveFolderMapCacheGoldBot;
    try {
        if (fs.existsSync(DRIVE_FOLDER_MAP_PATH_GOLD_BOT)) {
            _driveFolderMapCacheGoldBot = JSON.parse(fs.readFileSync(DRIVE_FOLDER_MAP_PATH_GOLD_BOT, 'utf8'));
            return _driveFolderMapCacheGoldBot;
        }
    } catch (e) { /* caché corrupto, se reconstruye abajo */ }
    return await refrescarMapaCarpetasDriveGoldBot();
}

async function obtenerImagenGoldBot(cardMap, cartaId) {
    const info = cardMap?.[cartaId];
    if (!info?.ExpansionID || !info?.CollectionNumber || !GOOGLE_DRIVE_API_KEY_BOT || !GOOGLE_DRIVE_HD_ENABLED_BOT) return null;

    const localId = String(info.CollectionNumber).padStart(3, '0');
    const dirCache = path.join(DRIVE_CACHE_DIR_GOLD_BOT, info.ExpansionID);
    const rutaCache = path.join(dirCache, `${localId}.png`);
    if (fs.existsSync(rutaCache)) return rutaCache;

    try {
        let mapaCarpetas = await obtenerMapaCarpetasDriveGoldBot();
        let subfolderId = mapaCarpetas[info.ExpansionID];
        if (!subfolderId) {
            mapaCarpetas = await refrescarMapaCarpetasDriveGoldBot();
            subfolderId = mapaCarpetas[info.ExpansionID];
        }
        if (!subfolderId) {
            registrarErrorDriveHd('gold', cartaId, 'carpeta_expansion_no_encontrada', info.ExpansionID);
            return null;
        }

        const busqueda = await axios.get('https://www.googleapis.com/drive/v3/files', {
            params: { q: `'${subfolderId}' in parents and name contains '${info.ExpansionID}-${localId}'`, key: GOOGLE_DRIVE_API_KEY_BOT, fields: 'files(id,name)', pageSize: 5 },
            timeout: 5000
        });
        const archivo = (busqueda.data.files || [])[0];
        if (!archivo) {
            registrarErrorDriveHd('gold', cartaId, 'archivo_no_encontrado_en_carpeta', `${info.ExpansionID}-${localId}`);
            return null;
        }

        const descarga = await axios.get(`https://www.googleapis.com/drive/v3/files/${archivo.id}`, {
            params: { alt: 'media', key: GOOGLE_DRIVE_API_KEY_BOT },
            responseType: 'arraybuffer', timeout: 8000
        });
        fs.mkdirSync(dirCache, { recursive: true });
        fs.writeFileSync(rutaCache, descarga.data);
        return rutaCache;
    } catch (e) {
        registrarErrorDriveHd('gold', cartaId, 'excepcion', `HTTP ${e?.response?.status || '?'} — ${e?.message || e}`);
        return null;
    }
}

// N+ copias de la misma carta en una cuenta la vuelve "dorada" en el juego
// real (cosmetico, usado para intercambiar) -- N es configurable por usuario
// (ver UMBRAL_GOLD_CARD_DEFAULT/obtenerUmbralGold mas abajo). Escanea todas
// las cuentas JSON una sola vez (no por-carta) y arma un mapa cartaId -> lista
// de cuentas que la tienen, para poder filtrar la lista de seleccion de
// /goldcards a solo las cartas que YA califican en al menos una cuenta.
function construirMapaCopiasPorCarta(rutaJsonCuentas) {
    if (!rutaJsonCuentas || !fs.existsSync(rutaJsonCuentas)) return null;
    const archivos = fs.readdirSync(rutaJsonCuentas).filter(f => f.toLowerCase().endsWith('.json'));
    const mapa = {};

    for (const archivo of archivos) {
        const data = leerJsonSeguro(path.join(rutaJsonCuentas, archivo));
        if (!data || !Array.isArray(data.pulls)) continue;

        const conteoPorCarta = {};
        for (const pull of data.pulls) {
            if (!Array.isArray(pull.cards)) continue;
            for (const id of pull.cards) {
                conteoPorCarta[id] = (conteoPorCarta[id] || 0) + 1;
            }
        }

        const fileName = data.metadata?.fileName || archivo;
        for (const [cartaId, cantidad] of Object.entries(conteoPorCarta)) {
            if (!mapa[cartaId]) mapa[cartaId] = [];
            mapa[cartaId].push({ fileName, cantidad });
        }
    }

    for (const cartaId of Object.keys(mapa)) {
        mapa[cartaId].sort((a, b) => b.cantidad - a.cantidad);
    }
    return mapa;
}

function cuentasGoldParaCarta(mapaCopias, cartaId, umbral = UMBRAL_GOLD_CARD_DEFAULT) {
    return (mapaCopias?.[cartaId] || []).filter(r => r.cantidad >= umbral);
}

// Suma total de copias de una carta entre TODAS las cuentas -- no se usa para
// el badge del collage (ver maxCopiasCarta), queda disponible por si hace
// falta en otro lado.
function sumaCopiasCarta(mapaCopias, cartaId) {
    return (mapaCopias?.[cartaId] || []).reduce((total, r) => total + (r.cantidad || 0), 0);
}

// Bug real 2026-07-30: el badge del collage usaba sumaCopiasCarta (todas las
// cuentas juntas), lo que mostraba numeros gigantes (ej. "x141") para cartas
// repartidas entre muchisimas cuentas con pocas copias cada una -- pero Gold
// Cards califica por "¿ALGUNA cuenta tiene 10+ copias ELLA SOLA?", no por la
// suma total. El resultado confundia: una carta con "x141" en All Cards no
// aparecia en Gold Cards porque ninguna cuenta individual llegaba a 10. Este
// es el numero real que decide si es Gold o no -- el maximo que tiene UNA
// sola cuenta, igual en las tres pantallas (Wishlist/All Cards/Gold Cards).
function maxCopiasCarta(mapaCopias, cartaId) {
    const registros = mapaCopias?.[cartaId] || [];
    return registros.reduce((max, r) => Math.max(max, r.cantidad || 0), 0);
}

// Collage de miniaturas para la pantalla de "elegí la carta" (a pedido
// explicito del usuario 2026-07-30): en vez de solo una lista de texto, arma
// una grilla con la imagen real de cada carta de esta pagina. Sin numero de
// cantidad acá a proposito (mismo pedido, corregido despues) -- mostrar un
// numero en este paso confundia (sumaba entre cuentas, no coincidia con el
// criterio real de Gold Cards). La cantidad real por cuenta se sigue viendo
// mas adelante, al elegir una carta puntual y su XML.
// Usa siempre la imagen LOCAL de baja calidad (encontrarImagenPorIllustration,
// sin red) -- una miniatura chica no necesita HD, y bajar HD de hasta 25
// cartas por cada pantalla seria lento y gastaria disco de mas sin necesidad.
// Las cartas sin imagen local encontrada se saltean (no hay nada que dibujar).
async function generarCollageCartas(items, rutaMasterPath, mapaCopias, esGoldCards = false) {
    if (!items?.length || !rutaMasterPath) return null;
    const cardMap = cargarCardMap(rutaMasterPath);
    const CELL_W = 150, CELL_H = 210, GAP = 8, PADDING = 12;
    const COLS = Math.min(5, items.length);

    const celdas = [];
    let indice = 0;
    for (const item of items) {
        const info = cardMap?.[item.id];
        // Mismo orden que la vista individual de carta (construirEmbedDetalleCarta)
        // -- antes el collage se saltaba directo a local/repositorio y nunca
        // consultaba el Drive, asi que la grilla se veia en baja calidad aunque
        // el toggle "Normal Cards HD" estuviera prendido (bug real reportado
        // 2026-07-31: HD andaba bien al entrar al detalle de una carta, pero no
        // en la grilla de Wishlist/All Cards/Gold Cards).
        const rutaImg = (await obtenerImagenHDBot(cardMap, item.id))
            || encontrarImagenPorIllustration(rutaMasterPath, info?.IllustrationID)
            || (await obtenerImagenRepoCartasBot(rutaMasterPath, info?.IllustrationID));
        if (!rutaImg) continue;

        let imgBuffer;
        try {
            imgBuffer = await sharp(rutaImg).resize(CELL_W, CELL_H, { fit: 'cover' }).png().toBuffer();
        } catch (e) { continue; }

        // Badge de cantidad (a pedido explicito del usuario 2026-07-31): en
        // Gold Cards es el maximo que tiene UNA sola cuenta (el mismo criterio
        // real que decide si califica como Gold). En Wishlist/All Cards es la
        // SUMA entre todas las cuentas (el total real que el usuario tiene) --
        // ahi no hay ninguna calificacion de por medio, asi que mostrar el
        // maximo por cuenta confundia (ej. "x1" con 2 cuentas de 1 copia cada
        // una, cuando en total el usuario tiene 2).
        const cantidad = esGoldCards ? maxCopiasCarta(mapaCopias, item.id) : sumaCopiasCarta(mapaCopias, item.id);
        if (cantidad > 0) {
            const texto = `x${cantidad}`;
            const anchoBadge = 26 + texto.length * 12;
            const svgBadge = Buffer.from(
                `<svg width="${anchoBadge}" height="28">` +
                `<rect x="0" y="0" width="${anchoBadge}" height="28" rx="8" ry="8" fill="black" fill-opacity="0.72"/>` +
                `<text x="${anchoBadge / 2}" y="19" font-size="16" font-family="Arial, sans-serif" font-weight="bold" fill="#FFD700" text-anchor="middle">${texto}</text>` +
                `</svg>`
            );
            try {
                imgBuffer = await sharp(imgBuffer)
                    .composite([{ input: svgBadge, top: CELL_H - 28 - 6, left: CELL_W - anchoBadge - 6 }])
                    .png()
                    .toBuffer();
            } catch (e) { /* si falla el badge, se muestra la imagen sin numero */ }
        }

        const col = indice % COLS;
        const row = Math.floor(indice / COLS);
        celdas.push({ input: imgBuffer, top: PADDING + row * (CELL_H + GAP), left: PADDING + col * (CELL_W + GAP) });
        indice++;
    }
    if (!celdas.length) return null;

    const filas = Math.ceil(indice / COLS);
    const anchoTotal = PADDING * 2 + COLS * CELL_W + (COLS - 1) * GAP;
    const altoTotal = PADDING * 2 + filas * CELL_H + (filas - 1) * GAP;

    try {
        return await sharp({ create: { width: anchoTotal, height: altoTotal, channels: 4, background: { r: 30, g: 30, b: 36, alpha: 1 } } })
            .composite(celdas)
            .png()
            .toBuffer();
    } catch (e) {
        console.error('DEBUG: error armando el collage de cartas:', e?.message || e);
        return null;
    }
}

// Mismo criterio que componerLogoSobreImagen de s4t.js -- agranda el canvas
// hacia arriba y pone el logo de la expansion centrado en esa franja nueva,
// en vez de dejarlo como un thumbnail chico aparte (a pedido explicito del
// usuario 2026-07-31).
async function componerLogoSobreImagenBot(bufferImagen, rutaLogo) {
    if (!rutaLogo) return bufferImagen;
    try {
        const metaImagen = await sharp(bufferImagen).metadata();
        const anchoLogo = Math.round(metaImagen.width * 0.85);
        const logoBuffer = await sharp(rutaLogo)
            .resize({ width: anchoLogo, fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
            .toBuffer();
        const metaLogo = await sharp(logoBuffer).metadata();

        const relleno = 20;
        const altoFranja = metaLogo.height + relleno * 2;
        const altoFinal = metaImagen.height + altoFranja;

        return await sharp({
            create: { width: metaImagen.width, height: altoFinal, channels: 4, background: { r: 30, g: 30, b: 36, alpha: 1 } }
        })
            .composite([
                { input: bufferImagen, left: 0, top: altoFranja },
                { input: logoBuffer, left: Math.round((metaImagen.width - metaLogo.width) / 2), top: relleno }
            ])
            .png()
            .toBuffer();
    } catch (e) {
        console.error('DEBUG: error componiendo logo sobre el collage:', e?.message || e);
        return bufferImagen;
    }
}

// Badge de cantidad superpuesto en la imagen del detalle de carta (a pedido
// explicito del usuario 2026-07-31, mostrando como referencia su propio
// dashboard de PTCGPB) -- mismo estilo visual que ya usa generarCollageCartas,
// pero con el tamaño calculado como % de la imagen real (que acá es la carta
// individual a resolucion completa, no una miniatura de collage de tamaño
// fijo).
async function superponerBadgeCantidadCartaBot(bufferImagen, cantidad) {
    try {
        const meta = await sharp(bufferImagen).metadata();
        const alto = meta.height, ancho = meta.width;
        const texto = `x${cantidad}`;
        const altoBadge = Math.round(alto * 0.09);
        const fontSize = Math.round(altoBadge * 0.55);
        const anchoBadge = Math.round(altoBadge * 0.9 + texto.length * fontSize * 0.62);
        const margen = Math.round(alto * 0.02);
        const svgBadge = Buffer.from(
            `<svg width="${anchoBadge}" height="${altoBadge}">` +
            `<rect x="0" y="0" width="${anchoBadge}" height="${altoBadge}" rx="${Math.round(altoBadge / 3)}" ry="${Math.round(altoBadge / 3)}" fill="black" fill-opacity="0.72"/>` +
            `<text x="${anchoBadge / 2}" y="${Math.round(altoBadge * 0.7)}" font-size="${fontSize}" font-family="Arial, sans-serif" font-weight="bold" fill="#FFD700" text-anchor="middle">${texto}</text>` +
            `</svg>`
        );
        return await sharp(bufferImagen)
            .composite([{ input: svgBadge, top: alto - altoBadge - margen, left: ancho - anchoBadge - margen }])
            .png()
            .toBuffer();
    } catch (e) {
        console.error('DEBUG: error superponiendo badge de cantidad en detalle de carta:', e?.message || e);
        return bufferImagen;
    }
}

const RAREZA_POR_CODIGO = {
    100: '🔹 1 Diamond',
    200: '🔸 2 Diamonds',
    300: '🔷 3 Diamonds',
    400: '💠 4 Diamonds',
    500: '⭐ 1 Star',
    600: '🌈 2 Star Rainbow',
    830: '🌟 1 Star Shiny',
    860: '✨ 2 Star Shiny',
    800: '🌌 Immersive',
    900: '👑 Crown'
};

function categoriaDesdeInfo(info) {
    if (!info) return 'Unknown';
    if (info.Rarity === 700) {
        return info.TrainerType !== undefined ? '⭐⭐ 2 Star Trainer' : '🎨 2 Star Full Art';
    }
    return RAREZA_POR_CODIGO[info.Rarity] || 'Unknown';
}

function tipoRarezaDesdeInfo(info) {
    if (!info) return null;
    if (info.Rarity === 700) return info.TrainerType !== undefined ? '2-star-trainer' : '2-star-full-art';
    const mapa = {
        100: '1-diamond', 200: '2-diamond', 300: '3-diamond', 400: '4-diamond',
        500: '1-star', 600: '2-star-rainbow', 830: '1-star-shiny', 860: '2-star-shiny',
        800: 'immersive', 900: 'crown-rare'
    };
    return mapa[info.Rarity] || null;
}

const RAREZA_ICONOS_CARTAS = {
    '1-diamond': { emoji: 'rareza_diamante', cantidad: 1, etiqueta: '1 Diamond', pipe: true },
    '2-diamond': { emoji: 'rareza_diamante', cantidad: 2, etiqueta: '2 Diamonds', pipe: true },
    '3-diamond': { emoji: 'rareza_diamante', cantidad: 3, etiqueta: '3 Diamonds', pipe: true },
    '4-diamond': { emoji: 'rareza_diamante', cantidad: 4, etiqueta: '4 Diamonds', pipe: true },
    '1-star': { emoji: 'rareza_estrella', cantidad: 1, etiqueta: '1 Star', pipe: false },
    '1-star-shiny': { emoji: 'rareza_brillante', cantidad: 1, etiqueta: '1 Star Shiny', pipe: true },
    '2-star-trainer': { emoji: 'rareza_estrella', cantidad: 2, etiqueta: 'Trainer', pipe: true },
    '2-star-rainbow': { emoji: 'rareza_estrella', cantidad: 2, etiqueta: 'Rainbow', pipe: true, distintivo: '🌈' },
    '2-star-full-art': { emoji: 'rareza_estrella', cantidad: 2, etiqueta: 'Full Art', pipe: true, distintivo: '🎨' },
    '2-star-shiny': { emoji: 'rareza_brillante', cantidad: 2, etiqueta: 'Shiny', pipe: true },
    'crown-rare': { emoji: 'rareza_corona', cantidad: 1, etiqueta: 'Crown', pipe: false },
    'immersive': { emoji: 'rareza_estrella', cantidad: 3, etiqueta: 'Immersive', pipe: true, distintivo: '🌌' }
};

// mapaEmojis: { nombreEmoji: idEmoji }, resuelto por servidor vía
// obtenerMapaEmojisGuild() (guild-emojis.js) — cada aplicación de bot tiene
// sus propios IDs de emoji, por eso ya no se puede usar un JSON hardcodeado.
function formatearCategoriaConIcono(tipo, mapaEmojis) {
    const config = tipo ? RAREZA_ICONOS_CARTAS[tipo] : null;
    if (!config) return null;

    const idEmoji = mapaEmojis?.[config.emoji];
    const tagIcono = idEmoji ? `<:${config.emoji}:${idEmoji}>` : '';
    if (!tagIcono) return null;

    const iconos = new Array(config.cantidad).fill(tagIcono).join('');
    const sufijo = config.distintivo ? `${config.distintivo} ${config.etiqueta}` : config.etiqueta;
    return config.pipe ? `${iconos} | ${sufijo}` : `${iconos} ${sufijo}`;
}

function categoriaFormateadaDesdeInfo(info, mapaEmojis) {
    const tipo = tipoRarezaDesdeInfo(info);
    return formatearCategoriaConIcono(tipo, mapaEmojis) || categoriaDesdeInfo(info);
}

function resolverCategoriaCarta(cartaId, rutaMasterPath) {
    if (!rutaMasterPath) return 'Unknown';
    const cardmaster = leerJsonSeguro(path.join(rutaMasterPath, 'cardmaster.json'));
    return categoriaDesdeInfo(cardmaster?.[cartaId]);
}

function resolverCategoriaFormateadaCarta(cartaId, rutaMasterPath, mapaEmojis) {
    if (!rutaMasterPath) return 'Unknown';
    const cardmaster = leerJsonSeguro(path.join(rutaMasterPath, 'cardmaster.json'));
    return categoriaFormateadaDesdeInfo(cardmaster?.[cartaId], mapaEmojis);
}

// Las cartas de Entrenador (Partidario/Objeto/Herramienta/Fósil/Estadio) no
// tienen elemento (Fuego, Agua, etc.) — cardmaster.json las distingue con el
// campo TrainerType (1=Partidario, 2=Objeto, 3=Herramienta, 4=Fósil,
// 5=Estadio), presente sin importar la rareza de la carta. Fósil y Estadio
// todavía no tienen ícono propio en assets/element, por eso caen al genérico
// de Trainer (bolsa_monedas) hasta que se agregue uno.
const EMOJI_POR_TRAINER_TYPE = { 1: 'card_supporter', 2: 'card_item', 3: 'card_tool' };
function trainerTypeDesdeId(cartaId, rutaMasterPath) {
    if (!rutaMasterPath) return undefined;
    const cardmaster = leerJsonSeguro(path.join(rutaMasterPath, 'cardmaster.json'));
    return cardmaster?.[cartaId]?.TrainerType;
}

async function construirEmbedDetalleCarta(cartaId, nombre, rutaMasterPath, volver = null, guild = null, datosGold = null) {
    const mapaEmojis = await obtenerMapaEmojisGuild(guild);
    const cardMap = cargarCardMap(rutaMasterPath);
    const en_US = rutaMasterPath ? leerJsonSeguro(path.join(rutaMasterPath, 'en_US.json')) : null;
    const info = cardMap?.[cartaId];
    const expansiones = construirMapaExpansiones(en_US);
    const expansionNombre = info?.ExpansionID ? (expansiones[info.ExpansionID] || info.ExpansionID) : 'Unknown';
    const categoria = resolverCategoriaFormateadaCarta(cartaId, rutaMasterPath, mapaEmojis);
    // datosGold (solo lo pasa /goldcards) -- usa la imagen con borde dorado si
    // existe para esa carta. Si NO existe (2026-08-06, a pedido explicito del
    // usuario), YA NO cae a la version sin dorar (confundia -- parecia que la
    // carta ya calificaba) -- en su lugar se marca sinBordeGold y mas abajo se
    // muestra una imagen de disculpa + aviso en vez de la carta.
    let sinBordeGold = false;
    let imagenPath;
    if (datosGold) {
        imagenPath = await obtenerImagenGoldBot(cardMap, cartaId);
        if (!imagenPath) sinBordeGold = true;
    } else {
        imagenPath = (await obtenerImagenHDBot(cardMap, cartaId))
            || encontrarImagenPorIllustration(rutaMasterPath, info?.IllustrationID)
            || (await obtenerImagenRepoCartasBot(rutaMasterPath, info?.IllustrationID));
    }

    const tipoIngles = cargarCardTypesBot()[clavenormalizadaTipoCarta(nombre)];
    const trainerType = trainerTypeDesdeId(cartaId, rutaMasterPath);
    let elemento;
    if (tipoIngles) {
        const tagElemento = tagTipoBot(`type_${tipoIngles.toLowerCase()}`, mapaEmojis);
        elemento = tagElemento ? `${tagElemento} ${tipoIngles}` : tipoIngles;
    } else if (trainerType !== undefined) {
        const nombreEmoji = EMOJI_POR_TRAINER_TYPE[trainerType] || 'bolsa_monedas';
        const tagTrainer = tagTipoBot(nombreEmoji, mapaEmojis);
        elemento = tagTrainer ? `${tagTrainer} Trainer` : 'Trainer';
    } else {
        elemento = 'Unknown';
    }

    // Cantidad total (a pedido explicito del usuario 2026-07-31): suma entre
    // TODAS las cuentas guardadas, mismo criterio que ya usa el collage de
    // Wishlist/All Cards ("cuantas tengo en total") -- en Gold Cards no hace
    // falta, ese contexto ya muestra su propio detalle de cuentas calificadas
    // mas abajo (datosGold). Se muestra como badge superpuesto en la esquina
    // de la imagen (mismo estilo que el collage), no como texto en el embed --
    // a pedido explicito del usuario, mostrando como referencia el estilo de
    // badge que ya usa en otras pantallas.
    let cantidadTotal = 0;
    if (!datosGold) {
        const rutaJsonCfg = await db.get(`SELECT webhook_url FROM configs_canales WHERE tipo = 'ruta_json_cuentas'`);
        const mapaCopias = construirMapaCopiasPorCarta(rutaJsonCfg?.webhook_url);
        cantidadTotal = sumaCopiasCarta(mapaCopias, cartaId);
    }

    const embed = new EmbedBuilder()
        .setTitle(`🔎 ${nombre}`)
        .setDescription(`**Expansion:** ${expansionNombre}\n**Name:** ${nombre}\n**Element:** ${elemento}\n**Category:** ${categoria}\n**ID:** \`${cartaId}\``)
        .setColor(0xE91E63);

    if (datosGold && datosGold.cuentas.length) {
        const listaGold = datosGold.cuentas.map(r => `\`${r.fileName}\` — x${r.cantidad}`).join('\n');
        embed.addFields({ name: `🏆 Gold Accounts (${datosGold.umbral}+ copies)`, value: listaGold.slice(0, 1024) });
    }
    if (sinBordeGold) {
        embed.addFields({ name: '😔 Gold border not available yet', value: "Sorry, we don't have this card's gold border yet. We'll update it as soon as we do!" });
    }

    // En Gold Cards, "XML" tiene que mostrar SOLO las cuentas que ya califican
    // (10+ copias, igual que el campo de arriba) -- no la busqueda generica de
    // "cualquier cuenta con al menos 1 copia" que usa AllCards/Wishlist, que
    // en este contexto confunde (puede mostrar cientos de cuentas que no
    // sirven para nada acá).
    const botonXmlId = datosGold ? `goldcards_xml::${cartaId}::0` : `wishlist_xml::${cartaId}::0`;
    const botones = [new ButtonBuilder().setCustomId(botonXmlId).setLabel('💠 XML').setStyle(ButtonStyle.Success)];
    // "volver" solo existe cuando se llegó acá desde la lista de cartas de una
    // expansión+categoría (no desde la búsqueda directa por autocompletado de
    // /card, que no tiene una pantalla anterior a la que volver).
    if (volver) {
        botones.push(
            new ButtonBuilder()
                .setCustomId(`${volver.prefijo}_volver_carta_lista::${volver.expansion}::${volver.categoria}::${volver.pagina}`)
                .setLabel('🔙 Back')
                .setStyle(ButtonStyle.Secondary)
        );
    }
    // "Inicio" siempre está disponible (venga o no de la lista de cartas) — salta
    // directo a la lista de expansiones, reusando el mismo handler que ya tiene
    // ese botón en la lista de expansiones/categorías.
    botones.push(
        new ButtonBuilder()
            .setCustomId(`${volver?.prefijo || 'allcards'}_volver_expansiones`)
            .setLabel('🏠 Home')
            .setStyle(ButtonStyle.Secondary)
    );
    // Info Accounts va en esta primera fila (no en la de abajo) para que
    // queden 3 botones arriba y 3 abajo en vez de 2 y 4 (a pedido explicito
    // del usuario 2026-07-31, "que se vean 3 arriba y 3 abajo").
    botones.push(
        new ButtonBuilder()
            .setCustomId(datosGold ? `goldcards_info_accounts::${cartaId}` : `card_info_accounts::${cartaId}`)
            .setLabel('📋 Info Accounts')
            .setStyle(ButtonStyle.Secondary)
    );
    const filaXml = new ActionRowBuilder().addComponents(...botones);

    // En Gold Cards, Trade/Shinedust tienen su propio boton de entrada
    // (goldcards_trade::/goldcards_shinedust::) que solo lista las cuentas ya
    // calificadas -- entradas separadas de las de AllCards/Wishlist, para que
    // un bug ahi nunca las afecte, pero comparten la MISMA ejecucion de abajo
    // (instancia, inyeccion, OCR) ya probada.
    // Trade reactivado (2026-08-03) para probar si sigue funcionando tras la update --
    // Shinedust ya se reactivo antes (2026-08-01) y se confirmo funcionando.
    const filaAcciones = new ActionRowBuilder().addComponents(
        // Deshabilitado en Gold Cards a pedido explicito del usuario 2026-08-06.
        new ButtonBuilder().setCustomId(datosGold ? `goldcards_trade::${cartaId}` : `card_trade::${cartaId}`).setLabel('🔄 Trade').setStyle(ButtonStyle.Primary).setDisabled(!!datosGold),
        new ButtonBuilder().setCustomId(datosGold ? `goldcards_shinedust::${cartaId}` : `card_shinedust::${cartaId}`).setLabel('👛 Shinedust').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(datosGold ? `goldcards_extract::${cartaId}` : `card_extract::${cartaId}`).setLabel('📄 Extract XML').setStyle(ButtonStyle.Secondary)
    );

    const payload = { embeds: [embed], components: [filaXml, filaAcciones] };
    const archivosPayload = [];
    if (sinBordeGold) {
        // Sin logo/badge compuestos encima -- esta imagen no es la carta real,
        // superponerle el logo de la expansion daria a entender que si lo es.
        const imagenDisculpa = elegirImagenDisculpaGoldAleatoria();
        if (imagenDisculpa) {
            embed.setImage('attachment://carta.png');
            archivosPayload.push(new AttachmentBuilder(imagenDisculpa, { name: 'carta.png' }));
        }
    } else if (imagenPath) {
        // Logo compuesto arriba de la carta en una sola imagen (mismo criterio
        // que ya usa s4t.js/el preview de /embed), en vez de una miniatura
        // aparte en la esquina.
        let buffer = fs.readFileSync(imagenPath);
        const rutaLogo = buscarLogoExpansionBot(expansionNombre);
        if (rutaLogo) buffer = await componerLogoSobreImagenBot(buffer, rutaLogo);
        if (cantidadTotal > 0) buffer = await superponerBadgeCantidadCartaBot(buffer, cantidadTotal);
        embed.setImage('attachment://carta.png');
        archivosPayload.push(new AttachmentBuilder(buffer, { name: 'carta.png' }));
    }
    if (fs.existsSync(SYMBOL_EMBEDS_PATH)) {
        embed.setThumbnail('attachment://symbol.png');
        archivosPayload.push(new AttachmentBuilder(SYMBOL_EMBEDS_PATH, { name: 'symbol.png' }));
    }
    if (archivosPayload.length) payload.files = archivosPayload;
    return payload;
}

function construirEmbedExtractXmlInicio(user, mapaEmojis = {}) {
    const tagOak = tagTipoBot('carta_profesor_oak', mapaEmojis);
    const tagPokeBall = tagTipoBot('item_poke_ball', mapaEmojis);
    return new EmbedBuilder()
        .setTitle('📄 Extract XML')
        .setDescription(
            `Command run by <@${user.id}>.${tagOak ? ' ' + tagOak : ''}\n\n` +
            `Click the button and paste the XML file name (for example, \`134P_20260120113013_2(BXR).xml\`) so the bot can send it to you. It will also send you the .JSON file with all your account data in XML format!${tagPokeBall ? ' ' + tagPokeBall : ''}`
        )
        .setColor(0x3498DB)
        .setFooter({ text: " Bot By Ale Cast ୨♡୧" })
        .setTimestamp();
}

function construirEmbedRunInstanceInicio(user) {
    return new EmbedBuilder()
        .setTitle('🔄 Trading')
        .setDescription(
            `Command run by <@${user.id}>.\n\n` +
            `Trades now run automatically from the 🔄 Trade button on a card lookup (/card, /wishlist, Gold Cards) - no need to open instances or pick friends by hand here anymore.`
        )
        .setColor(0x2ECC71)
        .setFooter({ text: " Bot By Ale Cast ୨♡୧" })
        .setTimestamp();
}

function rutaMuMuManager() {
    // Antes solo miraba el disco C: — un usuario real lo tenía instalado en
    // D: (instalador de MuMuPlayer deja elegir disco) y el bot decía "not
    // found" pese a estar instalado. Se prueban las mismas rutas conocidas en
    // cualquier disco de A a J (cubre discos externos/particiones extra sin
    // tener que pedirle la ruta exacta a cada usuario).
    const carpetas = ['MuMuPlayer', 'MuMuPlayerGlobal-12.0'];
    const subrutas = ['nx_main', 'shell'];
    const discos = 'CDEFGHIJ'.split('');
    for (const disco of discos) {
        for (const carpeta of carpetas) {
            for (const sub of subrutas) {
                const candidato = `${disco}:\\Program Files\\Netease\\${carpeta}\\${sub}\\MuMuManager.exe`;
                if (fs.existsSync(candidato)) return candidato;
            }
        }
    }
    return null;
}

function obtenerInstanciasMuMu() {
    const managerPath = rutaMuMuManager();
    if (!managerPath) return null;
    try {
        const salida = execSync(`"${managerPath}" info -v all`, { windowsHide: true }).toString();
        const data = JSON.parse(salida);
        return Object.values(data)
            .filter(i => i.name !== 'NO TOCAR')
            .sort((a, b) => parseInt(a.index, 10) - parseInt(b.index, 10));
    } catch (e) {
        return null;
    }
}

function lanzarInstanciaMuMu(index) {
    const managerPath = rutaMuMuManager();
    if (!managerPath) return false;
    try {
        execSync(`"${managerPath}" control launch -v ${index}`, { windowsHide: true });
        return true;
    } catch (e) {
        // Antes se tragaba el error en silencio — si MuMuManager rechaza el
        // comando (índice inválido, instancia ya prendida, etc.) no quedaba
        // ningún rastro de por qué "Turn On" no hacía nada.
        console.error(`DEBUG: MuMuManager rechazó "control launch -v ${index}":`, e?.stderr?.toString() || e?.message || e);
        return false;
    }
}

// El script de inyección de Kevin (_InjectAccount.ahk) requiere que la instancia YA
// esté prendida -- no la prende él. Los atajos de Trade/Shinedust (a diferencia del
// panel manual de MuMu, que siempre pasa primero por "Turn On") saltan directo a
// elegir instancia, así que hay que prenderla nosotros si hace falta antes de inyectar.
async function asegurarInstanciaEncendida(index, timeoutMs = 90000) {
    const instancias = obtenerInstanciasMuMu();
    const info = instancias?.find(i => String(i.index) === String(index));
    if (info?.is_android_started) return true;
    if (!lanzarInstanciaMuMu(index)) return false;

    const limite = Date.now() + timeoutMs;
    while (Date.now() < limite) {
        await new Promise(r => setTimeout(r, 3000));
        const actuales = obtenerInstanciasMuMu();
        const actual = actuales?.find(i => String(i.index) === String(index));
        if (actual?.is_android_started) {
            await new Promise(r => setTimeout(r, 2000)); // margen para que la ventana termine de aparecer
            return true;
        }
    }
    return false;
}

// Usado por el boton "Retry" de Main Trade (2026-08-05): a diferencia de
// asegurarInstanciaEncendida, que no hace nada si is_android_started ya viene en true
// (una instancia con el JUEGO colgado adentro sigue reportando Android como "prendido"),
// esta fuerza un apagado real antes de reintentar -- confirmado por el usuario que el
// Retry no reiniciaba nada de verdad porque la instancia nunca llegaba a apagarse.
async function asegurarInstanciaApagada(index, timeoutMs = 30000) {
    if (!apagarInstanciaMuMu(index)) return false;
    const limite = Date.now() + timeoutMs;
    while (Date.now() < limite) {
        await new Promise(r => setTimeout(r, 2000));
        const actuales = obtenerInstanciasMuMu();
        const actual = actuales?.find(i => String(i.index) === String(index));
        if (!actual?.is_android_started) return true;
    }
    return false;
}

// Usado por el botón "Close Instance" del aviso de heartbeat cuando la
// instancia ya se quedó sin cuentas de 24h (ver instanciaSinCuentasElegibles
// en heartbeat.js) — no tiene sentido dejarla prendida consumiendo recursos
// si no le quedan cuentas para abrir hoy.
function apagarInstanciaMuMu(index) {
    const managerPath = rutaMuMuManager();
    if (!managerPath) return false;
    try {
        execSync(`"${managerPath}" control shutdown -v ${index}`, { windowsHide: true });
        return true;
    } catch (e) {
        console.error(`DEBUG: MuMuManager rechazó "control shutdown -v ${index}":`, e?.stderr?.toString() || e?.message || e);
        return false;
    }
}

// Cooldown simple en memoria para el botón 🛑 Stop del trade automático (a
// pedido explicito del usuario 2026-07-27) -- evita que alguien pare y
// relance la misma instancia en loop inmediato, dando tiempo real a que MuMu
// y el script de inyección terminen de cerrar antes de la próxima corrida.
const cooldownStopTradeInstancia = new Map(); // index -> timestamp hasta el que queda bloqueado
const COOLDOWN_STOP_TRADE_MS = 30 * 1000;

// Controla la ventana del AHK de UNA instancia puntual (título exacto
// "{N}.ahk", confirmado en vivo) desde afuera — nunca toca ni lee el
// contenido de esos scripts, que son de Kevin y no se tocan sin permiso. El
// script (scripts/ahk-window.ps1, de este proyecto) solo usa EnumWindows para
// encontrar la ventana y o le manda Shift+F5 (mismo atajo que ya tiene el
// programa para "Reload") o cierra el proceso — ninguna de las dos cosas
// edita ningún archivo de Kevin.
function ejecutarAccionAhkInstancia(index, accion) {
    const rutaScript = path.join(__dirname, 'scripts', 'ahk-window.ps1');
    if (!fs.existsSync(rutaScript)) return false;
    try {
        const salida = execSync(
            `powershell -NoProfile -ExecutionPolicy Bypass -File "${rutaScript}" -InstanceId "${index}" -Action "${accion}"`,
            { windowsHide: true, timeout: 10000 }
        ).toString().trim();
        return salida.startsWith('RELOADED:') || salida.startsWith('CLOSED:');
    } catch (e) {
        console.error(`DEBUG: error ejecutando acción "${accion}" sobre el AHK de la instancia ${index}:`, e?.stderr?.toString() || e?.message || e);
        return false;
    }
}

function construirEmbedInstanciasMuMu(instancias, seleccion = null) {
    const listaTexto = instancias.length
        ? instancias.map(i => `**${i.index}.** ${i.name} — ${i.is_android_started ? '🟢 On' : '🔴 Off'}`).join('\n')
        : 'No instances found.';

    const embed = new EmbedBuilder()
        .setTitle('🎮 MuMuPlayer Instances')
        .setDescription(listaTexto)
        .setColor(0x2ECC71)
        .setFooter({ text: `${instancias.length} instance(s)` });

    const componentes = [];
    if (instancias.length) {
        const menu = new StringSelectMenuBuilder()
            .setCustomId('mumu_instancia_seleccion')
            .setPlaceholder('Select an instance')
            .addOptions(instancias.slice(0, 25).map(i => ({
                label: `${i.index}. ${i.name}`.slice(0, 100),
                description: i.is_android_started ? 'On' : 'Off',
                value: `${i.index}::${i.name}`,
                default: !!seleccion && String(seleccion.index) === String(i.index)
            })));
        componentes.push(new ActionRowBuilder().addComponents(menu));
    }

    if (!seleccion) {
        // Sin esto, la única forma de ver si una instancia ya prendió (fuera
        // de la seleccionada) era volver a abrir "View Instances" desde cero.
        componentes.push(new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('mumu_refrescar').setLabel('🔄 Refresh').setStyle(ButtonStyle.Secondary)
        ));
    }

    if (seleccion) {
        embed.addFields({ name: '🖱️ Selected', value: `**${seleccion.index}. ${seleccion.name}** — ${seleccion.encendida ? '🟢 On' : '🔴 Off'}` });

        componentes.push(new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`mumu_encender_${seleccion.index}::${seleccion.name}`)
                .setLabel(seleccion.encendida ? '✅ On' : '🟢 Turn On')
                .setStyle(seleccion.encendida ? ButtonStyle.Secondary : ButtonStyle.Success)
                .setDisabled(!!seleccion.encendida),
            new ButtonBuilder()
                .setCustomId(`mumu_refrescar::${seleccion.index}::${seleccion.name}`)
                .setLabel('🔄 Refresh')
                .setStyle(ButtonStyle.Secondary)
        ));

        // XML y Submit se sacaron de acá (rediseño 2026-07-27, a pedido
        // explícito del usuario): la inyección real ahora siempre pasa por el
        // flujo automático nuevo que arranca desde el botón Trade de una carta
        // (pregunta Friend ID -> cuenta -> ejecuta solo), no por este panel
        // manual. Settings Trade queda solo para configurar amigos guardados
        // y ver status.
        componentes.push(new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`mumu_friendid_${seleccion.index}::${seleccion.name}`).setLabel('🆔 Add Friend').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId(`mumu_status_${seleccion.index}::${seleccion.name}`).setLabel('📊 Status').setStyle(ButtonStyle.Secondary)
        ));
    }

    return { embeds: [embed], components: componentes };
}

function derivarRutasDesdeRaiz(raiz) {
    const base = raiz.replace(/[\\/]+$/, '');
    return {
        local: path.join(base, 'Accounts', 'Saved', 'balance_result.txt'),
        master: path.join(base, 'Helper'),
        xml: path.join(base, 'Accounts', 'Saved'),
        json: path.join(base, 'Accounts', 'Cards', 'accounts'),
        wishlist: path.join(base, 'Accounts', 'Cards'),
        injectIni: path.join(base, 'Accounts', 'InjectAccount.ini'),
        injectScript: path.join(base, 'Accounts', '_InjectAccount.ahk'),
        mainAhk: path.join(base, 'Scripts', 'Main.ahk')
    };
}

// Main.ahk (el bot de Kevin) vive en la carpeta personal de cada usuario, NO
// empaquetada con el bot -- correrlo tal cual necesitaria los ~30 archivos de
// Include y todas las imagenes Needle de Kevin, no solo los 11 que ya usamos.
// Mas simple y ya establecido: igual que la inyeccion (obtenerRutasInject), se
// deriva de "Main Path" (ruta_raiz) que cada usuario configura por su cuenta.
const RUTA_MAIN_AHK_DEFAULT = 'C:\\POKEMON\\PTCGPB-ALE\\Scripts\\Main.ahk';

async function obtenerRutaMainAhk(discordId) {
    const fila = await db.get(`SELECT webhook_url FROM configs_canales WHERE tipo = 'ruta_main_ahk' AND discord_id = ?`, [discordId]);
    return fila?.webhook_url || RUTA_MAIN_AHK_DEFAULT;
}

// Antes hardcodeado a la PC de Ale (funcionaba solo para él) -- cualquier otro
// usuario del panel de MuMu (Add Friend/Submit/Status) recibía "Could not save
// the selection to InjectAccount.ini" porque esa carpeta no existe en su PC.
// Ahora se deriva de "Main Path" (ruta_raiz), que cada usuario ya configura por
// su cuenta -- con respaldo a la ruta vieja de Ale si todavía no la configuró
// con las claves nuevas (ruta_inject_ini/ruta_inject_script).
const RUTA_INJECT_INI_DEFAULT = 'C:\\POKEMON\\PTCGPB-ALE\\Accounts\\InjectAccount.ini';
const RUTA_INJECT_ACCOUNT_SCRIPT_DEFAULT = 'C:\\POKEMON\\PTCGPB-ALE\\Accounts\\_InjectAccount.ahk';

async function obtenerRutasInject(discordId) {
    const filaIni = await db.get(`SELECT webhook_url FROM configs_canales WHERE tipo = 'ruta_inject_ini' AND discord_id = ?`, [discordId]);
    const filaScript = await db.get(`SELECT webhook_url FROM configs_canales WHERE tipo = 'ruta_inject_script' AND discord_id = ?`, [discordId]);
    return {
        rutaIni: filaIni?.webhook_url || RUTA_INJECT_INI_DEFAULT,
        rutaScript: filaScript?.webhook_url || RUTA_INJECT_ACCOUNT_SCRIPT_DEFAULT
    };
}

function rutaAutoHotkey() {
    const candidatos = [
        'C:\\Program Files\\AutoHotkey\\v1.1.37.02\\AutoHotkeyU64.exe',
        'C:\\Program Files\\AutoHotkey\\v1.1.37.02\\AutoHotkeyU32.exe'
    ];
    return candidatos.find(p => fs.existsSync(p)) || null;
}

function actualizarIniInject(cambios, rutaIni = RUTA_INJECT_INI_DEFAULT) {
    let contenido = fs.readFileSync(rutaIni, 'utf16le');
    const tieneBOM = contenido.charCodeAt(0) === 0xFEFF;
    if (tieneBOM) contenido = contenido.slice(1);

    const claves = Object.keys(cambios);
    const encontradas = new Set();
    const nuevasLineas = contenido.split(/\r?\n/).map(linea => {
        for (const clave of claves) {
            if (new RegExp(`^${clave}\\s*=`).test(linea)) {
                encontradas.add(clave);
                return `${clave}=${cambios[clave]}`;
            }
        }
        return linea;
    });
    for (const clave of claves) {
        if (!encontradas.has(clave)) nuevasLineas.push(`${clave}=${cambios[clave]}`);
    }

    let salida = nuevasLineas.join('\r\n');
    if (tieneBOM) salida = String.fromCharCode(0xFEFF) + salida;
    fs.writeFileSync(rutaIni, salida, 'utf16le');
}

function guardarXmlParaInyeccion(instanceName, archivoPath, rutaIni = RUTA_INJECT_INI_DEFAULT) {
    const nombreSinExt = path.basename(archivoPath, '.xml');
    actualizarIniInject({
        winTitle: instanceName,
        fileName: nombreSinExt,
        selectedFilePath: archivoPath
    }, rutaIni);
}

function leerIniInject(rutaIni = RUTA_INJECT_INI_DEFAULT) {
    if (!fs.existsSync(rutaIni)) return {};
    let contenido = fs.readFileSync(rutaIni, 'utf16le');
    if (contenido.charCodeAt(0) === 0xFEFF) contenido = contenido.slice(1);
    const datos = {};
    for (const linea of contenido.split(/\r?\n/)) {
        const idx = linea.indexOf('=');
        if (idx === -1 || linea.trim().startsWith('[')) continue;
        datos[linea.slice(0, idx).trim()] = linea.slice(idx + 1);
    }
    return datos;
}

function parsearListaFriends(rutaIni = RUTA_INJECT_INI_DEFAULT) {
    const datos = leerIniInject(rutaIni);
    const ids = (datos.favoriteFriendIDs || '').split(',').map(s => s.trim()).filter(Boolean);
    const labels = (datos.favoriteFriendLabels || '').split('|').map(s => s.trim());
    return ids.map((id, i) => ({ id, label: labels[i] || '' }));
}

// A pedido explicito del usuario 2026-07-28: al presionar 🔄 Trade en
// AllCards/Wishlist/GoldCards, el bot tiene que reenviar la carta COMPLETA
// (misma imagen/embed que ya se estaba viendo) al canal de Trading -- nunca
// mostrar el selector de modo/amigo/cuenta como un texto suelto en el canal
// donde se buscó la carta. A partir de acá, todos los pasos siguientes editan
// ESE MISMO mensaje del canal de Trading (interaction.update), así que nunca
// vuelve a aparecer nada de este flujo en otro canal.
//
// IMPORTANTE: arma la carta completa (imagen HD/Gold, emojis, etc.) antes de
// responder, lo que puede tardar más de los 3 segundos que da Discord para el
// primer ack -- por eso el LLAMADOR tiene que hacer interaction.deferReply()
// ANTES de invocar esta función (acá se usa editReply, nunca reply directo).
async function reenviarCartaATrading(interaction, cartaId, datosGold, componentes) {
    const rutaMasterCfg = await db.get(`SELECT webhook_url FROM configs_canales WHERE tipo = 'ruta_master'`);
    const nombreCarta = resolverNombreCarta(cartaId, rutaMasterCfg?.webhook_url);
    const payload = await construirEmbedDetalleCarta(cartaId, nombreCarta, rutaMasterCfg?.webhook_url, null, interaction.guild, datosGold);
    payload.components = componentes;

    const canalTrading = await obtenerCanalComando(interaction.user.id, 'cmd_run_instance');
    if (!canalTrading?.webhook_url) {
        return await interaction.editReply({ content: '❌ Your **Trading** channel isn\'t set up yet. Run **Sync Channels** first.' });
    }
    try {
        const webhookTrading = new WebhookClient({ url: canalTrading.webhook_url });
        await webhookTrading.send({ content: `<@${interaction.user.id}>`, embeds: payload.embeds, files: payload.files, components: payload.components });
        return await interaction.editReply({ content: '✅ Sent to your Trading channel.' });
    } catch (e) {
        console.error('DEBUG: error mandando la carta al canal de trading:', e?.message || e);
        return await interaction.editReply({ content: '❌ Could not send to your Trading channel.' });
    }
}

// Segundo paso en adelante (ya parado en el mensaje del canal de Trading):
// pregunta a que amigo guardado se le manda la solicitud en ESTE trade
// puntual -- antes se dependia de lo que hubiera quedado tildado en el .ini
// de una vez anterior, ahora queda explicito por trade. El LLAMADOR ya hizo
// interaction.deferUpdate() antes de invocar esto -- acá se usa editReply.
// "modo" ('friend' o 'main') viaja en el customId hasta la ejecución final
// (card_trade_instancia::), donde decide si se hace el flujo manual de
// siempre (inyecta + manda solicitud, el usuario termina a mano) o el ciclo
// automático completo (Main Trade). En modo 'main', el amigo elegido acá
// representa a la propia cuenta Main (el usuario ya la tiene guardada como
// un "amigo" más en su lista, ej. "Ale Cast") -- no hace falta ninguna
// configuración nueva para esto.
async function actualizarConSeleccionFriendId(interaction, cartaId, origen, modo = 'friend') {
    const { rutaIni } = await obtenerRutasInject(interaction.user.id);
    const friends = parsearListaFriends(rutaIni);
    if (!friends.length) {
        return await interaction.editReply({ content: '❌ You don\'t have any saved friends yet. Add one first from **🆔 Add Friend** in /setup.', components: [] });
    }

    const menu = new StringSelectMenuBuilder()
        .setCustomId(`card_trade_friendid::${origen}::${modo}::${cartaId}`.slice(0, 100))
        .setPlaceholder('Select which friend to send the request to')
        .addOptions(friends.slice(0, 25).map(f => ({
            label: `${f.label || '(no name)'} — ${f.id}`.slice(0, 100),
            value: f.id
        })));
    return await interaction.editReply({ content: 'Which friend do you want to send the trade request to?', components: [new ActionRowBuilder().addComponents(menu)] });
}

function construirEmbedStatusInstancia(index, name, rutaIni = RUTA_INJECT_INI_DEFAULT) {
    const datos = leerIniInject(rutaIni);
    const friends = parsearListaFriends(rutaIni);

    const listaFriends = friends.length > 0
        ? friends.map((f, i) => `**${i + 1}.** ${f.label || '(no name)'} — \`${f.id}\``).join('\n')
        : '_None added._';

    const xmlCoincide = (datos.winTitle || '').trim() === name && !!(datos.selectedFilePath || '').trim();
    const xmlTexto = (datos.selectedFilePath || '').trim()
        ? `📄 \`${datos.fileName || ''}\`\n📁 \`${datos.selectedFilePath}\`\n🎯 Saved instance: **${datos.winTitle || '(empty)'}** ${xmlCoincide ? '✅ matches this instance' : '⚠️ does NOT match this instance'}`
        : '_No XML selected._';

    const enviarSolicitud = datos.sendFriendRequestAfterInject === '1' ? '✅ Yes' : '❌ No';

    const embed = new EmbedBuilder()
        .setTitle(`📊 Status — Instance ${index}. ${name}`)
        .addFields(
            { name: `🆔 Saved friends (${friends.length}/10)`, value: listaFriends },
            { name: '💠 XML for injection', value: xmlTexto },
            { name: '📨 Send request after injecting', value: enviarSolicitud, inline: true }
        )
        .setColor(0x3498DB);

    return { embeds: [embed], ephemeral: true };
}

// Reusado tanto al abrir "📊 Status ID" como despues de borrar un amigo (para
// refrescar la misma lista in-place). El boton de borrar solo aparece si hay
// algo guardado -- a pedido explicito del usuario 2026-07-30: antes solo se
// podia agregar amigos, no habia forma de sacar uno de la lista.
function construirPayloadStatusFriends(friends) {
    const lista = friends.length > 0
        ? friends.map((f, i) => `**${i + 1}.** ${f.label || '(no name)'} — \`${f.id}\``).join('\n')
        : '_None added._';
    const embed = new EmbedBuilder()
        .setTitle('🆔 Status ID — Saved Friends')
        .addFields({ name: `🆔 Saved friends (${friends.length}/10)`, value: lista })
        .setColor(0x3498DB);
    const components = [];
    if (friends.length > 0) {
        components.push(new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('setup_remove_friend').setLabel('🗑️ Remove Friend').setStyle(ButtonStyle.Danger)
        ));
    }
    return { embeds: [embed], components };
}

function quitarFriend(friendId, rutaIni = RUTA_INJECT_INI_DEFAULT) {
    const actuales = parsearListaFriends(rutaIni);
    const restantes = actuales.filter(f => f.id !== friendId);
    if (restantes.length === actuales.length) return { ok: false, motivo: 'no_encontrado' };

    const idsCsv = restantes.map(f => f.id).join(',');
    const labelsPipe = restantes.map(f => f.label).join('|');

    actualizarIniInject({
        favoriteFriendIDs: idsCsv,
        favoriteFriendLabels: labelsPipe,
        injectSelectedFriendIDs: idsCsv
    }, rutaIni);

    return { ok: true, total: restantes.length };
}

function agregarFriend(label, friendId, rutaIni = RUTA_INJECT_INI_DEFAULT) {
    const actuales = parsearListaFriends(rutaIni);
    if (actuales.length >= 10) return { ok: false, motivo: 'lleno' };
    if (actuales.some(f => f.id === friendId)) return { ok: false, motivo: 'duplicado' };

    actuales.push({ id: friendId, label: label || '' });
    const idsCsv = actuales.map(f => f.id).join(',');
    const labelsPipe = actuales.map(f => f.label).join('|');

    actualizarIniInject({
        favoriteFriendIDs: idsCsv,
        favoriteFriendLabels: labelsPipe,
        injectSelectedFriendIDs: idsCsv,
        sendFriendRequestAfterInject: '1'
    }, rutaIni);

    return { ok: true, total: actuales.length };
}

// Si queda una instancia vieja del mismo script de AHK trabada (ej. esperando
// un clic en un popup que nadie va a apretar), lanzar una nueva dispara el
// aviso nativo de AutoHotkey "An older instance is already running — Replace
// it?" — como no hay nadie ahí para tocar "Sí", esa nueva instancia también
// queda colgada, y con ella la interacción de Discord que espera su resultado
// para siempre. Sin poder tocar el .ahk en sí (es privado, no se toca), la
// única forma de evitarlo desde acá es matar cualquier instancia vieja del
// mismo script ANTES de lanzar la nueva, para que nunca llegue a chocar.
function matarInstanciasAhkPrevias(rutaScript) {
    try {
        const nombreScript = path.basename(rutaScript).replace(/'/g, "''");
        const script = `Get-CimInstance Win32_Process -Filter "Name='AutoHotkeyU64.exe' OR Name='AutoHotkeyU32.exe'" | Where-Object { $_.CommandLine -like '*${nombreScript}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`;
        execSync(`powershell -NoProfile -Command "${script.replace(/"/g, '\\"')}"`, { windowsHide: true, timeout: 8000 });
    } catch (e) { /* si no había ninguna corriendo, o falla el chequeo, se sigue igual */ }
}

// Aunque ya no se cuelgue para siempre (ver timeout de spawnAhkConProteccion),
// mientras corre el script cualquier popup bloqueante suyo (instancia
// duplicada, "timed out", etc.) SE VE en pantalla — asusta si alguien se
// conecta por AnyDesk y lo encuentra ahí. Sin tocar el .ahk (privado), se
// puede ocultar la ventana desde afuera por su título: sigue existiendo y el
// script sigue corriendo/esperando atrás, solo que nadie la ve.
const TITULOS_POPUPS_A_OCULTAR = ['_InjectAccount.ahk', 'Send Friend Request'];

function iniciarVigilantePopups(duracionMs) {
    const patrones = TITULOS_POPUPS_A_OCULTAR.map(t => t.replace(/'/g, "''")).join("','");
    const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WinHider {
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
    [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder text, int count);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
}
"@
$patrones = @('${patrones}')
$limite = (Get-Date).AddMilliseconds(${duracionMs})
while ((Get-Date) -lt $limite) {
    [WinHider]::EnumWindows({
        param($hWnd, $lParam)
        if ([WinHider]::IsWindowVisible($hWnd)) {
            $sb = New-Object System.Text.StringBuilder 256
            [WinHider]::GetWindowText($hWnd, $sb, 256) | Out-Null
            $titulo = $sb.ToString()
            foreach ($p in $patrones) {
                if ($titulo -like "*$p*") { [WinHider]::ShowWindow($hWnd, 0) | Out-Null }
            }
        }
        return $true
    }, [IntPtr]::Zero) | Out-Null
    Start-Sleep -Milliseconds 500
}
`;
    const rutaScript = path.join(os.tmpdir(), `hide_popups_${Date.now()}_${Math.random().toString(36).slice(2)}.ps1`);
    fs.writeFileSync(rutaScript, script, 'utf8');
    const vigilante = spawn('powershell', ['-NoProfile', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-File', rutaScript], { windowsHide: true });
    vigilante.on('exit', () => { try { fs.unlinkSync(rutaScript); } catch (e) { /* nada que limpiar */ } });
    return vigilante;
}

// Defensa en profundidad ante CUALQUIER otro popup bloqueante que el script
// pueda mostrar (no solo el de instancia duplicada) — si no termina dentro del
// tiempo esperado, se lo mata a la fuerza (todo el árbol de procesos, por si
// abrió alguno hijo) y se reporta como fallo en vez de dejar la interacción
// de Discord esperando para siempre.
function spawnAhkConProteccion(ahkExe, args, opciones, timeoutMs, callback) {
    matarInstanciasAhkPrevias(args[0]);
    let terminado = false;
    let proceso;
    try {
        proceso = spawn(ahkExe, args, opciones);
    } catch (e) {
        return callback(false, 'error_spawn');
    }

    const vigilante = iniciarVigilantePopups(timeoutMs);

    const temporizador = setTimeout(() => {
        if (terminado) return;
        terminado = true;
        try { vigilante.kill(); } catch (e) { /* nada que limpiar */ }
        try { execSync(`taskkill /PID ${proceso.pid} /T /F`, { windowsHide: true }); } catch (e) { /* puede que ya haya terminado justo antes */ }
        callback(false, 'timeout');
    }, timeoutMs);

    proceso.on('exit', (code) => {
        if (terminado) return;
        terminado = true;
        clearTimeout(temporizador);
        try { vigilante.kill(); } catch (e) { /* nada que limpiar */ }
        callback(code === 0, `codigo_${code}`);
    });
    proceso.on('error', () => {
        if (terminado) return;
        terminado = true;
        clearTimeout(temporizador);
        try { vigilante.kill(); } catch (e) { /* nada que limpiar */ }
        callback(false, 'error_proceso');
    });
}

// Main.ahk (el bot de Kevin) tiene que estar corriendo en la instancia Main
// ANTES de que la donante mande la solicitud de amistad -- es el que la
// acepta por su cuenta, con su propio loop infinito (nunca termina solo, asi
// que nunca se espera/mata como al resto de los pasos del pipeline). Reporte
// del usuario 2026-07-29: faltaba lanzarlo, así que Main Trade no tenía quién
// aceptara la solicitud del lado de Main.
function estaMainAhkCorriendo() {
    try {
        const salida = execSync(
            `powershell -NoProfile -Command "(Get-CimInstance Win32_Process -Filter \\"Name='AutoHotkeyU64.exe' OR Name='AutoHotkeyU32.exe'\\" | Where-Object { $_.CommandLine -like '*Main.ahk*' } | Measure-Object).Count"`,
            { windowsHide: true, timeout: 8000 }
        ).toString().trim();
        return parseInt(salida, 10) > 0;
    } catch (e) {
        return false;
    }
}

function asegurarMainAhkCorriendo(ahkExe, rutaMainAhk) {
    if (estaMainAhkCorriendo()) return true;
    if (!ahkExe || !rutaMainAhk || !fs.existsSync(rutaMainAhk)) return false;
    try {
        const proceso = spawn(ahkExe, [rutaMainAhk], { cwd: path.dirname(rutaMainAhk), detached: true, stdio: 'ignore', windowsHide: false });
        proceso.unref();
        return true;
    } catch (e) {
        return false;
    }
}

// Bug real reportado por el usuario 2026-08-01: antes de inyectar para
// Shinedust, la instancia puede quedar con un problema de ventana visible/
// glitcheada. La solucion de Kevin es correr el motor completo de esa
// instancia (Scripts/{index}.ahk) -- pero ese script mas adelante en su loop
// puede llegar a borrar todos los amigos guardados si algo sale mal, asi que
// en vez de arrancarlo entero, este script PROPIO (automation/_FixInstanceWindow.ahk)
// hace SOLO el arreglo de ventana (mismas funciones que ya vive en nuestra
// copia autorizada de include/Utils.ahk: guarda que ventana tapaba a la de
// MuMu, fuerza un redibujado, devuelve la tapadora arriba) y termina solo --
// no hace falta matarlo a ciegas despues de N segundos.
const RUTA_FIX_INSTANCE_WINDOW_SCRIPT = path.join(__dirname, 'automation', '_FixInstanceWindow.ahk');
function ejecutarFixInstanceWindow(winTitle, callback) {
    const ahkExe = rutaAutoHotkey();
    if (!ahkExe || !fs.existsSync(RUTA_FIX_INSTANCE_WINDOW_SCRIPT)) {
        return callback(false, 'faltan_archivos');
    }
    spawnAhkConProteccion(ahkExe, [RUTA_FIX_INSTANCE_WINDOW_SCRIPT, winTitle], { windowsHide: false }, 30 * 1000, callback);
}

function ejecutarInyeccionHeadless(callback, rutaScript = RUTA_INJECT_ACCOUNT_SCRIPT_DEFAULT) {
    const ahkExe = rutaAutoHotkey();
    if (!ahkExe || !fs.existsSync(rutaScript)) {
        return callback(false, 'faltan_archivos');
    }
    spawnAhkConProteccion(
        ahkExe,
        [rutaScript, '--headless'],
        { windowsHide: false, cwd: path.dirname(rutaScript) },
        5 * 60 * 1000,
        callback
    );
}

// Inyección propia por ADB puro, en paralelo por instancia -- reimplementa
// (sin tocar ni invocar) el paso de inyección de _InjectAccount.ahk de Kevin:
// force-stop, borrar datos de la cuenta anterior, push del XML, relanzar.
// A diferencia de ese script (instancia única de AHK + un solo .ini
// compartido para pasar qué cuenta/ventana inyectar), acá cada llamada recibe
// su propio index/XML como parámetros de función -- sin estado compartido,
// así que N llamadas en paralelo (una por cuenta donante en el tradeo
// automático) no se pisan entre sí. Necesario porque las instancias abiertas
// a la vez para un trade de varias cartas no pueden esperar una atrás de otra.
const APP_ID_PTCGP = 'jp.pokemon.pokemontcgp';
const USER_PREFS_A_LIMPIAR_INJECT = [
    'BattleUserPrefs', 'FeedUserPrefs', 'FilterConditionUserPrefs', 'HomeBattleMenuUserPrefs',
    'MissionUserPrefs', 'NotificationUserPrefs', 'PackUserPrefs', 'PvPBattleResumeUserPrefs',
    'RankMatchPvEResumeUserPrefs', 'RankMatchUserPrefs', 'SoloBattleResumeUserPrefs', 'SortConditionUserPrefs'
];

function rutaAdbExe() {
    const base = carpetaBaseMuMu();
    if (!base) return null;
    const candidatos = [path.join(base, 'shell', 'adb.exe'), path.join(base, 'nx_main', 'adb.exe')];
    return candidatos.find(p => fs.existsSync(p)) || null;
}

// Mismo dato que lee _InjectAccount.ahk (vm_config.json -> vm.nat.port_forward.adb.host_port),
// pero ubicado por índice numérico de MuMuManager en vez de por título de ventana --
// el bot ya conoce el index de cada instancia, así que es más directo y no depende
// de que la ventana esté visible/enfocada.
function obtenerPuertoAdbInstancia(index) {
    const base = carpetaBaseMuMu();
    if (!base) return null;
    const carpetaVms = path.join(base, 'vms');
    if (!fs.existsSync(carpetaVms)) return null;
    const carpetaInstancia = fs.readdirSync(carpetaVms).find(nombre => nombre.endsWith(`-${index}`));
    if (!carpetaInstancia) return null;
    const rutaConfig = path.join(carpetaVms, carpetaInstancia, 'configs', 'vm_config.json');
    if (!fs.existsSync(rutaConfig)) return null;
    try {
        const config = JSON.parse(fs.readFileSync(rutaConfig, 'utf8'));
        return config?.vm?.nat?.port_forward?.adb?.host_port || null;
    } catch (e) {
        return null;
    }
}

function ejecutarAdbComando(adbExe, args, timeoutMs = 15000) {
    try {
        execFileSync(adbExe, args, { windowsHide: true, timeout: timeoutMs });
        return true;
    } catch (e) {
        return false;
    }
}

// 3 intentos como en RunAdbRootCommand de Kevin (shell root directo, luego
// "su -c", luego shell simple de nuevo) -- en algunos dispositivos "adb root"
// no alcanza y hace falta el "su -c" explícito para que el comando aplique.
function ejecutarAdbShellConFallback(adbExe, puerto, comando, timeoutMs = 15000) {
    const device = `127.0.0.1:${puerto}`;
    if (ejecutarAdbComando(adbExe, ['-s', device, 'shell', comando], timeoutMs)) return true;
    if (ejecutarAdbComando(adbExe, ['-s', device, 'shell', 'su', '-c', comando], timeoutMs)) return true;
    return ejecutarAdbComando(adbExe, ['-s', device, 'shell', comando], timeoutMs);
}

async function inyectarCuentaPorAdb(index, xmlPath) {
    const adbExe = rutaAdbExe();
    if (!adbExe) return { ok: false, motivo: 'adb_no_encontrado' };
    const puerto = obtenerPuertoAdbInstancia(index);
    if (!puerto) return { ok: false, motivo: 'puerto_no_encontrado' };
    if (!fs.existsSync(xmlPath)) return { ok: false, motivo: 'xml_no_encontrado' };

    const device = `127.0.0.1:${puerto}`;
    if (!ejecutarAdbComando(adbExe, ['connect', device], 10000)) return { ok: false, motivo: 'conexion_fallida' };
    ejecutarAdbComando(adbExe, ['-s', device, 'root'], 10000);
    await new Promise(r => setTimeout(r, 500)); // margen para que el daemon reinicie en modo root

    const esperar = (ms) => new Promise(r => setTimeout(r, ms));
    const shell = (cmd) => ejecutarAdbShellConFallback(adbExe, puerto, cmd);

    if (!shell(`am force-stop ${APP_ID_PTCGP}`)) return { ok: false, motivo: 'force_stop' };
    await esperar(200);

    if (!shell(`rm -f /data/data/${APP_ID_PTCGP}/shared_prefs/deviceAccount:.xml`)) return { ok: false, motivo: 'borrar_cuenta_previa' };
    await esperar(200);

    for (const pref of USER_PREFS_A_LIMPIAR_INJECT) {
        if (!shell(`rm -f /data/data/${APP_ID_PTCGP}/files/UserPreferences/v1/${pref}`)) return { ok: false, motivo: 'borrar_preferencias' };
        await esperar(150);
    }

    if (!ejecutarAdbComando(adbExe, ['-s', device, 'push', xmlPath, '/sdcard/deviceAccount.xml'], 20000)) return { ok: false, motivo: 'push_xml' };
    await esperar(150);

    if (!shell(`mkdir -p /data/data/${APP_ID_PTCGP}/shared_prefs`)) return { ok: false, motivo: 'crear_carpeta' };
    await esperar(100);

    if (!shell(`cp /sdcard/deviceAccount.xml /data/data/${APP_ID_PTCGP}/shared_prefs/deviceAccount:.xml`)) return { ok: false, motivo: 'copiar_xml' };
    await esperar(100);

    if (!shell(`chmod 664 /data/data/${APP_ID_PTCGP}/shared_prefs/deviceAccount:.xml && chown system:system /data/data/${APP_ID_PTCGP}/shared_prefs/deviceAccount:.xml`)) return { ok: false, motivo: 'permisos' };
    await esperar(200);

    shell(`rm -f /sdcard/deviceAccount.xml`);
    shell(`rm -f /data/data/${APP_ID_PTCGP}/files/UserPreferences/v1/MissionUserPrefs`);

    const lanzado = shell(`am start -W -n ${APP_ID_PTCGP}/com.unity3d.player.UnityPlayerActivity -f 0x10018000`)
        || shell(`am start -n ${APP_ID_PTCGP}/com.unity3d.player.UnityPlayerActivity -f 0x20000000`);
    if (!lanzado) return { ok: false, motivo: 'lanzar_juego' };

    return { ok: true };
}

// ================= Automatizacion propia de trade (Main/Soft), sin AHK ni Kevin =================
// Reemplaza _SendTradeCard.ahk/_FinalizeTradeCard.ahk (que incluian archivos privados de
// Kevin) -- todo por ADB directo desde Node, con las coordenadas mapeadas en vivo esta
// sesion (busqueda de carta por nombre, ciclo de amistad, deslizar para enviar, limpieza
// de amistad al final). A diferencia del Friend Trade manual (donde un humano real
// responde en un tiempo desconocido y hace falta el boton "Next Trade" desde Discord),
// acá controlamos las DOS puntas del trade dentro de la misma corrida, así que no hace
// falta esperar/sondear -- alcanza con delays fijos entre paso y paso.

function adbTapLogico(adbExe, puerto, x, y) {
    // Sin conversion: las coordenadas mapeadas en vivo esta sesion ya son
    // pixeles reales del dispositivo (540x960) -- se descubrieron tocando
    // directo con adb (input tap X Y) mientras se miraban capturas, no son
    // coordenadas logicas de ventana. Aplicarles la formula de escala de
    // Kevin (pensada para SUS coordenadas de ventana AHK) las mandaba fuera
    // de pantalla -- confirmado en vivo 2026-07-29, causa real de que ningun
    // tap automatizado hiciera nada.
    return ejecutarAdbComando(adbExe, ['-s', `127.0.0.1:${puerto}`, 'shell', 'input', 'tap', String(x), String(y)]);
}

function adbSwipeLogico(adbExe, puerto, x, y1, y2, duracionMs = 400) {
    return ejecutarAdbComando(adbExe, ['-s', `127.0.0.1:${puerto}`, 'shell', 'input', 'swipe', String(x), String(y1), String(x), String(y2), String(duracionMs)]);
}

function adbTextoLogico(adbExe, puerto, texto) {
    return ejecutarAdbComando(adbExe, ['-s', `127.0.0.1:${puerto}`, 'shell', 'input', 'text', texto]);
}

const esperarMs = (ms) => new Promise(r => setTimeout(r, ms));

// Cuenta donante busca el ID de amigo de Main y le manda la solicitud. Mapeado en vivo
// contra una cuenta real (2026-07-28): Comunidad -> Amigos -> agregar -> Friend ID Search.
async function agregarAmigoPorId(adbExe, puerto, friendId) {
    adbTapLogico(adbExe, puerto, 270, 925); await esperarMs(2000); // Comunidad
    adbTapLogico(adbExe, puerto, 65, 830); await esperarMs(2000);  // Amigos
    adbTapLogico(adbExe, puerto, 478, 143); await esperarMs(2000); // icono agregar amigo
    adbTapLogico(adbExe, puerto, 140, 790); await esperarMs(2000); // "Friend ID Search"
    adbTapLogico(adbExe, puerto, 270, 445); await esperarMs(1000); // enfocar el campo
    adbTextoLogico(adbExe, puerto, friendId); await esperarMs(1000);
    adbTapLogico(adbExe, puerto, 387, 638); await esperarMs(2500); // OK (busca)
    adbTapLogico(adbExe, puerto, 409, 428); await esperarMs(2000); // Send Request
}

// Main acepta la solicitud pendiente -- asume que es la unica/primera en la lista
// (la limpieza de amigos al final de cada vuelta mantiene esto asi).
async function aceptarSolicitudAmistad(adbExe, puerto) {
    adbTapLogico(adbExe, puerto, 270, 925); await esperarMs(2000); // Comunidad
    adbTapLogico(adbExe, puerto, 65, 830); await esperarMs(2000);  // Amigos
    adbTapLogico(adbExe, puerto, 433, 822); await esperarMs(2000); // Solicitudes recibidas
    adbTapLogico(adbExe, puerto, 466, 320); await esperarMs(2500); // Aceptar (primera fila)
}

// Elimina la amistad recién usada, para que la lista de Main no crezca sin límite y
// el próximo trade siga encontrando fácil a la nueva cuenta donante en la primera fila.
async function eliminarAmigo(adbExe, puerto) {
    adbTapLogico(adbExe, puerto, 270, 925); await esperarMs(2000); // Comunidad
    adbTapLogico(adbExe, puerto, 65, 830); await esperarMs(2000);  // Amigos
    adbTapLogico(adbExe, puerto, 200, 240); await esperarMs(2500); // primer amigo de la lista
    adbTapLogico(adbExe, puerto, 270, 710); await esperarMs(1500); // toggle "✓ Amigo"
    adbTapLogico(adbExe, puerto, 387, 638); await esperarMs(2000); // confirmar "Vale"
}

// Main ofrece una carta puntual (buscada por nombre, no "la primera que aparezca") al
// amigo recién aceptado. Deja el trade en "Esperando respuesta".
async function proponerCartaTrade(adbExe, puerto, cardName) {
    adbTapLogico(adbExe, puerto, 270, 925); await esperarMs(2000); // Comunidad
    adbTapLogico(adbExe, puerto, 397, 715); await esperarMs(2500); // tile Intercambio
    adbTapLogico(adbExe, puerto, 270, 750); await esperarMs(2500); // Intercambiar
    adbTapLogico(adbExe, puerto, 413, 222); await esperarMs(3000); // fila del amigo (primero de la lista)
    adbTapLogico(adbExe, puerto, 477, 213); await esperarMs(1500); // icono de búsqueda
    adbTapLogico(adbExe, puerto, 270, 192); await esperarMs(800);  // caja de texto
    adbTextoLogico(adbExe, puerto, cardName); await esperarMs(800);
    adbTapLogico(adbExe, puerto, 270, 819); await esperarMs(2000); // Buscar
    adbTapLogico(adbExe, puerto, 103, 798); await esperarMs(1500); // primer resultado
    adbTapLogico(adbExe, puerto, 270, 820); await esperarMs(2000); // Vale (confirma selección)
    adbTapLogico(adbExe, puerto, 387, 822); await esperarMs(2000); // Vale (resumen)
    adbTapLogico(adbExe, puerto, 387, 638); await esperarMs(2500); // OK (confirmar carta)
    adbTapLogico(adbExe, puerto, 270, 770); await esperarMs(2500); // Vale ("has ofrecido")
}

// Cuenta donante responde ofreciendo la MISMA carta buscada (misma rareza, la que
// necesitamos que Main reciba). El popup de tutorial de 3 páginas aparece siempre (cada
// cuenta donante es nueva), se toca de forma preventiva antes del flujo real.
async function responderCartaTrade(adbExe, puerto, cardName) {
    adbTapLogico(adbExe, puerto, 270, 925); await esperarMs(2500); // Comunidad
    adbTapLogico(adbExe, puerto, 397, 715); await esperarMs(2500); // tile Trade
    adbTapLogico(adbExe, puerto, 270, 750); await esperarMs(2000); // View / tutorial p.1 Next
    adbTapLogico(adbExe, puerto, 270, 770); await esperarMs(1500); // tutorial p.2 Next
    adbTapLogico(adbExe, puerto, 387, 770); await esperarMs(1500); // tutorial p.3 OK
    adbTapLogico(adbExe, puerto, 270, 750); await esperarMs(2500); // View real
    adbTapLogico(adbExe, puerto, 397, 820); await esperarMs(2500); // Trade (responder)
    adbTapLogico(adbExe, puerto, 477, 213); await esperarMs(1500); // icono de búsqueda
    adbTapLogico(adbExe, puerto, 270, 192); await esperarMs(800);
    adbTextoLogico(adbExe, puerto, cardName); await esperarMs(800);
    adbTapLogico(adbExe, puerto, 270, 819); await esperarMs(2000); // Buscar
    adbTapLogico(adbExe, puerto, 103, 798); await esperarMs(1500); // primer resultado
    adbTapLogico(adbExe, puerto, 270, 770); await esperarMs(1500); // popup info (si aparece)
    adbTapLogico(adbExe, puerto, 270, 820); await esperarMs(2000); // OK (confirmar selección)
    adbTapLogico(adbExe, puerto, 387, 822); await esperarMs(2000); // OK (confirmar final)
    adbTapLogico(adbExe, puerto, 387, 638); await esperarMs(2500); // confirmar diálogo
}

// Main actualiza, acepta la respuesta, desliza para enviar, y cierra el cartel de gracias.
async function finalizarTradeEnMain(adbExe, puerto) {
    adbTapLogico(adbExe, puerto, 433, 654); await esperarMs(2500); // Actualizar
    adbTapLogico(adbExe, puerto, 270, 750); await esperarMs(2500); // Ver
    adbTapLogico(adbExe, puerto, 397, 820); await esperarMs(2000); // Intercambiar
    adbTapLogico(adbExe, puerto, 387, 638); await esperarMs(2500); // Vale (confirmación final, irreversible)
    adbSwipeLogico(adbExe, puerto, 270, 600, 100, 400); await esperarMs(3000); // deslizar para enviar
    adbTapLogico(adbExe, puerto, 270, 920); await esperarMs(2000); // "Toca para continuar" (¡Genial!)
    adbTapLogico(adbExe, puerto, 270, 905); await esperarMs(1500); // cerrar cartel "¿Quieres darle las gracias?"
}

// Orquestador completo de una vuelta: inyecta la cuenta donante, arma la amistad,
// propone/responde el trade, finaliza, limpia la amistad, y apaga la instancia donante.
async function ejecutarCicloTradeAutomatico({ indexMain, friendIdMain, indexDonante, xmlPathDonante, cardName }) {
    const adbExe = rutaAdbExe();
    if (!adbExe) return { ok: false, motivo: 'adb_no_encontrado' };

    const inyeccion = await inyectarCuentaPorAdb(indexDonante, xmlPathDonante);
    if (!inyeccion.ok) return { ok: false, motivo: `inyeccion_fallo_${inyeccion.motivo}` };

    const puertoMain = obtenerPuertoAdbInstancia(indexMain);
    const puertoDonante = obtenerPuertoAdbInstancia(indexDonante);
    if (!puertoMain || !puertoDonante) return { ok: false, motivo: 'puerto_no_encontrado' };

    // Tras inyectar, el juego arranca de cero: pantalla de carga -> splash
    // "Toca para comenzar" -> menu principal. Un solo toque a tiempo fijo no
    // alcanzaba (confirmado en vivo 2026-07-29 via diagnostico OCR: la donante
    // se quedaba pegada en el splash con un solo intento) -- el tiempo de carga
    // real varia bastante despues de una reinyeccion (reinicio "en caliente" del
    // juego via am start, distinto a un arranque frio tocando el icono). Se
    // reintenta el toque cada 5s durante un margen generoso.
    await esperarMs(15000); // margen inicial para que aparezca el splash
    for (let intento = 0; intento < 10; intento++) {
        adbTapLogico(adbExe, puertoDonante, 270, 820); // "Toca para comenzar" (inofensivo si ya no está)
        await esperarMs(5000);
    }
    // El juego suele mostrar un popup automatico (News, etc.) al llegar al menu
    // principal -- se tapea directo la "X" del popup (inofensivo si no hay
    // ninguno, cae en zona en blanco de la pantalla normal).
    adbTapLogico(adbExe, puertoDonante, 141, 480);
    await esperarMs(1500);

    await agregarAmigoPorId(adbExe, puertoDonante, friendIdMain);
    await aceptarSolicitudAmistad(adbExe, puertoMain);
    await proponerCartaTrade(adbExe, puertoMain, cardName);
    await responderCartaTrade(adbExe, puertoDonante, cardName);
    await finalizarTradeEnMain(adbExe, puertoMain);
    await eliminarAmigo(adbExe, puertoMain);

    apagarInstanciaMuMu(indexDonante);

    return { ok: true };
}

// Main Trade real -- piezas AHK separadas (cada una prueba/falla sola, en vez
// de un solo script gigante), encadenadas desde Node en orden. A pedido
// explicito del usuario 2026-07-29, tras encontrar que un script monolitico
// era muy dificil de depurar: _InjectXml -> _SendFriendRequest (donante) ->
// _MainAcceptAndTrade (main) -> _DonorRespondTrade (donante) ->
// _MainFinalizeAndCleanup (main). Aceptar la solicitud de amistad en Main ya
// NO es parte de este pipeline (mismo pedido 2026-07-29): Main.ahk (el bot de
// Kevin) corre aparte, en paralelo, directo en la instancia Main, aceptando
// solicitudes por su cuenta con su propio loop -- ver automation/Main.ahk.
// _SendFriendRequest.ahk (copia adaptada del script propio de Kevin, mismo
// pedido 2026-07-29) reemplaza a nuestro _AddFriendAndRequest.ahk -- usa el
// motor de reconocimiento de imagen de Kevin en vez de taps a coordenadas fijas.
const RUTA_INJECT_XML_SCRIPT = path.join(__dirname, 'automation', '_InjectXml.ahk');
const RUTA_SEND_FRIEND_REQUEST_KEVIN_SCRIPT = path.join(__dirname, 'automation', '_SendFriendRequest.ahk');
// Reemplaza a _MainAcceptAndTrade.ahk (a pedido explicito del usuario
// 2026-07-29): ya no busca la carta por nombre, ofrece la marcada Favorita en
// la coleccion de Main (12 pasos con coordenadas dadas por el usuario).
const RUTA_MAIN_ACCEPT_TRADE_SCRIPT = path.join(__dirname, 'automation', '_MainProposeFavoriteCard.ahk');
const RUTA_DONOR_RESPOND_SCRIPT = path.join(__dirname, 'automation', '_DonorRespondTrade.ahk');
const RUTA_MAIN_FINALIZE_SCRIPT = path.join(__dirname, 'automation', '_MainFinalizeAndCleanup.ahk');
// Remapeados 2026-08-03/04 (coordenadas viejas rotas tras el update del juego, mismo
// motivo por el que Trade estuvo deshabilitado) -- reemplazan a los 4 de arriba.
const RUTA_MAIN_ACCEPT_FRIEND_REQUEST_SCRIPT = path.join(__dirname, 'automation', '_MainAcceptFriendRequest.ahk');
const RUTA_DONOR_OFFER_CARD_SCRIPT = path.join(__dirname, 'automation', '_DonorOfferCard.ahk');
const RUTA_MAIN_ACCEPT_TRADE_OFFER_SCRIPT = path.join(__dirname, 'automation', '_MainAcceptTradeOffer.ahk');
const RUTA_DONOR_RESPOND_FINALIZE_SCRIPT = path.join(__dirname, 'automation', '_DonorRespondAndFinalize.ahk');

function ejecutarPasoAhk(ahkExe, rutaScript, args, timeoutMs, outputFile) {
    return new Promise((resolve) => {
        spawnAhkConProteccion(
            ahkExe, [rutaScript, ...args, outputFile],
            { windowsHide: false, cwd: path.dirname(rutaScript) },
            timeoutMs,
            (ok, detalle) => {
                let resultado = '';
                try { resultado = fs.existsSync(outputFile) ? fs.readFileSync(outputFile, 'utf8').trim() : ''; } catch (e) { /* nada que leer */ }
                try { if (fs.existsSync(outputFile)) fs.unlinkSync(outputFile); } catch (e) { /* nada que limpiar */ }
                resolve({ ok: ok && resultado && !resultado.startsWith('ERROR'), resultado: resultado || detalle });
            }
        );
    });
}

// Boton "Retry" para Main Trade (2026-08-05, a pedido explicito del usuario): antes, si
// fallaba prender una instancia o llegar al menu (game crash, ver verificarNoCrasheado en
// los AHK propios), el usuario se quedaba sin forma de reintentar salvo repetir todo el
// flujo manual de Discord desde cero (elegir carta, amigo, instancia de nuevo).
function botonReintentarMainTrade(cartaId, friendId, fileName, index, nombre) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`main_trade_retry::${cartaId}::${friendId}::${fileName}::${index}::${nombre}`.slice(0, 100)).setLabel('🔄 Retry').setStyle(ButtonStyle.Secondary)
    );
}

// Respaldo para avisos de error de Main Trade (2026-08-05): reporte real del usuario --
// el welcome+inject+reintentos puede tardar bastante, y el token de la interaccion de
// Discord expira a los 15 minutos. Sin este respaldo, un interaction.followUp directo
// fallaba en silencio ("Unknown interaction", DiscordAPIError 10062) y el usuario nunca
// se enteraba de que algo habia fallado. Si el followUp falla, manda el mismo aviso al
// canal de Trading por webhook -- mismo patron ya usado en el aviso de fallo de paso.
async function enviarErrorMainTrade(interaction, mensaje, components = []) {
    try {
        return await interaction.followUp({ content: mensaje, components });
    } catch (e) {
        console.error('DEBUG: interaction.followUp fallo en Main Trade (probable token expirado), mandando por webhook:', e?.message || e);
        try {
            const canalRunInstance = await obtenerCanalComando(interaction.user.id, 'cmd_run_instance');
            if (canalRunInstance?.webhook_url) {
                await axios.post(`${canalRunInstance.webhook_url}?wait=true`, { content: mensaje, components: components.map(c => (c.toJSON ? c.toJSON() : c)) }, { timeout: 10000 });
            }
        } catch (e2) {
            console.error('DEBUG: tambien fallo el respaldo por webhook en Main Trade:', e2?.response?.data || e2?.message || e2);
        }
    }
}

async function ejecutarMainTradeDesdeDiscord(interaction, { cartaId, friendId, fileName, archivo, index, nombre }) {
    const ahkExe = rutaAutoHotkey();
    const folderPath = carpetaBaseMuMu();
    const scripts = [RUTA_SEND_FRIEND_REQUEST_KEVIN_SCRIPT, RUTA_MAIN_ACCEPT_FRIEND_REQUEST_SCRIPT, RUTA_DONOR_OFFER_CARD_SCRIPT, RUTA_MAIN_ACCEPT_TRADE_OFFER_SCRIPT, RUTA_DONOR_RESPOND_FINALIZE_SCRIPT];
    if (!ahkExe || !folderPath || scripts.some(s => !fs.existsSync(s))) {
        return await interaction.followUp({ content: '❌ Main Trade scripts not found.', ephemeral: true });
    }

    const instancias = obtenerInstanciasMuMu();
    const infoMain = (instancias || []).find(i => i.name === 'Main');
    if (!infoMain) {
        return await interaction.followUp({ content: '❌ Could not find an instance named exactly "Main". Main Trade needs your main account\'s MuMu instance to be named "Main".', ephemeral: true });
    }

    const prendidaMain = await asegurarInstanciaEncendida(infoMain.index);
    const prendidaDonante = await asegurarInstanciaEncendida(index);
    if (!prendidaMain || !prendidaDonante) {
        return await enviarErrorMainTrade(interaction, '❌ Could not turn on one of the instances.', [botonReintentarMainTrade(cartaId, friendId, fileName, index, nombre)]);
    }

    try { await interaction.followUp({ content: `🔄 Running Main Trade (\`${fileName}\` → Main)... this may take several minutes and will close the current sessions on both instances.`, ephemeral: true }); } catch (e) { /* interacción puede haber expirado */ }

    const rutaMasterCfg = await db.get(`SELECT webhook_url FROM configs_canales WHERE tipo = 'ruta_master'`);
    const nombreCarta = resolverNombreCarta(cartaId, rutaMasterCfg?.webhook_url);
    const tmp = () => path.join(os.tmpdir(), `mtrade_${index}_${Date.now()}_${Math.random().toString(36).slice(2)}.txt`);

    // Inyeccion de la donante: reemplaza _InjectXml.ahk (propio, ADB directo) por el
    // MISMO mecanismo que ya usa Shinedust (2026-08-03, a pedido explicito del usuario) --
    // _InjectAccount.ahk de Kevin via ejecutarInyeccionHeadless, probado extensamente hoy y
    // mas confiable. sendFriendRequestAfterInject en '0' porque la solicitud de amistad la
    // manda el paso 'send_friend_request' de mas abajo (script de Kevin aparte), no la
    // inyeccion misma -- mandarla dos veces seria redundante.
    async function ejecutarInjectDonante() {
        const { rutaIni, rutaScript: rutaScriptInject } = await obtenerRutasInject(interaction.user.id);
        try {
            guardarXmlParaInyeccion(nombre, archivo, rutaIni);
            actualizarIniInject({ sendFriendRequestAfterInject: '0' }, rutaIni);
        } catch (e) {
            return { ok: false, resultado: 'no_se_pudo_guardar_ini' };
        }
        return await new Promise((resolve) => {
            ejecutarInyeccionHeadless((ok, detalle) => resolve({ ok, resultado: detalle }), rutaScriptInject);
        });
    }

    // Semi-paralelo, segunda vuelta (2026-08-05, a pedido explicito del usuario): el
    // crash de la vez pasada resulto ser el "am start" DENTRO del welcome de la donante
    // (interrumpia la carga real ya iniciada por el inject) -- confirmado en vivo esta
    // noche al sacarlo del todo. Ahora _WaitWelcomeScreens.ahk (donante/Shinedust) YA NO
    // abre el juego para nada; solo la copia dedicada _WaitWelcomeScreensMain.ahk lo hace
    // (Main no tiene inject que se lo abra solo). Con eso resuelto, se reintenta el
    // paralelo: welcome de Main (con su propio am-start) corre a la vez que el inject +
    // welcome de la donante -- recien cuando AMBOS terminan sigue el resto del pipeline
    // (send_friend_request en adelante).
    const promesaEsperaMain = new Promise((resolve) => ejecutarWaitWelcomeScreens(infoMain.name, (ok, detalle) => resolve({ ok, detalle }), RUTA_WAIT_WELCOME_SCREENS_MAIN_SCRIPT));
    const promesaPrepDonante = (async () => {
        const resInject = await ejecutarInjectDonante();
        if (!resInject.ok) return resInject;
        return await new Promise((resolve) => ejecutarWaitWelcomeScreens(nombre, (ok, detalle) => resolve({ ok, resultado: detalle })));
    })();
    const [esperaMain, prepDonante] = await Promise.all([promesaEsperaMain, promesaPrepDonante]);
    if (!esperaMain.ok) {
        return await enviarErrorMainTrade(interaction, `❌ Could not reach the main menu on instance **${infoMain.name}** (${esperaMain.detalle}).`, [botonReintentarMainTrade(cartaId, friendId, fileName, index, nombre)]);
    }
    if (!prepDonante.ok) {
        return await enviarErrorMainTrade(interaction, `❌ Could not prepare the donor instance **${nombre}** (${prepDonante.resultado}).`, [botonReintentarMainTrade(cartaId, friendId, fileName, index, nombre)]);
    }

    // Orden confirmado por el usuario 2026-07-29: despues de mandar la
    // solicitud, la donante ofrece la carta de la wishlist de Main
    // (_SendTradeCard.ahk, igual que en Friend Trade) ANTES de que Main
    // proponga la suya -- son dos ofertas de trade separadas, no una sola.
    const pasos = [
        { nombre: 'send_friend_request', script: RUTA_SEND_FRIEND_REQUEST_KEVIN_SCRIPT, args: [nombre, folderPath, friendId], timeoutMs: 90 * 1000 },
        // Remapeados 2026-08-03/04 (coordenadas propias, ver header de cada script) --
        // reemplazan Main.ahk + _SendTradeCard.ahk + _MainProposeFavoriteCard.ahk +
        // _DonorRespondTrade.ahk + _MainFinalizeAndCleanup.ahk + _FinalizeTradeCard.ahk.
        { nombre: 'main_accept_friend_request', script: RUTA_MAIN_ACCEPT_FRIEND_REQUEST_SCRIPT, args: ['Main', folderPath], timeoutMs: 60 * 1000 },
        { nombre: 'donor_offer_card', script: RUTA_DONOR_OFFER_CARD_SCRIPT, args: [nombre, folderPath], timeoutMs: 2 * 60 * 1000 },
        { nombre: 'main_accept_trade_offer', script: RUTA_MAIN_ACCEPT_TRADE_OFFER_SCRIPT, args: ['Main', folderPath], timeoutMs: 2 * 60 * 1000 },
        { nombre: 'donor_respond_finalize', script: RUTA_DONOR_RESPOND_FINALIZE_SCRIPT, args: [nombre, folderPath], timeoutMs: 2 * 60 * 1000 }
    ];

    for (const paso of pasos) {
        const { ok, resultado } = paso.promesa
            ? await paso.promesa()
            : await ejecutarPasoAhk(ahkExe, paso.script, paso.args, paso.timeoutMs, tmp());
        if (!ok) {
            const filaStop = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`mumu_stop_trade::${index}::${nombre}`).setLabel('🛑 Stop').setStyle(ButtonStyle.Danger),
                new ButtonBuilder().setCustomId(`main_trade_retry::${cartaId}::${friendId}::${fileName}::${index}::${nombre}`.slice(0, 100)).setLabel('🔄 Retry').setStyle(ButtonStyle.Secondary)
            );
            const mensaje = `❌ Main Trade failed at step **${paso.nombre}** (${resultado}). Press **🛑 Stop** to clean up, or **🔄 Retry** to try again.`;
            try {
                const canalRunInstance = await obtenerCanalComando(interaction.user.id, 'cmd_run_instance');
                if (canalRunInstance?.webhook_url) {
                    await axios.post(`${canalRunInstance.webhook_url}?wait=true`, { content: mensaje, components: [filaStop.toJSON()] }, { timeout: 10000 });
                    return await interaction.followUp({ content: '✅ Result sent to your Trading channel.', ephemeral: true });
                }
            } catch (e) {
                console.error('DEBUG: error mandando el resultado de Main Trade al canal de trading:', e?.response?.data || e?.message || e);
            }
            return await interaction.followUp({ content: mensaje, components: [filaStop] });
        }
    }

    // A pedido explicito del usuario 2026-07-29: al terminar todo el pipeline
    // con exito, apagar las DOS instancias (Main y donante) -- _FinalizeTradeCard.ahk
    // ya apaga a la donante sola, pero Main se quedaba prendida. Sin setTimeout
    // (reporte del usuario: quedaron prendidas igual) -- un reinicio del bot en
    // esa ventana de 5s mataba el timer pendiente sin avisar. Apaga de una.
    apagarInstanciaMuMu(index);
    apagarInstanciaMuMu(infoMain.index);

    const mensaje = `✅ Main Trade completed: **${nombreCarta}** (\`${fileName}\`) sent to Main.`;
    try {
        const canalRunInstance = await obtenerCanalComando(interaction.user.id, 'cmd_run_instance');
        if (canalRunInstance?.webhook_url) {
            await axios.post(`${canalRunInstance.webhook_url}?wait=true`, { content: mensaje }, { timeout: 10000 });
            return await interaction.followUp({ content: '✅ Result sent to your Trading channel.', ephemeral: true });
        }
    } catch (e) {
        console.error('DEBUG: error mandando el resultado de Main Trade al canal de trading:', e?.response?.data || e?.message || e);
    }
    return await interaction.followUp({ content: mensaje, ephemeral: true });
}

const RUTA_SEND_TRADE_CARD_SCRIPT = path.join(__dirname, 'automation', '_SendTradeCard.ahk');
const RUTA_FINALIZE_TRADE_CARD_SCRIPT = path.join(__dirname, 'automation', '_FinalizeTradeCard.ahk');

function carpetaBaseMuMu() {
    const managerPath = rutaMuMuManager();
    if (!managerPath) return null;
    return path.dirname(path.dirname(managerPath));
}

function ejecutarSendTradeCard(winTitle, callback) {
    const ahkExe = rutaAutoHotkey();
    const folderPath = carpetaBaseMuMu();
    if (!ahkExe || !folderPath || !fs.existsSync(RUTA_SEND_TRADE_CARD_SCRIPT)) {
        return callback(false, 'faltan_archivos');
    }
    spawnAhkConProteccion(ahkExe, [RUTA_SEND_TRADE_CARD_SCRIPT, winTitle, folderPath], { windowsHide: false }, 3 * 60 * 1000, callback);
}

function ejecutarFinalizeTradeCard(winTitle, instanceIndex, callback) {
    const ahkExe = rutaAutoHotkey();
    const folderPath = carpetaBaseMuMu();
    if (!ahkExe || !folderPath || !fs.existsSync(RUTA_FINALIZE_TRADE_CARD_SCRIPT)) {
        return callback(false, 'faltan_archivos');
    }
    spawnAhkConProteccion(ahkExe, [RUTA_FINALIZE_TRADE_CARD_SCRIPT, winTitle, folderPath, String(instanceIndex)], { windowsHide: false }, 3 * 60 * 1000, callback);
}

const RUTA_WAIT_WELCOME_SCREENS_SCRIPT = path.join(__dirname, 'automation', '_WaitWelcomeScreens.ahk');
// Copia dedicada para Main en Main Trade (2026-08-05, recreada a pedido del usuario):
// unica que hace "am start" (Main no tiene inject que le abra el juego solo). El script
// compartido de arriba (donante/Shinedust) NO abre el juego -- se saco de ahi porque
// crasheaba al interrumpir la apertura que ya hace el inject.
const RUTA_WAIT_WELCOME_SCREENS_MAIN_SCRIPT = path.join(__dirname, 'automation', '_WaitWelcomeScreensMain.ahk');
const RUTA_COUNT_SHINEDUST_SCRIPT = path.join(__dirname, 'automation', '_CountShinedust.ahk');

// Separado de ejecutarCountShinedust (2026-08-03) para poder reusar este chequeo desde
// cualquier flujo que arranque justo despues de una inyeccion (Shinedust, Trade, etc.) sin
// acoplarlo a la logica puntual de cada uno. Espera hasta 70s a que el juego pase las
// pantallas de bienvenida/carrusel post-inyeccion y llegue al menu principal.
// callback(ok, detalle).
function ejecutarWaitWelcomeScreens(winTitle, callback, rutaScript = RUTA_WAIT_WELCOME_SCREENS_SCRIPT) {
    const ahkExe = rutaAutoHotkey();
    const folderPath = carpetaBaseMuMu();
    if (!ahkExe || !folderPath || !fs.existsSync(rutaScript)) {
        return callback(false, 'faltan_archivos');
    }
    const outputFile = path.join(os.tmpdir(), `welcomescreens_${winTitle}_${Date.now()}.txt`);
    // Subido de 90s a 150s (2026-08-05, a pedido del usuario): un ciclo real de
    // crash+recuperacion (nuestro reintento de am start dentro del AHK) puede consumir gran
    // parte del timeout interno de 70s, sin dejar margen para que el juego termine de
    // cargar antes de que ESTE timeout externo mate el proceso. Ver timeoutMs subido a
    // 130s dentro de _WaitWelcomeScreens.ahk/_WaitWelcomeScreensMain.ahk -- este externo
    // tiene que ser mayor a ese para no matarlo antes de tiempo.
    spawnAhkConProteccion(ahkExe, [rutaScript, winTitle, folderPath, outputFile], { windowsHide: false }, 150 * 1000, (ok, detalle) => {
        let resultado;
        try {
            resultado = fs.readFileSync(outputFile, 'utf8').trim();
        } catch (e) {
            resultado = '';
        }
        try { fs.unlinkSync(outputFile); } catch (e) { /* nada que limpiar */ }
        if (!ok || !resultado || resultado.startsWith('ERROR')) {
            return callback(false, resultado || detalle);
        }
        callback(true, resultado);
    });
}

// Cache en memoria (2026-08-03) de los datos de inventario que ya capturo una corrida de
// Shinedust, para que si el usuario despues aprieta "Info Accounts" desde ESE MISMO
// resultado no haga falta re-inyectar la cuenta ni volver a leer todo por OCR de nuevo.
// TTL corto para no acumular memoria indefinidamente si nadie lo usa.
const cacheDatosInventario = new Map(); // fileName -> { datos, ts }
const TTL_CACHE_INVENTARIO_MS = 60 * 60 * 1000;

function obtenerDatosInventarioCacheados(fileName) {
    const entrada = cacheDatosInventario.get(fileName);
    if (!entrada) return null;
    if (Date.now() - entrada.ts > TTL_CACHE_INVENTARIO_MS) {
        cacheDatosInventario.delete(fileName);
        return null;
    }
    return entrada.datos;
}

// Mismo orden en el que aparecen en el inventario real del juego.
// Emojis personalizados TCGP (2026-08-05, a pedido explicito del usuario): subidos como
// application emojis del bot (ver assets/element/*_TCGP.png) -- IDs fijos, no cambian.
const ETIQUETAS_INVENTARIO = [
    ['pokegold_nonpaid', '<:Pokelingote_TCGP:1534723128004055161> Poké Gold (non-paid)'],
    ['pokegold_paid', '<:Pokelingote_TCGP:1534723128004055161> Poké Gold (paid)'],
    ['shopticket', '<:Cupon_de_tienda_TCGP:1534723152914026569> Shop Ticket'],
    ['specialshopticket', '<:Cupon_de_tienda_especial_TCGP:1534723156462403614> Special Shop Ticket'],
    ['premiumticket', '<:Cupon_premium_TCGP:1534723160069640213> Premium Ticket'],
    ['packhourglass', '<:Reloj_de_arena_de_sobres_TCGP:1534723131598569603> Pack Hourglass'],
    ['wonderhourglass', '<:Reloj_de_arena_magico_TCGP:1534723135117463642> Wonder Hourglass'],
    ['rewindwatch', '<:Retronometro_TCGP:1534723138963902644> Rewind Watch'],
    ['tradehourglass', '<:Reloj_arena_intercambio_TCGP:1534723339115958322> Trade Hourglass'],
];

// Solo incluye los campos que se pudieron leer bien (algunos pueden venir vacios si el OCR
// no los reconocio esa corrida -- ver leerCampoOcr en _CountShinedust.ahk).
function camposInventarioEmbed(datos) {
    // Solo mayor a 0 (a pedido explicito del usuario 2026-08-03): un campo en "0" no aporta
    // nada y satura el embed -- ya sea que el OCR lo haya leido bien o que sea el default
    // aplicado cuando no se pudo leer (ver conValorODefaultCero en _CountShinedust.ahk).
    return ETIQUETAS_INVENTARIO
        .filter(([clave]) => datos[clave] && datos[clave] !== '0')
        .map(([clave, etiqueta]) => ({ name: etiqueta, value: datos[clave], inline: true }));
}

// Corre nuestro propio script de OCR (ver automation/_CountShinedust.ahk) sobre una
// instancia que YA tiene la cuenta inyectada, el juego cargado, y ya paso las pantallas de
// bienvenida (ejecutarInyeccionHeadless y ejecutarWaitWelcomeScreens deben haber corrido
// antes) -- navega hasta Items y lee el shinedust y el resto del inventario con el OCR
// nativo de Windows. callback(ok, datosOMotivo) -- datos es un objeto ({shinedust, ...}) si
// ok, un string con el motivo si no.
function ejecutarCountShinedust(winTitle, callback) {
    const ahkExe = rutaAutoHotkey();
    const folderPath = carpetaBaseMuMu();
    if (!ahkExe || !folderPath || !fs.existsSync(RUTA_COUNT_SHINEDUST_SCRIPT)) {
        return callback(false, 'faltan_archivos');
    }
    const outputFile = path.join(os.tmpdir(), `shinedust_${winTitle}_${Date.now()}.txt`);
    spawnAhkConProteccion(ahkExe, [RUTA_COUNT_SHINEDUST_SCRIPT, winTitle, folderPath, outputFile], { windowsHide: false }, 3 * 60 * 1000, (ok, detalle) => {
        // Bug real encontrado 2026-07-30: si el script terminaba con codigo != 0
        // (cualquier ExitConError), esto devolvia directo "codigo_N" sin siquiera
        // leer el archivo -- el motivo real ("puerto_no_encontrado", "ocr
        // invalido (...)", etc.) que el script SIEMPRE escribe ahi se perdia.
        // Ahora lee el archivo primero pase lo que pase, mismo criterio que
        // ejecutarPasoAhk.
        let resultado;
        try {
            resultado = fs.readFileSync(outputFile, 'utf8').trim();
        } catch (e) {
            resultado = '';
        }
        try { fs.unlinkSync(outputFile); } catch (e) { /* nada que limpiar */ }
        if (!ok || !resultado || resultado.startsWith('ERROR')) {
            return callback(false, resultado || detalle);
        }
        // _CountShinedust.ahk devuelve un JSON armado a mano (2026-08-03, ver el script)
        // con Shinedust y el resto de los campos del inventario (Poke gold, tickets,
        // relojes de arena). Fallback por si algun dia vuelve a llegar el shinedust
        // plano de antes (sin JSON), para no romper nada de golpe.
        let datos;
        try {
            datos = JSON.parse(resultado);
        } catch (e) {
            datos = { shinedust: resultado };
        }
        callback(true, datos);
    });
}

function extraerDeviceAccount(rutaXml) {
    try {
        const contenido = fs.readFileSync(rutaXml, 'utf8');
        const match = contenido.match(/<string name="deviceAccount">([^<]+)<\/string>/);
        return match ? match[1].trim() : null;
    } catch (e) {
        return null;
    }
}

function buscarArchivoJsonPorDeviceAccount(rutaBase, deviceAccount) {
    if (!rutaBase || !fs.existsSync(rutaBase) || !deviceAccount) return null;
    const objetivo = `${deviceAccount.toLowerCase()}.json`;

    const pendientes = [rutaBase];
    while (pendientes.length) {
        const actual = pendientes.pop();
        let entradas;
        try {
            entradas = fs.readdirSync(actual, { withFileTypes: true });
        } catch (e) {
            continue;
        }
        for (const entrada of entradas) {
            const rutaCompleta = path.join(actual, entrada.name);
            if (entrada.isDirectory()) {
                pendientes.push(rutaCompleta);
            } else if (entrada.name.toLowerCase() === objetivo) {
                return rutaCompleta;
            }
        }
    }
    return null;
}

// PDF de "Info Accounts" (a pedido explicito del usuario 2026-07-31): reporte
// completo de una cuenta puntual, agrupado por expansion, con el nombre de
// cada carta y cuantas veces salio en toda la historia de pulls guardada de
// esa cuenta -- mismo conteo que ya usa Gold Cards/construirMapaCopiasPorCarta,
// pero acotado a UNA sola cuenta (el archivo JSON que ya se identifico en el
// flujo de Extract XML), no un cruce entre todas las cuentas guardadas.
async function generarInfoAccountsPDF(rutaMasterPath, archivoJson, escalaRender = 3, calidadJpeg = 90, datosInventario = null) {
    const accountData = leerJsonSeguro(archivoJson);
    if (!accountData || !Array.isArray(accountData.pulls)) return null;

    const conteoPorCodigo = {};
    for (const pull of accountData.pulls) {
        if (!Array.isArray(pull.cards)) continue;
        for (const code of pull.cards) {
            conteoPorCodigo[code] = (conteoPorCodigo[code] || 0) + 1;
        }
    }

    const cardMap = cargarCardMap(rutaMasterPath);
    const en_US = rutaMasterPath ? leerJsonSeguro(path.join(rutaMasterPath, 'en_US.json')) : null;
    const cardmaster = rutaMasterPath ? leerJsonSeguro(path.join(rutaMasterPath, 'cardmaster.json')) : null;
    const expansiones = construirMapaExpansiones(en_US);

    const porExpansion = {};
    for (const [code, cantidad] of Object.entries(conteoPorCodigo)) {
        const infoMapa = cardMap?.[code];
        const expansionId = infoMapa?.ExpansionID;
        const nombreExpansion = expansionId ? (expansiones[expansionId] || expansionId) : 'Unknown';
        const infoMaster = cardmaster?.[code];
        const nombreCarta = (infoMaster?.Name && en_US?.[infoMaster.Name]) || infoMaster?.Name || code;
        if (!porExpansion[nombreExpansion]) porExpansion[nombreExpansion] = [];
        porExpansion[nombreExpansion].push({ nombre: nombreCarta, cantidad, illustrationId: infoMapa?.IllustrationID, code });
    }
    for (const lista of Object.values(porExpansion)) {
        lista.sort((a, b) => a.nombre.localeCompare(b.nombre));
    }
    const expansionesOrdenadas = Object.keys(porExpansion).sort();

    // Miniatura por carta: HD del Drive SI YA ESTA CACHEADA en disco (de una
    // vista de Gold Cards/S4T/card, sin llamada en vivo a la API -- eso ya se
    // probo y para cuentas grandes Google corta por limite de cuota), sino
    // disco local, sino el repositorio propio. A pedido explicito del usuario
    // 2026-07-31 tras confirmar que ciertas cartas puntuales (ej. Greninja
    // rareza R) tienen un defecto de fabrica horneado en el PNG de baja
    // resolucion (un arco negro en una esquina) que la version HD del Drive
    // no tiene -- osea que ademas de mejor calidad, evita defectos reales.
    // Celdas mas grandes (4 por fila en vez de 5) y la miniatura se renderiza a
    // 3x su tamaño de despliegue (ESCALA_RENDER) antes de meterla en el PDF --
    // sharp.resize(CELL_W, CELL_H) generaba una imagen de solo esos pixeles,
    // que puesta en una caja del mismo tamaño en puntos da ~72 DPI (se ve
    // pixelada al hacer zoom en el PDF). A pedido explicito del usuario el peso
    // no importa, asi que se prioriza nitidez.
    // CELL_W/H son el tamaño de la IMAGEN; cada tarjeta ademas suma
    // TILE_PADDING de aire alrededor (fondo oscuro + borde), como el
    // .card-tile de la pagina web -- por eso son mas chicas que antes, para
    // que 4 por fila sigan entrando en el ancho de la pagina.
    const CELL_W = 105, CELL_H = 147, GAP = 8, COLS = 4, TILE_PADDING = 8;
    const anchoUtil = 595 - 40 * 2; // A4 (pdfkit default) menos margenes de 40
    const margenIzq = 40;

    // Badge de cantidad superpuesto en la imagen (a pedido explicito del
    // usuario 2026-07-31, mostrandole como referencia su propio dashboard
    // "Card Library" de PTCGPB): en vez de imprimir "{nombre} xN" como texto
    // debajo de cada miniatura, la cantidad va como badge sobre la esquina de
    // la carta -- mismo estilo visual que ya usa generarCollageCartas para
    // Wishlist/All Cards/Gold Cards, sin nombre de carta en ningun lado.
    function obtenerImagenHDCacheadaBot(cartaId) {
        const info = cardMap?.[cartaId];
        if (!info?.ExpansionID || !info?.CollectionNumber) return null;
        const localId = String(info.CollectionNumber).padStart(3, '0');
        const rutaCache = path.join(DRIVE_CACHE_DIR_BOT, info.ExpansionID, `${localId}.png`);
        return fs.existsSync(rutaCache) ? rutaCache : null;
    }

    const anchoRenderCelda = Math.round(CELL_W * escalaRender);
    const altoRenderCelda = Math.round(CELL_H * escalaRender);
    const todasLasCartas = Object.values(porExpansion).flat();
    const buffersPorCodigo = new Map();
    for (const carta of todasLasCartas) {
        const rutaImg = obtenerImagenHDCacheadaBot(carta.code)
            || encontrarImagenPorIllustration(rutaMasterPath, carta.illustrationId)
            || (await obtenerImagenRepoCartasBot(rutaMasterPath, carta.illustrationId));
        if (!rutaImg) continue;
        try {
            const composite = [];
            if (carta.cantidad > 0) {
                const texto = `x${carta.cantidad}`;
                const altoBadge = Math.round(altoRenderCelda * 0.13);
                const fontSize = Math.round(altoBadge * 0.6);
                const anchoBadge = Math.round(altoBadge * 0.9 + texto.length * fontSize * 0.62);
                const margenBadge = Math.round(altoRenderCelda * 0.03);
                const svgBadge = Buffer.from(
                    `<svg width="${anchoBadge}" height="${altoBadge}">` +
                    `<rect x="0" y="0" width="${anchoBadge}" height="${altoBadge}" rx="${Math.round(altoBadge / 3)}" ry="${Math.round(altoBadge / 3)}" fill="black" fill-opacity="0.72"/>` +
                    `<text x="${anchoBadge / 2}" y="${Math.round(altoBadge * 0.7)}" font-size="${fontSize}" font-family="Arial, sans-serif" font-weight="bold" fill="#FFD700" text-anchor="middle">${texto}</text>` +
                    `</svg>`
                );
                composite.push({ input: svgBadge, top: altoRenderCelda - altoBadge - margenBadge, left: anchoRenderCelda - anchoBadge - margenBadge });
            }
            // Esquinas redondeadas -- JPEG no soporta transparencia, asi que
            // la mascara recorta la imagen a la forma redondeada y el
            // flatten() de abajo rellena las esquinas del mismo color oscuro
            // que el fondo de la tarjeta (#121a2f, igual que .card-tile en el
            // dashboard web -- a pedido explicito del usuario 2026-07-31 de
            // que el PDF tenga la misma estetica oscura que la pagina, no
            // fondo blanco).
            const radioEsquina = Math.round(altoRenderCelda * 0.06);
            const mascaraRedondeada = Buffer.from(
                `<svg width="${anchoRenderCelda}" height="${altoRenderCelda}">` +
                `<rect x="0" y="0" width="${anchoRenderCelda}" height="${altoRenderCelda}" rx="${radioEsquina}" ry="${radioEsquina}" fill="#ffffff"/>` +
                `</svg>`
            );
            composite.push({ input: mascaraRedondeada, blend: 'dest-in' });
            buffersPorCodigo.set(carta.code, await sharp(rutaImg)
                .resize(anchoRenderCelda, altoRenderCelda, { fit: 'cover' })
                .composite(composite)
                .flatten({ background: '#121a2f' })
                .jpeg({ quality: calidadJpeg })
                .toBuffer());
        } catch (e) { /* miniatura corrupta, queda como casillero vacio */ }
    }

    const doc = new PDFDocument({ margin: 40 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    const finPromesa = new Promise((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

    // Fondo oscuro (a pedido explicito del usuario 2026-07-31: que el PDF se
    // vea con la misma estetica que el dashboard web, no una pagina blanca) --
    // pdfkit no tiene "color de fondo de pagina" nativo, asi que se pinta un
    // rectangulo del tamaño de la pagina en cada pageAdded (incluida la
    // primera pagina que el constructor crea solo).
    const FONDO_OSCURO = '#0b1020';
    const TEXTO_CLARO = '#edf2ff';
    const TEXTO_MUTED = '#aeb9d4';
    doc.on('pageAdded', () => {
        doc.rect(0, 0, doc.page.width, doc.page.height).fill(FONDO_OSCURO);
    });
    doc.rect(0, 0, doc.page.width, doc.page.height).fill(FONDO_OSCURO);

    doc.fontSize(18).fillColor(TEXTO_CLARO).text(`Account Report — ${accountData.deviceAccount || path.basename(archivoJson, '.json')}`, { underline: true });
    doc.fontSize(10).fillColor(TEXTO_MUTED).text(`File: ${accountData.metadata?.fileName || ''}`);
    // Datos en vivo del inventario (2026-08-03, a pedido explicito del usuario): solo si se
    // pidieron con "Yes, get live data" o vino del atajo de un resultado de Shinedust -- si
    // no hay, no se agrega nada (mismo criterio que el embed de Discord).
    if (datosInventario) {
        doc.moveDown(0.3);
        doc.fontSize(11).fillColor(TEXTO_CLARO).text(`👛 Shinedust: ${datosInventario.shinedust}`);
        for (const [clave, etiqueta] of ETIQUETAS_INVENTARIO) {
            if (datosInventario[clave] && datosInventario[clave] !== '0') {
                doc.fontSize(11).fillColor(TEXTO_CLARO).text(`${etiqueta}: ${datosInventario[clave]}`);
            }
        }
    }
    doc.fillColor(TEXTO_CLARO).moveDown();

    for (let i = 0; i < expansionesOrdenadas.length; i++) {
        const expansion = expansionesOrdenadas[i];
        // Logo de la expansion centrado arriba de su seccion (a pedido
        // explicito del usuario 2026-07-31), misma fuente que ya usa el
        // collage de Discord -- si no hay logo, se muestra solo el nombre.
        const rutaLogo = buscarLogoExpansionBot(expansion);
        const altoLogo = rutaLogo ? 50 : 0;
        if (doc.y + altoLogo + 30 > doc.page.height - doc.page.margins.bottom) doc.addPage();
        if (i > 0) doc.moveDown();
        if (rutaLogo) {
            try {
                const dimsLogo = await sharp(rutaLogo).metadata();
                const anchoLogo = Math.min(180, altoLogo * (dimsLogo.width / dimsLogo.height));
                // Redimensionar SIEMPRE antes de meterlo al PDF -- pdfkit
                // incrusta el archivo de origen tal cual (sin recomprimir),
                // asi que un logo pesado (ej. 9.5MB) sin achicar antes inflaba
                // el PDF entero a mas de 10MB (bug real 2026-07-31).
                const logoChico = await sharp(rutaLogo)
                    .resize(Math.round(anchoLogo * 2), Math.round(altoLogo * 2), { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
                    .png()
                    .toBuffer();
                doc.image(logoChico, margenIzq + (anchoUtil - anchoLogo) / 2, doc.y, { height: altoLogo });
                doc.y += altoLogo + 6;
            } catch (e) { /* si falla, se sigue solo con el nombre de texto de abajo */ }
        }
        doc.fontSize(14).fillColor(TEXTO_CLARO).text(expansion, { underline: true, align: 'center' });
        doc.moveDown(0.3);

        const TILE_W = CELL_W + TILE_PADDING * 2;
        const TILE_H = CELL_H + TILE_PADDING * 2;
        let col = 0;
        let filaTop = doc.y;
        for (const carta of porExpansion[expansion]) {
            if (filaTop + TILE_H + GAP > doc.page.height - doc.page.margins.bottom) {
                doc.addPage();
                filaTop = doc.y;
                col = 0;
            }
            const xTile = margenIzq + col * (TILE_W + GAP);
            const buffer = buffersPorCodigo.get(carta.code);
            // Tarjeta con fondo y borde propios (igual que .card-tile en el
            // dashboard web: fondo #121a2f, borde #2c385d) en vez de una
            // simple linea sobre fondo blanco.
            doc.roundedRect(xTile, filaTop, TILE_W, TILE_H, 10).fillAndStroke('#121a2f', '#2c385d');
            const xImg = xTile + TILE_PADDING;
            const yImg = filaTop + TILE_PADDING;
            if (buffer) {
                doc.image(buffer, xImg, yImg, { width: CELL_W, height: CELL_H });
            } else {
                doc.roundedRect(xImg, yImg, CELL_W, CELL_H, Math.round(CELL_H * 0.06)).strokeColor('#2c385d').stroke();
            }

            col++;
            if (col >= COLS) {
                col = 0;
                filaTop += TILE_H + GAP;
            }
        }
        doc.y = filaTop + (col > 0 ? TILE_H + GAP : 0);
    }

    doc.end();
    return finPromesa;
}

// ============ Dashboard local "Info Accounts" (2026-07-31) ============
// A pedido explicito del usuario, en reemplazo del PDF de arriba (pausado,
// no borrado): mismo reporte (agrupado por expansion, cantidad por carta),
// pero como pagina web servida localmente -- bordes redondeados via CSS en
// vez de mascaras de sharp (evita toda la categoria de bugs de composite/
// flatten/JPEG que se vinieron dando en el PDF), y accesible desde el celular
// si esta en la MISMA red WiFi que la PC (el bind es a 0.0.0.0, no solo
// localhost). Acceso desde fuera de esa red necesitaria un tunel aparte
// (ngrok, Cloudflare Tunnel, etc.), no incluido.
const DASHBOARD_PORT_BASE = Number(process.env.DASHBOARD_PORT) || 3005;
const dashboardApp = express();
const _dashboardTokens = new Map();

function generarTokenDashboard(rutaMasterPath, archivoJson, datosInventario = null) {
    const token = crypto.randomBytes(12).toString('hex');
    _dashboardTokens.set(token, { rutaMasterPath, archivoJson, datosInventario });
    return token;
}

function obtenerIpLan() {
    const interfaces = os.networkInterfaces();
    for (const nombre of Object.keys(interfaces)) {
        for (const iface of interfaces[nombre] || []) {
            if (iface.family === 'IPv4' && !iface.internal) return iface.address;
        }
    }
    return null;
}

function resolverRutaImagenDashboard(cardMap, rutaMasterPath, code, illustrationId) {
    const info = cardMap?.[code];
    if (info?.ExpansionID && info?.CollectionNumber) {
        const localId = String(info.CollectionNumber).padStart(3, '0');
        const rutaHD = path.join(DRIVE_CACHE_DIR_BOT, info.ExpansionID, `${localId}.png`);
        if (fs.existsSync(rutaHD)) return rutaHD;
    }
    if (rutaMasterPath && illustrationId) {
        const rutaLocal = path.join(rutaMasterPath, 'CardImageCache', `${illustrationId}.png`);
        if (fs.existsSync(rutaLocal)) return rutaLocal;
    }
    return null;
}

dashboardApp.get('/img/:token/:code', async (req, res) => {
    try {
        const datos = _dashboardTokens.get(req.params.token);
        if (!datos) return res.status(404).end();
        const cardMap = cargarCardMap(datos.rutaMasterPath);
        const info = cardMap?.[req.params.code];
        let ruta = resolverRutaImagenDashboard(cardMap, datos.rutaMasterPath, req.params.code, info?.IllustrationID);
        if (!ruta) ruta = await obtenerImagenRepoCartasBot(datos.rutaMasterPath, info?.IllustrationID);
        if (!ruta) return res.status(404).end();
        res.sendFile(ruta);
    } catch (e) {
        res.status(500).end();
    }
});

dashboardApp.get('/logo/:expansionB64', (req, res) => {
    try {
        const nombre = Buffer.from(req.params.expansionB64, 'base64url').toString('utf8');
        const ruta = buscarLogoExpansionBot(nombre);
        if (!ruta) return res.status(404).end();
        res.sendFile(ruta);
    } catch (e) {
        res.status(500).end();
    }
});

// Los mismos iconos de rareza que ya usa el bot en Discord (RAREZA_ICONOS_CARTAS/
// FUENTES_EMOJIS), servidos directo como archivo local -- para la pagina web no
// hace falta pasar por el sistema de emojis custom de Discord (que son por-guild
// y requieren un guild.id), el PNG de assets/element/ ya alcanza.
dashboardApp.get('/rarity-icon/:nombre', (req, res) => {
    const rutaRelativa = FUENTES_EMOJIS[req.params.nombre];
    if (!rutaRelativa || !rutaRelativa.toLowerCase().endsWith('.png')) return res.status(404).end();
    res.sendFile(path.join(__dirname, 'assets', rutaRelativa));
});

// Descarga en PDF (a pedido explicito del usuario 2026-07-31): el link del
// dashboard es "cualquiera con el enlace puede verlo", asi que para pasarle
// la coleccion a otra persona sin compartir ese acceso en vivo, se puede
// descargar un PDF -- un archivo estatico, sin ningun link detras. Reusa
// generarInfoAccountsPDF (el mismo generador de antes, pausado pero intacto).
dashboardApp.get('/account/:token/pdf', async (req, res) => {
    try {
        const datos = _dashboardTokens.get(req.params.token);
        if (!datos) return res.status(404).send('Link expirado o invalido.');
        const pdfBuffer = await generarInfoAccountsPDF(datos.rutaMasterPath, datos.archivoJson, 3, 90, datos.datosInventario);
        if (!pdfBuffer) return res.status(500).send('No se pudo generar el PDF.');
        const nombreArchivo = path.basename(datos.archivoJson, '.json') + '.pdf';
        res.set('Content-Type', 'application/pdf');
        res.set('Content-Disposition', `attachment; filename="${nombreArchivo}"`);
        res.send(pdfBuffer);
    } catch (e) {
        console.error('DEBUG: error generando PDF desde dashboard:', e);
        res.status(500).send('Error generando el PDF.');
    }
});

dashboardApp.get('/account/:token', async (req, res) => {
    try {
        const datos = _dashboardTokens.get(req.params.token);
        if (!datos) return res.status(404).send('Link expirado o invalido. Volve a apretar el boton de Info Accounts en Discord.');
        const { rutaMasterPath, archivoJson, datosInventario } = datos;

        const accountData = leerJsonSeguro(archivoJson);
        if (!accountData || !Array.isArray(accountData.pulls)) return res.status(404).send('No se pudo leer la cuenta.');

        const conteoPorCodigo = {};
        for (const pull of accountData.pulls) {
            if (!Array.isArray(pull.cards)) continue;
            for (const code of pull.cards) conteoPorCodigo[code] = (conteoPorCodigo[code] || 0) + 1;
        }

        // Catalogo completo (a pedido explicito del usuario 2026-08-01): antes
        // solo se listaban las cartas que la cuenta ya tenia -- ahora se
        // muestra TODA carta que existe en el juego por expansion, marcando
        // en gris (clase "faltante") las que esta cuenta todavia no saco, para
        // poder ver de un vistazo que le falta completar. Respaldo a la lista
        // vieja (solo lo que ya tiene) si el catalogo completo no esta
        // disponible por algun motivo (ej. ruta_master global sin configurar).
        const { cartas: catalogoCompleto } = await obtenerTodasLasCartasCacheadas();

        const porExpansion = {};
        if (catalogoCompleto) {
            for (const carta of catalogoCompleto) {
                if (!porExpansion[carta.expansion]) porExpansion[carta.expansion] = [];
                porExpansion[carta.expansion].push({
                    nombre: carta.nombre,
                    cantidad: conteoPorCodigo[carta.id] || 0,
                    code: carta.id,
                    tipoRareza: carta.tipoRareza
                });
            }
        } else {
            const cardMap = cargarCardMap(rutaMasterPath);
            const en_US = rutaMasterPath ? leerJsonSeguro(path.join(rutaMasterPath, 'en_US.json')) : null;
            const cardmaster = rutaMasterPath ? leerJsonSeguro(path.join(rutaMasterPath, 'cardmaster.json')) : null;
            const expansiones = construirMapaExpansiones(en_US);
            for (const [code, cantidad] of Object.entries(conteoPorCodigo)) {
                const infoMapa = cardMap?.[code];
                const expansionId = infoMapa?.ExpansionID;
                const nombreExpansion = expansionId ? (expansiones[expansionId] || expansionId) : 'Unknown';
                const infoMaster = cardmaster?.[code];
                const nombreCarta = (infoMaster?.Name && en_US?.[infoMaster.Name]) || infoMaster?.Name || code;
                const tipoRareza = tipoRarezaDesdeInfo(infoMaster) || '';
                if (!porExpansion[nombreExpansion]) porExpansion[nombreExpansion] = [];
                porExpansion[nombreExpansion].push({ nombre: nombreCarta, cantidad, code, tipoRareza });
            }
        }
        for (const lista of Object.values(porExpansion)) lista.sort((a, b) => a.nombre.localeCompare(b.nombre));
        const expansionesOrdenadas = Object.keys(porExpansion).sort();

        // Total de cartas (a pedido explicito del usuario 2026-08-01): suma de
        // TODOS los pulls, cada copia repetida cuenta -- no es "cartas unicas",
        // es "cuantas cartas en total salieron de sobres" (ej. 1029).
        const totalCartas = Object.values(conteoPorCodigo).reduce((s, n) => s + n, 0);

        // Filtro por rareza (a pedido explicito del usuario 2026-07-31): los
        // MISMOS iconos que ya usa el bot en Discord (RAREZA_ICONOS_CARTAS +
        // FUENTES_EMOJIS), no emojis genericos de Unicode -- el usuario ya
        // habia notado la diferencia con los iconos custom que se ven en el
        // resto del bot. Filtra TODAS las expansiones a la vez (con scroll el
        // usuario sigue viendo cada seccion, solo que ya filtrada) via un
        // atributo data-rareza por carta + JS chiquito, sin pedirle nada al
        // servidor.
        // Reusado tambien para la "pildora" de rareza debajo de cada carta (a
        // pedido explicito del usuario, mostrando como referencia su propio
        // dashboard de PTCGPB).
        function iconosRarezaHtml(tipoRareza) {
            const cfg = tipoRareza ? RAREZA_ICONOS_CARTAS[tipoRareza] : null;
            if (!cfg) return '';
            const iconos = `<img src="/rarity-icon/${cfg.emoji}" class="icono-rareza">`.repeat(cfg.cantidad);
            return cfg.distintivo ? `${iconos}${cfg.distintivo}` : iconos;
        }

        const escaparHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

        // Convierte el markup de emoji personalizado de Discord (<:nombre:id>, ver
        // ETIQUETAS_INVENTARIO) a <img> del CDN de Discord -- a pedido explicito del usuario
        // 2026-08-05, para que se vean los iconos reales en esta pagina web (el markup de
        // Discord no se renderiza fuera de un cliente de Discord).
        const emojiDiscordAImg = (s) => String(s).replace(/<a?:(\w+):(\d+)>/g, (_, nombre, id) => `<img src="https://cdn.discordapp.com/emojis/${id}.png?size=24" alt="${nombre}" class="icono-inventario">`);

        // Barra de filtros compacta (a pedido explicito del usuario
        // 2026-08-01): antes eran dos filas de botones (una por rareza, otra
        // por expansion) -- se probo con <select> nativo para que ocupe menos
        // espacio, pero un <select>/<option> del navegador NO puede mostrar
        // imagenes adentro (el usuario pidio ver los iconos propios de rareza
        // y los logos de expansion ahi) -- por eso es un dropdown propio:
        // un boton que abre un panel con las opciones (con imagen incluida),
        // se cierra solo al elegir una o al tocar afuera.
        const opcionesRarezaHtml = `<div class="dropdown-opcion activo" data-filtro="all"><span class="dropdown-opcion-texto">All rarities</span></div>` +
            Object.entries(RAREZA_ICONOS_CARTAS).map(([valor, cfg]) => {
                const iconos = `<img src="/rarity-icon/${cfg.emoji}" class="icono-rareza">`.repeat(cfg.cantidad);
                const sufijo = cfg.distintivo ? `${cfg.distintivo} ${cfg.etiqueta}` : cfg.etiqueta;
                return `<div class="dropdown-opcion" data-filtro="${valor}">${iconos} <span class="dropdown-opcion-texto">${escaparHtml(sufijo)}</span></div>`;
            }).join('');

        const opcionesExpansionHtml = `<div class="dropdown-opcion activo" data-filtro-exp="all"><span class="dropdown-opcion-texto">All expansions</span></div>` +
            expansionesOrdenadas.map(exp => {
                const rutaLogo = buscarLogoExpansionBot(exp);
                const logoHtml = rutaLogo ? `<img src="/logo/${Buffer.from(exp).toString('base64url')}" class="dropdown-logo">` : '';
                return `<div class="dropdown-opcion" data-filtro-exp="${escaparHtml(exp)}">${logoHtml}<span class="dropdown-opcion-texto">${escaparHtml(exp)}</span></div>`;
            }).join('');

        let html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Account Report - ${escaparHtml(accountData.deviceAccount || '')}</title>
<style>
    /* Estilo "glass" (a pedido explicito del usuario 2026-08-01): fondo con
       degrade + paneles semitransparentes con backdrop-filter: blur en vez de
       colores solidos planos -- el degrade de fondo es lo que le da "cuerpo"
       al blur (sobre un color solido liso el efecto vidrio no se nota). */
    body { font-family: -apple-system, Arial, sans-serif; color: #edf2ff; margin: 0; padding: 20px 24px 60px;
        background: radial-gradient(circle at 15% 0%, #1c2b52 0%, #0b1020 45%), radial-gradient(circle at 85% 30%, #2a1f4d 0%, #0b1020 55%), #0b1020;
        background-attachment: fixed; }
    h1 { font-size: 20px; margin: 0 0 4px; }
    .sub { color: #aeb9d4; font-size: 13px; margin-bottom: 12px; }
    .sub:last-of-type { margin-bottom: 28px; }
    .expansion { margin-bottom: 40px; }
    .expansion-header { display: flex; flex-direction: column; align-items: center; margin-bottom: 14px; }
    .expansion-header img { max-height: 56px; max-width: 220px; margin-bottom: 8px; }
    .expansion-header h2 { font-size: 14px; margin: 0; font-weight: 600; color: #cfe0ff; padding: 4px 14px; border-radius: 20px;
        background: rgba(255,255,255,0.06); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); border: 1px solid rgba(255,255,255,0.12); }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 16px; }
    .card-tile { background: rgba(255,255,255,0.055); backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); border-radius: 14px; padding: 8px; border: 1px solid rgba(255,255,255,0.12); }
    .img-wrap { position: relative; }
    .card-tile img { width: 100%; border-radius: 10px; display: block; background: #1c2540; aspect-ratio: 0.716; object-fit: cover; }
    .badge { position: absolute; bottom: 8px; right: 8px; background: rgba(0,0,0,0.6); backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); color: #FFD700; font-weight: bold; font-size: 13px; padding: 3px 9px; border-radius: 10px; }
    .top-bar { display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; margin-bottom: 4px; }
    .download-btn { background: rgba(44,102,232,0.55); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); border: 1px solid rgba(255,255,255,0.15); color: #fff; text-decoration: none; font-size: 13px; font-weight: 600; padding: 8px 16px; border-radius: 10px; white-space: nowrap; }
    .download-btn:hover { background: rgba(61,120,255,0.65); }
    .filtros { position: sticky; top: 0; z-index: 10; background: rgba(11,16,32,0.55); backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); padding: 12px; margin: 0 -12px 8px; border-radius: 14px; display: flex; flex-wrap: wrap; gap: 10px; border: 1px solid rgba(255,255,255,0.1); }
    .dropdown { position: relative; }
    .dropdown-toggle { display: flex; align-items: center; gap: 10px; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.15); color: #edf2ff; font-size: 13px; padding: 8px 12px; border-radius: 10px; cursor: pointer; min-width: 160px; font-family: inherit; }
    .dropdown-toggle:hover { background: rgba(255,255,255,0.1); }
    .dropdown-toggle .caret { margin-left: auto; opacity: 0.7; font-size: 11px; }
    .dropdown-panel { display: none; position: absolute; top: calc(100% + 6px); left: 0; z-index: 20; background: #171d33; border: 1px solid rgba(255,255,255,0.15); border-radius: 10px; padding: 6px; min-width: 220px; max-height: 320px; overflow-y: auto; box-shadow: 0 12px 30px rgba(0,0,0,0.4); }
    .dropdown-panel.abierto { display: block; }
    .dropdown-opcion { display: flex; align-items: center; gap: 8px; padding: 7px 10px; border-radius: 8px; cursor: pointer; font-size: 13px; white-space: nowrap; }
    .dropdown-opcion:hover { background: rgba(255,255,255,0.08); }
    .dropdown-opcion.activo { background: rgba(44,102,232,0.35); }
    .dropdown-logo { height: 20px; max-width: 60px; object-fit: contain; }
    .card-tile.oculta { display: none; }
    .expansion.oculta { display: none; }
    /* Cartas que la cuenta todavia no saco (a pedido explicito del usuario
       2026-08-01, ver todo el catalogo y no solo lo que ya tiene) -- en gris,
       sin badge de cantidad, para distinguirlas de un vistazo. */
    .card-tile.faltante img { filter: grayscale(1) brightness(0.5); }
    .card-tile.faltante .rareza-pill { opacity: 0.4; filter: grayscale(1); }
    /* Si ni siquiera hay imagen en disco/repositorio para esa carta (nadie la
       cacheo todavia), se oculta el <img> roto y se deja un placeholder liso
       en vez del icono feo de "imagen rota" del navegador. */
    .card-tile img.rota { visibility: hidden; }
    .card-tile img.rota + .badge { display: none; }
    .img-wrap:has(img.rota) { background: rgba(255,255,255,0.04); border-radius: 10px; aspect-ratio: 0.716; }
    .icono-rareza { height: 13px; vertical-align: middle; margin-right: 1px; }
    .icono-inventario { height: 16px; width: 16px; vertical-align: middle; margin-right: 2px; }
    .lista-inventario { margin: 4px 0; }
    .lista-inventario div { padding: 2px 0; }
    .rareza-tag { display: flex; justify-content: center; margin-top: 8px; }
    .rareza-pill { display: inline-flex; align-items: center; }
    .card-tile img { cursor: zoom-in; }
    .lightbox { display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.85); z-index: 100; align-items: center; justify-content: center; cursor: zoom-out; padding: 24px; }
    .lightbox.abierto { display: flex; }
    /* Ancho/alto fijos (no max-width/max-height sueltos) para que toda carta
       se vea del MISMO tamaño en el zoom sin importar la resolucion real de
       origen (Drive HD/local/repositorio traen tamaños nativos distintos) --
       object-fit: contain hace que la imagen se ajuste adentro de esa caja
       fija sin recortarse ni estirarse. */
    .lightbox-box { width: min(85vw, 460px); aspect-ratio: 0.716; }
    .lightbox img { width: 100%; height: 100%; object-fit: contain; border-radius: 16px; box-shadow: 0 12px 40px rgba(0,0,0,0.5); }
</style></head><body>
<div class="top-bar">
    <h1>Account Report — ${escaparHtml(accountData.deviceAccount || path.basename(archivoJson, '.json'))}</h1>
    <a class="download-btn" href="/account/${req.params.token}/pdf" download>⬇ Download PDF</a>
</div>
<div class="lightbox" id="lightbox"><div class="lightbox-box"><img id="lightbox-img" src="" alt=""></div></div>
<div class="sub">File: ${escaparHtml(accountData.metadata?.fileName || '')} — el link de esta pagina es privado, pero si lo compartís cualquiera con el enlace puede verlo. Para pasarle esto a alguien, mejor descargá el PDF y mandale el archivo.</div>
<div class="sub"><img src="https://cdn.discordapp.com/emojis/1534731032400756807.png?size=24" alt="Cards" class="icono-inventario"> Total cards pulled: <strong>${totalCartas}</strong></div>
${datosInventario ? `<div class="sub lista-inventario">
    <div><img src="https://cdn.discordapp.com/emojis/1534723123914739802.png?size=24" alt="Shinedust" class="icono-inventario"> Shinedust: <strong>${escaparHtml(datosInventario.shinedust)}</strong></div>
    ${camposInventarioEmbed(datosInventario).map(c => `<div>${emojiDiscordAImg(c.name)}: <strong>${escaparHtml(c.value)}</strong></div>`).join('\n    ')}
</div>` : ''}
<div class="filtros">
    <div class="dropdown" id="dropdown-expansion">
        <button type="button" class="dropdown-toggle" id="toggle-expansion"><span class="dropdown-toggle-texto">All expansions</span><span class="caret">▾</span></button>
        <div class="dropdown-panel" id="panel-expansion">${opcionesExpansionHtml}</div>
    </div>
    <div class="dropdown" id="dropdown-rareza">
        <button type="button" class="dropdown-toggle" id="toggle-rareza"><span class="dropdown-toggle-texto">All rarities</span><span class="caret">▾</span></button>
        <div class="dropdown-panel" id="panel-rareza">${opcionesRarezaHtml}</div>
    </div>
    <div class="dropdown" id="dropdown-estado">
        <button type="button" class="dropdown-toggle" id="toggle-estado"><span class="dropdown-toggle-texto">All cards</span><span class="caret">▾</span></button>
        <div class="dropdown-panel" id="panel-estado">
            <div class="dropdown-opcion activo" data-filtro-estado="all"><span class="dropdown-opcion-texto">All cards</span></div>
            <div class="dropdown-opcion" data-filtro-estado="tiene"><span class="dropdown-opcion-texto">✅ Have</span></div>
            <div class="dropdown-opcion" data-filtro-estado="falta"><span class="dropdown-opcion-texto">⬜ Missing</span></div>
        </div>
    </div>
</div>`;

        for (const expansion of expansionesOrdenadas) {
            const rutaLogo = buscarLogoExpansionBot(expansion);
            // A pedido explicito del usuario 2026-08-01: en vez del nombre de
            // la expansion (redundante con el logo de arriba), mostrar cuantas
            // cartas tiene la cuenta sobre el total del catalogo (ej. "42/107
            // cards") -- antes solo se listaba lo que ya tenia, asi que no
            // habia forma de ver cuanto faltaba para completar la expansion.
            const totalExpansion = porExpansion[expansion].length;
            const tenidas = porExpansion[expansion].filter(c => c.cantidad > 0).length;
            const textoHeader = rutaLogo ? `${tenidas}/${totalExpansion} cards` : `${escaparHtml(expansion)} — ${tenidas}/${totalExpansion} cards`;
            html += `<div class="expansion" data-expansion="${escaparHtml(expansion)}"><div class="expansion-header">`;
            if (rutaLogo) {
                const logoB64 = Buffer.from(expansion).toString('base64url');
                html += `<img src="/logo/${logoB64}" alt="${escaparHtml(expansion)}">`;
            }
            html += `<h2>${textoHeader}</h2></div><div class="grid">`;
            for (const carta of porExpansion[expansion]) {
                const iconosCarta = iconosRarezaHtml(carta.tipoRareza);
                const faltante = carta.cantidad === 0;
                html += `<div class="card-tile${faltante ? ' faltante' : ''}" data-rareza="${escaparHtml(carta.tipoRareza)}" data-tiene="${faltante ? '0' : '1'}"><div class="img-wrap"><img src="/img/${req.params.token}/${encodeURIComponent(carta.code)}" loading="lazy" alt="${escaparHtml(carta.nombre)}" onerror="this.classList.add('rota')">`;
                if (carta.cantidad > 0) html += `<div class="badge">x${carta.cantidad}</div>`;
                html += `</div>`;
                if (iconosCarta) html += `<div class="rareza-tag"><span class="rareza-pill">${iconosCarta}</span></div>`;
                html += `</div>`;
            }
            html += `</div></div>`;
        }
        html += `<script>
function armarDropdown(toggleId, panelId, atributoDataset, onElegir) {
    var toggle = document.getElementById(toggleId);
    var panel = document.getElementById(panelId);
    var textoToggle = toggle.querySelector('.dropdown-toggle-texto');
    toggle.addEventListener('click', function (e) {
        e.stopPropagation();
        document.querySelectorAll('.dropdown-panel').forEach(function (p) { if (p !== panel) p.classList.remove('abierto'); });
        panel.classList.toggle('abierto');
    });
    panel.querySelectorAll('.dropdown-opcion').forEach(function (opcion) {
        opcion.addEventListener('click', function () {
            panel.querySelectorAll('.dropdown-opcion').forEach(function (o) { o.classList.remove('activo'); });
            opcion.classList.add('activo');
            textoToggle.textContent = opcion.querySelector('.dropdown-opcion-texto').textContent;
            panel.classList.remove('abierto');
            onElegir(opcion.dataset[atributoDataset]);
        });
    });
}
document.addEventListener('click', function () {
    document.querySelectorAll('.dropdown-panel').forEach(function (p) { p.classList.remove('abierto'); });
});
// Rareza y Have/Missing filtran la MISMA tarjeta a la vez (a pedido explicito
// del usuario 2026-08-01: agregar el filtro de "tenes/no tenes" ademas del de
// rareza que ya existia) -- se guarda el filtro activo de cada uno y se
// reevaluan juntos, para que elegir uno no pise lo que ya habia elegido el otro.
var filtroRarezaActual = 'all';
var filtroEstadoActual = 'all';
function aplicarFiltrosTarjeta() {
    document.querySelectorAll('.card-tile').forEach(function (tile) {
        var coincideRareza = (filtroRarezaActual === 'all' || tile.dataset.rareza === filtroRarezaActual);
        var coincideEstado = (filtroEstadoActual === 'all')
            || (filtroEstadoActual === 'tiene' && tile.dataset.tiene === '1')
            || (filtroEstadoActual === 'falta' && tile.dataset.tiene === '0');
        tile.classList.toggle('oculta', !(coincideRareza && coincideEstado));
    });
}
armarDropdown('toggle-rareza', 'panel-rareza', 'filtro', function (filtro) {
    filtroRarezaActual = filtro;
    aplicarFiltrosTarjeta();
});
armarDropdown('toggle-estado', 'panel-estado', 'filtroEstado', function (filtro) {
    filtroEstadoActual = filtro;
    aplicarFiltrosTarjeta();
});
armarDropdown('toggle-expansion', 'panel-expansion', 'filtroExp', function (filtro) {
    document.querySelectorAll('.expansion').forEach(function (exp) {
        var coincide = (filtro === 'all' || exp.dataset.expansion === filtro);
        exp.classList.toggle('oculta', !coincide);
    });
});
var lightbox = document.getElementById('lightbox');
var lightboxImg = document.getElementById('lightbox-img');
document.querySelectorAll('.card-tile img').forEach(function (img) {
    img.addEventListener('click', function () {
        lightboxImg.src = img.src;
        lightbox.classList.add('abierto');
    });
});
lightbox.addEventListener('click', function () {
    lightbox.classList.remove('abierto');
    lightboxImg.src = '';
});
</script></body></html>`;
        res.send(html);
    } catch (e) {
        console.error('DEBUG: error en dashboard /account:', e);
        res.status(500).send('Error generando el dashboard.');
    }
});

// Tunel publico (Cloudflare Quick Tunnel) para que el link de Info Accounts
// funcione desde CUALQUIER red, no solo la misma WiFi que la PC (a pedido
// explicito del usuario 2026-07-31: "no estoy en el mismo wifi"). Si no esta
// el binario (bin/cloudflared.exe) simplemente no arranca el tunel y el link
// cae de vuelta a localhost/IP de LAN -- no bloquea el resto del bot.
// bin/ se copia al paquete en scripts/build-exe.js (copiarBin) SOLO para
// quien baja el zip completo de cero -- quien ya tenia el programa instalado
// y solo usa "Update Now" (reemplaza el .exe + assets/, nunca crea carpetas
// nuevas) nunca iba a terminar teniendolo (bug real 2026-08-01, confirmado
// por Ale probando como usuario). Por eso ademas se autodescarga una sola
// vez desde el repositorio oficial de Cloudflare si no esta presente.
const CLOUDFLARED_URL_OFICIAL = 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe';
// Bug real 2026-08-01: justo al actualizar, el proceso viejo (todavia
// cerrando) y el nuevo llegaron a correr superpuestos un instante, los dos
// intentando descargar cloudflared.exe al mismo tiempo -- el archivo
// temporal compartido ("...descargando", mismo nombre para ambos) se
// pisaba entre los dos, dejando a uno con "ENOENT" al renombrar. El nombre
// temporal ahora incluye el PID de cada proceso para que nunca choquen.
async function asegurarCloudflaredBot() {
    const rutaCloudflared = path.join(__dirname, 'bin', 'cloudflared.exe');
    if (fs.existsSync(rutaCloudflared)) return { ruta: rutaCloudflared, recienDescargado: false };
    try {
        fs.mkdirSync(path.dirname(rutaCloudflared), { recursive: true });
        const rutaTemporal = `${rutaCloudflared}.descargando.${process.pid}`;
        const respuesta = await axios.get(CLOUDFLARED_URL_OFICIAL, { responseType: 'stream', timeout: 120000, maxRedirects: 5 });
        await new Promise((resolve, reject) => {
            const archivo = fs.createWriteStream(rutaTemporal);
            respuesta.data.pipe(archivo);
            archivo.on('finish', resolve);
            archivo.on('error', reject);
        });
        // Si otro proceso (ej. la instancia vieja que todavia no termino de
        // cerrar durante un update) ya dejo el archivo real listo mientras
        // este descargaba, no hace falta renombrar el propio -- se descarta.
        if (!fs.existsSync(rutaCloudflared)) fs.renameSync(rutaTemporal, rutaCloudflared);
        else fs.rmSync(rutaTemporal, { force: true });
        console.log('✅ cloudflared.exe descargado automaticamente -- Info Accounts ya puede armar un link publico.');
        return { ruta: rutaCloudflared, recienDescargado: true };
    } catch (e) {
        console.log('DEBUG: no se pudo descargar cloudflared.exe automaticamente:', e.message);
        return null;
    }
}

let DASHBOARD_PUBLIC_URL = null;
async function iniciarTunelDashboard(puerto) {
    const resultado = await asegurarCloudflaredBot();
    if (!resultado) {
        console.log('DEBUG: cloudflared.exe no disponible -- Info Accounts solo estara disponible en la misma red.');
        return;
    }
    if (resultado.recienDescargado) {
        // Bug real 2026-08-01: ejecutar el .exe apenas se termina de escribir
        // puede fallar con "spawn EBUSY" (Windows/el antivirus lo tiene
        // brevemente tomado justo despues de crearlo). Un respiro corto alcanza.
        await new Promise((resolve) => setTimeout(resolve, 1500));
    }

    for (let intento = 1; intento <= 3; intento++) {
        try {
            const proceso = spawn(resultado.ruta, ['tunnel', '--url', `http://localhost:${puerto}`], { windowsHide: true });
            const buscarUrl = (data) => {
                const texto = data.toString();
                const match = texto.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
                if (match && !DASHBOARD_PUBLIC_URL) {
                    DASHBOARD_PUBLIC_URL = match[0];
                    console.log(`🌐 Tunel publico Info Accounts: ${DASHBOARD_PUBLIC_URL}`);
                }
            };
            proceso.stdout.on('data', buscarUrl);
            proceso.stderr.on('data', buscarUrl);
            proceso.on('exit', (code) => {
                console.log(`DEBUG: cloudflared se cerro (codigo ${code}), Info Accounts vuelve a localhost/LAN.`);
                DASHBOARD_PUBLIC_URL = null;
            });
            return;
        } catch (e) {
            if (e.code === 'EBUSY' && intento < 3) {
                await new Promise((resolve) => setTimeout(resolve, 1000));
                continue;
            }
            console.log('DEBUG: no se pudo iniciar el tunel de Info Accounts:', e.message);
            return;
        }
    }
}

let DASHBOARD_PORT_ACTUAL = null;
function iniciarServidorDashboard(puerto, intento = 0) {
    const servidor = dashboardApp.listen(puerto, '0.0.0.0', () => {
        DASHBOARD_PORT_ACTUAL = puerto;
        console.log(`🚀 Dashboard Info Accounts online (port ${puerto})`);
        iniciarTunelDashboard(puerto);
    });
    servidor.on('error', (err) => {
        if (err.code === 'EADDRINUSE' && intento < 10) {
            iniciarServidorDashboard(puerto + 1, intento + 1);
        } else {
            console.error(`❌ Could not start Dashboard: ${err.message}`);
        }
    });
}
iniciarServidorDashboard(DASHBOARD_PORT_BASE);

function buscarArchivoXmlPorNombre(rutaBase, nombreBuscado) {
    if (!rutaBase || !fs.existsSync(rutaBase) || !nombreBuscado) return null;
    const objetivo = nombreBuscado.trim();
    const objetivoNorm = (objetivo.toLowerCase().endsWith('.xml') ? objetivo : `${objetivo}.xml`).toLowerCase();

    const pendientes = [rutaBase];
    while (pendientes.length) {
        const actual = pendientes.pop();
        let entradas;
        try {
            entradas = fs.readdirSync(actual, { withFileTypes: true });
        } catch (e) {
            continue;
        }
        for (const entrada of entradas) {
            const rutaCompleta = path.join(actual, entrada.name);
            if (entrada.isDirectory()) {
                pendientes.push(rutaCompleta);
            } else if (entrada.name.toLowerCase() === objetivoNorm) {
                return rutaCompleta;
            }
        }
    }
    return null;
}

const XML_SELECT_POR_PAGINA = 25;

// Dropdown paginado (25 por pagina, limite de Discord para un select menu) sobre una
// lista de nombres de XML -- usado por el flujo de Shinedust. Desde el fix
// 2026-07-29 recibe la lista ya filtrada por carta (buscarXmlPorCarta), igual
// que el dropdown de Trade.
function construirSelectXmlPaginado(fileNames, cartaId, pagina, prefix) {
    const totalPaginas = Math.max(1, Math.ceil(fileNames.length / XML_SELECT_POR_PAGINA));
    const paginaSegura = Math.min(Math.max(pagina, 0), totalPaginas - 1);
    const inicio = paginaSegura * XML_SELECT_POR_PAGINA;
    const items = fileNames.slice(inicio, inicio + XML_SELECT_POR_PAGINA);

    const menu = new StringSelectMenuBuilder()
        .setCustomId(`${prefix}::${cartaId}::${paginaSegura}`.slice(0, 100))
        .setPlaceholder(totalPaginas > 1 ? `Select an account (page ${paginaSegura + 1}/${totalPaginas})` : 'Select an account')
        .addOptions(items.map(f => ({ label: f.slice(0, 100), value: f.slice(0, 100) })));

    const componentes = [new ActionRowBuilder().addComponents(menu)];
    if (totalPaginas > 1) {
        componentes.push(new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`${prefix}_pag::${cartaId}::${paginaSegura - 1}`.slice(0, 100)).setLabel('◀️ Previous').setStyle(ButtonStyle.Secondary).setDisabled(paginaSegura <= 0),
            new ButtonBuilder().setCustomId(`${prefix}_pag::${cartaId}::${paginaSegura + 1}`.slice(0, 100)).setLabel('Next ▶️').setStyle(ButtonStyle.Secondary).setDisabled(paginaSegura >= totalPaginas - 1)
        ));
    }
    return { content: `Which account? (${fileNames.length} found)`, components: componentes };
}

function resolverNombreCarta(cartaId, rutaMasterPath) {
    if (!rutaMasterPath) return cartaId;
    const cardmaster = leerJsonSeguro(path.join(rutaMasterPath, 'cardmaster.json'));
    const en_US = leerJsonSeguro(path.join(rutaMasterPath, 'en_US.json'));
    const nameKey = cardmaster?.[cartaId]?.Name;
    return (nameKey && en_US?.[nameKey]) ? en_US[nameKey] : cartaId;
}

function buscarXmlPorCarta(rutaJsonCuentas, cartaId) {
    if (!rutaJsonCuentas || !fs.existsSync(rutaJsonCuentas)) return null;
    const archivos = fs.readdirSync(rutaJsonCuentas).filter(f => f.toLowerCase().endsWith('.json'));
    const resultados = [];

    for (const archivo of archivos) {
        const data = leerJsonSeguro(path.join(rutaJsonCuentas, archivo));
        if (!data || !Array.isArray(data.pulls)) continue;

        let cantidad = 0;
        for (const pull of data.pulls) {
            if (!Array.isArray(pull.cards)) continue;
            for (const id of pull.cards) {
                if (id === cartaId) cantidad++;
            }
        }

        if (cantidad > 0) {
            resultados.push({ fileName: data.metadata?.fileName || archivo, cantidad });
        }
    }

    resultados.sort((a, b) => b.cantidad - a.cantidad);
    return resultados;
}

const XML_POR_PAGINA = 40;

function construirEmbedXml(resultados, nombreCarta, cartaId, pagina = 0, prefijoBoton = 'wishlist') {
    const embed = new EmbedBuilder()
        .setTitle(`💠 XML — ${nombreCarta}`)
        .setColor(0xE91E63);

    const archivosPayload = [];
    if (fs.existsSync(SYMBOL_EMBEDS_PATH)) {
        embed.setThumbnail('attachment://symbol.png');
        archivosPayload.push(new AttachmentBuilder(SYMBOL_EMBEDS_PATH, { name: 'symbol.png' }));
    }

    if (resultados === null) {
        embed.setDescription('❌ Could not find the configured **JSON Accounts Path** folder.');
        return { embeds: [embed], files: archivosPayload };
    }

    if (resultados.length === 0) {
        embed.setDescription('This card was not found in any XML account.');
        return { embeds: [embed], files: archivosPayload };
    }

    const totalPaginas = Math.max(1, Math.ceil(resultados.length / XML_POR_PAGINA));
    const paginaSegura = Math.min(Math.max(pagina, 0), totalPaginas - 1);
    const inicio = paginaSegura * XML_POR_PAGINA;
    const items = resultados.slice(inicio, inicio + XML_POR_PAGINA);

    const descripcion = items.map(r => `\`${r.fileName}\` — x${r.cantidad} UNITS`).join('\n');

    embed.setDescription(descripcion)
        .setFooter({ text: `Page ${paginaSegura + 1} of ${totalPaginas} • ${resultados.length} account(s) found` });

    if (totalPaginas > 1) {
        return {
            embeds: [embed],
            files: archivosPayload,
            components: [new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`${prefijoBoton}_xml::${cartaId}::${paginaSegura - 1}`).setLabel('◀️ Previous').setStyle(ButtonStyle.Secondary).setDisabled(paginaSegura <= 0),
                new ButtonBuilder().setCustomId(`${prefijoBoton}_xml::${cartaId}::${paginaSegura + 1}`).setLabel('Next ▶️').setStyle(ButtonStyle.Secondary).setDisabled(paginaSegura >= totalPaginas - 1)
            )]
        };
    }

    return { embeds: [embed], files: archivosPayload };
}

function construirSlashCommands() {
    return [
        new SlashCommandBuilder().setName('setup').setDescription('Opens the bot control panel'),
        new SlashCommandBuilder().setName('embed').setDescription('Configures what is shown in the S4T embed'),
        new SlashCommandBuilder().setName('webhook').setDescription('Manages the name and avatar of each channel\'s webhooks')
            .addStringOption(opt => opt.setName('channel').setDescription('Upload a new avatar directly for this webhook (use together with "image")').setAutocomplete(true).setRequired(false))
            .addAttachmentOption(opt => opt.setName('image').setDescription('Image to use as the new avatar (use together with "type")').setRequired(false)),
        new SlashCommandBuilder().setName('card').setDescription('Runs the All Cards flow')
            .addStringOption(opt => opt.setName('expansion').setDescription('Filter by expansion before picking the name (optional)').setAutocomplete(true).setRequired(false))
            .addStringOption(opt => opt.setName('rarity').setDescription('Filter by rarity before picking the name (optional)').setRequired(false)
                .addChoices(
                    { name: '1 Diamond', value: '1-diamond' },
                    { name: '2 Diamond', value: '2-diamond' },
                    { name: '3 Diamond', value: '3-diamond' },
                    { name: '4 Diamond', value: '4-diamond' },
                    { name: '1 Star', value: '1-star' },
                    { name: '2 Star Trainer', value: '2-star-trainer' },
                    { name: '2 Star Full Art', value: '2-star-full-art' },
                    { name: '2 Star Rainbow', value: '2-star-rainbow' },
                    { name: 'Immersive', value: 'immersive' },
                    { name: '1 Star Shiny', value: '1-star-shiny' },
                    { name: '2 Star Shiny', value: '2-star-shiny' },
                    { name: 'Crown Rare', value: 'crown-rare' }
                ))
            .addStringOption(opt => opt.setName('name').setDescription('Search for a card directly by name (optional)').setAutocomplete(true).setRequired(false)),
        new SlashCommandBuilder().setName('wishlist').setDescription('Runs the Cards Wishlist flow')
            .addStringOption(opt => opt.setName('expansion').setDescription('Filter by expansion before picking the name (optional)').setAutocomplete(true).setRequired(false))
            .addStringOption(opt => opt.setName('rarity').setDescription('Filter by rarity before picking the name (optional)').setRequired(false)
                .addChoices(
                    { name: '1 Diamond', value: '1-diamond' },
                    { name: '2 Diamond', value: '2-diamond' },
                    { name: '3 Diamond', value: '3-diamond' },
                    { name: '4 Diamond', value: '4-diamond' },
                    { name: '1 Star', value: '1-star' },
                    { name: '2 Star Trainer', value: '2-star-trainer' },
                    { name: '2 Star Full Art', value: '2-star-full-art' },
                    { name: '2 Star Rainbow', value: '2-star-rainbow' },
                    { name: 'Immersive', value: 'immersive' },
                    { name: '1 Star Shiny', value: '1-star-shiny' },
                    { name: '2 Star Shiny', value: '2-star-shiny' },
                    { name: 'Crown Rare', value: 'crown-rare' }
                ))
            .addStringOption(opt => opt.setName('name').setDescription('Search for a card in your wishlist directly by name (optional)').setAutocomplete(true).setRequired(false)),
        new SlashCommandBuilder().setName('goldcards').setDescription('Runs the Gold Cards flow')
            .addStringOption(opt => opt.setName('expansion').setDescription('Filter by expansion before picking the name (optional)').setAutocomplete(true).setRequired(false))
            .addStringOption(opt => opt.setName('rarity').setDescription('Filter by rarity before picking the name (optional)').setRequired(false)
                .addChoices(
                    { name: '1 Diamond', value: '1-diamond' },
                    { name: '2 Diamond', value: '2-diamond' },
                    { name: '3 Diamond', value: '3-diamond' },
                    { name: '4 Diamond', value: '4-diamond' },
                    { name: '1 Star', value: '1-star' },
                    { name: '2 Star Trainer', value: '2-star-trainer' },
                    { name: '2 Star Full Art', value: '2-star-full-art' },
                    { name: '2 Star Rainbow', value: '2-star-rainbow' },
                    { name: 'Immersive', value: 'immersive' },
                    { name: '1 Star Shiny', value: '1-star-shiny' },
                    { name: '2 Star Shiny', value: '2-star-shiny' },
                    { name: 'Crown Rare', value: 'crown-rare' }
                ))
            .addStringOption(opt => opt.setName('name').setDescription('Search a Gold-eligible card directly by name (optional)').setAutocomplete(true).setRequired(false)),
        new SlashCommandBuilder()
            .setName('extract')
            .setDescription('Runs Extract XML')
            .addSubcommand(subcommand => subcommand.setName('xml').setDescription('Extract XML in the selected channel')),
        new SlashCommandBuilder()
            .setName('run')
            .setDescription('Runs Run MumuPlayer')
            .addSubcommand(subcommand => subcommand.setName('instance').setDescription('Open instance')),
        new SlashCommandBuilder().setName('feedback').setDescription('Send a suggestion or report a problem with the bot')
            .addAttachmentOption(opt => opt.setName('image').setDescription('Optional screenshot/photo of the problem').setRequired(false))
    ].map(cmd => cmd.toJSON());
}

async function obtenerGuildIdsRegistrables() {
    const rows = await db.all(`SELECT DISTINCT canal_id FROM configs_canales WHERE canal_id NOT IN ('N/A', 'local') AND canal_id IS NOT NULL`);
    const guildIds = new Set();
    for (const row of rows || []) {
        try {
            const response = await axios.get(`https://discord.com/api/v10/channels/${row.canal_id}`, {
                headers: { Authorization: `Bot ${TOKEN}` }
            });
            if (response.data?.guild_id) guildIds.add(response.data.guild_id);
        } catch (error) {
            console.error('❌ Could not read the category channel to register commands:', row.canal_id, error?.response?.status || error?.message || error);
        }
    }
    return [...guildIds];
}

async function registrarSlashCommands() {
    const rest = new REST({ version: '10' }).setToken(TOKEN);
    const commands = construirSlashCommands();
    const guildIds = new Set(client.guilds.cache.map(guild => guild.id));
    for (const guildId of await obtenerGuildIdsRegistrables()) guildIds.add(guildId);
    const applicationId = CLIENT_ID || client.user?.id;

    if (!applicationId) {
        console.log('⚠️ Could not resolve the applicationId to register slash commands.');
        return;
    }

    if (!guildIds.size) {
        console.log('⚠️ No registerable guilds found to publish slash commands.');
        return;
    }

    for (const guildId of guildIds) {
        await rest.put(Routes.applicationGuildCommands(applicationId, guildId), { body: commands });
        console.log(`✅ Slash commands registered in guild ${guildId}`);
    }
}

// Mantiene una única "interfaz" (embed + botones) parada en el canal por comando,
// en vez de mandar una nueva cada vez que se ejecuta el slash command — antes cada
// uso duplicaba el mensaje público y el canal se llenaba de spam. Guarda el ID del
// último mensaje en configs_extras (tipo='interfaz_msg_{clave}') y lo EDITA in situ;
// si ese mensaje ya no existe (lo borraron a mano), recién ahí crea uno nuevo.
//
// Hasta 2026-07-31 esto además "bumpeaba" el mensaje solo (borrar + mandar de
// nuevo al final del canal) si pasaban 5 minutos sin tocarlo, para que no
// quedara enterrado en el historial. A pedido explicito del usuario ("retira
// eso, que solo aparezca cuando el usuario lo decida... pero sin crear spam...
// que reuse el mismo mensaje") se saco SOLO el disparador automático por
// tiempo -- correr el comando a mano (forzarReubicar=true, ver
// ejecutarComandoEnCanal) sigue moviendo el panel al final del canal como
// siempre (por eso "aparece" cuando el usuario lo pide), simplemente ya no
// pasa solo por inactividad. "Sin spam"/"reusa el mismo mensaje" se cumple
// igual que antes: se borra el viejo ANTES de crear el nuevo, así que nunca
// hay dos a la vez -- solo cambia de posición (queda al final), nunca se
// duplica.
async function enviarOEditarInterfaz(userId, clave, webhookUrl, payloadJson, archivos = [], forzarReubicar = false, guild = null) {
    const claveMsg = `interfaz_msg_${clave}`;
    const filaMsg = await db.get(`SELECT estado FROM configs_extras WHERE discord_id = ? AND tipo = ?`, [userId, claveMsg]);
    const msgId = filaMsg?.estado || null;

    // Reubicar = mandarlo de nuevo al final del historial en vez de editarlo
    // donde ya estaba — hace falta borrar el viejo primero, si no queda uno
    // parado en el medio del chat y otro nuevo al final (duplicado).
    if (msgId && forzarReubicar) {
        // Si el usuario venía navegando (llegó a una carta puntual) el payload
        // que llegó acá es siempre la pantalla INICIAL del comando — reubicar
        // no debe pisarle la búsqueda con eso. En vez de copiar el mensaje
        // viejo tal cual (su embed apunta a un adjunto que muere en cuanto se
        // borra ese mensaje, con Discord/Cloudflare cacheando ese 404 de forma
        // inconsistente), se detecta qué carta puntual estaba abierta a partir
        // de los botones del mensaje actual y se reconstruye ESA pantalla de
        // cero — misma función que la armó la primera vez, imagen local
        // fresca, sin depender de ninguna URL de Discord.
        try {
            const actual = await axios.get(`${webhookUrl}/messages/${msgId}`, { timeout: 10000 });
            const componentesActuales = (actual?.data?.components || []).flatMap(fila => fila.components || []);
            const botonXml = componentesActuales.find(c => typeof c.custom_id === 'string' && (c.custom_id.startsWith('wishlist_xml::') || c.custom_id.startsWith('goldcards_xml::')));
            if (botonXml) {
                const [, cartaId] = botonXml.custom_id.split('::');
                const botonHome = componentesActuales.find(c => typeof c.custom_id === 'string' && c.custom_id.endsWith('_volver_expansiones'));
                const prefijo = botonHome ? botonHome.custom_id.replace('_volver_expansiones', '') : 'wishlist';
                const botonVolver = componentesActuales.find(c => typeof c.custom_id === 'string' && c.custom_id.includes('_volver_carta_lista::'));
                let volver = null;
                if (botonVolver) {
                    const [, expansion, categoria, pagina] = botonVolver.custom_id.split('::');
                    volver = { prefijo, expansion, categoria, pagina };
                }
                const rutaMasterCfg = await db.get(`SELECT webhook_url FROM configs_canales WHERE tipo = 'ruta_master'`);
                const rutaMasterPath = rutaMasterCfg?.webhook_url;
                const nombreCarta = resolverNombreCarta(cartaId, rutaMasterPath);
                let datosGold = null;
                if (prefijo === 'goldcards') {
                    const umbral = await obtenerUmbralGold(userId);
                    const rutaJsonCfg = await db.get(`SELECT webhook_url FROM configs_canales WHERE tipo = 'ruta_json_cuentas'`);
                    const mapaCopias = construirMapaCopiasPorCarta(rutaJsonCfg?.webhook_url);
                    datosGold = { cuentas: cuentasGoldParaCarta(mapaCopias, cartaId, umbral), umbral };
                }
                const payloadReconstruido = await construirEmbedDetalleCarta(cartaId, nombreCarta, rutaMasterPath, volver, guild, datosGold);
                payloadJson = { embeds: payloadReconstruido.embeds, components: payloadReconstruido.components || [] };
                archivos = archivosDesdeAttachmentBuilders(payloadReconstruido.files);
            }
            // Si no era una carta puntual (pantalla inicial, lista de
            // expansiones/categorías, etc.), no hace falta reconstruir nada:
            // esas pantallas ya usan siempre archivos locales fijos (banner,
            // logo de expansión) y el payload inicial que ya venía armado por
            // el caller sirve tal cual.
        } catch (e) {
            console.error(`DEBUG: no se pudo traer el estado actual antes de reubicar "${clave}":`, e?.response?.data || e?.message || e);
        }
        try { await axios.delete(`${webhookUrl}/messages/${msgId}`, { timeout: 10000 }); } catch (e) { /* si ya no existe, no pasa nada */ }
    }

    // Un FormData con streams de archivo solo se puede mandar UNA vez — si el
    // PATCH falla (mensaje borrado) y se reintenta con POST reusando el mismo
    // FormData, los streams ya están consumidos y la petición se queda colgada
    // para siempre. Por eso se arma un FormData nuevo (streams frescos) para
    // cada intento en vez de reusar uno solo.
    const construirRequest = () => {
        if (!archivos.length) return { data: payloadJson, headers: undefined };
        const form = new FormData();
        archivos.forEach((a, i) => form.append(`files[${i}]`, a.buffer || fs.createReadStream(a.ruta), { filename: a.filename }));
        // Sin este campo, un PATCH con archivos nuevos no reemplaza los adjuntos
        // viejos del mensaje — Discord los va acumulando, y el mismo mensaje
        // termina mostrando la imagen vieja suelta (fuera del embed) junto con
        // la nueva de adentro del embed. Declarar exactamente estos índices como
        // "los únicos adjuntos" fuerza a Discord a descartar cualquier otro.
        const payloadConAdjuntos = { ...payloadJson, attachments: archivos.map((a, i) => ({ id: i })) };
        form.append('payload_json', JSON.stringify(payloadConAdjuntos));
        return { data: form, headers: form.getHeaders() };
    };

    if (msgId && !forzarReubicar) {
        try {
            const { data, headers } = construirRequest();
            await axios.patch(`${webhookUrl}/messages/${msgId}`, data, { headers, timeout: 15000 });
            return;
        } catch (e) {
            // el mensaje ya no existe (borrado a mano) -> se crea uno nuevo abajo
        }
    }

    const { data, headers } = construirRequest();
    const resp = await axios.post(`${webhookUrl}?wait=true`, data, { headers, timeout: 15000 });
    await db.run(
        `INSERT INTO configs_extras (discord_id, tipo, estado) VALUES (?, ?, ?) ON CONFLICT(discord_id, tipo) DO UPDATE SET estado = ?`,
        [userId, claveMsg, String(resp.data.id), String(resp.data.id)]
    );
}

async function enviarComandoAlCanal(commandKey, user, row, forzarReubicar = false, guild = null) {
    if (commandKey === 'card_wishlist') {
        const mapaEmojisWishlist = await obtenerMapaEmojisGuild(guild);
        const embed = construirEmbedWishlistInicio(user, mapaEmojisWishlist);
        const fila = filaBotonesConTutorial('cmd_card_wishlist',
            new ButtonBuilder().setCustomId('wishlist_ver').setLabel('📋 View my Wishlist').setStyle(ButtonStyle.Primary)
        );

        const bannerPath = elegirBannerWishlistAleatorio();
        const archivos = [];
        if (fs.existsSync(bannerPath)) {
            embed.setImage('attachment://wishlist_banner.png');
            archivos.push({ ruta: bannerPath, filename: 'wishlist_banner.png' });
        }
        if (fs.existsSync(SYMBOL_EMBEDS_PATH)) {
            embed.setThumbnail('attachment://symbol.png');
            archivos.push({ ruta: SYMBOL_EMBEDS_PATH, filename: 'symbol.png' });
        }
        await enviarOEditarInterfaz(user.id, commandKey, row.webhook_url, { embeds: [embed], components: [fila] }, archivos, forzarReubicar, guild);
        return;
    }
    if (commandKey === 'card_all') {
        const embed = construirEmbedAllCardsInicio(user);
        const fila = filaBotonesConTutorial('cmd_card_all',
            new ButtonBuilder().setCustomId('allcards_ver_expansiones').setLabel('📋 View All Expansions').setStyle(ButtonStyle.Primary)
        );

        const bannerPath = elegirBannerAllCardsAleatorio();
        const symbolPath = path.join(__dirname, 'assets', 'embeds', 'symbol.png');
        const archivos = [];
        if (fs.existsSync(bannerPath)) {
            embed.setImage('attachment://card_banner.png');
            archivos.push({ ruta: bannerPath, filename: 'card_banner.png' });
        }
        if (fs.existsSync(symbolPath)) {
            embed.setThumbnail('attachment://symbol.png');
            archivos.push({ ruta: symbolPath, filename: 'symbol.png' });
        }
        await enviarOEditarInterfaz(user.id, commandKey, row.webhook_url, { embeds: [embed], components: [fila] }, archivos, forzarReubicar, guild);
        return;
    }
    if (commandKey === 'card_gold') {
        const embed = construirEmbedGoldCardsInicio(user);
        const fila = filaBotonesConTutorial('cmd_card_gold',
            new ButtonBuilder().setCustomId('goldcards_ver_expansiones').setLabel('🏆 View Gold Cards').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('goldcards_umbral').setLabel('⚙️ Threshold').setStyle(ButtonStyle.Secondary)
        );

        const bannerPath = path.join(__dirname, 'assets', 'embeds', 'card_banner.png');
        const symbolPath = path.join(__dirname, 'assets', 'embeds', 'symbol.png');
        const archivos = [];
        if (fs.existsSync(bannerPath)) {
            embed.setImage('attachment://card_banner.png');
            archivos.push({ ruta: bannerPath, filename: 'card_banner.png' });
        }
        if (fs.existsSync(symbolPath)) {
            embed.setThumbnail('attachment://symbol.png');
            archivos.push({ ruta: symbolPath, filename: 'symbol.png' });
        }
        await enviarOEditarInterfaz(user.id, commandKey, row.webhook_url, { embeds: [embed], components: [fila] }, archivos, forzarReubicar, guild);
        return;
    }
    if (commandKey === 'extract_xlm') {
        const mapaEmojis = await obtenerMapaEmojisGuild(guild);
        const embed = construirEmbedExtractXmlInicio(user, mapaEmojis);
        const fila = filaBotonesConTutorial('cmd_extract_xlm',
            new ButtonBuilder().setCustomId('extract_xml_abrir').setLabel('📋 Paste XML').setStyle(ButtonStyle.Primary)
        );

        const bannerPath = path.join(__dirname, 'assets', 'embeds', 'Extract_xml.png');
        const archivos = [];
        if (fs.existsSync(bannerPath)) {
            embed.setImage('attachment://Extract_xml.png');
            archivos.push({ ruta: bannerPath, filename: 'Extract_xml.png' });
        }
        if (fs.existsSync(SYMBOL_EMBEDS_PATH)) {
            embed.setThumbnail('attachment://symbol.png');
            archivos.push({ ruta: SYMBOL_EMBEDS_PATH, filename: 'symbol.png' });
        }
        await enviarOEditarInterfaz(user.id, commandKey, row.webhook_url, { embeds: [embed], components: [fila] }, archivos, forzarReubicar, guild);
        return;
    }
    if (commandKey === 'run_instance') {
        const embed = construirEmbedRunInstanceInicio(user);
        const fila = filaBotonesConTutorial('cmd_run_instance');
        const archivos = [];
        const tradeBannerPath = path.join(__dirname, 'assets', 'embeds', 'Trade_banner.png');
        if (fs.existsSync(tradeBannerPath)) {
            embed.setImage('attachment://Trade_banner.png');
            archivos.push({ ruta: tradeBannerPath, filename: 'Trade_banner.png' });
        }
        if (fs.existsSync(SYMBOL_EMBEDS_PATH)) {
            embed.setThumbnail('attachment://symbol.png');
            archivos.push({ ruta: SYMBOL_EMBEDS_PATH, filename: 'symbol.png' });
        }
        await enviarOEditarInterfaz(user.id, commandKey, row.webhook_url, { embeds: [embed], components: [fila] }, archivos, forzarReubicar, guild);
        return;
    }
    const embed = construirEmbedComando(commandKey, user);
    await enviarOEditarInterfaz(user.id, commandKey, row.webhook_url, { embeds: [embed] }, [], forzarReubicar, guild);
}

async function ejecutarComandoEnCanal(interaction, commandKey) {
    const cfg = COMANDO_CONFIG[commandKey];
    const row = await obtenerCanalComando(interaction.user.id, cfg.tipo);
    if (!row) {
        return interaction.reply({
            content: `❌ No channel synced for **${cfg.label}**. Use **Sync Channels** first.`,
            ephemeral: true
        });
    }

    if (interaction.channelId !== row.canal_id) {
        return interaction.reply({
            content: `❌ This command only works in <#${row.canal_id}>.`,
            ephemeral: true
        });
    }

    await interaction.deferReply({ ephemeral: true });
    try {
        // Correr el comando a mano siempre lo manda al final del historial —
        // no hace falta esperar el chequeo automático de 5 minutos, es una
        // forma explícita de traerlo de vuelta cuando el usuario lo pide.
        await enviarComandoAlCanal(commandKey, interaction.user, row, true, interaction.guild);
        return await interaction.editReply({ content: `✅ **${cfg.label}** sent successfully.` });
    } catch (error) {
        console.error(`Error enviando ${commandKey}:`, error?.response?.data || error?.message || error);
        return await interaction.editReply({ content: `❌ Could not send **${cfg.label}**.` });
    }
}

// Bug real encontrado 2026-07-25 probando con un usuario real (no PM2, .exe
// empaquetado con launcher.js): "pm2 jlist" siempre falla ahi (no tiene PM2
// instalado), asi que esto devolvia OFFLINE sin importar que heartbeat.js
// estuviera corriendo perfecto - el boton "Heartbeat On/Off" nunca reflejaba
// bien el estado, y el usuario no podia saber si de verdad estaba prendido.
// Cuando "pm2 jlist" no responde, se usa la MISMA bandera que heartbeat.js ya
// chequea internamente en cada request (tabla estados_modulos) - esa es la
// fuente de verdad real sin importar quien supervise los procesos (PM2 o
// launcher.js).
function verificarEstadoPM2(nombreProceso, script = null) {
    return new Promise((resolve) => {
        exec('pm2 jlist', { windowsHide: true }, async (err, stdout) => {
            if (err) {
                try {
                    const fila = await db.get(`SELECT status FROM estados_modulos WHERE nombre = ?`, [nombreProceso]);
                    // Sin fila guardada = nunca se toco el toggle = arranca online
                    // por defecto, mismo criterio que ya usa heartbeat.js.
                    return resolve((!fila || fila.status === 'online') ? '🟢 ONLINE' : '🔴 OFFLINE');
                } catch (e) {
                    return resolve('🟢 ONLINE');
                }
            }
            try {
                const procesos = JSON.parse(stdout);
                const matches = procesos.filter(p => p.name === nombreProceso);
                if (!matches.length) return resolve('🔴 OFFLINE');

                let filtered = matches;
                if (script) {
                    filtered = matches.filter(p => {
                        const execPath = p.pm2_env?.pm_exec_path || '';
                        return execPath.toLowerCase().endsWith(script.toLowerCase());
                    });
                }

                if (!filtered.length) return resolve('🔴 OFFLINE');
                const online = filtered.some(p => p.pm2_env?.status?.toLowerCase() === 'online');
                resolve(online ? '🟢 ONLINE' : '🔴 OFFLINE');
            } catch (e) { resolve('🔴 OFFLINE'); }
        });
    });
}

function ejecutarPM2Start(nombreProceso, script) {
    exec('pm2 jlist', { windowsHide: true }, (err, stdout) => {
        if (err) {
            return exec(`pm2 start ${script} --name "${nombreProceso}"`, { windowsHide: true }, () => {});
        }
        try {
            const procesos = JSON.parse(stdout);
            const matches = procesos.filter(p => p.name === nombreProceso);
            const exact = matches.find(p => {
                const execPath = p.pm2_env?.pm_exec_path || '';
                return execPath.toLowerCase().endsWith(script.toLowerCase());
            });

            if (matches.length > 1 || (matches.length === 1 && !exact)) {
                return exec(`pm2 delete ${nombreProceso}`, { windowsHide: true }, () => {
                    exec(`pm2 start ${script} --name "${nombreProceso}"`, { windowsHide: true }, () => {});
                });
            }

            if (exact) {
                const status = exact.pm2_env?.status?.toLowerCase();
                if (status === 'online') return;
                return exec(`pm2 restart ${exact.pm_id}`, { windowsHide: true }, () => {});
            }

            exec(`pm2 start ${script} --name "${nombreProceso}"`, { windowsHide: true }, () => {});
        } catch (e) {
            exec(`pm2 start ${script} --name "${nombreProceso}"`, { windowsHide: true }, () => {});
        }
    });
}

async function tieneConfiguracion(userId, tipoModulo) {
    try {
        const row = await db.get(`SELECT webhook_url FROM configs_canales WHERE discord_id = ? AND tipo = ?`, [userId, tipoModulo]);
        return !!(row && row.webhook_url);
    } catch (error) { return false; }
}

const BUILD_EMBED_OPCIONES = [
    { clave: 'mostrar_tipo', label: 'Pokémon type and name', ejemplo: (mapaEmojis) => `${tagTipoBot('type_psychic', mapaEmojis)} Slowbro`.trim() },
    { clave: 'mostrar_logo', label: 'Expansion logo', ejemplo: () => 'Logo above the image' },
    { clave: 'mostrar_archivo', label: 'Account file', ejemplo: () => '📁 Account file' },
    { clave: 'mostrar_categoria', label: 'Card category', ejemplo: (mapaEmojis) => formatearRarezaPreview('1-star-shiny', mapaEmojis) },
    { clave: 'mostrar_instancia', label: 'Instance', ejemplo: () => '🖥️ Instance' },
    { clave: 'mostrar_sobre', label: 'Pack name', ejemplo: () => '📦 Pack' }
];

async function obtenerConfigBuildEmbed(userId) {
    const filas = await db.all(
        `SELECT tipo, estado FROM configs_extras WHERE discord_id = ? AND tipo LIKE 'embed_%'`,
        [userId]
    );
    const estados = {};
    for (const fila of filas) estados[fila.tipo.replace('embed_', '')] = fila.estado;

    const resultado = {};
    for (const opcion of BUILD_EMBED_OPCIONES) {
        resultado[opcion.clave] = estados[opcion.clave] !== 'off';
    }
    return resultado;
}

// Mismo criterio que normalizarNombreEx() en s4t.js: el juego escribe el sufijo
// en minúscula ("Mewtwo ex"), el usuario lo quiere siempre en mayúscula ("Mewtwo EX").
function normalizarNombreExBot(nombre) {
    return nombre ? nombre.replace(/\bex\b/gi, 'EX') : nombre;
}

// mapaEmojis: { nombreEmoji: idEmoji }, resuelto por servidor (ver guild-emojis.js).
function tagTipoBot(claveTipo, mapaEmojis) {
    if (!claveTipo) return '';
    const id = mapaEmojis?.[claveTipo];
    return id ? `<:${claveTipo}:${id}>` : '';
}

// Mismas categorías y separador ('›') que usa RAREZA_ICONOS/formatearLineaRareza en
// s4t.js para los embeds reales — acá se usa un texto sintético en vez del texto
// crudo parseado del juego, porque esto es una vista previa sin datos reales.
const RAREZA_PREVIEW_CONFIG = {
    '1-star': { emoji: 'rareza_estrella', modo: 'reemplazar', texto: '1-Star (x1)' },
    '1-star-shiny': { emoji: 'rareza_brillante', modo: 'reemplazar', texto: 'Shiny 1-Star (x1)' },
    'crown-rare': { emoji: 'rareza_corona', modo: 'reemplazar', texto: 'Crown (x1)' },
    '2-star-trainer': { emoji: 'rareza_estrella', modo: 'prefijo', cantidad: 2, texto: 'Trainer' },
    '2-star-rainbow': { emoji: 'rareza_estrella', modo: 'prefijo', cantidad: 2, extra: '🌈', texto: 'Rainbow' },
    '2-star-full-art': { emoji: 'rareza_estrella', modo: 'prefijo', cantidad: 2, extra: '🎨', texto: 'Full Art' },
    '2-star-shiny': { emoji: 'rareza_brillante', modo: 'prefijo', cantidad: 2, texto: 'Shiny' },
    '3-diamond': { emoji: 'rareza_diamante', modo: 'prefijo', cantidad: 3, sinSeparador: true, texto: '3 Diamonds (x1)' },
    '4-diamond': { emoji: 'rareza_diamante', modo: 'prefijo', cantidad: 4, sinSeparador: true, texto: '4 Diamonds (x1)' },
    'immersive': { emoji: 'rareza_estrella', modo: 'prefijo', cantidad: 3, extra: '🌌', texto: 'Immersive' }
};

function formatearRarezaPreview(clave, mapaEmojis) {
    const config = RAREZA_PREVIEW_CONFIG[clave];
    if (!config) return '';
    const id = mapaEmojis?.[config.emoji];
    const tag = id ? `<:${config.emoji}:${id}>` : '';
    if (config.modo === 'reemplazar') return `${tag} › ${config.texto}`;
    const prefijo = new Array(config.cantidad).fill(tag).join('');
    if (config.sinSeparador) return `${prefijo} ${config.texto}`;
    const extra = config.extra ? `${config.extra} ` : '';
    return `${prefijo} › ${extra}${config.texto}`;
}

const RAREZA_NUMERICA_PREVIEW = {
    300: '3-diamond', 400: '4-diamond', 500: '1-star', 600: '2-star-rainbow',
    700: '2-star-full-art', 800: 'immersive', 830: '1-star-shiny', 860: '2-star-shiny', 900: 'crown-rare'
};
function mapearRarezaNumericaPreview(rarityNum, code) {
    const num = Number(rarityNum);
    if (!Number.isFinite(num)) return null;
    if (num === 700 && code && code.toString().toUpperCase().startsWith('TR_')) return '2-star-trainer';
    return RAREZA_NUMERICA_PREVIEW[num] || null;
}

// Sin caché permanente a propósito: card-types-sync.js reescribe este archivo
// solo cada varias horas (cartas nuevas de una expansión recién salida), y
// releerlo es barato — así el proceso no necesita reiniciarse para enterarse.
function cargarCardTypesBot() {
    try {
        return JSON.parse(fs.readFileSync(path.join(__dirname, 'assets', 'card_types.json'), 'utf8'));
    } catch (e) {
        return {};
    }
}

// Los nombres "Alolan X"/"Galarian X" etc. en en_US.json vienen con un
// carácter de espacio angosto de Unicode (ej. U+2005) entre el prefijo
// regional y el nombre, en vez de un espacio normal — sin esto, la búsqueda
// en card_types.json (que sí usa espacio normal) no matchea y esas cartas
// quedan como "Unknown" en el campo Element. Mismo problema con "Farfetch’d"
// (comilla tipográfica ’ U+2019 en vez de la recta ' que tiene card_types.json).
//
// Bug real encontrado 2026-07-31 (Alolan Raichu EX con Element: Unknown): las
// 45 cartas regionales del juego (confirmado revisando en_US.json entero, sin
// excepciones) vienen con el prefijo pegado directo al nombre, SIN ningun
// espacio de por medio -- "AlolanRaichu", no "Alolan Raichu". No es un
// caracter raro de Unicode esta vez, el espacio directamente no esta. Se
// inserta a mano antes de buscar en card_types.json (que sí lo tiene, ej.
// "alolan raichu ex").
function clavenormalizadaTipoCarta(nombre) {
    if (!nombre) return '';
    return nombre.toLowerCase()
        .replace(/^(alolan|galarian|hisuian|paldean)(?=[a-z])/, '$1 ')
        .replace(/\s+/g, ' ')
        .replace(/[‘’]/g, "'");
}

// Mismo criterio que buscarLogoExpansion()/normalizarNombreExpansion() en s4t.js:
// se duplica acá por la misma razón que componerLogoSobreImagenBot (bot.js no
// puede requerir s4t.js sin levantar su propio servidor en el puerto 3000).
const EXPANSIONS_DIR_BOT = path.join(__dirname, 'assets', 'expansions');
function normalizarNombreExpansionBot(texto) {
    return texto.toLowerCase().replace(/[^a-z0-9]/g, '');
}
let _carpetasExpansionCacheBot = null;
function buscarLogoExpansionBot(nombreExpansion) {
    if (!nombreExpansion) return null;
    const objetivo = normalizarNombreExpansionBot(nombreExpansion);
    try {
        if (!_carpetasExpansionCacheBot) {
            _carpetasExpansionCacheBot = fs.readdirSync(EXPANSIONS_DIR_BOT, { withFileTypes: true }).filter(d => d.isDirectory());
        }
        for (const carpeta of _carpetasExpansionCacheBot) {
            if (normalizarNombreExpansionBot(carpeta.name) === objetivo) {
                const rutaLogo = path.join(EXPANSIONS_DIR_BOT, carpeta.name, `${carpeta.name}.png`);
                if (fs.existsSync(rutaLogo)) return rutaLogo;
                const rutaWebp = path.join(EXPANSIONS_DIR_BOT, carpeta.name, `${carpeta.name}.webp`);
                if (fs.existsSync(rutaWebp)) return rutaWebp;
            }
        }
    } catch (e) {
        console.log('DEBUG: Error buscando logo de expansión (preview /embed):', e.message);
    }
    return null;
}

// Construye la lista de cartas candidatas (con imagen real en CardImageCache,
// rareza reconocida, y expansión identificada vía cardmap.json + en_US.json)
// una sola vez por ruta_master, agrupada por expansión, y la cachea en memoria —
// cardmaster.json/en_US.json/cardmap.json tienen miles de entradas, no conviene
// releerlos ni recorrerlos en cada click de /embed.
let _candidatosPreviewCache = null;
function construirCandidatosPreview(rutaMaster) {
    const rawMaster = fs.readFileSync(path.join(rutaMaster, 'cardmaster.json'), 'utf8').replace(/^﻿/, '');
    const rawNombres = fs.readFileSync(path.join(rutaMaster, 'en_US.json'), 'utf8').replace(/^﻿/, '');
    const master = JSON.parse(rawMaster);
    const nombres = JSON.parse(rawNombres);
    const cardTypes = cargarCardTypesBot();

    let cardmap = {};
    try {
        cardmap = JSON.parse(fs.readFileSync(path.join(rutaMaster, 'cardmap.json'), 'utf8').replace(/^﻿/, ''));
    } catch (e) { /* sin cardmap.json no se puede agrupar por expansión, queda vacío */ }

    // Mapa ExpansionID ("B3b") -> nombre de expansión ("Everyday Wonders"), a
    // partir de los pares EXPANSION_NAME_N / EXPANSION_NAME_LONG_N de en_US.json.
    const nombresExpansion = {};
    for (const key of Object.keys(nombres)) {
        const m = key.match(/^EXPANSION_NAME_(\d+)$/);
        if (m) nombresExpansion[nombres[key]] = nombres[`EXPANSION_NAME_LONG_${m[1]}`] || null;
    }

    const porExpansion = {};
    for (const [code, entry] of Object.entries(master)) {
        if (!entry.IllustrationID) continue;
        const rarezaClave = mapearRarezaNumericaPreview(entry.Rarity, code);
        if (!rarezaClave) continue;
        const rutaImagen = path.join(rutaMaster, 'CardImageCache', `${entry.IllustrationID}.png`);
        if (!fs.existsSync(rutaImagen)) continue;

        const expansionId = cardmap[code]?.ExpansionID;
        const nombreExpansion = expansionId ? nombresExpansion[expansionId] : null;
        if (!nombreExpansion) continue;
        if (!buscarLogoExpansionBot(nombreExpansion)) continue; // sin logo no sirve para la vista previa

        const nombre = normalizarNombreExBot(nombres[entry.Name] || entry.Name);
        const tipoIngles = cardTypes[clavenormalizadaTipoCarta(nombre)];
        const carta = {
            nombre,
            rarezaClave,
            tipoClave: tipoIngles ? `type_${tipoIngles.toLowerCase()}` : null,
            imagen: rutaImagen,
            code
        };
        if (!porExpansion[nombreExpansion]) porExpansion[nombreExpansion] = [];
        porExpansion[nombreExpansion].push(carta);
    }
    return { porExpansion, cardmap };
}

// Elige una expansión al azar (entre las que tengan suficientes cartas
// candidatas con imagen+rareza+logo) y hasta `cantidad` cartas distintas entre
// sí de esa misma expansión, para que el logo mostrado siempre coincida con
// las cartas de la vista previa.
async function elegirExpansionYCartasPreview(cantidad) {
    try {
        const rutaMasterCfg = await db.get(`SELECT webhook_url FROM configs_canales WHERE tipo = 'ruta_master'`);
        const rutaMaster = rutaMasterCfg?.webhook_url;
        if (!rutaMaster) return null;

        if (!_candidatosPreviewCache || _candidatosPreviewCache.ruta !== rutaMaster) {
            _candidatosPreviewCache = { ruta: rutaMaster, ...construirCandidatosPreview(rutaMaster) };
        }

        const expansiones = Object.keys(_candidatosPreviewCache.porExpansion)
            .filter(nombre => _candidatosPreviewCache.porExpansion[nombre].length >= Math.min(cantidad, 2));
        if (!expansiones.length) return null;

        const nombreExpansion = expansiones[Math.floor(Math.random() * expansiones.length)];
        const disponibles = [..._candidatosPreviewCache.porExpansion[nombreExpansion]];
        const elegidas = [];
        for (let i = 0; i < cantidad && disponibles.length; i++) {
            const idx = Math.floor(Math.random() * disponibles.length);
            elegidas.push(disponibles[idx]);
            disponibles.splice(idx, 1);
        }
        return { nombreExpansion, logo: buscarLogoExpansionBot(nombreExpansion), cartas: elegidas, cardMap: _candidatosPreviewCache.cardmap };
    } catch (e) {
        console.log('DEBUG: Error eligiendo expansión/cartas aleatorias para preview /embed:', e.message);
        return null;
    }
}

// Misma composición que usa s4t.js en componerLogoSobreImagen(): se duplica acá
// porque bot.js no puede hacer require('./s4t.js') sin levantar su propio
// servidor Express en el puerto 3000 (ya lo tiene ocupado el proceso "trading").
async function componerLogoSobreImagenBot(bufferCarta, rutaLogo) {
    if (!rutaLogo) return bufferCarta;
    try {
        const metaCarta = await sharp(bufferCarta).metadata();
        const anchoFinal = metaCarta.width;
        const anchoLogo = Math.round(anchoFinal * 0.85);
        const logoBuffer = await sharp(rutaLogo)
            .resize({ width: anchoLogo, fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
            .toBuffer();
        const metaLogo = await sharp(logoBuffer).metadata();

        const relleno = 20;
        const altoFranja = metaLogo.height + relleno * 2;
        const altoFinal = metaCarta.height + altoFranja;

        return await sharp({
            create: { width: anchoFinal, height: altoFinal, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } }
        })
            .composite([
                { input: bufferCarta, left: 0, top: altoFranja },
                { input: logoBuffer, left: Math.round((anchoFinal - metaLogo.width) / 2), top: relleno }
            ])
            .png()
            .toBuffer();
    } catch (e) {
        console.log('DEBUG: Error componiendo logo sobre imagen (preview /embed):', e.message);
        return bufferCarta;
    }
}

const BUILD_EMBED_EJEMPLO = {
    instancia: '3',
    archivo: '19P_20260306082140_1(B).xml',
    // Respaldo solo para cuando no hay ninguna expansión candidata disponible
    // (sin ruta_master configurada, o sin suficientes cartas identificadas).
    sobreFallback: 'Everyday Wonders (2)',
    logoFallback: path.join(__dirname, 'assets', 'expansions', 'Everyday Wonders', 'Everyday Wonders.png')
};

// Se usa solo si no hay Ruta Data Master configurada, o no se encontraron
// suficientes cartas candidatas reales (sin esto /embed quedaría sin imagen).
const BUILD_EMBED_CARTA_FALLBACK = {
    nombre: 'Mewtwo EX',
    rarezaClave: 'crown-rare',
    tipoClave: 'type_psychic',
    imagen: path.join(__dirname, 'assets', 'build_preview_card.png')
};

function lineaCartaPreview(estados, carta, mapaEmojis) {
    const lineas = [];
    if (estados.mostrar_categoria) lineas.push(`> ${formatearRarezaPreview(carta.rarezaClave, mapaEmojis)}`);
    const tagTipo = estados.mostrar_tipo ? tagTipoBot(carta.tipoClave, mapaEmojis) : '';
    lineas.push(`> ${tagTipo ? tagTipo + ' › ' : ''}**${carta.nombre}**`);
    return lineas.join('\n');
}

function construirCamposPreview(estados, valorPrincipal, sobreTexto) {
    const campos = [];
    if (estados.mostrar_instancia) campos.push({ name: '🖥️ Instance', value: `\`${BUILD_EMBED_EJEMPLO.instancia}\``, inline: true });
    if (estados.mostrar_sobre) campos.push({ name: '📦 Pack', value: `\`${sobreTexto}\``, inline: true });
    let valor = valorPrincipal;
    if (estados.mostrar_archivo) valor += `\n\n📁 **Account file**\n\`${BUILD_EMBED_EJEMPLO.archivo}\``;
    campos.push({ name: '​', value: valor, inline: false });
    return campos;
}

async function prepararImagenCartaPreview(estados, carta, rutaLogo, cardMap) {
    try {
        const rutaHD = await obtenerImagenHDBot(cardMap, carta.code);
        let buffer = fs.readFileSync(rutaHD || carta.imagen);
        if (estados.mostrar_logo) buffer = await componerLogoSobreImagenBot(buffer, rutaLogo);
        return buffer;
    } catch (e) {
        console.log('DEBUG: Error preparando imagen de preview /embed:', e.message);
        return null;
    }
}

// Compone 2+ imágenes de carta lado a lado (mismo alto), para simular cómo se ve
// el canal general de S4T cuando manda varias cartas de un mismo sobre juntas.
// En producción ese embed usa la captura original de pantalla, no un collage
// generado — esto es solo una aproximación visual para la vista previa.
async function componerCollagePreview(buffers) {
    const metas = await Promise.all(buffers.map(b => sharp(b).metadata()));
    const alturaComun = Math.min(...metas.map(m => m.height));
    const gap = 16;
    const redimensionadas = await Promise.all(buffers.map((b, i) => {
        const escala = alturaComun / metas[i].height;
        return sharp(b).resize({ height: alturaComun, width: Math.round(metas[i].width * escala) }).toBuffer();
    }));
    const metasFinal = await Promise.all(redimensionadas.map(b => sharp(b).metadata()));
    const anchoTotal = metasFinal.reduce((suma, m) => suma + m.width, 0) + gap * (metasFinal.length - 1);

    let left = 0;
    const composite = [];
    for (let i = 0; i < redimensionadas.length; i++) {
        composite.push({ input: redimensionadas[i], left, top: 0 });
        left += metasFinal[i].width + gap;
    }

    return await sharp({
        create: { width: anchoTotal, height: alturaComun, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } }
    }).composite(composite).png().toBuffer();
}

async function generarEmbedGeneral(estados, cartas, sobreTexto, rutaLogo, cardMap, mapaEmojis) {
    const valorPrincipal = cartas.map(c => lineaCartaPreview(estados, c, mapaEmojis)).join('\n\n');
    const campos = construirCamposPreview(estados, valorPrincipal, sobreTexto);

    const embed = new EmbedBuilder()
        .setTitle('🌟 NEW VALUABLE CARD FOUND! 🌟')
        .setDescription(
            '**An excellent trade has been detected.**\nSaved in the S4T database.\n\n' +
            '*Preview — S4T general channel (all cards from the pack together).*'
        )
        .setColor(0xF1C40F)
        .addFields(campos)
        .setFooter({ text: `Data saved ${new Date().toLocaleString()} • Preview (general channel)` });

    const files = [];
    try {
        const buffers = (await Promise.all(cartas.map(async c => {
            const rutaHD = await obtenerImagenHDBot(cardMap, c.code);
            return fs.promises.readFile(rutaHD || c.imagen);
        }))).filter(Boolean);
        if (buffers.length) {
            let bufferImagen = buffers.length > 1 ? await componerCollagePreview(buffers) : buffers[0];
            if (estados.mostrar_logo) bufferImagen = await componerLogoSobreImagenBot(bufferImagen, rutaLogo);
            files.push(new AttachmentBuilder(bufferImagen, { name: 'preview_general.png' }));
            embed.setImage('attachment://preview_general.png');
        }
    } catch (e) {
        console.log('DEBUG: Error preparando imagen general de preview /embed:', e.message);
        /* sin imagen si falla, el embed sigue siendo útil solo con texto */
    }

    return { embed, files };
}

async function generarEmbedRareza(estados, carta, sobreTexto, rutaLogo, cardMap, mapaEmojis) {
    const valorPrincipal = lineaCartaPreview(estados, carta, mapaEmojis);
    const campos = construirCamposPreview(estados, valorPrincipal, sobreTexto);

    const embed = new EmbedBuilder()
        .setTitle('🌟 NEW VALUABLE CARD FOUND! 🌟')
        .setDescription(
            '**An excellent trade has been detected.**\nSaved in the S4T database.\n\n' +
            '*Preview — rarity channel (a single card).*'
        )
        .setColor(0xF1C40F)
        .addFields(campos)
        .setFooter({ text: `Data saved ${new Date().toLocaleString()} • Preview (rarity channel)` });

    const files = [];
    const bufferImagen = await prepararImagenCartaPreview(estados, carta, rutaLogo, cardMap);
    if (bufferImagen) {
        files.push(new AttachmentBuilder(bufferImagen, { name: 'preview_rareza.png' }));
        embed.setImage('attachment://preview_rareza.png');
    }

    return { embed, files };
}

async function generarEmbedWishlist(estados, carta, sobreTexto, rutaLogo, cardMap, mapaEmojis) {
    const lineaRareza = estados.mostrar_categoria ? formatearRarezaPreview(carta.rarezaClave, mapaEmojis) : '';
    const tagTipo = estados.mostrar_tipo ? tagTipoBot(carta.tipoClave, mapaEmojis) : '';
    const lineaNombre = `${tagTipo ? tagTipo + ' › ' : ''}**${carta.nombre}**`;
    const idWishlist = mapaEmojis?.['icono_wishlist'];
    const tagWishlist = idWishlist ? `<:icono_wishlist:${idWishlist}>` : '💖';
    const cuerpo = lineaRareza ? `${lineaRareza}\n> ${lineaNombre}` : lineaNombre;
    const valorPrincipal = `> ${tagWishlist} › Wishlist match found:\n> ${cuerpo}`;
    const campos = construirCamposPreview(estados, valorPrincipal, sobreTexto);

    const embed = new EmbedBuilder()
        .setDescription(
            '💖 **A wishlist card has been detected.** 💖\nSaved in the S4T database.\n\n' +
            '*Preview — wishlist channel.*'
        )
        .setColor(0xE91E63)
        .addFields(campos)
        .setFooter({ text: `Data saved ${new Date().toLocaleString()} • Preview (wishlist channel)` });

    const files = [];
    const bufferImagen = await prepararImagenCartaPreview(estados, carta, rutaLogo, cardMap);
    if (bufferImagen) {
        files.push(new AttachmentBuilder(bufferImagen, { name: 'preview_wishlist.png' }));
        embed.setImage('attachment://preview_wishlist.png');
    }

    return { embed, files };
}

async function generarPanelBuildEmbed(userId, guild = null) {
    const estados = await obtenerConfigBuildEmbed(userId);
    const mapaEmojis = await obtenerMapaEmojisGuild(guild);

    const embedConfig = new EmbedBuilder()
        .setTitle('🔧 Build Embed — S4T Configuration')
        .setDescription('Turn on or off what is shown in the embed for found cards.')
        .setColor(0xF1C40F)
        .addFields(BUILD_EMBED_OPCIONES.map(opcion => ({
            name: `${estados[opcion.clave] ? '✅' : '❌'} ${opcion.label}`,
            value: opcion.ejemplo(mapaEmojis),
            inline: false
        })));

    const filas = [];
    for (let i = 0; i < BUILD_EMBED_OPCIONES.length; i += 3) {
        const grupo = BUILD_EMBED_OPCIONES.slice(i, i + 3);
        filas.push(new ActionRowBuilder().addComponents(
            grupo.map(opcion => new ButtonBuilder()
                .setCustomId(`build_toggle::${opcion.clave}`)
                .setLabel(`${estados[opcion.clave] ? 'ON' : 'OFF'} · ${opcion.label}`)
                .setStyle(estados[opcion.clave] ? ButtonStyle.Success : ButtonStyle.Secondary))
        ));
    }

    const botonesGuardar = [new ButtonBuilder().setCustomId('build_guardar').setLabel('💾 Save').setStyle(ButtonStyle.Success)];
    if (fs.existsSync(rutaTutorialPdf('cmd_build_embed'))) {
        botonesGuardar.push(new ButtonBuilder().setCustomId('tutorial_pdf::cmd_build_embed').setLabel('📄 Tutorial').setStyle(ButtonStyle.Secondary));
    }
    filas.push(new ActionRowBuilder().addComponents(...botonesGuardar));

    const eleccion = await elegirExpansionYCartasPreview(4);
    const cartasElegidas = eleccion?.cartas || [];
    const obtenerCarta = (i) => cartasElegidas[i] || BUILD_EMBED_CARTA_FALLBACK;
    const sobreTexto = eleccion ? `${eleccion.nombreExpansion} (2)` : BUILD_EMBED_EJEMPLO.sobreFallback;
    const rutaLogo = eleccion?.logo || BUILD_EMBED_EJEMPLO.logoFallback;
    const cardMap = eleccion?.cardMap || {};

    const general = await generarEmbedGeneral(estados, [obtenerCarta(0), obtenerCarta(1)], sobreTexto, rutaLogo, cardMap, mapaEmojis);
    const rareza = await generarEmbedRareza(estados, obtenerCarta(2), sobreTexto, rutaLogo, cardMap, mapaEmojis);
    const wishlist = await generarEmbedWishlist(estados, obtenerCarta(3), sobreTexto, rutaLogo, cardMap, mapaEmojis);

    return {
        embeds: [embedConfig, general.embed, rareza.embed, wishlist.embed],
        components: filas,
        files: [...general.files, ...rareza.files, ...wishlist.files]
    };
}

async function generarPanelControl(userId) {
    let estadoS4T = await verificarEstadoPM2('trading', 's4t.js');
    let estadoHB = await verificarEstadoPM2('heartbeat', 'heartbeat.js');

    if (estadoS4T === '🟢 ONLINE' && !(await tieneConfiguracion(userId, 's4t'))) estadoS4T = '🔴 OFFLINE (Setup Needed)';
    if (estadoHB === '🟢 ONLINE' && !(await tieneConfiguracion(userId, 'heartbeat'))) estadoHB = '🔴 OFFLINE (Setup Needed)';
    const driveHdRegularOn = await driveHdRegularHabilitado();

    const embed = new EmbedBuilder()
        .setTitle(' 👑  Pokemon Home PTCGPB!  👑​')
        .setDescription(
            `Hello! With this bot you can monitor your instances in a more organized, remote, and real-time way.\n\n` +
            `**🔥​ PROCESS CONTROL PANEL 🔥**\n\n` +
            `⚡ **Basic Infrastructure Status:**\n` +
            `• 🚀 **S4T Module:** \`${estadoS4T}\`\n` +
            `• 💓 **Heartbeat Module:** \`${estadoHB}\`\n` +
            `• 🖼️ **Normal Cards in HD:** \`${driveHdRegularOn ? '🟢 ON' : '🔴 OFF'}\`\n` +
            `-# OFF: normal cards stay low quality, Gold cards always HD. ON: normal cards also HD, but uses more disk space over time.\n\n` +
            `**🎴 Available Features:**\n` +
            `• 💖 **Cards Wishlist** — check and search the cards in your wishlist.\n` +
            `• ⚡ **All Cards** — browse the full catalog of cards in the game.\n` +
            `• 📄 **Extract XML** — paste an account name and get its XML + JSON.\n` +
            `• 🔄 **Auto Trade** — open a MuMu instance and inject, add friends, and run trades without touching anything manually.\n\n` +
            `*Press the buttons to interact with the bot's ecosystem.*`
        )
        .setColor(0x9B59B6)
        .setFooter({ text: " Bot By Ale Cast ୨♡୧" })
        .setTimestamp();

    const filaSistema = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('toggle_trading').setLabel('🚀 S4T On/Off').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('toggle_heartbeat').setLabel('💓 Heartbeat On/Off').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('btn_crear_canales_menu').setLabel('🏗️ Sync Channels').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('toggle_drive_hd_regular').setLabel('🖼️ Normal Cards HD On/Off').setStyle(ButtonStyle.Secondary)
    );

    const botonesGestion = [
        new ButtonBuilder().setCustomId('btn_status').setLabel('📊 Status').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('btn_config_canales').setLabel('⚙️ Configuration').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('btn_ruta_raiz').setLabel('📂 Main Path').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('btn_check_updates').setLabel('🔄 Check for Updates').setStyle(ButtonStyle.Secondary)
    ];
    if (fs.existsSync(rutaTutorialPdf('cmd_setup'))) {
        botonesGestion.push(new ButtonBuilder().setCustomId('tutorial_pdf::cmd_setup').setLabel('📄 Tutorial').setStyle(ButtonStyle.Secondary));
    }
    const filaGestion = new ActionRowBuilder().addComponents(...botonesGestion);

    // "Reset Total"/"Delete Channels" sacados del panel (a pedido explicito del
    // usuario 2026-07-30): daba miedo tenerlos ahi mismo, un clic de mas (incluso
    // del propio dueño) borraba todo sin aviso. Los handlers (btn_reset_total,
    // btn_borrar_todo) quedan intactos por si hace falta reactivarlos despues,
    // simplemente ya no hay ningun boton que los dispare.

    // "Cards Wishlist"/"All Cards"/"Gold Cards"/"Extract XML"/"Auto Trade" se
    // sacaron de aca (a pedido explicito del usuario 2026-07-30): quedan
    // innecesarios una vez que existe el canal de accesos directos a cada uno
    // de esos comandos - este panel de /setup no tiene por que repetirlos.
    //
    // "Add Friend"/"Status ID" agregados aca (a pedido explicito del usuario
    // 2026-07-29): antes solo estaban dentro de una instancia puntual (Auto
    // Trade -> Settings Trade), pero los amigos son por usuario, no por
    // instancia, asi que no hace falta ese paso de por medio. "Status ID" (no
    // solo "Status") para no confundirse con btn_status de mas arriba, que es
    // el status de configuracion del bot, no de amigos guardados.
    const filaTrade = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('setup_add_friend').setLabel('🆔 Add Friend').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('setup_status_friends').setLabel('📊 Status ID').setStyle(ButtonStyle.Secondary)
    );

    const archivos = [];
    if (fs.existsSync(SYMBOL_EMBEDS_PATH)) {
        embed.setThumbnail('attachment://symbol.png');
        archivos.push({ ruta: SYMBOL_EMBEDS_PATH, filename: 'symbol.png' });
    }

    return { embeds: [embed], components: [filaSistema, filaGestion, filaTrade], archivos };
}

const FUENTES_CARTAS = {
    wishlist: {
        tituloLista: '📋 Your Wishlist',
        vacioTexto: 'No cards saved in your wishlist.',
        contexto: 'your wishlist',
        errorSinDatos: '❌ Wishlist file not found. Check the **Wishlist Path** configured in the panel.',
        obtenerCartas: async () => {
            const rutaWishlistCfg = await db.get(`SELECT webhook_url FROM configs_canales WHERE tipo = 'ruta_wishlist'`);
            const rutaMasterCfg = await db.get(`SELECT webhook_url FROM configs_canales WHERE tipo = 'ruta_master'`);
            const rutaJsonCfg = await db.get(`SELECT webhook_url FROM configs_canales WHERE tipo = 'ruta_json_cuentas'`);
            return {
                cartas: obtenerCartasWishlist(rutaWishlistCfg, rutaMasterCfg),
                rutaMasterPath: rutaMasterCfg?.webhook_url,
                mapaCopias: construirMapaCopiasPorCarta(rutaJsonCfg?.webhook_url)
            };
        }
    },
    allcards: {
        tituloLista: '📋 All Cards',
        vacioTexto: 'No cards found.',
        contexto: 'the catalog',
        errorSinDatos: '❌ cardmaster.json not found. Check the **Data Master Path** configured in the panel.',
        obtenerCartas: async () => {
            const { cartas, rutaMasterPath } = await obtenerTodasLasCartasCacheadas();
            const rutaJsonCfg = await db.get(`SELECT webhook_url FROM configs_canales WHERE tipo = 'ruta_json_cuentas'`);
            return { cartas, rutaMasterPath, mapaCopias: construirMapaCopiasPorCarta(rutaJsonCfg?.webhook_url) };
        }
    },
    goldcards: {
        tituloLista: '🏆 Gold Cards',
        vacioTexto: 'No cards found with 10+ copies in any account yet.',
        contexto: 'Gold Cards',
        errorSinDatos: '❌ cardmaster.json not found. Check the **Data Master Path** configured in the panel.',
        obtenerCartas: obtenerCartasGoldCacheadas
    }
};

function prefijoDeCartas(customId) {
    if (customId.startsWith('goldcards')) return 'goldcards';
    return customId.startsWith('allcards') ? 'allcards' : 'wishlist';
}

client.on('interactionCreate', async interaction => {
    if (interaction.isAutocomplete() && interaction.commandName === 'card') {
        const campoFocus = interaction.options.getFocused(true);
        const focused = campoFocus.value.trim().toLowerCase();
        const { cartas } = await obtenerTodasLasCartasCacheadas();
        const base = cartas || [];

        if (campoFocus.name === 'expansion') {
            const expansiones = [...new Set(base.map(c => c.expansion))].sort((a, b) => a.localeCompare(b));
            const coincidencias = (focused ? expansiones.filter(e => e.toLowerCase().includes(focused)) : expansiones)
                .slice(0, 25)
                .map(e => ({ name: e.slice(0, 100), value: e }));
            return interaction.respond(coincidencias).catch(() => {});
        }

        // Campo "name": si ya se eligió una expansión y/o rareza, filtra solo
        // dentro de esas primero (a pedido del usuario, para desambiguar
        // cartas con el mismo nombre repetidas en varios sets/categorías).
        const expansionElegida = interaction.options.getString('expansion');
        const rarezaElegida = interaction.options.getString('rarity');
        let porExpansion = expansionElegida ? base.filter(c => c.expansion === expansionElegida) : base;
        if (rarezaElegida) porExpansion = porExpansion.filter(c => c.tipoRareza === rarezaElegida);
        const coincidencias = (focused ? porExpansion.filter(c => c.nombre.toLowerCase().includes(focused)) : porExpansion)
            .slice(0, 25)
            .map(c => ({ name: `${c.nombre} — ${c.expansion} (${c.categoria})`.slice(0, 100), value: c.id }));
        return interaction.respond(coincidencias).catch(() => {});
    }

    // Atajo /card expansion:X (y opcionalmente rarity:Y) SIN elegir un nombre
    // puntual (bug real reportado 2026-07-31: antes esto se ignoraba por
    // completo y caia al menu generico de "All Cards"). Si solo hay expansion,
    // salta a la vista de categorias (igual que el select-menu manual); si
    // ademas hay rarity, salta directo a la lista de cartas de esa rareza
    // puntual (segundo bug reportado: con expansion+rarity seguia mostrando
    // todas las categorias en vez de solo la elegida).
    if (interaction.isChatInputCommand() && interaction.commandName === 'card' && !interaction.options.getString('name') && interaction.options.getString('expansion')) {
        const rowCardAll = await obtenerCanalComando(interaction.user.id, 'cmd_card_all');
        if (!rowCardAll) {
            return await interaction.reply({ content: `❌ No channel synced for **All Cards**. Use **Sync Channels** first.`, ephemeral: true });
        }
        if (interaction.channelId !== rowCardAll.canal_id) {
            return await interaction.reply({ content: `❌ This command only works in <#${rowCardAll.canal_id}>.`, ephemeral: true });
        }
        await interaction.deferReply();
        const expansionElegida = interaction.options.getString('expansion');
        const rarezaElegida = interaction.options.getString('rarity');
        const fuente = FUENTES_CARTAS.allcards;
        const { cartas, rutaMasterPath, mapaCopias } = await fuente.obtenerCartas(interaction.user.id);
        const mapaEmojis = await obtenerMapaEmojisGuild(interaction.guild);
        // c.tipoRareza usa exactamente los mismos valores que las choices de
        // "rarity" (ya lo confirma el filtro de autocompletado unas lineas
        // arriba) -- se toma la categoria (etiqueta) de la primera carta que
        // matchee esa rareza dentro de la expansion, en vez de mantener una
        // tabla de conversion aparte.
        const cartaConEsaRareza = rarezaElegida ? (cartas || []).find(c => c.expansion === expansionElegida && c.tipoRareza === rarezaElegida) : null;
        const payload = cartaConEsaRareza
            ? await construirEmbedCartasPorExpansion(cartas || [], expansionElegida, cartaConEsaRareza.categoria, 0, { prefijo: 'allcards', contexto: fuente.contexto, mapaEmojis, rutaMasterPath, mapaCopias })
            : construirEmbedCategoriasPorExpansion(cartas || [], expansionElegida, { prefijo: 'allcards', contexto: fuente.contexto, mapaEmojis });
        await interaction.editReply(payload);
        return;
    }

    // Búsqueda directa por nombre vía autocompletado de /card, sin pasar por
    // el banner+botón de "All Cards" — mismo canal/permiso que ese flujo.
    if (interaction.isChatInputCommand() && interaction.commandName === 'card' && interaction.options.getString('name')) {
        const cartaId = interaction.options.getString('name');
        const rowCardAll = await obtenerCanalComando(interaction.user.id, 'cmd_card_all');
        if (!rowCardAll) {
            return await interaction.reply({ content: `❌ No channel synced for **All Cards**. Use **Sync Channels** first.`, ephemeral: true });
        }
        if (interaction.channelId !== rowCardAll.canal_id) {
            return await interaction.reply({ content: `❌ This command only works in <#${rowCardAll.canal_id}>.`, ephemeral: true });
        }
        // Pública (no ephemeral): un mensaje ephemeral solo se entrega en vivo a
        // la sesión que estaba conectada en ese momento — no queda guardado en
        // el historial, así que en otro dispositivo (el celular, por ejemplo)
        // nunca llega a aparecer, ni refrescando.
        await interaction.deferReply();
        const { cartas, rutaMasterPath } = await obtenerTodasLasCartasCacheadas();
        const carta = (cartas || []).find(c => c.id === cartaId);
        if (!carta) return await interaction.editReply({ content: '❌ Card not found.' });
        const payload = await construirEmbedDetalleCarta(carta.id, carta.nombre, rutaMasterPath, null, interaction.guild);
        await interaction.editReply(payload);
        // El resultado de la búsqueda queda como mensaje público aparte (nunca se
        // toca). A pedido explicito del usuario 2026-07-29: una búsqueda directa
        // (con nombre/atajo) NUNCA debe reubicar el panel del comando, ni siquiera
        // si ya pasó el intervalo de inactividad -- eso solo debe pasar al correr
        // el comando "pelado" (/card sin opciones, ver ejecutarComandoEnCanal).
        return;
    }

    if (interaction.isAutocomplete() && interaction.commandName === 'goldcards') {
        const campoFocus = interaction.options.getFocused(true);
        const focused = campoFocus.value.trim().toLowerCase();
        const { cartas } = await obtenerCartasGoldCacheadas(interaction.user.id);
        const base = cartas || [];

        if (campoFocus.name === 'expansion') {
            const expansiones = [...new Set(base.map(c => c.expansion))].sort((a, b) => a.localeCompare(b));
            const coincidencias = (focused ? expansiones.filter(e => e.toLowerCase().includes(focused)) : expansiones)
                .slice(0, 25)
                .map(e => ({ name: e.slice(0, 100), value: e }));
            return interaction.respond(coincidencias).catch(() => {});
        }

        const expansionElegida = interaction.options.getString('expansion');
        const rarezaElegida = interaction.options.getString('rarity');
        let porExpansion = expansionElegida ? base.filter(c => c.expansion === expansionElegida) : base;
        if (rarezaElegida) porExpansion = porExpansion.filter(c => c.tipoRareza === rarezaElegida);
        const coincidencias = (focused ? porExpansion.filter(c => c.nombre.toLowerCase().includes(focused)) : porExpansion)
            .slice(0, 25)
            .map(c => ({ name: `${c.nombre} — ${c.expansion} (${c.categoria})`.slice(0, 100), value: c.id }));
        return interaction.respond(coincidencias).catch(() => {});
    }

    // Atajo /goldcards expansion:X sin nombre -- mismo fix que /card.
    if (interaction.isChatInputCommand() && interaction.commandName === 'goldcards' && !interaction.options.getString('name') && interaction.options.getString('expansion')) {
        const rowCardGold = await obtenerCanalComando(interaction.user.id, 'cmd_card_gold');
        if (!rowCardGold) {
            return await interaction.reply({ content: `❌ No channel synced for **Gold Cards**. Use **Sync Channels** first.`, ephemeral: true });
        }
        if (interaction.channelId !== rowCardGold.canal_id) {
            return await interaction.reply({ content: `❌ This command only works in <#${rowCardGold.canal_id}>.`, ephemeral: true });
        }
        await interaction.deferReply();
        if (!GOOGLE_DRIVE_API_KEY_BOT) {
            return await interaction.editReply(advertenciaGoldSinApi());
        }
        const expansionElegida = interaction.options.getString('expansion');
        const rarezaElegida = interaction.options.getString('rarity');
        const fuente = FUENTES_CARTAS.goldcards;
        const { cartas, rutaMasterPath, mapaCopias } = await obtenerCartasGoldCacheadas(interaction.user.id);
        const mapaEmojis = await obtenerMapaEmojisGuild(interaction.guild);
        const cartaConEsaRareza = rarezaElegida ? (cartas || []).find(c => c.expansion === expansionElegida && c.tipoRareza === rarezaElegida) : null;
        const payload = cartaConEsaRareza
            ? await construirEmbedCartasPorExpansion(cartas || [], expansionElegida, cartaConEsaRareza.categoria, 0, { prefijo: 'goldcards', contexto: fuente.contexto, mapaEmojis, rutaMasterPath, mapaCopias })
            : construirEmbedCategoriasPorExpansion(cartas || [], expansionElegida, { prefijo: 'goldcards', contexto: fuente.contexto, mapaEmojis });
        await interaction.editReply(payload);
        return;
    }

    // Búsqueda directa por nombre vía autocompletado de /goldcards, mismo
    // patron que /card -- ya viene pre-filtrado a cartas Gold-elegibles.
    if (interaction.isChatInputCommand() && interaction.commandName === 'goldcards' && interaction.options.getString('name')) {
        const cartaId = interaction.options.getString('name');
        const rowCardGold = await obtenerCanalComando(interaction.user.id, 'cmd_card_gold');
        if (!rowCardGold) {
            return await interaction.reply({ content: `❌ No channel synced for **Gold Cards**. Use **Sync Channels** first.`, ephemeral: true });
        }
        if (interaction.channelId !== rowCardGold.canal_id) {
            return await interaction.reply({ content: `❌ This command only works in <#${rowCardGold.canal_id}>.`, ephemeral: true });
        }
        await interaction.deferReply();
        if (!GOOGLE_DRIVE_API_KEY_BOT) {
            return await interaction.editReply(advertenciaGoldSinApi());
        }
        const { cartas, rutaMasterPath, mapaCopias, umbral } = await obtenerCartasGoldCacheadas(interaction.user.id);
        const carta = (cartas || []).find(c => c.id === cartaId);
        if (!carta) return await interaction.editReply({ content: `❌ Card not found (or no account has ${umbral}+ copies of it yet).` });
        const datosGold = { cuentas: cuentasGoldParaCarta(mapaCopias, cartaId, umbral), umbral };
        const payload = await construirEmbedDetalleCarta(carta.id, carta.nombre, rutaMasterPath, null, interaction.guild, datosGold);
        await interaction.editReply(payload);
        // Ver nota en el handler de card_all: una búsqueda directa nunca reubica el panel.
        return;
    }

    if (interaction.isAutocomplete() && interaction.commandName === 'wishlist') {
        const campoFocus = interaction.options.getFocused(true);
        const focused = campoFocus.value.trim().toLowerCase();
        const { cartas } = await FUENTES_CARTAS.wishlist.obtenerCartas();
        const base = cartas || [];

        if (campoFocus.name === 'expansion') {
            const expansiones = [...new Set(base.map(c => c.expansion))].sort((a, b) => a.localeCompare(b));
            const coincidencias = (focused ? expansiones.filter(e => e.toLowerCase().includes(focused)) : expansiones)
                .slice(0, 25)
                .map(e => ({ name: e.slice(0, 100), value: e }));
            return interaction.respond(coincidencias).catch(() => {});
        }

        // Campo "name": mismo criterio que /card - si ya se eligio expansion
        // y/o rareza, filtra dentro de esas primero.
        const expansionElegida = interaction.options.getString('expansion');
        const rarezaElegida = interaction.options.getString('rarity');
        let porExpansion = expansionElegida ? base.filter(c => c.expansion === expansionElegida) : base;
        if (rarezaElegida) porExpansion = porExpansion.filter(c => c.tipoRareza === rarezaElegida);
        const coincidencias = (focused ? porExpansion.filter(c => c.nombre.toLowerCase().includes(focused)) : porExpansion)
            .slice(0, 25)
            .map(c => ({ name: `${c.nombre} — ${c.expansion} (${c.categoria})`.slice(0, 100), value: c.id }));
        return interaction.respond(coincidencias).catch(() => {});
    }

    // Atajo /wishlist expansion:X sin nombre -- mismo fix que /card.
    if (interaction.isChatInputCommand() && interaction.commandName === 'wishlist' && !interaction.options.getString('name') && interaction.options.getString('expansion')) {
        const rowWishlist = await obtenerCanalComando(interaction.user.id, 'cmd_card_wishlist');
        if (!rowWishlist) {
            return await interaction.reply({ content: `❌ No channel synced for **Cards Wishlist**. Use **Sync Channels** first.`, ephemeral: true });
        }
        if (interaction.channelId !== rowWishlist.canal_id) {
            return await interaction.reply({ content: `❌ This command only works in <#${rowWishlist.canal_id}>.`, ephemeral: true });
        }
        await interaction.deferReply();
        const expansionElegida = interaction.options.getString('expansion');
        const rarezaElegida = interaction.options.getString('rarity');
        const fuente = FUENTES_CARTAS.wishlist;
        const { cartas, rutaMasterPath, mapaCopias } = await fuente.obtenerCartas();
        const mapaEmojis = await obtenerMapaEmojisGuild(interaction.guild);
        const cartaConEsaRareza = rarezaElegida ? (cartas || []).find(c => c.expansion === expansionElegida && c.tipoRareza === rarezaElegida) : null;
        const payload = cartaConEsaRareza
            ? await construirEmbedCartasPorExpansion(cartas || [], expansionElegida, cartaConEsaRareza.categoria, 0, { prefijo: 'wishlist', contexto: fuente.contexto, mapaEmojis, rutaMasterPath, mapaCopias })
            : construirEmbedCategoriasPorExpansion(cartas || [], expansionElegida, { prefijo: 'wishlist', contexto: fuente.contexto, mapaEmojis });
        await interaction.editReply(payload);
        return;
    }

    // Búsqueda directa por nombre vía autocompletado de /wishlist, sin pasar por
    // el banner+botón de "Cards Wishlist" — mismo canal/permiso que ese flujo.
    if (interaction.isChatInputCommand() && interaction.commandName === 'wishlist' && interaction.options.getString('name')) {
        const cartaId = interaction.options.getString('name');
        const rowWishlist = await obtenerCanalComando(interaction.user.id, 'cmd_card_wishlist');
        if (!rowWishlist) {
            return await interaction.reply({ content: `❌ No channel synced for **Cards Wishlist**. Use **Sync Channels** first.`, ephemeral: true });
        }
        if (interaction.channelId !== rowWishlist.canal_id) {
            return await interaction.reply({ content: `❌ This command only works in <#${rowWishlist.canal_id}>.`, ephemeral: true });
        }
        // Pública (no ephemeral) por el mismo motivo que en /card: un ephemeral
        // no queda en el historial y no se ve en otro dispositivo.
        await interaction.deferReply();
        const { cartas, rutaMasterPath } = await FUENTES_CARTAS.wishlist.obtenerCartas();
        const carta = (cartas || []).find(c => c.id === cartaId);
        if (!carta) return await interaction.editReply({ content: '❌ Card not found in your wishlist.' });
        const payload = await construirEmbedDetalleCarta(carta.id, carta.nombre, rutaMasterPath, null, interaction.guild);
        await interaction.editReply(payload);
        // Ver nota en el handler de card_all: una búsqueda directa nunca reubica el panel.
        return;
    }

    const comandoGuiado = normalizarComando(interaction);

    if (interaction.isChatInputCommand() && comandoGuiado) {
        return await ejecutarComandoEnCanal(interaction, comandoGuiado);
    }

    if (interaction.isChatInputCommand() && interaction.commandName === 'setup') {
        if (!tienePermisosGestion(interaction)) {
            return await interaction.reply({ content: '❌ Only administrators or users with the Manage Server permission can use this panel.', ephemeral: true });
        }
        const rowSetup = await obtenerCanalComando(interaction.user.id, 'cmd_setup');
        const enCanalSetup = rowSetup && interaction.channelId === rowSetup.canal_id;

        if (rowSetup && !enCanalSetup) {
            // Se permite correr /setup fuera de su canal de siempre, PERO SOLO si
            // el canal actual no tiene otro comando propio asignado — así, si el
            // canal de Settings se rompe (ej. queda borrado o inaccesible), sigue
            // habiendo una forma de correr /setup desde cualquier otro lado (un
            // canal de rareza, general, etc.) para reparar/sincronizar, en vez de
            // quedar sin ninguna salida. No se permite en los canales de
            // Cards/Wishlist/Extract XML/Auto Trade/etc. para no mezclarlos.
            const filaOtroComando = await db.get(
                `SELECT tipo FROM configs_canales WHERE discord_id = ? AND canal_id = ? AND tipo LIKE 'cmd_%' AND tipo != 'cmd_setup'`,
                [interaction.user.id, interaction.channelId]
            );
            if (filaOtroComando) {
                return await interaction.reply({ content: `❌ This command only works in <#${rowSetup.canal_id}>, or in a channel without its own assigned command.`, ephemeral: true });
            }
        }

        // "archivos" se separa acá y no viaja dentro de "panel" — enviarOEditarInterfaz
        // lo necesita como argumento aparte, y si quedara mezclado en el mismo
        // objeto terminaría colándose como un campo extra dentro del payload_json
        // real que se manda a Discord.
        const { archivos: archivosPanel, ...panel } = await generarPanelControl(interaction.user.id);
        if (enCanalSetup) {
            // Un solo panel parado en el canal (se edita in situ), en vez de uno
            // nuevo cada vez que alguien corre /setup de nuevo — pero correrlo a
            // mano sí lo manda al final del historial, sin esperar el chequeo
            // automático de 5 minutos.
            await interaction.deferReply({ ephemeral: true });
            try {
                await enviarOEditarInterfaz(interaction.user.id, 'setup', rowSetup.webhook_url, panel, archivosPanel || [], true);
                return await interaction.editReply({ content: '✅ Panel updated.' });
            } catch (error) {
                // El webhook guardado murió (ej. borrado en Discord) — se repara
                // solo acá mismo, en vez de dejar la interacción colgada o el
                // panel roto hasta la próxima "Sincronizar Canales".
                console.error('DEBUG: webhook de setup muerto, recreando:', error?.response?.data || error?.message || error);
                try {
                    const canal = await interaction.guild.channels.fetch(rowSetup.canal_id);
                    const webhooksViejos = await canal.fetchWebhooks();
                    for (const w of webhooksViejos.filter(w => w.name === 'Bot cmd_setup' || w.name === nombreDefaultWebhook('cmd_setup')).values()) {
                        await w.delete('Recreating invalid webhook').catch(() => {});
                    }
                    const webhookNuevo = await canal.createWebhook({ name: nombreDefaultWebhook('cmd_setup'), avatar: avatarDefaultWebhook('cmd_setup') });
                    await db.run(`DELETE FROM configs_canales WHERE discord_id = ? AND tipo = ?`, [interaction.user.id, 'cmd_setup']);
                    await db.run(`INSERT INTO configs_canales (discord_id, tipo, canal_id, webhook_url) VALUES (?, ?, ?, ?)`, [interaction.user.id, 'cmd_setup', rowSetup.canal_id, webhookNuevo.url]);
                    await db.run(`DELETE FROM configs_extras WHERE discord_id = ? AND tipo = ?`, [interaction.user.id, 'interfaz_msg_setup']);
                    await aplicarPersonalizacionWebhookSiExiste(interaction.user.id, 'cmd_setup', webhookNuevo.url);
                    await enviarOEditarInterfaz(interaction.user.id, 'setup', webhookNuevo.url, panel, archivosPanel || []);
                    return await interaction.editReply({ content: '✅ Panel updated (had to repair a broken webhook first).' });
                } catch (error2) {
                    console.error('DEBUG: no se pudo reparar el webhook de setup:', error2?.response?.data || error2?.message || error2);
                    return await interaction.editReply({ content: '❌ Could not update the panel. Try running **Sync Channels** again.' });
                }
            }
        }

        const filesPanel = (archivosPanel || []).map(a => new AttachmentBuilder(a.ruta, { name: a.filename }));

        if (rowSetup) {
            // Corrido fuera del canal de Settings (para reparar, ver arriba) —
            // se responde acá mismo, en privado, sin tocar el webhook del canal
            // real de Settings (que puede estar roto).
            await interaction.deferReply({ ephemeral: true });
            return await interaction.editReply({ ...panel, files: filesPanel });
        }

        await interaction.deferReply();
        return await interaction.editReply({ ...panel, files: filesPanel });
    }

    if (interaction.isChatInputCommand() && interaction.commandName === 'embed') {
        if (!tienePermisosGestion(interaction)) {
            return await interaction.reply({ content: '❌ Only administrators or users with the Manage Server permission can use this panel.', ephemeral: true });
        }
        const rowBuild = await obtenerCanalComando(interaction.user.id, 'cmd_build_embed');
        if (rowBuild && interaction.channelId !== rowBuild.canal_id) {
            return await interaction.reply({ content: `❌ This command only works in <#${rowBuild.canal_id}>.`, ephemeral: true });
        }
        // Se difiere ANTES de armar el panel (generarPanelBuildEmbed hace
        // trabajo pesado — imágenes, collage, HD desde Drive — que puede
        // tardar más de los 3s que Discord da para confirmar la interacción).
        await interaction.deferReply({ ephemeral: true });
        const panelBuild = await generarPanelBuildEmbed(interaction.user.id, interaction.guild);

        if (rowBuild) {
            // Igual que /setup: un solo panel público parado en el canal
            // (editado in situ), en vez de una respuesta efímera que
            // "desaparece" al recargar Discord o cambiar de dispositivo.
            try {
                await enviarOEditarInterfaz(
                    interaction.user.id, 'build_embed', rowBuild.webhook_url,
                    { embeds: panelBuild.embeds, components: panelBuild.components },
                    archivosDesdeAttachmentBuilders(panelBuild.files), true, interaction.guild
                );
                return await interaction.editReply({ content: '✅ Panel updated.' });
            } catch (error) {
                console.error('DEBUG: error actualizando panel de build embed:', error?.response?.data || error?.message || error);
                return await interaction.editReply({ content: '❌ Could not update the panel. Try running **Sync Channels** again.' });
            }
        }

        return await interaction.editReply(panelBuild);
    }

    if (interaction.isButton() && interaction.customId.startsWith('build_toggle::')) {
        // Se difiere primero porque ahora arma 3 embeds de ejemplo (con collage e
        // imágenes reales), y podría pasar del límite de 3 segundos para un update directo.
        await interaction.deferUpdate();
        const clave = interaction.customId.split('::')[1];
        const estados = await obtenerConfigBuildEmbed(interaction.user.id);
        const nuevoEstado = estados[clave] ? 'off' : 'on';
        await db.run(
            `INSERT INTO configs_extras (discord_id, tipo, estado) VALUES (?, ?, ?) ON CONFLICT(discord_id, tipo) DO UPDATE SET estado = ?`,
            [interaction.user.id, `embed_${clave}`, nuevoEstado, nuevoEstado]
        );
        const panelActualizado = await generarPanelBuildEmbed(interaction.user.id, interaction.guild);
        return await interaction.editReply(panelActualizado);
    }

    if (interaction.isButton() && interaction.customId === 'build_guardar') {
        return await interaction.reply({
            content: '✅ Configuration saved. From now on the S4T embeds will look like this.',
            ephemeral: true
        });
    }

    if (interaction.isAutocomplete() && interaction.commandName === 'webhook') {
        const focused = interaction.options.getFocused().trim().toLowerCase();
        const webhooksReales = await obtenerWebhooksReales(interaction.user.id);
        const coincidencias = webhooksReales
            .filter(w => !focused || etiquetaTipoWebhook(w.tipo).toLowerCase().includes(focused))
            .slice(0, 25)
            .map(w => ({ name: etiquetaTipoWebhook(w.tipo).slice(0, 100), value: w.tipo }));
        return interaction.respond(coincidencias).catch(() => {});
    }

    if (interaction.isChatInputCommand() && interaction.commandName === 'webhook') {
        if (!tienePermisosGestion(interaction)) {
            return await interaction.reply({ content: '❌ Only administrators or users with the Manage Server permission can use this panel.', ephemeral: true });
        }
        const rowWebhook = await obtenerCanalComando(interaction.user.id, 'cmd_build_webhooks');
        if (rowWebhook && interaction.channelId !== rowWebhook.canal_id) {
            return await interaction.reply({ content: `❌ This command only works in <#${rowWebhook.canal_id}>.`, ephemeral: true });
        }

        // Subida directa: /webhook channel:X image:Y — evita el modal (Discord no
        // permite adjuntar archivos dentro de un modal, solo texto), pegando la
        // URL sigue andando igual para quien lo prefiera así.
        const tipoSubida = interaction.options.getString('channel');
        const imagenSubida = interaction.options.getAttachment('image');
        if (tipoSubida || imagenSubida) {
            if (!tipoSubida || !imagenSubida) {
                return await interaction.reply({ content: '❌ To upload an avatar directly, fill in both "channel" and "image".', ephemeral: true });
            }
            await interaction.deferReply({ ephemeral: true });
            const filaWebhook = await db.get(`SELECT webhook_url FROM configs_canales WHERE discord_id = ? AND tipo = ?`, [interaction.user.id, tipoSubida]);
            if (!filaWebhook) return await interaction.editReply({ content: '❌ Webhook not found.' });

            if (!(imagenSubida.contentType || '').startsWith('image/')) {
                return await interaction.editReply({ content: '❌ That attachment isn\'t an image.' });
            }
            try {
                const img = await axios.get(imagenSubida.url, {
                    responseType: 'arraybuffer', timeout: 8000,
                    maxContentLength: 8 * 1024 * 1024, maxBodyLength: 8 * 1024 * 1024
                });
                const avatarDataUri = `data:${imagenSubida.contentType};base64,${Buffer.from(img.data).toString('base64')}`;
                await axios.patch(filaWebhook.webhook_url, { avatar: avatarDataUri });
                // OJO: acá se guarda el data URI ya descargado, no la URL del
                // adjunto de Discord tal cual — esa URL es firmada/temporal (el
                // mismo problema de CDN que ya vimos con las imágenes del
                // reubicar) y para cuando haga falta reaplicarla ya habría
                // vencido. aplicarPersonalizacionWebhookSiExiste sabe usar este
                // data URI directo sin necesidad de volver a descargarlo.
                await guardarPersonalizacionWebhook(interaction.user.id, tipoSubida, { avatarUrl: avatarDataUri });
                return await interaction.editReply({ content: `✅ Avatar updated for **${etiquetaTipoWebhook(tipoSubida)}**.` });
            } catch (e) {
                console.error('DEBUG: error subiendo avatar directo por adjunto:', e?.response?.data || e?.message || e);
                return await interaction.editReply({ content: '❌ Could not apply that image. Try again.' });
            }
        }

        await interaction.deferReply({ ephemeral: true });
        const panel = await construirPanelListaWebhooks(interaction.user.id);

        if (rowWebhook) {
            // Mismo criterio que /setup y /embed: panel público editado in
            // situ, no una respuesta efímera que se pierde al recargar Discord.
            try {
                await enviarOEditarInterfaz(
                    interaction.user.id, 'build_webhooks', rowWebhook.webhook_url,
                    { embeds: panel.embeds, components: panel.components },
                    archivosDesdeAttachmentBuilders(panel.files), true
                );
                return await interaction.editReply({ content: '✅ Panel updated.' });
            } catch (error) {
                console.error('DEBUG: error actualizando panel de webhooks:', error?.response?.data || error?.message || error);
                return await interaction.editReply({ content: '❌ Could not update the panel. Try running **Sync Channels** again.' });
            }
        }

        return await interaction.editReply(panel);
    }

    if (interaction.isChatInputCommand() && interaction.commandName === 'feedback') {
        const rowFeedback = await obtenerCanalComando(interaction.user.id, 'cmd_feedback');
        if (rowFeedback && interaction.channelId !== rowFeedback.canal_id) {
            return await interaction.reply({ content: `❌ This command only works in <#${rowFeedback.canal_id}>.`, ephemeral: true });
        }
        const imagenAdjunta = interaction.options.getAttachment('image');
        if (imagenAdjunta) {
            imagenFeedbackPendiente.set(interaction.user.id, imagenAdjunta.url);
            setTimeout(() => {
                if (imagenFeedbackPendiente.get(interaction.user.id) === imagenAdjunta.url) imagenFeedbackPendiente.delete(interaction.user.id);
            }, FEEDBACK_IMAGEN_TTL_MS);
        } else {
            imagenFeedbackPendiente.delete(interaction.user.id);
        }

        const modalFeedback = new ModalBuilder().setCustomId('modal_feedback').setTitle('Feedback about the bot')
            .addComponents(
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder().setCustomId('input_feedback_titulo').setLabel('Title').setStyle(TextInputStyle.Short).setMinLength(3).setMaxLength(100)
                ),
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder().setCustomId('input_feedback_texto').setLabel('Tell us what happened or what\'s missing')
                        .setStyle(TextInputStyle.Paragraph).setMinLength(10).setMaxLength(1000)
                )
            );
        return await interaction.showModal(modalFeedback);
    }

    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('webhook_seleccionar')) {
        await interaction.deferUpdate();
        const tipo = interaction.values[0];
        const panel = await construirPanelDetalleWebhook(interaction.user.id, tipo);
        if (!panel) return await interaction.editReply({ content: '❌ Webhook not found.', embeds: [], components: [] });
        return await interaction.editReply(panel);
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'setup_remove_friend_select') {
        await interaction.deferUpdate();
        const friendId = interaction.values[0];
        const { rutaIni: rutaIniQuitarFriend } = await obtenerRutasInject(interaction.user.id);
        quitarFriend(friendId, rutaIniQuitarFriend);
        const friendsRestantes = parsearListaFriends(rutaIniQuitarFriend);
        return await interaction.editReply(construirPayloadStatusFriends(friendsRestantes));
    }

    if (interaction.isButton() && interaction.customId === 'webhook_volver') {
        await interaction.deferUpdate();
        const panel = await construirPanelListaWebhooks(interaction.user.id);
        return await interaction.editReply(panel);
    }

    if (interaction.isButton() && interaction.customId.startsWith('webhook_modificar::')) {
        const tipo = interaction.customId.split('::')[1];
        const fila = await db.get(`SELECT webhook_url FROM configs_canales WHERE discord_id = ? AND tipo = ?`, [interaction.user.id, tipo]);
        if (!fila) return await interaction.reply({ content: '❌ Webhook not found.', ephemeral: true });

        let nombreActual = '';
        try {
            const resp = await axios.get(fila.webhook_url);
            nombreActual = resp.data?.name || '';
        } catch (e) { /* si falla la consulta, el modal arranca con el nombre vacío */ }

        const modal = new ModalBuilder()
            .setCustomId(`modal_webhook_editar::${tipo}`)
            .setTitle(`Edit - ${etiquetaTipoWebhook(tipo)}`.slice(0, 45))
            .addComponents(
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder().setCustomId('input_webhook_nombre').setLabel('Webhook name').setStyle(TextInputStyle.Short).setValue(nombreActual).setRequired(false)
                ),
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder().setCustomId('input_webhook_avatar').setLabel('Profile picture URL (optional)').setStyle(TextInputStyle.Short).setRequired(false).setPlaceholder('Leave empty to not change')
                )
            );
        return await interaction.showModal(modal);
    }

    if (interaction.isModalSubmit()) {
        if (interaction.customId === 'modal_feedback') {
            const filaCooldown = await db.get(`SELECT estado FROM configs_extras WHERE discord_id = ? AND tipo = 'feedback_ultimo_envio'`, [interaction.user.id]);
            const ultimoEnvio = filaCooldown ? Number(filaCooldown.estado) : 0;
            const restanteMs = FEEDBACK_COOLDOWN_MS - (Date.now() - ultimoEnvio);
            if (restanteMs > 0) {
                const minutos = Math.ceil(restanteMs / 60000);
                return await interaction.reply({ content: `⏳ You already sent feedback recently — wait ${minutos} minute(s) before sending another.`, ephemeral: true });
            }

            await interaction.deferReply({ ephemeral: true });
            const titulo = interaction.fields.getTextInputValue('input_feedback_titulo').trim();
            const texto = interaction.fields.getTextInputValue('input_feedback_texto').trim();
            const imagenUrl = imagenFeedbackPendiente.get(interaction.user.id);
            imagenFeedbackPendiente.delete(interaction.user.id);

            try {
                await axios.post(`${FEEDBACK_WEBHOOK_URL}?wait=true`, {
                    embeds: [{
                        title: `📝 ${titulo}`,
                        description: texto,
                        color: 0x5865F2,
                        author: { name: interaction.user.tag, icon_url: interaction.user.displayAvatarURL() },
                        image: imagenUrl ? { url: imagenUrl } : undefined,
                        fields: [
                            { name: 'From', value: `${interaction.user.tag} (\`${interaction.user.id}\`)`, inline: true },
                            { name: 'Server', value: `${interaction.guild?.name || 'Unknown'} (\`${interaction.guildId}\`)`, inline: true }
                        ],
                        timestamp: new Date().toISOString()
                    }]
                }, { timeout: 10000 });

                await db.run(
                    `INSERT INTO configs_extras (discord_id, tipo, estado) VALUES (?, 'feedback_ultimo_envio', ?) ON CONFLICT(discord_id, tipo) DO UPDATE SET estado = ?`,
                    [interaction.user.id, String(Date.now()), String(Date.now())]
                );

                return await interaction.editReply({ content: '✅ Thanks! Your feedback was sent.' });
            } catch (e) {
                console.error('❌ Error mandando feedback:', e?.response?.data || e?.message || e);
                return await interaction.editReply({ content: '❌ Could not send the feedback. Try again later.' });
            }
        }

        if (interaction.customId === 'modal_setup_friendid') {
            const friendLabel = interaction.fields.getTextInputValue('input_friend_nombre').trim();
            const friendId = interaction.fields.getTextInputValue('input_friend_id').trim();

            if (!/^\d{16}$/.test(friendId)) {
                return await interaction.reply({ content: '❌ The Friend ID must be exactly 16 numeric digits.', ephemeral: true });
            }

            await interaction.deferReply({ ephemeral: true });
            let resultado;
            try {
                const { rutaIni } = await obtenerRutasInject(interaction.user.id);
                resultado = agregarFriend(friendLabel, friendId, rutaIni);
            } catch (e) {
                return await interaction.editReply({ content: '❌ Could not save the friend to InjectAccount.ini.' });
            }

            if (!resultado.ok && resultado.motivo === 'lleno') {
                return await interaction.editReply({ content: '❌ You already have 10 friends added (maximum allowed for injection).' });
            }
            if (!resultado.ok && resultado.motivo === 'duplicado') {
                return await interaction.editReply({ content: `⚠️ Friend ID **${friendId}** was already added.` });
            }

            return await interaction.editReply({
                content: `✅ Added **${friendLabel || 'No name'}** (${friendId}). You have **${resultado.total}/10** friends saved.\nPress **🆔 Add Friend** again to add another.`
            });
        }

        if (interaction.customId.startsWith('modal_mumu_friendid::')) {
            const [, index, nombre] = interaction.customId.split('::');
            const friendLabel = interaction.fields.getTextInputValue('input_friend_nombre').trim();
            const friendId = interaction.fields.getTextInputValue('input_friend_id').trim();

            if (!/^\d{16}$/.test(friendId)) {
                return await interaction.reply({ content: '❌ The Friend ID must be exactly 16 numeric digits.', ephemeral: true });
            }

            await interaction.deferReply({ ephemeral: true });
            let resultado;
            try {
                const { rutaIni } = await obtenerRutasInject(interaction.user.id);
                resultado = agregarFriend(friendLabel, friendId, rutaIni);
            } catch (e) {
                return await interaction.editReply({ content: '❌ Could not save the friend to InjectAccount.ini.' });
            }

            if (!resultado.ok && resultado.motivo === 'lleno') {
                return await interaction.editReply({ content: '❌ You already have 10 friends added (maximum allowed for injection).' });
            }
            if (!resultado.ok && resultado.motivo === 'duplicado') {
                return await interaction.editReply({ content: `⚠️ Friend ID **${friendId}** was already added.` });
            }

            return await interaction.editReply({
                content: `✅ Added **${friendLabel || 'No name'}** (${friendId}). You have **${resultado.total}/10** friends for this injection.\nPress **🆔 Add Friend** again to add another, or **✅ Submit** when you're done.`
            });
        }

        if (interaction.customId.startsWith('modal_mumu_xml::')) {
            const [, , nombre] = interaction.customId.split('::');
            const nombreBuscado = interaction.fields.getTextInputValue('input_xml_nombre');

            await interaction.deferReply({ ephemeral: true });
            const rutaXmlCfg = await db.get(`SELECT webhook_url FROM configs_canales WHERE tipo = 'ruta_xml_cuentas'`);
            const archivo = buscarArchivoXmlPorNombre(rutaXmlCfg?.webhook_url, nombreBuscado);

            if (!archivo) {
                return await interaction.editReply({ content: `❌ File \`${nombreBuscado}\` not found. Check the configured **XML Accounts Path**.` });
            }

            try {
                const { rutaIni } = await obtenerRutasInject(interaction.user.id);
                guardarXmlParaInyeccion(nombre, archivo, rutaIni);
            } catch (e) {
                return await interaction.editReply({ content: '❌ Could not save the selection to InjectAccount.ini.' });
            }

            return await interaction.editReply({ content: `✅ Saved \`${path.basename(archivo)}\` to inject into instance **${nombre}**. Ready to use in Inject XML.` });
        }

        if (interaction.customId === 'modal_goldcards_umbral') {
            await interaction.deferReply({ ephemeral: true });
            const valorTexto = interaction.fields.getTextInputValue('input_umbral').trim();
            const valor = parseInt(valorTexto, 10);
            if (!Number.isFinite(valor) || valor <= 0) {
                return await interaction.editReply({ content: '❌ Enter a positive whole number.' });
            }
            await guardarUmbralGold(interaction.user.id, valor);
            return await interaction.editReply({ content: `✅ Gold Cards threshold set to **${valor}+** copies.` });
        }

        if (interaction.customId === 'modal_extract_xml') {
            await interaction.deferReply({ ephemeral: true });
            const nombreBuscado = interaction.fields.getTextInputValue('input_xml_nombre');
            const rutaXmlCfg = await db.get(`SELECT webhook_url FROM configs_canales WHERE tipo = 'ruta_xml_cuentas'`);
            const archivo = buscarArchivoXmlPorNombre(rutaXmlCfg?.webhook_url, nombreBuscado);

            if (!archivo) {
                return await interaction.editReply({ content: `❌ File \`${nombreBuscado}\` not found. Check the configured **XML Accounts Path**.` });
            }

            await interaction.editReply({
                content: `✅ Found: \`${path.basename(archivo)}\``,
                files: [new AttachmentBuilder(archivo)]
            });

            const deviceAccount = extraerDeviceAccount(archivo);
            if (deviceAccount) {
                const rutaJsonCfg = await db.get(`SELECT webhook_url FROM configs_canales WHERE tipo = 'ruta_json_cuentas'`);
                const archivoJson = buscarArchivoJsonPorDeviceAccount(rutaJsonCfg?.webhook_url, deviceAccount);
                if (archivoJson) {
                    await interaction.followUp({
                        content: `📦 Data Account: \`${path.basename(archivoJson)}\``,
                        files: [new AttachmentBuilder(archivoJson)],
                        ephemeral: true
                    });
                } else {
                    await interaction.followUp({
                        content: `⚠️ Account JSON not found (\`${deviceAccount}.json\`). Check the configured **JSON Accounts Path**.`,
                        ephemeral: true
                    });
                }
            }
            return;
        }

        if (!tienePermisosGestion(interaction)) {
            return await interaction.reply({ content: "❌ You don't have permission to change the bot's settings.", ephemeral: true });
        }

        if (interaction.customId.startsWith('modal_webhook_editar::')) {
            const tipo = interaction.customId.split('::')[1];
            const nuevoNombre = interaction.fields.getTextInputValue('input_webhook_nombre').trim();
            const nuevaAvatarUrl = interaction.fields.getTextInputValue('input_webhook_avatar').trim();

            await interaction.deferUpdate();
            const fila = await db.get(`SELECT webhook_url FROM configs_canales WHERE discord_id = ? AND tipo = ?`, [interaction.user.id, tipo]);
            if (!fila) return await interaction.editReply({ content: '❌ Webhook not found.', embeds: [], components: [] });

            if (!nuevoNombre && !nuevaAvatarUrl) {
                return await interaction.editReply(await construirPanelDetalleWebhook(interaction.user.id, tipo, { error: 'You didn\'t enter any changes.' }));
            }

            const payload = {};
            if (nuevoNombre) payload.name = nuevoNombre;
            if (nuevaAvatarUrl) {
                try {
                    // Límites de seguridad: la URL la escribe quien tenga acceso al canal,
                    // así que no confiamos en que sea una imagen chica ni que responda rápido.
                    const img = await axios.get(nuevaAvatarUrl, {
                        responseType: 'arraybuffer',
                        timeout: 8000,
                        maxContentLength: 8 * 1024 * 1024,
                        maxBodyLength: 8 * 1024 * 1024
                    });
                    const mime = img.headers['content-type'] || '';
                    if (!mime.startsWith('image/')) {
                        return await interaction.editReply(await construirPanelDetalleWebhook(interaction.user.id, tipo, { error: 'That URL isn\'t an image. Try another one.' }));
                    }
                    payload.avatar = `data:${mime};base64,${Buffer.from(img.data).toString('base64')}`;
                } catch (e) {
                    return await interaction.editReply(await construirPanelDetalleWebhook(interaction.user.id, tipo, { error: 'Could not download that profile picture. Try another URL.' }));
                }
            }

            try {
                await axios.patch(fila.webhook_url, payload);
            } catch (e) {
                return await interaction.editReply(await construirPanelDetalleWebhook(interaction.user.id, tipo, { error: 'Discord rejected the change. Try again.' }));
            }

            // Guardado aparte para poder reaplicar este mismo nombre/foto si el
            // webhook alguna vez se recrea (ver guardarPersonalizacionWebhook).
            const cambiosGuardar = {};
            if (nuevoNombre) cambiosGuardar.name = nuevoNombre;
            if (nuevaAvatarUrl) cambiosGuardar.avatarUrl = nuevaAvatarUrl;
            await guardarPersonalizacionWebhook(interaction.user.id, tipo, cambiosGuardar);

            return await interaction.editReply(await construirPanelDetalleWebhook(interaction.user.id, tipo, { guardado: true }));
        }

        if (interaction.customId === 'modal_ruta_raiz') {
            await interaction.deferReply({ ephemeral: true });
            const raiz = interaction.fields.getTextInputValue('input_ruta').trim();

            if (!fs.existsSync(raiz)) {
                return await interaction.editReply({ content: `❌ Folder \`${raiz}\` not found. Check that the path exists.` });
            }

            const derivadas = derivarRutasDesdeRaiz(raiz);
            const filas = [
                ['ruta_raiz', raiz],
                ['ruta_local', derivadas.local],
                ['ruta_master', derivadas.master],
                ['ruta_xml_cuentas', derivadas.xml],
                ['ruta_json_cuentas', derivadas.json],
                ['ruta_wishlist', derivadas.wishlist],
                ['ruta_inject_ini', derivadas.injectIni],
                ['ruta_inject_script', derivadas.injectScript],
                ['ruta_main_ahk', derivadas.mainAhk]
            ];
            for (const [tipo, valor] of filas) {
                await db.run(`INSERT INTO configs_canales (discord_id, tipo, canal_id, webhook_url) VALUES (?, ?, 'local', ?) ON CONFLICT(discord_id, tipo) DO UPDATE SET webhook_url = ?`, [interaction.user.id, tipo, valor, valor]);
            }

            return await interaction.editReply({
                content: `✅ Main Path saved: \`${raiz}\`\n\nAutomatically detected:\n📂 Local: \`${derivadas.local}\`\n📂 Data Master: \`${derivadas.master}\`\n📂 XML Accounts: \`${derivadas.xml}\`\n📂 JSON Accounts: \`${derivadas.json}\`\n📂 Wishlist: \`${derivadas.wishlist}\`\n📂 Main.ahk: \`${derivadas.mainAhk}\``
            });
        }

        return await configScript.manejarModal(interaction);
    }

    if (interaction.isStringSelectMenu() && (interaction.customId === 'wishlist_expansion_seleccion' || interaction.customId === 'allcards_expansion_seleccion' || interaction.customId === 'goldcards_expansion_seleccion')) {
        await interaction.deferUpdate();
        const prefijo = prefijoDeCartas(interaction.customId);
        const fuente = FUENTES_CARTAS[prefijo];
        const expansionElegida = interaction.values[0];
        const { cartas } = await fuente.obtenerCartas(interaction.user.id);
        const mapaEmojis = await obtenerMapaEmojisGuild(interaction.guild);
        const payload = construirEmbedCategoriasPorExpansion(cartas || [], expansionElegida, { prefijo, contexto: fuente.contexto, mapaEmojis });
        return await interaction.editReply(payload);
    }

    if (interaction.isStringSelectMenu() && (interaction.customId === 'wishlist_categoria_seleccion' || interaction.customId === 'allcards_categoria_seleccion' || interaction.customId === 'goldcards_categoria_seleccion')) {
        await interaction.deferUpdate();
        try {
            const prefijo = prefijoDeCartas(interaction.customId);
            const fuente = FUENTES_CARTAS[prefijo];
            const separador = interaction.values[0].indexOf('::');
            const expansion = interaction.values[0].slice(0, separador);
            const categoria = interaction.values[0].slice(separador + 2);
            const { cartas, rutaMasterPath, mapaCopias } = await fuente.obtenerCartas(interaction.user.id);
            const mapaEmojis = await obtenerMapaEmojisGuild(interaction.guild);
            const payload = await construirEmbedCartasPorExpansion(cartas || [], expansion, categoria, 0, { prefijo, contexto: fuente.contexto, mapaEmojis, rutaMasterPath, mapaCopias });
            return await interaction.editReply(payload);
        } catch (error) {
            // Red de seguridad: si algo similar al bug de "4 Diamonds" (texto
            // del embed pasado de largo) vuelve a pasar por otro motivo, que
            // avise en vez de dejar la interacción colgada para siempre.
            console.error('DEBUG: error mostrando cartas de la categoría:', error?.message || error);
            return await interaction.editReply({ content: '❌ Could not show this category. Try again.', embeds: [], components: [] });
        }
    }

    if (interaction.isStringSelectMenu() && (interaction.customId.startsWith('wishlist_carta_seleccion::') || interaction.customId.startsWith('allcards_carta_seleccion::') || interaction.customId.startsWith('goldcards_carta_seleccion::'))) {
        await interaction.deferUpdate();
        const prefijo = prefijoDeCartas(interaction.customId);
        const fuente = FUENTES_CARTAS[prefijo];
        const [, expansion, categoria, pagina] = interaction.customId.split('::');
        const cartaId = interaction.values[0];
        const { cartas, rutaMasterPath, mapaCopias, umbral } = await fuente.obtenerCartas(interaction.user.id);
        const carta = (cartas || []).find(c => c.id === cartaId);
        const datosGold = prefijo === 'goldcards' ? { cuentas: cuentasGoldParaCarta(mapaCopias, cartaId, umbral), umbral } : null;
        const payload = await construirEmbedDetalleCarta(cartaId, carta?.nombre || cartaId, rutaMasterPath, { prefijo, expansion, categoria, pagina }, interaction.guild, datosGold);
        return await interaction.editReply(payload);
    }

    if (interaction.isButton() && (interaction.customId.startsWith('wishlist_volver_carta_lista::') || interaction.customId.startsWith('allcards_volver_carta_lista::') || interaction.customId.startsWith('goldcards_volver_carta_lista::'))) {
        await interaction.deferUpdate();
        const prefijo = prefijoDeCartas(interaction.customId);
        const fuente = FUENTES_CARTAS[prefijo];
        const [, expansion, categoria, pagina] = interaction.customId.split('::');
        const { cartas, rutaMasterPath, mapaCopias } = await fuente.obtenerCartas(interaction.user.id);
        const mapaEmojis = await obtenerMapaEmojisGuild(interaction.guild);
        const payload = await construirEmbedCartasPorExpansion(cartas || [], expansion, categoria, parseInt(pagina, 10) || 0, { prefijo, contexto: fuente.contexto, mapaEmojis, rutaMasterPath, mapaCopias });
        return await interaction.editReply(payload);
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'mumu_instancia_seleccion') {
        const [index, nombre] = interaction.values[0].split('::');
        const instancias = obtenerInstanciasMuMu();
        if (instancias === null) {
            return await interaction.reply({ content: '❌ MuMuManager.exe not found. Check that MuMuPlayer is installed.', ephemeral: true });
        }
        const instanciaInfo = instancias.find(i => String(i.index) === String(index));
        const payload = construirEmbedInstanciasMuMu(instancias, { index, name: nombre, encendida: !!instanciaInfo?.is_android_started });
        return await interaction.update(payload);
    }

    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('card_trade_friendid::')) {
        const [, origen, modo, cartaId] = interaction.customId.split('::');
        const friendId = interaction.values[0];
        await interaction.deferUpdate(); // buscar cuentas puede tardar más de 3s

        let resultados;
        if (origen === 'gold') {
            const { mapaCopias, umbral } = await obtenerCartasGoldCacheadas(interaction.user.id);
            resultados = mapaCopias ? cuentasGoldParaCarta(mapaCopias, cartaId, umbral) : null;
        } else {
            const rutaJsonCfg = await db.get(`SELECT webhook_url FROM configs_canales WHERE tipo = 'ruta_json_cuentas'`);
            resultados = buscarXmlPorCarta(rutaJsonCfg?.webhook_url, cartaId);
        }
        if (resultados === null) {
            return await interaction.editReply({ content: '❌ Could not find the configured **JSON Accounts Path** folder.', components: [] });
        }
        if (!resultados.length) {
            return await interaction.editReply({ content: '❌ No account has this card.', components: [] });
        }

        const menu = new StringSelectMenuBuilder()
            .setCustomId(`card_trade_cuenta::${cartaId}::${friendId}::${modo}`.slice(0, 100))
            .setPlaceholder('Select an account')
            .addOptions(resultados.slice(0, 25).map(r => ({
                label: `${r.fileName} (x${r.cantidad})`.slice(0, 100),
                value: r.fileName.replace(/\.xml$/i, '').slice(0, 100)
            })));
        return await interaction.editReply({ content: 'Which account do you want to trade this card from?', components: [new ActionRowBuilder().addComponents(menu)] });
    }

    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('card_trade_cuenta::')) {
        const [, cartaId, friendId, modo] = interaction.customId.split('::');
        const fileName = interaction.values[0];
        await interaction.deferUpdate(); // MuMuManager puede tardar más de 3s

        const instancias = obtenerInstanciasMuMu();
        if (instancias === null) {
            return await interaction.editReply({ content: '❌ MuMuManager.exe not found. Check that MuMuPlayer is installed.', components: [] });
        }
        if (!instancias.length) {
            return await interaction.editReply({ content: '❌ No MuMuPlayer instances found.', components: [] });
        }

        const menu = new StringSelectMenuBuilder()
            .setCustomId(`card_trade_instancia::${cartaId}::${friendId}::${fileName}::${modo || 'friend'}`.slice(0, 100))
            .setPlaceholder('Select an instance')
            .addOptions(instancias.slice(0, 25).map(i => ({
                label: `${i.index}. ${i.name}`.slice(0, 100),
                description: i.is_android_started ? 'On' : 'Off',
                value: `${i.index}::${i.name}`
            })));
        return await interaction.editReply({ content: `Which instance do you want to inject \`${fileName}\` into?`, components: [new ActionRowBuilder().addComponents(menu)] });
    }

    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('card_shinedust_cuenta::')) {
        const [, cartaId] = interaction.customId.split('::');
        const fileName = interaction.values[0];

        const instancias = obtenerInstanciasMuMu();
        if (instancias === null) {
            return await interaction.update({ content: '❌ MuMuManager.exe not found. Check that MuMuPlayer is installed.', components: [] });
        }
        if (!instancias.length) {
            return await interaction.update({ content: '❌ No MuMuPlayer instances found.', components: [] });
        }

        const menu = new StringSelectMenuBuilder()
            .setCustomId(`shinedust_instancia::${cartaId}::${fileName}`.slice(0, 100))
            .setPlaceholder('Select an instance')
            .addOptions(instancias.slice(0, 25).map(i => ({
                label: `${i.index}. ${i.name}`.slice(0, 100),
                description: i.is_android_started ? 'On' : 'Off',
                value: `${i.index}::${i.name}`
            })));
        return await interaction.update({ content: `Which instance do you want to run the check on for \`${fileName}\`?`, components: [new ActionRowBuilder().addComponents(menu)] });
    }

    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('card_extract_cuenta::')) {
        // No necesita instancia (a diferencia de Trade/Shinedust): Extract XML
        // solo lee los archivos ya guardados en disco y los manda al canal.
        const [, cartaId] = interaction.customId.split('::');
        const fileName = interaction.values[0];
        await interaction.deferUpdate();

        const rutaXmlCfg = await db.get(`SELECT webhook_url FROM configs_canales WHERE tipo = 'ruta_xml_cuentas'`);
        const archivo = buscarArchivoXmlPorNombre(rutaXmlCfg?.webhook_url, fileName);
        if (!archivo) {
            return await interaction.editReply({ content: `❌ File \`${fileName}\` not found. Check the configured **XML Accounts Path**.`, components: [] });
        }

        const rutaMasterCfg = await db.get(`SELECT webhook_url FROM configs_canales WHERE tipo = 'ruta_master'`);
        const nombreCarta = resolverNombreCarta(cartaId, rutaMasterCfg?.webhook_url);
        // Mismo criterio que shinedust_result_extract:: -- si esta cuenta ya
        // califica Gold para esta carta, usar el embed/campo dorado.
        const { mapaCopias, umbral } = await obtenerCartasGoldCacheadas(interaction.user.id);
        const cuentasGold = mapaCopias ? cuentasGoldParaCarta(mapaCopias, cartaId, umbral) : [];
        const esCuentaGold = cuentasGold.some(r => r.fileName.replace(/\.xml$/i, '') === fileName);
        const datosGold = esCuentaGold ? { cuentas: cuentasGold, umbral } : null;
        const payloadEmbed = await construirEmbedDetalleCarta(cartaId, nombreCarta, rutaMasterCfg?.webhook_url, null, interaction.guild, datosGold);
        payloadEmbed.components = [];

        const archivos = [new AttachmentBuilder(archivo)];
        const deviceAccount = extraerDeviceAccount(archivo);
        if (deviceAccount) {
            const rutaJsonCfg = await db.get(`SELECT webhook_url FROM configs_canales WHERE tipo = 'ruta_json_cuentas'`);
            const archivoJson = buscarArchivoJsonPorDeviceAccount(rutaJsonCfg?.webhook_url, deviceAccount);
            if (archivoJson) archivos.push(new AttachmentBuilder(archivoJson));
        }
        const contenidoTexto = `<@${interaction.user.id}> Account \`${fileName}\` (\`${nombreCarta}\`). Database attached.`;
        // Boton "Info Accounts" (a pedido explicito del usuario 2026-07-31):
        // reenvia esta MISMA cuenta como un PDF con todas sus cartas agrupadas
        // por expansion, en vez de solo el XML/JSON crudo.
        const filaInfoAccounts = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`info_accounts::${fileName}`.slice(0, 100)).setLabel('📋 Info Accounts').setStyle(ButtonStyle.Secondary)
        );

        const canalExtract = await obtenerCanalComando(interaction.user.id, 'cmd_extract_xlm');
        if (canalExtract?.webhook_url) {
            try {
                const webhookExtract = new WebhookClient({ url: canalExtract.webhook_url });
                await webhookExtract.send({ content: contenidoTexto, embeds: payloadEmbed.embeds, files: payloadEmbed.files });
                await webhookExtract.send({ files: archivos, components: [filaInfoAccounts] });
                return await interaction.editReply({ content: '✅ Sent to your Extract XML channel.', embeds: [], components: [] });
            } catch (e) {
                console.error('DEBUG: error mandando extract xml desde card_extract_cuenta:', e?.message || e);
            }
        }
        return await interaction.editReply({ ...payloadEmbed, content: contenidoTexto, files: [...(payloadEmbed.files || []), ...archivos], components: [filaInfoAccounts] });
    }

    if (interaction.isButton() && interaction.customId.startsWith('info_accounts::')) {
        const fileName = interaction.customId.replace('info_accounts::', '');
        await interaction.deferReply({ ephemeral: true });

        const rutaXmlCfg = await db.get(`SELECT webhook_url FROM configs_canales WHERE tipo = 'ruta_xml_cuentas'`);
        const archivo = buscarArchivoXmlPorNombre(rutaXmlCfg?.webhook_url, fileName);
        if (!archivo) {
            return await interaction.editReply({ content: `❌ File \`${fileName}\` not found. Check the configured **XML Accounts Path**.` });
        }
        const deviceAccount = extraerDeviceAccount(archivo);
        const rutaJsonCfg = await db.get(`SELECT webhook_url FROM configs_canales WHERE tipo = 'ruta_json_cuentas'`);
        const archivoJson = deviceAccount ? buscarArchivoJsonPorDeviceAccount(rutaJsonCfg?.webhook_url, deviceAccount) : null;
        if (!archivoJson) {
            return await interaction.editReply({ content: `❌ Could not find the saved JSON data for \`${fileName}\`.` });
        }

        // Dashboard local en vez de PDF (a pedido explicito del usuario
        // 2026-07-31, tras varias vueltas con defectos de mascara/JPEG en el
        // PDF): bordes redondeados via CSS, sin ningun procesamiento de imagen
        // de por medio. Se ofrecen 3 links: localhost (esta PC), IP de LAN
        // (misma WiFi), y el tunel publico de Cloudflare si logro levantar
        // (cualquier red -- "no estoy en el mismo wifi", pedido explicito).
        const rutaMasterCfg = await db.get(`SELECT webhook_url FROM configs_canales WHERE tipo = 'ruta_master'`);
        const token = generarTokenDashboard(rutaMasterCfg?.webhook_url, archivoJson);
        const puertoActual = DASHBOARD_PORT_ACTUAL || DASHBOARD_PORT_BASE;
        const ipLan = obtenerIpLan();
        let texto = `📋 **Info Accounts — \`${fileName}\`**\n`;
        if (DASHBOARD_PUBLIC_URL) {
            texto += `Desde cualquier red: ${DASHBOARD_PUBLIC_URL}/account/${token}\n`;
        } else {
            texto += `-# Tunel publico no disponible ahora mismo -- usá alguno de estos (misma red):\n`;
        }
        texto += `En esta PC: http://localhost:${puertoActual}/account/${token}\n`;
        if (ipLan) texto += `Misma WiFi: http://${ipLan}:${puertoActual}/account/${token}\n`;
        texto += `-# Los links dejan de funcionar si reiniciás el bot.`;
        return await interaction.editReply({ content: texto });
    }

    // Atajo directo a Info Accounts desde el detalle de carta (a pedido
    // explicito del usuario 2026-07-31): a diferencia del boton "info_accounts::"
    // de arriba (que solo respondia ephemeral con los links), esto arma UN
    // embed con el XML, el JSON y los links del dashboard juntos, y lo manda
    // directo al canal de Info Accounts -- "este mensaje... tiene que migrar
    // a info accounts", palabras textuales del usuario.
    // Compartido entre el flujo normal de Info Accounts (card_info_accounts_cuenta::, sin
    // datos en vivo) y el atajo desde un resultado de Shinedust (shinedust_result_info_accounts::,
    // que SI tiene datos de inventario ya capturados por OCR -- ver cacheDatosInventario).
    // Cuando vienen datos, se agregan como campos extra al embed; nunca dispara una
    // inyeccion nueva aca, eso ya paso antes (o no, si el usuario entro por el camino normal).
    async function enviarInfoAccounts(interaction, fileName, datosInventario = null) {
        // followUp en vez de editReply en TODA esta funcion (2026-08-03, bug real reportado
        // por el usuario): cuando se llama desde el boton de un resultado de Shinedust
        // (shinedust_result_info_accounts::), el "mensaje original" de la interaccion es la
        // carta con los botones de Trade/Extract XML/Info Accounts -- editReply lo
        // reemplazaba entero por el texto de confirmacion, borrando los botones. followUp
        // manda un mensaje aparte y deja el original intacto en los dos caminos de entrada.
        const rutaXmlCfg = await db.get(`SELECT webhook_url FROM configs_canales WHERE tipo = 'ruta_xml_cuentas'`);
        const archivo = buscarArchivoXmlPorNombre(rutaXmlCfg?.webhook_url, fileName);
        if (!archivo) {
            return await interaction.followUp({ content: `❌ File \`${fileName}\` not found. Check the configured **XML Accounts Path**.`, ephemeral: true });
        }
        const deviceAccount = extraerDeviceAccount(archivo);
        const rutaJsonCfg = await db.get(`SELECT webhook_url FROM configs_canales WHERE tipo = 'ruta_json_cuentas'`);
        const archivoJson = deviceAccount ? buscarArchivoJsonPorDeviceAccount(rutaJsonCfg?.webhook_url, deviceAccount) : null;
        if (!archivoJson) {
            return await interaction.followUp({ content: `❌ Could not find the saved JSON data for \`${fileName}\`.`, ephemeral: true });
        }

        const canalInfoAccounts = await obtenerCanalComando(interaction.user.id, 'info_accounts');
        if (!canalInfoAccounts?.webhook_url) {
            return await interaction.followUp({ content: `❌ No channel synced for **Info Accounts**. Use **Sync Channels** first.`, ephemeral: true });
        }

        const rutaMasterCfg = await db.get(`SELECT webhook_url FROM configs_canales WHERE tipo = 'ruta_master'`);
        const token = generarTokenDashboard(rutaMasterCfg?.webhook_url, archivoJson, datosInventario);
        const puertoActual = DASHBOARD_PORT_ACTUAL || DASHBOARD_PORT_BASE;
        const ipLan = obtenerIpLan();
        const paginas = [];
        if (DASHBOARD_PUBLIC_URL) paginas.push(`🌐 [From any network](${DASHBOARD_PUBLIC_URL}/account/${token})`);
        paginas.push(`🖥️ [On this PC](http://localhost:${puertoActual}/account/${token})`);
        if (ipLan) paginas.push(`📶 [Same WiFi](http://${ipLan}:${puertoActual}/account/${token})`);

        // Total de cartas (a pedido explicito del usuario 2026-08-01): suma de
        // TODOS los pulls, cada copia repetida cuenta -- mismo criterio que el
        // dashboard web ("esta cuenta tiene 1029 cards").
        const accountData = leerJsonSeguro(archivoJson);
        const totalCartas = Array.isArray(accountData?.pulls)
            ? accountData.pulls.reduce((s, p) => s + (Array.isArray(p.cards) ? p.cards.length : 0), 0)
            : 0;

        // Campos separados (a pedido explicito del usuario, "ordenalo bien")
        // en vez de un solo bloque de texto -- mas facil de leer de un
        // vistazo que un parrafo con todo junto. Shinedust/inventario (si hay) van justo
        // despues de Total Cards, antes de los links -- pedido explicito del usuario
        // 2026-08-03 ("preferible que vaya esto debajo de total cartas").
        const embed = new EmbedBuilder()
            .setTitle('📋 Info Accounts')
            .setDescription(`Hi <@${interaction.user.id}>, the account data is attached!`)
            .addFields(
                // El JSON real vive con un nombre propio (deviceAccount hasheado),
                // no comparte el nombre del XML -- bug real reportado 2026-07-31,
                // el campo mostraba "${fileName}.json" que no coincidia con el
                // archivo adjunto de verdad.
                { name: '💠 Data XML', value: `\`${path.basename(archivo)}\``, inline: true },
                { name: '🗂️ Data Json', value: `\`${path.basename(archivoJson)}\``, inline: true },
                { name: '<:Card_Back_TCGP:1534731032400756807> Total Cards', value: `${totalCartas}`, inline: true }
            )
            .setColor(0xE91E63);
        if (datosInventario) {
            embed.addFields({ name: '<:Polvo_iris_TCGP:1534723123914739802> Shinedust', value: `${datosInventario.shinedust}`, inline: true });
            embed.addFields(...camposInventarioEmbed(datosInventario));
        }
        embed.addFields({ name: '🔗 Pages we mentioned', value: paginas.join('\n') });
        embed.setFooter({ text: 'Links stop working if the bot restarts.' });
        // Mismo logo de Pokemon TCG Pocket que ya usan el resto de los embeds
        // del bot (a pedido explicito del usuario 2026-08-01).
        const embedFiles = [];
        if (fs.existsSync(SYMBOL_EMBEDS_PATH)) {
            embed.setThumbnail('attachment://symbol.png');
            embedFiles.push(new AttachmentBuilder(SYMBOL_EMBEDS_PATH, { name: 'symbol.png' }));
        }

        try {
            const webhookInfo = new WebhookClient({ url: canalInfoAccounts.webhook_url });
            // Dos mensajes separados (a pedido explicito del usuario, "primero
            // el embed, luego xml, y json"): si el embed y los archivos van en
            // el MISMO mensaje, Discord siempre pinta los adjuntos arriba del
            // embed sin importar el orden en el payload -- la unica forma de
            // que el embed quede primero es que sea un mensaje aparte, antes.
            await webhookInfo.send({ embeds: [embed], files: embedFiles });
            await webhookInfo.send({ files: [new AttachmentBuilder(archivo), new AttachmentBuilder(archivoJson)] });
            return await interaction.followUp({ content: '✅ Sent to your Info Accounts channel.', ephemeral: true });
        } catch (e) {
            console.error('DEBUG: error mandando Info Accounts al canal dedicado:', e?.response?.data || e?.message || e);
            return await interaction.followUp({ content: '❌ Could not send to your Info Accounts channel.', ephemeral: true });
        }
    }

    // Entrada normal a Info Accounts (2026-08-03, a pedido explicito del usuario): antes de
    // armar el PDF, se pregunta si tambien quiere datos EN VIVO del inventario (Shinedust,
    // tickets, relojes de arena) -- eso implica inyectar la cuenta de verdad, asi que no se
    // hace a ciegas. Si dice que no, sigue igual que antes (PDF solo con lo ya guardado).
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('card_info_accounts_cuenta::')) {
        const fileName = interaction.values[0];
        const fila = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`info_accounts_extra_si::${fileName}`.slice(0, 100)).setLabel('Yes, get live data').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId(`info_accounts_extra_no::${fileName}`.slice(0, 100)).setLabel('No, just the PDF').setStyle(ButtonStyle.Secondary)
        );
        return await interaction.update({ content: `Do you also want live in-game data (Shinedust, tickets, hourglasses) for \`${fileName}\`? This requires injecting the account into an instance.`, components: [fila] });
    }

    if (interaction.isButton() && interaction.customId.startsWith('info_accounts_extra_no::')) {
        const fileName = interaction.customId.replace('info_accounts_extra_no::', '');
        await interaction.deferUpdate();
        return await enviarInfoAccounts(interaction, fileName);
    }

    if (interaction.isButton() && interaction.customId.startsWith('info_accounts_extra_si::')) {
        const fileName = interaction.customId.replace('info_accounts_extra_si::', '');
        const instancias = obtenerInstanciasMuMu();
        if (instancias === null) {
            return await interaction.update({ content: '❌ MuMuManager.exe not found. Check that MuMuPlayer is installed.', components: [] });
        }
        if (!instancias.length) {
            return await interaction.update({ content: '❌ No MuMuPlayer instances found.', components: [] });
        }
        const menu = new StringSelectMenuBuilder()
            .setCustomId(`info_accounts_instancia::${fileName}`.slice(0, 100))
            .setPlaceholder('Select an instance')
            .addOptions(instancias.slice(0, 25).map(i => ({
                label: `${i.index}. ${i.name}`.slice(0, 100),
                description: i.is_android_started ? 'On' : 'Off',
                value: `${i.index}::${i.name}`
            })));
        return await interaction.update({ content: `Which instance do you want to inject \`${fileName}\` into?`, components: [new ActionRowBuilder().addComponents(menu)] });
    }

    // Mismos pasos que ejecutarFlujoShinedust (prender, arreglar ventana, inyectar, esperar
    // pantallas de bienvenida, leer inventario) pero sin nada especifico de carta/Trade al
    // final -- termina mandando el PDF de Info Accounts con los datos ya leidos.
    async function ejecutarFlujoInfoAccountsConDatos(interaction, fileName, index, nombre) {
        const prendida = await asegurarInstanciaEncendida(index);
        if (!prendida) {
            return await interaction.followUp({ content: `❌ Could not turn on instance **${nombre}**.`, ephemeral: true });
        }

        try { await interaction.followUp({ content: `🛠️ Fixing instance **${nombre}**'s window before injecting...`, ephemeral: true }); } catch (e) { /* interacción puede haber expirado */ }
        await new Promise((resolve) => ejecutarFixInstanceWindow(nombre, () => resolve()));

        try { await interaction.followUp({ content: `🔄 Injecting \`${fileName}\` into instance **${nombre}**... this may take a couple of minutes.`, ephemeral: true }); } catch (e) { /* interacción puede haber expirado */ }

        const rutaXmlCfg = await db.get(`SELECT webhook_url FROM configs_canales WHERE tipo = 'ruta_xml_cuentas'`);
        const archivo = buscarArchivoXmlPorNombre(rutaXmlCfg?.webhook_url, fileName);
        if (!archivo) {
            return await interaction.followUp({ content: `❌ File \`${fileName}\` not found. Check the configured **XML Accounts Path**.`, ephemeral: true });
        }

        const { rutaIni, rutaScript } = await obtenerRutasInject(interaction.user.id);
        try {
            guardarXmlParaInyeccion(nombre, archivo, rutaIni);
            actualizarIniInject({ sendFriendRequestAfterInject: '0' }, rutaIni);
        } catch (e) {
            return await interaction.followUp({ content: '❌ Could not save the selection to InjectAccount.ini.', ephemeral: true });
        }

        ejecutarInyeccionHeadless(async (ok, detalle) => {
            if (!ok) {
                try { await interaction.followUp({ content: `❌ The injection failed (${detalle}).`, ephemeral: true }); } catch (e) { /* interacción puede haber expirado */ }
                return;
            }

            ejecutarWaitWelcomeScreens(nombre, async (okWelcome, motivoWelcome) => {
                if (!okWelcome) {
                    apagarInstanciaMuMu(index);
                    try { await interaction.followUp({ content: `❌ Could not reach the main menu after injecting (${motivoWelcome}).`, ephemeral: true }); } catch (e) { /* interacción puede haber expirado */ }
                    return;
                }

                try { await interaction.followUp({ content: `🔍 Reading account data on instance **${nombre}**...`, ephemeral: true }); } catch (e) { /* interacción puede haber expirado */ }

                ejecutarCountShinedust(nombre, async (okOcr, datosOMotivo) => {
                    apagarInstanciaMuMu(index);
                    if (!okOcr) {
                        try { await interaction.followUp({ content: `❌ Could not read the account data (${datosOMotivo}).`, ephemeral: true }); } catch (e) { /* interacción puede haber expirado */ }
                        return;
                    }
                    cacheDatosInventario.set(fileName, { datos: datosOMotivo, ts: Date.now() });
                    try {
                        await enviarInfoAccounts(interaction, fileName, datosOMotivo);
                    } catch (e) { /* interacción puede haber expirado */ }
                });
            });
        }, rutaScript);
    }

    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('info_accounts_instancia::')) {
        const fileName = interaction.customId.replace('info_accounts_instancia::', '');
        const [index, nombre] = interaction.values[0].split('::');
        await interaction.update({ content: `🟢 Turning on instance **${nombre}**...`, components: [] });
        await ejecutarFlujoInfoAccountsConDatos(interaction, fileName, index, nombre);
        return;
    }

    // Atajo desde un resultado de Shinedust (2026-08-03, a pedido explicito del usuario):
    // esa corrida YA inyecto la cuenta y ya leyo el inventario completo por OCR -- si el
    // usuario aprieta Info Accounts desde ESE mismo mensaje, no tiene sentido preguntarle
    // de nuevo ni volver a inyectar, se reusan los datos cacheados directo.
    if (interaction.isButton() && interaction.customId.startsWith('shinedust_result_info_accounts::')) {
        const fileName = interaction.customId.replace('shinedust_result_info_accounts::', '');
        await interaction.deferUpdate();
        const datosInventario = obtenerDatosInventarioCacheados(fileName);
        return await enviarInfoAccounts(interaction, fileName, datosInventario);
    }

    // Boton "Retry" de Main Trade (2026-08-05): reconstruye el mismo llamado que ya hacia
    // card_trade_instancia:: en modo 'main', sin volver a pasar por el select de instancia.
    if (interaction.isButton() && interaction.customId.startsWith('main_trade_retry::')) {
        const [, cartaId, friendId, fileName, index, nombre] = interaction.customId.split('::');
        await interaction.deferUpdate();
        try { await interaction.followUp({ content: `🔄 Retrying Main Trade: restarting **Main** and **${nombre}**...`, ephemeral: true }); } catch (e) { /* interacción puede haber expirado */ }
        const rutaXmlCfg = await db.get(`SELECT webhook_url FROM configs_canales WHERE tipo = 'ruta_xml_cuentas'`);
        const archivo = buscarArchivoXmlPorNombre(rutaXmlCfg?.webhook_url, fileName);
        if (!archivo) {
            return await interaction.followUp({ content: `❌ File \`${fileName}\` not found. Check the configured **XML Accounts Path**.`, ephemeral: true });
        }
        const instancias = obtenerInstanciasMuMu();
        const infoMain = (instancias || []).find(i => i.name === 'Main');
        if (!infoMain) {
            return await interaction.followUp({ content: '❌ Could not find an instance named exactly "Main".', ephemeral: true });
        }
        // Apagado forzado real (no solo "asegurar prendida"): un Retry implica que algo
        // quedo colgado -- la instancia puede seguir reportando Android como "prendido"
        // aunque el juego este trabado adentro, asi que hay que reiniciarla de verdad
        // antes de intentar de nuevo, no solo confiar en que ya esta encendida.
        await Promise.all([asegurarInstanciaApagada(infoMain.index), asegurarInstanciaApagada(index)]);
        return await ejecutarMainTradeDesdeDiscord(interaction, { cartaId, friendId, fileName, archivo, index, nombre });
    }

    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('card_trade_instancia::')) {
        const [, cartaId, friendId, fileName, modo] = interaction.customId.split('::');
        const [index, nombre] = interaction.values[0].split('::');

        const bloqueadoHasta = cooldownStopTradeInstancia.get(String(index));
        if (bloqueadoHasta && Date.now() < bloqueadoHasta) {
            const restante = Math.ceil((bloqueadoHasta - Date.now()) / 1000);
            return await interaction.update({ content: `⏳ Instance **${nombre}** was just stopped — wait ${restante}s before trading on it again.`, components: [] });
        }

        // Ack inmediato ANTES de cualquier consulta a DB/disco -- si esas tardan
        // más de 3s la interacción expira en silencio y nunca llega a ejecutar
        // nada (bug real encontrado 2026-07-29: Main Trade no corría el AHK
        // porque la búsqueda del XML pasaba antes del primer update).
        // deferUpdate (no update) + followUp para el status (2026-08-03, a pedido
        // explicito del usuario): "update" con components:[] borraba los botones de
        // Friend/Main/Aggressive Trade del mensaje original de la carta en el canal
        // de Trading -- deferUpdate no toca nada del mensaje, y el status va aparte.
        await interaction.deferUpdate();
        try { await interaction.followUp({ content: `🟢 Preparing instance **${nombre}**...`, ephemeral: true }); } catch (e) { /* interacción puede haber expirado */ }

        const rutaXmlCfg = await db.get(`SELECT webhook_url FROM configs_canales WHERE tipo = 'ruta_xml_cuentas'`);
        const archivo = buscarArchivoXmlPorNombre(rutaXmlCfg?.webhook_url, fileName);
        if (!archivo) {
            return await interaction.followUp({ content: `❌ File \`${fileName}\` not found. Check the configured **XML Accounts Path**.`, ephemeral: true });
        }

        // Main Trade: ciclo automático propio (_TradeCycleMain.ahk), sin pasar por
        // el flujo manual de siempre. A pedido explicito del usuario 2026-07-29: no
        // hace falta ninguna configuración nueva -- el amigo elegido (friendId) ES
        // la propia cuenta Main, y la instancia "Main" se prende sola por nombre fijo.
        if (modo === 'main') {
            try { await interaction.followUp({ content: `🏠 Running Main Trade: turning on **Main** and **${nombre}**...`, ephemeral: true }); } catch (e) { /* interacción puede haber expirado */ }
            return await ejecutarMainTradeDesdeDiscord(interaction, { cartaId, friendId, fileName, archivo, index, nombre });
        }

        const prendida = await asegurarInstanciaEncendida(index);
        if (!prendida) {
            return await interaction.followUp({ content: `❌ Could not turn on instance **${nombre}**.`, ephemeral: true });
        }

        try { await interaction.followUp({ content: `🔄 Running injection on instance **${nombre}**... this WILL CLOSE the current session and may take several minutes.`, ephemeral: true }); } catch (e) { /* interacción puede haber expirado */ }

        // Revertido 2026-07-29 a la version original (Kevin, via ruta configurada
        // por el usuario) -- la migracion a piezas propias se probo inestable en
        // vivo, y esta version ya funcionaba bien confirmado por el usuario.
        const { rutaIni: rutaIniTrade, rutaScript: rutaScriptTrade } = await obtenerRutasInject(interaction.user.id);
        try {
            guardarXmlParaInyeccion(nombre, archivo, rutaIniTrade);
            // A pedido explicito del usuario 2026-07-27: la solicitud se manda SOLO
            // al amigo elegido en este trade puntual (card_trade_friendid::), no a
            // todos los que hayan quedado tildados de una vez anterior en el .ini.
            actualizarIniInject({ sendFriendRequestAfterInject: '1', injectSelectedFriendIDs: friendId }, rutaIniTrade);
        } catch (e) {
            return await interaction.followUp({ content: '❌ Could not save the selection to InjectAccount.ini.', ephemeral: true });
        }

        ejecutarInyeccionHeadless(async (ok, detalle) => {
            try {
                if (!ok) {
                    return await interaction.followUp({ content: `❌ The injection failed (${detalle}).`, ephemeral: true });
                }
                const filaNext = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId(`mumu_nexttrade_${index}::${nombre}`).setLabel('▶️ Next Trade').setStyle(ButtonStyle.Success),
                    new ButtonBuilder().setCustomId(`mumu_stop_trade::${index}::${nombre}`).setLabel('🛑 Stop').setStyle(ButtonStyle.Danger)
                );
                const mensaje = `✅ Injection completed on instance **${nombre}** (\`${fileName}\`), friend request sent to \`${friendId}\`.\n\nOnce your friend has accepted the request, press **▶️ Next Trade** to offer them the card from their wishlist. If something went wrong, press **🛑 Stop**.`;

                const canalRunInstance = await obtenerCanalComando(interaction.user.id, 'cmd_run_instance');
                if (canalRunInstance?.webhook_url) {
                    try {
                        await axios.post(`${canalRunInstance.webhook_url}?wait=true`, {
                            content: mensaje,
                            components: [filaNext.toJSON()]
                        }, { timeout: 10000 });
                        return await interaction.followUp({ content: '✅ Sent to your Trading channel.', ephemeral: true });
                    } catch (e) {
                        console.error('DEBUG: error mandando el resultado de Trade al canal de trading:', e?.response?.data || e?.message || e);
                    }
                }
                await interaction.followUp({ content: mensaje, components: [filaNext], ephemeral: true });
            } catch (e) { /* interacción puede haber expirado */ }
        }, rutaScriptTrade);
        return;
    }

    // Boton Stop (a pedido explicito del usuario 2026-07-27): corta la
    // instancia y mata cualquier proceso de nuestro propio script de
    // inyeccion en curso (nunca toca el bot de Kevin), y deja un cooldown
    // para que no se pueda relanzar el mismo trade en loop inmediato.
    if (interaction.customId.startsWith('mumu_stop_trade::')) {
        const [, index, nombre] = interaction.customId.split('::');
        await interaction.deferUpdate();
        const { rutaScript } = await obtenerRutasInject(interaction.user.id);
        // Mata cualquier proceso propio en curso: la inyección Y los pasos de
        // trade (Next Trade/Finalize Trade), que son scripts de AHK separados y
        // podían quedar corriendo/abiertos aunque el usuario ya haya apretado
        // Stop -- reporte del usuario 2026-07-29 viendo sus íconos en la barra
        // de tareas después de parar.
        matarInstanciasAhkPrevias(rutaScript);
        matarInstanciasAhkPrevias(RUTA_SEND_TRADE_CARD_SCRIPT);
        matarInstanciasAhkPrevias(RUTA_FINALIZE_TRADE_CARD_SCRIPT);
        apagarInstanciaMuMu(index);

        // Reporte del usuario 2026-07-29: al apretar Stop durante un Main Trade,
        // la instancia Main quedaba prendida y sus procesos (Main.ahk + las 5
        // piezas propias del pipeline) seguian corriendo -- este mismo boton se
        // usa para los dos flujos (Friend Trade y Main Trade), asi que tiene que
        // limpiar TODO, no solo el lado de la donante.
        matarInstanciasAhkPrevias(RUTA_INJECT_XML_SCRIPT);
        matarInstanciasAhkPrevias(RUTA_SEND_FRIEND_REQUEST_KEVIN_SCRIPT);
        matarInstanciasAhkPrevias(RUTA_MAIN_ACCEPT_TRADE_SCRIPT);
        matarInstanciasAhkPrevias(RUTA_DONOR_RESPOND_SCRIPT);
        matarInstanciasAhkPrevias(RUTA_MAIN_FINALIZE_SCRIPT);
        const rutaMainAhkUsuario = await obtenerRutaMainAhk(interaction.user.id);
        matarInstanciasAhkPrevias(rutaMainAhkUsuario);
        const instanciasStop = obtenerInstanciasMuMu();
        const infoMainStop = (instanciasStop || []).find(i => i.name === 'Main');
        if (infoMainStop) apagarInstanciaMuMu(infoMainStop.index);

        cooldownStopTradeInstancia.set(String(index), Date.now() + COOLDOWN_STOP_TRADE_MS);
        return await interaction.followUp({ content: `🛑 Stopped instance **${nombre}** (and Main, if it was running) and closed any scripts running for them. Wait ${COOLDOWN_STOP_TRADE_MS / 1000}s before starting another trade on it.`, ephemeral: true });
    }

    // Boton "Retry" para el flujo de Shinedust (2026-08-03): si algo falla (instancia no
    // prendio, timeout de pantallas de bienvenida, OCR invalido, etc.) el usuario puede
    // reintentar sin tener que volver a navegar el select de cuentas desde cero.
    function botonReintentarShinedust(cartaId, fileName, index, nombre) {
        return new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`shinedust_instancia_retry::${cartaId}::${fileName}::${index}::${nombre}`.slice(0, 100)).setLabel('🔄 Retry').setStyle(ButtonStyle.Secondary)
        );
    }

    async function ejecutarFlujoShinedust(interaction, cartaId, fileName, index, nombre, marcarProgreso = () => {}) {
        marcarProgreso();
        const prendida = await asegurarInstanciaEncendida(index);
        if (!prendida) {
            return await interaction.followUp({ content: `❌ Could not turn on instance **${nombre}**.`, components: [botonReintentarShinedust(cartaId, fileName, index, nombre)] });
        }
        marcarProgreso();

        try { await interaction.followUp({ content: `🛠️ Fixing instance **${nombre}**'s window before injecting...`, ephemeral: true }); } catch (e) { /* interacción puede haber expirado */ }
        await new Promise((resolve) => ejecutarFixInstanceWindow(nombre, () => resolve()));
        marcarProgreso();

        try { await interaction.followUp({ content: `🔄 Injecting \`${fileName}\` into instance **${nombre}**... this may take a couple of minutes.`, ephemeral: true }); } catch (e) { /* interacción puede haber expirado */ }

        const rutaXmlCfg = await db.get(`SELECT webhook_url FROM configs_canales WHERE tipo = 'ruta_xml_cuentas'`);
        const archivo = buscarArchivoXmlPorNombre(rutaXmlCfg?.webhook_url, fileName);
        if (!archivo) {
            return await interaction.followUp({ content: `❌ File \`${fileName}\` not found. Check the configured **XML Accounts Path**.`, components: [botonReintentarShinedust(cartaId, fileName, index, nombre)] });
        }

        const { rutaIni: rutaIniShinedust, rutaScript: rutaScriptShinedust } = await obtenerRutasInject(interaction.user.id);
        try {
            guardarXmlParaInyeccion(nombre, archivo, rutaIniShinedust);
            // Shinedust no manda solicitud de amistad -- pero el ini es compartido con
            // el flujo de Trade, así que si quedó una activada de un uso anterior de
            // "Add Friend" hay que apagarla, o la inyección la dispara igual.
            actualizarIniInject({ sendFriendRequestAfterInject: '0' }, rutaIniShinedust);
        } catch (e) {
            return await interaction.followUp({ content: '❌ Could not save the selection to InjectAccount.ini.', components: [botonReintentarShinedust(cartaId, fileName, index, nombre)] });
        }

        ejecutarInyeccionHeadless(async (ok, detalle) => {
            if (!ok) {
                try { await interaction.followUp({ content: `❌ The injection failed (${detalle}).`, components: [botonReintentarShinedust(cartaId, fileName, index, nombre)] }); } catch (e) { /* interacción puede haber expirado */ }
                return;
            }
            marcarProgreso();

            ejecutarWaitWelcomeScreens(nombre, async (okWelcome, motivoWelcome) => {
                if (!okWelcome) {
                    apagarInstanciaMuMu(index);
                    try { await interaction.followUp({ content: `❌ Could not reach the main menu after injecting (${motivoWelcome}).`, components: [botonReintentarShinedust(cartaId, fileName, index, nombre)] }); } catch (e) { /* interacción puede haber expirado */ }
                    return;
                }
                marcarProgreso();

                try { await interaction.followUp({ content: `🔍 Reading shinedust on instance **${nombre}**...`, ephemeral: true }); } catch (e) { /* interacción puede haber expirado */ }

                ejecutarCountShinedust(nombre, async (okOcr, datosOMotivo) => {
                    marcarProgreso();
                    apagarInstanciaMuMu(index);
                    try {
                        if (!okOcr) {
                            return await interaction.followUp({ content: `❌ Could not read the shinedust value (${datosOMotivo}).`, components: [botonReintentarShinedust(cartaId, fileName, index, nombre)] });
                        }
                        const datos = datosOMotivo;
                        const valorOMotivo = datos.shinedust;

                        // Cache en memoria (2026-08-03) de los datos de inventario ya capturados
                        // para esta cuenta -- si despues el usuario aprieta "Info Accounts" desde
                        // ESTE mismo resultado, se reusan sin volver a inyectar/leer por OCR.
                        cacheDatosInventario.set(fileName, { datos, ts: Date.now() });

                        const rutaMasterCfg = await db.get(`SELECT webhook_url FROM configs_canales WHERE tipo = 'ruta_master'`);
                        const nombreCarta = resolverNombreCarta(cartaId, rutaMasterCfg?.webhook_url);
                        // No importa si se llego aca desde AllCards o desde Gold Cards -- lo
                        // que importa es si ESTA cuenta puntual ya califica como Gold para
                        // ESTA carta puntual. Si es asi, se usa la imagen con borde dorado y
                        // el campo de cuentas, igual que si se hubiera buscado en Gold Cards
                        // directamente (reporte del usuario 2026-07-27: el resultado no
                        // coincidia con la carta dorada que se habia buscado).
                        const { mapaCopias, umbral } = await obtenerCartasGoldCacheadas(interaction.user.id);
                        const cuentasGold = mapaCopias ? cuentasGoldParaCarta(mapaCopias, cartaId, umbral) : [];
                        const esCuentaGold = cuentasGold.some(r => r.fileName.replace(/\.xml$/i, '') === fileName);
                        const datosGold = esCuentaGold ? { cuentas: cuentasGold, umbral } : null;
                        const payload = await construirEmbedDetalleCarta(cartaId, nombreCarta, rutaMasterCfg?.webhook_url, null, interaction.guild, datosGold);
                        // Formato en columna (2026-08-05, a pedido explicito del usuario): el
                        // archivo XML va primero (con su propio emoji), luego Shinedust. El
                        // resto del inventario (Poke Gold, tickets, relojes) NO va aca -- solo
                        // se muestra en Info Accounts; este resultado se queda solo con la
                        // carta + archivo + shinedust, igual de simple que Extract XML.
                        payload.embeds[0].addFields({ name: '📄 Account file', value: `\`${fileName}\`` });
                        payload.embeds[0].addFields({ name: '<:Polvo_iris_TCGP:1534723123914739802> Shinedust', value: `**${valorOMotivo}**` });
                        payload.content = `<@${interaction.user.id}> Account \`${fileName}\` has **${valorOMotivo}** Shinedust.`;
                        // Boton Trade (2026-08-05, a pedido explicito del usuario): antes
                        // usaba su propio atajo (shinedust_result_trade::/
                        // shinedust_result_trade_friendid::, mandaba un select-menu por
                        // webhook aparte) que dejo de responder en vivo -- "Pokedex! didn't
                        // respond in time" al elegir amigo, reproducido en vivo, sin ninguna
                        // excepcion en el log ni con logging agregado a mano. Se cambia para
                        // reusar EXACTAMENTE el mismo customId card_trade:: que ya usa el
                        // flujo normal de /card (probado, funciona) -- vuelve a preguntar la
                        // cuenta (redundante ya que Shinedust la conoce) pero es confiable.
                        payload.components = [new ActionRowBuilder().addComponents(
                            new ButtonBuilder().setCustomId(`card_trade::${cartaId}`.slice(0, 100)).setLabel('🔄 Trade').setStyle(ButtonStyle.Primary),
                            new ButtonBuilder().setCustomId(`shinedust_result_extract::${cartaId}::${fileName}::${valorOMotivo}`.slice(0, 100)).setLabel('📄 Extract XML').setStyle(ButtonStyle.Secondary),
                            new ButtonBuilder().setCustomId(`shinedust_result_info_accounts::${fileName}`.slice(0, 100)).setLabel('📋 Info Accounts').setStyle(ButtonStyle.Secondary)
                        )];

                        const canalShinedust = await obtenerCanalComando(interaction.user.id, 'shinedust');
                        if (canalShinedust?.webhook_url) {
                            try {
                                const webhookShinedust = new WebhookClient({ url: canalShinedust.webhook_url });
                                await webhookShinedust.send(payload);
                            } catch (e) {
                                console.error('DEBUG: error mandando el resultado de Shinedust al canal dedicado:', e?.message || e);
                                await interaction.channel.send(payload);
                            }
                        } else {
                            await interaction.channel.send(payload);
                        }
                        await interaction.followUp({ content: `✅ Shinedust for \`${fileName}\`: **${valorOMotivo}**.`, ephemeral: true });
                    } catch (e) { /* interacción puede haber expirado */ }
                });
            });
        }, rutaScriptShinedust);
    }

    // Supervisor de inactividad (2026-08-03): reporte del usuario -- a veces la instancia
    // prende pero se queda ahí sin que corra ningún AHK (nunca llega ni a "Fixing
    // instance..."), y como nada falla explícitamente, el botón de Retry normal nunca
    // aparece. marcarProgreso() se llama en cada paso real de ejecutarFlujoShinedust; si
    // pasan 90s sin que se llame ninguna, se asume que quedó trabada y se reintenta sola
    // (hasta 3 veces en total, para no quedar reintentando para siempre).
    async function ejecutarFlujoShinedustConSupervisor(interaction, cartaId, fileName, index, nombre, intento = 1) {
        let ultimoProgreso = Date.now();
        let activo = true;
        const marcarProgreso = () => { ultimoProgreso = Date.now(); };

        const watchdog = setInterval(async () => {
            if (!activo || Date.now() - ultimoProgreso < 90000) return;
            activo = false;
            clearInterval(watchdog);

            apagarInstanciaMuMu(index);
            if (intento >= 3) {
                try { await interaction.followUp({ content: `⏱️ Instance **${nombre}** got stuck (no progress for 90s) and already auto-retried ${intento - 1} time(s). Try again manually.`, components: [botonReintentarShinedust(cartaId, fileName, index, nombre)] }); } catch (e) { /* interacción puede haber expirado */ }
                return;
            }
            try { await interaction.followUp({ content: `⏱️ Instance **${nombre}** got stuck (no progress for 90s) -- retrying automatically...`, ephemeral: true }); } catch (e) { /* interacción puede haber expirado */ }
            await ejecutarFlujoShinedustConSupervisor(interaction, cartaId, fileName, index, nombre, intento + 1);
        }, 5000);

        try {
            await ejecutarFlujoShinedust(interaction, cartaId, fileName, index, nombre, marcarProgreso);
        } finally {
            activo = false;
            clearInterval(watchdog);
        }
    }

    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('shinedust_instancia::')) {
        const [, cartaId, fileName] = interaction.customId.split('::');
        const [index, nombre] = interaction.values[0].split('::');
        await interaction.update({ content: `🟢 Turning on instance **${nombre}**...`, components: [] });
        await ejecutarFlujoShinedustConSupervisor(interaction, cartaId, fileName, index, nombre);
        return;
    }

    if (interaction.isButton() && interaction.customId.startsWith('shinedust_instancia_retry::')) {
        const [, cartaId, fileName, index, nombre] = interaction.customId.split('::');
        await interaction.update({ content: `🟢 Turning on instance **${nombre}**...`, components: [] });
        await ejecutarFlujoShinedustConSupervisor(interaction, cartaId, fileName, index, nombre);
        return;
    }

    if (interaction.isChannelSelectMenu() || (interaction.isStringSelectMenu() && interaction.customId === 'select_reset_modulo')) {
        if (!tienePermisosGestion(interaction)) {
            return await interaction.reply({ content: "❌ You don't have permission to change the bot's settings.", ephemeral: true });
        }
        return await configScript.manejarMenuCanales(interaction);
    }

    if (interaction.isButton()) {
        if (['panel_wishlist', 'panel_allcards', 'panel_goldcards', 'panel_extract_xml', 'panel_run_instance'].includes(interaction.customId)) {
            const commandKey = { panel_wishlist: 'card_wishlist', panel_allcards: 'card_all', panel_goldcards: 'card_gold', panel_extract_xml: 'extract_xlm', panel_run_instance: 'run_instance' }[interaction.customId];
            const cfg = COMANDO_CONFIG[commandKey];
            const row = await obtenerCanalComando(interaction.user.id, cfg.tipo);

            if (!row) {
                return await interaction.reply({ content: `❌ No channel synced for **${cfg.label}**. Use **Sync Channels** first.`, ephemeral: true });
            }

            await interaction.deferReply({ ephemeral: true });
            try {
                await enviarComandoAlCanal(commandKey, interaction.user, row, false, interaction.guild);
                const filaIr = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setLabel('➡️ Go to channel').setStyle(ButtonStyle.Link).setURL(`https://discord.com/channels/${interaction.guildId}/${row.canal_id}`)
                );
                return await interaction.editReply({ content: `✅ **${cfg.label}** sent to <#${row.canal_id}>.`, components: [filaIr] });
            } catch (error) {
                console.error(`Error enviando ${commandKey}:`, error?.response?.data || error?.message || error);
                return await interaction.editReply({ content: `❌ Could not send **${cfg.label}**.` });
            }
        }

        if (interaction.customId === 'allcards_ver_expansiones') {
            // Pública (no ephemeral): toda esta navegación (expansión › categoría
            // › carta) se encadena editando esta misma respuesta — si arranca
            // ephemeral, se queda ephemeral para siempre y solo se ve en el
            // dispositivo que estaba conectado en el momento del click.
            await interaction.deferReply();
            const { cartas } = await FUENTES_CARTAS.allcards.obtenerCartas();
            if (cartas === null) {
                return await interaction.editReply({ content: FUENTES_CARTAS.allcards.errorSinDatos });
            }
            const payload = construirEmbedResumenExpansiones(cartas, { prefijo: 'allcards' });
            return await interaction.editReply(payload);
        }

        if (interaction.customId === 'goldcards_ver_expansiones') {
            // Misma logica que allcards_ver_expansiones -- publica por el mismo motivo.
            await interaction.deferReply();
            if (!GOOGLE_DRIVE_API_KEY_BOT) {
                return await interaction.editReply(advertenciaGoldSinApi());
            }
            const { cartas } = await FUENTES_CARTAS.goldcards.obtenerCartas(interaction.user.id);
            if (cartas === null) {
                return await interaction.editReply({ content: FUENTES_CARTAS.goldcards.errorSinDatos });
            }
            if (!cartas.length) {
                return await interaction.editReply({ content: FUENTES_CARTAS.goldcards.vacioTexto });
            }
            const payload = construirEmbedResumenExpansiones(cartas, { prefijo: 'goldcards' });
            return await interaction.editReply(payload);
        }

        if (/^(wishlist|allcards)_ver$/.test(interaction.customId) || /^(wishlist|allcards)_pagina_-?\d+$/.test(interaction.customId)) {
            const prefijo = prefijoDeCartas(interaction.customId);
            const fuente = FUENTES_CARTAS[prefijo];
            const esPrimeraVez = interaction.customId === `${prefijo}_ver`;
            const pagina = esPrimeraVez ? 0 : (parseInt(interaction.customId.replace(`${prefijo}_pagina_`, ''), 10) || 0);

            const { cartas } = await fuente.obtenerCartas(interaction.user.id);

            if (cartas === null) {
                if (esPrimeraVez) return await interaction.reply({ content: fuente.errorSinDatos });
                return await interaction.update({ content: fuente.errorSinDatos, embeds: [], components: [] });
            }

            const mapaEmojis = await obtenerMapaEmojisGuild(interaction.guild);
            const payload = construirEmbedListaCartas(cartas, pagina, { prefijo, titulo: fuente.tituloLista, vacioTexto: fuente.vacioTexto, mapaEmojis });
            // Pública, mismo motivo que en allcards_ver_expansiones.
            if (esPrimeraVez) return await interaction.reply({ ...payload });
            return await interaction.update(payload);
        }

        if (interaction.customId.startsWith('wishlist_expansion_pagina_') || interaction.customId.startsWith('allcards_expansion_pagina_') || interaction.customId.startsWith('goldcards_expansion_pagina_')) {
            await interaction.deferUpdate();
            const prefijo = prefijoDeCartas(interaction.customId);
            const fuente = FUENTES_CARTAS[prefijo];
            const resto = interaction.customId.replace(`${prefijo}_expansion_pagina_`, '');
            const [paginaTexto, expansion, categoria] = resto.split('::');
            const pagina = parseInt(paginaTexto, 10) || 0;

            const { cartas, rutaMasterPath, mapaCopias } = await fuente.obtenerCartas(interaction.user.id);
            const mapaEmojisPagina = await obtenerMapaEmojisGuild(interaction.guild);
            const payload = await construirEmbedCartasPorExpansion(cartas || [], expansion, categoria, pagina, { prefijo, contexto: fuente.contexto, mapaEmojis: mapaEmojisPagina, rutaMasterPath, mapaCopias });
            return await interaction.editReply(payload);
        }

        if (interaction.customId.startsWith('wishlist_volver_categorias::') || interaction.customId.startsWith('allcards_volver_categorias::') || interaction.customId.startsWith('goldcards_volver_categorias::')) {
            await interaction.deferUpdate();
            const prefijo = prefijoDeCartas(interaction.customId);
            const fuente = FUENTES_CARTAS[prefijo];
            const expansion = interaction.customId.replace(`${prefijo}_volver_categorias::`, '');
            const { cartas } = await fuente.obtenerCartas(interaction.user.id);
            const mapaEmojisVolver = await obtenerMapaEmojisGuild(interaction.guild);
            const payload = construirEmbedCategoriasPorExpansion(cartas || [], expansion, { prefijo, contexto: fuente.contexto, mapaEmojis: mapaEmojisVolver });
            return await interaction.editReply(payload);
        }

        if (interaction.customId === 'wishlist_volver_expansiones' || interaction.customId === 'allcards_volver_expansiones' || interaction.customId === 'goldcards_volver_expansiones') {
            await interaction.deferUpdate();
            const prefijo = prefijoDeCartas(interaction.customId);
            const fuente = FUENTES_CARTAS[prefijo];
            const { cartas } = await fuente.obtenerCartas(interaction.user.id);
            const mapaEmojisExpansiones = await obtenerMapaEmojisGuild(interaction.guild);
            const payload = (prefijo === 'allcards' || prefijo === 'goldcards')
                ? construirEmbedResumenExpansiones(cartas || [], { prefijo })
                : construirEmbedListaCartas(cartas || [], 0, { prefijo, titulo: fuente.tituloLista, vacioTexto: fuente.vacioTexto, mapaEmojis: mapaEmojisExpansiones });
            return await interaction.editReply(payload);
        }

        if (interaction.customId.startsWith('tutorial_pdf::')) {
            const [, tipo] = interaction.customId.split('::');
            const ruta = rutaTutorialPdf(tipo);
            if (!fs.existsSync(ruta)) {
                return await interaction.reply({ content: '❌ No tutorial available for this channel yet.', ephemeral: true });
            }
            return await interaction.reply({ files: [new AttachmentBuilder(ruta, { name: nombreTutorialDescarga(tipo) })], ephemeral: true });
        }

        if (interaction.customId === 'extract_xml_abrir') {
            const modalExtract = new ModalBuilder().setCustomId('modal_extract_xml').setTitle('Extract XML')
                .addComponents(new ActionRowBuilder().addComponents(
                    new TextInputBuilder().setCustomId('input_xml_nombre').setLabel('XML file name').setStyle(TextInputStyle.Short)
                ));
            return await interaction.showModal(modalExtract);
        }

        if (interaction.customId.startsWith('heartbeat_reload_ahk::')) {
            // Botón del aviso de heartbeat cuando una instancia lleva varios
            // minutos sin abrir sobres Y el log local NO dice "sin cuentas" —
            // el usuario aclaró que en ese caso lo que se congela es el AHK,
            // no necesariamente MuMu, así que hay que recargar el script (el
            // mismo Reload/Shift+F5 que ya tiene) en vez de reiniciar MuMu.
            if (!tienePermisosGestion(interaction)) {
                return await interaction.reply({ content: "❌ You don't have permission to run control actions.", ephemeral: true });
            }
            const index = interaction.customId.split('::')[1];
            await interaction.deferUpdate();
            const ok = ejecutarAccionAhkInstancia(index, 'reload');
            if (ok) {
                // A pedido del usuario: una vez reparada, el aviso se borra
                // solo — si no, se van acumulando y terminan enterrando el
                // panel principal de heartbeat (que se edita in situ, en su
                // posición original, y no se reubica solo como los paneles de
                // comando).
                return await interaction.deleteReply().catch(() => {});
            }
            const embedOriginal = interaction.message?.embeds?.[0];
            const embedActualizado = embedOriginal ? EmbedBuilder.from(embedOriginal) : new EmbedBuilder();
            embedActualizado.setColor(0xE74C3C);
            embedActualizado.setDescription(
                `❌ Could not reload the AHK for **Instance ${index}** — its window wasn't found (maybe it's already closed).\n\n${embedOriginal?.description || ''}`
            );
            return await interaction.editReply({ embeds: [embedActualizado] });
        }

        if (interaction.customId.startsWith('heartbeat_cerrar::')) {
            // Botón del aviso de heartbeat cuando el log local de la instancia
            // dice que ya no le quedan cuentas de 24h elegibles — no tiene
            // sentido dejarla prendida consumiendo recursos, así que cierra
            // MuMu Y el AHK de esa instancia puntual.
            if (!tienePermisosGestion(interaction)) {
                return await interaction.reply({ content: "❌ You don't have permission to run control actions.", ephemeral: true });
            }
            const index = interaction.customId.split('::')[1];
            await interaction.deferUpdate();
            const mumuOk = apagarInstanciaMuMu(index);
            const ahkOk = ejecutarAccionAhkInstancia(index, 'close');
            // Si el AHK quedó realmente colgado por dentro (no solo esperando
            // cuentas), la señal 0x500 se queda en cola y el script no la
            // procesa hasta que "respira" de nuevo — confirmado en vivo que
            // reabrir el MuMu lo destraba (probablemente por el fallo de ADB
            // al reconectar). Por eso, como respaldo, reabrimos y volvemos a
            // cerrar el MuMu unos segundos después: si el AHK ya cerró solo
            // esto no hace nada malo (solo prende y apaga MuMu de nuevo), y si
            // seguía colgado, esto lo fuerza a cerrar también.
            setTimeout(() => {
                lanzarInstanciaMuMu(index);
                setTimeout(() => {
                    apagarInstanciaMuMu(index);
                }, 15000);
            }, 20000);
            if (mumuOk || ahkOk) {
                return await interaction.deleteReply().catch(() => {});
            }
            const embedOriginal = interaction.message?.embeds?.[0];
            const embedActualizado = embedOriginal ? EmbedBuilder.from(embedOriginal) : new EmbedBuilder();
            embedActualizado.setColor(0xE74C3C);
            embedActualizado.setDescription(
                `❌ Could not close **Instance ${index}** — MuMuManager.exe not found and its AHK window wasn't found either.\n\n${embedOriginal?.description || ''}`
            );
            return await interaction.editReply({ embeds: [embedActualizado] });
        }

        if (interaction.customId === 'mumu_ver_instancias') {
            // Removido a pedido explicito del usuario 2026-07-30: dejaba elegir y
            // prender cualquier instancia a mano, y de ahi seguir el flujo manual
            // de amigo/cuenta -- un usuario cualquiera pudo activarlo. Reemplazado
            // por el boton automatico 🔄 Trade en las cartas. Se mantiene el
            // handler (en vez de borrarlo) por si queda un mensaje viejo con este
            // boton todavia dando vueltas en algun canal.
            return await interaction.reply({ content: '⚠️ This option is no longer available - trades now run automatically from the 🔄 Trade button on a card lookup (/card, /wishlist, Gold Cards).', ephemeral: true });
        }

        if (interaction.customId === 'mumu_refrescar' || interaction.customId.startsWith('mumu_refrescar::')) {
            await interaction.deferUpdate();
            const partes = interaction.customId.split('::');
            const index = partes[1];
            const nombre = partes[2];
            const instancias = obtenerInstanciasMuMu();
            if (instancias === null) {
                return await interaction.editReply({ content: '❌ MuMuManager.exe not found. Check that MuMuPlayer is installed.', embeds: [], components: [] });
            }
            const instanciaInfo = index ? instancias.find(i => String(i.index) === String(index)) : null;
            const seleccion = index ? { index, name: nombre, encendida: !!instanciaInfo?.is_android_started } : null;
            return await interaction.editReply(construirEmbedInstanciasMuMu(instancias, seleccion));
        }

        if (interaction.customId.startsWith('mumu_encender_')) {
            const [index, nombre] = interaction.customId.replace('mumu_encender_', '').split('::');
            await interaction.deferUpdate();

            // El usuario pidió limitar esto a una sola instancia prendida a la
            // vez — tener varias abiertas al mismo tiempo "se altera" (la
            // automatización de clicks/coordenadas no está pensada para correr
            // contra más de una instancia en simultáneo). "Main" queda exenta
            // de esta restricción a pedido explícito del usuario: sí se puede
            // prender aunque haya otra instancia ya encendida.
            const esMain = nombre.trim().toLowerCase() === 'main';
            const instanciasActuales = obtenerInstanciasMuMu();
            const otraEncendida = !esMain && instanciasActuales?.find(i => String(i.index) !== String(index) && i.is_android_started);
            if (otraEncendida) {
                const payloadBloqueado = construirEmbedInstanciasMuMu(instanciasActuales, { index, name: nombre, encendida: false });
                const embedBloqueado = payloadBloqueado.embeds[0];
                embedBloqueado.setDescription(`⚠️ **${otraEncendida.name}** (instance ${otraEncendida.index}) is already on. Turn it off before opening another one.\n\n${embedBloqueado.data.description}`);
                return await interaction.editReply(payloadBloqueado);
            }

            const ok = lanzarInstanciaMuMu(index);

            // Launch solo pide a MuMu que arranque — el sistema Android adentro tarda
            // varios segundos más en terminar de bootear. Chequear el estado apenas
            // se manda el launch siempre da "Off" (MuMu ya abrió la ventana, pero
            // is_android_started todavía no). Se espera en un loop en vez de mirar
            // una sola vez, hasta 40s (típico de un boot normal de esta instancia).
            let instancias = null;
            let instanciaInfo = null;
            for (let intento = 0; intento < 20; intento++) {
                await new Promise((resolve) => setTimeout(resolve, 2000));
                instancias = obtenerInstanciasMuMu();
                if (instancias === null) break;
                instanciaInfo = instancias.find(i => String(i.index) === String(index));
                if (instanciaInfo?.is_android_started) break;
            }

            if (instancias === null) {
                return await interaction.editReply({ content: '❌ MuMuManager.exe not found. Check that MuMuPlayer is installed.', embeds: [], components: [] });
            }
            const payload = construirEmbedInstanciasMuMu(instancias, { index, name: nombre, encendida: ok && !!instanciaInfo?.is_android_started });
            return await interaction.editReply(payload);
        }

        if (interaction.customId === 'setup_add_friend') {
            const modalFriend = new ModalBuilder().setCustomId('modal_setup_friendid').setTitle('Add Friend (max. 10)')
                .addComponents(
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder().setCustomId('input_friend_nombre').setLabel('Name').setStyle(TextInputStyle.Short).setRequired(false)
                    ),
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder().setCustomId('input_friend_id').setLabel('Friend ID (16 digits)').setStyle(TextInputStyle.Short).setMinLength(16).setMaxLength(16)
                    )
                );
            return await interaction.showModal(modalFriend);
        }

        if (interaction.customId.startsWith('mumu_friendid_')) {
            const [index, nombre] = interaction.customId.replace('mumu_friendid_', '').split('::');
            const modalFriend = new ModalBuilder().setCustomId(`modal_mumu_friendid::${index}::${nombre}`).setTitle('Add Friend (max. 10)')
                .addComponents(
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder().setCustomId('input_friend_nombre').setLabel('Name').setStyle(TextInputStyle.Short).setRequired(false)
                    ),
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder().setCustomId('input_friend_id').setLabel('Friend ID (16 digits)').setStyle(TextInputStyle.Short).setMinLength(16).setMaxLength(16)
                    )
                );
            return await interaction.showModal(modalFriend);
        }

        if (interaction.customId.startsWith('mumu_ejecutar_')) {
            const [index, nombre] = interaction.customId.replace('mumu_ejecutar_', '').split('::');
            await interaction.deferReply({ ephemeral: true });

            const { rutaIni: rutaIniEjecutar, rutaScript: rutaScriptEjecutar } = await obtenerRutasInject(interaction.user.id);
            const datosIni = leerIniInject(rutaIniEjecutar);
            if ((datosIni.winTitle || '').trim() !== nombre || !(datosIni.selectedFilePath || '').trim()) {
                return await interaction.editReply({ content: `❌ First select the XML with the 💠 XML button for instance **${nombre}**.` });
            }

            await interaction.editReply({ content: `🔄 Running injection on instance **${nombre}**... this WILL CLOSE the current session and may take several minutes.` });

            ejecutarInyeccionHeadless(async (ok, detalle) => {
                try {
                    if (!ok) {
                        return await interaction.followUp({ content: `❌ The injection failed (${detalle}).`, ephemeral: true });
                    }
                    const filaNext = new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId(`mumu_nexttrade_${index}::${nombre}`).setLabel('▶️ Next Trade').setStyle(ButtonStyle.Success)
                    );
                    await interaction.followUp({
                        content: `✅ Injection completed on instance **${nombre}**.\n\nOnce your friend has accepted the request, press **▶️ Next Trade** to offer them the card from their wishlist.`,
                        components: [filaNext],
                        ephemeral: true
                    });
                } catch (e) {}
            }, rutaScriptEjecutar);
            return;
        }

        if (interaction.customId.startsWith('mumu_nexttrade_')) {
            const [index, nombre] = interaction.customId.replace('mumu_nexttrade_', '').split('::');
            await interaction.deferReply({ ephemeral: true });
            await interaction.editReply({ content: `🔄 Offering the wishlist card to your friend on instance **${nombre}**...` });

            ejecutarSendTradeCard(nombre, async (ok, detalle) => {
                try {
                    if (!ok) {
                        return await interaction.followUp({ content: `❌ Could not offer the card (${detalle}). Check that your friend has already accepted and is available in "Select a Friend".`, ephemeral: true });
                    }
                    const filaFinalize = new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId(`mumu_finalizetrade_${index}::${nombre}`).setLabel('🔄 Finalize Trade').setStyle(ButtonStyle.Success)
                    );
                    await interaction.followUp({
                        content: `✅ Card offered on instance **${nombre}**, waiting for your partner's response.\n\nOnce your friend has offered their card, press **🔄 Finalize Trade**.`,
                        components: [filaFinalize],
                        ephemeral: true
                    });
                } catch (e) {}
            });
            return;
        }

        if (interaction.customId.startsWith('mumu_finalizetrade_')) {
            const [index, nombre] = interaction.customId.replace('mumu_finalizetrade_', '').split('::');
            await interaction.deferReply({ ephemeral: true });
            await interaction.editReply({ content: `🔄 Finalizing the trade on instance **${nombre}**... the instance will shut down when done.` });

            ejecutarFinalizeTradeCard(nombre, index, async (ok, detalle) => {
                try {
                    await interaction.followUp({
                        content: ok
                            ? `✅ Trade finalized on instance **${nombre}**. The instance is shutting down.`
                            : `❌ Could not finalize the trade (${detalle}).`,
                        ephemeral: true
                    });
                } catch (e) {}
            });
            return;
        }

        if (interaction.customId.startsWith('mumu_status_')) {
            const [index, nombre] = interaction.customId.replace('mumu_status_', '').split('::');
            const { rutaIni: rutaIniStatus } = await obtenerRutasInject(interaction.user.id);
            const payload = construirEmbedStatusInstancia(index, nombre, rutaIniStatus);
            return await interaction.reply({ ...payload, ephemeral: true });
        }

        if (interaction.customId.startsWith('mumu_xml_')) {
            const [index, nombre] = interaction.customId.replace('mumu_xml_', '').split('::');
            const modalXml = new ModalBuilder().setCustomId(`modal_mumu_xml::${index}::${nombre}`).setTitle('Prepare XML Injection')
                .addComponents(new ActionRowBuilder().addComponents(
                    new TextInputBuilder().setCustomId('input_xml_nombre').setLabel('XML file name').setStyle(TextInputStyle.Short)
                ));
            return await interaction.showModal(modalXml);
        }

        // Antes esto saltaba directo a elegir cuenta (flujo "friend": inyecta +
        // manda solicitud, el usuario acepta y completa el trade a mano). A
        // pedido explicito del usuario 2026-07-27, ahora primero se elige el
        // MODO de trade -- la logica vieja se movio intacta a card_trade_friend::.
        // A pedido explicito del usuario 2026-07-28: esto ya NO responde en el
        // canal donde se buscó la carta -- reenvía la carta completa (misma
        // imagen/embed) al canal de Trading con los 3 botones de modo, y todo
        // lo que sigue pasa ahí (ver reenviarCartaATrading).
        if (interaction.customId.startsWith('card_trade::')) {
            const cartaId = interaction.customId.replace('card_trade::', '');
            await interaction.deferReply({ ephemeral: true }); // armar la carta puede tardar más de 3s
            const fila = new ActionRowBuilder().addComponents(
                // Deshabilitado a pedido explicito del usuario 2026-08-06.
                new ButtonBuilder().setCustomId(`card_trade_friend::${cartaId}`).setLabel('🤝 Friend Trade').setStyle(ButtonStyle.Secondary).setDisabled(true),
                new ButtonBuilder().setCustomId(`card_trade_main::${cartaId}`).setLabel('🏠 Main Trade').setStyle(ButtonStyle.Primary),
                // Deshabilitado a pedido explicito del usuario 2026-07-29: todavia no
                // esta implementado, se libera en un release futuro.
                new ButtonBuilder().setCustomId(`card_trade_agresivo::${cartaId}`).setLabel('⚡ Aggressive Trade — Coming Soon').setStyle(ButtonStyle.Danger).setDisabled(true)
            );
            return await reenviarCartaATrading(interaction, cartaId, null, [fila]);
        }

        // Ya parado en el mensaje del canal de Trading (interaction.message es
        // el que reenviarCartaATrading acaba de mandar) -- edita ese mismo
        // mensaje para pedir el amigo, no crea nada nuevo en otro canal.
        if (interaction.customId.startsWith('card_trade_friend::')) {
            const cartaId = interaction.customId.replace('card_trade_friend::', '');
            await interaction.deferUpdate();
            return await actualizarConSeleccionFriendId(interaction, cartaId, 'normal', 'friend');
        }

        // Tradeo main y agresivo -- todavia en construccion (ver ejecutarTradeoMain,
        // que va a automatizar de punta a punta el ciclo mapeado en vivo: inyectar,
        // agregar amistad, proponer, esperar respuesta, aceptar, deslizar). Por
        // ahora solo confirman que el boton llega bien, editando el mismo
        // mensaje del canal de Trading, sin ejecutar nada real todavía.
        if (interaction.customId.startsWith('card_trade_main::')) {
            const cartaId = interaction.customId.replace('card_trade_main::', '');
            await interaction.deferUpdate();
            return await actualizarConSeleccionFriendId(interaction, cartaId, 'normal', 'main');
        }

        if (interaction.customId.startsWith('card_trade_agresivo::')) {
            const cartaId = interaction.customId.replace('card_trade_agresivo::', '');
            return await interaction.update({ content: `🚧 Aggressive Trade for \`${cartaId}\` is still being built -- coming soon.`, components: [] });
        }

        if (interaction.customId.startsWith('goldcards_trade::')) {
            // Entrada separada de card_trade:: (a pedido explicito del usuario
            // 2026-07-27) -- solo lista cuentas ya calificadas como Gold, no
            // "cualquier cuenta con al menos 1 copia". Gold Cards no tiene los 3
            // modos todavía (solo el equivalente a Friend Trade) -- reenvía la
            // carta al canal de Trading ya directo con el selector de amigo.
            const cartaId = interaction.customId.replace('goldcards_trade::', '');
            await interaction.deferReply({ ephemeral: true }); // obtenerCartasGoldCacheadas + armar la carta pueden tardar más de 3s
            const { rutaIni } = await obtenerRutasInject(interaction.user.id);
            const friends = parsearListaFriends(rutaIni);
            if (!friends.length) {
                return await interaction.editReply({ content: '❌ You don\'t have any saved friends yet. Add one first from **🆔 Add Friend** in /setup.' });
            }
            const { mapaCopias, umbral } = await obtenerCartasGoldCacheadas(interaction.user.id);
            const datosGold = mapaCopias ? { cuentas: cuentasGoldParaCarta(mapaCopias, cartaId, umbral), umbral } : null;
            const menu = new StringSelectMenuBuilder()
                .setCustomId(`card_trade_friendid::gold::friend::${cartaId}`.slice(0, 100))
                .setPlaceholder('Select which friend to send the request to')
                .addOptions(friends.slice(0, 25).map(f => ({
                    label: `${f.label || '(no name)'} — ${f.id}`.slice(0, 100),
                    value: f.id
                })));
            return await reenviarCartaATrading(interaction, cartaId, datosGold, [new ActionRowBuilder().addComponents(menu)]);
        }

        if (interaction.customId.startsWith('goldcards_shinedust::')) {
            // Misma idea que goldcards_trade:: -- entrada separada, comparte el
            // customId de seleccion (card_shinedust_cuenta::) con el flujo normal.
            const cartaId = interaction.customId.replace('goldcards_shinedust::', '');
            await interaction.deferReply({ ephemeral: true });

            const { mapaCopias, umbral } = await obtenerCartasGoldCacheadas(interaction.user.id);
            const resultados = mapaCopias ? cuentasGoldParaCarta(mapaCopias, cartaId, umbral) : null;
            if (resultados === null) {
                return await interaction.editReply({ content: '❌ Could not find the configured **JSON Accounts Path** folder.' });
            }
            if (!resultados.length) {
                return await interaction.editReply({ content: `❌ No account has ${umbral}+ copies of this card.` });
            }

            const fileNames = resultados.map(r => r.fileName.replace(/\.xml$/i, ''));
            return await interaction.editReply(construirSelectXmlPaginado(fileNames, cartaId, 0, 'card_shinedust_cuenta'));
        }

        if (interaction.customId === 'goldcards_umbral') {
            const umbralActual = await obtenerUmbralGold(interaction.user.id);
            const modalUmbral = new ModalBuilder().setCustomId('modal_goldcards_umbral').setTitle('Gold Cards Threshold')
                .addComponents(new ActionRowBuilder().addComponents(
                    new TextInputBuilder().setCustomId('input_umbral').setLabel('Minimum copies to count as Gold').setStyle(TextInputStyle.Short).setValue(String(umbralActual)).setPlaceholder('10')
                ));
            return await interaction.showModal(modalUmbral);
        }

        if (interaction.customId.startsWith('card_shinedust::')) {
            // Fix 2026-07-29: antes listaba TODAS las cuentas (sin relacion con
            // la carta) -- reporte del usuario, salian 1196 cuentas
            // random). Ahora usa la misma busqueda que ya usa el boton XML/Trade
            // (buscarXmlPorCarta), asi solo aparecen las cuentas que realmente
            // tienen esta carta -- aplica igual en All Cards y Wishlist, que
            // comparten este mismo handler.
            const cartaId = interaction.customId.replace('card_shinedust::', '');
            await interaction.deferReply({ ephemeral: true });

            const rutaJsonCfg = await db.get(`SELECT webhook_url FROM configs_canales WHERE tipo = 'ruta_json_cuentas'`);
            const resultados = buscarXmlPorCarta(rutaJsonCfg?.webhook_url, cartaId);
            if (resultados === null) {
                return await interaction.editReply({ content: '❌ Could not find the configured **JSON Accounts Path** folder.' });
            }
            if (!resultados.length) {
                return await interaction.editReply({ content: '❌ No account has this card.' });
            }

            const fileNames = resultados.map(r => r.fileName.replace(/\.xml$/i, ''));
            return await interaction.editReply(construirSelectXmlPaginado(fileNames, cartaId, 0, 'card_shinedust_cuenta'));
        }

        if (interaction.customId.startsWith('card_shinedust_cuenta_pag::')) {
            const [, cartaId, paginaTexto] = interaction.customId.split('::');
            const rutaJsonCfg = await db.get(`SELECT webhook_url FROM configs_canales WHERE tipo = 'ruta_json_cuentas'`);
            const resultados = buscarXmlPorCarta(rutaJsonCfg?.webhook_url, cartaId) || [];
            const fileNames = resultados.map(r => r.fileName.replace(/\.xml$/i, ''));
            return await interaction.update(construirSelectXmlPaginado(fileNames, cartaId, parseInt(paginaTexto, 10) || 0, 'card_shinedust_cuenta'));
        }

        if (interaction.customId.startsWith('goldcards_extract::')) {
            // Misma idea que goldcards_shinedust:: -- entrada separada, comparte el
            // customId de seleccion (card_extract_cuenta::) con el flujo normal.
            const cartaId = interaction.customId.replace('goldcards_extract::', '');
            await interaction.deferReply({ ephemeral: true });

            const { mapaCopias, umbral } = await obtenerCartasGoldCacheadas(interaction.user.id);
            const resultados = mapaCopias ? cuentasGoldParaCarta(mapaCopias, cartaId, umbral) : null;
            if (resultados === null) {
                return await interaction.editReply({ content: '❌ Could not find the configured **JSON Accounts Path** folder.' });
            }
            if (!resultados.length) {
                return await interaction.editReply({ content: `❌ No account has ${umbral}+ copies of this card.` });
            }

            const fileNames = resultados.map(r => r.fileName.replace(/\.xml$/i, ''));
            return await interaction.editReply(construirSelectXmlPaginado(fileNames, cartaId, 0, 'card_extract_cuenta'));
        }

        if (interaction.customId.startsWith('card_extract::')) {
            // Mismo patron que card_shinedust:: (fix 2026-07-29): la lista de
            // cuentas ya sale filtrada por buscarXmlPorCarta, no "todas las cuentas".
            const cartaId = interaction.customId.replace('card_extract::', '');
            await interaction.deferReply({ ephemeral: true });

            const rutaJsonCfg = await db.get(`SELECT webhook_url FROM configs_canales WHERE tipo = 'ruta_json_cuentas'`);
            const resultados = buscarXmlPorCarta(rutaJsonCfg?.webhook_url, cartaId);
            if (resultados === null) {
                return await interaction.editReply({ content: '❌ Could not find the configured **JSON Accounts Path** folder.' });
            }
            if (!resultados.length) {
                return await interaction.editReply({ content: '❌ No account has this card.' });
            }

            const fileNames = resultados.map(r => r.fileName.replace(/\.xml$/i, ''));
            return await interaction.editReply(construirSelectXmlPaginado(fileNames, cartaId, 0, 'card_extract_cuenta'));
        }

        // Atajo directo a Info Accounts desde el detalle de carta (a pedido
        // explicito del usuario 2026-07-31) -- mismo selector de cuenta que
        // Extract XML, pero con su propio customId de seleccion
        // (card_info_accounts_cuenta::) para que termine en el handler de abajo.
        if (interaction.customId.startsWith('goldcards_info_accounts::')) {
            const cartaId = interaction.customId.replace('goldcards_info_accounts::', '');
            await interaction.deferReply({ ephemeral: true });

            const { mapaCopias, umbral } = await obtenerCartasGoldCacheadas(interaction.user.id);
            const resultados = mapaCopias ? cuentasGoldParaCarta(mapaCopias, cartaId, umbral) : null;
            if (resultados === null) {
                return await interaction.editReply({ content: '❌ Could not find the configured **JSON Accounts Path** folder.' });
            }
            if (!resultados.length) {
                return await interaction.editReply({ content: `❌ No account has ${umbral}+ copies of this card.` });
            }

            const fileNames = resultados.map(r => r.fileName.replace(/\.xml$/i, ''));
            return await interaction.editReply(construirSelectXmlPaginado(fileNames, cartaId, 0, 'card_info_accounts_cuenta'));
        }

        if (interaction.customId.startsWith('card_info_accounts::')) {
            const cartaId = interaction.customId.replace('card_info_accounts::', '');
            await interaction.deferReply({ ephemeral: true });

            const rutaJsonCfg = await db.get(`SELECT webhook_url FROM configs_canales WHERE tipo = 'ruta_json_cuentas'`);
            const resultados = buscarXmlPorCarta(rutaJsonCfg?.webhook_url, cartaId);
            if (resultados === null) {
                return await interaction.editReply({ content: '❌ Could not find the configured **JSON Accounts Path** folder.' });
            }
            if (!resultados.length) {
                return await interaction.editReply({ content: '❌ No account has this card.' });
            }

            const fileNames = resultados.map(r => r.fileName.replace(/\.xml$/i, ''));
            return await interaction.editReply(construirSelectXmlPaginado(fileNames, cartaId, 0, 'card_info_accounts_cuenta'));
        }

        if (interaction.customId.startsWith('card_extract_cuenta_pag::')) {
            // Mismo criterio que card_shinedust_cuenta_pag:: (paginacion comparte
            // prefijo entre el origen gold y el normal, asi que reconsulta siempre
            // con buscarXmlPorCarta).
            const [, cartaId, paginaTexto] = interaction.customId.split('::');
            const rutaJsonCfg = await db.get(`SELECT webhook_url FROM configs_canales WHERE tipo = 'ruta_json_cuentas'`);
            const resultados = buscarXmlPorCarta(rutaJsonCfg?.webhook_url, cartaId) || [];
            const fileNames = resultados.map(r => r.fileName.replace(/\.xml$/i, ''));
            return await interaction.update(construirSelectXmlPaginado(fileNames, cartaId, parseInt(paginaTexto, 10) || 0, 'card_extract_cuenta'));
        }

        if (interaction.customId.startsWith('card_info_accounts_cuenta_pag::')) {
            const [, cartaId, paginaTexto] = interaction.customId.split('::');
            const rutaJsonCfg = await db.get(`SELECT webhook_url FROM configs_canales WHERE tipo = 'ruta_json_cuentas'`);
            const resultados = buscarXmlPorCarta(rutaJsonCfg?.webhook_url, cartaId) || [];
            const fileNames = resultados.map(r => r.fileName.replace(/\.xml$/i, ''));
            return await interaction.update(construirSelectXmlPaginado(fileNames, cartaId, parseInt(paginaTexto, 10) || 0, 'card_info_accounts_cuenta'));
        }

        if (interaction.customId.startsWith('shinedust_result_extract::')) {
            const [, cartaId, fileName, valorShinedust] = interaction.customId.split('::');
            await interaction.deferReply({ ephemeral: true });

            const rutaXmlCfg = await db.get(`SELECT webhook_url FROM configs_canales WHERE tipo = 'ruta_xml_cuentas'`);
            const archivo = buscarArchivoXmlPorNombre(rutaXmlCfg?.webhook_url, fileName);
            if (!archivo) {
                return await interaction.editReply({ content: `❌ File \`${fileName}\` not found. Check the configured **XML Accounts Path**.` });
            }

            const rutaMasterCfg = await db.get(`SELECT webhook_url FROM configs_canales WHERE tipo = 'ruta_master'`);
            const nombreCarta = resolverNombreCarta(cartaId, rutaMasterCfg?.webhook_url);
            // Mismo criterio que en el resultado de Shinedust: si ESTA cuenta ya
            // califica como Gold para ESTA carta, usar la imagen/campo dorado, sin
            // importar de que canal vino el click.
            const { mapaCopias, umbral } = await obtenerCartasGoldCacheadas(interaction.user.id);
            const cuentasGold = mapaCopias ? cuentasGoldParaCarta(mapaCopias, cartaId, umbral) : [];
            const esCuentaGold = cuentasGold.some(r => r.fileName.replace(/\.xml$/i, '') === fileName);
            const datosGold = esCuentaGold ? { cuentas: cuentasGold, umbral } : null;
            const payloadEmbed = await construirEmbedDetalleCarta(cartaId, nombreCarta, rutaMasterCfg?.webhook_url, null, interaction.guild, datosGold);
            payloadEmbed.components = [];
            payloadEmbed.embeds[0].addFields({ name: '📄 Account file', value: `\`${fileName}\`` });
            payloadEmbed.embeds[0].addFields({ name: '<:Polvo_iris_TCGP:1534723123914739802> Shinedust', value: `**${valorShinedust || '?'}**` });

            const archivos = [new AttachmentBuilder(archivo)];
            const deviceAccount = extraerDeviceAccount(archivo);
            if (deviceAccount) {
                const rutaJsonCfg = await db.get(`SELECT webhook_url FROM configs_canales WHERE tipo = 'ruta_json_cuentas'`);
                const archivoJson = buscarArchivoJsonPorDeviceAccount(rutaJsonCfg?.webhook_url, deviceAccount);
                if (archivoJson) archivos.push(new AttachmentBuilder(archivoJson));
            }
            const contenidoTexto = `<@${interaction.user.id}> Account \`${fileName}\` has **${valorShinedust || '?'}** Shinedust. Database attached.`;

            // Texto -> Embed -> XML/JSON, en ese orden -- dentro de UN mismo mensaje
            // Discord ya muestra el texto (content) arriba del embed sin importar el
            // orden de los campos en el payload, así que combinar content+embed en el
            // primer mensaje ya da "Texto, Embed"; el XML/JSON va en un segundo mensaje
            // aparte para que caiga despues.
            const canalExtract = await obtenerCanalComando(interaction.user.id, 'cmd_extract_xlm');
            if (canalExtract?.webhook_url) {
                try {
                    const webhookExtract = new WebhookClient({ url: canalExtract.webhook_url });
                    await webhookExtract.send({ content: contenidoTexto, embeds: payloadEmbed.embeds, files: payloadEmbed.files });
                    await webhookExtract.send({ files: archivos });
                    return await interaction.editReply({ content: '✅ Sent to your Extract XML channel.' });
                } catch (e) {
                    console.error('DEBUG: error mandando extract xml desde shinedust:', e?.message || e);
                }
            }
            return await interaction.editReply({ ...payloadEmbed, content: contenidoTexto, files: [...(payloadEmbed.files || []), ...archivos] });
        }

        if (interaction.customId.startsWith('wishlist_xml::')) {
            // El mismo customId sirve para el botón inicial (viene del detalle de
            // carta, mensaje nuevo) y para paginar (edita el mensaje de XML que ya
            // está abierto) — se distingue mirando de qué embed vino el click.
            const yaEsVistaXml = interaction.message?.embeds?.[0]?.title?.startsWith('💠 XML');
            // Pública, mismo motivo que en allcards_ver_expansiones.
            if (yaEsVistaXml) await interaction.deferUpdate();
            else await interaction.deferReply();

            const [, cartaId, paginaTexto] = interaction.customId.split('::');
            const pagina = parseInt(paginaTexto, 10) || 0;
            const rutaMasterCfg = await db.get(`SELECT webhook_url FROM configs_canales WHERE tipo = 'ruta_master'`);
            const rutaJsonCfg = await db.get(`SELECT webhook_url FROM configs_canales WHERE tipo = 'ruta_json_cuentas'`);
            const nombreCarta = resolverNombreCarta(cartaId, rutaMasterCfg?.webhook_url);
            const resultados = buscarXmlPorCarta(rutaJsonCfg?.webhook_url, cartaId);
            const payload = construirEmbedXml(resultados, nombreCarta, cartaId, pagina);
            await interaction.editReply(payload);
            // Hasta 2026-07-31 esto reubicaba el panel del canal como efecto
            // secundario de abrir el XML de una carta -- a pedido explicito
            // del usuario ("no quiero que aparezca de la nada, solo cuando el
            // usuario lo llame") se saco: el panel ya solo se mueve cuando el
            // usuario corre el comando /card, /wishlist o /goldcards a mano.
            return;
        }

        if (interaction.customId.startsWith('goldcards_xml::')) {
            // Mismo patron que wishlist_xml::, pero la lista sale de las cuentas ya
            // filtradas a 10+ copias (mapaCopias), no de buscarXmlPorCarta (que
            // muestra cualquier cuenta con al menos 1 copia -- confunde en este
            // contexto, ver reporte del usuario 2026-07-27).
            const yaEsVistaXml = interaction.message?.embeds?.[0]?.title?.startsWith('💠 XML');
            if (yaEsVistaXml) await interaction.deferUpdate();
            else await interaction.deferReply();

            const [, cartaId, paginaTexto] = interaction.customId.split('::');
            const pagina = parseInt(paginaTexto, 10) || 0;
            const rutaMasterCfg = await db.get(`SELECT webhook_url FROM configs_canales WHERE tipo = 'ruta_master'`);
            const nombreCarta = resolverNombreCarta(cartaId, rutaMasterCfg?.webhook_url);
            const { mapaCopias, umbral } = await obtenerCartasGoldCacheadas(interaction.user.id);
            const resultados = mapaCopias ? cuentasGoldParaCarta(mapaCopias, cartaId, umbral) : null;
            const payload = construirEmbedXml(resultados, nombreCarta, cartaId, pagina, 'goldcards');
            await interaction.editReply(payload);
            // Ver nota en wishlist_xml:: -- se saco la reubicacion automatica
            // del panel como efecto secundario de abrir el XML.
            return;
        }

        if (interaction.customId === 'actualizacion_luego') {
            return await interaction.update({ content: "👍 I'll remind you again next time you open the bot.", embeds: [], components: [] });
        }

        if (interaction.customId === 'actualizacion_ahora') {
            await interaction.update({ content: '⏳ Downloading the update...', embeds: [], components: [] });
            try {
                const remota = await obtenerVersionRemota();
                await descargarActualizacion(remota);
                await interaction.editReply({ content: `✅ Update ready. Restarting with version **${remota.version}**...` });

                // A pedido explicito del usuario 2026-07-30: avisar en el canal de
                // Updates cuando la descarga termina, recordando los pasos manuales
                // que siguen (Sync Channels + volver a guardar Main Path) -- se
                // manda ANTES de programar el process.exit para asegurarse de que
                // el mensaje realmente sale antes de que el proceso muera.
                try {
                    const canalUpdates = await obtenerCanalComando(interaction.user.id, 'actualizaciones');
                    if (canalUpdates?.webhook_url) {
                        await axios.post(`${canalUpdates.webhook_url}?wait=true`, {
                            content: `<@${interaction.user.id}> ✅ The download for **${remota.version}** finished 100%. Please press **Sync Channels** and re-save your **Main Path** in \`/setup\` once it restarts, so nothing breaks.`
                        }, { timeout: 15000 });
                    }
                } catch (e) {
                    console.error('DEBUG: no se pudo avisar en el canal de Updates que la descarga termino:', e?.response?.data || e?.message || e);
                }

                setTimeout(() => process.exit(0), 1500);
            } catch (e) {
                console.error('DEBUG: error descargando actualización:', e?.message || e);
                await interaction.editReply({ content: '❌ Could not download the update. Try again later.' });
            }
            return;
        }

        if (!tienePermisosGestion(interaction)) {
            return await interaction.reply({ content: "❌ You don't have permission to run control actions.", ephemeral: true });
        }
        switch (interaction.customId) {
            case 'btn_reset_total':
                // Restringido a pedido explicito del usuario 2026-07-30: borra
                // webhooks y configuracion de canales enteros -- cualquier miembro
                // comun que lo apretara sin querer arruinaba todo, sin forma de
                // deshacerlo.
                if (!tienePermisosGestion(interaction)) {
                    return await interaction.reply({ content: "❌ Only the server owner or an Administrator can use this.", ephemeral: true });
                }
                await interaction.deferReply({ ephemeral: true });
                try {
                    const categoria = interaction.guild.channels.cache.find(c => c.name === '📦 PTCG POCKET DROPS' && c.type === ChannelType.GuildCategory);
                    const canalesConWebhook = [];

                    if (categoria) {
                        for (const channel of categoria.children.cache.values()) {
                            const webhooks = await channel.fetchWebhooks().catch(() => null);
                            if (webhooks && webhooks.size > 0) {
                                canalesConWebhook.push(channel.name);
                                for (const webhook of webhooks.values()) {
                                    await webhook.delete('Reset total cleanup').catch(console.error);
                                }
                            }
                        }
                    }

                    await db.run(`DELETE FROM configs_canales WHERE discord_id = ?`, [interaction.user.id]);

                    const mensajeFinal = canalesConWebhook.length > 0
                        ? `✅ **Database reset.**\n🧹 Cleaned up old webhooks from: ${canalesConWebhook.join(', ')}`
                        : '✅ **Database reset.**';

                    await interaction.editReply({ content: mensajeFinal });
                } catch (e) {
                    await interaction.editReply({ content: '❌ Error trying to reset everything.' });
                }
                break;

            case 'btn_borrar_todo':
                // Mismo motivo que btn_reset_total -- este borra canales enteros.
                if (!tienePermisosGestion(interaction)) {
                    return await interaction.reply({ content: "❌ Only the server owner or an Administrator can use this.", ephemeral: true });
                }
                await interaction.deferReply({ ephemeral: true });
                try {
                    const categoria = interaction.guild.channels.cache.find(c => c.name === '📦 PTCG POCKET DROPS' && c.type === ChannelType.GuildCategory);
                    if (!categoria) return await interaction.editReply({ content: '❌ Channel category not found.' });

                    const canalesConWebhook = [];
                    for (const channel of categoria.children.cache.values()) {
                        const webhooks = await channel.fetchWebhooks().catch(() => null);
                        if (webhooks && webhooks.size > 0) {
                            canalesConWebhook.push(channel.name);
                            for (const webhook of webhooks.values()) {
                                await webhook.delete('Reset total cleanup').catch(console.error);
                            }
                        }
                    }

                    for (const channel of categoria.children.cache.values()) {
                        await channel.delete().catch(console.error);
                    }
                    await categoria.delete().catch(console.error);
                    await db.run(`DELETE FROM configs_canales WHERE discord_id = ?`, [interaction.user.id]);

                    const mensajeFinal = canalesConWebhook.length > 0
                        ? `✅ **Structure deleted successfully.**\n🧹 Cleaned up old webhooks from: ${canalesConWebhook.join(', ')}`
                        : '✅ **Structure deleted successfully.**';

                    await interaction.editReply({ content: mensajeFinal });
                } catch (e) {
                    await interaction.editReply({ content: '❌ Error trying to delete the channels.' });
                }
                break;

            case 'setup_status_friends': {
                await interaction.deferReply({ ephemeral: true });
                const { rutaIni: rutaIniStatusFriends } = await obtenerRutasInject(interaction.user.id);
                const friendsGuardados = parsearListaFriends(rutaIniStatusFriends);
                await interaction.editReply(construirPayloadStatusFriends(friendsGuardados));
                break;
            }

            case 'setup_remove_friend': {
                await interaction.deferUpdate();
                const { rutaIni: rutaIniRemoveFriend } = await obtenerRutasInject(interaction.user.id);
                const friendsParaBorrar = parsearListaFriends(rutaIniRemoveFriend);
                if (friendsParaBorrar.length === 0) {
                    return await interaction.editReply(construirPayloadStatusFriends(friendsParaBorrar));
                }
                const menuBorrar = new StringSelectMenuBuilder()
                    .setCustomId('setup_remove_friend_select')
                    .setPlaceholder('Select a friend to remove')
                    .addOptions(friendsParaBorrar.map((f) => ({
                        label: (f.label || '(no name)').slice(0, 100),
                        description: f.id,
                        value: f.id
                    })));
                await interaction.editReply({ embeds: interaction.message.embeds, components: [new ActionRowBuilder().addComponents(menuBorrar)] });
                break;
            }

            case 'btn_status':
                await interaction.deferReply({ ephemeral: true });
                const configs = await db.all(`SELECT tipo, canal_id, webhook_url FROM configs_canales WHERE discord_id = ?`, [interaction.user.id]);
                let s4tStatus = '🔴 Not assigned', hbStatus = '🔴 Not assigned', rutaRaizStatus = '🔴 Not assigned', crearStatus = '🔴 Not assigned';

                if (configs) {
                    configs.forEach(r => {
                        const canalMencion = (r.canal_id !== 'local' && r.canal_id !== 'N/A') ? `<#${r.canal_id}>` : '';
                        const webhookTxt = (r.webhook_url && r.webhook_url !== 'N/A') ? `\n🔗 Webhook: configured` : '';
                        if (r.tipo === 's4t') s4tStatus = `✅ Channel: ${canalMencion}${webhookTxt}`;
                        if (r.tipo === 'heartbeat') hbStatus = `✅ Channel: ${canalMencion}${webhookTxt}`;
                        if (r.tipo === 'crear_canales') crearStatus = `✅ Category ID: \`${r.canal_id}\``;
                        if (r.tipo === 'ruta_raiz') rutaRaizStatus = `✅ Path:\n\`${r.webhook_url}\``;
                    });
                }
                const embedStatus = new EmbedBuilder()
                    .setTitle('📊 Saved Configuration Report')
                    .setDescription(`**🚀 S4T:**\n${s4tStatus}\n\n**💓 Heartbeat:**\n${hbStatus}\n\n**🏗️ Create Channels:**\n${crearStatus}\n\n**📂 Main Path:**\n${rutaRaizStatus}`)
                    .setColor(0xF1C40F);
                await interaction.editReply({ embeds: [embedStatus] });
                break;

            case 'btn_check_updates':
                await interaction.deferReply({ ephemeral: true });
                try {
                    const localVer = obtenerVersionLocal();
                    const remotaVer = await obtenerVersionRemota();
                    if (esVersionMasNueva(remotaVer.version, localVer.version)) {
                        const embedUpdate = new EmbedBuilder()
                            .setTitle('🔔 An update is available')
                            .setColor(0xF0A93A)
                            .setDescription(
                                `**${localVer.version}** → **${remotaVer.version}**\n\n` +
                                `**What's new:**\n` +
                                notasParaEmbed(remotaVer.notes, remotaVer.notesCount)
                            );
                        const filaUpdate = new ActionRowBuilder().addComponents(
                            new ButtonBuilder().setCustomId('actualizacion_ahora').setLabel('Update now').setStyle(ButtonStyle.Success),
                            new ButtonBuilder().setCustomId('actualizacion_luego').setLabel('Later').setStyle(ButtonStyle.Secondary)
                        );
                        await interaction.editReply({ embeds: [embedUpdate], components: [filaUpdate] });

                        // A pedido explicito del usuario 2026-07-30: ademas de la
                        // respuesta efimera de arriba (solo la ve quien aprieta el
                        // boton), tambien se manda al canal de Updates con mencion
                        // directa -- asi queda un aviso visible para cualquiera que
                        // entre despues a ese canal, no solo para quien chequeo.
                        try {
                            const canalUpdates = await obtenerCanalComando(interaction.user.id, 'actualizaciones');
                            if (canalUpdates?.webhook_url) {
                                await axios.post(`${canalUpdates.webhook_url}?wait=true`, {
                                    content: `<@${interaction.user.id}>`,
                                    embeds: [embedUpdate.toJSON()],
                                    components: [filaUpdate.toJSON()]
                                }, { timeout: 15000 });
                            }
                        } catch (e) {
                            console.error('DEBUG: no se pudo avisar en el canal de Updates:', e?.response?.data || e?.message || e);
                        }
                    } else {
                        await interaction.editReply({ content: `✅ You're on the latest version (**${localVer.version}**).` });
                    }
                } catch (e) {
                    const detalle = describirError(e);
                    console.error('DEBUG: error en "Check for Updates":', detalle);
                    await interaction.editReply({ content: `❌ Could not check for updates right now.\n\`${detalle}\`\nTry again later, or send this to Ale if it keeps happening.` });
                }
                break;

            case 'btn_crear_canales_menu':
                await interaction.deferReply({ ephemeral: true });
                try {
                    const grupos = [
                        {
                            categoria: '🔔 UPDATES 🔔',
                            tipoCategoria: 'actualizaciones_categoria',
                            canales: [
                                { tipo: 'actualizaciones', name: '🔔-updates' },
                                { tipo: 'tutoriales', name: '📚-tutorials' },
                                { tipo: 'apoyo', name: '☕-donate' },
                                { tipo: 'cmd_feedback', name: '📝-feedback' }
                            ]
                        },
                        {
                            categoria: '⚙️ SETTINGS ⚙️',
                            tipoCategoria: 'settings_categoria',
                            canales: [
                                { tipo: 'cmd_setup', name: '⚙-settings' },
                                { tipo: 'cmd_build_embed', name: '🔧-build-embed' },
                                { tipo: 'cmd_build_webhooks', name: '🔗-build-webhooks' }
                            ]
                        },
                        {
                            categoria: '💓 HEARTBEAT 💓',
                            tipoCategoria: 'heartbeat_categoria',
                            canales: [
                                { tipo: 'heartbeat', name: '💓-heartbeat' }
                            ]
                        },
                        {
                            categoria: '📦 PTCG POCKET DROPS 📦',
                            tipoCategoria: 'crear_canales',
                            canales: [
                                { tipo: 's4t', name: '🤖-s4t' },
                                { tipo: 's4t-categoria', name: '📊-s4t-category' },
                                { tipo: '3-diamond', name: '🔷-3-diamond' },
                                { tipo: '4-diamond', name: '💠-4-diamond' },
                                { tipo: '1-star', name: '⭐-1-star' },
                                { tipo: '1-star-shiny', name: '🌟-1-star-shiny' },
                                { tipo: '2-star-trainer', name: '⭐⭐-trainer' },
                                { tipo: '2-star-rainbow', name: '🌈-2-star-rainbow' },
                                { tipo: '2-star-full-art', name: '🎨-2-star-full-art' },
                                { tipo: '2-star-shiny', name: '✨-2-star-shiny' },
                                { tipo: 'immersive', name: '🌌-immersive' },
                                { tipo: 'crown-rare', name: '👑-crown-rare' },
                                { tipo: 'wishlist', name: '💖-wishlist' }
                            ]
                        },
                        {
                            categoria: '📦 GOD PACKS 📦',
                            tipoCategoria: 'godpack_categoria',
                            canales: [
                                { tipo: 'godpack-general', name: '📦-godpack-general' },
                                { tipo: 'godpack-alive', name: '👼-godpack-alive' },
                                { tipo: 'godpack-dead', name: '☠️-godpack-dead' }
                            ]
                        },
                        {
                            categoria: '🔥 MANAGER 🔥',
                            tipoCategoria: 'manager_categoria',
                            canales: [
                                { tipo: 'cmd_card_wishlist', name: '💖-cards-wishlist' },
                                { tipo: 'cmd_card_all', name: '⚡-all-cards' },
                                { tipo: 'cmd_card_gold', name: '🏆-gold-cards' },
                                { tipo: 'cmd_extract_xlm', name: '📄-extract-xml' },
                                { tipo: 'shinedust', name: '🍬-shinedust' },
                                { tipo: 'info_accounts', name: '📋-info-accounts' }
                            ]
                        },
                        {
                            categoria: '🎮 RUN MUMU PLAYER 🎮',
                            tipoCategoria: 'run_mumu_categoria',
                            canales: [
                                { tipo: 'cmd_run_instance', name: '🔄-trading' }
                            ]
                        }
                    ];

                    // Solo canales que tienen un comando real asignado (aunque no se pueda
                    // "ejecutar" solo, como /embed, /webhook, /feedback) o que explican algo
                    // que no se repite (Updates/Support) reciben un embed al sincronizar. El
                    // resto (rareza, godpacks, s4t, heartbeat, wishlist-feed) no tiene ningún
                    // comando propio — meter un embed ahí es ruido innecesario en canales que
                    // además reciben cartas todo el tiempo.
                    // Lista mostrada en el canal de Tutorials (2026-08-06, a pedido explicito
                    // del usuario): un item por fila, cada uno con su boton para abrir el PDF
                    // correspondiente reusando tutorial_pdf:: (mismo botón que ya usa cada
                    // canal individual) -- si a algún tipo todavía no se le subió el PDF real,
                    // el handler de tutorial_pdf:: ya responde "No tutorial available yet" solo.
                    const TUTORIALES_LISTA = [
                        { tipo: 'cmd_setup', label: 'Bot General' },
                        { tipo: 'cmd_build_embed', label: 'Build Embed' },
                        { tipo: 'cmd_build_webhooks', label: 'Build Webhooks' },
                        { tipo: 'cmd_card_wishlist', label: 'Cards Wishlist' },
                        { tipo: 'cmd_card_all', label: 'All Cards' },
                        { tipo: 'cmd_extract_xlm', label: 'Extract XML' },
                        { tipo: 'shinedust', label: 'Shinedust' },
                        { tipo: 'cmd_card_gold', label: 'Gold Cards' },
                        { tipo: 'info_accounts', label: 'Info Accounts' },
                        { tipo: 'cmd_run_instance', label: 'Automatic Trading' }
                    ];

                    const EMBEDS_BIENVENIDA_POR_TIPO = {
                        actualizaciones: { title: '🔔 Updates', description: 'You\'ll get notified here whenever there\'s a new bot update, with a button to install it right away.' },
                        tutoriales: {
                            title: '📚 Tutorials',
                            description: 'Here you can find all the tutorials for the bot\'s commands and features:',
                            fields: TUTORIALES_LISTA.map((t, i) => ({ name: `${i + 1}- ${t.label}`, value: '​', inline: false }))
                        },
                        apoyo: { title: '☕ Donate', description: 'If this bot has been useful to you, any support to keep improving it is appreciated. Thanks for using it! 💛' },
                        cmd_build_embed: { title: '🔧 Build Embed', description: 'This is where you use `/embed` to configure what information is shown in the embeds for found cards.' },
                        cmd_build_webhooks: { title: '🔗 Build Webhooks', description: 'This is where you use `/webhook` to change the name and avatar of each channel\'s webhooks.' },
                        cmd_feedback: { title: '📝 Feedback', description: 'This is where you use `/feedback` to send suggestions, report problems, or share your thoughts about the bot — you can attach a screenshot too.' },
                        shinedust: { title: '🍬 Shinedust', description: 'Results from the 👛 Shinedust button on card lookups land here — the card, the account, and its current Shinedust balance, with buttons to jump straight into Trade or Extract XML for that same account.' },
                        info_accounts: { title: '📋 Info Accounts', description: 'Press 📋 Info Accounts on a message in your Extract XML channel to get a full PDF report of that account here — every card it has, grouped by expansion, with quantities.' }
                    };

                    // Canales con un comando real y no-efímero asignado: en vez del embed
                    // genérico de "acá usas /x", se ejecuta el comando de verdad para que el
                    // usuario vea la interfaz funcionando apenas se crea el canal.
                    // cmd_build_embed/cmd_build_webhooks/cmd_feedback quedan afuera porque
                    // esos comandos responden de forma efímera (o abren un modal), así que no
                    // hay nada persistente que publicar en el canal sin una interacción real.
                    const COMANDOS_REALES_POR_TIPO = {
                        cmd_card_wishlist: 'card_wishlist',
                        cmd_card_all: 'card_all',
                        cmd_extract_xlm: 'extract_xlm',
                        cmd_run_instance: 'run_instance'
                    };

                    const crearCategoriaSiNoExiste = async (nombreCategoria) => {
                        let categoria = interaction.guild.channels.cache.find(c => c.name === nombreCategoria && c.type === ChannelType.GuildCategory);
                        if (!categoria) {
                            categoria = await interaction.guild.channels.create({
                                name: nombreCategoria,
                                type: ChannelType.GuildCategory,
                                permissionOverwrites: [{
                                    id: interaction.guild.members.me.id,
                                    allow: [PermissionsBitField.Flags.Administrator]
                                }]
                            });
                        }
                        return categoria;
                    };


                    const crearCanalSincronizado = async (categoria, tipo, nombreCanal) => {
                        let canal = interaction.guild.channels.cache.find(ch => ch.name === nombreCanal && ch.parentId === categoria.id);
                        if (!canal) {
                            // Si el canal ya existe en otra categoría (reorganización), lo movemos en vez de duplicarlo.
                            canal = interaction.guild.channels.cache.find(ch => ch.name === nombreCanal && ch.type === ChannelType.GuildText);
                            if (canal) {
                                await canal.setParent(categoria.id, { lockPermissions: false });
                            } else {
                                canal = await interaction.guild.channels.create({ name: nombreCanal, type: ChannelType.GuildText, parent: categoria.id });
                            }
                        }

                        const filaExistente = await db.get(`SELECT canal_id, webhook_url FROM configs_canales WHERE discord_id = ? AND tipo = ?`, [interaction.user.id, tipo]);
                        if (filaExistente && filaExistente.canal_id === canal.id && filaExistente.webhook_url && filaExistente.webhook_url !== 'N/A' && (await webhookEstaVivo(filaExistente.webhook_url))) {
                            return canal;
                        }

                        // Si se llega hasta acá es porque el webhook viejo se va a recrear
                        // (invalido, o el chequeo de arriba dio falso) -- sin esto, el mensaje
                        // de bienvenida/panel que ya se habia mandado con el webhook VIEJO
                        // queda huerfano en el canal (el webhook que lo mando ya no existe) y
                        // el de abajo manda uno nuevo, duplicando el mensaje para siempre.
                        if (filaExistente?.webhook_url && filaExistente.webhook_url !== 'N/A') {
                            const claveInterfazVieja = COMANDOS_REALES_POR_TIPO[tipo] || (tipo === 'cmd_setup' ? 'setup' : tipo);
                            const filaMsgVieja = await db.get(`SELECT estado FROM configs_extras WHERE discord_id = ? AND tipo = ?`, [interaction.user.id, `interfaz_msg_${claveInterfazVieja}`]);
                            if (filaMsgVieja?.estado) {
                                try { await axios.delete(`${filaExistente.webhook_url}/messages/${filaMsgVieja.estado}`, { timeout: 10000 }); } catch (e) { /* ya no existia o el webhook viejo ya estaba muerto */ }
                            }
                        }

                        const webhooks = await canal.fetchWebhooks();
                        const existingHooks = webhooks.filter(w => w.name === `Bot ${tipo}` || w.name === nombreDefaultWebhook(tipo));
                        for (const oldWebhook of existingHooks.values()) {
                            await oldWebhook.delete('Recreating invalid webhook').catch(console.error);
                        }

                        const webhook = await canal.createWebhook({ name: nombreDefaultWebhook(tipo), avatar: avatarDefaultWebhook(tipo) });
                        await db.run(`DELETE FROM configs_canales WHERE discord_id = ? AND tipo = ?`, [interaction.user.id, tipo]);
                        await db.run(`INSERT INTO configs_canales (discord_id, tipo, canal_id, webhook_url) VALUES (?, ?, ?, ?)`, [interaction.user.id, tipo, canal.id, webhook.url]);
                        // Si el usuario ya le había puesto nombre/foto propia a este webhook
                        // con /webhook, se la reaplica al nuevo — si no, se queda con el
                        // nombre/foto por defecto (nada que reaplicar).
                        await aplicarPersonalizacionWebhookSiExiste(interaction.user.id, tipo, webhook.url);

                        const commandKeyReal = COMANDOS_REALES_POR_TIPO[tipo];
                        if (commandKeyReal) {
                            await enviarComandoAlCanal(commandKeyReal, interaction.user, { webhook_url: webhook.url, canal_id: canal.id }, false, interaction.guild);
                        } else if (tipo === 'cmd_setup') {
                            const { archivos: archivosPanel, ...panel } = await generarPanelControl(interaction.user.id);
                            await enviarOEditarInterfaz(interaction.user.id, 'setup', webhook.url, panel, archivosPanel || []);
                        } else {
                            const embedBienvenida = EMBEDS_BIENVENIDA_POR_TIPO[tipo];
                            if (embedBienvenida) {
                                const payloadBienvenida = { embeds: [{ color: 0xF0A93A, ...embedBienvenida }] };
                                // Botón de link (style 5) — no requiere que el bot
                                // maneje ninguna interacción, Discord abre la URL
                                // directo en el cliente, así que funciona igual
                                // mandado desde un webhook plano.
                                if (tipo === 'apoyo') {
                                    payloadBienvenida.components = [{
                                        type: 1,
                                        components: [{ type: 2, style: 5, label: '☕ Donate on Ko-fi', url: 'https://ko-fi.com/alecast' }]
                                    }];
                                }
                                if (tipo === 'tutoriales') {
                                    const filasTutoriales = [];
                                    for (let j = 0; j < TUTORIALES_LISTA.length; j += 5) {
                                        filasTutoriales.push(new ActionRowBuilder().addComponents(
                                            TUTORIALES_LISTA.slice(j, j + 5).map(t =>
                                                new ButtonBuilder().setCustomId(`tutorial_pdf::${t.tipo}`).setLabel(`📄 ${t.label}`).setStyle(ButtonStyle.Secondary)
                                            )
                                        ));
                                    }
                                    payloadBienvenida.components = filasTutoriales;
                                }
                                await enviarOEditarInterfaz(interaction.user.id, tipo, webhook.url, payloadBienvenida);
                            }
                        }

                        return canal;
                    };

                    const reportePartes = [];
                    const categoriasGestionadas = [];
                    for (let i = 0; i < grupos.length; i++) {
                        const grupo = grupos[i];
                        const categoria = await crearCategoriaSiNoExiste(grupo.categoria);
                        categoriasGestionadas.push(categoria);
                        await db.run(`DELETE FROM configs_canales WHERE discord_id = ? AND tipo = ?`, [interaction.user.id, grupo.tipoCategoria]);
                        await db.run(`INSERT INTO configs_canales (discord_id, tipo, canal_id, webhook_url) VALUES (?, ?, ?, 'N/A')`, [interaction.user.id, grupo.tipoCategoria, categoria.id]);

                        for (const c of grupo.canales) {
                            const canal = await crearCanalSincronizado(categoria, c.tipo, c.name);
                            reportePartes.push(`🔹 <#${canal.id}>`);
                        }
                    }

                    // Reordenar TODAS las categorías del servidor en un solo request (bulk): las
                    // nuestras primero en el orden deseado, y el resto (no gestionadas por el bot)
                    // a continuación, respetando su orden actual entre sí. Mandar solo un subconjunto
                    // hace que Discord reinterprete las posiciones de forma inconsistente.
                    const idsGestionados = new Set(categoriasGestionadas.map(c => c.id));
                    const otrasCategorias = interaction.guild.channels.cache
                        .filter(ch => ch.type === ChannelType.GuildCategory && !idsGestionados.has(ch.id))
                        .sort((a, b) => a.position - b.position);

                    const posicionesCategorias = [
                        ...categoriasGestionadas.map((categoria, i) => ({ id: categoria.id, position: i })),
                        ...[...otrasCategorias.values()].map((ch, i) => ({ id: ch.id, position: categoriasGestionadas.length + i }))
                    ];
                    await interaction.client.rest.patch(Routes.guildChannels(interaction.guildId), { body: posicionesCategorias }).catch(console.error);

                    await interaction.editReply({ content: `✅ **Channels synced successfully!**\n\n${reportePartes.join('\n')}` });
                } catch (e) {
                    console.error(e);
                    await interaction.editReply({ content: "❌ Error syncing channels. Check the bot's permissions." });
                }
                break;

            case 'toggle_trading':
                await interaction.deferUpdate();
                const estadoS4T = await verificarEstadoPM2('trading', 's4t.js');
                if (estadoS4T === '🟢 ONLINE') {
                    await db.run(`INSERT OR REPLACE INTO estados_modulos (nombre, status) VALUES ('trading', 'offline')`);
                    exec('pm2 stop trading', { windowsHide: true }, () => {});
                } else {
                    if (!(await tieneConfiguracion(interaction.user.id, 's4t'))) return await interaction.followUp({ content: '❌ First configure the S4T Webhook in the panel.', ephemeral: true });
                    await db.run(`INSERT OR REPLACE INTO estados_modulos (nombre, status) VALUES ('trading', 'online')`);
                    ejecutarPM2Start('trading', 's4t.js');
                }
                setTimeout(async () => {
                    const { archivos: archivosPanel, ...panel } = await generarPanelControl(interaction.user.id);
                    await interaction.editReply({ ...panel, files: (archivosPanel || []).map(a => new AttachmentBuilder(a.ruta, { name: a.filename })) });
                }, 1500);
                break;

            case 'toggle_heartbeat': 
                await interaction.deferUpdate();
                const estadoHB = await verificarEstadoPM2('heartbeat');
                if (estadoHB === '🟢 ONLINE') {
                    await db.run(`INSERT OR REPLACE INTO estados_modulos (nombre, status) VALUES ('heartbeat', 'offline')`);
                    exec('pm2 stop heartbeat');
                } else {
                    if (!(await tieneConfiguracion(interaction.user.id, 'heartbeat'))) return await interaction.followUp({ content: '❌ First configure the Heartbeat Webhook in the panel.', ephemeral: true });
                    await db.run(`INSERT OR REPLACE INTO estados_modulos (nombre, status) VALUES ('heartbeat', 'online')`);
                    exec('pm2 start heartbeat.js --name "heartbeat"');
                }
                setTimeout(async () => {
                    const { archivos: archivosPanel, ...panel } = await generarPanelControl(interaction.user.id);
                    await interaction.editReply({ ...panel, files: (archivosPanel || []).map(a => new AttachmentBuilder(a.ruta, { name: a.filename })) });
                }, 1500);
                break;

            case 'toggle_drive_hd_regular': {
                await interaction.deferUpdate();
                const yaEstaOn = await driveHdRegularHabilitado();
                await db.run(`INSERT OR REPLACE INTO estados_modulos (nombre, status) VALUES ('drive_hd_regular', ?)`, [yaEstaOn ? 'off' : 'on']);
                const { archivos: archivosPanelDrive, ...panelDrive } = await generarPanelControl(interaction.user.id);
                await interaction.editReply({ ...panelDrive, files: (archivosPanelDrive || []).map(a => new AttachmentBuilder(a.ruta, { name: a.filename })) });
                break;
            }

            case 'btn_config_canales': await configScript.ejecutar(interaction); break;
            
            case 'btn_ruta_raiz':
                const modalRaiz = new ModalBuilder().setCustomId('modal_ruta_raiz').setTitle('Main Path')
                    .addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('input_ruta').setLabel('Main folder path:').setStyle(TextInputStyle.Short).setPlaceholder('C:\\POKEMON\\PTCGPB-ALE')));
                await interaction.showModal(modalRaiz);
                break;
        }
    }
});

// El link de invitación no es secreto (cualquiera puede rearmar uno con el mismo
// client ID), así que el bot se autoriza solo al primer servidor donde se usa y
// se sale solo de cualquier otro — evita que alguien más lo agregue a su propio
// servidor y use la instancia corriendo en esta PC sin permiso.
async function obtenerGuildsAutorizados() {
    const fila = await db.get(`SELECT status FROM estados_modulos WHERE nombre = 'guilds_autorizados'`);
    if (!fila?.status) return null;
    try { return JSON.parse(fila.status); } catch (e) { return null; }
}

async function guardarGuildsAutorizados(idsGuild) {
    await db.run(`INSERT INTO estados_modulos (nombre, status) VALUES ('guilds_autorizados', ?) ON CONFLICT(nombre) DO UPDATE SET status = excluded.status`, [JSON.stringify(idsGuild)]);
}

async function autorizarGuildNueva(guildId) {
    const actuales = (await obtenerGuildsAutorizados()) || [];
    if (!actuales.includes(guildId)) await guardarGuildsAutorizados([...actuales, guildId]);
}

async function rechazarGuildNoAutorizado(guild) {
    console.warn(`⚠️ Unauthorized server detected (${guild.name} / ${guild.id}) — leaving automatically.`);
    try { await guild.leave(); } catch (e) { console.error('❌ Error al salir del servidor no autorizado:', e); }
}

client.once('ready', async () => {
    try {
        await registrarSlashCommands();
        console.log(`🤖 Bot ready as ${client.user.tag}`);

        // Primera vez que corre esta versión: se adopta como autorizado TODO servidor
        // donde el bot ya estaba (no se expulsa nada retroactivamente). De acá en más,
        // cualquier servidor nuevo que no esté en esta lista se rechaza solo.
        //
        // Importante: una lista vacía cuenta como "todavía no se autorizó nada de
        // verdad", igual que null — si no, un usuario que prende el .exe ANTES de
        // invitar al bot guarda [] en el primer ready() (0 servidores todavía), y si
        // el proceso se reinicia después con el servidor ya agregado (ej. por un
        // reconfigure, un crash, o el propio auto-update), esa segunda vez cae en la
        // rama de rechazo y expulsa un servidor que en realidad nunca llegó a
        // autorizarse — justo el bug real que reportó el usuario probando como
        // usuario nuevo.
        let guildsAutorizados = await obtenerGuildsAutorizados();
        if (!guildsAutorizados || guildsAutorizados.length === 0) {
            guildsAutorizados = [...client.guilds.cache.keys()];
            await guardarGuildsAutorizados(guildsAutorizados);
        } else {
            for (const g of client.guilds.cache.values()) {
                if (!guildsAutorizados.includes(g.id)) await rechazarGuildNoAutorizado(g);
            }
        }
    } catch (error) {
        console.error('❌ Error registrando slash commands:', error?.response?.data || error?.message || error);
    }

    chequearActualizaciones(client);
    avisarActualizacionAplicadaSiHaceFalta(client);

    // El bot está pensado para quedarse prendido semanas sin reiniciarse —
    // si el chequeo de actualización solo corriera acá (una sola vez al
    // arrancar), alguien que nunca lo reinicia nunca se enteraría de una
    // versión nueva. Se repite cada 15 minutos — es solo un fetch chico a
    // GitHub, no genera carga real.
    setInterval(() => chequearActualizaciones(client), 15 * 60 * 1000);

    // Chequeo proactivo de webhooks caídos — avisa solo (no repara solo, eso
    // sigue requiriendo "Sincronizar Canales" a propósito) para no reparar
    // sin que el usuario se entere. Antes corría cada 1 minuto contra TODOS
    // los webhooks de todos los usuarios (~25-30 por usuario) — eso, sumado a
    // que cualquier error transitorio se contaba como "caído" (ver
    // webhookEstaVivo), generaba falsas alarmas. Ahora cada 5 minutos alcanza
    // igual de bien para algo que en la práctica no cambia segundo a segundo.
    chequearWebhooksCaidos(client);
    setInterval(() => chequearWebhooksCaidos(client), 5 * 60 * 1000);
});

client.on('guildCreate', async (guild) => {
    const guildsAutorizados = (await obtenerGuildsAutorizados()) || [];
    if (!guildsAutorizados.includes(guild.id)) {
        if (guildsAutorizados.length > 0) {
            await rechazarGuildNoAutorizado(guild);
            return;
        }
        await autorizarGuildNueva(guild.id);
        console.log(`✅ Server automatically authorized: ${guild.name} (${guild.id})`);
    }

    // El registro de arranque (registrarSlashCommands, en el ready()) solo
    // llega a los servidores donde el bot YA estaba en ese momento — si se
    // invita el bot a un servidor nuevo después de que arrancó (el orden más
    // común para un usuario real: primero abrir el programa, después generar
    // el link de invitación), esos comandos nunca se registran ahí sin esto.
    try {
        const rest = new REST({ version: '10' }).setToken(TOKEN);
        const applicationId = CLIENT_ID || client.user?.id;
        if (applicationId) {
            await rest.put(Routes.applicationGuildCommands(applicationId, guild.id), { body: construirSlashCommands() });
            console.log(`✅ Slash commands registered in guild ${guild.id}`);
        }
    } catch (error) {
        console.error('❌ Error registering slash commands on new guild:', error?.response?.data || error?.message || error);
    }
});

client.login(TOKEN);