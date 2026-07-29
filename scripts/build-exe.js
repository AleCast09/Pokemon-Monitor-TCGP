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

function vaciarCarpeta(carpeta) {
    // Se vacía el contenido en vez de borrar la carpeta en sí: si algún proceso
    // (terminal, Explorer) tiene "dist" como directorio actual, Windows no deja
    // borrar la carpeta pero sí borrar lo que hay adentro.
    if (!fs.existsSync(carpeta)) return;
    for (const nombre of fs.readdirSync(carpeta)) {
        fs.rmSync(path.join(carpeta, nombre), { recursive: true, force: true });
    }
}

async function bundlear() {
    vaciarCarpeta(DIST);
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

    // automation/ (scripts propios de AHK para el panel de MuMu: inyeccion de cuenta,
    // trade, shinedust) nunca se copiaba al paquete -- no se notaba porque en esta PC
    // el bot corre directo desde el codigo fuente (PM2), nunca desde el .exe empaquetado.
    const automationDir = path.join(RAIZ, 'automation');
    if (fs.existsSync(automationDir)) {
        fs.cpSync(automationDir, path.join(DIST, 'automation'), {
            recursive: true,
            filter: (origen) => !origen.includes(`${path.sep}Logs${path.sep}`) && !origen.endsWith(`${path.sep}Logs`)
        });
    }
}

function copiarLanzador() {
    // Estos 4 quedan en una subcarpeta "Advanced" — ya no hace falta que el
    // usuario los toque directo (el panel de control ya cubre Iniciar/
    // Apagar/Reiniciar/Reconfigurar), pero siguen siendo lo que el panel usa
    // por dentro para esas acciones. Se dejan visibles (nunca ocultos: ya se
    // probó ocultarlos antes y generaba la sospecha de que el programa se
    // había borrado archivos a sí mismo), solo organizados aparte.
    fs.mkdirSync(path.join(DIST, 'Advanced'), { recursive: true });
    fs.copyFileSync(
        path.join(RAIZ, 'Advanced', 'Start Monitor Pokemon.bat'),
        path.join(DIST, 'Advanced', 'Start Monitor Pokemon.bat')
    );
    fs.copyFileSync(
        path.join(RAIZ, 'Advanced', 'Unblock.bat'),
        path.join(DIST, 'Advanced', 'Unblock.bat')
    );
    fs.copyFileSync(
        path.join(RAIZ, 'Advanced', 'Reconfigure.bat'),
        path.join(DIST, 'Advanced', 'Reconfigure.bat')
    );
    fs.copyFileSync(
        path.join(RAIZ, 'Advanced', 'Quit Monitor Pokemon.bat'),
        path.join(DIST, 'Advanced', 'Quit Monitor Pokemon.bat')
    );
    fs.copyFileSync(
        path.join(RAIZ, 'Open Control Panel.bat'),
        path.join(DIST, 'Open Control Panel.bat')
    );
    fs.copyFileSync(
        path.join(RAIZ, 'README.txt'),
        path.join(DIST, 'README.txt')
    );
    // tray.ps1 (icono de bandeja) y ahk-window.ps1 (cierre puntual de
    // instancias AHK) son PowerShell — esbuild no los puede empaquetar
    // dentro del bundle de Node, así que se copian sueltos tal cual, en las
    // mismas rutas relativas que el código ya espera. El panel de control en
    // sí YA NO es PowerShell (ver compilarPanelControl) — así Windows lo
    // identifica como su propia app en la barra de tareas, no como
    // "Windows PowerShell" ejecutando un script.
    fs.copyFileSync(
        path.join(RAIZ, 'tray.ps1'),
        path.join(DIST, 'tray.ps1')
    );
    fs.mkdirSync(path.join(DIST, 'scripts'), { recursive: true });
    fs.copyFileSync(
        path.join(RAIZ, 'scripts', 'ahk-window.ps1'),
        path.join(DIST, 'scripts', 'ahk-window.ps1')
    );

    // Copia suelta en la raiz del paquete (a pedido del usuario) - asi quien
    // recien descarga el .zip lo ve de una, sin tener que abrir el bot y
    // buscar el boton de Tutorial en Discord primero.
    const rutaTutorialSetup = path.join(RAIZ, 'assets', 'tutoriales', 'cmd_setup.pdf');
    if (fs.existsSync(rutaTutorialSetup)) {
        fs.copyFileSync(rutaTutorialSetup, path.join(DIST, 'TUTORIAL MONITOR POKEMON.pdf'));
    }
}

