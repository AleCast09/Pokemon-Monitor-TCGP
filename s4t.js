require('dotenv').config();
const express = require('express');
const axios = require('axios');
const multer = require('multer');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');
const sharp = require('./native-require.js')('sharp');
const db = require('./database.js');
const { iniciarAutoSyncCardTypes } = require('./card-types-sync.js');
iniciarAutoSyncCardTypes();

const INGEST_AUTH_TOKEN = process.env.INGEST_AUTH_TOKEN || '';
const REQUIRE_INGEST_AUTH = /^true$/i.test(process.env.REQUIRE_INGEST_AUTH || (process.env.NODE_ENV === 'production' ? 'true' : 'false'));
const S4T_FORWARD_XML = /^true$/i.test(process.env.S4T_FORWARD_XML || 'false');
const CAMPO_INVISIBLE = '​';

function validarIngestToken(req) {
    if (!REQUIRE_INGEST_AUTH) return true;
    if (!INGEST_AUTH_TOKEN) return false;
    const headerToken = req.headers['x-ingest-token'] || req.headers['x-bot-token'];
    return headerToken === INGEST_AUTH_TOKEN;
}

function redactarValor(valor, visibles = 4) {
    if (!valor) return 'none';
    const texto = String(valor);
    if (texto.length <= visibles) return '*'.repeat(texto.length);
    return `${texto.slice(0, visibles)}...${texto.slice(-2)}`;
}

function rutaSegura(ruta) {
    if (!ruta) return 'none';
    return path.basename(String(ruta)) || 'none';
}

function cargarJson(ruta) {
    let content = fs.readFileSync(ruta, 'utf8');
    if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1);
    return JSON.parse(content);
}

function obtenerMapa(rutaMaster) {
    try {
        const cardmaster = cargarJson(path.join(rutaMaster, 'cardmaster.json'));
        const en_US = cargarJson(path.join(rutaMaster, 'en_US.json'));
        // ExpansionID NO vive en cardmaster.json (ahi solo hay Name/Rarity/IllustrationID) --
        // vive en cardmap.json, el mismo archivo que ya usa el resto del bot para las fotos HD
        // de Drive. Se carga aca tambien para poder desempatar reimpresiones (ver mas abajo).
        let cardmapExpansiones = {};
        try {
            const cardmapPath = path.join(rutaMaster, 'cardmap.json');
            if (fs.existsSync(cardmapPath)) cardmapExpansiones = cargarJson(cardmapPath);
        } catch (e) { /* sin cardmap.json, expansionId queda undefined y no se desempata por expansion */ }
        let mapa = {};
        // Un mismo nombre puede tener varias variantes/rarezas (ej. "Pikachu" común
        // y "Pikachu" 1-star); se guardan TODAS para poder elegir la correcta según
        // la rareza detectada, en vez de quedarnos solo con la última encontrada.
        for (let id in cardmaster) {
            let nombreIngles = en_US[cardmaster[id].Name];
            if (nombreIngles) {
                const clave = normalizeText(nombreIngles);
                if (!mapa[clave]) mapa[clave] = [];
                // expansionId sumado (2026-08-14, bug real reportado: "Lillie" del sobre Deluxe
                // Pack: ex salio con el arte de la Lillie de Celestial Guardians) -- antes, cuando
                // habia mas de una carta con el mismo nombre+rareza pero de EXPANSIONES distintas
                // (reimpresiones), no habia forma de distinguirlas aca y quedaba a la suerte del
                // orden del objeto. Ahora resolverImagen puede preferir la que sea de la expansion
                // real del sobre antes de resignarse a "la primera que aparezca".
                mapa[clave].push({ code: id, rarity: cardmaster[id].Rarity, illustrationId: cardmaster[id].IllustrationID, expansionId: cardmapExpansiones[id]?.ExpansionID });
            }
        }
        return mapa;
    } catch (e) {
        console.log('DEBUG: Error cargando mapas:', e);
        return {};
    }
}

function cargarMaster(rutaMaster) {
    try {
        return {
            cardmaster: cargarJson(path.join(rutaMaster, 'cardmaster.json')),
            en_US: cargarJson(path.join(rutaMaster, 'en_US.json'))
        };
    } catch (e) {
        console.log('DEBUG: Error cargando cardmaster/en_US:', e);
        return { cardmaster: {}, en_US: {} };
    }
}

function cargarCardMap(rutaMaster) {
    if (!rutaMaster) return {};
    const posibles = [
        path.join(rutaMaster, 'Helper', 'cardmap.json'),
        path.join(rutaMaster, 'cardmap.json'),
        path.join(rutaMaster, 'CardImageCache', 'cardmap.json')
    ];
    for (const p of posibles) {
        try {
            if (fs.existsSync(p)) {
                console.log('DEBUG: Cargando cardmap desde:', p);
                return cargarJson(p);
            }
        } catch (e) {
            continue;
        }
    }
    return {};
}

function normalizeText(text) {
    // \s también matchea espacios Unicode "raros" (ej. U+2005) que a veces trae
    // el nombre de una carta en en_US.json — sin este colapso, "Hisuian Zoroark ex"
    // no matchea contra el mismo texto escrito con espacio normal.
    return text ? text.toString().toLowerCase().trim().replace(/\s+/g, ' ') : '';
}

// El juego escribe el sufijo de estas cartas como "ex" en minúscula (ej. "Mewtwo ex");
// a pedido del usuario se muestra siempre en mayúscula ("Mewtwo EX") en los embeds.
function normalizarNombreEx(nombre) {
    return nombre ? nombre.replace(/\bex\b/gi, 'EX') : nombre;
}

function normalizeCode(code) {
    return code ? code.toString().trim().toUpperCase() : '';
}

function detectarRareza(texto) {
    if (!texto) return null;
    const normalized = texto.toString().toLowerCase().replace(/\s+/g, ' ');
    const patrones = [
        { regex: /(?:shiny\s*2\s*-?\s*star|2\s*-?\s*star\s*shiny|2star\s*shiny|shiny\s*2star|2star\s*shiny\s*✨)/i, tipo: '2-star-shiny' },
        { regex: /(?:shiny\s*1\s*-?\s*star|1\s*-?\s*star\s*shiny|1star\s*shiny|shiny\s*1star|1star\s*shiny\s*✨)/i, tipo: '1-star-shiny' },
        { regex: /(?:2\s*-?\s*star\s*trainer|2star\s*trainer|2\s*-?\s*star\s*supporter|2star\s*supporter|2\s*-?\s*star\s*partidario|2star\s*partidario|partidario\s*2\s*-?\s*star|supporter\s*2\s*-?\s*star|trainer\s*2\s*-?\s*star|partidario|supporter\s*card|supporter|\btrainer\b)/i, tipo: '2-star-trainer' },
        { regex: /(?:2\s*-?\s*star\s*rainbow|2star\s*rainbow|rainbow|🌈)/i, tipo: '2-star-rainbow' },
        { regex: /(?:2\s*-?\s*star\s*full\s*art|2star\s*fullart|2star\s*full\s*art|full\s*art|full-art|🖼️)/i, tipo: '2-star-full-art' },
        { regex: /(?:3\s*-?\s*diamond|3diamond|★★★|🔷)/i, tipo: '3-diamond' },
        { regex: /(?:4\s*-?\s*diamond|4diamond|★★★★|💠)/i, tipo: '4-diamond' },
        { regex: /(?:crown|crown\s*-?\s*rare|👑)/i, tipo: 'crown-rare' },
        { regex: /(?:immersive|🌌)/i, tipo: 'immersive' },
        { regex: /(?:1\s*-?\s*star|1star|⭐\s*1\s*star|1\s*star|1-star)/i, tipo: '1-star' }
    ];

    const encontrado = patrones.find(p => p.regex.test(normalized));
    return encontrado ? encontrado.tipo : null;
}

// bot.js sí tiene un cliente de discord.js y puede subir/leer los emojis
// reales de CADA servidor (guild-emojis.js, un mapa distinto por instalación
// de usuario) — vuelca ese mapa ya resuelto acá cada vez que lo arma. s4t.js
// corre en su propio proceso PM2 sin cliente propio, así que en vez de tener
// su propia lista fija de IDs (que solo servía para el servidor del dueño
// original y rompía para cualquier otro usuario), lee este mismo archivo
// compartido. Se relee del disco en cada llamada (archivo chico, sin costo
// real) para no necesitar reiniciar "trading" cuando bot.js resuelve/sube
// emojis nuevos.
const GUILD_EMOJIS_CACHE_PATH = path.join(__dirname, 'assets', 'guild_emojis_cache.json');
function cargarMapaEmojisGuildCache() {
    try {
        return JSON.parse(fs.readFileSync(GUILD_EMOJIS_CACHE_PATH, 'utf8'));
    } catch (e) {
        return {};
    }
}

function cargarMapaRarezaEmojis() {
    return cargarMapaEmojisGuildCache();
}

function cargarMapaTipoEmojis() {
    return cargarMapaEmojisGuildCache();
}

// Sin caché permanente a propósito: card-types-sync.js reescribe este archivo
// solo cada varias horas (cartas nuevas de una expansión recién salida), y
// releerlo es barato — así el proceso no necesita reiniciarse para enterarse.
function cargarMapaTiposCarta() {
    try {
        return JSON.parse(fs.readFileSync(path.join(__dirname, 'assets', 'card_types.json'), 'utf8'));
    } catch (e) {
        return {};
    }
}

const TIPO_LABELS = {
    grass: { emoji: 'type_grass', label: 'Grass' },
    fire: { emoji: 'type_fire', label: 'Fire' },
    water: { emoji: 'type_water', label: 'Water' },
    lightning: { emoji: 'type_lightning', label: 'Lightning' },
    psychic: { emoji: 'type_psychic', label: 'Psychic' },
    fighting: { emoji: 'type_fighting', label: 'Fighting' },
    darkness: { emoji: 'type_darkness', label: 'Darkness' },
    metal: { emoji: 'type_metal', label: 'Metal' },
    dragon: { emoji: 'type_dragon', label: 'Dragon' },
    colorless: { emoji: 'type_colorless', label: 'Colorless' }
};

const BUILD_EMBED_CLAVES = ['mostrar_tipo', 'mostrar_logo', 'mostrar_archivo', 'mostrar_categoria', 'mostrar_instancia', 'mostrar_sobre'];

async function cargarConfigEmbed() {
    const filas = await db.all(`SELECT tipo, estado FROM configs_extras WHERE tipo LIKE 'embed_%'`);
    const estados = {};
    for (const fila of filas) estados[fila.tipo.replace('embed_', '')] = fila.estado;

    const resultado = {};
    for (const clave of BUILD_EMBED_CLAVES) {
        resultado[clave] = estados[clave] !== 'off';
    }
    return resultado;
}

