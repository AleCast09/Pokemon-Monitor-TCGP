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
        .setTitle('⚙️ Panel de Configuración de Destinos')
        .setDescription(
            'Asigna un canal para cada módulo. Si deseas **cambiar** uno, simplemente vuelve a seleccionarlo.\n\n' +
            '**Tus vinculaciones actuales:**\n' +
            `🚀 **S4T:** ${guardados['s4t'] ? `<#${guardados['s4t']}>` : '🔴 Sin asignar'}\n` +
            `💓 **Heartbeat:** ${guardados['heartbeat'] ? `<#${guardados['heartbeat']}>` : '🔴 Sin asignar'}`
        ).setColor(0x2ECC71);

    const buildMenu = (id, placeholder, tipo) => {
        const menu = new ChannelSelectMenuBuilder()
            .setCustomId(id)
            .addChannelTypes(ChannelType.GuildText);
            
        if (guardados[tipo]) {
            menu.setPlaceholder(`✅ Asignado (Toca solo si deseas cambiarlo)`);
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
        buildMenu('select_canal_s4t', 'Seleccione canal para: Módulo S4T', 's4t'),
        buildMenu('select_canal_heartbeat', 'Seleccione canal para: Módulo Heartbeat', 'heartbeat')
    ];

    const rowReset = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder().setCustomId('select_reset_modulo').setPlaceholder('🗑️ Desvincular...')
            .addOptions([
                { label: 'Desvincular S4T', value: 's4t' },
                { label: 'Desvincular Heartbeat', value: 'heartbeat' }
            ])
    );

    await interaction.editReply({ embeds: [embedConfig], components: components });
    await interaction.followUp({ content: '**Opciones de limpieza:**', components: [rowReset], ephemeral: true });
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
                return await interaction.editReply({ content: `✅ ¡Detectado! Se vinculó el webhook existente del canal <#${canal.id}> a **${tipo}**.` });
            } else {
                const botonManual = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId(`manual_webhook_${tipo}_${canal.id}`)
                        .setLabel('✏️ Ingresar URL manualmente')
                        .setStyle(ButtonStyle.Primary)
                );
                return await interaction.editReply({ 
                    content: `⚠️ No se detectó un webhook en <#${canal.id}>. Puedes crearlo manualmente en los ajustes del canal o presionar el botón para pegar la URL:`,
                    components: [botonManual]
                });
            }
        } catch (e) {
            return await interaction.editReply({ content: '❌ Error al intentar leer los webhooks.' });
        }
    }

    if (interaction.isButton() && interaction.customId.startsWith('manual_webhook_')) {
        const partes = interaction.customId.split('_');
        const tipo = partes[2];
        const canalId = partes[3];
        
        const modal = new ModalBuilder()
            .setCustomId(`modal_webhook_${tipo}_${canalId}`)
            .setTitle(`Webhook para ${tipo.toUpperCase()}`);

        modal.addComponents(new ActionRowBuilder().addComponents(
            new TextInputBuilder()
                .setCustomId('input_url')
                .setLabel('Pega la URL del Webhook:')
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
        ));
        return await interaction.showModal(modal);
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'select_reset_modulo') {
        await interaction.deferReply({ ephemeral: true });
        const tipo = interaction.values[0];
        await db.run(`DELETE FROM configs_canales WHERE discord_id = ? AND tipo = ?`, [interaction.user.id, tipo]);
        return await interaction.editReply({ content: `🗑️ Vinculación de **${tipo}** eliminada.` });
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
            return await interaction.editReply({ content: `✅ ¡Perfecto! Canal <#${canalId}> y Webhook vinculados correctamente a **${tipo}**.` });
        } catch (error) {
            return await interaction.editReply({ content: '❌ Ocurrió un error al guardar en la base de datos.' });
        }
    }
}

module.exports = { ejecutar, manejarMenuCanales, manejarModal };
