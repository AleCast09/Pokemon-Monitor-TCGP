require('dotenv').config();
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
const headers = GITHUB_TOKEN ? { Authorization: `token ${GITHUB_TOKEN}` } : {};

const ASSETS_DIR = path.join(__dirname, '..', 'assets');
const EXPANSIONS_DIR = path.join(ASSETS_DIR, 'expansions');

const REPO_ASSETS = '1niceroli/ptcg-assets';

// Nombres de respaldo para carpetas que el README del repo todavía no documenta.
const NOMBRES_RESPALDO = {
    tcgpb3: 'Pulsing Aura'
};

function sanitizarNombre(nombre) {
    return nombre.replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').trim();
}

async function descargarSiFalta(url, destino) {
    if (fs.existsSync(destino)) return false;
    const resp = await axios.get(url, { responseType: 'arraybuffer' });
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    fs.writeFileSync(destino, resp.data);
    return true;
}

async function listarContenido(repo, ruta = '') {
    const url = `https://api.github.com/repos/${repo}/contents/${ruta}`;
    const resp = await axios.get(url, { headers });
    return resp.data;
}

async function obtenerMapaNombres() {
    const url = `https://raw.githubusercontent.com/${REPO_ASSETS}/main/README.md`;
    const resp = await axios.get(url);
    const mapa = { ...NOMBRES_RESPALDO };
    const filas = resp.data.matchAll(/\|\s*(tcgp[a-z0-9]*)\s*\|\s*[a-z]{2}\s*\|\s*([^|]+?)\s*\|\s*Trading Card Game Pocket\s*\|/gi);
    for (const fila of filas) {
        const [, codigo, nombre] = fila;
        mapa[codigo] = nombre.trim();
    }
    return mapa;
}

async function sincronizarExpansiones() {
    const [raiz, mapaNombres] = await Promise.all([listarContenido(REPO_ASSETS), obtenerMapaNombres()]);
    const carpetasTcgp = raiz.filter(item => item.type === 'dir' && item.name.startsWith('tcgp'));

    let descargados = 0;
    for (const carpeta of carpetasTcgp) {
        const nombreCarpeta = sanitizarNombre(mapaNombres[carpeta.name] || carpeta.name);

        // Si la carpeta quedó creada antes con el código crudo (ej. "tcgpb12") y ahora
        // ya sabemos el nombre real de la expansión, la renombramos automáticamente.
        const rutaConCodigo = path.join(EXPANSIONS_DIR, carpeta.name);
        const rutaConNombre = path.join(EXPANSIONS_DIR, nombreCarpeta);
        if (nombreCarpeta !== carpeta.name && fs.existsSync(rutaConCodigo) && !fs.existsSync(rutaConNombre)) {
            fs.renameSync(rutaConCodigo, rutaConNombre);
            console.log(`📁 Renombrada carpeta "${carpeta.name}" -> "${nombreCarpeta}"`);
        }

        const contenido = await listarContenido(REPO_ASSETS, carpeta.name);

        for (const item of contenido) {
            if (item.type === 'file' && /\.(png|jpe?g|webp)$/i.test(item.name)) {
                // El logo se guarda con el nombre de la expansión en vez de "logo.png",
                // para que sea legible de un vistazo. El resto de archivos mantiene su nombre.
                const ext = path.extname(item.name);
                const nombreArchivo = /^logo\./i.test(item.name) ? `${nombreCarpeta}${ext}` : item.name;
                const destino = path.join(EXPANSIONS_DIR, nombreCarpeta, nombreArchivo);
                if (await descargarSiFalta(item.download_url, destino)) {
                    descargados++;
                    console.log(`✅ ${nombreCarpeta}/${nombreArchivo}`);
                }
            } else if (item.type === 'dir' && item.name === 'packshots') {
                const packshots = await listarContenido(REPO_ASSETS, `${carpeta.name}/packshots`);
                for (const pack of packshots) {
                    if (pack.type === 'file') {
                        const destino = path.join(EXPANSIONS_DIR, nombreCarpeta, 'packshots', pack.name);
                        if (await descargarSiFalta(pack.download_url, destino)) {
                            descargados++;
                            console.log(`✅ ${nombreCarpeta}/packshots/${pack.name}`);
                        }
                    }
                }
            }
        }
    }
    return descargados;
}

async function main() {
    console.log('🔄 Sincronizando logos, símbolos y sobres de expansiones...');
    const nuevosAssets = await sincronizarExpansiones();
    console.log(`📦 ${nuevosAssets} archivo(s) nuevo(s) de expansiones descargados.\n`);

    console.log('✅ Sincronización completa. Los archivos que ya existían en assets/ no se tocaron.');
}

main().catch(err => {
    console.error('❌ Error sincronizando assets:', err.message);
    process.exit(1);
});