// Las cartas de Entrenador (Partidario/Objeto/Herramienta) no tienen elemento
// (Fuego, Agua, etc.) — cardmaster.json las distingue con el campo
// TrainerType (1=Partidario, 2=Objeto, 3=Herramienta), mismo campo y mapeo
// que ya usa bot.js para el detalle de carta puntual (trainerTypeDesdeId).
// Sin esto, las cartas de Entrenador salían sin ningún ícono en los canales
// de S4T (bug real 2026-07-23), a diferencia de los Pokémon que sí tenían
// su emoji de tipo.
const EMOJI_POR_TRAINER_TYPE = { 1: 'card_supporter', 2: 'card_item', 3: 'card_tool' };

function obtenerTagTipoPorNombre(nombreIngles, code, cardmaster) {
    if (!nombreIngles) return null;
    const mapaEmojis = cargarMapaTipoEmojis();
    const mapaTipos = cargarMapaTiposCarta();
    const tipoIngles = mapaTipos[normalizeText(nombreIngles)];

    if (tipoIngles) {
        const config = TIPO_LABELS[tipoIngles.toLowerCase()];
        if (!config) return null;
        const idEmoji = mapaEmojis[config.emoji];
        const tag = idEmoji ? `<:${config.emoji}:${idEmoji}>` : '';
        return { tag, label: config.label };
    }

    const trainerType = code && cardmaster ? cardmaster[code]?.TrainerType : undefined;
    if (trainerType !== undefined) {
        const nombreEmoji = EMOJI_POR_TRAINER_TYPE[trainerType];
        if (!nombreEmoji) return null;
        const idEmoji = mapaEmojis[nombreEmoji];
        const tag = idEmoji ? `<:${nombreEmoji}:${idEmoji}>` : '';
        return { tag, label: 'Trainer' };
    }

    return null;
}

const EXPANSIONS_DIR = path.join(__dirname, 'assets', 'expansions');
function normalizarNombreExpansion(texto) {
    return texto.toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Mismo criterio que construirMapaExpansiones() de bot.js: en_US.json guarda el nombre largo de
// cada expansion bajo la clave EXPANSION_NAME_LONG_<n>, y el CODIGO real (el que usan
// ExpansionID en cardmaster.json) bajo EXPANSION_NAME_<n> -- hay que cruzar ambas.
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

// Convierte el nombre del sobre leido en pantalla (ej. "Deluxe (12)") en el ExpansionID real
// (2026-08-14, bug real reportado: cuando una carta con el mismo nombre+rareza existe en mas de
// una expansion -- reimpresiones tipo "Lillie" -- el emparejamiento por nombre solo no alcanza
// para saber cual arte mostrar). Devuelve null si no hay match, para que el que llama caiga de
// vuelta al comportamiento de siempre.
function resolverExpansionIdPorSobre(sobreTexto, en_US) {
    if (!sobreTexto || !en_US) return null;
    const nombreSobre = sobreTexto.replace(/\s*\([^)]*\)\s*$/, '').trim();
    if (!nombreSobre) return null;
    const objetivo = normalizarNombreExpansion(nombreSobre);
    const mapaExpansiones = construirMapaExpansiones(en_US);
    for (const [expansionId, nombreLargo] of Object.entries(mapaExpansiones)) {
        const normalizado = normalizarNombreExpansion(nombreLargo);
        if (normalizado === objetivo || normalizado.includes(objetivo) || objetivo.includes(normalizado)) {
            return expansionId;
        }
    }
    return null;
}

function buscarLogoExpansion(sobreTexto) {
    if (!sobreTexto) return null;
    const nombreSobre = sobreTexto.replace(/\s*\([^)]*\)\s*$/, '').trim();
    if (!nombreSobre) return null;

    const objetivo = normalizarNombreExpansion(nombreSobre);
    try {
        const carpetas = fs.readdirSync(EXPANSIONS_DIR, { withFileTypes: true }).filter(d => d.isDirectory());
        for (const carpeta of carpetas) {
            if (normalizarNombreExpansion(carpeta.name) === objetivo) {
                const rutaLogo = path.join(EXPANSIONS_DIR, carpeta.name, `${carpeta.name}.png`);
                if (fs.existsSync(rutaLogo)) return rutaLogo;
            }
        }
    } catch (e) {
        console.log('DEBUG: Error buscando logo de expansión:', e.message);
    }
    return null;
}

async function componerLogoSobreImagen(bufferCarta, rutaLogo) {
    if (!rutaLogo) return bufferCarta;
    try {
        const metaCarta = await sharp(bufferCarta).metadata();
        const anchoFinal = metaCarta.width;
        // Se ajusta el logo por ANCHO (85% del ancho de la carta) en vez de por alto,
        // para que se vea grande y prominente sin importar qué tan "apaisado" sea.
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
        console.log('DEBUG: Error componiendo logo sobre imagen:', e.message);
        return bufferCarta;
    }
}

// Junta 2+ imágenes de carta lado a lado (mismo alto) en una sola imagen, para
// mandar todas las cartas de wishlist de un mismo sobre en un solo mensaje en
// vez de un mensaje separado por carta.
// Mismo ícono que ya se usa para "icono_wishlist" en otros lados (ver
// guild-emojis.js) — el bot de Kevin ya marca con un corazón la carta de la
// captura que corresponde al wishlist; nuestro collage arma sus propias
// imágenes HD desde el Drive, así que hay que superponer el mismo indicador
// a mano para no perder esa señal visual (pedido explícito 2026-07-23).
const WISHLIST_BADGE_PATH = path.join(__dirname, 'assets', 'emojis', 'wishlist.png');
async function superponerBadgeWishlist(bufferCarta) {
    if (!fs.existsSync(WISHLIST_BADGE_PATH)) return bufferCarta;
    try {
        const metaCarta = await sharp(bufferCarta).metadata();
        const anchoBadge = Math.round(metaCarta.width * 0.22);
        const badgeBuffer = await sharp(WISHLIST_BADGE_PATH).resize({ width: anchoBadge }).toBuffer();
        const metaBadge = await sharp(badgeBuffer).metadata();
        const margen = Math.round(metaCarta.width * 0.04);
        return await sharp(bufferCarta)
            .composite([{ input: badgeBuffer, left: metaCarta.width - metaBadge.width - margen, top: margen }])
            .toBuffer();
    } catch (e) {
        console.log('DEBUG: Error superponiendo badge de wishlist:', e.message);
        return bufferCarta;
    }
}

// Mismo badge de cantidad que ya tiene el collage de Wishlist/All Cards/Gold
// Cards en bot.js (esquina inferior derecha) -- a pedido explicito del
// usuario 2026-07-31, para que el collage de S4T tambien lo muestre. Acá la
// cantidad es "cuantas veces salio esta carta en esta cuenta" (se cuenta
// sobre accountData.pulls, la cuenta puntual del pull que se esta mandando),
// no un cruce entre todas las cuentas guardadas -- mas simple y liviano de
// calcular en cada pull real, sin tener que releer todos los JSON guardados.
function contarCopiasEnCuenta(accountData, code) {
    if (!accountData || !Array.isArray(accountData.pulls) || !code) return 0;
    let total = 0;
    for (const pull of accountData.pulls) {
        if (!Array.isArray(pull.cards)) continue;
        for (const c of pull.cards) {
            if (normalizeCode(c) === code) total++;
        }
    }
    return total;
}

async function superponerBadgeCantidad(bufferCarta, cantidad) {
    if (!cantidad || cantidad <= 0) return bufferCarta;
    try {
        const metaCarta = await sharp(bufferCarta).metadata();
        const texto = `x${cantidad}`;
        const alto = Math.round(metaCarta.width * 0.1);
        const ancho = Math.round(alto * (0.9 + texto.length * 0.5));
        const margen = Math.round(metaCarta.width * 0.04);
        const svgBadge = Buffer.from(
            `<svg width="${ancho}" height="${alto}">` +
            `<rect x="0" y="0" width="${ancho}" height="${alto}" rx="${alto * 0.3}" ry="${alto * 0.3}" fill="black" fill-opacity="0.72"/>` +
            `<text x="${ancho / 2}" y="${alto * 0.68}" font-size="${alto * 0.6}" font-family="Arial, sans-serif" font-weight="bold" fill="#FFD700" text-anchor="middle">${texto}</text>` +
            `</svg>`
        );
        return await sharp(bufferCarta)
            .composite([{ input: svgBadge, left: metaCarta.width - ancho - margen, top: metaCarta.height - alto - margen }])
            .toBuffer();
    } catch (e) {
        console.log('DEBUG: Error superponiendo badge de cantidad:', e.message);
        return bufferCarta;
    }
}

// Techo de altura por carta en el collage — sin esto, un sobre con muchas
// cartas HD (10 en el "cuadro completo" del canal general, ver bug real
// 2026-07-23) arma un PNG de decenas de MB y Discord lo rechaza con 413
// (Payload Too Large). Con este techo + salida JPEG el collage se mantiene
// liviano sin importar cuántas cartas tenga el sobre.
const COLLAGE_ALTURA_MAX = 420;
// Grilla en vez de una sola tira horizontal (a pedido del usuario, "3 arriba
// y 2 abajo" para un sobre de 5) — se ajusta solo a cualquier cantidad de
// cartas (2 packs = 10 cartas → 4 filas de 3/3/3/1, etc).
const COLLAGE_COLUMNAS = 3;

