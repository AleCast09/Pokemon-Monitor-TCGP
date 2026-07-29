const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { execSync } = require('child_process');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db = require('./database.js');

const VERSION_PATH = path.join(__dirname, 'version.json');
const PENDING_UPDATE_PATH = path.join(__dirname, '.pending_update.json');
const ASSETS_ZIP_TEMP_PATH = path.join(__dirname, 'assets-actualizacion.zip');
const VERSION_URL_REMOTA = 'https://raw.githubusercontent.com/AleCast09/Pokemon-Monitor-TCGP/main/version.json';
// Respaldo por si raw.githubusercontent.com esta bloqueado por el ISP del
// usuario (reporte real 2026-07-30: varios usuarios, no solo uno, con
// "Check for Updates" fallando siempre por Discord y solo funcionando bajando
// el .exe a mano -- raw.githubusercontent.com tiene historial de bloqueos
// regionales de algunos proveedores en Latinoamerica). Mismo contenido,
// dominio distinto -- si uno esta bloqueado el otro probablemente no.
const VERSION_URL_RESPALDO = 'https://api.github.com/repos/AleCast09/Pokemon-Monitor-TCGP/contents/version.json';

function obtenerVersionLocal() {
    return JSON.parse(fs.readFileSync(VERSION_PATH, 'utf8'));
}

async function obtenerVersionRemota() {
    try {
        const resp = await axios.get(VERSION_URL_REMOTA, { timeout: 8000, headers: { 'Cache-Control': 'no-cache' } });
        return resp.data;
    } catch (e) {
        const resp = await axios.get(VERSION_URL_RESPALDO, {
            timeout: 8000,
            headers: { 'Cache-Control': 'no-cache', 'Accept': 'application/vnd.github.raw+json', 'User-Agent': 'MonitorPokemon' }
        });
        return typeof resp.data === 'string' ? JSON.parse(resp.data) : resp.data;
    }
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
        .setTitle('🔔 An update is available')
        .setColor(0xF0A93A)
        .setDescription(
            `**${local.version}** → **${remota.version}**\n\n` +
            `**What's new:**\n` +
            (remota.notes || []).map(n => `• ${n}`).join('\n')
        );
    const fila = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('actualizacion_ahora').setLabel('Update now').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('actualizacion_luego').setLabel('Later').setStyle(ButtonStyle.Secondary)
    );
    return { embeds: [embed.toJSON()], components: [fila.toJSON()] };
}

async function obtenerDestinoNotificacion(client) {
    // Se busca el ID del dueño SIEMPRE (no solo cuando no hay webhook) -- a
    // pedido explicito del usuario 2026-07-30: un embed sin mencion en el
    // canal de Updates pasa desapercibido facil (nadie vuelve a mirar el bot
    // una vez que ya lo dejo corriendo). Con el ID, el aviso por webhook
    // tambien puede hacerle "@mencion" directa, no solo quedar ahi mudo.
    let ownerId = null;
    try {
        const app = await client.application.fetch();
        ownerId = app.owner?.id || app.owner?.ownerId || null;
    } catch (e) { /* sin dueño detectable */ }

    const filaWebhook = await db.get(
        `SELECT webhook_url FROM configs_canales WHERE tipo = 'actualizaciones' AND webhook_url LIKE 'https://discord.com/api/webhooks/%' ORDER BY rowid DESC LIMIT 1`
    );
    if (filaWebhook?.webhook_url) return { tipo: 'webhook', webhookUrl: filaWebhook.webhook_url, ownerId };

    if (ownerId) return { tipo: 'dm', userId: ownerId };
    return null;
}

