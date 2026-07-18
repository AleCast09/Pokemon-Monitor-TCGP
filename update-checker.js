const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db = require('./database.js');

const VERSION_PATH = path.join(__dirname, 'version.json');
const PENDING_UPDATE_PATH = path.join(__dirname, '.pending_update.json');
const VERSION_URL_REMOTA = 'https://raw.githubusercontent.com/AleCast09/Pokemon-Monitor-TCGP/main/version.json';

function obtenerVersionLocal() {
    return JSON.parse(fs.readFileSync(VERSION_PATH, 'utf8'));
}

async function obtenerVersionRemota() {
    const resp = await axios.get(VERSION_URL_REMOTA, { timeout: 8000, headers: { 'Cache-Control': 'no-cache' } });
    return resp.data;
}

function esVersionMasNueva(remota, local) {
    const a = String(remota).split('.').map(Number);
    const b = String(local).split('.').map(Number);
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
        const x = a[i] || 0, y = b[i] || 0;
        if (x > y) return true;
        if (x < y) return false;
    }
    return false;
}

function construirPayloadActualizacion(local, remota) {
    const embed = new EmbedBuilder()
        .setTitle('🔔 Hay una actualización disponible')
        .setColor(0xF0A93A)
        .setDescription(
            `**${local.version}** → **${remota.version}**\n\n` +
            `**Qué hay de nuevo:**\n` +
            (remota.notes || []).map(n => `• ${n}`).join('\n')
        );
    const fila = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('actualizacion_ahora').setLabel('Actualizar ahora').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('actualizacion_luego').setLabel('Más tarde').setStyle(ButtonStyle.Secondary)
    );
    return { embeds: [embed.toJSON()], components: [fila.toJSON()] };
}

async function obtenerDestinoNotificacion(client) {
    const filaWebhook = await db.get(
        `SELECT webhook_url FROM configs_canales WHERE tipo = 'actualizaciones' AND webhook_url LIKE 'https://discord.com/api/webhooks/%' ORDER BY rowid DESC LIMIT 1`
    );
    if (filaWebhook?.webhook_url) return { tipo: 'webhook', webhookUrl: filaWebhook.webhook_url };

    try {
        const app = await client.application.fetch();
        const ownerId = app.owner?.id || app.owner?.ownerId;
        if (ownerId) return { tipo: 'dm', userId: ownerId };
    } catch (e) { /* sin dueño detectable, se omite el aviso */ }
    return null;
}

async function chequearActualizaciones(client) {
    try {
        const local = obtenerVersionLocal();
        const remota = await obtenerVersionRemota();
        if (!esVersionMasNueva(remota.version, local.version)) return;

        const destino = await obtenerDestinoNotificacion(client);
        if (!destino) return;

        const payload = construirPayloadActualizacion(local, remota);

        if (destino.tipo === 'webhook') {
            await axios.post(`${destino.webhookUrl}?wait=true`, payload, { timeout: 15000 });
        } else {
            const usuario = await client.users.fetch(destino.userId);
            await usuario.send(payload);
        }
    } catch (e) {
        console.error('DEBUG: error chequeando actualizaciones:', e?.message || e);
    }
}

async function descargarActualizacion(remota) {
    const rutaNueva = path.join(__dirname, 'MonitorPokemon.new.exe');
    const respuesta = await axios.get(remota.downloadUrl, { responseType: 'stream', timeout: 120000 });

    await new Promise((resolve, reject) => {
        const archivo = fs.createWriteStream(rutaNueva);
        respuesta.data.pipe(archivo);
        archivo.on('finish', resolve);
        archivo.on('error', reject);
        respuesta.data.on('error', reject);
    });

    fs.writeFileSync(PENDING_UPDATE_PATH, JSON.stringify({ version: remota.version, listoEn: Date.now() }));
}

module.exports = {
    chequearActualizaciones,
    descargarActualizacion,
    obtenerVersionLocal,
    obtenerVersionRemota,
    esVersionMasNueva,
    PENDING_UPDATE_PATH
};