async function componerCollageImagenes(buffers, esWishlist = [], cantidades = []) {
    try {
        const metas = await Promise.all(buffers.map(b => sharp(b).metadata()));
        const alturaComun = Math.min(COLLAGE_ALTURA_MAX, ...metas.map(m => m.height));
        const gap = 12;
        const redimensionadas = await Promise.all(buffers.map(async (b, i) => {
            const escala = alturaComun / metas[i].height;
            let redimensionada = await sharp(b).resize({ height: alturaComun, width: Math.round(metas[i].width * escala) }).toBuffer();
            if (esWishlist[i]) redimensionada = await superponerBadgeWishlist(redimensionada);
            if (cantidades[i]) redimensionada = await superponerBadgeCantidad(redimensionada, cantidades[i]);
            return redimensionada;
        }));
        const metasFinal = await Promise.all(redimensionadas.map(b => sharp(b).metadata()));

        const filas = [];
        for (let i = 0; i < redimensionadas.length; i += COLLAGE_COLUMNAS) {
            filas.push({
                imagenes: redimensionadas.slice(i, i + COLLAGE_COLUMNAS),
                metas: metasFinal.slice(i, i + COLLAGE_COLUMNAS)
            });
        }
        const anchoTotal = Math.max(...filas.map(f => f.metas.reduce((suma, m) => suma + m.width, 0) + gap * (f.metas.length - 1)));
        const altoTotal = filas.length * alturaComun + gap * (filas.length - 1);

        const composite = [];
        let top = 0;
        for (const fila of filas) {
            // La última fila puede tener menos cartas que COLLAGE_COLUMNAS (ej.
            // sobre de 5 → 3 arriba, 2 abajo) — se centra en vez de dejarla pegada
            // a la izquierda, para no dejar un hueco feo del lado derecho.
            const anchoFila = fila.metas.reduce((suma, m) => suma + m.width, 0) + gap * (fila.metas.length - 1);
            let left = Math.round((anchoTotal - anchoFila) / 2);
            for (let i = 0; i < fila.imagenes.length; i++) {
                composite.push({ input: fila.imagenes[i], left, top });
                left += fila.metas[i].width + gap;
            }
            top += alturaComun + gap;
        }

        // Fondo transparente (no un color sólido) — con JPEG el hueco de la
        // última fila incompleta (ej. 3 arriba, 2 abajo) quedaba como un
        // rectángulo oscuro feo, porque JPEG no tiene canal alfa. El techo de
        // altura ya mantiene el canvas chico, así que PNG con transparencia
        // real no debería volver a pasar el límite de Discord.
        return await sharp({
            create: { width: anchoTotal, height: altoTotal, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } }
        }).composite(composite).png({ compressionLevel: 9 }).toBuffer();
    } catch (e) {
        console.log('DEBUG: Error componiendo collage de imágenes:', e.message);
        return buffers[0];
    }
}

// Traduce el campo numérico "Rarity" de cardmaster.json (del juego) a nuestras
// categorías. Verificado cruzando cardmaster.json contra las rarezas reales de
// chase-mew/pokemon-tcg-pocket-cards (◊◊◊, ◊◊◊◊, ☆, ☆☆, ☆☆☆, ♕) — cada número
// tiene un sufijo de IllustrationID único y sin ambigüedad (ver conversación 2026-07-16).
const RAREZA_NUMERICA = {
    300: '3-diamond',
    400: '4-diamond',
    500: '1-star',
    600: '2-star-rainbow',
    700: '2-star-full-art', // para cartas Trainer (código empieza con "TR_") es '2-star-trainer', ver mapearRarezaNumerica
    800: 'immersive',
    830: '1-star-shiny',
    860: '2-star-shiny',
    900: 'crown-rare'
};

function mapearRarezaNumerica(rarityNum, cardCode) {
    const num = Number(rarityNum);
    if (!Number.isFinite(num)) return null;
    if (num === 700 && cardCode && cardCode.toString().toUpperCase().startsWith('TR_')) {
        return '2-star-trainer';
    }
    return RAREZA_NUMERICA[num] || null;
}

const RAREZA_ICONOS = {
    '1-star': { modo: 'reemplazar', emoji: 'rareza_estrella', pipe: true, etiqueta: '1-Star (x1)' },
    '1-star-shiny': { modo: 'reemplazar', emoji: 'rareza_brillante', pipe: true, etiqueta: 'Shiny 1-Star (x1)' },
    'crown-rare': { modo: 'reemplazar', emoji: 'rareza_corona', pipe: true, etiqueta: 'Crown (x1)' },
    '2-star-trainer': { modo: 'prefijo', emoji: 'rareza_estrella', cantidad: 2, pipe: true, etiqueta: 'Trainer' },
    '2-star-rainbow': { modo: 'prefijo', emoji: 'rareza_estrella', cantidad: 2, pipe: true, emojiExtra: '🌈', etiqueta: 'Rainbow' },
    '2-star-full-art': { modo: 'prefijo', emoji: 'rareza_estrella', cantidad: 2, pipe: true, emojiExtra: '🎨', etiqueta: 'Full Art' },
    '2-star-shiny': { modo: 'prefijo', emoji: 'rareza_brillante', cantidad: 2, pipe: true, etiqueta: 'Shiny' },
    '3-diamond': { modo: 'prefijo', emoji: 'rareza_diamante', cantidad: 3, pipe: false, etiqueta: '3 Diamonds (x1)' },
    '4-diamond': { modo: 'prefijo', emoji: 'rareza_diamante', cantidad: 4, pipe: false, etiqueta: '4 Diamonds (x1)' },
    'immersive': { modo: 'prefijo', emoji: 'rareza_estrella', cantidad: 3, pipe: true, emojiExtra: '🌌', etiqueta: 'Immersive' }
};

function formatearLineaRareza(lineaOriginal, rareza) {
    const config = RAREZA_ICONOS[rareza];
    if (!config) return lineaOriginal;

    const mapa = cargarMapaRarezaEmojis();
    const idEmoji = mapa[config.emoji];
    if (!idEmoji) return lineaOriginal;

    const tag = `<:${config.emoji}:${idEmoji}>`;
    // Quita cualquier símbolo/emoji y marcador de negrita (**) que ya traiga la línea
    // cruda del juego (ej. "**✨✨ Shiny 2-Star**"), para no duplicar el ícono ni dejar
    // un "**" suelto que rompa el formato del resto del embed.
    const lineaLimpia = lineaOriginal.replace(/\*\*/g, '').replace(/^[^\p{L}\p{N}]+/u, '').trim();

    if (config.modo === 'reemplazar') {
        return config.pipe ? `${tag} › ${lineaLimpia}` : `${tag} ${lineaLimpia}`;
    }

    const prefijo = new Array(config.cantidad).fill(tag).join('');

    if (!config.pipe) {
        // Para diamantes, el texto crudo que manda el juego no siempre trae el
        // nombre de la categoría (a veces son solo símbolos) — se usa la etiqueta
        // fija como respaldo para no perder el texto.
        return `${prefijo} ${config.etiqueta || lineaLimpia}`;
    }

    const extra = config.emojiExtra ? `${config.emojiExtra} ` : '';
    const texto = config.etiqueta || lineaLimpia;
    return `${prefijo} › ${extra}${texto}`;
}

function iconoRarezaPrefijo(rareza) {
    const config = RAREZA_ICONOS[rareza];
    if (!config) return '';
    const mapa = cargarMapaRarezaEmojis();
    const idEmoji = mapa[config.emoji];
    if (!idEmoji) return '';
    const tag = `<:${config.emoji}:${idEmoji}>`;
    return new Array(config.cantidad || 1).fill(tag).join('');
}

// Igual que formatearLineaRareza(), pero para wishlist (cartas del pull, sin línea
// cruda del juego) — siempre usa la etiqueta fija en vez de texto parseado.
function formatearRarezaWishlist(rareza) {
    const config = RAREZA_ICONOS[rareza];
    if (!config) return '';
    const mapa = cargarMapaRarezaEmojis();
    const idEmoji = mapa[config.emoji];
    if (!idEmoji) return '';
    const tag = `<:${config.emoji}:${idEmoji}>`;
    const texto = config.etiqueta || '';

    if (config.modo === 'reemplazar') {
        return config.pipe ? `${tag} › ${texto}` : `${tag} ${texto}`;
    }
    const prefijo = new Array(config.cantidad).fill(tag).join('');
    if (!config.pipe) return `${prefijo} ${texto}`;
    const extra = config.emojiExtra ? `${config.emojiExtra} ` : '';
    return `${prefijo} › ${extra}${texto}`;
}

function iconoWishlist() {
    const mapa = cargarMapaRarezaEmojis();
    const idEmoji = mapa['icono_wishlist'];
    return idEmoji ? `<:icono_wishlist:${idEmoji}>` : '💖';
}

function parseFechaHora(ts) {
    if (!ts) return null;
    const texto = ts.toString().trim().replace(/\s+/, ' ');
    const candidato = texto.includes('T') ? texto : texto.replace(' ', 'T');
    const fecha = new Date(candidato);
    return isNaN(fecha.getTime()) ? null : fecha;
}

