require('dotenv').config();
const { 
    Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder,
    ButtonStyle, EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle,
    ChannelType, PermissionsBitField, StringSelectMenuBuilder, SlashCommandBuilder, REST, Routes,
    AttachmentBuilder
} = require('discord.js');
const axios = require('axios');
const FormData = require('form-data');
const { exec, execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const sharp = require('./native-require.js')('sharp');
const db = require('./database.js');

const heartbeatScript = require('./heartbeat.js');
const configScript = require('./config.js');
const { chequearActualizaciones, obtenerVersionLocal, obtenerVersionRemota, esVersionMasNueva, descargarActualizacion } = require('./update-checker.js');
const { obtenerMapaEmojisGuild } = require('./guild-emojis.js');

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
    extract_xlm: { tipo: 'cmd_extract_xlm', label: 'Extract XLM', titulo: '📄 Extract XLM', descripcion: 'Exclusive channel for /extract xlm.' },
    run_instance: { tipo: 'cmd_run_instance', label: 'Run MumuPlayer', titulo: '🎮 Run MumuPlayer', descripcion: 'Exclusive channel for /run instance.' }
};

const ETIQUETAS_TIPO_WEBHOOK = {
    's4t': 'S4T (General)',
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
    'apoyo': 'Support my work',
    'cmd_setup': 'Settings',
    'cmd_build_embed': 'Build Embed',
    'cmd_build_webhooks': 'Build Webhooks'
};
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
    if (filas.length) {
        const menu = new StringSelectMenuBuilder()
            .setCustomId('webhook_seleccionar')
            .setPlaceholder('Select a webhook to edit')
            .addOptions(filas.slice(0, 25).map(f => ({
                label: `Webhook - ${etiquetaTipoWebhook(f.tipo)}`.slice(0, 100),
                value: f.tipo
            })));
        componentes.push(new ActionRowBuilder().addComponents(menu));
    }

    return { embeds: [embed], components: componentes };
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

    const embed = new EmbedBuilder()
        .setTitle(`🔗 Webhook - ${etiquetaTipoWebhook(tipo)}`)
        .setColor(opciones.guardado ? 0x2ECC71 : 0x5865F2)
        .setDescription(
            (opciones.guardado ? '✅ **Saved.**\n\n' : '') +
            (opciones.error ? `❌ **${opciones.error}**\n\n` : '') +
            `**Channel:** <#${fila.canal_id}>\n**Current name:** ${nombreActual}`
        );
    if (avatarUrl) embed.setThumbnail(avatarUrl);

    const filaBotones = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`webhook_modificar::${tipo}`).setLabel('✏️ Edit name/avatar').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('webhook_volver').setLabel('🔙 Back').setStyle(ButtonStyle.Secondary)
    );

    return { embeds: [embed], components: [filaBotones] };
}

