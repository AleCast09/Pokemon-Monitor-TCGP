// Actualiza TODO lo de una expansion nueva con un solo comando (2026-10-30, pedido de Ale):
//   node scripts/actualizar-expansion.js            -> hace todo y pregunta antes de subir al repo de imagenes
//   node scripts/actualizar-expansion.js --simular  -> solo muestra lo que haria, no cambia nada
//   node scripts/actualizar-expansion.js --si       -> sube al repo de imagenes sin preguntar
//
// 1. Datos de cartas (cardmaster/cardmap/en_US) de Leanny -> carpeta Helper (con copia de los viejos).
// 2. Imagenes de cartas que falten -> Helper\CardImageCache.
// 3. Nombres de expansion nuevos -> assets/expansion_names.json.
// 4. Sobres nuevos -> catalogo del motor de Miguel (pack_catalog.py + pack.json), product_id deducido.
// 5. Logo y arte de sobres desde Descargas\<CODIGO>\ (logo.png + una imagen por sobre).
// 6. Imagenes nuevas -> repo AleCast09/Pokemon-TCGP-Card-Image (respaldo de los otros hosts).
// Al final dice que falta a mano (logos/sobres que no estan, serie nueva, set Deluxe).
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
const { execFileSync } = require('child_process');
const axios = require('axios');
const sharp = require('sharp');

const RAIZ = path.join(__dirname, '..');
const SIMULAR = process.argv.includes('--simular');
const SIN_PREGUNTAR = process.argv.includes('--si');
const LEANNY = 'https://leanny.github.io/pocket_tcg_resources';
const MOTOR = 'C:\\Users\\Ale TCG\\Desktop\\ptcgp-capturedeluxe';
const REPO_IMAGENES = 'AleCast09/Pokemon-TCGP-Card-Image';
const DESCARGAS = path.join(os.homedir(), 'Downloads');
const EXPANSIONS_DIR = path.join(RAIZ, 'assets', 'expansions');
const ARCHIVOS_DATOS = ['cardmaster.json', 'cardmap.json', 'en_US.json'];

const leerJson = (ruta) => JSON.parse(fs.readFileSync(ruta, 'utf8').replace(/^\uFEFF/, ''));
const normalizar = (t) => String(t).toLowerCase().replace(/[^a-z0-9]/g, '');
const nombreArchivoSeguro = (t) => String(t).replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').trim();
const pendientes = [];

// Carpeta Helper: la "Data Master Path" del bot (database.db), o la de siempre.
function carpetaHelper() {
    try {
        const { DatabaseSync } = require('node:sqlite');
        const db = new DatabaseSync(path.join(RAIZ, 'database.db'), { readOnly: true });
        const fila = db.prepare(`SELECT webhook_url FROM configs_canales WHERE tipo = 'ruta_master'`).get();
        db.close();
        if (fila?.webhook_url && fs.existsSync(path.join(fila.webhook_url, 'cardmaster.json'))) return fila.webhook_url;
    } catch (e) { /* sin base: la ruta de siempre */ }
    return 'C:\\POKEMON\\PTCGPB-ALE\\Helper';
}

// Nombre de cada expansion: EXPANSION_NAME_n (codigo) + EXPANSION_NAME_LONG_n (nombre).
function nombresExpansion(en) {
    const mapa = {};
    for (const k of Object.keys(en)) {
        const m = k.match(/^EXPANSION_NAME_(\d+)$/);
        if (m && en[`EXPANSION_NAME_LONG_${m[1]}`]) mapa[en[k]] = en[`EXPANSION_NAME_LONG_${m[1]}`];
    }
    return mapa;
}

