// Rol "apply_update" (invocado desde el panel de control, boton "Download
// Now" del aviso de actualizacion) - hace lo mismo que el boton "Update now"
// de Discord, pero disparado desde afuera en vez de un click en el bot.
// Descarga el .exe/assets nuevos y deja la señal para que launcher.js haga
// el reemplazo real (ver el setInterval nuevo que revisa .pending_update.json
// en launcher.js).
const fs = require('fs');
const path = require('path');
const { obtenerVersionLocal, obtenerVersionRemota, esVersionMasNueva, descargarActualizacion, PENDING_UPDATE_PATH } = require('../update-checker.js');

async function main() {
    // Si ya hay una actualizacion descargada y esperando (ya sea porque se
    // disparo desde Discord o desde una llamada anterior del panel), no hace
    // falta bajarla de nuevo - evita dos descargas escribiendo el mismo
    // archivo al mismo tiempo si el usuario aprieta los dos botones seguidos.
    if (fs.existsSync(PENDING_UPDATE_PATH)) {
        process.stdout.write(JSON.stringify({ ok: true, yaEstaba: true }) + '\n');
        return;
    }
    try {
        const local = obtenerVersionLocal();
        const remota = await obtenerVersionRemota();
        if (!esVersionMasNueva(remota.version, local.version)) {
            process.stdout.write(JSON.stringify({ ok: true, yaActualizado: true }) + '\n');
            return;
        }
        await descargarActualizacion(remota);
        process.stdout.write(JSON.stringify({ ok: true, version: remota.version }) + '\n');
    } catch (e) {
        process.stdout.write(JSON.stringify({ ok: false, error: e?.message || String(e) }) + '\n');
    }
}

main();