function normalizarComando(interaction) {
    const key = interaction?.commandName?.toLowerCase();
    if (key === 'card') return 'card_all';
    if (key === 'wishlist') return 'card_wishlist';
    if (key === 'extract') return interaction?.options?.getSubcommand?.(false) === 'xlm' ? 'extract_xlm' : null;
    if (key === 'run') return interaction?.options?.getSubcommand?.(false) === 'instance' ? 'run_instance' : null;
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

function construirEmbedWishlistInicio(user) {
    return new EmbedBuilder()
        .setTitle('🔍 | Wishlist Card Search:')
        .setDescription(
            `Your wishlist is right here!!  <@${user.id}>.\n\n` +
            `Press the button to see the full list of your saved wishlist. <:icono_wishlist:1526794552575262820>\n\n`+
            `Details: \n\n` +
            `1- View all expansions!\n` +
            `2- Search cards by expansion!\n` +
            `3- Search cards by name!\n` +
            `4- View details of each card!\n` +
            `5- View image of each card!\n`
        )
        .setColor(0xE91E63)
        .setFooter({ text: " Bot By Ale Cast ୨♡୧ • PTCGPB Remote Control" })
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

function construirEmbedAllCardsInicio(user) {
    return new EmbedBuilder()
        .setTitle('⚡ Pokemon TCGP Library ⚡')
        .setDescription(
            `**Command run by <@${user.id}>.\n\n**` +
            `__Select an option below:__\n\n` +
            `1-› TCGP Expansions Panel.\n`+
            `2-› Category of each card by rarity.\n`+
            `3-› View each card, quantity & XLM.\n`
        )
        .setColor(0x3498DB)
        .setFooter({ text: " Bot By Ale Cast ୨♡୧ • PTCGPB Remote Control" })
        .setTimestamp();
}

const SYMBOL_EMBEDS_PATH = path.join(__dirname, 'assets', 'embeds', 'symbol.png');

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

function construirEmbedCartasPorExpansion(cartas, expansion, categoria, pagina = 0, opciones = {}) {
    const prefijo = opciones.prefijo || 'wishlist';
    const contexto = opciones.contexto || 'your wishlist';
    const mapaEmojisCartas = opciones.mapaEmojis || {};

    const filtradas = cartas.filter(c => c.expansion === expansion && c.categoria === categoria);
    const totalPaginas = Math.max(1, Math.ceil(filtradas.length / WISHLIST_EXPANSION_POR_PAGINA));
    const paginaSegura = Math.min(Math.max(pagina, 0), totalPaginas - 1);
    const inicio = paginaSegura * WISHLIST_EXPANSION_POR_PAGINA;
    const items = filtradas.slice(inicio, inicio + WISHLIST_EXPANSION_POR_PAGINA);

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
    const rutaLogo = buscarLogoExpansionBot(expansion);
    if (rutaLogo) {
        const extension = path.extname(rutaLogo) || '.png';
        embed.setThumbnail(`attachment://logo${extension}`);
        payload.files = [new AttachmentBuilder(rutaLogo, { name: `logo${extension}` })];
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
        _driveFolderMapCacheBot = mapa;
        fs.writeFileSync(DRIVE_FOLDER_MAP_PATH_BOT, JSON.stringify(mapa, null, 2));
        return mapa;
    } catch (e) {
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

async function obtenerImagenHDBot(cardMap, cartaId) {
    const info = cardMap?.[cartaId];
    if (!info?.ExpansionID || !info?.CollectionNumber || !GOOGLE_DRIVE_API_KEY_BOT || !GOOGLE_DRIVE_HD_ENABLED_BOT) return null;

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
        if (!subfolderId) return null;

        const busqueda = await axios.get('https://www.googleapis.com/drive/v3/files', {
            params: { q: `'${subfolderId}' in parents and name contains '${info.ExpansionID}-${localId}'`, key: GOOGLE_DRIVE_API_KEY_BOT, fields: 'files(id,name)', pageSize: 5 },
            timeout: 5000
        });
        const archivo = (busqueda.data.files || [])[0];
        if (!archivo) return null;

        const descarga = await axios.get(`https://www.googleapis.com/drive/v3/files/${archivo.id}`, {
            params: { alt: 'media', key: GOOGLE_DRIVE_API_KEY_BOT },
            responseType: 'arraybuffer', timeout: 8000
        });
        fs.mkdirSync(dirCache, { recursive: true });
        fs.writeFileSync(rutaCache, descarga.data);
        return rutaCache;
    } catch (e) {
        console.log('DEBUG: Error obteniendo imagen HD del Drive (preview /embed):', e?.response?.status || '', e?.message || e);
        return null;
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

async function construirEmbedDetalleCarta(cartaId, nombre, rutaMasterPath, volver = null, guild = null) {
    const mapaEmojis = await obtenerMapaEmojisGuild(guild);
    const cardMap = cargarCardMap(rutaMasterPath);
    const en_US = rutaMasterPath ? leerJsonSeguro(path.join(rutaMasterPath, 'en_US.json')) : null;
    const info = cardMap?.[cartaId];
    const expansiones = construirMapaExpansiones(en_US);
    const expansionNombre = info?.ExpansionID ? (expansiones[info.ExpansionID] || info.ExpansionID) : 'Unknown';
    const categoria = resolverCategoriaFormateadaCarta(cartaId, rutaMasterPath, mapaEmojis);
    const imagenPath = (await obtenerImagenHDBot(cardMap, cartaId)) || encontrarImagenPorIllustration(rutaMasterPath, info?.IllustrationID);

    const tipoIngles = cargarCardTypesBot()[nombre.toLowerCase()];
    const tagElemento = tipoIngles ? tagTipoBot(`type_${tipoIngles.toLowerCase()}`, mapaEmojis) : '';
    const elemento = tagElemento ? `${tagElemento} ${tipoIngles}` : 'Unknown';

    const embed = new EmbedBuilder()
        .setTitle(`🔎 ${nombre}`)
        .setDescription(`**Expansion:** ${expansionNombre}\n**Name:** ${nombre}\n**Element:** ${elemento}\n**Category:** ${categoria}\n**ID:** \`${cartaId}\``)
        .setColor(0xE91E63);

    const botones = [new ButtonBuilder().setCustomId(`wishlist_xlm::${cartaId}::0`).setLabel('💠 XLM').setStyle(ButtonStyle.Success)];
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
    const filaXlm = new ActionRowBuilder().addComponents(...botones);

    const payload = { embeds: [embed], components: [filaXlm] };
    if (imagenPath) {
        // Logo compuesto arriba de la carta en una sola imagen (mismo criterio
        // que ya usa s4t.js/el preview de /embed), en vez de una miniatura
        // aparte en la esquina.
        let buffer = fs.readFileSync(imagenPath);
        const rutaLogo = buscarLogoExpansionBot(expansionNombre);
        if (rutaLogo) buffer = await componerLogoSobreImagenBot(buffer, rutaLogo);
        embed.setImage('attachment://carta.png');
        payload.files = [new AttachmentBuilder(buffer, { name: 'carta.png' })];
    }
    return payload;
}

function construirEmbedExtractXlmInicio(user) {
    return new EmbedBuilder()
        .setTitle('📄 Extract XLM')
        .setDescription(
            `Command run by <@${user.id}>.\n\n` +
            `Press the button and paste the XLM file name (e.g. \`134P_20260120113013_2(BXR).xml\`) for the bot to send it to you.`
        )
        .setColor(0x3498DB)
        .setFooter({ text: " Bot By Ale Cast ୨♡୧ • PTCGPB Remote Control" })
        .setTimestamp();
}

function construirEmbedRunInstanceInicio(user) {
    return new EmbedBuilder()
        .setTitle('🎮 Run MumuPlayer')
        .setDescription(
            `Command run by <@${user.id}>.\n\n` +
            `Press the button to see your MuMuPlayer instances and open the one you need.`
        )
        .setColor(0x2ECC71)
        .setFooter({ text: " Bot By Ale Cast ୨♡୧ • PTCGPB Remote Control" })
        .setTimestamp();
}

function rutaMuMuManager() {
    const candidatos = [
        'C:\\Program Files\\Netease\\MuMuPlayer\\nx_main\\MuMuManager.exe',
        'C:\\Program Files\\Netease\\MuMuPlayer\\shell\\MuMuManager.exe',
        'C:\\Program Files\\Netease\\MuMuPlayerGlobal-12.0\\nx_main\\MuMuManager.exe',
        'C:\\Program Files\\Netease\\MuMuPlayerGlobal-12.0\\shell\\MuMuManager.exe'
    ];
    return candidatos.find(p => fs.existsSync(p)) || null;
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

    if (seleccion) {
        embed.addFields({ name: '🖱️ Selected', value: `**${seleccion.index}. ${seleccion.name}** — ${seleccion.encendida ? '🟢 On' : '🔴 Off'}` });

        componentes.push(new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`mumu_encender_${seleccion.index}::${seleccion.name}`)
                .setLabel(seleccion.encendida ? '✅ On' : '🟢 Turn On')
                .setStyle(seleccion.encendida ? ButtonStyle.Secondary : ButtonStyle.Success)
                .setDisabled(!!seleccion.encendida)
        ));

        componentes.push(new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`mumu_friendid_${seleccion.index}::${seleccion.name}`).setLabel('🆔 Add Friend').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId(`mumu_xlm_${seleccion.index}::${seleccion.name}`).setLabel('💠 XLM').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`mumu_status_${seleccion.index}::${seleccion.name}`).setLabel('📊 Status').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId(`mumu_ejecutar_${seleccion.index}::${seleccion.name}`).setLabel('✅ Submit').setStyle(ButtonStyle.Danger)
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
        wishlist: path.join(base, 'Accounts', 'Cards')
    };
}

const RUTA_INJECT_INI = 'C:\\POKEMON\\PTCGPB-ALE\\Accounts\\InjectAccount.ini';
const RUTA_INJECT_ACCOUNT_SCRIPT = 'C:\\POKEMON\\PTCGPB-ALE\\Accounts\\_InjectAccount.ahk';

function rutaAutoHotkey() {
    const candidatos = [
        'C:\\Program Files\\AutoHotkey\\v1.1.37.02\\AutoHotkeyU64.exe',
        'C:\\Program Files\\AutoHotkey\\v1.1.37.02\\AutoHotkeyU32.exe'
    ];
    return candidatos.find(p => fs.existsSync(p)) || null;
}

function actualizarIniInject(cambios) {
    let contenido = fs.readFileSync(RUTA_INJECT_INI, 'utf16le');
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
    fs.writeFileSync(RUTA_INJECT_INI, salida, 'utf16le');
}

function guardarXlmParaInyeccion(instanceName, archivoPath) {
    const nombreSinExt = path.basename(archivoPath, '.xml');
    actualizarIniInject({
        winTitle: instanceName,
        fileName: nombreSinExt,
        selectedFilePath: archivoPath
    });
}

function leerIniInject() {
    if (!fs.existsSync(RUTA_INJECT_INI)) return {};
    let contenido = fs.readFileSync(RUTA_INJECT_INI, 'utf16le');
    if (contenido.charCodeAt(0) === 0xFEFF) contenido = contenido.slice(1);
    const datos = {};
    for (const linea of contenido.split(/\r?\n/)) {
        const idx = linea.indexOf('=');
        if (idx === -1 || linea.trim().startsWith('[')) continue;
        datos[linea.slice(0, idx).trim()] = linea.slice(idx + 1);
    }
    return datos;
}

function parsearListaFriends() {
    const datos = leerIniInject();
    const ids = (datos.favoriteFriendIDs || '').split(',').map(s => s.trim()).filter(Boolean);
    const labels = (datos.favoriteFriendLabels || '').split('|').map(s => s.trim());
    return ids.map((id, i) => ({ id, label: labels[i] || '' }));
}

function construirEmbedStatusInstancia(index, name) {
    const datos = leerIniInject();
    const friends = parsearListaFriends();

    const listaFriends = friends.length > 0
        ? friends.map((f, i) => `**${i + 1}.** ${f.label || '(no name)'} — \`${f.id}\``).join('\n')
        : '_None added._';

    const xlmCoincide = (datos.winTitle || '').trim() === name && !!(datos.selectedFilePath || '').trim();
    const xlmTexto = (datos.selectedFilePath || '').trim()
        ? `📄 \`${datos.fileName || ''}\`\n📁 \`${datos.selectedFilePath}\`\n🎯 Saved instance: **${datos.winTitle || '(empty)'}** ${xlmCoincide ? '✅ matches this instance' : '⚠️ does NOT match this instance'}`
        : '_No XLM selected._';

    const enviarSolicitud = datos.sendFriendRequestAfterInject === '1' ? '✅ Yes' : '❌ No';

    const embed = new EmbedBuilder()
        .setTitle(`📊 Status — Instance ${index}. ${name}`)
        .addFields(
            { name: `🆔 Saved friends (${friends.length}/10)`, value: listaFriends },
            { name: '💠 XLM for injection', value: xlmTexto },
            { name: '📨 Send request after injecting', value: enviarSolicitud, inline: true }
        )
        .setColor(0x3498DB);

    return { embeds: [embed], ephemeral: true };
}

function agregarFriend(label, friendId) {
    const actuales = parsearListaFriends();
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
    });

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

function ejecutarInyeccionHeadless(callback) {
    const ahkExe = rutaAutoHotkey();
    if (!ahkExe || !fs.existsSync(RUTA_INJECT_ACCOUNT_SCRIPT)) {
        return callback(false, 'faltan_archivos');
    }
    spawnAhkConProteccion(
        ahkExe,
        [RUTA_INJECT_ACCOUNT_SCRIPT, '--headless'],
        { windowsHide: false, cwd: path.dirname(RUTA_INJECT_ACCOUNT_SCRIPT) },
        5 * 60 * 1000,
        callback
    );
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

function resolverNombreCarta(cartaId, rutaMasterPath) {
    if (!rutaMasterPath) return cartaId;
    const cardmaster = leerJsonSeguro(path.join(rutaMasterPath, 'cardmaster.json'));
    const en_US = leerJsonSeguro(path.join(rutaMasterPath, 'en_US.json'));
    const nameKey = cardmaster?.[cartaId]?.Name;
    return (nameKey && en_US?.[nameKey]) ? en_US[nameKey] : cartaId;
}

function buscarXlmPorCarta(rutaJsonCuentas, cartaId) {
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

const XLM_POR_PAGINA = 40;

function construirEmbedXlm(resultados, nombreCarta, cartaId, pagina = 0) {
    const embed = new EmbedBuilder()
        .setTitle(`💠 XLM — ${nombreCarta}`)
        .setColor(0xE91E63);

    if (resultados === null) {
        embed.setDescription('❌ Could not find the configured **JSON Accounts Path** folder.');
        return { embeds: [embed] };
    }

    if (resultados.length === 0) {
        embed.setDescription('This card was not found in any XLM account.');
        return { embeds: [embed] };
    }

    const totalPaginas = Math.max(1, Math.ceil(resultados.length / XLM_POR_PAGINA));
    const paginaSegura = Math.min(Math.max(pagina, 0), totalPaginas - 1);
    const inicio = paginaSegura * XLM_POR_PAGINA;
    const items = resultados.slice(inicio, inicio + XLM_POR_PAGINA);

    const descripcion = items.map(r => `\`${r.fileName}\` — x${r.cantidad} UNITS`).join('\n');

    embed.setDescription(descripcion)
        .setFooter({ text: `Page ${paginaSegura + 1} of ${totalPaginas} • ${resultados.length} account(s) found` });

    if (totalPaginas > 1) {
        return {
            embeds: [embed],
            components: [new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`wishlist_xlm::${cartaId}::${paginaSegura - 1}`).setLabel('◀️ Previous').setStyle(ButtonStyle.Secondary).setDisabled(paginaSegura <= 0),
                new ButtonBuilder().setCustomId(`wishlist_xlm::${cartaId}::${paginaSegura + 1}`).setLabel('Next ▶️').setStyle(ButtonStyle.Secondary).setDisabled(paginaSegura >= totalPaginas - 1)
            )]
        };
    }

    return { embeds: [embed] };
}

function construirSlashCommands() {
    return [
        new SlashCommandBuilder().setName('setup').setDescription('Opens the bot control panel'),
        new SlashCommandBuilder().setName('embed').setDescription('Configures what is shown in the S4T embed'),
        new SlashCommandBuilder().setName('webhook').setDescription('Manages the name and avatar of each channel\'s webhooks'),
        new SlashCommandBuilder().setName('card').setDescription('Runs the All Cards flow')
            .addStringOption(opt => opt.setName('expansion').setDescription('Filter by expansion before picking the name (optional)').setAutocomplete(true).setRequired(false))
            .addStringOption(opt => opt.setName('nombre').setDescription('Search for a card directly by name (optional)').setAutocomplete(true).setRequired(false)),
        new SlashCommandBuilder().setName('wishlist').setDescription('Runs the Cards Wishlist flow')
            .addStringOption(opt => opt.setName('nombre').setDescription('Search for a card in your wishlist directly by name (optional)').setAutocomplete(true).setRequired(false)),
        new SlashCommandBuilder()
            .setName('extract')
            .setDescription('Runs Extract XLM')
            .addSubcommand(subcommand => subcommand.setName('xlm').setDescription('Extract XLM in the selected channel')),
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
// Con el uso normal del chat, el mensaje del panel (editado in situ, nunca
// duplicado) se va quedando cada vez más arriba en el historial — quien
// vuelve después de un rato tiene que scrollear para encontrarlo. Se resuelve
// ACÁ ADENTRO (no con un chequeo aparte disparado por cada interacción,
// que corría en paralelo a esta misma función y terminaba compitiendo por el
// mismo mensaje — dos operaciones a la vez sobre el mismo mensaje es
// exactamente lo que producía el bug de "aparece duplicado"): si ya pasaron 5
// minutos desde la última vez que se movió, esta MISMA llamada (la única que
// va a tocar este mensaje) lo manda de nuevo al final en vez de editarlo donde
// estaba.
const BUMP_INTERVALO_MS = 5 * 60 * 1000;

async function enviarOEditarInterfaz(userId, clave, webhookUrl, payloadJson, archivos = [], forzarReubicar = false) {
    const claveMsg = `interfaz_msg_${clave}`;
    const filaMsg = await db.get(`SELECT estado FROM configs_extras WHERE discord_id = ? AND tipo = ?`, [userId, claveMsg]);
    const msgId = filaMsg?.estado || null;

    if (msgId && !forzarReubicar) {
        const claveTiempo = `ultimo_bump_${clave}`;
        const filaTiempo = await db.get(`SELECT estado FROM configs_extras WHERE discord_id = ? AND tipo = ?`, [userId, claveTiempo]);
        const ultimoBump = filaTiempo ? Number(filaTiempo.estado) : 0;
        if (Date.now() - ultimoBump >= BUMP_INTERVALO_MS) forzarReubicar = true;
    }
    if (forzarReubicar) {
        await db.run(
            `INSERT INTO configs_extras (discord_id, tipo, estado) VALUES (?, ?, ?) ON CONFLICT(discord_id, tipo) DO UPDATE SET estado = ?`,
            [userId, `ultimo_bump_${clave}`, String(Date.now()), String(Date.now())]
        );
    }

    // Reubicar = mandarlo de nuevo al final del historial en vez de editarlo
    // donde ya estaba — hace falta borrar el viejo primero, si no queda uno
    // parado en el medio del chat y otro nuevo al final (duplicado).
    if (msgId && forzarReubicar) {
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
        archivos.forEach((a, i) => form.append(`files[${i}]`, fs.createReadStream(a.ruta), { filename: a.filename }));
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

async function enviarComandoAlCanal(commandKey, user, row, forzarReubicar = false) {
    if (commandKey === 'card_wishlist') {
        const embed = construirEmbedWishlistInicio(user);
        const fila = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('wishlist_ver').setLabel('📋 View my Wishlist').setStyle(ButtonStyle.Primary)
        );

        const bannerPath = path.join(__dirname, 'assets', 'embeds', 'wishlist_banner.png');
        const thumbPath = path.join(__dirname, 'assets', 'embeds', 'wish.png');
        const archivos = [];
        if (fs.existsSync(bannerPath)) {
            embed.setImage('attachment://wishlist_banner.png');
            archivos.push({ ruta: bannerPath, filename: 'wishlist_banner.png' });
        }
        if (fs.existsSync(thumbPath)) {
            embed.setThumbnail('attachment://wish.png');
            archivos.push({ ruta: thumbPath, filename: 'wish.png' });
        }
        await enviarOEditarInterfaz(user.id, commandKey, row.webhook_url, { embeds: [embed], components: [fila] }, archivos, forzarReubicar);
        return;
    }
    if (commandKey === 'card_all') {
        const embed = construirEmbedAllCardsInicio(user);
        const fila = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('allcards_ver_expansiones').setLabel('📋 View All Expansions').setStyle(ButtonStyle.Primary)
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
        await enviarOEditarInterfaz(user.id, commandKey, row.webhook_url, { embeds: [embed], components: [fila] }, archivos, forzarReubicar);
        return;
    }
    if (commandKey === 'extract_xlm') {
        const embed = construirEmbedExtractXlmInicio(user);
        const fila = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('extract_xlm_abrir').setLabel('📋 Paste XLM').setStyle(ButtonStyle.Primary)
        );
        await enviarOEditarInterfaz(user.id, commandKey, row.webhook_url, { embeds: [embed], components: [fila] }, [], forzarReubicar);
        return;
    }
    if (commandKey === 'run_instance') {
        const embed = construirEmbedRunInstanceInicio(user);
        const fila = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('mumu_ver_instancias').setLabel('🎮 View Instances').setStyle(ButtonStyle.Primary)
        );
        await enviarOEditarInterfaz(user.id, commandKey, row.webhook_url, { embeds: [embed], components: [fila] }, [], forzarReubicar);
        return;
    }
    const embed = construirEmbedComando(commandKey, user);
    await enviarOEditarInterfaz(user.id, commandKey, row.webhook_url, { embeds: [embed] }, [], forzarReubicar);
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
        await enviarComandoAlCanal(commandKey, interaction.user, row, true);
        return await interaction.editReply({ content: `✅ **${cfg.label}** sent successfully.` });
    } catch (error) {
        console.error(`Error enviando ${commandKey}:`, error?.response?.data || error?.message || error);
        return await interaction.editReply({ content: `❌ Could not send **${cfg.label}**.` });
    }
}

function verificarEstadoPM2(nombreProceso, script = null) {
    return new Promise((resolve) => {
        exec('pm2 jlist', { windowsHide: true }, (err, stdout) => {
            if (err) return resolve('🔴 OFFLINE');
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

let _cardTypesCacheBot = null;
function cargarCardTypesBot() {
    if (_cardTypesCacheBot) return _cardTypesCacheBot;
    try {
        _cardTypesCacheBot = JSON.parse(fs.readFileSync(path.join(__dirname, 'assets', 'card_types.json'), 'utf8'));
    } catch (e) {
        _cardTypesCacheBot = {};
    }
    return _cardTypesCacheBot;
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
        const tipoIngles = cardTypes[nombre.toLowerCase()];
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
            '**An excellent trade has been detected.**\nSaved to the S4T database.\n\n' +
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
            '**An excellent trade has been detected.**\nSaved to the S4T database.\n\n' +
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
            '**A wishlist card has been detected.**\nSaved to the S4T database.\n\n' +
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

    filas.push(new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('build_guardar').setLabel('💾 Save').setStyle(ButtonStyle.Success)
    ));

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

    const embed = new EmbedBuilder()
        .setTitle(' 👑  Pokemon Home PTCGPB!  👑​')
        .setDescription(
            `Hello! With this bot you can monitor your instances in a more organized, remote, and real-time way.\n\n` +
            `**🔥​ PROCESS CONTROL PANEL 🔥**\n\n` +
            `⚡ **Basic Infrastructure Status:**\n` +
            `• 🚀 **S4T Module:** \`${estadoS4T}\`\n` +
            `• 💓 **Heartbeat Module:** \`${estadoHB}\`\n\n` +
            `**🎴 Available Features:**\n` +
            `• 💖 **Cards Wishlist** — check and search the cards in your wishlist.\n` +
            `• ⚡ **All Cards** — browse the full catalog of cards in the game.\n` +
            `• 📄 **Extract XLM** — paste an account name and get its XML + JSON.\n` +
            `• 🔄 **Auto Trade** — open a MuMu instance and inject, add friends, and run trades without touching anything manually.\n\n` +
            `*Press the buttons to interact with the bot's ecosystem.*`
        )
        .setColor(0x9B59B6)
        .setFooter({ text: " Bot By Ale Cast ୨♡୧ • PTCGPB Remote Control" })
        .setTimestamp();

    const filaSistema = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('toggle_trading').setLabel('🚀 S4T On/Off').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('toggle_heartbeat').setLabel('💓 Heartbeat On/Off').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('btn_crear_canales_menu').setLabel('🏗️ Sync Channels').setStyle(ButtonStyle.Secondary)
    );

    const filaGestion = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('btn_status').setLabel('📊 Status').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('btn_config_canales').setLabel('⚙️ Configuration').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('btn_ruta_raiz').setLabel('📂 Main Path').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('btn_check_updates').setLabel('🔄 Check for Updates').setStyle(ButtonStyle.Secondary)
    );

    const filaPeligro = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('btn_reset_total').setLabel('🗑️ Reset Total').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('btn_borrar_todo').setLabel('🗑️ Delete Channels').setStyle(ButtonStyle.Danger)
    );

    const filaCartas = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('panel_wishlist').setLabel('💖 Cards Wishlist').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('panel_allcards').setLabel('⚡ All Cards').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('panel_extract_xlm').setLabel('📄 Extract XLM').setStyle(ButtonStyle.Primary)
    );

    const filaTrade = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('panel_run_instance').setLabel('🔄 Auto Trade').setStyle(ButtonStyle.Success)
    );

    return { embeds: [embed], components: [filaSistema, filaGestion, filaPeligro, filaCartas, filaTrade] };
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
            return { cartas: obtenerCartasWishlist(rutaWishlistCfg, rutaMasterCfg), rutaMasterPath: rutaMasterCfg?.webhook_url };
        }
    },
    allcards: {
        tituloLista: '📋 All Cards',
        vacioTexto: 'No cards found.',
        contexto: 'the catalog',
        errorSinDatos: '❌ cardmaster.json not found. Check the **Data Master Path** configured in the panel.',
        obtenerCartas: obtenerTodasLasCartasCacheadas
    }
};

