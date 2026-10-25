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
//   COMMUNITY_STAFF_IDS=111...,222...   staff fijo (Ale y wr98): nunca pierden el acceso
//   COMMUNITY_STAFF_ROLE=Staff          opcional, nombre del rol de staff (por defecto "Staff")
//
// Para sumar staff no hace falta tocar el .env: quien tenga el rol "Staff" en el server es staff
// (pedido de Ale: que wr98 pueda sumar gente desde Discord, sin depender de la PC de Ale). Sync
// Channels crea el rol si no existe y le da acceso a la categoria 🔒 STAFF.
//
// Mientras no exista el programa de cada miembro para vincular SUS cuentas, en el server de
// comunidad solo el staff puede usar el bot: cualquier otro recibe un aviso y nunca ve datos.
const { PermissionsBitField, OverwriteType } = require('discord.js');
const { AsyncLocalStorage } = require('async_hooks');

// Quien esta usando el bot en este momento (por interaccion). En el server de comunidad, las
// funciones que leen la carpeta de cuentas usan el resumen de Monitor Link de ESE usuario en vez de
// la carpeta de la PC host (ver monitor-link-server.js). Fuera de comunidad no cambia nada.
const contexto = new AsyncLocalStorage();

function usuarioActual() {
    const s = contexto.getStore();
    return s && esComunidad(s.guildId) ? s.userId : null;
}

function lista(nombre) {
    return (process.env[nombre] || '').split(',').map(x => x.trim()).filter(Boolean);
}

// Modo host (host.js): este proceso es el bot de la comunidad (Zenith Bot) y SOLO atiende los
// servers de COMMUNITY_GUILD_IDS; cualquier otro server donde este (por ejemplo, el de los emojis) se
// ignora, sin salirse.
function soloComunidad() {
    return process.env.MONITOR_HOST_MODE === 'community';
}

// Hay comunidad configurada en este proceso (si no, Monitor Link no se monta: el bot normal de Ale
// deja de atender /link en cuanto la comunidad pasa a Zenith Bot).
function hayComunidad() {
    return lista('COMMUNITY_GUILD_IDS').length > 0;
}

function esComunidad(guildId) {
    return !!guildId && lista('COMMUNITY_GUILD_IDS').includes(String(guildId));
}

// "Staff" (2026-10-24, pedido de Ale; antes "Bot Staff", que se renombra solo la primera vez).
const nombreRolStaff = () => (process.env.COMMUNITY_STAFF_ROLE || 'Staff').trim();

// member (opcional): el GuildMember de la interaccion, para mirar si tiene el rol de staff.
function esStaff(userId, member = null) {
    if (!userId) return false;
    if (lista('COMMUNITY_STAFF_IDS').includes(String(userId))) return true;
    return !!member?.roles?.cache?.some?.(r => r.name === nombreRolStaff());
}

// El rol de staff del server (lo crea si no existe). Sin permisos propios: solo marca quien es staff.
async function rolStaff(guild) {
    const nombre = nombreRolStaff();
    const existente = guild.roles.cache.find(r => r.name === nombre);
    if (existente) return existente;
    const viejo = guild.roles.cache.find(r => r.name === 'Bot Staff');
    if (viejo) return await viejo.setName(nombre, 'Monitor Pokemon: staff role renamed').catch(() => viejo);
    return await guild.roles.create({ name: nombre, permissions: [], mentionable: false, reason: 'Monitor Pokemon: community staff' })
        .catch(e => { console.error('DEBUG: no se pudo crear el rol de staff:', e?.message || e); return null; });
}

