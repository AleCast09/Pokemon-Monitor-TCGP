require('dotenv').config();
const { exec } = require('child_process');
const db = require('./database.js');
const express = require('express');
const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');
const RUTA_HEARTBEAT_THUMBNAIL = path.join(__dirname, 'assets', 'heartbeat.png');

async function enviarConThumbnail(url, metodo, payload) {
    if (!fs.existsSync(RUTA_HEARTBEAT_THUMBNAIL)) {
        return metodo === 'patch' ? axios.patch(url, payload) : axios.post(url, payload);
    }
    const form = new FormData();
    form.append('payload_json', JSON.stringify(payload));
    form.append('files[0]', fs.createReadStream(RUTA_HEARTBEAT_THUMBNAIL), { filename: 'heartbeat.png' });
    const config = { headers: form.getHeaders() };
    return metodo === 'patch' ? axios.patch(url, form, config) : axios.post(url, form, config);
}
const DISCORD_TOKEN = process.env.DISCORD_BOT_TOKEN;
const DISCORD_USER_ID = process.env.DISCORD_USER_ID || null;
const RUTA_HEARTBEAT_MSG_CACHE = path.join(__dirname, 'heartbeat_message_ids.json');
const INGEST_AUTH_TOKEN = process.env.INGEST_AUTH_TOKEN || '';
const REQUIRE_INGEST_AUTH = /^true$/i.test(process.env.REQUIRE_INGEST_AUTH || (process.env.NODE_ENV === 'production' ? 'true' : 'false'));

function validarIngestToken(req) {
    if (!REQUIRE_INGEST_AUTH) return true;
    if (!INGEST_AUTH_TOKEN) return false;
    const headerToken = req.headers['x-ingest-token'] || req.headers['x-bot-token'];
    return headerToken === INGEST_AUTH_TOKEN;
}

function rutaSegura(ruta) {
    if (!ruta) return 'none';
    return path.basename(String(ruta)) || 'none';
}

// Para credenciales (webhooks, tokens) — a diferencia de rutaSegura(), que usa
// path.basename() y expondría el token entero si se le pasa una URL de webhook
// por error (el token queda justo al final del path).
function redactarValor(valor, visibles = 4) {
    if (!valor) return 'none';
    const texto = String(valor);
    if (texto.length <= visibles) return '*'.repeat(texto.length);
    return `${texto.slice(0, visibles)}...${texto.slice(-2)}`;
}

// =====================================================================
// 💾 PERSISTENCIA DE DATOS
// =====================================================================
const RUTA_CACHE = path.join(__dirname, 'stats_cache.json');
let statsCache = {};

if (fs.existsSync(RUTA_CACHE)) {
    try {
        statsCache = JSON.parse(fs.readFileSync(RUTA_CACHE, 'utf8'));
    } catch (e) { console.log("Error cargando cache, iniciando vacío."); }
}

function guardarCache() {
    fs.writeFileSync(RUTA_CACHE, JSON.stringify(statsCache, null, 2));
}

function cargarHeartbeatMsgCache() {
    try {
        if (!fs.existsSync(RUTA_HEARTBEAT_MSG_CACHE)) return {};
        return JSON.parse(fs.readFileSync(RUTA_HEARTBEAT_MSG_CACHE, 'utf8')) || {};
    } catch (e) {
        return {};
    }
}

function guardarHeartbeatMsgCache(cache) {
    fs.writeFileSync(RUTA_HEARTBEAT_MSG_CACHE, JSON.stringify(cache, null, 2));
}

async function crearWebhookSiEsNecesario(row, tipo) {
    if (!DISCORD_TOKEN || !row?.canal_id) return null;
    try {
        const response = await axios.post(
            `https://discord.com/api/v10/channels/${row.canal_id}/webhooks`,
            { name: `Bot ${tipo}`, avatar: 'https://i.imgur.com/gK1q9yS.png' },
            { headers: { Authorization: `Bot ${DISCORD_TOKEN}`, 'Content-Type': 'application/json' } }
        );
        if (response.data?.url) {
            await db.run(`UPDATE configs_canales SET webhook_url = ? WHERE tipo = ? AND canal_id = ?`, [response.data.url, tipo, row.canal_id]);
            return response.data.url;
        }
    } catch (error) {
        console.error('DEBUG: no se pudo recrear webhook heartbeat:', error?.response?.data || error?.message || error);
    }
    return null;
}

