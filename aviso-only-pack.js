// Aviso de Open Packs Only (Ale 2026-11-09): al dar Start en Open Packs Only, el host avisa en el canal
// 🔒-hosts qué sobre está abriendo (nombre + imagen) y cuántas cuentas NO elegibles a God Pack tiene cada miembro.
// armarAviso() devuelve { embed, archivo } listo para mandar con discord.js o por REST.
const fs = require('fs');
const path = require('path');

const CARPETA_SOBRES = path.join(__dirname, 'assets', 'expansions');
const normalizar = (s) => String(s || '').toLowerCase().replace(/\bpack\b/g, '').replace(/[^a-z0-9]/g, '');

// Nombre del sobre por pack_id, leído del catálogo del motor (scripts/flow/pack_catalog.py).
function nombreSobre(motor, packId) {
    try {
        const texto = fs.readFileSync(path.join(motor, 'scripts', 'flow', 'pack_catalog.py'), 'utf8');
        for (const m of texto.matchAll(/\{"name":\s*"([^"]+)"[^}]*"pack_id":\s*"([^"]+)"/g)) if (m[2] === packId) return m[1];
    } catch (e) { /* sin catálogo */ }
    return packId;
}

// Imagen del sobre exacto (assets/expansions/**.png), comparando nombres sin signos ni la palabra "Pack".
function imagenSobre(nombre) {
    const buscado = normalizar(nombre);
    const pngs = [];
    const recorrer = (dir) => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            const ruta = path.join(dir, e.name);
            if (e.isDirectory()) recorrer(ruta);
            else if (/\.png$/i.test(e.name) && e.name !== 'symbol.png') pngs.push(ruta);
        }
    };
    try { recorrer(CARPETA_SOBRES); } catch (e) { return null; }
    return pngs.find(p => normalizar(path.basename(p, '.png')) === buscado)
        || pngs.find(p => normalizar(path.basename(p, '.png')).includes(buscado) || buscado.includes(normalizar(path.basename(p, '.png'))))
        || null;
}

const BLOQUE = '```';
const n = (x) => Math.round(x).toLocaleString('en-US');
// Los nombres van sin emojis ni letras raras: esos ocupan otro ancho y tuercen las columnas.
const limpio = (s) => String(s || '').normalize('NFKD').replace(/[^\x20-\x7E]/g, '').trim() || '?';
const tiempo = (m) => m >= 60 ? `${Math.floor(m / 60)}h ${String(Math.floor(m % 60)).padStart(2, '0')}m` : `${Math.floor(m)}m`;

// miembros: [{ nombre, cuentas }] con las cuentas NO elegibles de cada uno.
// progreso (opcional): { sobres, minutos } desde el Start; el mensaje se edita cada pocos minutos.
// Este PPM es solo de Only Pack: no va a LatiasBot, así no se mezcla con el GP farm.
function armarAviso({ motor, packId, host, miembros, progreso, terminado }) {
    const sobre = nombreSobre(motor, packId);
    const imagen = imagenSobre(sobre);
    const lista = miembros.filter(m => m.cuentas > 0).sort((a, b) => b.cuentas - a.cuentas);
    const total = lista.reduce((a, m) => a + m.cuentas, 0);

    // Todo va en bloques de código (letra de ancho fijo) para que las columnas queden rectas.
    const ANCHO_NOMBRE = 16, ANCHO_BARRA = 10;
    const mayor = lista[0]?.cuentas || 1;
    const ancho = Math.max(n(total).length, 1);
    let filas = lista.map((m, i) => {
        const nombre = limpio(m.nombre).slice(0, ANCHO_NOMBRE).padEnd(ANCHO_NOMBRE);
        const lleno = Math.max(1, Math.round(m.cuentas / mayor * ANCHO_BARRA));
        return `${String(i + 1).padStart(2)}  ${nombre} ${'█'.repeat(lleno)}${'░'.repeat(ANCHO_BARRA - lleno)} ${n(m.cuentas).padStart(ancho)}`;
    });
    let corte = filas.length;
    while (corte > 0 && filas.slice(0, corte).join('\n').length > 3000) corte--;
    if (corte < filas.length) filas = [...filas.slice(0, corte), `    ...and ${lista.length - corte} more`];
    const raya = '─'.repeat(4 + ANCHO_NOMBRE + 1 + ANCHO_BARRA + 1 + ancho);
    const filaTotal = `    ${'TOTAL'.padEnd(ANCHO_NOMBRE)} ${' '.repeat(ANCHO_BARRA)} ${n(total).padStart(ancho)}`;

    const datos = [['Host', limpio(host)], ['Accounts', `${n(total)} not eligible yet`]];
    if (progreso) datos.push(
        ['PPM', terminado ? '0 (stopped)' : `${n(progreso.sobres / Math.max(1, progreso.minutos))} packs/min`],
        ['Opened', `${n(progreso.sobres)} packs`],
        ['Running', tiempo(progreso.minutos)]);
    const resumen = datos.map(([k, v]) => `${k.padEnd(9)}${v}`).join('\n');

    const embed = {
        color: terminado ? 0x95A5A6 : 0xF1C40F,
        author: { name: terminado ? '⏹️  OPEN PACKS ONLY · STOPPED' : '📦  OPEN PACKS ONLY · OPENING NOW' },
        title: sobre,
        description: `${BLOQUE}\n${resumen}\n${BLOQUE}\n**👥  Members · accounts not God Pack eligible yet**\n`
            + `${BLOQUE}\n${filas.join('\n') || '    No accounts'}\n${raya}\n${filaTotal}\n${BLOQUE}`,
        footer: { text: 'Only Pack PPM is not counted in the GP farm · packs only, no friend requests' },
        timestamp: new Date().toISOString(),
    };
    let archivo = null;
    if (imagen) {
        const nombreArchivo = 'pack.png';
        embed.thumbnail = { url: `attachment://${nombreArchivo}` };
        archivo = { ruta: imagen, nombre: nombreArchivo };
    }
    return { embed, archivo, total, sobre };
}