// Comandos que existen en el server de comunidad (los de los canales prioritarios + /setup para
// el staff). Todo lo demas (/embed, /webhook, /run, /feedback, ...) no se registra ahi.
// Sin /extract (2026-10-24, pedido de Ale: Extract XML esta de mas en la comunidad).
const COMANDOS_COMUNIDAD = new Set(['setup', 'card', 'wishlist', 'goldcards', 'shinedust', 'farmtickets', 'transfers', 'link']);
// Canales de las categorias de siempre que en la comunidad no van (Sync los borra si ya existen).
const CANALES_FUERA_DE_COMUNIDAD = new Set(['cmd_extract_xlm']);
// Comandos que SOLO existen en comunidad (en el server propio y en los del release no aparecen).
const SOLO_COMUNIDAD = new Set(['link']);
// Comandos que cualquier miembro puede usar aunque el server este en prueba (solo staff).
const ABIERTOS_A_TODOS = new Set(['link']);

function comandosPara(guildId, comandos) {
    return esComunidad(guildId)
        ? comandos.filter(c => COMANDOS_COMUNIDAD.has(c.name))
        : comandos.filter(c => !SOLO_COMUNIDAD.has(c.name));
}

// Categorias de Sync Channels: en comunidad solo MANAGER y RUN MUMU PLAYER, mas 🔒 STAFF privada
// (⚙-settings para Sync/reparar y 🔒-hosts para el relevo entre los bots de Ale y wr98).
const CATEGORIAS_COMUNIDAD = new Set(['manager_categoria', 'run_mumu_categoria']);