// El panel de control se compila con el compilador de C# que ya trae
// Windows (Framework64\v4.0.30319\csc.exe, sin instalar nada extra) en vez
// de correr como script de PowerShell — así queda como su propio .exe, con
// su propio ícono/nombre en la barra de tareas.
function compilarPanelControl() {
    const cscPath = 'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe';
    if (!fs.existsSync(cscPath)) {
        console.log('⚠️ No se encontró csc.exe — se omite compilar el panel de control.');
        return;
    }
    const salida = path.join(DIST, 'MonitorPokemonPanel.exe');
    const icono = path.join(RAIZ, 'assets', 'tray_icon.ico');
    const fuente = path.join(RAIZ, 'scripts', 'ControlPanel.cs');
    execSync(
        `"${cscPath}" /nologo /target:winexe /out:"${salida}" /win32icon:"${icono}" ` +
        `/reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.Web.Extensions.dll "${fuente}"`,
        { stdio: 'inherit' }
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

function generarAssetsZip() {
    // Zip aparte, solo con la carpeta assets/ — el auto-update lo descarga y
    // descomprime encima de la carpeta local además de reemplazar el .exe, así
    // los usuarios que ya tienen el programa instalado también reciben archivos
    // nuevos (emojis, logos, etc.) sin tener que volver a bajar el zip completo.
    const zipPath = path.join(RAIZ, 'MonitorPokemon-assets.zip');
    if (fs.existsSync(zipPath)) fs.rmSync(zipPath);
    const assetsDir = path.join(DIST, 'assets');
    const script = [
        `Add-Type -AssemblyName System.IO.Compression.FileSystem`,
        `$zip = [System.IO.Compression.ZipFile]::Open('${zipPath}', 'Create')`,
        `Get-ChildItem -Path '${assetsDir}' -Force -Recurse | Where-Object { -not $_.PSIsContainer } | ForEach-Object {`,
        `    $relativePath = $_.FullName.Substring((Resolve-Path '${assetsDir}').Path.Length + 1)`,
        `    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $_.FullName, ('assets\\' + $relativePath), [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null`,
        `}`,
        `$zip.Dispose()`
    ].join('; ');
    execSync(`powershell -Command "${script}"`);
    return zipPath;
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
    console.log('1/6 — Compilando bundle con esbuild...');
    await bundlear();

    console.log('2/6 — Copiando dependencias nativas (sharp)...');
    copiarDependenciaNativa('sharp');
    copiarDependenciaNativa('@img/colour');
    copiarDependenciaNativa('@img/sharp-win32-x64');
    copiarDependenciaNativa('detect-libc');
    copiarDependenciaNativa('semver');

    console.log('3/6 — Copiando assets y lanzador...');
    copiarAssets();
    copiarLanzador();

    console.log('4/6 — Generando el ejecutable...');
    empaquetarSea();

    console.log('5/6 — Compilando el panel de control...');
    compilarPanelControl();

    console.log('6/6 — Generando los .zip de distribución...');
    // Todo queda visible siempre (ni en el zip ni después de abrirlo se oculta
    // nada) — ocultar archivos generaba confusión real: con "mostrar ocultos"
    // apagado (la config por defecto de Windows), parecía que el programa había
    // borrado sus propios archivos.
    const zipPath = generarZip();
    const assetsZipPath = generarAssetsZip();

    console.log('');
    console.log('✅ Listo:', EXE_PATH);
    console.log('✅ Zip:', zipPath);
    console.log('✅ Assets zip:', assetsZipPath);
}

main().catch(err => {
    console.error('❌ Error empaquetando:', err);
    process.exit(1);
});