// ---------------------------------------------------------------- tarjeta (imagen)
// (Ale 2026-11-09: "hazlo bonito y que todo sea recto") El texto en Discord se tuerce en el celular,
// así que el aviso es una imagen: sobre a la izquierda, datos en cuadros y una fila por miembro.
const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// Sin emojis (la fuente no los tiene); se dejan letras con acento.
const nombreTarjeta = (s) => String(s || '').replace(/[^\p{L}\p{N} ._\-'!?#&()]/gu, '').trim().slice(0, 22) || '?';

async function armarTarjeta({ sobre, imagen, host, lista, total, progreso, terminado }) {
    const sharp = require('sharp');
    const W = 1000, PAD = 40, PACK_W = 200, PACK_H = 384;
    const X = PAD + PACK_W + 40;              // columna derecha
    const FILA = 46, TOP_LISTA = PAD + PACK_H + 50;
    const filas = lista.slice(0, 40);
    const H = TOP_LISTA + 44 + filas.length * FILA + (lista.length > filas.length ? 30 : 0) + 80;
    const F = `font-family="Segoe UI, Helvetica Neue, Helvetica, Arial, sans-serif"`;
    const amarillo = terminado ? '#9aa0a6' : '#f5c518';
    let packImg = '';
    if (imagen) {
        const png = await sharp(imagen).resize(PACK_W * 2, PACK_H * 2, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
        packImg = `<image x="${PAD}" y="${PAD}" width="${PACK_W}" height="${PACK_H}" href="data:image/png;base64,${png.toString('base64')}"/>`;
    }
    const cuadros = [['ACCOUNTS', n(total)]];
    if (progreso) cuadros.push(
        ['PACKS / MIN', terminado ? '0' : n(progreso.sobres / Math.max(1, progreso.minutos))],
        ['OPENED', n(progreso.sobres)],
        ['RUNNING', tiempo(progreso.minutos)]);
    const anchoCuadro = (W - PAD - X - 12 * (cuadros.length - 1)) / cuadros.length;
    const svgCuadros = cuadros.map(([k, v], i) => {
        const x = X + i * (anchoCuadro + 12);
        return `<rect x="${x}" y="250" width="${anchoCuadro}" height="110" rx="16" fill="#2b2d34"/>
            <text x="${x + 20}" y="288" ${F} font-size="16" font-weight="600" fill="#9aa0a6" letter-spacing="1.5">${k}</text>
            <text x="${x + 20}" y="336" ${F} font-size="38" font-weight="700" fill="#ffffff">${xml(v)}</text>`;
    }).join('');
    const mayor = filas[0]?.cuentas || 1;
    const BX = 420, BW = 380;               // barra
    const svgFilas = filas.map((m, i) => {
        const y = TOP_LISTA + 44 + i * FILA;
        const w = Math.max(8, Math.round(m.cuentas / mayor * BW));
        return `${i % 2 ? '' : `<rect x="${PAD - 12}" y="${y - 31}" width="${W - 2 * PAD + 24}" height="${FILA}" rx="10" fill="#24262c"/>`}
            <text x="${PAD + 18}" y="${y}" ${F} font-size="20" font-weight="700" fill="${i < 3 ? amarillo : '#6f747c'}" text-anchor="middle">${i + 1}</text>
            <text x="${PAD + 50}" y="${y}" ${F} font-size="22" font-weight="600" fill="#e8eaed">${xml(nombreTarjeta(m.nombre))}</text>
            <rect x="${BX}" y="${y - 17}" width="${BW}" height="14" rx="7" fill="#33363d"/>
            <rect x="${BX}" y="${y - 17}" width="${w}" height="14" rx="7" fill="url(#barra)"/>
            <text x="${W - PAD}" y="${y}" ${F} font-size="22" font-weight="700" fill="#ffffff" text-anchor="end">${n(m.cuentas)}</text>`;
    }).join('');
    const yFin = TOP_LISTA + 44 + filas.length * FILA;
    const mas = lista.length > filas.length
        ? `<text x="${PAD + 50}" y="${yFin}" ${F} font-size="18" fill="#9aa0a6">...and ${lista.length - filas.length} more</text>` : '';
    const yTotal = yFin + (mas ? 30 : 0) + 30;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
        <defs><linearGradient id="barra" x1="0" x2="1"><stop offset="0" stop-color="${terminado ? '#6f747c' : '#f5a518'}"/><stop offset="1" stop-color="${amarillo}"/></linearGradient></defs>
        <rect width="${W}" height="${H}" rx="28" fill="#1c1d22"/>
        <rect x="0" y="0" width="${W}" height="8" rx="4" fill="${amarillo}"/>
        ${packImg}
        ${require('./tarjetas-comunidad.js').logo()}
        <rect x="${X}" y="${PAD + 4}" width="${terminado ? 250 : 236}" height="38" rx="19" fill="${amarillo}"/>
        <text x="${X + 18}" y="${PAD + 30}" ${F} font-size="18" font-weight="800" fill="#1c1d22" letter-spacing="1.5">OPEN PACKS ONLY</text>
        <circle cx="${X + (terminado ? 278 : 264)}" cy="${PAD + 23}" r="7" fill="${terminado ? '#9aa0a6' : '#3ddc84'}"/>
        <text x="${X + (terminado ? 294 : 280)}" y="${PAD + 30}" ${F} font-size="18" font-weight="700" fill="${terminado ? '#9aa0a6' : '#3ddc84'}" letter-spacing="1.5">${terminado ? 'STOPPED' : 'OPENING NOW'}</text>
        <text x="${X}" y="${PAD + 112}" ${F} font-size="44" font-weight="800" fill="#ffffff">${xml(sobre)}</text>
        <text x="${X}" y="${PAD + 160}" ${F} font-size="20" fill="#9aa0a6">Host  <tspan fill="#e8eaed" font-weight="600">${xml(nombreTarjeta(host))}</tspan>   ·   accounts not God Pack eligible yet</text>
        ${svgCuadros}
        <text x="${PAD}" y="${TOP_LISTA}" ${F} font-size="17" font-weight="700" fill="#9aa0a6" letter-spacing="1.5">MEMBERS</text>
        <text x="${W - PAD}" y="${TOP_LISTA}" ${F} font-size="17" font-weight="700" fill="#9aa0a6" letter-spacing="1.5" text-anchor="end">ACCOUNTS</text>
        <rect x="${PAD}" y="${TOP_LISTA + 12}" width="${W - 2 * PAD}" height="2" fill="#2f3138"/>
        ${svgFilas}${mas}
        <rect x="${PAD}" y="${yTotal - 34}" width="${W - 2 * PAD}" height="2" fill="#2f3138"/>
        <text x="${PAD + 50}" y="${yTotal}" ${F} font-size="22" font-weight="800" fill="${amarillo}" letter-spacing="1.5">TOTAL</text>
        <text x="${W - PAD}" y="${yTotal}" ${F} font-size="24" font-weight="800" fill="${amarillo}" text-anchor="end">${n(total)}</text>
    </svg>`;
    return sharp(Buffer.from(svg)).png().toBuffer();
}

// Aviso como imagen: { embed, archivo: { buffer, nombre } }.
async function armarAvisoImagen({ motor, packId, host, miembros, progreso, terminado }) {
    const sobre = nombreSobre(motor, packId);
    const imagen = imagenSobre(sobre);
    const lista = miembros.filter(m => m.cuentas > 0).sort((a, b) => b.cuentas - a.cuentas);
    const total = lista.reduce((a, m) => a + m.cuentas, 0);
    const buffer = await armarTarjeta({ sobre, imagen, host, lista, total, progreso, terminado });
    const embed = {
        color: terminado ? 0x95A5A6 : 0xF5C518,
        image: { url: 'attachment://only-pack.png' },
        footer: { text: 'Only Pack PPM is not counted in the GP farm · packs only, no friend requests' },
        timestamp: new Date().toISOString(),
    };
    return { embed, archivo: { buffer, nombre: 'only-pack.png' }, total, sobre };
}

module.exports = { armarAviso, armarAvisoImagen, nombreSobre, imagenSobre };