async function paso1Datos(helper) {
    console.log('\n1) Datos de cartas (Leanny)');
    const nuevos = {};
    for (const n of ARCHIVOS_DATOS) {
        const r = await axios.get(`${LEANNY}/data/${n}`, { responseType: 'text', timeout: 60000, transformResponse: x => x });
        nuevos[n] = { texto: r.data, json: JSON.parse(String(r.data).replace(/^\uFEFF/, '')) };
    }
    const viejoMap = fs.existsSync(path.join(helper, 'cardmap.json')) ? leerJson(path.join(helper, 'cardmap.json')) : {};
    const setsViejos = new Set(Object.values(viejoMap).map(v => v.ExpansionID));
    const conteo = {};
    for (const v of Object.values(nuevos['cardmap.json'].json)) conteo[v.ExpansionID] = (conteo[v.ExpansionID] || 0) + 1;
    const setsNuevos = Object.keys(conteo).filter(s => !setsViejos.has(s));
    const cambio = ARCHIVOS_DATOS.some(n => !fs.existsSync(path.join(helper, n)) || fs.readFileSync(path.join(helper, n), 'utf8') !== nuevos[n].texto);
    if (!cambio) console.log('   Ya estaban al dia.');
    else {
        console.log(`   Sets nuevos: ${setsNuevos.length ? setsNuevos.map(s => `${s} (${conteo[s]} cartas)`).join(', ') : 'ninguno (solo cambios en sets que ya habia)'}`);
        if (!SIMULAR) {
            const copia = path.join(helper, `backup-${new Date().toISOString().slice(0, 10)}`);
            fs.mkdirSync(copia, { recursive: true });
            for (const n of ARCHIVOS_DATOS) {
                if (fs.existsSync(path.join(helper, n))) fs.copyFileSync(path.join(helper, n), path.join(copia, n));
                fs.writeFileSync(path.join(helper, n), nuevos[n].texto);
            }
            console.log(`   Actualizados (copia de los viejos en ${copia}).`);
        }
    }
    return { cardmap: nuevos['cardmap.json'].json, en: nuevos['en_US.json'].json, setsNuevos };
}

async function paso2Imagenes(helper, cardmap) {
    console.log('\n2) Imagenes de cartas');
    const dir = path.join(helper, 'CardImageCache');
    const faltan = [...new Set(Object.values(cardmap).map(v => v.IllustrationID).filter(Boolean))]
        .filter(id => !fs.existsSync(path.join(dir, `${id}.png`)));
    console.log(`   Faltan ${faltan.length}.`);
    const bajadas = [], fallidas = [];
    if (SIMULAR || !faltan.length) return bajadas;
    fs.mkdirSync(dir, { recursive: true });
    let i = 0;
    const trabajador = async () => {
        while (i < faltan.length) {
            const id = faltan[i++];
            try {
                const r = await axios.get(`${LEANNY}/img/M/US/${id}.png`, { responseType: 'arraybuffer', timeout: 30000 });
                fs.writeFileSync(path.join(dir, `${id}.png`), r.data);
                bajadas.push(id);
            } catch (e) { fallidas.push(id); }
        }
    };
    await Promise.all(Array.from({ length: 8 }, trabajador));
    console.log(`   Bajadas ${bajadas.length}${fallidas.length ? `, fallaron ${fallidas.length} (Leanny aun no las tiene; se reintentan la proxima vez)` : ''}.`);
    return bajadas;
}

function paso3Nombres(en) {
    console.log('\n3) Nombres de expansion (respaldo del bot)');
    const ruta = path.join(RAIZ, 'assets', 'expansion_names.json');
    const actual = leerJson(ruta);
    const nuevos = Object.entries(nombresExpansion(en)).filter(([c]) => !actual[c]);
    if (!nuevos.length) return console.log('   Nada nuevo.');
    for (const [c, n] of nuevos) { actual[c] = n; console.log(`   + ${c}: ${n}`); }
    if (!SIMULAR) fs.writeFileSync(ruta, JSON.stringify(actual, null, 2) + '\n');
}

