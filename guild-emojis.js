const fs = require('fs');
const path = require('path');
// Mismo wrapper que usan bot.js/s4t.js: dentro del .exe empaquetado (SEA), un
// require() directo de un módulo nativo como sharp falla con
// ERR_UNKNOWN_BUILTIN_MODULE — native-require.js resuelve un require real
// basado en disco en su lugar.
const sharp = require('./native-require.js')('sharp');

// Nombre de emoji -> ruta relativa dentro de assets/. Confirmado byte a byte
// contra los emojis reales ya subidos a la aplicación de bot del dueño
// (rareza_diamante=01, rareza_estrella=02, rareza_corona=03, rareza_brillante=shiny1).
const FUENTES_EMOJIS = {
    rareza_diamante: 'element/cmn_icn_rarity_01.png',
    rareza_estrella: 'element/cmn_icn_rarity_02.png',
    rareza_corona: 'element/cmn_icn_rarity_03.png',
    rareza_brillante: 'element/shiny1.png',
    icono_wishlist: 'emojis/wishlist.png',
    type_water: 'element/type_water.avif',
    type_fire: 'element/type_fire.avif',
    type_psychic: 'element/type_psychic.avif',
    type_grass: 'element/type_grass.avif',
    type_lightning: 'element/type_lightning.avif',
    type_fighting: 'element/type_fighting.avif',
    type_darkness: 'element/type_darkness.avif',
    type_metal: 'element/type_metal.avif',
    type_dragon: 'element/type_dragon.avif',
    type_colorless: 'element/type_colorless.avif',
    card_supporter: 'element/card_supporter.avif',
    card_item: 'element/card_item.avif'
};

// El link de invitación de OAuth2 no es secreto, y cada usuario final corre su
// propia aplicación de bot con IDs de emoji distintos a los del dueño — por
// eso no se puede hardcodear un ID de emoji, hay que subirlos por servidor.
const cachePorGuild = new Map();
const promesaEnCursoPorGuild = new Map();

async function subirEmojiFaltante(guild, nombre, rutaRelativa) {
    const rutaAbsoluta = path.join(__dirname, 'assets', rutaRelativa);
    let buffer = fs.readFileSync(rutaAbsoluta);
    if (/\.(avif|webp)$/i.test(rutaRelativa)) {
        buffer = await sharp(buffer).png().toBuffer();
    }
    const nuevo = await guild.emojis.create({ attachment: buffer, name: nombre });
    return nuevo.id;
}

async function construirMapaEmojisGuild(guild) {
    const existentes = await guild.emojis.fetch();
    const mapa = {};
    for (const [nombre, rutaRelativa] of Object.entries(FUENTES_EMOJIS)) {
        const existente = existentes.find((e) => e.name === nombre);
        if (existente) {
            mapa[nombre] = existente.id;
            continue;
        }
        try {
            mapa[nombre] = await subirEmojiFaltante(guild, nombre, rutaRelativa);
        } catch (e) {
            console.error(`❌ No se pudo crear el emoji "${nombre}" en ${guild.name}:`, e?.message || e);
        }
    }
    return mapa;
}

// Devuelve { nombre: id }, mismo formato que los viejos rarity_emojis.json /
// type_emojis.json / card_emojis.json — así el código que arma el tag
// `<:nombre:id>` a mano no necesita cambiar. Sube lo que falte la primera vez
// y cachea en memoria el resto de la sesión.
async function obtenerMapaEmojisGuild(guild) {
    if (!guild) return {};
    if (cachePorGuild.has(guild.id)) return cachePorGuild.get(guild.id);
    if (promesaEnCursoPorGuild.has(guild.id)) return promesaEnCursoPorGuild.get(guild.id);

    const promesa = construirMapaEmojisGuild(guild).then((mapa) => {
        cachePorGuild.set(guild.id, mapa);
        promesaEnCursoPorGuild.delete(guild.id);
        return mapa;
    }).catch((e) => {
        promesaEnCursoPorGuild.delete(guild.id);
        console.error(`❌ Error armando emojis para ${guild?.name || guild?.id}:`, e?.message || e);
        return {};
    });
    promesaEnCursoPorGuild.set(guild.id, promesa);
    return promesa;
}

module.exports = { obtenerMapaEmojisGuild, FUENTES_EMOJIS };