function prefijoDeCartas(customId) {
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

        // Campo "nombre": si ya se eligió una expansión, filtra solo dentro de
        // esa expansión primero (a pedido del usuario, para desambiguar cartas
        // con el mismo nombre repetidas en varios sets).
        const expansionElegida = interaction.options.getString('expansion');
        const porExpansion = expansionElegida ? base.filter(c => c.expansion === expansionElegida) : base;
        const coincidencias = (focused ? porExpansion.filter(c => c.nombre.toLowerCase().includes(focused)) : porExpansion)
            .slice(0, 25)
            .map(c => ({ name: `${c.nombre} — ${c.expansion} (${c.categoria})`.slice(0, 100), value: c.id }));
        return interaction.respond(coincidencias).catch(() => {});
    }

    // Búsqueda directa por nombre vía autocompletado de /card, sin pasar por
    // el banner+botón de "All Cards" — mismo canal/permiso que ese flujo.
    if (interaction.isChatInputCommand() && interaction.commandName === 'card' && interaction.options.getString('nombre')) {
        const cartaId = interaction.options.getString('nombre');
        const rowCardAll = await obtenerCanalComando(interaction.user.id, 'cmd_card_all');
        if (!rowCardAll) {
            return await interaction.reply({ content: `❌ No channel synced for **All Cards**. Use **Sync Channels** first.`, ephemeral: true });
        }
        if (interaction.channelId !== rowCardAll.canal_id) {
            return await interaction.reply({ content: `❌ This command only works in <#${rowCardAll.canal_id}>.`, ephemeral: true });
        }
        await interaction.deferReply({ ephemeral: true });
        const { cartas, rutaMasterPath } = await obtenerTodasLasCartasCacheadas();
        const carta = (cartas || []).find(c => c.id === cartaId);
        if (!carta) return await interaction.editReply({ content: '❌ Card not found.' });
        const payload = await construirEmbedDetalleCarta(carta.id, carta.nombre, rutaMasterPath, null, interaction.guild);
        return await interaction.editReply(payload);
    }

    if (interaction.isAutocomplete() && interaction.commandName === 'wishlist') {
        const focused = interaction.options.getFocused().trim().toLowerCase();
        const { cartas } = await FUENTES_CARTAS.wishlist.obtenerCartas();
        const base = cartas || [];
        const coincidencias = (focused ? base.filter(c => c.nombre.toLowerCase().includes(focused)) : base)
            .slice(0, 25)
            .map(c => ({ name: `${c.nombre} — ${c.expansion} (${c.categoria})`.slice(0, 100), value: c.id }));
        return interaction.respond(coincidencias).catch(() => {});
    }

    // Búsqueda directa por nombre vía autocompletado de /wishlist, sin pasar por
    // el banner+botón de "Cards Wishlist" — mismo canal/permiso que ese flujo.
    if (interaction.isChatInputCommand() && interaction.commandName === 'wishlist' && interaction.options.getString('nombre')) {
        const cartaId = interaction.options.getString('nombre');
        const rowWishlist = await obtenerCanalComando(interaction.user.id, 'cmd_card_wishlist');
        if (!rowWishlist) {
            return await interaction.reply({ content: `❌ No channel synced for **Cards Wishlist**. Use **Sync Channels** first.`, ephemeral: true });
        }
        if (interaction.channelId !== rowWishlist.canal_id) {
            return await interaction.reply({ content: `❌ This command only works in <#${rowWishlist.canal_id}>.`, ephemeral: true });
        }
        await interaction.deferReply({ ephemeral: true });
        const { cartas, rutaMasterPath } = await FUENTES_CARTAS.wishlist.obtenerCartas();
        const carta = (cartas || []).find(c => c.id === cartaId);
        if (!carta) return await interaction.editReply({ content: '❌ Card not found in your wishlist.' });
        const payload = await construirEmbedDetalleCarta(carta.id, carta.nombre, rutaMasterPath, null, interaction.guild);
        return await interaction.editReply(payload);
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
        if (rowSetup && interaction.channelId !== rowSetup.canal_id) {
            return await interaction.reply({ content: `❌ This command only works in <#${rowSetup.canal_id}>.`, ephemeral: true });
        }
        const panel = await generarPanelControl(interaction.user.id);
        if (rowSetup) {
            // Un solo panel parado en el canal (se edita in situ), en vez de uno
            // nuevo cada vez que alguien corre /setup de nuevo — pero correrlo a
            // mano sí lo manda al final del historial, sin esperar el chequeo
            // automático de 5 minutos.
            await interaction.deferReply({ ephemeral: true });
            await enviarOEditarInterfaz(interaction.user.id, 'setup', rowSetup.webhook_url, panel, [], true);
            return await interaction.editReply({ content: '✅ Panel updated.' });
        }
        await interaction.deferReply();
        return await interaction.editReply(panel);
    }

    if (interaction.isChatInputCommand() && interaction.commandName === 'embed') {
        if (!tienePermisosGestion(interaction)) {
            return await interaction.reply({ content: '❌ Only administrators or users with the Manage Server permission can use this panel.', ephemeral: true });
        }
        const rowBuild = await obtenerCanalComando(interaction.user.id, 'cmd_build_embed');
        if (rowBuild && interaction.channelId !== rowBuild.canal_id) {
            return await interaction.reply({ content: `❌ This command only works in <#${rowBuild.canal_id}>.`, ephemeral: true });
        }
        await interaction.deferReply({ ephemeral: true });
        const panelBuild = await generarPanelBuildEmbed(interaction.user.id, interaction.guild);
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

    if (interaction.isChatInputCommand() && interaction.commandName === 'webhook') {
        if (!tienePermisosGestion(interaction)) {
            return await interaction.reply({ content: '❌ Only administrators or users with the Manage Server permission can use this panel.', ephemeral: true });
        }
        const rowWebhook = await obtenerCanalComando(interaction.user.id, 'cmd_build_webhooks');
        if (rowWebhook && interaction.channelId !== rowWebhook.canal_id) {
            return await interaction.reply({ content: `❌ This command only works in <#${rowWebhook.canal_id}>.`, ephemeral: true });
        }
        await interaction.deferReply({ ephemeral: true });
        const panel = await construirPanelListaWebhooks(interaction.user.id);
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

    if (interaction.isStringSelectMenu() && interaction.customId === 'webhook_seleccionar') {
        await interaction.deferUpdate();
        const tipo = interaction.values[0];
        const panel = await construirPanelDetalleWebhook(interaction.user.id, tipo);
        if (!panel) return await interaction.editReply({ content: '❌ Webhook not found.', embeds: [], components: [] });
        return await interaction.editReply(panel);
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
                resultado = agregarFriend(friendLabel, friendId);
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

        if (interaction.customId.startsWith('modal_mumu_xlm::')) {
            const [, , nombre] = interaction.customId.split('::');
            const nombreBuscado = interaction.fields.getTextInputValue('input_xlm_nombre');

            await interaction.deferReply({ ephemeral: true });
            const rutaXmlCfg = await db.get(`SELECT webhook_url FROM configs_canales WHERE tipo = 'ruta_xml_cuentas'`);
            const archivo = buscarArchivoXmlPorNombre(rutaXmlCfg?.webhook_url, nombreBuscado);

            if (!archivo) {
                return await interaction.editReply({ content: `❌ File \`${nombreBuscado}\` not found. Check the configured **XML Accounts Path**.` });
            }

            try {
                guardarXlmParaInyeccion(nombre, archivo);
            } catch (e) {
                return await interaction.editReply({ content: '❌ Could not save the selection to InjectAccount.ini.' });
            }

            return await interaction.editReply({ content: `✅ Saved \`${path.basename(archivo)}\` to inject into instance **${nombre}**. Ready to use in Inject XLM.` });
        }

        if (interaction.customId === 'modal_extract_xlm') {
            await interaction.deferReply({ ephemeral: true });
            const nombreBuscado = interaction.fields.getTextInputValue('input_xlm_nombre');
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
                ['ruta_wishlist', derivadas.wishlist]
            ];
            for (const [tipo, valor] of filas) {
                await db.run(`INSERT INTO configs_canales (discord_id, tipo, canal_id, webhook_url) VALUES (?, ?, 'local', ?) ON CONFLICT(discord_id, tipo) DO UPDATE SET webhook_url = ?`, [interaction.user.id, tipo, valor, valor]);
            }

            return await interaction.editReply({
                content: `✅ Main Path saved: \`${raiz}\`\n\nAutomatically detected:\n📂 Local: \`${derivadas.local}\`\n📂 Data Master: \`${derivadas.master}\`\n📂 XML Accounts: \`${derivadas.xml}\`\n📂 JSON Accounts: \`${derivadas.json}\`\n📂 Wishlist: \`${derivadas.wishlist}\``
            });
        }

        return await configScript.manejarModal(interaction);
    }

    if (interaction.isStringSelectMenu() && (interaction.customId === 'wishlist_expansion_seleccion' || interaction.customId === 'allcards_expansion_seleccion')) {
        await interaction.deferUpdate();
        const prefijo = prefijoDeCartas(interaction.customId);
        const fuente = FUENTES_CARTAS[prefijo];
        const expansionElegida = interaction.values[0];
        const { cartas } = await fuente.obtenerCartas();
        const mapaEmojis = await obtenerMapaEmojisGuild(interaction.guild);
        const payload = construirEmbedCategoriasPorExpansion(cartas || [], expansionElegida, { prefijo, contexto: fuente.contexto, mapaEmojis });
        return await interaction.editReply(payload);
    }

    if (interaction.isStringSelectMenu() && (interaction.customId === 'wishlist_categoria_seleccion' || interaction.customId === 'allcards_categoria_seleccion')) {
        await interaction.deferUpdate();
        const prefijo = prefijoDeCartas(interaction.customId);
        const fuente = FUENTES_CARTAS[prefijo];
        const separador = interaction.values[0].indexOf('::');
        const expansion = interaction.values[0].slice(0, separador);
        const categoria = interaction.values[0].slice(separador + 2);
        const { cartas } = await fuente.obtenerCartas();
        const mapaEmojis = await obtenerMapaEmojisGuild(interaction.guild);
        const payload = construirEmbedCartasPorExpansion(cartas || [], expansion, categoria, 0, { prefijo, contexto: fuente.contexto, mapaEmojis });
        return await interaction.editReply(payload);
    }

    if (interaction.isStringSelectMenu() && (interaction.customId.startsWith('wishlist_carta_seleccion::') || interaction.customId.startsWith('allcards_carta_seleccion::'))) {
        await interaction.deferUpdate();
        const prefijo = prefijoDeCartas(interaction.customId);
        const fuente = FUENTES_CARTAS[prefijo];
        const [, expansion, categoria, pagina] = interaction.customId.split('::');
        const cartaId = interaction.values[0];
        const { cartas, rutaMasterPath } = await fuente.obtenerCartas();
        const carta = (cartas || []).find(c => c.id === cartaId);
        const payload = await construirEmbedDetalleCarta(cartaId, carta?.nombre || cartaId, rutaMasterPath, { prefijo, expansion, categoria, pagina }, interaction.guild);
        return await interaction.editReply(payload);
    }

    if (interaction.isButton() && (interaction.customId.startsWith('wishlist_volver_carta_lista::') || interaction.customId.startsWith('allcards_volver_carta_lista::'))) {
        await interaction.deferUpdate();
        const prefijo = prefijoDeCartas(interaction.customId);
        const fuente = FUENTES_CARTAS[prefijo];
        const [, expansion, categoria, pagina] = interaction.customId.split('::');
        const { cartas } = await fuente.obtenerCartas();
        const mapaEmojis = await obtenerMapaEmojisGuild(interaction.guild);
        const payload = construirEmbedCartasPorExpansion(cartas || [], expansion, categoria, parseInt(pagina, 10) || 0, { prefijo, contexto: fuente.contexto, mapaEmojis });
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

    if (interaction.isChannelSelectMenu() || (interaction.isStringSelectMenu() && interaction.customId === 'select_reset_modulo')) {
        if (!tienePermisosGestion(interaction)) {
            return await interaction.reply({ content: "❌ You don't have permission to change the bot's settings.", ephemeral: true });
        }
        return await configScript.manejarMenuCanales(interaction);
    }

    if (interaction.isButton()) {
        if (['panel_wishlist', 'panel_allcards', 'panel_extract_xlm', 'panel_run_instance'].includes(interaction.customId)) {
            const commandKey = { panel_wishlist: 'card_wishlist', panel_allcards: 'card_all', panel_extract_xlm: 'extract_xlm', panel_run_instance: 'run_instance' }[interaction.customId];
            const cfg = COMANDO_CONFIG[commandKey];
            const row = await obtenerCanalComando(interaction.user.id, cfg.tipo);

            if (!row) {
                return await interaction.reply({ content: `❌ No channel synced for **${cfg.label}**. Use **Sync Channels** first.`, ephemeral: true });
            }

            await interaction.deferReply({ ephemeral: true });
            try {
                await enviarComandoAlCanal(commandKey, interaction.user, row);
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
            await interaction.deferReply({ ephemeral: true });
            const { cartas } = await FUENTES_CARTAS.allcards.obtenerCartas();
            if (cartas === null) {
                return await interaction.editReply({ content: FUENTES_CARTAS.allcards.errorSinDatos });
            }
            const payload = construirEmbedResumenExpansiones(cartas, { prefijo: 'allcards' });
            return await interaction.editReply(payload);
        }

        if (/^(wishlist|allcards)_ver$/.test(interaction.customId) || /^(wishlist|allcards)_pagina_-?\d+$/.test(interaction.customId)) {
            const prefijo = prefijoDeCartas(interaction.customId);
            const fuente = FUENTES_CARTAS[prefijo];
            const esPrimeraVez = interaction.customId === `${prefijo}_ver`;
            const pagina = esPrimeraVez ? 0 : (parseInt(interaction.customId.replace(`${prefijo}_pagina_`, ''), 10) || 0);

            const { cartas } = await fuente.obtenerCartas();

            if (cartas === null) {
                if (esPrimeraVez) return await interaction.reply({ content: fuente.errorSinDatos, ephemeral: true });
                return await interaction.update({ content: fuente.errorSinDatos, embeds: [], components: [] });
            }

            const mapaEmojis = await obtenerMapaEmojisGuild(interaction.guild);
            const payload = construirEmbedListaCartas(cartas, pagina, { prefijo, titulo: fuente.tituloLista, vacioTexto: fuente.vacioTexto, mapaEmojis });
            if (esPrimeraVez) return await interaction.reply({ ...payload, ephemeral: true });
            return await interaction.update(payload);
        }

        if (interaction.customId.startsWith('wishlist_expansion_pagina_') || interaction.customId.startsWith('allcards_expansion_pagina_')) {
            await interaction.deferUpdate();
            const prefijo = prefijoDeCartas(interaction.customId);
            const fuente = FUENTES_CARTAS[prefijo];
            const resto = interaction.customId.replace(`${prefijo}_expansion_pagina_`, '');
            const [paginaTexto, expansion, categoria] = resto.split('::');
            const pagina = parseInt(paginaTexto, 10) || 0;

            const { cartas } = await fuente.obtenerCartas();
            const mapaEmojisPagina = await obtenerMapaEmojisGuild(interaction.guild);
            const payload = construirEmbedCartasPorExpansion(cartas || [], expansion, categoria, pagina, { prefijo, contexto: fuente.contexto, mapaEmojis: mapaEmojisPagina });
            return await interaction.editReply(payload);
        }

        if (interaction.customId.startsWith('wishlist_volver_categorias::') || interaction.customId.startsWith('allcards_volver_categorias::')) {
            await interaction.deferUpdate();
            const prefijo = prefijoDeCartas(interaction.customId);
            const fuente = FUENTES_CARTAS[prefijo];
            const expansion = interaction.customId.replace(`${prefijo}_volver_categorias::`, '');
            const { cartas } = await fuente.obtenerCartas();
            const mapaEmojisVolver = await obtenerMapaEmojisGuild(interaction.guild);
            const payload = construirEmbedCategoriasPorExpansion(cartas || [], expansion, { prefijo, contexto: fuente.contexto, mapaEmojis: mapaEmojisVolver });
            return await interaction.editReply(payload);
        }

        if (interaction.customId === 'wishlist_volver_expansiones' || interaction.customId === 'allcards_volver_expansiones') {
            await interaction.deferUpdate();
            const prefijo = prefijoDeCartas(interaction.customId);
            const fuente = FUENTES_CARTAS[prefijo];
            const { cartas } = await fuente.obtenerCartas();
            const mapaEmojisExpansiones = await obtenerMapaEmojisGuild(interaction.guild);
            const payload = prefijo === 'allcards'
                ? construirEmbedResumenExpansiones(cartas || [], { prefijo })
                : construirEmbedListaCartas(cartas || [], 0, { prefijo, titulo: fuente.tituloLista, vacioTexto: fuente.vacioTexto, mapaEmojis: mapaEmojisExpansiones });
            return await interaction.editReply(payload);
        }

        if (interaction.customId === 'extract_xlm_abrir') {
            const modalExtract = new ModalBuilder().setCustomId('modal_extract_xlm').setTitle('Extract XLM')
                .addComponents(new ActionRowBuilder().addComponents(
                    new TextInputBuilder().setCustomId('input_xlm_nombre').setLabel('XLM file name').setStyle(TextInputStyle.Short)
                ));
            return await interaction.showModal(modalExtract);
        }

        if (interaction.customId === 'mumu_ver_instancias') {
            const instancias = obtenerInstanciasMuMu();
            if (instancias === null) {
                return await interaction.reply({ content: '❌ MuMuManager.exe not found. Check that MuMuPlayer is installed.', ephemeral: true });
            }
            const payload = construirEmbedInstanciasMuMu(instancias);
            return await interaction.reply({ ...payload, ephemeral: true });
        }

        if (interaction.customId.startsWith('mumu_encender_')) {
            const [index, nombre] = interaction.customId.replace('mumu_encender_', '').split('::');
            await interaction.deferUpdate();
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

            const datosIni = leerIniInject();
            if ((datosIni.winTitle || '').trim() !== nombre || !(datosIni.selectedFilePath || '').trim()) {
                return await interaction.editReply({ content: `❌ First select the XLM with the 💠 XLM button for instance **${nombre}**.` });
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
            });
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
            const payload = construirEmbedStatusInstancia(index, nombre);
            return await interaction.reply({ ...payload, ephemeral: true });
        }

        if (interaction.customId.startsWith('mumu_xlm_')) {
            const [index, nombre] = interaction.customId.replace('mumu_xlm_', '').split('::');
            const modalXlm = new ModalBuilder().setCustomId(`modal_mumu_xlm::${index}::${nombre}`).setTitle('Prepare XLM Injection')
                .addComponents(new ActionRowBuilder().addComponents(
                    new TextInputBuilder().setCustomId('input_xlm_nombre').setLabel('XLM file name').setStyle(TextInputStyle.Short)
                ));
            return await interaction.showModal(modalXlm);
        }

        if (interaction.customId.startsWith('wishlist_xlm::')) {
            // El mismo customId sirve para el botón inicial (viene del detalle de
            // carta, mensaje nuevo) y para paginar (edita el mensaje de XLM que ya
            // está abierto) — se distingue mirando de qué embed vino el click.
            const yaEsVistaXlm = interaction.message?.embeds?.[0]?.title?.startsWith('💠 XLM');
            if (yaEsVistaXlm) await interaction.deferUpdate();
            else await interaction.deferReply({ ephemeral: true });

            const [, cartaId, paginaTexto] = interaction.customId.split('::');
            const pagina = parseInt(paginaTexto, 10) || 0;
            const rutaMasterCfg = await db.get(`SELECT webhook_url FROM configs_canales WHERE tipo = 'ruta_master'`);
            const rutaJsonCfg = await db.get(`SELECT webhook_url FROM configs_canales WHERE tipo = 'ruta_json_cuentas'`);
            const nombreCarta = resolverNombreCarta(cartaId, rutaMasterCfg?.webhook_url);
            const resultados = buscarXlmPorCarta(rutaJsonCfg?.webhook_url, cartaId);
            const payload = construirEmbedXlm(resultados, nombreCarta, cartaId, pagina);
            return await interaction.editReply(payload);
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
                                (remotaVer.notes || []).map(n => `• ${n}`).join('\n')
                            );
                        const filaUpdate = new ActionRowBuilder().addComponents(
                            new ButtonBuilder().setCustomId('actualizacion_ahora').setLabel('Update now').setStyle(ButtonStyle.Success),
                            new ButtonBuilder().setCustomId('actualizacion_luego').setLabel('Later').setStyle(ButtonStyle.Secondary)
                        );
                        await interaction.editReply({ embeds: [embedUpdate], components: [filaUpdate] });
                    } else {
                        await interaction.editReply({ content: `✅ You're on the latest version (**${localVer.version}**).` });
                    }
                } catch (e) {
                    await interaction.editReply({ content: '❌ Could not check for updates right now. Try again later.' });
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
                                { tipo: 'apoyo', name: '💝-support-my-work' },
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
                                { tipo: 'cmd_extract_xlm', name: '📄-extract-xlm' }
                            ]
                        },
                        {
                            categoria: '🎮 RUN MUMU PLAYER 🎮',
                            tipoCategoria: 'run_mumu_categoria',
                            canales: [
                                { tipo: 'cmd_run_instance', name: '📄-open-mumuplayer' }
                            ]
                        }
                    ];

                    // Solo canales que tienen un comando real asignado (aunque no se pueda
                    // "ejecutar" solo, como /embed, /webhook, /feedback) o que explican algo
                    // que no se repite (Updates/Support) reciben un embed al sincronizar. El
                    // resto (rareza, godpacks, s4t, heartbeat, wishlist-feed) no tiene ningún
                    // comando propio — meter un embed ahí es ruido innecesario en canales que
                    // además reciben cartas todo el tiempo.
                    const EMBEDS_BIENVENIDA_POR_TIPO = {
                        actualizaciones: { title: '🔔 Updates', description: 'You\'ll get notified here whenever there\'s a new bot update, with a button to install it right away.' },
                        apoyo: { title: '💝 Support this project', description: 'If this bot has been useful to you, any support to keep improving it is appreciated. Thanks for using it! 💛' },
                        cmd_build_embed: { title: '🔧 Build Embed', description: 'This is where you use `/embed` to configure what information is shown in the embeds for found cards.' },
                        cmd_build_webhooks: { title: '🔗 Build Webhooks', description: 'This is where you use `/webhook` to change the name and avatar of each channel\'s webhooks.' },
                        cmd_feedback: { title: '📝 Feedback', description: 'This is where you use `/feedback` to send suggestions, report problems, or share your thoughts about the bot — you can attach a screenshot too.' }
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

                    // Un webhook borrado (por lo que sea, incluso fuera de este bot) sigue
                    // guardado en la DB con su URL de siempre — Discord no avisa, solo
                    // empieza a devolver 404 "Unknown Webhook" al usarlo. Sin este chequeo,
                    // "Sincronizar Canales" nunca se entera y el canal queda roto para
                    // siempre hasta borrarlo a mano.
                    const webhookEstaVivo = async (url) => {
                        try {
                            await axios.get(url, { timeout: 5000 });
                            return true;
                        } catch (e) {
                            return false;
                        }
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

                        const webhooks = await canal.fetchWebhooks();
                        const existingHooks = webhooks.filter(w => w.name === `Bot ${tipo}`);
                        for (const oldWebhook of existingHooks.values()) {
                            await oldWebhook.delete('Recreating invalid webhook').catch(console.error);
                        }

                        const webhook = await canal.createWebhook({ name: `Bot ${tipo}`, avatar: 'https://i.imgur.com/gK1q9yS.png' });
                        await db.run(`DELETE FROM configs_canales WHERE discord_id = ? AND tipo = ?`, [interaction.user.id, tipo]);
                        await db.run(`INSERT INTO configs_canales (discord_id, tipo, canal_id, webhook_url) VALUES (?, ?, ?, ?)`, [interaction.user.id, tipo, canal.id, webhook.url]);

                        const commandKeyReal = COMANDOS_REALES_POR_TIPO[tipo];
                        if (commandKeyReal) {
                            await enviarComandoAlCanal(commandKeyReal, interaction.user, { webhook_url: webhook.url, canal_id: canal.id });
                        } else if (tipo === 'cmd_setup') {
                            const panel = await generarPanelControl(interaction.user.id);
                            await enviarOEditarInterfaz(interaction.user.id, 'setup', webhook.url, panel);
                        } else {
                            const embedBienvenida = EMBEDS_BIENVENIDA_POR_TIPO[tipo];
                            if (embedBienvenida) {
                                await enviarOEditarInterfaz(interaction.user.id, tipo, webhook.url, { embeds: [{ color: 0xF0A93A, ...embedBienvenida }] });
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
                setTimeout(async () => interaction.editReply(await generarPanelControl(interaction.user.id)), 1500);
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
                setTimeout(async () => interaction.editReply(await generarPanelControl(interaction.user.id)), 1500);
                break;

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

    // El bot está pensado para quedarse prendido semanas sin reiniciarse —
    // si el chequeo de actualización solo corriera acá (una sola vez al
    // arrancar), alguien que nunca lo reinicia nunca se enteraría de una
    // versión nueva. Se repite cada 6 horas, sin tocar nada del proceso.
    setInterval(() => chequearActualizaciones(client), 6 * 60 * 60 * 1000);
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