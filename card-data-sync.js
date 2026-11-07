// Datos de cartas para los hosts (2026-11-06, pedido de Ale): cada host lee las cartas de la carpeta
// Helper de SU bot de Kevin/Leanny (cardmap.json, cardmaster.json, en_US.json). Si esos archivos estan
// viejos, las cartas de un set nuevo salen "Expansion: Unknown" y no se pueden compartir (le paso a
// Isaac con C1 en el host de Arcade). La actualizacion de los hosts trae los de Ale en card-data/ y,
// al arrancar, se copian a la carpeta Helper solo si traen MAS cartas que los del host (nunca se baja
// de version; el anterior queda como .bak-monitor).
const fs = require('fs');
const path = require('path');

const ARCHIVOS = ['cardmap.json', 'cardmaster.json', 'en_US.json'];
const ORIGEN = path.join(__dirname, 'card-data');

function cantidad(ruta) {
    try {
        const j = JSON.parse(fs.readFileSync(ruta, 'utf8'));
        return Array.isArray(j) ? j.length : Object.keys(j || {}).length;
    } catch (e) {
        return -1; // no existe o esta roto: cualquier copia buena es mejor
    }
}

// rutaMaster: la carpeta Helper configurada en el bot. Devuelve los archivos actualizados.
function sincronizarDatosCartas(rutaMaster) {
    const cambiados = [];
    if (!rutaMaster || !fs.existsSync(ORIGEN)) return cambiados;
    // Sin la carpeta (borrada, o un host sin el bot de Kevin): se crea y se llena.
    try { fs.mkdirSync(rutaMaster, { recursive: true }); } catch (e) { return cambiados; }
    for (const nombre of ARCHIVOS) {
        const desde = path.join(ORIGEN, nombre);
        const hacia = path.join(rutaMaster, nombre);
        const nuevos = cantidad(desde);
        if (nuevos <= 0) continue;
        const actuales = cantidad(hacia);
        if (nuevos <= actuales) continue;
        try {
            if (fs.existsSync(hacia)) fs.copyFileSync(hacia, `${hacia}.bak-monitor`);
            fs.copyFileSync(desde, hacia);
            cambiados.push(`${nombre} (${actuales < 0 ? 0 : actuales} -> ${nuevos})`);
        } catch (e) {
            console.error(`DEBUG: no se pudo actualizar ${nombre} en ${rutaMaster}:`, e?.message || e);
        }
    }
    if (cambiados.length) console.log(`🃏 Card data updated in ${rutaMaster}: ${cambiados.join(', ')}`);
    return cambiados;
}

module.exports = { sincronizarDatosCartas };