function extraerFechaObjetivoDesdePayload(payload) {
    if (!payload) return new Date();

    const fullDateMatch = payload.match(/(\d{4}[-\/]\d{2}[-\/]\d{2})[ T](\d{2}:\d{2}:\d{2})/);
    if (fullDateMatch) {
        const normalizada = `${fullDateMatch[1].replace(/\//g, '-') } ${fullDateMatch[2]}`;
        const parsed = parseFechaHora(normalizada);
        if (parsed) return parsed;
    }

    const onlyTimeMatch = payload.match(/\b(\d{2}:\d{2}:\d{2})\b/);
    if (onlyTimeMatch) {
        const now = new Date();
        const hhmmss = onlyTimeMatch[1];
        const fechaHoy = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${hhmmss}`;
        const parsed = parseFechaHora(fechaHoy);
        if (parsed) return parsed;
    }

    return new Date();
}

function formatearFechaHoraMinutos(fecha) {
    const pad = n => String(n).padStart(2, '0');
    if (!fecha) return null;
    return `${fecha.getFullYear()}-${pad(fecha.getMonth() + 1)}-${pad(fecha.getDate())} ${pad(fecha.getHours())}:${pad(fecha.getMinutes())}`;
}

function extraerDeviceAccount(xmlContent) {
    const match = xmlContent.match(/name="deviceAccount">([^<]+)</);
    return match ? match[1] : null;
}

function esLineaMetaCarta(linea) {
    if (!linea) return true;
    const texto = String(linea).trim();
    if (!texto) return true;
    if (/^\d+$/.test(texto)) return true;
    if (/^(instance:|file name:|elapsed time:|offline:|avg:|packs:)/i.test(texto)) return true;
    return false;
}

function obtenerNombreCartaDesdeLineas(lineas, startIndex) {
    for (let i = startIndex; i < Math.min(lineas.length, startIndex + 4); i++) {
        const candidato = String(lineas[i] || '').trim();
        if (!candidato || esLineaMetaCarta(candidato)) continue;
        return candidato;
    }
    return null;
}

function esRarezaGodPackAlive(rareza) {
    return [
        '1-star',
        '2-star-trainer',
        '2-star-rainbow',
        '2-star-full-art'
    ].includes(normalizeText(rareza));
}

// Rarezas que tumban un god pack a "dead" pero SIGUEN contando como god pack
// (a diferencia de un diamante comun, que directamente lo saca de la
// categoria entera -- ver esRarezaGodPackValida).
function esRarezaGodPackDead(rareza) {
    return [
        '1-star-shiny',
        '2-star-shiny',
        'crown-rare',
        'immersive'
    ].includes(normalizeText(rareza));
}

// Bug real 2026-07-31 (reportado por el usuario): "es un god pack" solo
// chequeaba "cartas.length >= 5", que es el tamaño de CUALQUIER sobre normal
// -- terminaba marcando practicamente todos los sobres como god pack, tengan
// o no cartas de valor. Un god pack de verdad exige que las 5 cartas sean
// TODAS de rareza alta (alive o dead, nunca diamante) -- si aunque sea una
// es diamante comun, no es un god pack, es un sobre normal y se ignora.
function esRarezaGodPackValida(rareza) {
    return esRarezaGodPackAlive(rareza) || esRarezaGodPackDead(rareza);
}

function clasificarGodPack(cartas) {
    if (!Array.isArray(cartas) || cartas.length === 0) return null;

    const todasValidasParaAlive = cartas.every(c => esRarezaGodPackAlive(c?.rareza));
    if (todasValidasParaAlive) return 'alive';
    return 'dead';
}

function obtenerPullsDesdeCuenta(data) {
    if (!data || typeof data !== 'object') return [];
    if (Array.isArray(data.pulls)) return data.pulls.filter(p => p && p.timestamp && Array.isArray(p.cards));
    if (data.pulls && typeof data.pulls === 'object') {
        return Object.values(data.pulls).filter(p => p && p.timestamp && Array.isArray(p.cards));
    }
    return Object.values(data).filter(item => item && item.timestamp && Array.isArray(item.cards));
}

function buscarPullPorFechaObjetivo(data, fechaObjetivo) {
    const pulls = obtenerPullsDesdeCuenta(data);
    if (!pulls.length) return null;

    const objetivo = fechaObjetivo || new Date();
    const claveObjetivoMin = formatearFechaHoraMinutos(objetivo);
    const pullsMismoMinuto = [];

    for (const pull of pulls) {
        const fechaPull = parseFechaHora(pull.timestamp);
        if (!fechaPull) continue;
        if (formatearFechaHoraMinutos(fechaPull) === claveObjetivoMin) {
            pullsMismoMinuto.push({ pull, fechaPull });
        }
    }

    // If multiple pulls exist in the same minute, prefer the latest one.
    // This avoids selecting an older pull when events arrive very close together.
    if (pullsMismoMinuto.length > 0) {
        pullsMismoMinuto.sort((a, b) => a.fechaPull.getTime() - b.fechaPull.getTime());
        return pullsMismoMinuto[pullsMismoMinuto.length - 1].pull;
    }

    let mejor = null;
    let mejorDiferencia = Infinity;

    for (const pull of pulls) {
        const fechaPull = parseFechaHora(pull.timestamp);
        if (!fechaPull) continue;

        const diff = Math.abs(objetivo.getTime() - fechaPull.getTime());

        if (diff < mejorDiferencia) {
            mejorDiferencia = diff;
            mejor = pull;
        }
    }

    return mejor;
}

function resolverXmlDesdeEntrada(req, archivo, rutaXmlCfg) {
    if (req.files && req.files.length) {
        const xmlAdjunto = req.files.find(f => f.originalname && f.originalname.toLowerCase().endsWith('.xml'));
        if (xmlAdjunto) return { xmlContent: xmlAdjunto.buffer.toString(), xmlName: xmlAdjunto.originalname, source: 'multipart' };
    }

    const rutaXml = rutaXmlCfg?.webhook_url;
    if (!rutaXml || !archivo) return null;

    const nombreArchivo = path.basename(archivo.trim());
    const candidatos = [
        path.join(rutaXml, nombreArchivo),
        path.join(rutaXml, `${nombreArchivo}.xml`)
    ];

    for (const candidato of candidatos) {
        if (fs.existsSync(candidato) && fs.lstatSync(candidato).isFile()) {
            return { xmlContent: fs.readFileSync(candidato, 'utf8'), xmlName: path.basename(candidato), source: 'disk' };
        }
    }

    return null;
}

function obtenerDetalleCartaDeCuenta(data, code, masterData) {
    if (!code) return null;
    if (data && typeof data === 'object') {
        if (data[code] && typeof data[code] === 'object') return data[code];
        if (data.registeredCards && data.registeredCards[code]) return data.registeredCards[code];
        if (data.tradedCards && data.tradedCards[code]) return data.tradedCards[code];
        if (data.sharedCards && data.sharedCards[code]) return data.sharedCards[code];
    }
    if (masterData && masterData.cardmaster && masterData.cardmaster[code]) {
        return masterData.cardmaster[code];
    }
    return null;
}

function buscarIlustrationIdPorNombre(mapa, nombre) {
    if (!nombre) return null;
    const variantes = mapa[normalizeText(nombre)];
    return (variantes && variantes.length) ? variantes[0].illustrationId : null;
}

function encontrarImagen(rutaMaster, nombreArchivo) {
    if (!rutaMaster || !nombreArchivo) return null;
    const rutas = [
        path.join(rutaMaster, 'CardImageCache', `${nombreArchivo}.png`),
        path.join(rutaMaster, `${nombreArchivo}.png`),
        path.join(rutaMaster, 'cardmap', `${nombreArchivo}.png`),
        path.join(rutaMaster, 'cardmaster', `${nombreArchivo}.png`)
    ];
    return rutas.find(ruta => fs.existsSync(ruta)) || null;
}

// Ver la nota igual en bot.js (obtenerImagenRepoCartasBot) -- mismo
// repositorio propio, ultimo recurso cuando la carpeta local del usuario no
// tiene la carta (tipico el mismo dia que sale una expansion nueva). Se
// guarda DIRECTO en CardImageCache (no en una carpeta aparte) para no
// duplicar peso -- una vez bajada queda igual que una imagen que el usuario
// ya tenia.
const REPO_CARTAS_BASE = 'https://raw.githubusercontent.com/AleCast09/Pokemon-TCGP-Card-Image/main';
async function obtenerImagenRepoCartas(rutaMaster, illustrationId) {
    if (!rutaMaster || !illustrationId) return null;
    const dirCache = path.join(rutaMaster, 'CardImageCache');
    const rutaCache = path.join(dirCache, `${illustrationId}.png`);
    if (fs.existsSync(rutaCache)) return rutaCache;
    try {
        const resp = await axios.get(`${REPO_CARTAS_BASE}/${illustrationId}.png`, { responseType: 'arraybuffer', timeout: 8000 });
        fs.mkdirSync(dirCache, { recursive: true });
        fs.writeFileSync(rutaCache, resp.data);
        return rutaCache;
    } catch (e) {
        return null;
    }
}

function buscarCartaPorNombreYRareza(cartasPorCodigo, nombre, rareza) {
    if (!nombre) return null;
    const nombreNormalizado = normalizeText(nombre);
    const rarezaNormalizada = normalizeText(rareza);
    const allCards = [...cartasPorCodigo.values()];

    const exactMatches = allCards.filter(item => {
        const itemName = normalizeText(item.name);
        const itemEnglish = normalizeText(item.englishName);
        const itemCode = normalizeText(item.code);
        return itemName === nombreNormalizado || itemEnglish === nombreNormalizado || itemCode === nombreNormalizado;
    });

    if (exactMatches.length === 1) return exactMatches[0];
    if (exactMatches.length > 1 && rarezaNormalizada) {
        const rareMatches = exactMatches.filter(item => normalizeText(item.rarity || '').includes(rarezaNormalizada));
        if (rareMatches.length === 1) return rareMatches[0];
        if (rareMatches.length > 0) return rareMatches[0];
    }
    if (exactMatches.length > 0) return exactMatches[0];

    if (rarezaNormalizada) {
        const rarezaCandidates = allCards.filter(item => normalizeText(item.rarity || '').includes(rarezaNormalizada));
        if (rarezaCandidates.length === 1) return rarezaCandidates[0];
    }

    return null;
}

// Arte HD real (1200x1700 aprox.) desde un Drive público que un tercero mantiene
// actualizado al día siguiente de cada expansión nueva — con caché en disco, se
// intenta primero en todos los puntos donde ya se conoce el código exacto de la
// carta; si falla (sin API key, sin internet, o la expansión todavía no subió)
// se devuelve null y el que llama cae a la caché local del juego (275x384).
const GOOGLE_DRIVE_API_KEY = process.env.GOOGLE_DRIVE_API_KEY || '';
const GOOGLE_DRIVE_HD_ENABLED = process.env.GOOGLE_DRIVE_HD_ENABLED !== 'false';
const DRIVE_ROOT_FOLDER_ID = '1-JIeAcBXoRn1r_SFgoqO8ZG2KPp2ss9U';
const DRIVE_CACHE_DIR = path.join(__dirname, 'assets', 'drive_cache');
const DRIVE_FOLDER_MAP_PATH = path.join(__dirname, 'assets', 'drive_folder_map.json');

let _driveFolderMapCache = null;
async function refrescarMapaCarpetasDrive() {
    if (!GOOGLE_DRIVE_API_KEY) return {};
    try {
        const resp = await axios.get('https://www.googleapis.com/drive/v3/files', {
            params: { q: `'${DRIVE_ROOT_FOLDER_ID}' in parents`, key: GOOGLE_DRIVE_API_KEY, fields: 'files(id,name)', pageSize: 200 },
            timeout: 5000
        });
        const mapa = {};
        for (const f of resp.data.files || []) {
            const guion = f.name.indexOf('-');
            if (guion === -1) continue;
            mapa[f.name.substring(0, guion)] = f.id;
        }
        _driveFolderMapCache = mapa;
        fs.writeFileSync(DRIVE_FOLDER_MAP_PATH, JSON.stringify(mapa, null, 2));
        return mapa;
    } catch (e) {
        console.log('DEBUG: Error listando carpetas de Drive:', e.message);
        return _driveFolderMapCache || {};
    }
}

async function obtenerMapaCarpetasDrive() {
    if (_driveFolderMapCache) return _driveFolderMapCache;
    try {
        if (fs.existsSync(DRIVE_FOLDER_MAP_PATH)) {
            _driveFolderMapCache = JSON.parse(fs.readFileSync(DRIVE_FOLDER_MAP_PATH, 'utf8'));
            return _driveFolderMapCache;
        }
    } catch (e) { /* caché corrupto, se reconstruye abajo */ }
    return await refrescarMapaCarpetasDrive();
}

// Ver la nota igual en bot.js (obtenerImagenHDBot) -- mismo flag compartido en
// la misma tabla, para que prender/apagar desde Discord aplique tanto al
// bot como al reroll (S4T) sin tener que configurarlo dos veces.
async function driveHdRegularHabilitado() {
    const fila = await db.get(`SELECT status FROM estados_modulos WHERE nombre = 'drive_hd_regular'`);
    return fila?.status === 'on';
}

async function obtenerImagenHD(cardMap, code) {
    if (!code || !cardMap || !cardMap[code] || !GOOGLE_DRIVE_API_KEY || !GOOGLE_DRIVE_HD_ENABLED) return null;
    if (!(await driveHdRegularHabilitado())) return null;
    const { ExpansionID, CollectionNumber } = cardMap[code];
    if (!ExpansionID || !CollectionNumber) return null;

    const localId = String(CollectionNumber).padStart(3, '0');
    const dirCache = path.join(DRIVE_CACHE_DIR, ExpansionID);
    const rutaCache = path.join(dirCache, `${localId}.png`);
    if (fs.existsSync(rutaCache)) return rutaCache;

    try {
        let mapaCarpetas = await obtenerMapaCarpetasDrive();
        let subfolderId = mapaCarpetas[ExpansionID];
        if (!subfolderId) {
            // puede ser una expansión nueva que se agregó después del último caché
            mapaCarpetas = await refrescarMapaCarpetasDrive();
            subfolderId = mapaCarpetas[ExpansionID];
        }
        if (!subfolderId) return null;

        const busqueda = await axios.get('https://www.googleapis.com/drive/v3/files', {
            params: { q: `'${subfolderId}' in parents and name contains '${ExpansionID}-${localId}'`, key: GOOGLE_DRIVE_API_KEY, fields: 'files(id,name)', pageSize: 5 },
            timeout: 5000
        });
        const archivo = (busqueda.data.files || [])[0];
        if (!archivo) return null;

        const descarga = await axios.get(`https://www.googleapis.com/drive/v3/files/${archivo.id}`, {
            params: { alt: 'media', key: GOOGLE_DRIVE_API_KEY },
            responseType: 'arraybuffer', timeout: 8000
        });
        fs.mkdirSync(dirCache, { recursive: true });
        fs.writeFileSync(rutaCache, descarga.data);
        return rutaCache;
    } catch (e) {
        return null;
    }
}

