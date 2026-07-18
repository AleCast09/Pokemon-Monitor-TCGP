const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const RAIZ = path.join(__dirname, '..');
const DIST = path.join(RAIZ, 'dist');
const BUNDLE_PATH = path.join(DIST, 'bundle.js');
const EXE_PATH = path.join(DIST, 'MonitorPokemon.exe');

const BANNER = `
global.__baseDir = (() => {
    const path = require('path');
    let esSea = false;
    try { esSea = require('node:sea').isSea(); } catch (e) {}
    if (esSea) return path.dirname(process.execPath);
    return path.dirname(require.main.filename);
})();
`;

async function bundlear() {
    fs.rmSync(DIST, { recursive: true, force: true });
    fs.mkdirSync(DIST, { recursive: true });

    await esbuild.build({
        entryPoints: [path.join(RAIZ, 'entry.js')],
        bundle: true,
        platform: 'node',
        target: 'node22',
        format: 'cjs',
        outfile: BUNDLE_PATH,
        external: ['node:sqlite', 'node:sea', 'readline/promises'],
        define: { '__dirname': 'global.__baseDir' },
        banner: { js: BANNER },
        logLevel: 'info'
    });
}

function copiarDependenciaNativa(nombre) {
    const origen = path.join(RAIZ, 'node_modules', nombre);
    const destino = path.join(DIST, 'node_modules', nombre);
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    fs.cpSync(origen, destino, { recursive: true });
}

function copiarAssets() {
    fs.cpSync(path.join(RAIZ, 'assets'), path.join(DIST, 'assets'), {
        recursive: true,
        filter: (origen) => !origen.includes(`${path.sep}drive_cache`) && !origen.endsWith('drive_folder_map.json')
    });
    if (fs.existsSync(path.join(RAIZ, 'cardmap.json'))) {
        fs.cpSync(path.join(RAIZ, 'cardmap.json'), path.join(DIST, 'cardmap.json'));
    }
}

function copiarLanzador() {
    fs.copyFileSync(
        path.join(RAIZ, 'Iniciar Monitor Pokemon.vbs'),
        path.join(DIST, 'Iniciar Monitor Pokemon.vbs')
    );
}

function empaquetarSea() {
    const seaConfigPath = path.join(DIST, 'sea-config.json');
    fs.writeFileSync(seaConfigPath, JSON.stringify({
        main: 'bundle.js',
        output: 'sea-prep.blob',
        disableExperimentalSEAWarning: true
    }, null, 2));

    execSync(`node --experimental-sea-config sea-config.json`, { cwd: DIST, stdio: 'inherit' });

    const nodeBin = process.execPath;
    fs.copyFileSync(nodeBin, EXE_PATH);

    const postjectBin = path.join(RAIZ, 'node_modules', '.bin', 'postject.cmd');
    execSync(`"${postjectBin}" "${EXE_PATH}" NODE_SEA_BLOB "${path.join(DIST, 'sea-prep.blob')}" --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2`, { stdio: 'inherit' });
}

async function main() {
    console.log('📦 Empaquetando Monitor Pokémon...');
    console.log('');
    console.log('1/4 — Compilando bundle con esbuild...');
    await bundlear();

    console.log('2/4 — Copiando dependencias nativas (sharp)...');
    copiarDependenciaNativa('sharp');
    copiarDependenciaNativa('@img/colour');
    copiarDependenciaNativa('@img/sharp-win32-x64');
    copiarDependenciaNativa('detect-libc');
    copiarDependenciaNativa('semver');

    console.log('3/4 — Copiando assets y lanzador...');
    copiarAssets();
    copiarLanzador();

    console.log('4/4 — Generando el ejecutable...');
    empaquetarSea();

    console.log('');
    console.log('✅ Listo:', EXE_PATH);
}

main().catch(err => {
    console.error('❌ Error empaquetando:', err);
    process.exit(1);
});
