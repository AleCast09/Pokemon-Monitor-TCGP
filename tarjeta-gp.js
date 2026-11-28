// Tarjetas del canal 📚all_god_packs (Ale 2026-11-22: "un embed asi", con el estilo del tablero de 📦-farm-96p):
// una por God Pack (estado, dueño, rareza, sobres, motivo, y las cartas en arco debajo) y la del resumen diario
// (totales y una fila por dueño). Se dibujan a doble resolucion para que las cartas no pierdan calidad.
'use strict';
const { imagenSobre } = require('./aviso-only-pack.js');

const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const n = (x) => Math.round(x).toLocaleString('en-US');
const nombre = (s, max = 20) => String(s || '').replace(/[^\p{L}\p{N} ._\-'!?#&()]/gu, '').trim().slice(0, max) || '?';
const F = `font-family="Segoe UI, Helvetica Neue, Helvetica, Arial, sans-serif"`;
const ESCALA = 2;
const VERDE = '#3ddc84', ROJO = '#ff5c63', AMARILLO = '#f5c518', VIOLETA = '#8f96ff';

async function pngSobre(sharp, nombreSobre, w, h) {
    const ruta = nombreSobre && imagenSobre(nombreSobre);
    if (!ruta) return null;
    return sharp(ruta).resize(w * 2 * ESCALA, h * 2 * ESCALA, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
}

function cuadros(lista, X, W, PAD, y) {
    const ancho = (W - PAD - X - 10 * (lista.length - 1)) / lista.length;
    return lista.map(([k, v, color], i) => {
        const x = X + i * (ancho + 10);
        const largo = String(v).length > 11 ? 20 : String(v).length > 8 ? 24 : 34;
        return `<rect x="${x}" y="${y}" width="${ancho}" height="100" rx="16" fill="#2b2d34"/>
            <text x="${x + 16}" y="${y + 34}" ${F} font-size="14" font-weight="600" fill="#9aa0a6" letter-spacing="1.2">${k}</text>
            <text x="${x + 16}" y="${y + 80}" ${F} font-size="${largo}" font-weight="700" fill="${color || '#ffffff'}">${xml(v)}</text>`;
    }).join('');
}

// Tarjeta de un God Pack. gp: { vivo, dueno, host, rareza, sobres, motivo, modo, sobre (nombre "Dual Fusion: Pikachu") }
// arco: PNG de las cartas en arco (all-god-packs.js), se pega debajo.
async function tarjetaGp(gp, arco) {
    const sharp = require('sharp');
    const W = 1000, PAD = 40, color = gp.vivo ? VERDE : ROJO;
    let arcoPng = null, arcoH = 0;
    if (arco) {
        const ancho = (W - 2 * PAD) * ESCALA;
        arcoPng = await sharp(arco).resize(ancho).png().toBuffer();
        arcoH = (await sharp(arcoPng).metadata()).height / ESCALA;
    }
    const TOP_ARCO = 345, H = TOP_ARCO + arcoH + (arcoH ? 20 : 0) + 30;
    const PW = 140, PH = 270, CX = PAD + 125, CY = PAD + 30;
    const sobre = await pngSobre(sharp, gp.sobre, PW, PH);
    const X = PAD + 280;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W * ESCALA}" height="${H * ESCALA}" viewBox="0 0 ${W} ${H}">
        <rect width="${W}" height="${H}" rx="28" fill="#1c1d22"/>
        <rect x="0" y="0" width="${W}" height="8" rx="4" fill="${color}"/>
        ${sobre ? `<image transform="rotate(-4 ${CX} ${CY + PH})" x="${CX - PW / 2}" y="${CY}" width="${PW}" height="${PH}" href="data:image/png;base64,${sobre.toString('base64')}"/>` : ''}
        ${require('./tarjetas-comunidad.js').logo()}
        <rect x="${X}" y="${PAD + 4}" width="164" height="38" rx="19" fill="${color}"/>
        <text x="${X + 18}" y="${PAD + 30}" ${F} font-size="18" font-weight="800" fill="#1c1d22" letter-spacing="1.5">GOD PACK</text>
        <circle cx="${X + 190}" cy="${PAD + 23}" r="7" fill="${color}"/>
        <text x="${X + 206}" y="${PAD + 30}" ${F} font-size="18" font-weight="700" fill="${color}" letter-spacing="1.5">${gp.vivo ? 'ALIVE' : 'DEAD'}</text>
        <text x="${X}" y="${PAD + 100}" ${F} font-size="40" font-weight="800" fill="#ffffff">${gp.rareza ? `[${gp.rareza}/5] ` : ''}God Pack</text>
        <text x="${X}" y="${PAD + 138}" ${F} font-size="19" fill="#9aa0a6">Host  <tspan fill="#e8eaed" font-weight="600">${xml(nombre(gp.host))}</tspan>   ·   ${xml(gp.sobre || '—')}</text>
        ${cuadros([['OWNER', nombre(gp.dueno, 14)], ['RARITY', gp.rareza ? `${gp.rareza}/5` : '—', AMARILLO], ['PACKS', gp.sobres ? `${gp.sobres}P` : '—'],
            ['MODE', gp.modo, gp.vivo ? VERDE : '#c3c6cc']], X, W, PAD, 200)}
        <text x="${X}" y="325" ${F} font-size="18" font-weight="600" fill="${color}">${gp.vivo ? '✓ Sent to the online Mains' : `✕ ${xml(gp.motivo || 'Not usable')}`}</text>
    </svg>`;
    const capas = arcoPng ? [{ input: arcoPng, left: PAD * ESCALA, top: TOP_ARCO * ESCALA }] : [];
    return sharp(Buffer.from(svg)).composite(capas).png().toBuffer();
}

// Tarjeta del resumen del dia. r: { dia, total, vivos, muertos, mejor, sobres: [nombres], filas: [{ nombre, hosts, vivos, muertos }] }
async function tarjetaResumen(r) {
    const sharp = require('sharp');
    const W = 1000, PAD = 40, FILA = 66;
    const lista = [...r.filas].sort((a, b) => (b.vivos + b.muertos) - (a.vivos + a.muertos)).slice(0, 20);
    const PW = 140, PH = 270, CX = PAD + 125, CY = PAD + 30;
    const distintos = r.sobres.slice(0, 3);
    const angulos = distintos.length === 1 ? [0] : distintos.length === 2 ? [-7, 7] : [-8, 0, 8];
    let abanico = '';
    for (let i = 0; i < distintos.length; i++) {
        const png = await pngSobre(sharp, distintos[i], PW, PH);
        if (!png) continue;
        const dx = distintos.length === 1 ? 0 : (i - (distintos.length - 1) / 2) * 38;
        abanico += `<image transform="rotate(${angulos[i]} ${CX + dx} ${CY + PH})" x="${CX + dx - PW / 2}" y="${CY}" width="${PW}" height="${PH}" href="data:image/png;base64,${png.toString('base64')}"/>`;
    }
    const X = PAD + 280, TOP = 400;
    const filas = lista.map((m, i) => {
        const y = TOP + 44 + i * FILA;
        const pastilla = (x, txt, c) => `<rect x="${x}" y="${y - 24}" width="96" height="28" rx="14" fill="${c}" fill-opacity="0.18" stroke="${c}" stroke-width="1.5"/>
            <text x="${x + 48}" y="${y - 4}" ${F} font-size="13" font-weight="800" fill="${c}" text-anchor="middle" letter-spacing="1">${txt}</text>`;
        return `${i % 2 ? '' : `<rect x="${PAD - 12}" y="${y - 40}" width="${W - 2 * PAD + 24}" height="${FILA}" rx="10" fill="#24262c"/>`}
            <text x="${PAD + 16}" y="${y}" ${F} font-size="20" font-weight="700" fill="${i < 3 ? AMARILLO : '#6f747c'}" text-anchor="middle">${i + 1}</text>
            <text x="${PAD + 46}" y="${y - 4}" ${F} font-size="22" font-weight="700" fill="#e8eaed">${xml(nombre(m.nombre))}</text>
            <text x="${PAD + 46}" y="${y + 18}" ${F} font-size="14" fill="#7d828a">${xml(m.hosts.join(' · '))}</text>
            ${pastilla(W - PAD - 330, `${m.vivos} ALIVE`, VERDE)}${pastilla(W - PAD - 222, `${m.muertos} DEAD`, ROJO)}
            <text x="${W - PAD}" y="${y - 4}" ${F} font-size="22" font-weight="700" fill="#ffffff" text-anchor="end">${n(m.vivos + m.muertos)}</text>`;
    });
    if (!lista.length) filas.push(`<text x="${W / 2}" y="${TOP + 70}" ${F} font-size="22" fill="#9aa0a6" text-anchor="middle">No God Packs today.</text>`);
    const yFin = TOP + 44 + Math.max(1, lista.length) * FILA, H = yFin + 70;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W * ESCALA}" height="${H * ESCALA}" viewBox="0 0 ${W} ${H}">
        <rect width="${W}" height="${H}" rx="28" fill="#1c1d22"/>
        <rect x="0" y="0" width="${W}" height="8" rx="4" fill="${VIOLETA}"/>
        ${abanico}
        ${require('./tarjetas-comunidad.js').logo()}
        <rect x="${X}" y="${PAD + 4}" width="186" height="38" rx="19" fill="${VIOLETA}"/>
        <text x="${X + 18}" y="${PAD + 30}" ${F} font-size="18" font-weight="800" fill="#1c1d22" letter-spacing="1.5">DAILY RECAP</text>
        <text x="${X + 204}" y="${PAD + 30}" ${F} font-size="18" font-weight="700" fill="${VIOLETA}" letter-spacing="1.5">${xml(r.dia.toUpperCase())}</text>
        <text x="${X}" y="${PAD + 100}" ${F} font-size="40" font-weight="800" fill="#ffffff">God Packs today</text>
        <text x="${X}" y="${PAD + 138}" ${F} font-size="19" fill="#9aa0a6">All community hosts   ·   ${lista.length} member(s)</text>
        ${cuadros([['GOD PACKS', n(r.total)], ['ALIVE', n(r.vivos), VERDE], ['DEAD', n(r.muertos), ROJO], ['BEST', r.mejor ? `${r.mejor}/5` : '—', AMARILLO]], X, W, PAD, 200)}
        <text x="${PAD}" y="${TOP}" ${F} font-size="16" font-weight="700" fill="#9aa0a6" letter-spacing="1.5">MEMBER</text>
        <text x="${W - PAD - 228}" y="${TOP}" ${F} font-size="16" font-weight="700" fill="#9aa0a6" letter-spacing="1.5" text-anchor="middle">RESULT</text>
        <text x="${W - PAD}" y="${TOP}" ${F} font-size="16" font-weight="700" fill="#9aa0a6" letter-spacing="1.5" text-anchor="end">GOD PACKS</text>
        <rect x="${PAD}" y="${TOP + 12}" width="${W - 2 * PAD}" height="2" fill="#2f3138"/>
        ${filas.join('')}
        <rect x="${PAD}" y="${yFin - 30}" width="${W - 2 * PAD}" height="2" fill="#2f3138"/>
        <text x="${PAD + 46}" y="${yFin + 6}" ${F} font-size="22" font-weight="800" fill="${VIOLETA}" letter-spacing="1.5">TOTAL</text>
        <text x="${W - PAD}" y="${yFin + 6}" ${F} font-size="24" font-weight="800" fill="${VIOLETA}" text-anchor="end">${n(r.total)}</text>
    </svg>`;
    return sharp(Buffer.from(svg)).png().toBuffer();
}

module.exports = { tarjetaGp, tarjetaResumen };
