// Host de la comunidad para quien NO usa este bot en un server propio (ej. wr98 o un tercer host):
// corre bot.js con SU propio bot (su token, en el .env de su carpeta de host) atendiendo solo
// COMMUNITY_GUILD_IDS. El turno entre hosts lo maneja community-host.js: aunque varios esten
// prendidos, en Zenith Rise solo uno tiene comandos y paneles.
//
// Se arranca desde la carpeta del host (la que tiene su .env y su base), por ejemplo con PM2:
//   pm2 start "<repo>\host.js" --name zenith --cwd "<carpeta del host>"
'use strict';
require('dotenv').config();
process.env.MONITOR_HOST_MODE = 'community';

if (!process.env.DISCORD_BOT_TOKEN || !process.env.COMMUNITY_GUILD_IDS || !process.env.LINK_REDIS_URL || !process.env.LINK_REDIS_TOKEN) {
    console.error('❌ This host is not set up: DISCORD_BOT_TOKEN, COMMUNITY_GUILD_IDS and LINK_REDIS_* are required (run node host-setup.js).');
    process.exit(1);
}
require('./bot.js');
