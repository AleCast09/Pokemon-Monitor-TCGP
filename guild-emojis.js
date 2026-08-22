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
    card_supporter: 'element/card_supporter.png',
    card_item: 'element/Casco_Dentado_EP.png',
    card_tool: 'element/card_tool.png',
    // Agregados 2026-08-22, a pedido explicito del usuario: antes fosil compartia el
    // mismo icono que Objeto (misma categoria mostrada en el juego real, ver comentario en
    // TEXTO_POR_TRAINER_TYPE en bot.js), y Estadio no tenia icono propio en absoluto.
    card_fossil: 'element/Fósil_aleta_LPZA.png',
    card_stadium: 'element/Kit_de_explorador_DBPR.png',
    item_poke_ball: 'element/Poke_Ball_EP.png',
    carta_profesor_oak: 'element/Carta_del_profesor_Oak_DBPR.png',
    // Iconos de inventario/Shinedust (2026-08-08, bug real reportado por un usuario): antes
    // vivian hardcodeados como <:Nombre:ID> con el ID de la aplicacion de bot de Ale -- para
    // cualquier otro usuario (su propia aplicacion de bot, sin ese emoji) Discord no podia
    // resolverlos y se veian como texto plano (":Pokelingote_TCGP:"). Mismo mecanismo que el
    // resto de FUENTES_EMOJIS: se sube solo a cada servidor la primera vez que hace falta.
    Card_Back_TCGP: 'element/Card Back.PNG',
    Polvo_iris_TCGP: 'element/Polvo_iris_TCGP.png',
    Pokelingote_TCGP: 'element/Pokelingote_TCGP.png',
    Cupon_de_tienda_TCGP: 'element/Cupon_de_tienda_TCGP.png',
    Cupon_de_tienda_especial_TCGP: 'element/Cupon_de_tienda_especial_TCGP.png',
    Cupon_premium_TCGP: 'element/Cupon_premium_TCGP.png',
    Reloj_de_arena_de_sobres_TCGP: 'element/Reloj_de_arena_de_sobres_TCGP.png',
    Reloj_de_arena_magico_TCGP: 'element/Reloj_de_arena_magico_TCGP.png',
    Retronometro_TCGP: 'element/Retronometro_TCGP.png',
    Reloj_arena_intercambio_TCGP: 'element/Reloj_de_arena_de_intercambio_TCGP.png',
    // Panel de trade rapido desde la pagina web (2026-08-08, a pedido explicito del usuario):
    // icono del boton "Start Trade" y los check/cruz del log en vivo de la ejecucion.
    Ficha_de_intercambio_TCGP: 'element/Ficha_de_intercambio_TCGP.png',
    nice: 'element/nice.png',
    bad: 'element/bad.png'
};

// El link de invitación de OAuth2 no es secreto, y cada usuario final corre su
// propia aplicación de bot con IDs de emoji distintos a los del dueño — por
// eso no se puede hardcodear un ID de emoji, hay que subirlos por servidor.
const cachePorGuild = new Map();
const promesaEnCursoPorGuild = new Map();

// Bug real reportado (2026-07-27): si un emoji custom se borra/recrea en el
// servidor (por ejemplo al probar "Reset Total", o por llegar al límite de
// espacios de emoji), el ID cacheado queda apuntando a un emoji que ya no
// existe — Discord no puede resolverlo y lo muestra como texto plano
// (":rareza_estrella:") en vez de la imagen. Como este caché nunca vencía,
// quedaba roto para siempre hasta reiniciar el proceso a mano. Con un TTL,
// la próxima vez que se pida el mapa (que pasa todo el tiempo, en casi
// cualquier comando) se vuelve a construir solo — y como
// construirMapaEmojisGuild() ya sube de nuevo cualquier emoji que no
// encuentre por nombre, se autorepara sin intervención.
const CACHE_TTL_MS = 10 * 60 * 1000;