async function resolverImagen(rutaMaster, data, cartasPorCodigo, masterData, mapa, cardMap, sobre = null) {
    if (!rutaMaster || !data) return null;
    // ExpansionID del sobre real que se abrio (2026-08-14, bug real reportado: "Lillie" del
    // sobre Deluxe Pack: ex salio con el arte de la Lillie de Celestial Guardians) -- se usa
    // mas abajo para desempatar cuando el mismo nombre+rareza existe en mas de una expansion
    // (reimpresiones). Puede ser null si no se pudo resolver; en ese caso todo sigue igual que
    // antes.
    const expansionIdObjetivo = resolverExpansionIdPorSobre(sobre, masterData?.en_US);

    // Se guarda el mejor illustrationId encontrado en el camino (aunque
    // encontrarImagen no lo haya encontrado localmente) para poder probar el
    // respaldo del repositorio propio al final, sin repetir esa llamada en
    // cada punto de salida de esta funcion.
    let mejorIllustrationId = null;

    let cartaEncontrada = null;
    if (data.carta) {
        cartaEncontrada = data.carta;
    } else if (data.code) {
        const code = normalizeCode(data.code);
        if (code && cartasPorCodigo.has(code)) cartaEncontrada = cartasPorCodigo.get(code);
    }

    if (!cartaEncontrada && data.nombre) {
        cartaEncontrada = buscarCartaPorNombreYRareza(cartasPorCodigo, data.nombre, data.rareza);
    }

    if (cartaEncontrada) {
        console.log(`DEBUG: resolverImagen candidato code=${cartaEncontrada.code} name=${cartaEncontrada.name} rarity=${cartaEncontrada.rarity} illustrationId=${cartaEncontrada.illustrationId}`);
        if (cartaEncontrada.code) {
            const imagenHD = await obtenerImagenHD(cardMap, cartaEncontrada.code);
            if (imagenHD) return imagenHD;
        }
        // Prefer IllustrationID from account/master
        if (cartaEncontrada.illustrationId) {
            mejorIllustrationId = mejorIllustrationId || cartaEncontrada.illustrationId;
            const imagen = encontrarImagen(rutaMaster, cartaEncontrada.illustrationId);
            if (imagen) return imagen;
        }
        // Try cardMap lookup by code -> IllustrationID
        if (cardMap && cartaEncontrada.code && cardMap[cartaEncontrada.code] && cardMap[cartaEncontrada.code].IllustrationID) {
            const ilustr = cardMap[cartaEncontrada.code].IllustrationID;
            mejorIllustrationId = mejorIllustrationId || ilustr;
            const imagen = encontrarImagen(rutaMaster, ilustr);
            if (imagen) return imagen;
        }
        // Fallbacks: try searching for files named by code or originalCode
        if (cartaEncontrada.code) {
            const imagen = encontrarImagen(rutaMaster, cartaEncontrada.code);
            if (imagen) return imagen;
        }
        if (cartaEncontrada.originalCode && cartaEncontrada.originalCode !== cartaEncontrada.code) {
            const imagen = encontrarImagen(rutaMaster, cartaEncontrada.originalCode);
            if (imagen) return imagen;
        }
    }

    const nombreNormalizado = normalizeText(data.nombre);
    const variantesPorNombre = mapa[nombreNormalizado];
    if (variantesPorNombre && variantesPorNombre.length) {
        // Un mismo nombre puede tener variantes en varias rarezas (ej. "Pikachu"
        // común y "Pikachu" 1-star) — se prioriza la que coincide con la rareza
        // detectada, para no mandar la imagen de una variante equivocada.
        let candidatas = variantesPorNombre;
        if (data.rareza) {
            const porRareza = variantesPorNombre.filter(v => mapearRarezaNumerica(v.rarity, v.code) === data.rareza);
            if (porRareza.length) candidatas = porRareza;
        }
        // Mismo nombre+rareza puede repetirse en varias expansiones (reimpresiones, ej. "Lillie"
        // en Celestial Guardians Y en Deluxe Pack: ex) -- si sabemos de que sobre salio, se
        // prioriza la variante de ESA expansion antes de resignarse a la primera de la lista.
        let elegida = null;
        if (expansionIdObjetivo && candidatas.length > 1) {
            elegida = candidatas.find(v => v.expansionId === expansionIdObjetivo);
        }
        if (!elegida) elegida = candidatas[0];
        const imagenHD = await obtenerImagenHD(cardMap, elegida.code);
        if (imagenHD) return imagenHD;
        mejorIllustrationId = mejorIllustrationId || elegida.illustrationId;
        const imagen = encontrarImagen(rutaMaster, elegida.illustrationId);
        if (imagen) return imagen;
    }

    if (masterData.cardmaster && masterData.en_US && data.nombre) {
        const matchingKeys = Object.keys(masterData.cardmaster).filter(key => {
            const item = masterData.cardmaster[key];
            if (!item || !item.Name) return false;
            const itemEnglish = normalizeText(masterData.en_US[item.Name] || '');
            const itemNameKey = normalizeText(item.Name || '');
            const itemCode = normalizeText(key);
            return itemEnglish === nombreNormalizado || itemNameKey === nombreNormalizado || itemCode === nombreNormalizado;
        });
        let candidatasMaster = matchingKeys;
        if (data.rareza) {
            const porRareza = matchingKeys.filter(key => mapearRarezaNumerica(masterData.cardmaster[key].Rarity, key) === data.rareza);
            if (porRareza.length) candidatasMaster = porRareza;
        }
        // Mismo desempate por expansion que en variantesPorNombre mas arriba -- este camino es
        // el que realmente disparo el bug reportado (Lillie de la expansion equivocada), porque
        // se llega aca cuando el emparejamiento contra el pull real no encontro nada.
        // ExpansionID no vive en masterData.cardmaster (ahi solo hay Name/Rarity/IllustrationID) --
        // vive en cardMap (cardmap.json), por eso se consulta ahi para el desempate.
        let matchingMasterKey = null;
        if (expansionIdObjetivo && candidatasMaster.length > 1 && cardMap) {
            matchingMasterKey = candidatasMaster.find(key => cardMap[key]?.ExpansionID === expansionIdObjetivo);
        }
        if (!matchingMasterKey) matchingMasterKey = candidatasMaster[0];
        if (matchingMasterKey) {
            const imagenHD = await obtenerImagenHD(cardMap, matchingMasterKey);
            if (imagenHD) return imagenHD;
            const illustrationId = (masterData.cardmaster[matchingMasterKey] || {}).IllustrationID;
            if (illustrationId) {
                mejorIllustrationId = mejorIllustrationId || illustrationId;
                const imagen = encontrarImagen(rutaMaster, illustrationId);
                if (imagen) return imagen;
            }
        }
    }

    const imagenDirecta = encontrarImagen(rutaMaster, data.nombre);
    if (imagenDirecta) return imagenDirecta;

    // Ultimo respaldo antes de rendirse: ninguna carpeta local tenia la
    // imagen, pero en el camino se identifico un illustrationId real -- se
    // busca en el repositorio propio (ver obtenerImagenRepoCartas), tipico
    // el mismo dia que sale una expansion nueva.
    if (mejorIllustrationId) {
        const imagenRepo = await obtenerImagenRepoCartas(rutaMaster, mejorIllustrationId);
        if (imagenRepo) return imagenRepo;
    }

    return null;
}

function cargarWishlist(rutaJsonCfg, rutaWishlistCfg) {
    try {
        const rutaDirecta = rutaWishlistCfg?.webhook_url;
        if (rutaDirecta) {
            if (fs.existsSync(rutaDirecta)) {
                const stats = fs.lstatSync(rutaDirecta);
                if (stats.isFile()) {
                    console.log('DEBUG: Cargando wishlist desde archivo directo:', rutaDirecta);
                    return cargarJson(rutaDirecta);
                }
                if (stats.isDirectory()) {
                    const rutaDirectaInferida = path.join(rutaDirecta, 'wishlist.json');
                    if (fs.existsSync(rutaDirectaInferida)) {
                        console.log('DEBUG: Cargando wishlist desde directorio directo:', rutaDirectaInferida);
                        return cargarJson(rutaDirectaInferida);
                    }
                }
            }
        }

        if (rutaJsonCfg && rutaJsonCfg.webhook_url) {
            const carpetaJson = fs.existsSync(rutaJsonCfg.webhook_url) && fs.lstatSync(rutaJsonCfg.webhook_url).isDirectory()
                ? rutaJsonCfg.webhook_url
                : path.dirname(rutaJsonCfg.webhook_url);
            const rutaInferida = path.join(carpetaJson, 'wishlist.json');
            if (fs.existsSync(rutaInferida)) {
                console.log('DEBUG: Cargando wishlist desde ruta JSON de cuentas inferida:', rutaInferida);
                return cargarJson(rutaInferida);
            }
        }

        if (rutaDirecta) {
            const rutaDirectaInferida = path.join(path.dirname(rutaDirecta), 'wishlist.json');
            if (fs.existsSync(rutaDirectaInferida)) {
                console.log('DEBUG: Cargando wishlist desde ruta inferida basada en ruta wishlist:', rutaDirectaInferida);
                return cargarJson(rutaDirectaInferida);
            }
        }
    } catch (e) {
        console.log('DEBUG: Error cargando wishlist:', e);
    }
    return null;
}