async function paso4Motor(en) {
    console.log('\n4) Sobres en el motor de Miguel');
    const rutaCat = path.join(MOTOR, 'scripts', 'flow', 'pack_catalog.py');
    const rutaPackJson = path.join(MOTOR, 'engine', 'config', 'pack.json');
    if (!fs.existsSync(rutaCat)) return console.log('   No esta el motor en esta PC, se salta.');
    const packmaster = (await axios.get(`${LEANNY}/data/packmaster.json`, { timeout: 60000 })).data;
    let cat = fs.readFileSync(rutaCat, 'utf8');
    const conocidos = new Set([...cat.matchAll(/"pack_id":\s*"([^"]+)"/g)].map(m => m[1]));
    // Solo sobres de booster normales (AN/BN/CN...), no promos ni de evento.
    const nuevos = Object.entries(packmaster)
        .filter(([id, p]) => /^[A-Z]N\d{3}_\d{4}_00_000$/.test(id) && p.ExpansionID && !conocidos.has(id))
        .sort(([a], [b]) => a.localeCompare(b));
    if (!nuevos.length) return console.log('   Nada nuevo.');

    // product_id: PC_PS_ + AAMM del set + 000_01_ + numero de sobre + _01. El mes del set nuevo no viene
    // en los datos: se toma el ultimo del catalogo + 1 por cada set nuevo (C1 fue 2610 tras B4b 2609).
    let ultimo = Math.max(...[...cat.matchAll(/PC_PS_(\d{4})000_/g)].map(m => Number(m[1])));
    const mesDeSet = {};
    // Mes de los sets que ya estan en el catalogo (un sobre que le falte a uno de ellos usa el mismo).
    for (const m of cat.matchAll(/"expansion_id":\s*"([^"]+)"[^\n]*?"product_id":\s*"PC_PS_(\d{4})000_/g)) mesDeSet[m[1].toUpperCase()] ??= Number(m[2]);
    // Orden de sets (A1 < A4a < B1 < C1): solo se deduce el mes de los MAS NUEVOS que el ultimo del catalogo;
    // un set viejo que nunca se cargo (A4a, A4b...) no tiene como saberse, se avisa y se salta.
    const rango = (s) => { const m = String(s).toUpperCase().match(/^([A-Z])(\d+)([A-Z]?)$/); return m ? (m[1].charCodeAt(0) * 1000 + Number(m[2]) * 30 + (m[3] ? m[3].charCodeAt(0) - 64 : 0)) : -1; };
    const rangoMax = Math.max(...Object.keys(mesDeSet).map(rango));
    const viejos = nuevos.filter(([, p]) => !mesDeSet[p.ExpansionID] && rango(p.ExpansionID) <= rangoMax);
    if (viejos.length) {
        console.log(`   (sets viejos que el motor nunca tuvo, se saltan: ${[...new Set(viejos.map(([, p]) => p.ExpansionID))].join(', ')})`);
        for (const v of viejos) nuevos.splice(nuevos.indexOf(v), 1);
        if (!nuevos.length) return;
    }
    const siguienteMes = () => { let aa = Math.floor(ultimo / 100), mm = ultimo % 100 + 1; if (mm > 12) { mm = 1; aa++; } ultimo = aa * 100 + mm; return ultimo; };
    const nl = cat.includes('\r\n') ? '\r\n' : '\n';
    const lineas = [], entradasJson = [];
    for (const [id, p] of nuevos) {
        const set = p.ExpansionID;
        if (!mesDeSet[set]) mesDeSet[set] = siguienteMes();
        const n = Number(id.slice(6, 10)) / 10 || 1; // CN001_0020_00_000 -> sobre 2
        const sku = `${set}_${n}`;
        const nombre = (en[p.Name] || en[`PACK_DESC_${set}_${n}`] || sku).replace(/ booster pack$/i, '').replace(/\n.*/s, '');
        const productId = `PC_PS_${mesDeSet[set]}000_01_${String(n).padStart(2, '0')}_01`;
        lineas.push(`    {"name": "${nombre}", "expansion_id": "${set.toLowerCase()}", "sku_id": "${sku}", "pack_id": "${id}", "product_id": "${productId}", "hg_cost": 0},  # auto ${new Date().toISOString().slice(0, 10)}: product_id deducido, probar 1 sobre`);
        entradasJson.push({ label: `(${set}) ${nombre}`, packId: id, productId: 'SINGLE', setCode: set, setName: set, skuId: sku, assetId: id, iconAssetId: `PACK_ICON_${id}`, featuredCardIds: [] });
        console.log(`   + ${nombre}  ${id}  ${productId}`);
    }
    if (SIMULAR) return;
    const ini = cat.indexOf('PAID_HOURGLASS_PACKS = [');
    const fin = cat.indexOf(`${nl}]`, ini);
    fs.copyFileSync(rutaCat, `${rutaCat}.bak-auto`);
    cat = cat.slice(0, fin) + nl + lineas.join(nl) + cat.slice(fin);
    fs.writeFileSync(rutaCat, cat);
    if (fs.existsSync(rutaPackJson)) {
        fs.copyFileSync(rutaPackJson, `${rutaPackJson}.bak-auto`);
        const pj = leerJson(rutaPackJson);
        for (const e of entradasJson) if (!pj.some(x => x.packId === e.packId)) pj.push(e);
        fs.writeFileSync(rutaPackJson, JSON.stringify(pj, null, 2));
    }
    pendientes.push('Probar 1 sobre de cada set nuevo en el motor (el product_id es deducido): ' + [...new Set(nuevos.map(([, p]) => p.ExpansionID))].join(', '));
}