// s4t.js corre en un proceso PM2 aparte, sin cliente de discord.js propio, así
// que no puede llamar guild.emojis.fetch()/.create() como acá. En vez de
// duplicar la lógica de subida ahí (y volver a tener IDs fijos por-usuario,
// el mismo bug que este archivo existe para evitar), bot.js vuelca acá el
// mapa ya resuelto cada vez que lo arma, y s4t.js simplemente lo lee del
// disco — funciona automático para cualquier usuario/servidor, sin que
// s4t.js necesite saber nada de guilds ni tener su propio token de bot.
const CACHE_DISCO_PATH = path.join(__dirname, 'assets', 'guild_emojis_cache.json');
function guardarCacheEnDisco(mapa) {
    try {
        fs.writeFileSync(CACHE_DISCO_PATH, JSON.stringify(mapa));
    } catch (e) {
        console.error('❌ No se pudo guardar la caché de emojis en disco (para s4t.js):', e?.message || e);
    }
}

// Bug real encontrado 2026-08-09 (logs de un usuario probando en vivo): "Card_Back_TCGP"
// nunca se subia para NADIE -- Discord devolvia "Invalid Form Body / File cannot be larger
// than 2048.0 kb" porque el asset de origen (element/Card Back.PNG) es el arte completo de
// una carta (1214x1695px, 2.5MB), pensado para otro uso, no un emoji. Los emoji de Discord
// tienen que entrar en 128x128 y bien por debajo del limite de tamaño del servidor -- se
// redimensiona siempre antes de subir (manteniendo proporcion, sin agrandar los que ya son
// chicos) para que cualquier asset futuro que tampoco venga pre-recortado a tamaño de emoji
// no rompa la subida de la misma forma.
// Reintento con backoff corto (2026-08-17, bug real reportado: dos usuarios con Administrador
// y dueño real del servidor confirmados igual nunca lograban que se creara un lote grande de
// emojis de una sola vez en un servidor nuevo -- en pruebas en vivo contra un servidor real, la
// MISMA llamada a veces fallaba y, reintentada poco despues, funcionaba perfecto (probablemente
// alguna demora/limite transitorio del lado de Discord al crear muchos emojis seguidos, no
// reproducible de forma consistente). Antes de esto un solo fallo dejaba esa clave sin crear
// hasta el proximo refresco automatico (10 min despues) -- ahora se reintenta unas pocas veces
// enseguida, sin depender de tener que esperar tanto para el caso mas comun (falla transitoria).
async function subirEmojiFaltante(guild, nombre, rutaRelativa) {
    const rutaAbsoluta = path.join(__dirname, 'assets', rutaRelativa);
    const bufferOriginal = fs.readFileSync(rutaAbsoluta);
    const buffer = await sharp(bufferOriginal)
        .resize(128, 128, { fit: 'inside', withoutEnlargement: true })
        .png({ compressionLevel: 9 })
        .toBuffer();

    const INTENTOS = 3;
    let ultimoError;
    for (let intento = 1; intento <= INTENTOS; intento++) {
        try {
            const nuevo = await guild.emojis.create({ attachment: buffer, name: nombre });
            return nuevo.id;
        } catch (e) {
            ultimoError = e;
            if (intento < INTENTOS) await new Promise((resolve) => setTimeout(resolve, 2000 * intento));
        }
    }
    throw ultimoError;
}

// Ultimo motivo de fallo por emoji, por guild (2026-08-15, bug real reportado: dos usuarios
// con permiso de Administrador confirmado igual no podian crear todo un lote de emojis, sin
// forma de saber POR QUE mas alla de un console.error que ellos nunca ven). Se guarda aca
// (no en el mapa devuelto) para no mezclar datos con FUENTES_EMOJIS -- bot.js lo lee aparte al
// armar el aviso por DM, para mostrar el error real de Discord en vez de seguir adivinando.
const erroresPorGuild = new Map();
function obtenerErroresEmojisGuild(guildId) {
    return erroresPorGuild.get(guildId) || {};
}