// =====================================================================
// 🖥️ MODO SERVIDOR EXPRESS
// =====================================================================
if (require.main === module || process.env.MONITOR_ROLE === 'heartbeat') {
    const app = express();
    app.use(express.text({ type: '*/*', limit: '1mb' }));
    app.use(express.json({ limit: '1mb' }));
    app.use(express.urlencoded({ extended: true, limit: '1mb' }));

    // Configurable solo para poder correr una segunda copia de prueba en la
    // misma PC sin chocar de puerto con la real — en uso normal nunca hace
    // falta tocar esto, cada usuario ya tiene su propio "localhost".
    const PORT = Number(process.env.HEARTBEAT_PORT) || 3003;
    const TIEMPO_MAXIMO_INACTIVO_MS = 5 * 60 * 1000; 

    function obtenerBalanceDesdeArchivo(rutaBalance) {
        try {
            if (fs.existsSync(rutaBalance)) {
                const contenido = fs.readFileSync(rutaBalance, 'utf8').trim();
                const match = contenido.match(/(\d+)/);
                return match ? parseInt(match[1], 10) : 0;
            }
        } catch (e) { console.log("Error balance:", e); }
        return 0;
    }

    function contarXMLs(directorio) {
        let resultado = { totales: 0 };
        try {
            if (!fs.existsSync(directorio)) return resultado;
            const elementos = fs.readdirSync(directorio, { withFileTypes: true });
            for (const elemento of elementos) {
                const rutaCompleta = path.join(directorio, elemento.name);
                if (elemento.isDirectory()) {
                    resultado.totales += contarXMLs(rutaCompleta).totales;
                } else if (elemento.isFile() && elemento.name.toLowerCase().endsWith('.xml')) {
                    resultado.totales++; 
                }
            }
        } catch (error) { return { totales: 0 }; }
        return resultado;
    }

    app.post('/', async (req, res) => {
        if (!validarIngestToken(req)) {
            return res.status(401).send('UNAUTHORIZED');
        }

        const estado = await db.get(`SELECT status FROM estados_modulos WHERE nombre = 'heartbeat'`);
        if (estado && estado.status !== 'online') {
            return res.status(200).send('OFFLINE');
        }

        try {
            let hbConfig = null;
            if (DISCORD_USER_ID) {
                hbConfig = await db.get(`SELECT canal_id, webhook_url FROM configs_canales WHERE tipo = 'heartbeat' AND discord_id = ? ORDER BY rowid DESC LIMIT 1`, [DISCORD_USER_ID]);
            }
            if (!hbConfig || !hbConfig.canal_id || !hbConfig.webhook_url || hbConfig.webhook_url === 'N/A' || hbConfig.webhook_url === 'local') {
                hbConfig = await db.get(`SELECT canal_id, webhook_url FROM configs_canales WHERE tipo = 'heartbeat' AND webhook_url NOT IN ('N/A', 'local') ORDER BY rowid DESC LIMIT 1`);
            }
            if (!hbConfig || !hbConfig.canal_id) {
                hbConfig = await db.get(`SELECT canal_id, webhook_url FROM configs_canales WHERE tipo = 'heartbeat' ORDER BY rowid DESC LIMIT 1`);
            }

            let rutaConfig = null;
            if (DISCORD_USER_ID) {
                rutaConfig = await db.get(`SELECT webhook_url FROM configs_canales WHERE tipo = 'ruta_local' AND discord_id = ? AND webhook_url NOT IN ('N/A', 'local') ORDER BY rowid DESC LIMIT 1`, [DISCORD_USER_ID]);
            }
            if (!rutaConfig || !rutaConfig.webhook_url) {
                rutaConfig = await db.get(`SELECT webhook_url FROM configs_canales WHERE tipo = 'ruta_local' AND webhook_url NOT IN ('N/A', 'local') ORDER BY rowid DESC LIMIT 1`);
            }

            if (!hbConfig || !hbConfig.canal_id) return res.status(400).send("Falta configuración de canal heartbeat en la BD");
            console.log(`[HB-DEBUG] Config seleccionada canal=${hbConfig.canal_id} webhook=${redactarValor(hbConfig.webhook_url)}`);

            // If webhook_url is missing or marked N/A/local, try to recreate it
            if (!hbConfig.webhook_url || hbConfig.webhook_url === 'N/A' || hbConfig.webhook_url === 'local') {
                const newUrl = await crearWebhookSiEsNecesario(hbConfig, 'heartbeat');
                if (newUrl) {
                    hbConfig.webhook_url = newUrl;
                }
            }

            if (!hbConfig.webhook_url || !rutaConfig || !rutaConfig.webhook_url) {
                return res.status(400).send("Falta configuración en la BD");
            }

            // DEBUG: Log the received body to see what data is arriving
            let bodyStr = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
            const allKeys = Object.keys(req.body || {});
            console.log(`[HB-DEBUG] Body length: ${bodyStr.length}, total keys: ${allKeys.length}, keys=${allKeys.join(', ')}`);
            console.log(`[HB-DEBUG] RAW body (first 800 chars): ${bodyStr.substring(0, 800)}`);
            console.log(`[HB-DEBUG] Config seleccionada canal=${hbConfig.canal_id} webhook=${redactarValor(hbConfig.webhook_url)}`);

            let DISCORD_WEBHOOK = hbConfig.webhook_url;
            const RUTA_BALANCE_RESULT = rutaConfig.webhook_url; 
            const RUTA_CARPETA_XML = path.dirname(RUTA_BALANCE_RESULT); 
            const RUTA_ID_TXT_LEGACY = path.join(__dirname, 'mensaje_id.txt'); 

            let nombreCarpeta = "Local Host";
            const partesRuta = RUTA_BALANCE_RESULT.split(/[\/\\]/);
            if (partesRuta.length > 2) {
                nombreCarpeta = partesRuta[partesRuta.length - 3]; 
            }

            let bodyText = req.body || "";
            let cleanText = bodyText;
            if (typeof bodyText === 'string') {
                const jsonMatch = bodyText.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    try {
                        let jsonObj = JSON.parse(jsonMatch[0]);
                        cleanText = jsonObj.content || (jsonObj.embeds && jsonObj.embeds[0] && jsonObj.embeds[0].description) || jsonMatch[0];
                    } catch (e) {}
                }
            } else if (typeof bodyText === 'object') {
                cleanText = bodyText.content || (bodyText.embeds && bodyText.embeds[0] && bodyText.embeds[0].description) || JSON.stringify(bodyText);
            }
            
            cleanText = String(cleanText).replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/[\\{\\"}]/g, '').trim();

            let headerText = cleanText;
            let instancesText = "";
            let splitMarker = cleanText.match(/\[Instance status[^\]]*\]/i);
            if (splitMarker) {
                headerText = cleanText.substring(0, splitMarker.index).trim();
                instancesText = cleanText.substring(splitMarker.index);
            }

            let versionBot = headerText.match(/\[(kevnITG-v[0-9.]+)\]/i)?.[1] || "kevnITG-v9.6.4";
            let modVersion = headerText.match(/Mod Version:\s*([^\n]+)/i)?.[1]?.trim() || "Leanny-v0.10.0";
            let botType = headerText.match(/Type:\s*([^\n]+)/i)?.[1]?.trim() || "Inject 13P+";
            
            let openingType = "Automatic Detection";
            let openingMatch = headerText.match(/Opening:\s*([^\n]+)/i);
            if (openingMatch) {
                openingType = openingMatch[1].trim();
            } else {
                let backupMatch = headerText.match(/(Pulsing Aura|Space-Time Smackdown|Genetic Apex|Mythical Discovery|Island Guardians)/i);
                if (backupMatch) openingType = backupMatch[1].trim();
            }
            
            const globalTimeMinutosRaw = headerText.match(/^Time:\s*(\d+)\s*m/im)?.[1];
            let globalTime;
            if (globalTimeMinutosRaw) {
                const totalMin = parseInt(globalTimeMinutosRaw, 10);
                const horas = Math.floor(totalMin / 60);
                const minutos = totalMin % 60;
                globalTime = horas > 0 ? `${horas}h ${minutos}min` : `${minutos}min`;
            } else {
                globalTime = "190min";
            }

            let offlineMatch = headerText.match(/Offline:\s*([^\n]+)/i);
            let offlineInstancesStr = offlineMatch ? offlineMatch[1].trim() : "";

            let tabla = "";
            let totalPacksGlobal = 0;
            let ppmCombinadoReal = 0; 
            let currentTime = Date.now();

            let onlineInstancesList = [];
            let offlineInstancesList = [];

            if (instancesText.length > 0) {
                let lineas = instancesText.split('\n');
                console.log(`[HB-DEBUG] Found ${lineas.length} lines in instancesText`);
                let counter = 1;
                
                for (let linea of lineas) {
                    let ppmMatch = linea.match(/Avg:\s*([0-9.]+)/i);
                    let packsMatch = linea.match(/Packs:\s*([0-9]+)/i);

                    if (ppmMatch && packsMatch) {
                        console.log(`[HB-DEBUG] Instance ${counter}: PPM=${ppmMatch[1]}, Packs=${packsMatch[1]}`);
                        let ppm = ppmMatch[1];
                        let packs = packsMatch[1];
                        let instId = counter.toString();
                        
                        totalPacksGlobal += parseInt(packs, 10);
                        
                        let contieneActividadExtra = linea.toLowerCase().includes("friend") || 
                                                     linea.toLowerCase().includes("inject") || 
                                                     linea.toLowerCase().includes("eligible");

                        let esOffline = linea.toLowerCase().includes("offline") || offlineInstancesStr.includes(instId);

                        if (!statsCache[instId]) {
                            statsCache[instId] = { packs: packs, lastUpdate: currentTime };
                        } else if (statsCache[instId].packs !== packs) {
                            statsCache[instId].packs = packs;
                            statsCache[instId].lastUpdate = currentTime; 
                        } else if (contieneActividadExtra) {
                            statsCache[instId].lastUpdate = currentTime;
                        }
                        
                        guardarCache(); // Guardado persistente

                        let estaCongelado = (currentTime - statsCache[instId].lastUpdate) >= TIEMPO_MAXIMO_INACTIVO_MS;
                        
                        let idStr = instId.padStart(2, '0');
                        let packsVal = packs.padStart(3, ' ');
                        let timeVal = globalTime.padStart(4, ' ');
                        
                        let instCuentas = Math.floor(parseInt(packs, 10) / 2);
                        let cuentasVal = instCuentas.toString().padStart(2, ' ');

                        if (esOffline) {
                            offlineInstancesList.push(counter);
                            let offlineTexto = " Off ".padStart(5, ' ');
                            tabla += `> 🖥️ \`${idStr}\` | 🔴 \`${offlineTexto}\` | ⏱️ \`${timeVal}\` | 📦 \`${packsVal}\` | 🔓 \`${cuentasVal}\`\n`;
                        } else if (estaCongelado && !contieneActividadExtra) {
                            onlineInstancesList.push(counter);
                            let pausaTexto = "Pause".padStart(5, ' ');
                            tabla += `> 🖥️ \`${idStr}\` | 💤 \`${pausaTexto}\` | ⏱️ \`${timeVal}\` | 📦 \`${packsVal}\` | 🔓 \`${cuentasVal}\`\n`;
                        } else {
                            onlineInstancesList.push(counter);
                            let ppmVal = ppm.padStart(5, ' ');
                            tabla += `> 🖥️ \`${idStr}\` | ⚡ \`${ppmVal}\` | ⏱️ \`${timeVal}\` | 📦 \`${packsVal}\` | 🔓 \`${cuentasVal}\`\n`;
                            
                            let ppmNumerico = parseFloat(ppm);
                            if (!isNaN(ppmNumerico)) {
                                ppmCombinadoReal += ppmNumerico;
                            }
                        }
                        counter++;
                    }
                }
            }

            let balanceKevin = obtenerBalanceDesdeArchivo(RUTA_BALANCE_RESULT);
            let cuentasAbiertas = Math.floor(totalPacksGlobal / 2);
            let totalFisico = contarXMLs(RUTA_CARPETA_XML).totales;

            let cuentasRestantes = balanceKevin > 0 ? (balanceKevin - cuentasAbiertas) : 0;
            if (cuentasRestantes < 0) cuentasRestantes = 0;

            let onlineStr = onlineInstancesList.length > 0 ? onlineInstancesList.sort((a,b)=>a-b).join(', ') : "none";
            let offlineStr = offlineInstancesList.length > 0 ? offlineInstancesList.sort((a,b)=>a-b).join(', ') : "none";

            console.log(`[HB-DEBUG] Total instances found: Online=${onlineInstancesList.length}, Offline=${offlineInstancesList.length}, Total=${onlineInstancesList.length + offlineInstancesList.length}`);

            let colorFinal = offlineInstancesList.length > 0 ? 0xED4245 : 0x57F287;
            let alerta = (offlineInstancesList.length > 0) ? "🔴 **ALERTA: Se detectaron instancias caídas.**\n\n" : "";

            let singleEmbedDescription = `**Data bot:**`;
            singleEmbedDescription += `\n🏷️ | Version: ${versionBot}`;
            singleEmbedDescription += `\n🔖 | Mod Version: ${modVersion}`;
            singleEmbedDescription += `\n💎 | Type: ${botType}`;
            singleEmbedDescription += `\n🌌 | Opening: ${openingType}\n\n`; 
            singleEmbedDescription += `**Local Host:**`;
            singleEmbedDescription += `\n🔥 | Host: ${nombreCarpeta}`;
            singleEmbedDescription += `\n🖥️ | Ints. Online: ${onlineStr}`;
            singleEmbedDescription += `\n🖥️ | Inst. Offline: ${offlineStr}\n\n`; 
            singleEmbedDescription += `**Data Accounts:**`;
            singleEmbedDescription += `\n📌 | Accounts: ${totalFisico}`;
            singleEmbedDescription += `\n🚀 | Accounts available 24 hrs: ${cuentasRestantes}`;
            singleEmbedDescription += `\n🗃️ | Accounts opened X2 P: ${cuentasAbiertas}`;
            singleEmbedDescription += `\n📦 | Total Packets claimed: ${totalPacksGlobal}\n\n`; 
            singleEmbedDescription += `**Data time:**`;
            singleEmbedDescription += `\n⚡️ | Avg: ${ppmCombinadoReal.toFixed(2)} packs/min`; 
            singleEmbedDescription += `\n⏱️ | Total time: ${globalTime}`;
            singleEmbedDescription += `\n📁 | Folder: ${nombreCarpeta}`;
            
            singleEmbedDescription += `\n\n🟢 **ONLINE**\n\n`; 
            singleEmbedDescription += `# Data instances:`;
            singleEmbedDescription += `\n# ⚡  ${ppmCombinadoReal.toFixed(2)} PPM\n\n` + tabla;

            const heartbeatMsgCache = cargarHeartbeatMsgCache();
            const cacheKey = hbConfig.canal_id || 'heartbeat_default';
            let cargandoID = heartbeatMsgCache[cacheKey] || null;

            // Legacy fallback for old deployments that only had mensaje_id.txt
            if (!cargandoID && fs.existsSync(RUTA_ID_TXT_LEGACY)) {
                const legacyId = fs.readFileSync(RUTA_ID_TXT_LEGACY, 'utf8').trim();
                if (legacyId) cargandoID = legacyId;
            }
            if (cargandoID && !heartbeatMsgCache[cacheKey]) {
                heartbeatMsgCache[cacheKey] = cargandoID;
                guardarHeartbeatMsgCache(heartbeatMsgCache);
            }

            let payload = {
                content: alerta || null,
                embeds: [{
                    description: singleEmbedDescription,
                    color: colorFinal,
                    thumbnail: { url: 'attachment://heartbeat.png' },
                    footer: { text: "Monitor Local Host ୨♡୧ • Updated " },
                    timestamp: new Date()
                }]
            };

            const persistHeartbeatMessageId = (messageId) => {
                heartbeatMsgCache[cacheKey] = messageId;
                guardarHeartbeatMsgCache(heartbeatMsgCache);
                // keep legacy file for compatibility with existing control flow
                fs.writeFileSync(RUTA_ID_TXT_LEGACY, messageId, 'utf8');
            };

            if (cargandoID) {
                try {
                    await enviarConThumbnail(`${DISCORD_WEBHOOK}/messages/${cargandoID}`, 'patch', payload);
                } catch (errEdit) {
                    if (errEdit?.response?.status === 404 && errEdit?.response?.data?.code === 10015) {
                        const newWebhook = await crearWebhookSiEsNecesario(hbConfig, 'heartbeat');
                        if (newWebhook) {
                            DISCORD_WEBHOOK = newWebhook;
                            hbConfig.webhook_url = newWebhook;
                            try {
                                await enviarConThumbnail(`${newWebhook}/messages/${cargandoID}`, 'patch', payload);
                                return res.status(200).send('OK');
                            } catch (errPatchNewWebhook) {
                                // message may not exist for new webhook; create one below
                            }
                        }
                    }
                    const respuesta = await enviarConThumbnail(`${DISCORD_WEBHOOK}?wait=true`, 'post', payload);
                    persistHeartbeatMessageId(respuesta.data.id);
                }
            } else {
                try {
                    const respuesta = await enviarConThumbnail(`${DISCORD_WEBHOOK}?wait=true`, 'post', payload);
                    persistHeartbeatMessageId(respuesta.data.id);
                } catch (errPost) {
                    if (errPost?.response?.status === 404 && errPost?.response?.data?.code === 10015) {
                        const newWebhook = await crearWebhookSiEsNecesario(hbConfig, 'heartbeat');
                        if (newWebhook) {
                            DISCORD_WEBHOOK = newWebhook;
                            hbConfig.webhook_url = newWebhook;
                            const respuesta = await enviarConThumbnail(`${newWebhook}?wait=true`, 'post', payload);
                            persistHeartbeatMessageId(respuesta.data.id);
                        }
                    } else {
                        throw errPost;
                    }
                }
            }

            res.status(200).send("OK");
        } catch (err) { console.error("Error en monitor:", err); res.status(500).send("Error"); }
    });

    // Mismo criterio que s4t.js: todo lo que le manda datos corre en la misma PC.
    app.listen(PORT, '127.0.0.1', () => console.log(`🚀 Monitor de Producción Encendido en puerto ${PORT}`));
}