function gruposSync(guildId, grupos) {
    if (!esComunidad(guildId)) return grupos;
    return [
        // Bienvenida: la ve todo el server; ahi se usa /link (al vincular llega el rol Monitor).
        { categoria: '👋 START 👋', tipoCategoria: 'start_categoria', acceso: 'todos', canales: [{ tipo: 'start_here', name: '🔗-start-here' }] },
        ...grupos.filter(g => CATEGORIAS_COMUNIDAD.has(g.tipoCategoria))
            .map(g => ({ ...g, acceso: 'monitor', canales: g.canales.filter(c => !CANALES_FUERA_DE_COMUNIDAD.has(c.tipo)) })),
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

// Permisos de una categoria privada: nadie la ve salvo el bot y el staff (fijo y con el rol).
async function permisosPrivados(guild) {
    const rol = await rolStaff(guild);
    const verYEscribir = [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory];
    return [
        ...(rol ? [{ id: rol.id, type: OverwriteType.Role, allow: verYEscribir }] : []),
        { id: guild.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] },
        { id: guild.members.me.id, allow: [PermissionsBitField.Flags.Administrator, PermissionsBitField.Flags.ViewChannel] },
        ...lista('COMMUNITY_STAFF_IDS').map(id => ({ id, type: OverwriteType.Member, allow: verYEscribir }))
    ];
}

// Rol "Monitor" (2026-10-24, pedido de Ale): lo da el bot solo cuando el miembro vincula su PC con
// /link. Solo con ese rol se ven MANAGER y RUN MUMU PLAYER. Sin permisos propios.
async function rolMonitor(guild) {
    const existente = guild.roles.cache.find(r => r.name === 'Monitor');
    if (existente) return existente;
    return await guild.roles.create({ name: 'Monitor', permissions: [], mentionable: false, reason: 'Monitor Pokemon: members who linked their PC' })
        .catch(e => { console.error('DEBUG: no se pudo crear el rol Monitor:', e?.message || e); return null; });
}

// Permisos de las categorias de la comunidad (los canales los heredan). Los miembros solo pueden ver,
// leer y usar los comandos del bot: no escriben, no reaccionan, no crean hilos ni suben archivos, y
// gestionar canales/mensajes nunca se les da (nadie puede borrar ni editar nada del bot).
//   'todos'   -> @everyone (bienvenida)       'monitor' -> rol Monitor + Staff
async function permisosCategoria(guild, acceso) {
    const F = PermissionsBitField.Flags;
    const usar = [F.ViewChannel, F.ReadMessageHistory, F.UseApplicationCommands, F.UseExternalEmojis];
    const nada = [F.SendMessages, F.SendMessagesInThreads, F.CreatePublicThreads, F.CreatePrivateThreads, F.AddReactions,
        F.AttachFiles, F.EmbedLinks, F.MentionEveryone, F.ManageMessages, F.ManageThreads, F.ManageChannels, F.ManageWebhooks];
    const salida = [{ id: guild.members.me.id, allow: [F.Administrator, F.ViewChannel] }];
    if (acceso === 'todos') {
        salida.push({ id: guild.roles.everyone.id, allow: usar, deny: nada });
    } else {
        salida.push({ id: guild.roles.everyone.id, allow: [F.UseExternalEmojis], deny: [F.ViewChannel, ...nada] });
        const monitor = await rolMonitor(guild);
        if (monitor) salida.push({ id: monitor.id, type: OverwriteType.Role, allow: usar, deny: nada });
    }
    const staff = await rolStaff(guild);
    if (staff) salida.push({ id: staff.id, type: OverwriteType.Role, allow: usar });
    for (const id of lista('COMMUNITY_STAFF_IDS')) salida.push({ id, type: OverwriteType.Member, allow: usar });
    return salida;
}

// Permisos de una categoria publica en comunidad: el bot con Administrador, y @everyone con
// "Use External Emojis" -- los mensajes de webhook usan los emojis del server propio del bot, y
// Discord solo los dibuja si @everyone tiene ese permiso en el canal.
function permisosPublicos(guild) {
    return [
        { id: guild.roles.everyone.id, allow: [PermissionsBitField.Flags.UseExternalEmojis] },
        { id: guild.members.me.id, allow: [PermissionsBitField.Flags.Administrator] }
    ];
}

// Guardia al principio de interactionCreate. Devuelve true si la interaccion se corto aca.
async function bloquearSiHaceFalta(interaction) {
    if (!esComunidad(interaction.guildId) || esStaff(interaction.user?.id, interaction.member)) return false;
    if (interaction.isChatInputCommand?.() && ABIERTOS_A_TODOS.has(interaction.commandName)) return false;
    // Botones y ventana de /link (vincular y elegir carpeta): para cualquier miembro.
    if ((interaction.isButton?.() || interaction.isModalSubmit?.()) && ['link_nueva_clave', 'link_poner_carpeta', 'link_modal_carpeta', 'link_mi_carpeta', 'link_todas_rutas'].includes(interaction.customId)) return false;
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

// ============ Registro de miembros del bot de wr98 (Upstash Redis, solo lectura) ============
// Cada miembro se registra en el panel de wr98 con su Main (main_id) y opcionalmente una
// secundaria (sec_id). Se guarda en hashes users:<grupo> con el ID de Discord como campo:
//   users:Elite_Four  { "111...": {"name":"wR98","main_id":"8727...","sec_id":"6672..."} }
// En comunidad, ⚡ Share/Trade manda SIEMPRE a la Main/secundaria registrada de quien lo pide --
// nunca se muestra la lista de amigos guardados de la PC host ni la de otros miembros.
// .env: WR98_REDIS_URL / WR98_REDIS_TOKEN (wr98 los rota cada ~15 dias).
// Pocas operaciones a proposito: el Upstash gratis de wr98 tiene 500k comandos/mes y su propio bot
// ya lo agota en ~15 dias. Se lee cada grupo ENTERO (1 HGETALL) y se guarda 30 min; la lista de grupos,
// 6 h. Si la lectura falla (clave rotada) se sigue usando lo ultimo leido.
const TTL_MIEMBROS_MS = 30 * 60 * 1000;
const TTL_GRUPOS_MS = 6 * 60 * 60 * 1000;
let gruposCache = { ts: 0, lista: [] };

async function redis(...args) {
    const url = process.env.WR98_REDIS_URL, token = process.env.WR98_REDIS_TOKEN;
    if (!url || !token) throw new Error('wr98 registry is not configured');
    const r = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify(args) });
    if (r.status === 401 || r.status === 403) throw new Error('wr98 registry key expired or invalid');
    const j = await r.json();
    if (j.error) throw new Error(j.error);
    return j.result;
}

