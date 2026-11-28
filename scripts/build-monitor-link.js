// Arma MonitorLink.exe (el programa que corre cada miembro de la comunidad en su PC) con el mismo
// metodo que build-exe.js: Node "single executable application" + postject. Monitor Link no tiene
// dependencias (solo modulos de Node), asi que entra tal cual, sin esbuild.
//
// Uso: node scripts/build-monitor-link.js   ->   dist-link/MonitorLink.exe
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const RAIZ = path.join(__dirname, '..');
const DIST = path.join(RAIZ, 'dist-link');
const EXE_PATH = path.join(DIST, 'MonitorLink.exe');

fs.mkdirSync(DIST, { recursive: true });
fs.copyFileSync(path.join(RAIZ, 'monitor-link', 'monitor-link.js'), path.join(DIST, 'monitor-link.js'));
fs.writeFileSync(path.join(DIST, 'sea-config.json'), JSON.stringify({
    main: 'monitor-link.js',
    output: 'sea-prep.blob',
    disableExperimentalSEAWarning: true
}, null, 2));
execSync('node --experimental-sea-config sea-config.json', { cwd: DIST, stdio: 'inherit' });

fs.copyFileSync(process.execPath, EXE_PATH);
const postjectBin = path.join(RAIZ, 'node_modules', '.bin', 'postject.cmd');
execSync(`"${postjectBin}" "${EXE_PATH}" NODE_SEA_BLOB "${path.join(DIST, 'sea-prep.blob')}" --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2`, { stdio: 'inherit' });

for (const f of ['sea-config.json', 'sea-prep.blob', 'monitor-link.js']) fs.rmSync(path.join(DIST, f), { force: true });
console.log(`✅ ${EXE_PATH} (${Math.round(fs.statSync(EXE_PATH).size / 1024 / 1024)} MB)`);
