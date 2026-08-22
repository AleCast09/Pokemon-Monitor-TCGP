// Rol "notify_repair_done" (2026-08-22, a pedido explicito del usuario): "Repair Broken
// Files" (boton del Panel, ver RepararArchivosRotos en ControlPanel.cs) hace su PROPIA
// descarga directa en C# (WebClient), sin pasar por descargarActualizacion() de
// update-checker.js -- por eso nunca disparaba el aviso de "Sync Channels + re-guardar Main
// Path" que ese sí manda (ver avisarPasosManualesTrasDescarga). En vez de reimplementar el
// posteo a Discord en C# (necesitaria acceso a la DB SQLite ahi tambien), el Panel simplemente
// invoca este rol chico despues de terminar su propia descarga -- reusa la misma logica de
// siempre sin duplicar nada.
const fs = require('fs');
const { obtenerVersionLocal, avisarPasosManualesTrasDescarga } = require('../update-checker.js');

async function main() {
    try {
        const local = obtenerVersionLocal();
        await avisarPasosManualesTrasDescarga(local);
        process.stdout.write(JSON.stringify({ ok: true }));
    } catch (e) {
        process.stdout.write(JSON.stringify({ ok: false, error: e?.message || String(e) }));
    }
}

main();