function obtenerIdsWishlist(wishlistData) {
    if (!wishlistData || !Array.isArray(wishlistData.cards)) return new Set();
    const ids = wishlistData.cards
        .map(c => {
            if (!c || typeof c !== 'object') return null;
            return normalizeCode(c.id || c.code || c.cardId || c.cardID || c.name || c.title);
        })
        .filter(Boolean);
    console.log('DEBUG: wishlist ids cargadas=', ids.length);
    if (ids.length <= 20) console.log('DEBUG: wishlist ids sample=', ids);
    return new Set(ids);
}

function normalizeMatch(text) {
    if (!text) return '';
    return text.toString()
        .toLowerCase()
        .replace(/[^a-z0-9áéíóúñü]+/g, ' ')
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .replace(/\s+/g, ' ')
        .trim();
}

const app = express();

// Parsers BEFORE multer
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        files: 4,
        fileSize: 10 * 1024 * 1024
    }
});

app.use((req, res, next) => {
    console.log(`DEBUG: Petición recibida: ${req.method} ${req.url}, body keys: ${Object.keys(req.body || {}).slice(0, 3).join(', ')}`);
    next();
});

let enviando = false;

app.post('/', upload.any(), async (req, res) => {
    if (!validarIngestToken(req)) {
        return res.status(401).send('UNAUTHORIZED');
    }

    res.status(200).send('OK');

    // Queue requests instead of dropping them when two pulls arrive almost at the same time.
    while (enviando) {
        console.log('DEBUG: request en cola, esperando fin del envio actual...');
        await new Promise(resolve => setTimeout(resolve, 30));
    }
    enviando = true;

    try {
        if (!req.body) {
            console.log('ERROR: req.body is undefined');
            enviando = false;
            return;
        }
        const payload = req.body.payload_json ? JSON.parse(req.body.payload_json).content : (req.body.content || '');
        const lineas = payload.split('\n').map(l => l.trim());

        const rutaMasterCfg = await db.get(`SELECT webhook_url FROM configs_canales WHERE tipo = 'ruta_master'`);
        const rutaJsonCfg = await db.get(`SELECT webhook_url FROM configs_canales WHERE tipo = 'ruta_json_cuentas'`);
        const rutaXmlCfg = await db.get(`SELECT webhook_url FROM configs_canales WHERE tipo = 'ruta_xml_cuentas'`);
        const rutaWishlistCfg = await db.get(`SELECT webhook_url FROM configs_canales WHERE tipo = 'ruta_wishlist'`);
        const configsRaw = await db.all(`SELECT tipo, canal_id, webhook_url FROM configs_canales`);
        const configs = {};
        for (const row of configsRaw) {
            // Prefer rows with a valid webhook over N/A ones
            if (!configs[row.tipo] || (configs[row.tipo].webhook_url === 'N/A' && row.webhook_url !== 'N/A')) {
                configs[row.tipo] = row;
            }
        }
        console.log('DEBUG: configs cargados con webhook válido:', Object.keys(configs).filter(k => configs[k].webhook_url && configs[k].webhook_url !== 'N/A').join(', '));

        const configEmbed = await cargarConfigEmbed();

        const wishlistData = cargarWishlist(rutaJsonCfg, rutaWishlistCfg);
        const wishlistIds = obtenerIdsWishlist(wishlistData);
        console.log('DEBUG: wishlist route=', rutaSegura(rutaWishlistCfg?.webhook_url), 'json route=', rutaSegura(rutaJsonCfg?.webhook_url));
        console.log('DEBUG: wishlist loaded=', !!wishlistData, 'ids=', wishlistIds.size);

        let cartas = [];
        let instancia = 'N/A';
        let sobre = 'Unknown';
        let archivo = 'N/A';
        for (let i = 0; i < lineas.length; i++) {
            if (lineas[i].includes('Instance:')) {
                instancia = lineas[i].match(/Instance:\s*(\d+)/i)?.[1] || 'N/A';
                const p = lineas[i].match(/\(([^)]+)\)/)?.[1]?.split('·');
                if (p && p.length === 2) sobre = `${p[1].trim()} (${p[0].replace(/\D/g, '')})`;
            }

            if (lineas[i].startsWith('File name:')) archivo = lineas[i].replace('File name:', '').trim();

            const textoLinea = lineas[i].toLowerCase().replace(/\s+/g, ' ');
            const rareza = detectarRareza(textoLinea);
            if (rareza && i + 1 < lineas.length) {
                const nombreCrudo = obtenerNombreCartaDesdeLineas(lineas, i + 1);
                // El juego a veces junta 2+ cartas de la MISMA rareza en una sola
                // línea separadas por coma (ej. rareza "1 Star (x2)" seguida del
                // nombre "Piplup, Mareanie"), en vez de repetir el bloque
                // rareza+nombre por cada una. Sin separarlas, "Piplup, Mareanie"
                // se trataba como el nombre literal de una sola carta inexistente
                // y resolverImagen() nunca encontraba imagen para ninguna de las
                // dos (ver bug real 2026-07-23: imgPath=none, matched="none").
                const nombresIndividuales = (nombreCrudo || '').split(',').map(n => normalizarNombreEx(n.trim())).filter(Boolean);
                for (const nombreCarta of nombresIndividuales) {
                    console.log(`DEBUG: rareza detectada=${rareza} linea="${textoLinea}" carta="${nombreCarta}"`);
                    const lineaConIcono = formatearLineaRareza(lineas[i], rareza);
                    const displayCarta = configEmbed.mostrar_categoria
                        ? `> ${lineaConIcono}\n> **${nombreCarta}**`
                        : `> **${nombreCarta}**`;
                    // Bug real reportado (2026-07-27): a diferencia de Pokémon (que
                    // repite el bloque rareza+nombre completo por cada copia), el
                    // juego a veces le pega el "(xN)" directo al nombre de las
                    // cartas de Trainer en la misma línea (ej. "Cynthia (x2)") — sin
                    // limpiarlo, ese texto se usaba tal cual para buscar la imagen y
                    // nunca matcheaba contra el nombre real ("Cynthia") en
                    // cardmaster/en_US, así que esas cartas quedaban sin foto. El
                    // "(xN)" se mantiene en el texto mostrado (linea de arriba), solo
                    // se saca para la búsqueda de imagen.
                    const nombreParaBuscar = nombreCarta.replace(/\s*\(x\d+\)\s*$/i, '').trim();
                    cartas.push({ rareza, nombre: nombreParaBuscar, display: displayCarta });
                }
            } else if (/star|diamond|crown|immersive|partidario|supporter|trainer/i.test(textoLinea)) {
                console.log(`DEBUG: rareza no detectada linea="${textoLinea}"`);
            }
        }

        const masterData = rutaMasterCfg ? cargarMaster(rutaMasterCfg.webhook_url) : { cardmaster: {}, en_US: {} };
        const mapa = rutaMasterCfg ? obtenerMapa(rutaMasterCfg.webhook_url) : {};
        const cardMap = rutaMasterCfg ? cargarCardMap(rutaMasterCfg.webhook_url) : {};
        let accountData = null;
        let pullSeleccionado = null;
        const cartasPorCodigo = new Map();
        const cartasPull = [];
        const fechaObjetivo = extraerFechaObjetivoDesdePayload(payload);
        let xmlInput = null;

        if (rutaJsonCfg) {
            xmlInput = resolverXmlDesdeEntrada(req, archivo, rutaXmlCfg);
            if (xmlInput) {
                const accountId = extraerDeviceAccount(xmlInput.xmlContent);
                if (accountId) {
                    const jsonPath = path.join(rutaJsonCfg.webhook_url, `${accountId}.json`);
                    console.log(`DEBUG: XML source=${xmlInput.source} xml=${xmlInput.xmlName} accountId=${redactarValor(accountId)} jsonPath=${rutaSegura(jsonPath)}`);
                    if (fs.existsSync(jsonPath)) {
                        accountData = cargarJson(jsonPath);
                        pullSeleccionado = buscarPullPorFechaObjetivo(accountData, fechaObjetivo);
                        if (pullSeleccionado) {
                            console.log('DEBUG: Pull seleccionado:', pullSeleccionado.timestamp, 'objetivo=', formatearFechaHoraMinutos(fechaObjetivo));
                            for (const rawCardCode of pullSeleccionado.cards) {
                                const cardCode = normalizeCode(rawCardCode);
                                const detalle = obtenerDetalleCartaDeCuenta(accountData, rawCardCode, masterData);
                                if (detalle) {
                                    const fromMasterByCode = masterData.cardmaster && masterData.cardmaster[cardCode] ? masterData.cardmaster[cardCode].IllustrationID : null;
                                    const illustration = detalle.IllustrationID || fromMasterByCode || buscarIlustrationIdPorNombre(mapa, detalle.Name);
                                    const englishName = masterData.en_US[detalle.Name] || null;
                                    const isWishlist = wishlistIds.has(cardCode);
                                    const normalizedDetalleRarity = mapearRarezaNumerica(detalle.Rarity, cardCode) || detectarRareza(detalle.Rarity) || normalizeMatch(detalle.Rarity || '');
                                    const cartaDetalle = {
                                        code: cardCode,
                                        originalCode: rawCardCode,
                                        name: detalle.Name || rawCardCode,
                                        englishName,
                                        illustrationId: illustration,
                                        rarity: normalizedDetalleRarity || null,
                                        isWishlist
                                    };
                                    cartasPull.push(cartaDetalle);
                                    if (!cartasPorCodigo.has(cardCode)) {
                                        cartasPorCodigo.set(cardCode, cartaDetalle);
                                    }
                                } else {
                                    // Fallback: create a minimal cartaDetalle using cardMap and code so matching by ID works
                                    const isWishlist = wishlistIds.has(cardCode);
                                    let illustrationFromCardMap = null;
                                    try {
                                        if (cardMap && cardMap[rawCardCode] && cardMap[rawCardCode].IllustrationID) illustrationFromCardMap = cardMap[rawCardCode].IllustrationID;
                                    } catch (e) { }
                                    const cartaDetalle = {
                                        code: cardCode,
                                        originalCode: rawCardCode,
                                        name: rawCardCode,
                                        englishName: null,
                                        illustrationId: illustrationFromCardMap || null,
                                        rarity: null,
                                        isWishlist
                                    };
                                    cartasPull.push(cartaDetalle);
                                    if (!cartasPorCodigo.has(cardCode)) cartasPorCodigo.set(cardCode, cartaDetalle);
                                    console.log(`DEBUG: Fallback creado para cardCode=${rawCardCode} illustration=${illustrationFromCardMap || 'none'}`);
                                }
                            }
                        } else {
                            console.log('DEBUG: No se encontró pull cercano a la fecha actual.');
                        }
                    } else {
                        console.log(`DEBUG: No existe el archivo JSON de cuenta: ${jsonPath}`);
                    }
                } else {
                    console.log('DEBUG: No se pudo extraer deviceAccount del XML.');
                }
            } else {
                console.log(`DEBUG: No se encontró XML. archivo=${archivo || 'none'} ruta_xml=${rutaSegura(rutaXmlCfg?.webhook_url)}`);
            }
        }

        function asignarWishlistACartas(cartas, cartasPull) {
            const cardsByRareza = cartasPull.reduce((acc, item, idx) => {
                const key = normalizeMatch(item.rarity || '');
                if (!acc[key]) acc[key] = [];
                acc[key].push({ item, idx, used: false });
                return acc;
            }, {});

            cartas.forEach((carta, index) => {
                const normalizedNombre = normalizeMatch(carta.nombre);
                const normalizedRareza = normalizeMatch(carta.rareza);
                const candidates = cardsByRareza[normalizedRareza] || [];

                let matched = candidates.find(c => !c.used && (
                    normalizeMatch(c.item.name) === normalizedNombre ||
                    normalizeMatch(c.item.englishName) === normalizedNombre ||
                    normalizeMatch(c.item.code) === normalizedNombre
                ));

                        if (!matched) {
                    const remainingSameRareza = candidates.filter(c => !c.used);
                    if (remainingSameRareza.length === 1) matched = remainingSameRareza[0];
                }

                if (!matched) {
                    const fallback = Object.values(cardsByRareza)
                        .flat()
                        .filter(c => !c.used);
                    if (fallback.length === 1) matched = fallback[0];
                }

                if (matched) {
                    matched.used = true;
                    carta.isWishlist = !!matched.item.isWishlist;
                    carta.matchedCard = matched.item;
                    carta.code = matched.item.code;
                } else {
                    carta.isWishlist = false;
                    carta.matchedCard = null;
                    carta.code = null;
                }

                console.log(`DEBUG: asignarWishlist -> carta="${carta.nombre}" matched="${matched ? matched.item.name : 'none'}" code="${matched ? matched.item.code : ''}" wishlist=${carta.isWishlist}`);
            });
        }

        asignarWishlistACartas(cartas, cartasPull);

        // Inserta el emoji de tipo elemental justo al lado del nombre de la carta,
        // igual que el emoji de rareza, en vez de un campo aparte.
        cartas.forEach(carta => {
            if (!configEmbed.mostrar_tipo) return;
            const tipoInfo = obtenerTagTipoPorNombre(carta.nombre, carta.matchedCard?.code, masterData.cardmaster);
            if (tipoInfo && tipoInfo.tag && carta.display) {
                // Reconstruye la línea del nombre de forma explícita en vez de buscar y
                // reemplazar texto, para que quede igual de prolijo sin importar el modo
                // de la rareza (prefijo/reemplazar) ni el formato exacto de la línea original.
                const lineas = carta.display.split('\n');
                lineas[lineas.length - 1] = `> ${tipoInfo.tag} › **${carta.nombre}**`;
                carta.display = lineas.join('\n');
            }
        });

        let envios = [];

        // Wishlist from pull JSON (by code matching wishlist IDs)
        const cartasWishlistPull = cartasPull.filter(item => item.isWishlist);
        console.log('DEBUG: wishlist en cartasPull=', cartasWishlistPull.map(item => item.code).join(', ') || 'none');

        // Wishlist from parsed Discord message (by name/rarity matching)
        const cartasWishlistTexto = cartas.filter(c => c.isWishlist);
        console.log('DEBUG: wishlist en cartas (texto)=', cartasWishlistTexto.map(c => c.nombre).join(', ') || 'none');

        const esGodPack = cartas.length >= 5 && cartas.every(c => esRarezaGodPackValida(c?.rareza));
        const tipoGodPack = esGodPack ? clasificarGodPack(cartas) : null;

        // Combine both sources, preferring matchedCard objects
        const wishlistUnificada = [
            ...cartasWishlistPull.map(item => ({ source: 'pull', card: item, nombre: normalizarNombreEx(item.englishName || item.name || item.code), rareza: item.rarity })),
            ...cartasWishlistTexto
                .filter(c => !cartasWishlistPull.some(p => p.code === c.code))  // avoid duplicates
                .map(c => ({ source: 'texto', card: c.matchedCard || c, nombre: c.nombre, rareza: c.rareza }))
        ];
        console.log('DEBUG: wishlist unificada=', wishlistUnificada.length, 'cartas');

        // Fallback: si el parseo de texto no encontró cartas pero el pull JSON tiene
        // cartas de wishlist con rareza conocida, sintetizarlas para que S4T y el
        // canal de rareza también reciban el evento.
        if (cartas.length === 0 && cartasWishlistPull.length > 0) {
            for (const wc of cartasWishlistPull) {
                if (wc.rarity) {
                    const displayNombre = normalizarNombreEx(wc.englishName || wc.name || wc.code);
                    const displayLinea = configEmbed.mostrar_categoria
                        ? `> ${wc.rarity}\n> **${displayNombre}**`
                        : `> **${displayNombre}**`;
                    cartas.push({
                        rareza: wc.rarity,
                        nombre: displayNombre,
                        display: displayLinea,
                        isWishlist: true,
                        matchedCard: wc
                    });
                }
            }
            if (cartas.length > 0) console.log('DEBUG: cartas sintetizadas desde pull wishlist=', cartas.map(c => c.nombre).join(', '));
        }

        if (cartas.length > 0 || cartasPull.length > 0) {
            // El canal general de S4T muestra el texto de la(s) carta(s) NOTABLE(s)
            // nomás (igual que siempre — el mismo texto corto que ya se manda a los
            // canales de rareza), pero la FOTO es el sobre completo tal cual salió
            // (comunes incluidas, con el corazón marcando la carta de wishlist si la
            // hay) — así queda igual que se veía antes de los cambios de HD, pedido
            // explícito 2026-07-23. cartasPull tiene todas las cartas del pull real;
            // si no hay ruta_json_cuentas configurada (o no se encontró el pull), se
            // cae a mostrar solo las notables como imagen también, como respaldo.
            const displayGeneral = cartas.length > 0
                ? cartas.map(c => c.display).join('\n\n')
                : cartasPull.filter(c => c.isWishlist).map(c => `> **${normalizarNombreEx(c.englishName || c.name)}**`).join('\n\n');
            const cartasGeneral = cartasPull.length > 0 ? cartasPull : cartas.map(c => c.matchedCard || c);
            envios.push({ tipoCanal: 's4t', display: displayGeneral, cartasGeneral });
        }

        // Canal aparte "s4t-categoria": el comportamiento VIEJO de "s4t" antes de
        // este cambio (a pedido del usuario, para no perder esa vista) — solo las
        // cartas con rareza trackeada (las mismas que se reparten abajo por canal
        // de categoría), en vez del sobre completo.
        if (cartas.length > 0) {
            const displayCategoria = cartas.map(c => c.display).join('\n\n');
            const cartasCategoria = cartas.map(c => c.matchedCard || c);
            envios.push({ tipoCanal: 's4t-categoria', display: displayCategoria, cartasGeneral: cartasCategoria });
        }

        for (const c of cartas) {
            envios.push({ tipoCanal: c.rareza, display: c.display, nombre: c.nombre, rareza: c.rareza, carta: c.matchedCard || null });
        }

        if (wishlistUnificada.length > 0) {
            const listaNombres = wishlistUnificada
                .map(w => {
                    const tipoInfo = configEmbed.mostrar_tipo ? obtenerTagTipoPorNombre(w.nombre, w.card?.code, masterData.cardmaster) : null;
                    const tipoPrefijo = tipoInfo && tipoInfo.tag ? `${tipoInfo.tag} › ` : '';
                    const lineaRareza = configEmbed.mostrar_categoria ? formatearRarezaWishlist(w.rareza) : '';
                    const lineaNombre = `${tipoPrefijo}**${w.nombre}**`;
                    return lineaRareza ? `${lineaRareza}\n> ${lineaNombre}` : lineaNombre;
                })
                .join('\n> ');
            const displayWishlist = `> ${iconoWishlist()} › Wishlist found:\n> ${listaNombres}`;
            // Un solo envío con todas las cartas de wishlist juntas (mismo mensaje,
            // collage de imágenes si hay más de una) en vez de un mensaje separado
            // por carta — a pedido del usuario, para que quede más ordenado.
            envios.push({ tipoCanal: 'wishlist', display: displayWishlist, cartasWishlist: wishlistUnificada.map(w => w.card) });
        }

        if (esGodPack) {
            const nombresGodPack = cartas.map(c => {
                if (!c.nombre) return null;
                const tipoInfo = configEmbed.mostrar_tipo ? obtenerTagTipoPorNombre(c.nombre, c.matchedCard?.code, masterData.cardmaster) : null;
                const tipoPrefijo = tipoInfo && tipoInfo.tag ? `${tipoInfo.tag} › ` : '';
                const lineaRareza = configEmbed.mostrar_categoria ? formatearRarezaWishlist(c.rareza) : '';
                const lineaNombre = `${tipoPrefijo}**${c.nombre}**`;
                return lineaRareza ? `${lineaRareza}\n> ${lineaNombre}` : lineaNombre;
            }).filter(Boolean).join('\n> ');
            const resumenGodPack = `> 🎁 God Pack detected:\n> ${nombresGodPack}`;
            // Todas las cartas del pack (no solo la primera), para mandar un collage
            // con todas las imágenes juntas — igual que hace el canal general de S4T.
            const cartasGodPack = cartas.map(c => c.matchedCard || c);
            envios.push({ tipoCanal: 'godpack-general', display: resumenGodPack, cartasGodPack });

            if (tipoGodPack === 'alive') {
                envios.push({ tipoCanal: 'godpack-alive', display: resumenGodPack, cartasGodPack });
            } else if (tipoGodPack === 'dead') {
                envios.push({ tipoCanal: 'godpack-dead', display: resumenGodPack, cartasGodPack });
            }
        }

        const rutaLogoExpansion = buscarLogoExpansion(sobre);

        for (const data of envios) {
            const canalDb = configs[data.tipoCanal];
            if (!canalDb) {
                console.log(`DEBUG: NO ENCONTRADO canal tipo="${data.tipoCanal}" en configs`);
                continue;
            }
            if (!canalDb.webhook_url || canalDb.webhook_url === 'N/A' || canalDb.webhook_url === 'local') {
                console.log(`DEBUG: WEBHOOK INVÁLIDO para canal="${data.tipoCanal}" webhook="${redactarValor(canalDb.webhook_url)}"`);
                continue;
            }

            const formEmbed = new FormData();

            const camposFinales = [];
            if (configEmbed.mostrar_instancia) camposFinales.push({ name: '🖥️ Instance', value: `\`${instancia}\``, inline: true });
            if (configEmbed.mostrar_sobre) camposFinales.push({ name: '📦 Pack', value: `\`${sobre}\``, inline: true });
            let valorPrincipal = data.display;
            if (configEmbed.mostrar_archivo) valorPrincipal += `\n\n📁 **Account file**\n\`${archivo}\``;
            camposFinales.push({ name: CAMPO_INVISIBLE, value: valorPrincipal, inline: false });

            const embedPayload = {
                embeds: [{
                    color: data.tipoCanal === 'wishlist' ? 0xE91E63 : 0xF1C40F,
                    description: data.tipoCanal === 'wishlist'
                        ? '💖 **A wishlist card has been detected.** 💖\nSaved in the S4T database.'
                        : '🌟 **NEW VALUABLE CARD FOUND!** 🌟\n\n**An excellent trade has been detected.**\nSaved in the S4T database.',
                    fields: camposFinales,
                    footer: { text: `Data saved ${new Date().toLocaleString()}` }
                }]
            };

            let imgPath = null;
            let bufferImagen = null;
            let nombreArchivoImagen = 'carta.png';

            if (data.cartasWishlist || data.cartasGodPack || data.cartasGeneral) {
                // Misma lógica para los 3 casos: resolver el arte oficial de cada carta
                // y, si hay 2 o más, armar un collage — general/wishlist/godpack quedan
                // todos con la misma calidad de imagen (CardImageCache), sin depender
                // de la captura de pantalla del teléfono.
                const listaCartas = data.cartasWishlist || data.cartasGodPack || data.cartasGeneral;
                const buffers = [];
                const esWishlist = [];
                const cantidades = [];
                for (const cartaItem of listaCartas) {
                    const imagePath = await resolverImagen(rutaMasterCfg?.webhook_url, cartaItem, cartasPorCodigo, masterData, mapa, cardMap, sobre);
                    if (imagePath) {
                        buffers.push(fs.readFileSync(imagePath));
                        esWishlist.push(!!cartaItem.isWishlist);
                        cantidades.push(contarCopiasEnCuenta(accountData, cartaItem.code));
                    }
                }
                if (buffers.length === 1) {
                    // Igual que en el collage: marcar con el corazón si esa única carta
                    // es el match de wishlist (ej. canal general con un sobre chico), y
                    // el badge de cantidad (a pedido explicito del usuario 2026-07-31).
                    bufferImagen = esWishlist[0] ? await superponerBadgeWishlist(buffers[0]) : buffers[0];
                    bufferImagen = await superponerBadgeCantidad(bufferImagen, cantidades[0]);
                } else if (buffers.length > 1) {
                    bufferImagen = await componerCollageImagenes(buffers, esWishlist, cantidades);
                }
            } else {
                imgPath = await resolverImagen(rutaMasterCfg?.webhook_url, data, cartasPorCodigo, masterData, mapa, cardMap, sobre);
                if (imgPath) {
                    bufferImagen = fs.readFileSync(imgPath);
                }
            }

            if (bufferImagen) {
                if (rutaLogoExpansion && configEmbed.mostrar_logo) {
                    bufferImagen = await componerLogoSobreImagen(bufferImagen, rutaLogoExpansion);
                    nombreArchivoImagen = 'carta.png';
                }
                embedPayload.embeds[0].image = { url: `attachment://${nombreArchivoImagen}` };
                formEmbed.append('files[0]', bufferImagen, { filename: nombreArchivoImagen });
            }

            // imgPath solo se usa en la rama genérica (una imagen); general/wishlist/godpack
            // arman bufferImagen directo (posible collage), por eso se loguea aparte.
            console.log(`DEBUG: enviar a canal=${data.tipoCanal} webhook=${canalDb.webhook_url.substring(0, 50)} imgPath=${imgPath || (bufferImagen ? `buffer(${bufferImagen.length} bytes)` : 'none')} data.nombre=${data.nombre} data.rareza=${data.rareza || 's4t'}`);
            formEmbed.append('payload_json', JSON.stringify(embedPayload));
            await axios.post(canalDb.webhook_url, formEmbed, { headers: formEmbed.getHeaders() }).then(() => {
                console.log(`DEBUG: enviado OK canal=${data.tipoCanal}`);
            }).catch(e => {
                console.error(`DEBUG: error enviando canal=${data.tipoCanal}`, e?.response?.status || '', e?.message || e);
            });

            if (S4T_FORWARD_XML) {
                // Solo reenvía el XML si llegó adjunto de verdad en esta petición
                // (multipart) — eso es lo que refleja si el checkbox "Send Account
                // XML" de la herramienta que lee el emulador estaba tildado o no.
                // El fallback a disco (xmlInput con source='disk') es solo para el
                // matching de cuenta/pull más arriba, no debe disparar un reenvío
                // a Discord que el usuario no pidió con ese checkbox.
                let xmlBuffer = null;
                let xmlName = null;
                if (req.files) {
                    const xmlFile = req.files.find(f => f.originalname.toLowerCase().endsWith('.xml'));
                    if (xmlFile) { xmlBuffer = xmlFile.buffer; xmlName = xmlFile.originalname; }
                }
                if (!xmlBuffer && xmlInput && xmlInput.source === 'multipart') {
                    xmlBuffer = Buffer.from(xmlInput.xmlContent, 'utf8');
                    xmlName = xmlInput.xmlName;
                }
                if (xmlBuffer && xmlName) {
                    const formXml = new FormData();
                    formXml.append('files[0]', xmlBuffer, { filename: xmlName });
                    await axios.post(canalDb.webhook_url, formXml, { headers: formXml.getHeaders() }).catch(() => {});
                }
            }
        }
    } catch (e) {
        console.error(e);
    }

    enviando = false;
});