async function chequearActualizaciones(client) {
    try {
        const local = obtenerVersionLocal();
        const remota = await obtenerVersionRemota();
        if (!esVersionMasNueva(remota.version, local.version)) return;

        // Este chequeo ahora se repite cada varias horas (para que alguien que
        // deja el bot prendido sin reiniciar igual se entere) — sin esto,
        // volvería a mandar el mismo aviso de la misma versión en cada
        // repetición mientras el usuario no actualice, en vez de avisar una
        // sola vez por versión nueva.
        const filaAvisado = await db.get(`SELECT status FROM estados_modulos WHERE nombre = 'version_avisada'`);
        if (filaAvisado?.status === remota.version) return;

        const destino = await obtenerDestinoNotificacion(client);
        if (!destino) return;

        await db.run(`INSERT INTO estados_modulos (nombre, status) VALUES ('version_avisada', ?) ON CONFLICT(nombre) DO UPDATE SET status = excluded.status`, [remota.version]);

        const payload = construirPayloadActualizacion(local, remota);

        if (destino.tipo === 'webhook') {
            // @mencion directa al dueño del bot (a pedido explicito del usuario
            // 2026-07-30): un embed mudo en el canal de Updates se ignora facil
            // una vez que el bot ya esta corriendo y nadie vuelve a mirarlo.
            const contenido = destino.ownerId ? `<@${destino.ownerId}>` : undefined;
            await axios.post(`${destino.webhookUrl}?wait=true`, { ...payload, content: contenido }, { timeout: 15000 });
        } else {
            const usuario = await client.users.fetch(destino.userId);
            await usuario.send(payload);
        }
    } catch (e) {
        console.error('DEBUG: error chequeando actualizaciones:', e?.message || e);
    }
}

// Aviso de "recien actualizado" -- a pedido explicito del usuario 2026-07-27:
// que al aplicar una actualizacion, el bot avise que cosas nuevas trae y que
// pasos manuales hacen falta (ej. correr Sync Channels para un canal nuevo).
// Corre UNA vez por version, apenas el bot arranca ya en la version nueva (no
// depende de que nadie apriete "Update now" -- tambien cubre actualizar el
// .exe a mano, como hizo katrick). En la primerisima corrida de siempre (sin
// fila guardada todavia, instalacion nueva) no avisa nada -- no hubo ninguna
// "actualizacion" real que contar, solo se guarda la version actual como
// punto de partida.
async function avisarActualizacionAplicadaSiHaceFalta(client) {
    try {
        const local = obtenerVersionLocal();
        const fila = await db.get(`SELECT status FROM estados_modulos WHERE nombre = 'version_aplicada_avisada'`);

        if (!fila) {
            await db.run(`INSERT INTO estados_modulos (nombre, status) VALUES ('version_aplicada_avisada', ?) ON CONFLICT(nombre) DO UPDATE SET status = excluded.status`, [local.version]);
            return;
        }
        if (fila.status === local.version) return;

        await db.run(`INSERT INTO estados_modulos (nombre, status) VALUES ('version_aplicada_avisada', ?) ON CONFLICT(nombre) DO UPDATE SET status = excluded.status`, [local.version]);

        const destino = await obtenerDestinoNotificacion(client);
        if (!destino) return;

        const notas = (local.notes || []).map(n => `• ${n}`).join('\n');
        const acciones = (local.actionsNeeded || []).map(a => `• ${a}`).join('\n');
        const embed = {
            title: `🎉 Updated to v${local.version}`,
            color: 0x2ECC71,
            description: `**What's new:**\n${notas || '_No notes for this version._'}`
                + (acciones ? `\n\n**What you might need to do:**\n${acciones}` : '')
        };

        if (destino.tipo === 'webhook') {
            await axios.post(`${destino.webhookUrl}?wait=true`, { embeds: [embed] }, { timeout: 15000 });
        } else {
            const usuario = await client.users.fetch(destino.userId);
            await usuario.send({ embeds: [embed] });
        }
    } catch (e) {
        console.error('DEBUG: error avisando actualizacion aplicada:', e?.message || e);
    }
}

