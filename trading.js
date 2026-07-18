require('dotenv').config();
const express = require('express');
const axios = require('axios');
const multer = require('multer');
const FormData = require('form-data');
const db = require('./database.js');
const fs = require('fs');
const path = require('path');
const xml2js = require('xml2js');

const app = express();
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        files: 4,
        fileSize: 10 * 1024 * 1024
    }
});

const TOKEN = process.env.DISCORD_BOT_TOKEN;
const DISCORD_USER_ID = process.env.DISCORD_USER_ID || null;
const INGEST_AUTH_TOKEN = process.env.INGEST_AUTH_TOKEN || '';
const REQUIRE_INGEST_AUTH = /^true$/i.test(process.env.REQUIRE_INGEST_AUTH || (process.env.NODE_ENV === 'production' ? 'true' : 'false'));
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function rutaSegura(ruta) {
    if (!ruta) return 'none';
    return path.basename(String(ruta)) || 'none';
}

function validarIngestToken(req) {
    if (!REQUIRE_INGEST_AUTH) return true;
    if (!INGEST_AUTH_TOKEN) return false;
    const headerToken = req.headers['x-ingest-token'] || req.headers['x-bot-token'];
    return headerToken === INGEST_AUTH_TOKEN;
}

async function obtenerIdsDelXml(xmlBuffer, numInstancia) {
    try {
        const parser = new xml2js.Parser();
        const xmlData = await parser.parseStringPromise(xmlBuffer.toString());
        const deviceAccount = xmlData.map.string.find(s => s.$.name === 'deviceAccount')._;

        const configRuta = await db.get(`SELECT webhook_url FROM configs_canales WHERE tipo = 'ruta_json_cuentas' AND (? IS NULL OR discord_id = ?) ORDER BY rowid DESC LIMIT 1`, [DISCORD_USER_ID, DISCORD_USER_ID]);
        if (!configRuta || configRuta.webhook_url === 'N/A') return null;

        const dirInstancia = path.join(configRuta.webhook_url, numInstancia.toString());
        if (!fs.existsSync(dirInstancia)) return null;

        const files = fs.readdirSync(dirInstancia);
        for (const file of files) {
            if (file.endsWith('.json')) {
                const data = JSON.parse(fs.readFileSync(path.join(dirInstancia, file), 'utf8'));
                if (data.deviceAccount === deviceAccount && data.pulls && data.pulls.length > 0) {
                    return data.pulls[data.pulls.length - 1].cards;
                }
            }
        }
    } catch (e) {}
    return null;
}

