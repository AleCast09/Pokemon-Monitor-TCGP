const rol = process.env.MONITOR_ROLE;

if (rol === 'bot') {
    require('./bot.js');
} else if (rol === 'trading') {
    require('./s4t.js');
} else if (rol === 'heartbeat') {
    require('./heartbeat.js');
} else if (rol === 'reconfigurar') {
    require('./reconfigurar.js');
} else if (rol === 'panel_info') {
    require('./scripts/panel-info.js');
} else if (rol === 'apply_update') {
    require('./scripts/apply-update.js');
} else {
    require('./launcher.js');
}
