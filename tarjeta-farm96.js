// Tarjeta del canal 📦-farm-96p (Ale 2026-11-19): como el aviso de Open Packs Only del canal de hosts, pero
// para los /farm de los miembros. Arriba los sobres que se están abriendo (abanico), datos totales (cuentas,
// no elegibles, elegibles, PPM de /farm) y una fila por miembro: nombre de Discord + sobre + tarea + cuentas.
'use strict';
const { imagenSobre } = require('./aviso-only-pack.js');

const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const n = (x) => Math.round(x).toLocaleString('en-US');
const nombre = (s, max = 20) => String(s || '').replace(/[^\p{L}\p{N} ._\-'!?#&()]/gu, '').trim().slice(0, max) || '?';
const corto = (s) => String(s || '').replace(/^Special Pack:\s*/i, '').trim();
const TAREAS = {
    open96: ['FARM 96P', '#3ddc84'], open2: ['OPEN 2', '#5aa9ff'], special: ['SPECIAL', '#c58cff'], claim: ['CLAIM', '#f5a518'],
};

async function pngSobre(sharp, nombreSobre, w, h) {
    const ruta = imagenSobre(nombreSobre);
    if (!ruta) return null;
    return sharp(ruta).resize(w * 2, h * 2, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
}

// miembros: [{ nombre, sobre, tarea, cuentas, elegibles, hechas, sobres }]; ppm: /farm de todos; terminado: false/true
// Sin nadie farmeando: tarjeta 'READY' (decoracion = sobres para el abanico, los mas nuevos).
async function armarTarjetaFarm({ host, miembros, ppm, terminado = false, decoracion = [], cola = 0 }) {
    const sharp = require('sharp');
    const W = 1000, PAD = 40, FILA = 66;
    const lista = [...miembros].sort((a, b) => b.cuentas - a.cuentas).slice(0, 25);
    const total = miembros.reduce((a, m) => a + m.cuentas, 0);
    const elegibles = miembros.reduce((a, m) => a + (m.elegibles || 0), 0);
    const abiertos = miembros.reduce((a, m) => a + (m.sobres || 0), 0);
    const amarillo = terminado ? '#9aa0a6' : '#f5c518';
    const F = `font-family="Segoe UI, Helvetica Neue, Helvetica, Arial, sans-serif"`;

    // m.sobre puede ser uno o varios (el miembro elige varios en /farm: las cuentas se turnan).
    const sobresDe = (m) => [].concat(m.sobre || []).filter(Boolean);
    // Arriba: los sobres distintos que se abren, en abanico (hasta 3) + "+N" si hay mas. Sin sobres: vacio.
    const vacio = !lista.length;
    const todos = vacio ? decoracion.slice(0, 3) : [...new Set(lista.flatMap(sobresDe))];
    const distintos = todos.slice(0, 3);
    const PW = 140, PH = 270, CX = PAD + 125, CY = PAD + 30;
    const angulos = distintos.length === 1 ? [0] : distintos.length === 2 ? [-7, 7] : [-8, 0, 8];
    let abanico = '';
    for (let i = 0; i < distintos.length; i++) {
        const png = await pngSobre(sharp, distintos[i], PW, PH);
        if (!png) continue;
        const dx = distintos.length === 1 ? 0 : (i - (distintos.length - 1) / 2) * 38;
        abanico += `<image transform="rotate(${angulos[i]} ${CX + dx} ${CY + PH})" x="${CX + dx - PW / 2}" y="${CY}" width="${PW}" height="${PH}" href="data:image/png;base64,${png.toString('base64')}"/>`;
    }
    if (todos.length > 3) abanico += `<circle cx="${CX + 105}" cy="${CY + PH - 10}" r="30" fill="#f5c518" stroke="#1c1d22" stroke-width="4"/>
        <text x="${CX + 105}" y="${CY + PH - 1}" font-family="Segoe UI, Arial, sans-serif" font-size="24" font-weight="800" fill="#1c1d22" text-anchor="middle">+${todos.length - 3}</text>`;
    const X = PAD + 280;
    const cuadros = [['ACCOUNTS', n(total)], ['NOT ELIGIBLE', n(total - elegibles)], ['ELIGIBLE', n(elegibles)], ['PPM', terminado ? '0' : n(ppm)]];
    const anchoCuadro = (W - PAD - X - 10 * 3) / 4;
    const svgCuadros = cuadros.map(([k, v], i) => {
        const x = X + i * (anchoCuadro + 10);
        return `<rect x="${x}" y="200" width="${anchoCuadro}" height="100" rx="16" fill="#2b2d34"/>
            <text x="${x + 16}" y="234" ${F} font-size="14" font-weight="600" fill="#9aa0a6" letter-spacing="1.2">${k}</text>
            <text x="${x + 16}" y="280" ${F} font-size="34" font-weight="700" fill="${k === 'PPM' ? '#3ddc84' : '#ffffff'}">${xml(v)}</text>`;
    }).join('');

    const TOP = 400;
    const filas = [];
    for (let i = 0; i < lista.length; i++) {
        const m = lista[i], y = TOP + 44 + i * FILA;
        const suyos = sobresDe(m);
        let minis = '';
        for (let k = Math.min(3, suyos.length) - 1; k >= 0; k--) {   // el primero queda adelante
            const p = await pngSobre(sharp, suyos[k], 26, 50);
            if (p) minis += `<image x="${PAD + 300 - k * 9}" y="${y - 36 + k * 2}" width="26" height="50" href="data:image/png;base64,${p.toString('base64')}"/>`;
        }
        // Varios: solo el Pokemon del sobre ("Mega Gyarados +1 more") para que no se corte el nombre.
        const variante = (s) => corto(s).split(': ').pop();
        const textoSobre = !suyos.length ? '—' : suyos.length > 1
            ? `${variante(suyos[0]).slice(0, 22)}  +${suyos.length - 1} more` : corto(suyos[0]).slice(0, 32);
        const [tarea, color] = TAREAS[m.tarea] || [String(m.tarea || '').toUpperCase(), '#9aa0a6'];
        filas.push(`${i % 2 ? '' : `<rect x="${PAD - 12}" y="${y - 40}" width="${W - 2 * PAD + 24}" height="${FILA}" rx="10" fill="#24262c"/>`}
            <text x="${PAD + 16}" y="${y}" ${F} font-size="20" font-weight="700" fill="${i < 3 ? amarillo : '#6f747c'}" text-anchor="middle">${i + 1}</text>
            <text x="${PAD + 46}" y="${y - 4}" ${F} font-size="22" font-weight="700" fill="#e8eaed">${xml(nombre(m.nombre))}</text>
            ${minis}
            <text x="${PAD + 336}" y="${y - 4}" ${F} font-size="18" fill="#c3c6cc">${xml(textoSobre)}</text>
            <text x="${PAD + 46}" y="${y + 18}" ${F} font-size="14" fill="#7d828a">${n(m.hechas || 0)} / ${n(m.cuentas)} done · ${n(m.sobres || 0)} packs</text>
            <rect x="${W - PAD - 250}" y="${y - 24}" width="104" height="28" rx="14" fill="${color}" fill-opacity="0.18" stroke="${color}" stroke-width="1.5"/>
            <text x="${W - PAD - 198}" y="${y - 4}" ${F} font-size="13" font-weight="800" fill="${color}" text-anchor="middle" letter-spacing="1">${tarea}</text>
            <text x="${W - PAD}" y="${y - 4}" ${F} font-size="22" font-weight="700" fill="#ffffff" text-anchor="end">${n(m.cuentas)}</text>`);
    }
    if (vacio) filas.push(`<text x="${W / 2}" y="${TOP + 70}" ${F} font-size="22" fill="#9aa0a6" text-anchor="middle">Nobody is farming right now. Type <tspan fill="#f5c518" font-weight="700">/farm</tspan> here to open your lent accounts.</text>`);
    const yFin = TOP + 44 + Math.max(1, lista.length) * FILA;
    const H = yFin + 70;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
        <rect width="${W}" height="${H}" rx="28" fill="#1c1d22"/>
        <rect x="0" y="0" width="${W}" height="8" rx="4" fill="${amarillo}"/>
        ${abanico}
        ${require('./tarjetas-comunidad.js').logo()}
        <rect x="${X}" y="${PAD + 4}" width="130" height="38" rx="19" fill="${amarillo}"/>
        <text x="${X + 18}" y="${PAD + 30}" ${F} font-size="18" font-weight="800" fill="#1c1d22" letter-spacing="1.5">/FARM</text>
        <circle cx="${X + 156}" cy="${PAD + 23}" r="7" fill="${terminado || vacio ? '#9aa0a6' : '#3ddc84'}"/>
        <text x="${X + 172}" y="${PAD + 30}" ${F} font-size="18" font-weight="700" fill="${terminado || vacio ? '#9aa0a6' : '#3ddc84'}" letter-spacing="1.5">${terminado ? 'FINISHED' : vacio ? 'READY' : 'OPENING NOW'}</text>
        <text x="${X}" y="${PAD + 100}" ${F} font-size="40" font-weight="800" fill="#ffffff">${vacio ? 'Nobody farming now' : 'Members farming'}</text>
        <text x="${X}" y="${PAD + 138}" ${F} font-size="19" fill="#9aa0a6">Host  <tspan fill="#e8eaed" font-weight="600">${xml(nombre(host))}</tspan>   ·   ${lista.length} member(s)   ·   ${n(abiertos)} packs opened${cola ? `   ·   ${cola} in line` : ''}</text>
        ${svgCuadros}
        <text x="${PAD}" y="${TOP}" ${F} font-size="16" font-weight="700" fill="#9aa0a6" letter-spacing="1.5">MEMBER</text>
        <text x="${PAD + 336}" y="${TOP}" ${F} font-size="16" font-weight="700" fill="#9aa0a6" letter-spacing="1.5">PACK</text>
        <text x="${W - PAD - 198}" y="${TOP}" ${F} font-size="16" font-weight="700" fill="#9aa0a6" letter-spacing="1.5" text-anchor="middle">JOB</text>
        <text x="${W - PAD}" y="${TOP}" ${F} font-size="16" font-weight="700" fill="#9aa0a6" letter-spacing="1.5" text-anchor="end">ACCOUNTS</text>
        <rect x="${PAD}" y="${TOP + 12}" width="${W - 2 * PAD}" height="2" fill="#2f3138"/>
        ${filas.join('')}
        <rect x="${PAD}" y="${yFin - 30}" width="${W - 2 * PAD}" height="2" fill="#2f3138"/>
        <text x="${PAD + 46}" y="${yFin + 6}" ${F} font-size="22" font-weight="800" fill="${amarillo}" letter-spacing="1.5">TOTAL</text>
        <text x="${W - PAD}" y="${yFin + 6}" ${F} font-size="24" font-weight="800" fill="${amarillo}" text-anchor="end">${n(total)}</text>
    </svg>`;
    return sharp(Buffer.from(svg)).png().toBuffer();
}

module.exports = { armarTarjetaFarm };