async function gruposRegistro() {
    if (Date.now() - gruposCache.ts < TTL_GRUPOS_MS && gruposCache.lista.length) return gruposCache.lista;
    try {
        const lista = [];
        let cursor = '0';
        do {
            const [siguiente, claves] = await redis('SCAN', cursor, 'MATCH', 'users:*', 'COUNT', '200');
            lista.push(...claves);
            cursor = siguiente;
        } while (cursor !== '0');
        gruposCache = { ts: Date.now(), lista };
    } catch (e) {
        if (!gruposCache.lista.length) throw e;
    }
    return gruposCache.lista;
}

// { name, main_id, sec_id, grupo } del miembro, o null si no esta registrado. Sale de la lista de
// cada grupo ya en memoria (sin consultas por persona).
async function registroDe(userId) {
    for (const clave of await gruposRegistro()) {
        const grupo = clave.replace(/^users:/, '');
        const m = (await miembrosDeGrupo(grupo)).find(x => x.discordId === String(userId));
        if (m) return { name: m.name, main_id: m.main_id, sec_id: m.sec_id, grupo };
    }
    return null;
}

// Opciones de destino para ⚡ Share/Trade: solo las cuentas registradas de ESE miembro.
async function destinosDe(userId) {
    const r = await registroDe(userId);
    if (!r) return [];
    const salida = [];
    if (r.main_id) salida.push({ id: r.main_id, label: `${r.name} — Main` });
    if (r.sec_id && r.sec_id !== r.main_id) salida.push({ id: r.sec_id, label: `${r.name} — Secondary` });
    return salida;
}

// ---- Lista de miembros (para 🎁 regalar tickets en Farm Tickets, pedido de Ale) ----
// Solo nombre + Main de cada miembro registrado; se lee del mismo registro de wr98.
const cacheMiembros = new Map();   // grupo -> { ts, lista }

async function miembrosDeGrupo(grupo) {
    const c = cacheMiembros.get(grupo);
    if (c && Date.now() - c.ts < TTL_MIEMBROS_MS) return c.lista;
    let plano;
    try {
        plano = await redis('HGETALL', `users:${grupo}`);   // [campo, valor, campo, valor, ...]
    } catch (e) {
        if (c) return c.lista;   // clave rotada o sin conexion: lo ultimo leido
        throw e;
    }
    const lista = [];
    for (let i = 0; i + 1 < (plano || []).length; i += 2) {
        try {
            const d = typeof plano[i + 1] === 'string' ? JSON.parse(plano[i + 1]) : plano[i + 1];
            const main = String(d.main_id || '').replace(/\D/g, '');
            const sec = String(d.sec_id || '').replace(/\D/g, '');
            if (main) lista.push({ discordId: String(plano[i]), name: d.name || 'Unknown', main_id: main, sec_id: sec });
        } catch (e) { /* registro ilegible */ }
    }
    lista.sort((a, b) => a.name.localeCompare(b.name));
    cacheMiembros.set(grupo, { ts: Date.now(), lista });
    return lista;
}

async function gruposConConteo() {
    const salida = [];
    for (const clave of await gruposRegistro()) {
        const grupo = clave.replace(/^users:/, '');
        salida.push({ grupo, total: (await miembrosDeGrupo(grupo)).length });
    }
    return salida;
}

// Nombre registrado de una Main (o secundaria) cualquiera, para mostrar a quien se le regalo.
async function nombreDeFriendId(friendId) {
    const id = String(friendId || '').replace(/\D/g, '');
    for (const clave of await gruposRegistro()) {
        const m = (await miembrosDeGrupo(clave.replace(/^users:/, ''))).find(x => x.main_id === id);
        if (m) return m.name;
    }
    return null;
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

module.exports = { rolMonitor, permisosCategoria, CANALES_FUERA_DE_COMUNIDAD, soloComunidad, hayComunidad, esComunidad, esStaff, comandosPara, gruposSync, permisosPrivados, permisosPublicos, bloquearSiHaceFalta, quitarComponentes, registroDe, destinosDe, miembrosDeGrupo, gruposConConteo, nombreDeFriendId, contexto, usuarioActual };