// =====================================================================
// 🕹️ MODO COMANDOS DISCORD
// =====================================================================
else {
    module.exports = {
        async ejecutar(interaction, generarPanelControl) {
            const userId = interaction.user.id;
            try {
                const rowHb = await db.get(`SELECT webhook_url FROM configs_canales WHERE discord_id = ? AND tipo = 'heartbeat' AND webhook_url NOT IN ('N/A', 'local') ORDER BY rowid DESC LIMIT 1`, [userId]);
                const rowRuta = await db.get(`SELECT webhook_url FROM configs_canales WHERE discord_id = ? AND tipo = 'ruta_local' AND webhook_url NOT IN ('N/A', 'local') ORDER BY rowid DESC LIMIT 1`, [userId]);
                
                if (!rowHb || !rowHb.webhook_url || rowHb.webhook_url === 'N/A') {
                    return await interaction.reply({ content: "❌ **Primero configura el Webhook de Heartbeat en el panel.**", ephemeral: true });
                }
                if (!rowRuta || !rowRuta.webhook_url || rowRuta.webhook_url === 'local' || rowRuta.webhook_url === 'N/A') {
                    return await interaction.reply({ content: "❌ **Primero configura la Ruta Local en el panel.**", ephemeral: true });
                }

                await interaction.deferUpdate(); 

                exec('pm2 jlist', { windowsHide: true }, async (err, stdout) => {
                    if (err) return console.error("Error leyendo PM2:", err);
                    try {
                        const procesos = JSON.parse(stdout);
                        const proc = procesos.find(p => p.name === 'heartbeat');
                        const estaOnline = proc && proc.pm2_env.status === 'online';

                        if (estaOnline) {
                            try {
                                const cache = cargarHeartbeatMsgCache();
                                const idMensaje = cache[rowHb?.canal_id] || (fs.existsSync(path.join(__dirname, 'mensaje_id.txt')) ? fs.readFileSync(path.join(__dirname, 'mensaje_id.txt'), 'utf8').trim() : null);
                                if (idMensaje) {
                                    const mensajeActual = await axios.get(`${rowHb.webhook_url}/messages/${idMensaje}`);
                                    if (mensajeActual.data && mensajeActual.data.embeds && mensajeActual.data.embeds.length > 0) {
                                        let embedCongelado = mensajeActual.data.embeds[0];
                                        let desc = embedCongelado.description;
                                        if (desc.includes('🟢 **ONLINE**')) {
                                            desc = desc.replace('🟢 **ONLINE**', '🔴 **ESTADO: OFFLINE**');
                                        } else if (!desc.includes('🔴 **ESTADO: OFFLINE**')) {
                                            desc = desc.replace('# Data instances:', '🔴 **ESTADO: OFFLINE**\n\n# Data instances:');
                                        }
                                        embedCongelado.description = desc;
                                        embedCongelado.color = 0xED4245; 
                                        await axios.patch(`${rowHb.webhook_url}/messages/${idMensaje}`, { embeds: [embedCongelado] });
                                    }
                                }
                            } catch(e) { console.log("Error visual offline:", e.message); }
                            exec('pm2 stop heartbeat', { windowsHide: true });
                        } else {
                            try {
                                const cache = cargarHeartbeatMsgCache();
                                const idMensaje = cache[rowHb?.canal_id] || (fs.existsSync(path.join(__dirname, 'mensaje_id.txt')) ? fs.readFileSync(path.join(__dirname, 'mensaje_id.txt'), 'utf8').trim() : null);
                                if (idMensaje) {
                                    const mensajeActual = await axios.get(`${rowHb.webhook_url}/messages/${idMensaje}`);
                                    if (mensajeActual.data && mensajeActual.data.embeds && mensajeActual.data.embeds.length > 0) {
                                        let embedCongelado = mensajeActual.data.embeds[0];
                                        let desc = embedCongelado.description;
                                        if (desc.includes('🔴 **ESTADO: OFFLINE**')) {
                                            desc = desc.replace('🔴 **ESTADO: OFFLINE**', '🟢 **ONLINE**');
                                        } else if (!desc.includes('🟢 **ONLINE**')) {
                                            desc = desc.replace('# Data instances:', '🟢 **ONLINE**\n\n# Data instances:');
                                        }
                                        embedCongelado.description = desc;
                                        embedCongelado.color = 0x57F287; 
                                        await axios.patch(`${rowHb.webhook_url}/messages/${idMensaje}`, { embeds: [embedCongelado] });
                                    }
                                }
                            } catch(e) { console.log("Error visual online:", e.message); }
                            exec('pm2 start heartbeat.js --name "heartbeat"', { windowsHide: true });
                        }
                        setTimeout(async () => {
                            const nuevoPanel = await generarPanelControl(userId);
                            await interaction.editReply(nuevoPanel);
                        }, 1000);
                    } catch (e) { console.error("Error al procesar PM2:", e); }
                });
            } catch (error) { console.error("Error en el módulo Heartbeat:", error); }
        }
    };
}
