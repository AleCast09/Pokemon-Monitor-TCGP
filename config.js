const { EmbedBuilder, ActionRowBuilder, ChannelSelectMenuBuilder, StringSelectMenuBuilder, ChannelType, ModalBuilder, TextInputBuilder, TextInputStyle, ButtonBuilder, ButtonStyle } = require('discord.js');
const db = require('./database.js');

// 1️⃣ FUNCIÓN PRINCIPAL: Muestra el panel de configuración simplificado
async function ejecutar(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const userId = interaction.user.id;
    const configs = await db.all(`SELECT tipo, canal_id FROM configs_canales WHERE discord_id = ?`, [userId]);

    const guardados = {};
    if (configs) {
        configs.forEach(row => { guardados[row.tipo] = row.canal_id; });
    }

    const embedConfig = new EmbedBuilder()
        .setTitle('⚙️ Destination Settings Panel')
        .setDescription(
            'Assign a channel for each module. If you want to **change** one, just select it again.\n\n' +
            '**Your current links:**\n' +
            `🚀 **S4T:** ${guardados['s4t'] ? `<#${guardados['s4t']}>` : '🔴 Not assigned'}\n` +
            `💓 **Heartbeat:** ${guardados['heartbeat'] ? `<#${guardados['heartbeat']}>` : '🔴 Not assigned'}`
        ).setColor(0x2ECC71);

    const buildMenu = (id, placeholder, tipo) => {
        const menu = new ChannelSelectMenuBuilder()
            .setCustomId(id)
            .addChannelTypes(ChannelType.GuildText);

        if (guardados[tipo]) {
            menu.setPlaceholder(`✅ Assigned (tap only if you want to change it)`);
            try {
                if(guardados[tipo] !== 'local' && guardados[tipo] !== 'N/A') {
                    menu.setDefaultChannels(guardados[tipo]);
                }
            } catch(e) {}
        } else {
            menu.setPlaceholder(placeholder);
        }

        return new ActionRowBuilder().addComponents(menu);
    };

    const components = [
        buildMenu('select_canal_s4t', 'Select channel for: S4T Module', 's4t'),
        buildMenu('select_canal_heartbeat', 'Select channel for: Heartbeat Module', 'heartbeat')
    ];

    const rowReset = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder().setCustomId('select_reset_modulo').setPlaceholder('🗑️ Unlink...')
            .addOptions([
                { label: 'Unlink S4T', value: 's4t' },
                { label: 'Unlink Heartbeat', value: 'heartbeat' }
            ])
    );

    await interaction.editReply({ embeds: [embedConfig], components: components });
    await interaction.followUp({ content: '**Cleanup options:**', components: [rowReset], ephemeral: true });
}

// 2️⃣ FUNCIÓN QUE PROCESA LOS MENÚS Y BOTONES
async function manejarMenuCanales(interaction) {
    if (interaction.isChannelSelectMenu()) {
        await interaction.deferReply({ ephemeral: true });

        const mapaTipos = {
            'select_canal_s4t': 's4t',
            'select_canal_heartbeat': 'heartbeat'
        };

        const tipo = mapaTipos[interaction.customId];
        const canal = interaction.channels.first();

        try {
            const webhooks = await canal.fetchWebhooks();
            const webhookExistente = webhooks.first();

            if (webhookExistente) {
                await db.run(
                    `INSERT INTO configs_canales (discord_id, tipo, canal_id, webhook_url) VALUES (?, ?, ?, ?)
                     ON CONFLICT(discord_id, tipo) DO UPDATE SET canal_id = ?, webhook_url = ?`,
                    [interaction.user.id, tipo, canal.id, webhookExistente.url, canal.id, webhookExistente.url]
                );
                return await interaction.editReply({ content: `✅ Detected! Linked the existing webhook from channel <#${canal.id}> to **${tipo}**.` });
            } else {
                const botonManual = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId(`manual_webhook_${tipo}_${canal.id}`)
                        .setLabel('✏️ Enter URL manually')
                        .setStyle(ButtonStyle.Primary)
                );
                return await interaction.editReply({
                    content: `⚠️ No webhook detected in <#${canal.id}>. You can create one manually in the channel settings, or press the button to paste the URL:`,
                    components: [botonManual]
                });
            }
        } catch (e) {
            return await interaction.editReply({ content: '❌ Error trying to read the webhooks.' });
        }
    }

    if (interaction.isButton() && interaction.customId.startsWith('manual_webhook_')) {
        const partes = interaction.customId.split('_');
        const tipo = partes[2];
        const canalId = partes[3];

        const modal = new ModalBuilder()
            .setCustomId(`modal_webhook_${tipo}_${canalId}`)
            .setTitle(`Webhook for ${tipo.toUpperCase()}`);

        modal.addComponents(new ActionRowBuilder().addComponents(
            new TextInputBuilder()
                .setCustomId('input_url')
                .setLabel('Paste the webhook URL:')
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
        ));
        return await interaction.showModal(modal);
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'select_reset_modulo') {
        await interaction.deferReply({ ephemeral: true });
        const tipo = interaction.values[0];
        await db.run(`DELETE FROM configs_canales WHERE discord_id = ? AND tipo = ?`, [interaction.user.id, tipo]);
        return await interaction.editReply({ content: `🗑️ **${tipo}** link removed.` });
    }
}

async function manejarModal(interaction) {
    if (interaction.isModalSubmit() && interaction.customId.startsWith('modal_webhook_')) {
        await interaction.deferReply({ ephemeral: true });

        const partes = interaction.customId.split('_');
        const tipo = partes[2];
        const canalId = partes[3];
        const webhookUrl = interaction.fields.getTextInputValue('input_url');

        try {
            await db.run(
                `INSERT INTO configs_canales (discord_id, tipo, canal_id, webhook_url) VALUES (?, ?, ?, ?)
                 ON CONFLICT(discord_id, tipo) DO UPDATE SET canal_id = ?, webhook_url = ?`,
                [interaction.user.id, tipo, canalId, webhookUrl, canalId, webhookUrl]
            );
            return await interaction.editReply({ content: `✅ Done! Channel <#${canalId}> and webhook successfully linked to **${tipo}**.` });
        } catch (error) {
            return await interaction.editReply({ content: '❌ An error occurred while saving to the database.' });
        }
    }
}

module.exports = { ejecutar, manejarMenuCanales, manejarModal };