// Letra de serie de un set: la de su codigo (C1 -> C); Special Pack va con la serie mas nueva.
function letraSerie(codigo, letras) {
    const m = String(codigo).match(/^([A-Z])\d/);
    if (m) return m[1];
    if (/^SP\d/i.test(codigo)) return letras[letras.length - 1];
    return null;
}

async function paso5LogosYSobres(cardmap, en) {
    console.log('\n5) Logos y sobres (Descargas\\<CODIGO>\\)');
    const nombres = nombresExpansion(en);
    const sets = [...new Set(Object.values(cardmap).map(v => v.ExpansionID))].filter(Boolean);
    const letras = [...new Set(sets.map(s => (String(s).match(/^([A-Z])\d/) || [])[1]).filter(Boolean))].sort();
    const packmaster = (await axios.get(`${LEANNY}/data/packmaster.json`, { timeout: 60000 })).data;
    const setsConSobres = new Set(Object.values(packmaster).map(p => p.ExpansionID).filter(Boolean));
    const carpetas = fs.readdirSync(EXPANSIONS_DIR);
    const regexGrupos = (fs.readFileSync(path.join(RAIZ, 'bot.js'), 'utf8').match(/texto\.match\(\/\^\(\[([A-Z]+)\]\)\\d/) || [])[1] || '';

    for (const set of sets) {
        const nombre = nombres[set] || (/^PROMO-([A-Z])$/.exec(set) ? `Promo ${set.slice(-1)}` : null);
        if (!nombre) continue;
        const carpetaNombre = nombreArchivoSeguro(nombre);
        const letra = letraSerie(set, letras);
        const origen = path.join(DESCARGAS, set);

        if (fs.existsSync(origen)) {
            for (const f of fs.readdirSync(origen).filter(f => /\.(png|jpe?g|webp)$/i.test(f))) {
                const esLogo = /^logo\./i.test(f);
                const destino = esLogo
                    ? path.join(EXPANSIONS_DIR, carpetaNombre, `${carpetaNombre}.png`)
                    : path.join(EXPANSIONS_DIR, `Serie ${letra}`, `${carpetaNombre} ${nombreArchivoSeguro(path.parse(f).name.replace(/[-_]+/g, ' '))}.png`);
                console.log(`   ${set}: ${f} -> ${path.relative(RAIZ, destino)}`);
                if (SIMULAR) continue;
                fs.mkdirSync(path.dirname(destino), { recursive: true });
                const img = sharp(path.join(origen, f));
                await (esLogo ? img.png() : img.resize({ height: 1000 }).png()).toFile(destino);
            }
        }

        // Que falta a mano (despues de copiar lo que hubiera en Descargas).
        const tieneLogo = fs.readdirSync(EXPANSIONS_DIR).some(c => normalizar(c) === normalizar(nombre)
            && fs.existsSync(path.join(EXPANSIONS_DIR, c)) && fs.statSync(path.join(EXPANSIONS_DIR, c)).isDirectory()
            && fs.readdirSync(path.join(EXPANSIONS_DIR, c)).some(x => normalizar(path.parse(x).name) === normalizar(nombre)));
        if (!tieneLogo) pendientes.push(`Logo de ${nombre} (${set}): pon logo.png en Descargas\\${set}\\ y corre esto otra vez`);
        if (letra && setsConSobres.has(set)) {
            const serie = path.join(EXPANSIONS_DIR, `Serie ${letra}`);
            const tieneSobre = fs.existsSync(serie) && fs.readdirSync(serie).some(x => normalizar(path.parse(x).name).startsWith(normalizar(nombre)));
            if (!tieneSobre) pendientes.push(`Arte de los sobres de ${nombre} (${set}): pon una imagen por sobre en Descargas\\${set}\\ (ej. pikachu.png)`);
            if (!regexGrupos.includes(letra)) pendientes.push(`Serie nueva "${letra}": hay que agregarla en grupoDeRelease (bot.js) — pidemelo`);
        }
    }
    if (!carpetas.length) console.log('   (sin carpeta de expansiones)');
}

async function paso6Repo(helper, bajadas) {
    console.log('\n6) Repo de imagenes (respaldo de los otros hosts)');
    if (!bajadas.length) return console.log('   Nada nuevo para subir.');
    if (SIMULAR) return console.log(`   Subiria ${bajadas.length} imagenes.`);
    if (!SIN_PREGUNTAR) {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        const resp = await new Promise(r => rl.question(`   ¿Subir ${bajadas.length} imagenes nuevas a ${REPO_IMAGENES}? (s/n) `, r));
        rl.close();
        if (!/^s/i.test(resp.trim())) return console.log('   No se subieron.');
    }
    const tmp = path.join(os.tmpdir(), 'subida-imagen.json');
    let ok = 0;
    for (const id of bajadas) {
        try {
            // Mismo tamaño que el resto del repo (367x512, baja calidad).
            const buf = await sharp(path.join(helper, 'CardImageCache', `${id}.png`)).resize(367, 512).png().toBuffer();
            fs.writeFileSync(tmp, JSON.stringify({ message: `Add ${id}`, content: buf.toString('base64') }));
            execFileSync('gh', ['api', '-X', 'PUT', `repos/${REPO_IMAGENES}/contents/${id}.png`, '--input', tmp], { stdio: 'ignore', windowsHide: true });
            ok++;
        } catch (e) { /* ya existe o fallo puntual */ }
    }
    fs.rmSync(tmp, { force: true });
    console.log(`   Subidas ${ok} de ${bajadas.length}.`);
}

async function main() {
    console.log(SIMULAR ? '🔎 SIMULACION: no se cambia nada.' : '🔄 Actualizando expansiones...');
    const helper = carpetaHelper();
    console.log(`Carpeta de datos: ${helper}`);
    const { cardmap, en, setsNuevos } = await paso1Datos(helper);
    const bajadas = await paso2Imagenes(helper, cardmap);
    paso3Nombres(en);
    await paso4Motor(en);
    await paso5LogosYSobres(cardmap, en);
    await paso6Repo(helper, bajadas);

    const deluxe = setsNuevos.filter(s => /deluxe/i.test(nombresExpansion(en)[s] || ''));
    if (deluxe.length) pendientes.push(`Set Deluxe nuevo (${deluxe.join(', ')}): las reimpresiones necesitan su expansion original (OVERRIDES_EXPANSION) — pidemelo`);
    console.log('\n' + (pendientes.length ? '📝 Falta a mano:\n' + pendientes.map(p => `   - ${p}`).join('\n') : '✅ No falta nada.'));
    if (!SIMULAR) console.log('\nDespues: reinicia el bot (pm2 stop bot, pm2 start bot) y, si quieres, publica para los hosts.');
}

main().catch(e => { console.error('❌ Error:', e.message); process.exit(1); });
