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
    fs.copyFileSync(path.join(RAIZ, 'version.json'), path.join(DIST, 'version.json'));
}

function copiarLanzador() {
    fs.copyFileSync(
        path.join(RAIZ, 'Iniciar Monitor Pokemon.bat'),
        path.join(DIST, 'Iniciar Monitor Pokemon.bat')
    );
    fs.copyFileSync(
        path.join(RAIZ, 'Desbloquear.bat'),
        path.join(DIST, 'Desbloquear.bat')
    );
    fs.copyFileSync(
        path.join(RAIZ, 'Configurar de nuevo.bat'),
        path.join(DIST, 'Configurar de nuevo.bat')
    );
    fs.copyFileSync(
        path.join(RAIZ, 'LEEME.txt'),
        path.join(DIST, 'LEEME.txt')
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

    fs.rmSync(seaConfigPath, { force: true });
    fs.rmSync(path.join(DIST, 'sea-prep.blob'), { force: true });
}

function generarZip() {
    // Compress-Archive de PowerShell no incluye archivos con el atributo "oculto"
    // (los deja afuera en silencio) — por eso se arma el zip entrada por entrada
    // con la clase de .NET. También se excluye logs/ (no debe distribuirse, y si
    // el .exe está corriendo en dist/ el archivo de log queda bloqueado).
    const zipPath = path.join(RAIZ, 'MonitorPokemon.zip');
    if (fs.existsSync(zipPath)) fs.rmSync(zipPath);
    const script = [
        `Add-Type -AssemblyName System.IO.Compression.FileSystem`,
        `$zip = [System.IO.Compression.ZipFile]::Open('${zipPath}', 'Create')`,
        `Get-ChildItem -Path '${DIST}' -Force -Recurse | Where-Object { -not $_.PSIsContainer -and $_.FullName -notlike '*\\logs\\*' } | ForEach-Object {`,
        `    $relativePath = $_.FullName.Substring((Resolve-Path '${DIST}').Path.Length + 1)`,
        `    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $_.FullName, $relativePath, [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null`,
        `}`,
        `$zip.Dispose()`
    ].join('; ');
    execSync(`powershell -Command "${script}"`);
    return zipPath;
}

async function main() {
    console.log('📦 Empaquetando Monitor Pokémon...');
    console.log('');
    console.log('1/5 — Compilando bundle con esbuild...');
    await bundlear();

    console.log('2/5 — Copiando dependencias nativas (sharp)...');
    copiarDependenciaNativa('sharp');
    copiarDependenciaNativa('@img/colour');
    copiarDependenciaNativa('@img/sharp-win32-x64');
    copiarDependenciaNativa('detect-libc');
    copiarDependenciaNativa('semver');

    console.log('3/5 — Copiando assets y lanzador...');
    copiarAssets();
    copiarLanzador();

    console.log('4/5 — Generando el ejecutable...');
    empaquetarSea();

    console.log('5/5 — Generando el .zip de distribución...');
    // Todo queda visible siempre (ni en el zip ni después de abrirlo se oculta
    // nada) — ocultar archivos generaba confusión real: con "mostrar ocultos"
    // apagado (la config por defecto de Windows), parecía que el programa había
    // borrado sus propios archivos.
    const zipPath = generarZip();

    console.log('');
    console.log('✅ Listo:', EXE_PATH);
    console.log('✅ Zip:', zipPath);
}

main().catch(err => {
    console.error('❌ Error empaquetando:', err);
    process.exit(1);
});
