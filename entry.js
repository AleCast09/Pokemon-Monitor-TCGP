// Fix real 2026-07-30 (reporte de varios usuarios, confirmado sin antivirus de
// por medio: Windows 10 limpio, mismo error): Node intenta conectar por IPv6 y
// IPv4 en paralelo ("Happy Eyeballs") y si el IPv6 de esa PC no tiene ruta real
// (aunque el DNS SI devuelva un registro AAAA), termina en un AggregateError
// generico ("Received one or more errors") en cualquier pedido HTTPS -- entre
// ellos, el de "Check for Updates". Forzar IPv4 primero evita la carrera.
require('dns').setDefaultResultOrder('ipv4first');

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
