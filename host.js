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
// Autoarreglo de PM2 (2026-10-30, pedido de Ale: que llegue con una update y nadie tenga que correr
// comandos). Sin --shutdown-with-message, en Windows pm2 no puede avisarle al bot que se apague: lo
// mata a la fuerza y cada restart deja una copia vieja del bot viva, contestando con el codigo
// anterior. Si este proceso de pm2 no lo tiene, se recrea solo UNA vez (marca en la carpeta del host)
// con un .cmd que corre fuera del arbol de este proceso (pm2 delete lo mataria si fuera hijo).
function repararPm2() {
    if (process.env.pm_id === undefined || process.platform !== 'win32') return;
    const fs = require('fs');
    const os = require('os');
    const path = require('path');
    const { execSync } = require('child_process');
    const marca = path.join(process.cwd(), '.pm2-reparado');
    if (fs.existsSync(marca)) return;
    try {
        const yo = JSON.parse(execSync('pm2 jlist', { windowsHide: true, timeout: 20000 }).toString())
            .find(p => String(p.pm_id) === String(process.env.pm_id));
        const env = yo?.pm2_env;
        if (!env || (env.shutdown_with_message && env.kill_timeout >= 8000)) return;
        fs.writeFileSync(marca, new Date().toISOString());
        const cmd = path.join(os.tmpdir(), 'zenith-pm2-reparar.cmd');
        fs.writeFileSync(cmd, [
            '@echo off',
            'timeout /t 5 /nobreak >nul',
            `call pm2 delete "${yo.name}"`,
            `call pm2 start "${env.pm_exec_path}" --name "${yo.name}" --cwd "${env.pm_cwd}" --shutdown-with-message --kill-timeout 8000`,
            'call pm2 save',
            ''
        ].join('\r\n'));
        // Via WMI: el proceso nuevo cuelga de WmiPrvSE, no de este, asi "pm2 delete" no lo mata.
        execSync(`powershell -NoProfile -Command "Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = 'cmd /c \\"${cmd}\\"' } | Out-Null"`,
            { windowsHide: true, timeout: 30000 });
        console.log('🔧 PM2: recreating this host with --shutdown-with-message (one time) — it restarts in a few seconds.');
    } catch (e) {
        console.log('DEBUG: no se pudo revisar la config de pm2:', e.message);
    }
}
repararPm2();

const actualizador = require('./host-updater.js');
actualizador.instalarDependenciasPendientes();
require('./bot.js');
// Actualizaciones que publica Ale: se instalan solas cuando no hay ningun ⚡ corriendo (si tenia el
// turno, al volver lo recupera enseguida: el turno va por el nombre de la PC).
actualizador.iniciar({
    libre: () => !require('./community-host.js').esActivo() || !require('./fast-transfer.js').ocupado()
});