// Solo escucha en localhost: el bot de Kevin (lector del emulador) corre en la
// misma PC y le apunta a "localhost:3000" — no hace falta exponerlo a la red.
// Si ese puerto ya está en uso (ej. una segunda copia de prueba en la misma
// PC) prueba automáticamente con el siguiente, hasta encontrar uno libre, sin
// necesitar tocar el .env a mano.
// Aviso persistente (no un popup, que no se ve de forma confiable con el
// proceso oculto) cuando el puerto real termina siendo distinto al de
// siempre — así la persona sabe qué poner en la Webhook URL de "S4T"/
// "Heartbeat" en el bot lector del emulador (ej. "P BOT" de Kevin). Un
// archivo de texto queda ahí para consultar cuando quieran, a diferencia de
// un popup que se puede cerrar sin querer.
const RUTA_AVISO_PUERTOS = path.join(__dirname, 'Ports in use.txt');
const ENCABEZADO_AVISO_PUERTOS = [
    'Some default ports were busy, so these services started on different ones.',
    'Update the Webhook URL in your reroll tool (P BOT) to match:',
    ''
];
function avisarPuertoCambiado(nombreServicio, puertoReal) {
    try {
        const prefijo = `${nombreServicio}: `;
        const lineaNueva = `${prefijo}http://localhost:${puertoReal}`;
        const lineasDatos = fs.existsSync(RUTA_AVISO_PUERTOS)
            ? fs.readFileSync(RUTA_AVISO_PUERTOS, 'utf8').split(/\r?\n/).filter((l) => l.includes(': http://localhost:') && !l.startsWith(prefijo))
            : [];
        fs.writeFileSync(RUTA_AVISO_PUERTOS, [...ENCABEZADO_AVISO_PUERTOS, ...lineasDatos, lineaNueva].join('\r\n') + '\r\n', 'utf8');
    } catch (e) { /* si falla, el puerto real igual queda en el log */ }
}

