require('dotenv').config();
const express = require('express');
const axios = require('axios');
const multer = require('multer');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');
const sharp = require('./native-require.js')('sharp');
const db = require('./database.js');

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
        let mapa = {};
        // Un mismo nombre puede tener varias variantes/rarezas (ej. "Pikachu" común
        // y "Pikachu" 1-star); se guardan TODAS para poder elegir la correcta según
        // la rareza detectada, en vez de quedarnos solo con la última encontrada.
        for (let id in cardmaster) {
            let nombreIngles = en_US[cardmaster[id].Name];
            if (nombreIngles) {
                const clave = normalizeText(nombreIngles);
                if (!mapa[clave]) mapa[clave] = [];
                mapa[clave].push({ code: id, rarity: cardmaster[id].Rarity, illustrationId: cardmaster[id].IllustrationID });
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

let _mapaRarezaEmojis = null;
function cargarMapaRarezaEmojis() {
    if (_mapaRarezaEmojis) return _mapaRarezaEmojis;
    try {
        _mapaRarezaEmojis = JSON.parse(fs.readFileSync(path.join(__dirname, 'assets', 'rarity_emojis.json'), 'utf8'));
    } catch (e) {
        _mapaRarezaEmojis = {};
    }
    return _mapaRarezaEmojis;
}

let _mapaTipoEmojis = null;
function cargarMapaTipoEmojis() {
    if (_mapaTipoEmojis) return _mapaTipoEmojis;
    try {
        _mapaTipoEmojis = JSON.parse(fs.readFileSync(path.join(__dirname, 'assets', 'type_emojis.json'), 'utf8'));
    } catch (e) {
        _mapaTipoEmojis = {};
    }
    return _mapaTipoEmojis;
}

let _mapaTiposCarta = null;
function cargarMapaTiposCarta() {
    if (_mapaTiposCarta) return _mapaTiposCarta;
    try {
        _mapaTiposCarta = JSON.parse(fs.readFileSync(path.join(__dirname, 'assets', 'card_types.json'), 'utf8'));
    } catch (e) {
        _mapaTiposCarta = {};
    }
    return _mapaTiposCarta;
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

function obtenerTagTipoPorNombre(nombreIngles) {
    if (!nombreIngles) return null;
    const mapaTipos = cargarMapaTiposCarta();
    const tipoIngles = mapaTipos[normalizeText(nombreIngles)];
    if (!tipoIngles) return null;

    const config = TIPO_LABELS[tipoIngles.toLowerCase()];
    if (!config) return null;

    const mapaEmojis = cargarMapaTipoEmojis();
    const idEmoji = mapaEmojis[config.emoji];
    const tag = idEmoji ? `<:${config.emoji}:${idEmoji}>` : '';
    return { tag, label: config.label };
}

const EXPANSIONS_DIR = path.join(__dirname, 'assets', 'expansions');
function normalizarNombreExpansion(texto) {
    return texto.toLowerCase().replace(/[^a-z0-9]/g, '');
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
async function componerCollageImagenes(buffers) {
    try {
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

async function obtenerImagenHD(cardMap, code) {
    if (!code || !cardMap || !cardMap[code] || !GOOGLE_DRIVE_API_KEY || !GOOGLE_DRIVE_HD_ENABLED) return null;
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

async function resolverImagen(rutaMaster, data, cartasPorCodigo, masterData, mapa, cardMap) {
    if (!rutaMaster || !data) return null;

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
            const imagen = encontrarImagen(rutaMaster, cartaEncontrada.illustrationId);
            if (imagen) return imagen;
        }
        // Try cardMap lookup by code -> IllustrationID
        if (cardMap && cartaEncontrada.code && cardMap[cartaEncontrada.code] && cardMap[cartaEncontrada.code].IllustrationID) {
            const ilustr = cardMap[cartaEncontrada.code].IllustrationID;
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
        let elegida = null;
        if (data.rareza) {
            elegida = variantesPorNombre.find(v => mapearRarezaNumerica(v.rarity, v.code) === data.rareza);
        }
        if (!elegida) elegida = variantesPorNombre[0];
        const imagenHD = await obtenerImagenHD(cardMap, elegida.code);
        if (imagenHD) return imagenHD;
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
        let matchingMasterKey = null;
        if (data.rareza) {
            matchingMasterKey = matchingKeys.find(key => mapearRarezaNumerica(masterData.cardmaster[key].Rarity, key) === data.rareza);
        }
        if (!matchingMasterKey) matchingMasterKey = matchingKeys[0];
        if (matchingMasterKey) {
            const imagenHD = await obtenerImagenHD(cardMap, matchingMasterKey);
            if (imagenHD) return imagenHD;
            const illustrationId = (masterData.cardmaster[matchingMasterKey] || {}).IllustrationID;
            if (illustrationId) {
                const imagen = encontrarImagen(rutaMaster, illustrationId);
                if (imagen) return imagen;
            }
        }
    }

    const imagenDirecta = encontrarImagen(rutaMaster, data.nombre);
    if (imagenDirecta) return imagenDirecta;

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
                const nombreCarta = normalizarNombreEx(obtenerNombreCartaDesdeLineas(lineas, i + 1));
                if (nombreCarta) {
                    console.log(`DEBUG: rareza detectada=${rareza} linea="${textoLinea}" carta="${nombreCarta}"`);
                    const lineaConIcono = formatearLineaRareza(lineas[i], rareza);
                    const displayCarta = configEmbed.mostrar_categoria
                        ? `> ${lineaConIcono}\n> **${nombreCarta}**`
                        : `> **${nombreCarta}**`;
                    cartas.push({ rareza, nombre: nombreCarta, display: displayCarta });
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
            const tipoInfo = obtenerTagTipoPorNombre(carta.nombre);
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

        const esGodPack = /god\s*pack|godpack/i.test(payload) || cartas.length >= 5;
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

        if (cartas.length > 0) {
            const displayGeneral = cartas.map(c => c.display).join('\n\n');
            // Arte oficial de CardImageCache en vez de la captura de pantalla cruda
            // del teléfono (baja calidad) — mismo criterio que wishlist/godpack.
            const cartasGeneral = cartas.map(c => c.matchedCard || c);
            envios.push({ tipoCanal: 's4t', display: displayGeneral, cartasGeneral });
        }

        for (const c of cartas) {
            envios.push({ tipoCanal: c.rareza, display: c.display, nombre: c.nombre, rareza: c.rareza, carta: c.matchedCard || null });
        }

        if (wishlistUnificada.length > 0) {
            const listaNombres = wishlistUnificada
                .map(w => {
                    const tipoInfo = configEmbed.mostrar_tipo ? obtenerTagTipoPorNombre(w.nombre) : null;
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
                const tipoInfo = configEmbed.mostrar_tipo ? obtenerTagTipoPorNombre(c.nombre) : null;
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
                        ? '**A wishlist card has been detected.**\nSaved in the S4T database.'
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
                for (const cartaItem of listaCartas) {
                    const imagePath = await resolverImagen(rutaMasterCfg?.webhook_url, cartaItem, cartasPorCodigo, masterData, mapa, cardMap);
                    if (imagePath) buffers.push(fs.readFileSync(imagePath));
                }
                if (buffers.length === 1) {
                    bufferImagen = buffers[0];
                } else if (buffers.length > 1) {
                    bufferImagen = await componerCollageImagenes(buffers);
                }
            } else {
                imgPath = await resolverImagen(rutaMasterCfg?.webhook_url, data, cartasPorCodigo, masterData, mapa, cardMap);
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
                // Prefer XML from multipart request; fall back to XML read from disk
                let xmlBuffer = null;
                let xmlName = null;
                if (req.files) {
                    const xmlFile = req.files.find(f => f.originalname.toLowerCase().endsWith('.xml'));
                    if (xmlFile) { xmlBuffer = xmlFile.buffer; xmlName = xmlFile.originalname; }
                }
                if (!xmlBuffer && xmlInput) {
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
// Puerto configurable solo para poder correr una segunda copia de prueba en
// la misma PC sin chocar con la real — en uso normal no hace falta tocarlo.
const S4T_PORT = Number(process.env.S4T_PORT) || 3000;
app.listen(S4T_PORT, '127.0.0.1', () => console.log(`🚀 S4T Online (port ${S4T_PORT})`));
