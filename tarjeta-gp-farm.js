// Tarjeta (imagen) del host en GP farm para el canal 🔒-hosts (Ale 2026-11-12: "lo mismo que Only Pack").
// Mismo estilo que aviso-only-pack.js: el texto en Discord se tuerce en el celular, la imagen no.
// Solo salen los miembros con el Monitor Link prendido (sin él no se pueden abrir sus cuentas).
// miembros: [{ nombre, online, total, abiertas, quedan }]
const n = (x) => Math.round(x).toLocaleString('en-US');
const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// Sin emojis (la fuente no los tiene); se dejan letras con acento y CJK.
const nombreTarjeta = (s) => String(s || '').replace(/[^\p{L}\p{N} ._\-'!?#&()]/gu, '').trim().slice(0, 20) || '?';

async function armarTarjetaGp({ motor, packId, sobre: sobreDado, host, modo = 'godpack', propias = 0, miembros }) {
    const sharp = require('sharp');
    const { nombreSobre, imagenSobre } = require('./aviso-only-pack.js');
    const sobre = sobreDado || nombreSobre(motor, packId);
    const imagen = imagenSobre(sobre);
    const soloSobres = modo === 'packs-only';
    const color = soloSobres ? '#f5c518' : '#3ddc84';
    const W = 1000, PAD = 40, PACK_W = 200, PACK_H = 384, FILA = 46;
    const X = PAD + PACK_W + 40;              // columna derecha
    const lista = miembros.filter(m => m.online && m.total > 0).sort((a, b) => b.total - a.total);
    const filas = lista.slice(0, 40);
    const TOP_LISTA = PAD + PACK_H + 50;
    const H = TOP_LISTA + 44 + Math.max(1, filas.length) * FILA + (lista.length > filas.length ? 30 : 0) + 80;
    const F = `font-family="Segoe UI, Helvetica Neue, Helvetica, Arial, sans-serif"`;
    const sum = (k) => lista.reduce((a, m) => a + m[k], 0);
    const total = sum('total');

    let packImg = '';
    if (imagen) {
        const png = await sharp(imagen).resize(PACK_W * 2, PACK_H * 2, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
        packImg = `<image x="${PAD}" y="${PAD}" width="${PACK_W}" height="${PACK_H}" href="data:image/png;base64,${png.toString('base64')}"/>`;
    }
    const cuadros = [['ACCOUNTS', n(total)], ['OPENED', n(sum('abiertas'))], ['LEFT NOW', n(sum('quedan'))]];
    const anchoCuadro = (W - PAD - X - 12 * (cuadros.length - 1)) / cuadros.length;
    const svgCuadros = cuadros.map(([k, v], i) => {
        const x = X + i * (anchoCuadro + 12);
        return `<rect x="${x}" y="250" width="${anchoCuadro}" height="110" rx="16" fill="#2b2d34"/>
            <text x="${x + 20}" y="288" ${F} font-size="16" font-weight="600" fill="#9aa0a6" letter-spacing="1.5">${k}</text>
            <text x="${x + 20}" y="336" ${F} font-size="38" font-weight="700" fill="#ffffff">${xml(v)}</text>`;
    }).join('');

    // Columnas: nombre | barra abiertas/total | Opened | Left | Total
    const BX = 330, BW = 260, C_ABI = 730, C_QUE = 850, C_TOT = W - PAD;
    const svgFilas = filas.map((m, i) => {
        const y = TOP_LISTA + 44 + i * FILA;
        const w = m.total && m.abiertas ? Math.max(8, Math.round(Math.min(1, m.abiertas / m.total) * BW)) : 0;
        return `${i % 2 ? '' : `<rect x="${PAD - 12}" y="${y - 31}" width="${W - 2 * PAD + 24}" height="${FILA}" rx="10" fill="#24262c"/>`}
            <text x="${PAD + 18}" y="${y}" ${F} font-size="20" font-weight="700" fill="${i < 3 ? color : '#6f747c'}" text-anchor="middle">${i + 1}</text>
            <text x="${PAD + 50}" y="${y}" ${F} font-size="22" font-weight="600" fill="#e8eaed">${xml(nombreTarjeta(m.nombre))}</text>
            <rect x="${BX}" y="${y - 17}" width="${BW}" height="14" rx="7" fill="#33363d"/>
            ${w ? `<rect x="${BX}" y="${y - 17}" width="${w}" height="14" rx="7" fill="url(#barra)"/>` : ''}
            <text x="${C_ABI}" y="${y}" ${F} font-size="22" font-weight="600" fill="#c9cdd2" text-anchor="end">${n(m.abiertas)}</text>
            <text x="${C_QUE}" y="${y}" ${F} font-size="22" font-weight="600" fill="${m.quedan ? color : '#6f747c'}" text-anchor="end">${n(m.quedan)}</text>
            <text x="${C_TOT}" y="${y}" ${F} font-size="22" font-weight="700" fill="#ffffff" text-anchor="end">${n(m.total)}</text>`;
    }).join('') || `<text x="${PAD + 50}" y="${TOP_LISTA + 44}" ${F} font-size="20" fill="#9aa0a6">No members online with Monitor Link</text>`;
    const yFin = TOP_LISTA + 44 + Math.max(1, filas.length) * FILA;
    const mas = lista.length > filas.length
        ? `<text x="${PAD + 50}" y="${yFin}" ${F} font-size="18" fill="#9aa0a6">...and ${lista.length - filas.length} more</text>` : '';
    const yTotal = yFin + (mas ? 30 : 0) + 30;
    const titulo = soloSobres ? 'OPEN PACKS ONLY' : 'GOD PACK FARM';
    const anchoPill = soloSobres ? 236 : 222;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
        <defs><linearGradient id="barra" x1="0" x2="1"><stop offset="0" stop-color="${soloSobres ? '#f5a518' : '#1fa463'}"/><stop offset="1" stop-color="${color}"/></linearGradient></defs>
        <rect width="${W}" height="${H}" rx="28" fill="#1c1d22"/>
        <rect x="0" y="0" width="${W}" height="8" rx="4" fill="${color}"/>
        ${packImg}
        ${require('./tarjetas-comunidad.js').logo()}
        <rect x="${X}" y="${PAD + 4}" width="${anchoPill}" height="38" rx="19" fill="${color}"/>
        <text x="${X + 18}" y="${PAD + 30}" ${F} font-size="18" font-weight="800" fill="#1c1d22" letter-spacing="1.5">${titulo}</text>
        <circle cx="${X + anchoPill + 28}" cy="${PAD + 23}" r="7" fill="#3ddc84"/>
        <text x="${X + anchoPill + 44}" y="${PAD + 30}" ${F} font-size="18" font-weight="700" fill="#3ddc84" letter-spacing="1.5">${lista.length} ONLINE</text>
        <text x="${X}" y="${PAD + 112}" ${F} font-size="44" font-weight="800" fill="#ffffff">${xml(sobre)}</text>
        <text x="${X}" y="${PAD + 160}" ${F} font-size="20" fill="#9aa0a6">Host  <tspan fill="#e8eaed" font-weight="600">${xml(nombreTarjeta(host))}</tspan>   ·   own accounts  <tspan fill="#e8eaed" font-weight="600">${n(propias)}</tspan></text>
        ${svgCuadros}
        <text x="${PAD}" y="${TOP_LISTA}" ${F} font-size="17" font-weight="700" fill="#9aa0a6" letter-spacing="1.5">MEMBERS ONLINE</text>
        <text x="${BX}" y="${TOP_LISTA}" ${F} font-size="17" font-weight="700" fill="#9aa0a6" letter-spacing="1.5">OPENED / TOTAL</text>
        <text x="${C_ABI}" y="${TOP_LISTA}" ${F} font-size="17" font-weight="700" fill="#9aa0a6" letter-spacing="1.5" text-anchor="end">OPENED</text>
        <text x="${C_QUE}" y="${TOP_LISTA}" ${F} font-size="17" font-weight="700" fill="#9aa0a6" letter-spacing="1.5" text-anchor="end">LEFT</text>
        <text x="${C_TOT}" y="${TOP_LISTA}" ${F} font-size="17" font-weight="700" fill="#9aa0a6" letter-spacing="1.5" text-anchor="end">TOTAL</text>
        <rect x="${PAD}" y="${TOP_LISTA + 12}" width="${W - 2 * PAD}" height="2" fill="#2f3138"/>
        ${svgFilas}${mas}
        <rect x="${PAD}" y="${yTotal - 34}" width="${W - 2 * PAD}" height="2" fill="#2f3138"/>
        <text x="${PAD + 50}" y="${yTotal}" ${F} font-size="22" font-weight="800" fill="${color}" letter-spacing="1.5">TOTAL</text>
        <text x="${C_ABI}" y="${yTotal}" ${F} font-size="22" font-weight="800" fill="${color}" text-anchor="end">${n(sum('abiertas'))}</text>
        <text x="${C_QUE}" y="${yTotal}" ${F} font-size="22" font-weight="800" fill="${color}" text-anchor="end">${n(sum('quedan'))}</text>
        <text x="${C_TOT}" y="${yTotal}" ${F} font-size="24" font-weight="800" fill="${color}" text-anchor="end">${n(total)}</text>
    </svg>`;
    return { buffer: await sharp(Buffer.from(svg)).png().toBuffer(), sobre };
}

module.exports = { armarTarjetaGp };