// A diferencia del .exe (bloqueado por Windows mientras el proceso corre y
// por eso necesita el paso de _actualizar.bat en launcher.js), la carpeta
// assets/ no está en uso exclusivo — se puede sobrescribir en caliente, sin
// esperar a que el programa se reinicie. Si falla (sin assetsUrl en una
// versión vieja, sin internet, etc.) se ignora en silencio: el .exe se sigue
// actualizando igual, y assets/ se queda como estaba.
async function descargarYExtraerAssets(remota) {
    if (!remota.assetsUrl) return;
    try {
        const respuesta = await axios.get(remota.assetsUrl, { responseType: 'stream', timeout: 120000 });
        await new Promise((resolve, reject) => {
            const archivo = fs.createWriteStream(ASSETS_ZIP_TEMP_PATH);
            respuesta.data.pipe(archivo);
            archivo.on('finish', resolve);
            archivo.on('error', reject);
            respuesta.data.on('error', reject);
        });

        // Defensa en profundidad contra zip-slip: si el pipeline de releases se
        // viera comprometido alguna vez, un zip malicioso podría intentar
        // escribir fuera de la carpeta (ej. "../../../algo") — se valida que
        // ningún nombre de entrada intente escapar antes de descomprimir nada.
        const scriptValidar = [
            `Add-Type -AssemblyName System.IO.Compression.FileSystem`,
            `$zip = [System.IO.Compression.ZipFile]::OpenRead('${ASSETS_ZIP_TEMP_PATH}')`,
            `$malos = $zip.Entries | Where-Object { $_.FullName -match '\\.\\.' -or $_.FullName -match '^[/\\\\]' -or $_.FullName -match '^[A-Za-z]:' }`,
            `$zip.Dispose()`,
            `if ($malos) { 'UNSAFE' } else { 'SAFE' }`
        ].join('; ');
        const resultadoValidacion = execSync(`powershell -NoProfile -Command "${scriptValidar}"`, { encoding: 'utf8' }).trim();
        if (resultadoValidacion !== 'SAFE') {
            console.error('DEBUG: assets.zip contiene rutas sospechosas, se aborta la extracción por seguridad.');
            return;
        }

        // Expand-Archive sobrescribe los archivos que ya existen y agrega los
        // nuevos, pero no borra los que ya no vienen en el zip — alcanza para
        // el caso de uso real (sumar assets nuevos), no hace falta más.
        const script = `Expand-Archive -Path '${ASSETS_ZIP_TEMP_PATH}' -DestinationPath '${__dirname}' -Force`;
        execSync(`powershell -NoProfile -Command "${script}"`, { stdio: 'ignore' });
    } catch (e) {
        console.error('DEBUG: error actualizando assets/:', e?.message || e);
    } finally {
        try { fs.unlinkSync(ASSETS_ZIP_TEMP_PATH); } catch (e) { /* nada que limpiar */ }
    }
}

// El panel (MonitorPokemonPanel.exe) no es hijo de launcher.js y no se puede
// reemplazar a si mismo mientras corre — a diferencia del bot, cuyo swap ya
// resuelve launcher.js con MonitorPokemonBot.new.exe. Se baja igual acá (si la
// versión remota lo ofrece — versiones viejas de version.json no tienen este
// campo, se ignora en silencio) y queda en disco como
// "MonitorPokemonPanel.new.exe"; el propio panel (ControlPanel.cs,
// EjecutarSwapPanelSiExiste) es quien detecta ese archivo y hace el
// reemplazo real, tanto al arrancar como justo después de bajarlo.
async function descargarActualizacionPanel(remota) {
    if (!remota.panelDownloadUrl) return;
    try {
        const rutaNueva = path.join(__dirname, 'MonitorPokemonPanel.new.exe');
        const respuesta = await axios.get(remota.panelDownloadUrl, { responseType: 'stream', timeout: 60000 });
        await new Promise((resolve, reject) => {
            const archivo = fs.createWriteStream(rutaNueva);
            respuesta.data.pipe(archivo);
            archivo.on('finish', resolve);
            archivo.on('error', reject);
            respuesta.data.on('error', reject);
        });
    } catch (e) {
        console.error('DEBUG: error descargando la actualización del panel:', e?.message || e);
    }
}

async function descargarActualizacion(remota) {
    const rutaNueva = path.join(__dirname, 'MonitorPokemonBot.new.exe');
    const respuesta = await axios.get(remota.downloadUrl, { responseType: 'stream', timeout: 120000 });

    await new Promise((resolve, reject) => {
        const archivo = fs.createWriteStream(rutaNueva);
        respuesta.data.pipe(archivo);
        archivo.on('finish', resolve);
        archivo.on('error', reject);
        respuesta.data.on('error', reject);
    });

    await descargarActualizacionPanel(remota);
    await descargarYExtraerAssets(remota);

    // Sin esto, version.json local nunca cambia y el bot cree para siempre que
    // sigue en la versión vieja, avisando de la "misma" actualización sin parar
    // aunque el .exe ya se haya reemplazado correctamente.
    fs.writeFileSync(VERSION_PATH, JSON.stringify(remota, null, 2));

    fs.writeFileSync(PENDING_UPDATE_PATH, JSON.stringify({ version: remota.version, listoEn: Date.now() }));
}

module.exports = {
    chequearActualizaciones,
    avisarActualizacionAplicadaSiHaceFalta,
    descargarActualizacion,
    obtenerVersionLocal,
    obtenerVersionRemota,
    esVersionMasNueva,
    PENDING_UPDATE_PATH
};
