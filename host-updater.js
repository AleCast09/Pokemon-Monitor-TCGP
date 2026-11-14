// Actualizacion automatica de los hosts de la comunidad (2026-10-24, pedido de Ale: "cuando haga un
// cambio, hago 1 cosa y todos se actualizan solos").
//
// Ale publica con scripts/publicar-host.js: sube el paquete a GitHub (pre-release, el bot publico no
// lo ve) y anota en Upstash (zenith:release) la version y el link. Cada host (host.js) revisa cada
// 2 min; si hay una version nueva la baja y la instala encima de esta carpeta, y se reinicia (PM2 lo
// vuelve a levantar). Nunca en medio de un ⚡: espera a que no haya ninguno corriendo.
// Su .env, su token y su base viven en otra carpeta (MonitorPokemonHost), asi que no se tocan.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const RAIZ = __dirname;
const ARCHIVO_VERSION = path.join(RAIZ, 'host-version.txt');
const MARCA_DEPENDENCIAS = path.join(RAIZ, '.reinstalar-dependencias');
// Cada 2 min (2026-10-25, pedido de Ale: no esperar media hora). Es un GET a Upstash: ~22k consultas al
// mes por host, dentro de la cuota gratis.
const CADA_MS = 2 * 60 * 1000;

const versionLocal = () => { try { return fs.readFileSync(ARCHIVO_VERSION, 'utf8').trim(); } catch (e) { return ''; } };
const huellaDependencias = () => {
    try { return crypto.createHash('sha1').update(fs.readFileSync(path.join(RAIZ, 'package-lock.json'))).digest('hex'); } catch (e) { return ''; }
};

async function leerRelease() {
    const r = await fetch(process.env.LINK_REDIS_URL.replace(/\/+$/, ''), {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.LINK_REDIS_TOKEN}` },
        body: JSON.stringify(['GET', 'zenith:release']),
        signal: AbortSignal.timeout(10000)
    });
    const j = await r.json();
    return j.result ? JSON.parse(j.result) : null;
}

async function instalar(release) {
    console.log(`⬇️ Host update ${release.version} — downloading…`);
    const r = await fetch(release.url, { signal: AbortSignal.timeout(10 * 60 * 1000) });
    if (!r.ok) throw new Error(`download ${r.status}`);
    const zip = path.join(os.tmpdir(), `monitor-host-${release.version}.zip`);
    fs.writeFileSync(zip, Buffer.from(await r.arrayBuffer()));
    const antes = huellaDependencias();
    if (process.platform === 'win32') {
        execFileSync('powershell', ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${zip}' -DestinationPath '${RAIZ}' -Force`], { windowsHide: true });
    } else if (process.platform === 'darwin') {
        // Mac (host de Arcade): ditto y no unzip. El unzip de macOS se traba con nombres con acento
        // (assets/element/Fósil_aleta_LPZA.png: "write error") y la actualizacion nunca se instalaba.
        execFileSync('ditto', ['-x', '-k', zip, RAIZ]);
    } else {
        execFileSync('unzip', ['-o', '-q', zip, '-d', RAIZ]);
    }
    fs.rmSync(zip, { force: true });
    fs.writeFileSync(ARCHIVO_VERSION, release.version);
    // Dependencias nuevas: se instalan al arrancar, antes de cargar el bot (con el bot andando, los
    // modulos nativos como sharp estan en uso y no se pueden reemplazar).
    if (huellaDependencias() !== antes) fs.writeFileSync(MARCA_DEPENDENCIAS, '1');
    console.log(`✅ Host updated to ${release.version} — restarting.`);
    process.exit(0);
}

// opciones.libre(): true si se puede reiniciar ahora (sin turno y sin ⚡ en curso).
function iniciar(opciones) {
    const revisar = async () => {
        try {
            const release = await leerRelease();
            if (!release?.version || !release.url || release.version === versionLocal()) return;
            if (!opciones.libre()) {
                console.log(`⏳ Host update ${release.version} available — waiting until this host is free.`);
                setTimeout(revisar, 2 * 60 * 1000);
                return;
            }
            await instalar(release);
        } catch (e) {
            console.error('⚠️ Host update check failed:', e?.message || e);
        }
    };
    setTimeout(revisar, 60 * 1000);
    setInterval(revisar, CADA_MS);
}

// Llamado por host.js ANTES de cargar el bot.
function instalarDependenciasPendientes() {
    if (!fs.existsSync(MARCA_DEPENDENCIAS)) return;
    console.log('📦 Installing updated components…');
    try {
        execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['install', '--omit=dev', '--no-audit', '--no-fund'], { cwd: RAIZ, stdio: 'inherit', shell: true });
        fs.rmSync(MARCA_DEPENDENCIAS, { force: true });
    } catch (e) {
        console.error('⚠️ Could not install the updated components:', e?.message || e);
    }
}

module.exports = { iniciar, instalarDependenciasPendientes, versionLocal };
