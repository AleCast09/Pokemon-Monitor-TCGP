// Publica una actualizacion para los hosts de la comunidad y para Monitor Link.ahk (2026-10-24).
// Uso (en la PC de Ale, con los cambios ya guardados en git):
//   node scripts/publicar-host.js
//
// 1. Arma el paquete del host (git archive del commit actual + host-version.txt).
// 2. Lo sube a GitHub como pre-release (--latest=false: el bot publico sigue viendo su ultima version).
// 3. Anota en Upstash (zenith:release) la version y los links. Los hosts se actualizan solos en
//    <= 30 min, y cada Monitor Link.ahk en su proximo ping.
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const RAIZ = path.join(__dirname, '..');
require('dotenv').config({ path: path.join(RAIZ, '.env'), quiet: true });

const repo = execFileSync('gh', ['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner'], { cwd: RAIZ }).toString().trim();
const fecha = new Date();
const dos = (n) => String(n).padStart(2, '0');
const version = `${fecha.getFullYear()}.${dos(fecha.getMonth() + 1)}.${dos(fecha.getDate())}-${dos(fecha.getHours())}${dos(fecha.getMinutes())}`;
const tag = `host-${version}`;

if (execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: RAIZ }).toString().trim()) {
    console.error('❌ There are unsaved changes in git — commit them first, so every host gets exactly this version.');
    process.exit(1);
}

const dist = path.join(RAIZ, 'dist-host');
fs.mkdirSync(dist, { recursive: true });
const zip = path.join(dist, 'MonitorPokemon-Host.zip');
fs.rmSync(zip, { force: true });
execFileSync('git', ['archive', '--format=zip', `--add-virtual-file=host-version.txt:${version}`, '-o', zip, 'HEAD'], { cwd: RAIZ });
const ahk = path.join(dist, 'MonitorLink.ahk');
fs.copyFileSync(path.join(RAIZ, 'monitor-link', 'Monitor Link.ahk'), ahk);
const versionAhk = /global VERSION := "([^"]+)"/.exec(fs.readFileSync(ahk, 'utf8'))?.[1];

console.log(`📦 Publishing ${tag} (Monitor Link ${versionAhk})…`);
execFileSync('gh', ['release', 'create', tag, zip, ahk, '--prerelease', '--latest=false', '--target', 'main',
    '--title', `Community host ${version}`, '--notes', 'Automatic update for the Zenith Rise hosts and Monitor Link. Not an update for Monitor Pokemon.'],
{ cwd: RAIZ, stdio: 'inherit' });

// Link fijo para el canal de bienvenida: el release "monitor-link" siempre tiene el ultimo
// MonitorLink.ahk (se reemplaza en cada publicacion), asi ese link nunca queda viejo.
const TAG_FIJO = 'monitor-link';
try {
    execFileSync('gh', ['release', 'view', TAG_FIJO], { cwd: RAIZ, stdio: 'ignore' });
} catch (e) {
    execFileSync('gh', ['release', 'create', TAG_FIJO, '--prerelease', '--latest=false', '--target', 'main',
        '--title', 'Monitor Link (always the latest)', '--notes', 'MonitorLink.ahk for Zenith Rise members. This file is replaced with every update.'],
    { cwd: RAIZ, stdio: 'inherit' });
}
execFileSync('gh', ['release', 'upload', TAG_FIJO, ahk, '--clobber'], { cwd: RAIZ, stdio: 'inherit' });

const base = `https://github.com/${repo}/releases/download/${tag}`;
// commit: el host de Ale corre del repo (su version es el commit corto) y lo compara con este.
const commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: RAIZ }).toString().trim();
const release = { version, commit, url: `${base}/MonitorPokemon-Host.zip`, ahk: { version: versionAhk, url: `${base}/MonitorLink.ahk`,
    fija: `https://github.com/${repo}/releases/download/${TAG_FIJO}/MonitorLink.ahk` } };
(async () => {
    const r = await fetch(process.env.LINK_REDIS_URL, {
        method: 'POST', headers: { Authorization: `Bearer ${process.env.LINK_REDIS_TOKEN}` },
        body: JSON.stringify(['SET', 'zenith:release', JSON.stringify(release)])
    });
    if (!r.ok) throw new Error(`Upstash ${r.status}`);
    console.log(`✅ Published. Hosts update within 2 min; Monitor Link within a minute.`);
    console.log(`   Monitor Link download (fixed link): ${release.ahk.fija}`);
})().catch(e => { console.error('❌', e.message); process.exit(1); });