// Limpieza de duplicados (2026-08-21, bug real reportado por el usuario -- confirmado con
// una captura real del servidor de un tercero: dos emojis con el mismo nombre exacto, uno al
// lado del otro). Discord permite nombres repetidos sin quejarse (no hay ninguna proteccion de
// su lado), asi que si el proceso reinicia justo en medio de crear un emoji (algo que paso
// seguido probando en vivo esta sesion), una corrida nueva puede no ver todavia el que se
// acaba de crear y termina subiendo OTRO con el mismo nombre. Cada duplicado ocupa un espacio
// de los 50 que da Discord sin usuario -- con varios duplicados, emojis genuinamente nuevos
// (los ultimos del lote, por orden) se quedan sin espacio y fallan con "Maximum number of
// emojis reached", exactamente el sintoma reportado. Se queda con el MAS VIEJO de cada nombre
// (createdTimestamp mas chico) y borra el resto -- conserva el que mas tiempo lleva en uso
// (mas chance de estar ya referenciado en algun cache/mensaje viejo).
async function limpiarEmojisDuplicados(guild, existentes) {
    const porNombre = new Map();
    for (const emoji of existentes.values()) {
        if (!porNombre.has(emoji.name)) porNombre.set(emoji.name, []);
        porNombre.get(emoji.name).push(emoji);
    }
    let borrados = 0;
    for (const [nombre, lista] of porNombre) {
        if (lista.length < 2) continue;
        lista.sort((a, b) => (a.createdTimestamp || 0) - (b.createdTimestamp || 0));
        for (const duplicado of lista.slice(1)) {
            try {
                await duplicado.delete('Duplicado — mismo nombre que otro emoji ya existente');
                borrados++;
            } catch (e) {
                console.error(`❌ No se pudo borrar el emoji duplicado "${nombre}" (${duplicado.id}) en ${guild.name}:`, e?.message || e);
            }
        }
    }
    return borrados;
}

// Nombres que en algun momento estuvieron en FUENTES_EMOJIS y ya no (2026-08-22, a pedido
// explicito del usuario): sacar una clave de FUENTES_EMOJIS solo hace que el bot deje de
// CREARLA -- no borra la que ya existe en un servidor real, asi que se queda ocupando uno de
// los 50 espacios para siempre. Eso es justo lo que paso probando en vivo: 12 emojis
// confirmados sin uso (ver el chequeo real contra el codigo) se sacaron del mapa, pero
// seguian sentados en el servidor, y por eso los nuevos (card_fossil/card_stadium) no
// entraban. Esta lista es explicita a proposito -- nunca se borra un emoji solo por "no estar
// en FUENTES_EMOJIS", eso arriesgaria borrar un emoji propio del usuario que nada tiene que
// ver con el bot y que por casualidad no matchea ningun nombre nuestro actual.
const NOMBRES_EMOJIS_DADOS_DE_BAJA = [
    'poke_ball', 'item_master_ball', 'item_ultra_ball', 'item_repelente', 'item_tarjeta_roja',
    'item_mochila_escape', 'item_pokemuneco', 'cordon_union', 'diario', 'leyenda', 'paquete',
    'estrella_tienda', 'item_polvo_estelar', 'bolsa_monedas', 'tarjeta_puntos'
];
async function limpiarEmojisDadosDeBaja(guild, existentes) {
    let borrados = 0;
    for (const emoji of existentes.values()) {
        if (!NOMBRES_EMOJIS_DADOS_DE_BAJA.includes(emoji.name)) continue;
        try {
            await emoji.delete('Dado de baja -- ya no esta en FUENTES_EMOJIS, ocupaba espacio sin uso');
            borrados++;
        } catch (e) {
            console.error(`❌ No se pudo borrar el emoji dado de baja "${emoji.name}" (${emoji.id}) en ${guild.name}:`, e?.message || e);
        }
    }
    return borrados;
}

