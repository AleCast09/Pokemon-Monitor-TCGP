const fs = require('fs');
const path = require('path');
const { ejecutarWizard } = require('./setup-wizard.js');

const LOCK_PATH = path.join(__dirname, '.reconfigurar.lock');
const PENDING_RESTART_PATH = path.join(__dirname, '.pending_restart.json');

function procesoExiste(pid) {
    try {
        process.kill(pid, 0);
        return true;
    } catch (e) {
        return false;
    }
}

const LOCK_MAX_EDAD_MS = 10 * 60 * 1000;

function yaHayUnaCopiaAbierta() {
    if (!fs.existsSync(LOCK_PATH)) return false;
    const pidGuardado = parseInt(fs.readFileSync(LOCK_PATH, 'utf8').trim(), 10);
    if (!pidGuardado || !procesoExiste(pidGuardado)) return false;
    // Si el usuario cierra la pestaña del navegador SIN apretar "Save and
    // continue", ejecutarWizard() se queda esperando para siempre (solo
    // resuelve cuando llega el POST de guardar) — el proceso viejo nunca
    // llega a borrar este lock, y sin este chequeo de antigüedad, todos los
    // próximos clics en "Reconfigurar" se negarían a abrir nada, sin avisar
    // nada, para siempre. Pasados 10 minutos se considera abandonado: se
    // mata el proceso zombie y se deja abrir uno nuevo.
    const antiguedadMs = Date.now() - fs.statSync(LOCK_PATH).mtimeMs;
    if (antiguedadMs > LOCK_MAX_EDAD_MS) {
        try { process.kill(pidGuardado); } catch (e) {}
        return false;
    }
    return true;
}

async function main() {
    if (yaHayUnaCopiaAbierta()) {
        // Ya hay una ventana de configuración abierta — no se abre otra.
        process.exit(0);
        return;
    }
    fs.writeFileSync(LOCK_PATH, String(process.pid));

    await ejecutarWizard();

    // Le avisa al launcher (proceso aparte, ya corriendo) que tiene que
    // reiniciar bot/trading/heartbeat para que tomen el .env recién guardado
    // — si no, siguen con los valores viejos hasta el próximo reinicio manual
    // (ej. el toggle de HD no se aplicaba hasta cerrar y volver a abrir todo).
    try { fs.writeFileSync(PENDING_RESTART_PATH, JSON.stringify({ en: Date.now() })); } catch (e) {}

    try { fs.unlinkSync(LOCK_PATH); } catch (e) {}
    process.exit(0);
}

main();