// Sin esto, si el conflicto de puertos era pasajero (ej. otra copia de
// prueba que ya se cerró) y el servicio vuelve a arrancar bien en su puerto
// de siempre, el archivo se quedaba con el aviso viejo para siempre — el
// usuario veía un puerto que ya no correspondía a nada real (bug real
// encontrado 2026-07-24: el panel mostraba localhost:3001 mientras el
// servicio real ya estaba de vuelta en el 3000).
function limpiarAvisoPuertoSiVuelveAlDefault(nombreServicio) {
    try {
        if (!fs.existsSync(RUTA_AVISO_PUERTOS)) return;
        const prefijo = `${nombreServicio}: `;
        const lineasDatos = fs.readFileSync(RUTA_AVISO_PUERTOS, 'utf8').split(/\r?\n/).filter((l) => l.includes(': http://localhost:') && !l.startsWith(prefijo));
        if (lineasDatos.length === 0) {
            fs.unlinkSync(RUTA_AVISO_PUERTOS);
        } else {
            fs.writeFileSync(RUTA_AVISO_PUERTOS, [...ENCABEZADO_AVISO_PUERTOS, ...lineasDatos].join('\r\n') + '\r\n', 'utf8');
        }
    } catch (e) { /* no bloquea el arranque */ }
}

const S4T_PORT_BASE = Number(process.env.S4T_PORT) || 3000;
function iniciarServidorS4T(puerto, intento = 0) {
    const servidor = app.listen(puerto, '127.0.0.1', () => {
        console.log(`🚀 S4T Online (port ${puerto})`);
        if (puerto !== S4T_PORT_BASE) avisarPuertoCambiado('S4T', puerto);
        else limpiarAvisoPuertoSiVuelveAlDefault('S4T');
    });
    servidor.on('error', (err) => {
        if (err.code === 'EADDRINUSE' && intento < 10) {
            console.log(`⚠️ Port ${puerto} is busy, trying ${puerto + 1}...`);
            iniciarServidorS4T(puerto + 1, intento + 1);
        } else {
            console.error(`❌ Could not start S4T: ${err.message}`);
        }
    });
}
iniciarServidorS4T(S4T_PORT_BASE);