app.post('/', upload.any(), async (req, res) => {
    if (!validarIngestToken(req)) {
        return res.status(401).send('UNAUTHORIZED');
    }

    res.status(200).send('OK');
    try {
        const rowS4t = await db.get(`SELECT webhook_url FROM configs_canales WHERE tipo = 's4t' AND webhook_url NOT IN ('N/A', 'local') AND (? IS NULL OR discord_id = ?) ORDER BY rowid DESC LIMIT 1`, [DISCORD_USER_ID, DISCORD_USER_ID]);
        if (!rowS4t || !rowS4t.webhook_url || rowS4t.webhook_url === 'N/A') return;
        let webhook = rowS4t.webhook_url;

        let contenidoTexto = req.body.payload_json ? JSON.parse(req.body.payload_json).content : (req.body.content || "");
        let lineas = contenidoTexto.split('\n').map(l => l.trim());
        let instancia = "N/A", sobre = "Desconocido", archivo = "archivo.xml", cartas = [];
        let esWishlist = contenidoTexto.toLowerCase().includes('wishlist');

        for (let l of lineas) {
            if (l.includes('Instance:')) {
                instancia = l.match(/Instance:\s*(\d+)/i)?.[1] || "N/A";
                let p = l.match(/\(([^)]+)\)/)?.[1]?.split('·');
                sobre = p?.length === 2 ? `${p[1].trim()} (${p[0].replace(/\D/g, '')})` : "N/A";
            }
            if (l.startsWith('File name:')) archivo = l.replace('File name:', '').trim();
            if (l.length > 5 && !l.includes('Instance:') && !l.startsWith('File name:')) cartas.push(l);
        }

        const embedGeneral = {
            color: esWishlist ? 0xE91E63 : 0xF1C40F,
            description: esWishlist ? `💖 **¡MATCH DE WISHLIST!** 💖` : `🌟 **¡NUEVA CARTA VALIOSA!** 🌟`,
            fields: [
                { name: "🖥️ Instancia", value: `\`${instancia}\``, inline: true },
                { name: "📦 Sobre", value: `\`${sobre}\``, inline: true },
                { name: "\u200B", value: `${cartas.join('\n')}\n\n📁 **Archivo**\n\`${archivo}\``, inline: false }
            ]
        };

        await axios.post(webhook, { embeds: [embedGeneral] });

        let imgs = req.files ? req.files.filter(f => !f.originalname.toLowerCase().endsWith('.xml')) : [];
        let syntheticImgs = imgs.filter(f => !f.originalname.toLowerCase().includes('screen') && !f.originalname.toLowerCase().includes('full'));
        if (syntheticImgs.length === 0) syntheticImgs = imgs;

        let xmlFile = req.files ? req.files.find(f => f.originalname.toLowerCase().endsWith('.xml')) : null;
        
        console.log("DEBUG: Total imágenes disponibles del emulador:", syntheticImgs.length);
        
        if (xmlFile) {
            let idsDetectados = await obtenerIdsDelXml(xmlFile.buffer, instancia);
            const rutaDbRow = await db.get(`SELECT webhook_url FROM configs_canales WHERE tipo = 'ruta_cartas' LIMIT 1`);
            
            console.log("DEBUG: IDs detectados en XML:", idsDetectados);
            console.log("DEBUG: IDs detectados en XML: count=", Array.isArray(idsDetectados) ? idsDetectados.length : 0);
            
            if (idsDetectados && idsDetectados.length > 0 && rutaDbRow && rutaDbRow.webhook_url !== 'N/A') {
                console.log("DEBUG: Intentando buscar archivos en:", rutaSegura(rutaDbRow.webhook_url));
                let fotosLocales = [];
                for (let idCarta of idsDetectados) {
                    console.log("DEBUG: Buscando archivo para ID:", String(idCarta).slice(0, 6));
                    let base = path.join(rutaDbRow.webhook_url, idCarta);
                    if (fs.existsSync(base + ".png")) {
                        console.log("✅ Archivo encontrado:", path.basename(base + ".png"));
                        fotosLocales.push({ buffer: fs.readFileSync(base + ".png"), originalname: idCarta + ".png" });
                    } else if (fs.existsSync(base + ".webp")) {
                        console.log("✅ Archivo encontrado:", path.basename(base + ".webp"));
                        fotosLocales.push({ buffer: fs.readFileSync(base + ".webp"), originalname: idCarta + ".webp" });
                    } else {
                        console.log("❌ No se encontró archivo en:", path.basename(base));
                    }
                }
                if (fotosLocales.length > 0) {
                    syntheticImgs = fotosLocales;
                }
            }
        }

        let clasificacion = {};

        if (esWishlist) clasificacion['💖-wishlist'] = { textos: ["> 💖 Match de Wishlist"], imagenes: syntheticImgs };

        cartas.forEach((carta, index) => {
            let texto = carta.toLowerCase();
            let canal = null;

            if (texto.includes('♛') || texto.includes('crown')) canal = '👑-crown-rare';
            else if (texto.includes('★★★') || texto.includes('immersive')) canal = '🌌-immersive';
            else if (texto.includes('◆◆◆◆')) canal = '💠-4-diamond';
            else if (texto.includes('◆◆◆')) canal = '🔷-3-diamond';
            else if (texto.includes('★★')) {
                if (texto.includes('trainer')) canal = '⭐⭐-trainer';
                else if (texto.includes('rainbow')) canal = '🌈-2-star-rainbow';
                else if (texto.includes('shiny')) canal = '✨-2-star-shiny';
                else canal = '🎨-2-star-full-art';
            } else if (texto.includes('★')) {
                canal = texto.includes('shiny') ? '🌟-1-star-shiny' : '⭐-1-star';
            }

            if (canal) {
                if (!clasificacion[canal]) clasificacion[canal] = { textos: [], imagenes: [] };
                clasificacion[canal].textos.push(`> ${carta}`);
                clasificacion[canal].imagenes = syntheticImgs; 
            }
        });

        const rowCat = await db.get(`SELECT canal_id FROM configs_canales WHERE tipo = 'crear_canales' ORDER BY rowid DESC LIMIT 1`);
        if (rowCat && rowCat.canal_id !== 'N/A') {
            const channelsRes = await axios.get(`https://discord.com/api/v10/guilds/${(await axios.get(`https://discord.com/api/v10/channels/${rowCat.canal_id}`, { headers: { Authorization: `Bot ${TOKEN}` } })).data.guild_id}/channels`, { headers: { Authorization: `Bot ${TOKEN}` } }).catch(() => null);
            
            if (channelsRes?.data) {
                const channelMap = {};
                channelsRes.data.forEach(c => { if (c.parent_id === rowCat.canal_id) channelMap[c.name] = c.id; });

                for (let [nombreCanal, datos] of Object.entries(clasificacion)) {
                    let chId = channelMap[nombreCanal];
                    if (chId) {
                        const form = new FormData();
                        form.append('payload_json', JSON.stringify({ embeds: [{ color: 0x2ECC71, title: "✨ Hit Aislado", description: datos.textos.join('\n') }] }));
                        datos.imagenes.forEach((f, i) => form.append(`files[${i}]`, f.buffer, { filename: f.originalname }));
                        await axios.post(`https://discord.com/api/v10/channels/${chId}/messages`, form, { headers: { ...form.getHeaders(), Authorization: `Bot ${TOKEN}` } }).catch(e => console.error(e.message));
                        await sleep(1000);
                    }
                }
            }
        }
    } catch (e) { console.error("Error en S4T:", e); }
});

app.listen(3000, () => console.log('🚀 Enrutador S4T Optimizado Activo'));