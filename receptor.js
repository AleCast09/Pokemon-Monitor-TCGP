require('dotenv').config();
const { WebhookClient, EmbedBuilder } = require('discord.js');
const express = require('express');
const db = require('./database.js'); 
const axios = require('axios');
const DISCORD_TOKEN = process.env.DISCORD_BOT_TOKEN;
const DISCORD_USER_ID = process.env.DISCORD_USER_ID || null;

const app = express();
app.use(express.json()); // Permite leer el formato de datos de Kevin

// =========================================================
// 🚀 RUTA QUE RECIBE LOS TRADEOS (localhost:3000/s4t)
// =========================================================
app.post('/s4t', async (req, res) => {
    const data = req.body;
    console.log("🔥 ¡Llegó un tradeo de una de las instancias!", data);

    // Respondemos rápido con un "OK" (200) para que el emulador siga trabajando
    res.sendStatus(200);

    try {
        // 🔍 Buscamos la URL del Webhook que guardaste en tu menú
        const row = await db.get(`SELECT canal_id, webhook_url FROM configs_canales WHERE tipo = 's4t' AND webhook_url NOT IN ('N/A', 'local') AND (? IS NULL OR discord_id = ?) ORDER BY rowid DESC LIMIT 1`, [DISCORD_USER_ID, DISCORD_USER_ID]);

        const embed = new EmbedBuilder()
            .setTitle('🎁 ¡Nuevo Save For Trade Encontrado!')
            .setDescription('Se ha detectado un tradeo excelente. Guardado en la base de datos de S4T.')
            .setColor(0xFFD700) // Dorado
            .addFields(
                { name: '👤 Cuenta', value: `\`${data.Account || 'Desconocida'}\``, inline: true },
                { name: '🃏 Carta', value: `**${data.Card || 'Desconocida'}**`, inline: true }
            )
            .setFooter({ text: 'Data saved' })
            .setTimestamp();

        if (row && row.webhook_url && row.webhook_url !== 'N/A' && row.webhook_url !== 'local') {
            let webhookUrl = row.webhook_url;
            let webhookClient = new WebhookClient({ url: webhookUrl });
            try {
                await webhookClient.send({ username: 'Poke Helper', avatarURL: 'https://i.imgur.com/AfFp7pu.png', embeds: [embed] });
                console.log("✅ ¡Alerta enviada con éxito al canal de Discord por Webhook!");
            } catch (sendErr) {
                const status = sendErr?.response?.status;
                const code = sendErr?.response?.data?.code;
                if (status === 404 && (code === 10015 || !code)) {
                    console.log('⚠️ Webhook inválido o eliminado, intentando recrearlo...');
                    const newUrl = await crearWebhookSiEsNecesario(row, 's4t');
                    if (newUrl) {
                        webhookClient = new WebhookClient({ url: newUrl });
                        try {
                            await webhookClient.send({ username: 'Poke Helper', avatarURL: 'https://i.imgur.com/AfFp7pu.png', embeds: [embed] });
                            console.log('✅ Alerta enviada con webhook recreado.');
                        } catch (retryErr) {
                            console.error('❌ Error enviando con webhook recreado:', retryErr?.message || retryErr);
                        }
                    } else {
                        console.error('❌ No se pudo recrear el webhook para el canal:', row.canal_id);
                    }
                } else {
                    console.error('❌ Error enviando webhook:', sendErr?.message || sendErr);
                }
            }
        } else {
            console.log("⚠️ Llegó un tradeo, pero aún no hay URL de Webhook guardada para S4T.");
        }
    } catch (error) {
        console.error("❌ Error al intentar procesar o enviar el Webhook:", error);
    }
});

// =========================================================
// 🌐 ARRANQUE DEL SERVIDOR
// =========================================================
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
        console.error('DEBUG: no se pudo recrear webhook S4T:', error?.response?.data || error?.message || error);
    }
    return null;
}

const PUERTO = 3000;
app.listen(PUERTO, () => {
    console.log(`🌐 Motor S4T   como un campeón en el puerto ${PUERTO}`);
});
