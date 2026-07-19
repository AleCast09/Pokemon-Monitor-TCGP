const fs = require('fs');
const path = require('path');
const { ejecutarWizard } = require('./setup-wizard.js');

const LOCK_PATH = path.join(__dirname, '.reconfigurar.lock');

function procesoExiste(pid) {
    try {
        process.kill(pid, 0);
        return true;
    } catch (e) {
        return false;
    }
}

function yaHayUnaCopiaAbierta() {
    if (!fs.existsSync(LOCK_PATH)) return false;
    const pidGuardado = parseInt(fs.readFileSync(LOCK_PATH, 'utf8').trim(), 10);
    if (!pidGuardado || !procesoExiste(pidGuardado)) return false;
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

    try { fs.unlinkSync(LOCK_PATH); } catch (e) {}
    process.exit(0);
}

main();
