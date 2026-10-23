// Modo comunidad (2026-10-23, plan de Ale y wr98): el MISMO bot atiende un server comunitario
// (Zenith Rise, de wr98) con solo los canales prioritarios -- MANAGER y RUN MUMU PLAYER -- mas una
// categoria privada 🔒 STAFF, y sin exponer los datos de la PC donde corre el bot.
//
// APAGADO para todos por defecto: solo se activa para los servers listados en el .env. Para
// cualquier otro server (el propio de Ale, los de los usuarios del release) el bot funciona igual
// que siempre.
//
// .env:
//   COMMUNITY_GUILD_IDS=123...,456...   servers en modo comunidad
//   COMMUNITY_STAFF_IDS=111...,222...   usuarios de Discord del staff (Ale, wr98, ...)
//
// Mientras no exista el programa de cada miembro para vincular SUS cuentas, en el server de
// comunidad solo el staff puede usar el bot: cualquier otro recibe un aviso y nunca ve datos.
const { PermissionsBitField, OverwriteType } = require('discord.js');

function lista(nombre) {
    return (process.env[nombre] || '').split(',').map(x => x.trim()).filter(Boolean);
}

function esComunidad(guildId) {
    return !!guildId && lista('COMMUNITY_GUILD_IDS').includes(String(guildId));
}

function esStaff(userId) {
    return !!userId && lista('COMMUNITY_STAFF_IDS').includes(String(userId));
}

// Comandos que existen en el server de comunidad (los de los canales prioritarios + /setup para
// el staff). Todo lo demas (/embed, /webhook, /run, /feedback, ...) no se registra ahi.
const COMANDOS_COMUNIDAD = new Set(['setup', 'card', 'wishlist', 'goldcards', 'extract', 'shinedust', 'farmtickets', 'transfers']);

function comandosPara(guildId, comandos) {
    return esComunidad(guildId) ? comandos.filter(c => COMANDOS_COMUNIDAD.has(c.name)) : comandos;
}

// Categorias de Sync Channels: en comunidad solo MANAGER y RUN MUMU PLAYER, mas 🔒 STAFF privada
// (⚙-settings para Sync/reparar y 🔒-hosts para el relevo entre los bots de Ale y wr98).
const CATEGORIAS_COMUNIDAD = new Set(['manager_categoria', 'run_mumu_categoria']);

function gruposSync(guildId, grupos) {
    if (!esComunidad(guildId)) return grupos;
    return [
        ...grupos.filter(g => CATEGORIAS_COMUNIDAD.has(g.tipoCategoria)),
        {
            categoria: '🔒 STAFF 🔒',
            tipoCategoria: 'staff_categoria',
            privado: true,
            canales: [
                { tipo: 'cmd_setup', name: '⚙-settings' },
                { tipo: 'hosts', name: '🔒-hosts' }
            ]
        }
    ];
}

// Permisos de una categoria privada: nadie la ve salvo el bot y el staff.
function permisosPrivados(guild) {
    return [
        { id: guild.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] },
        { id: guild.members.me.id, allow: [PermissionsBitField.Flags.Administrator, PermissionsBitField.Flags.ViewChannel] },
        ...lista('COMMUNITY_STAFF_IDS').map(id => ({
            id, type: OverwriteType.Member,
            allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory]
        }))
    ];
}

// Guardia al principio de interactionCreate. Devuelve true si la interaccion se corto aca.
async function bloquearSiHaceFalta(interaction) {
    if (!esComunidad(interaction.guildId) || esStaff(interaction.user?.id)) return false;
    if (interaction.isAutocomplete()) {
        await interaction.respond([]).catch(() => {});
        return true;
    }
    const aviso = '🔒 This bot is in private testing here.\n' +
        'Soon you\'ll be able to link **your own accounts** from your PC — until then only staff can use it.';
    try {
        if (interaction.deferred || interaction.replied) await interaction.followUp({ content: aviso, ephemeral: true });
        else await interaction.reply({ content: aviso, ephemeral: true });
    } catch (e) { /* interaccion vencida */ }
    return true;
}

// Saca de un payload los botones/menus cuyo customId empieza con alguno de los prefijos (los de
// MuMu/needles, que en comunidad no tienen sentido). Filas que quedan vacias se eliminan.
function quitarComponentes(guildId, payload, prefijos) {
    if (!esComunidad(guildId) || !payload?.components) return payload;
    payload.components = payload.components.map(fila => {
        const quedan = (fila.components || []).filter(c => !prefijos.some(p => (c.data?.custom_id || '').startsWith(p)));
        if (quedan.length === (fila.components || []).length) return fila;
        fila.components = quedan;
        return fila;
    }).filter(fila => (fila.components || []).length);
    return payload;
}

module.exports = { esComunidad, esStaff, comandosPara, gruposSync, permisosPrivados, bloquearSiHaceFalta, quitarComponentes };