async function construirMapaEmojisGuild(guild) {
    let existentes = await guild.emojis.fetch();
    const borradosDuplicados = await limpiarEmojisDuplicados(guild, existentes);
    const borradosDeBaja = await limpiarEmojisDadosDeBaja(guild, existentes);
    if (borradosDuplicados > 0 || borradosDeBaja > 0) {
        console.log(`DEBUG: se borraron ${borradosDuplicados} duplicado(s) y ${borradosDeBaja} emoji(s) dado(s) de baja en ${guild.name}`);
        existentes = await guild.emojis.fetch();
    }
    const mapa = {};
    const errores = {};
    for (const [nombre, rutaRelativa] of Object.entries(FUENTES_EMOJIS)) {
        const existente = existentes.find((e) => e.name === nombre);
        if (existente) {
            mapa[nombre] = existente.id;
            continue;
        }
        // Reconfirmacion justo antes de crear (2026-08-20, bug real reportado: un usuario
        // terminó con emojis DUPLICADOS, mismo nombre exacto -- Discord no rechaza nombres
        // repetidos, asi que no hay red de seguridad del lado de ellos). La lista
        // "existentes" de arriba es una foto de UNA sola vez al principio de esta funcion;
        // si el usuario reinicio el bot varias veces seguidas mientras probaba (cada
        // reinicio arranca esta funcion de cero, sin memoria de intentos anteriores) y
        // Discord tardo un toque en reflejar una creacion muy reciente, dos corridas
        // pueden creer -A LA VEZ- que a este emoji le falta crearse. Un refetch justo
        // antes de cada creacion (no solo una vez al principio) angosta muchisimo esa
        // ventana -- cuesta una llamada extra a la API solo cuando de verdad falta crear
        // algo, no en el camino feliz donde ya esta todo creado.
        try {
            existentes = await guild.emojis.fetch();
        } catch (e) {
        }
        const existenteFresco = existentes.find((e) => e.name === nombre);
        if (existenteFresco) {
            mapa[nombre] = existenteFresco.id;
            continue;
        }
        try {
            mapa[nombre] = await subirEmojiFaltante(guild, nombre, rutaRelativa);
        } catch (e) {
            const motivo = e?.message || String(e);
            console.error(`❌ No se pudo crear el emoji "${nombre}" en ${guild.name}:`, motivo);
            errores[nombre] = motivo;
        }
    }
    erroresPorGuild.set(guild.id, errores);
    return mapa;
}

// Devuelve { nombre: id }, mismo formato que los viejos rarity_emojis.json /
// type_emojis.json / card_emojis.json — así el código que arma el tag
// `<:nombre:id>` a mano no necesita cambiar. Sube lo que falte la primera vez
// y cachea en memoria el resto de la sesión.
async function obtenerMapaEmojisGuild(guild) {
    if (!guild) return {};
    const cacheado = cachePorGuild.get(guild.id);
    if (cacheado && Date.now() - cacheado.ts < CACHE_TTL_MS) return cacheado.mapa;
    if (promesaEnCursoPorGuild.has(guild.id)) return promesaEnCursoPorGuild.get(guild.id);

    const promesa = construirMapaEmojisGuild(guild).then((mapa) => {
        cachePorGuild.set(guild.id, { mapa, ts: Date.now() });
        promesaEnCursoPorGuild.delete(guild.id);
        guardarCacheEnDisco(mapa);
        return mapa;
    }).catch((e) => {
        promesaEnCursoPorGuild.delete(guild.id);
        console.error(`❌ Error armando emojis para ${guild?.name || guild?.id}:`, e?.message || e);
        // Si falla la reconstrucción pero ya había un mapa viejo cacheado, mejor
        // seguir usando ese (emojis viejos que sí funcionan) que devolver vacío
        // (todos los emojis rotos de golpe por un error de red puntual).
        return cacheado?.mapa || {};
    });
    promesaEnCursoPorGuild.set(guild.id, promesa);
    return promesa;
}

module.exports = { obtenerMapaEmojisGuild, FUENTES_EMOJIS, obtenerErroresEmojisGuild };
