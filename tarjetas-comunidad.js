// Tarjetas (imagen) de "Community hosts" y "Community accounts" para el canal 🔒-hosts
// (Ale 2026-11-12: "que sea similar a los embed" de Only Pack / GP farm). Mismo estilo que aviso-only-pack.js.
const n = (x) => Math.round(x).toLocaleString('en-US');
const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const limpio = (s, max = 28) => String(s || '').replace(/[^\p{L}\p{N} ._\-'!?#&()·]/gu, '').trim().slice(0, max) || '?';
const F = `font-family="Segoe UI, Helvetica Neue, Helvetica, Arial, sans-serif"`;
const W = 1000, PAD = 40;
// Logo de Pokemon TCG Pocket en la esquina (Ale 2026-11-12: el mismo que sale en los comandos del bot).
const fs = require('fs'), path = require('path');
let _logo = null;
function logo() {
    if (_logo === null) {
        try { _logo = fs.readFileSync(path.join(__dirname, 'assets', 'embeds', 'symbol.png')).toString('base64'); } catch (e) { _logo = ''; }
    }
    return _logo ? `<image x="${W - PAD - 120}" y="20" width="120" height="83" href="data:image/png;base64,${_logo}"/>` : '';
}

function marco(alto, color, cuerpo) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${alto}" viewBox="0 0 ${W} ${alto}">
        <rect width="${W}" height="${alto}" rx="28" fill="#1c1d22"/>
        <rect x="0" y="0" width="${W}" height="8" rx="4" fill="${color}"/>${logo()}${cuerpo}</svg>`;
}
const pastilla = (x, y, texto, fondo, letra = '#1c1d22') => {
    const w = 24 + texto.length * 11.5;
    return { w, svg: `<rect x="${x}" y="${y}" width="${w}" height="34" rx="17" fill="${fondo}"/>
        <text x="${x + w / 2}" y="${y + 23}" ${F} font-size="16" font-weight="800" fill="${letra}" letter-spacing="1.2" text-anchor="middle">${xml(texto)}</text>` };
};

// hosts: [{ nombre, estado: 'turn'|'standby'|'off', bot, version, alDia, motor, links, proxies, desde }]
async function tarjetaHosts(hosts) {
    const sharp = require('sharp');
    const color = '#5865f2', ALTO_FILA = 150, TOP = 150;
    const filas = hosts.map((h, i) => {
        const y = TOP + i * (ALTO_FILA + 14);
        const on = h.estado !== 'off';
        const p = h.estado === 'turn' ? pastilla(PAD + 70, y + 22, 'HAS THE TURN', '#f5c518')
            : h.estado === 'standby' ? pastilla(PAD + 70, y + 22, 'STANDBY', '#4f545c', '#e8eaed')
            : pastilla(PAD + 70, y + 22, h.desde ? `OFFLINE · ${h.desde}` : 'OFFLINE', '#ed4245', '#ffffff');
        const chips = [
            [h.alDia ? 'up to date' : 'updating…', h.alDia ? '#3ddc84' : '#f5a518'],
            on && h.motor ? [`Miguel's bot ${h.motor}`, '#c9cdd2'] : null,
            on && h.links != null ? [`${h.links} Monitor Link`, '#c9cdd2'] : null,
            on && h.proxies != null ? [`GP farm · ${h.proxies} proxies`, '#c9cdd2'] : null,
        ].filter(Boolean);
        let cx = PAD + 70;
        const svgChips = chips.map(([t, c]) => {
            const w = 26 + t.length * 10.2;
            const s = `<rect x="${cx}" y="${y + 100}" width="${w}" height="32" rx="10" fill="#2b2d34"/>
                <text x="${cx + 13}" y="${y + 122}" ${F} font-size="17" font-weight="600" fill="${c}">${xml(t)}</text>`;
            cx += w + 10;
            return s;
        }).join('');
        return `<rect x="${PAD - 12}" y="${y}" width="${W - 2 * PAD + 24}" height="${ALTO_FILA}" rx="18" fill="${h.estado === 'turn' ? '#26282f' : '#222429'}" ${h.estado === 'turn' ? 'stroke="#f5c518" stroke-opacity="0.45" stroke-width="2"' : ''}/>
            <circle cx="${PAD + 26}" cy="${y + 40}" r="13" fill="${on ? '#3ddc84' : '#ed4245'}"/>
            ${p.svg}
            <text x="${PAD + 70 + p.w + 16}" y="${y + 47}" ${F} font-size="28" font-weight="800" fill="${on ? '#ffffff' : '#9aa0a6'}">${xml(limpio(h.nombre))}</text>
            <text x="${PAD + 70}" y="${y + 84}" ${F} font-size="19" fill="#9aa0a6">bot <tspan fill="#e8eaed" font-weight="600">${xml(limpio(h.bot))}</tspan>   ·   ${xml(limpio(h.version, 24))}</text>
            ${svgChips}`;
    }).join('');
    const alto = TOP + hosts.length * (ALTO_FILA + 14) + 50;
    const titulo = pastilla(PAD, PAD + 4, 'COMMUNITY HOSTS', color, '#ffffff');
    const cuerpo = `${titulo.svg}
        <text x="${PAD}" y="${PAD + 92}" ${F} font-size="18" fill="#9aa0a6">The host with the turn answers the commands and the Monitor Links · the others wait</text>
        ${filas}`;
    return sharp(Buffer.from(marco(alto, color, cuerpo))).png().toBuffer();
}

// d: { miembros, linkOn, cuentas, con96, elegibles, bloqueadas, compartidas, deMiembros }
async function tarjetaCuentas(d) {
    const sharp = require('sharp');
    const color = '#f5c518';
    const cuadro = (x, y, w, k, v, sub = '') => `<rect x="${x}" y="${y}" width="${w}" height="120" rx="16" fill="#2b2d34"/>
        <text x="${x + 22}" y="${y + 40}" ${F} font-size="16" font-weight="600" fill="#9aa0a6" letter-spacing="1.5">${k}</text>
        <text x="${x + 22}" y="${y + 92}" ${F} font-size="40" font-weight="700" fill="#ffffff">${xml(v)}<tspan dx="10" font-size="20" fill="#9aa0a6" font-weight="600">${sub ? xml(sub) : ''}</tspan></text>`;
    const w3 = (W - 2 * PAD - 24) / 3;
    const pct = d.con96 ? d.elegibles / d.con96 : 0;
    const BY = 330, BW = W - 2 * PAD;
    const cuerpo = `${pastilla(PAD, PAD + 4, 'COMMUNITY ACCOUNTS', color).svg}
        ${cuadro(PAD, 110, w3, 'LINKED MEMBERS', n(d.miembros))}
        ${cuadro(PAD + w3 + 12, 110, w3, 'MONITOR LINK ON', n(d.linkOn), `of ${n(d.miembros)}`)}
        ${cuadro(PAD + 2 * (w3 + 12), 110, w3, 'ACCOUNTS', n(d.cuentas))}
        <text x="${PAD}" y="${BY - 50}" ${F} font-size="17" font-weight="700" fill="#9aa0a6" letter-spacing="1.5">ACCOUNTS WITH 96+ PACKS</text>
        <text x="${W - PAD}" y="${BY - 50}" ${F} font-size="22" font-weight="800" fill="#ffffff" text-anchor="end">${n(d.con96)}</text>
        <rect x="${PAD}" y="${BY - 30}" width="${BW}" height="26" rx="13" fill="#4f3b3b"/>
        <rect x="${PAD}" y="${BY - 30}" width="${Math.max(26, Math.round(pct * BW))}" height="26" rx="13" fill="#3ddc84"/>
        <circle cx="${PAD + 10}" cy="${BY + 30}" r="9" fill="#3ddc84"/>
        <text x="${PAD + 30}" y="${BY + 37}" ${F} font-size="22" font-weight="600" fill="#e8eaed">God Pack eligible  <tspan font-weight="800" fill="#ffffff">${n(d.elegibles)}</tspan>  <tspan fill="#3ddc84" font-weight="700">${Math.round(pct * 100)}%</tspan></text>
        <circle cx="${W / 2 + 60}" cy="${BY + 30}" r="9" fill="#c25b5b"/>
        <text x="${W / 2 + 80}" y="${BY + 37}" ${F} font-size="22" font-weight="600" fill="#e8eaed">Locked  <tspan font-weight="800" fill="#ffffff">${n(d.bloqueadas)}</tspan>  <tspan fill="#c25b5b" font-weight="700">${Math.round((1 - pct) * 100)}%</tspan></text>
        <rect x="${PAD}" y="${BY + 80}" width="${BW}" height="110" rx="16" fill="#2b2d34"/>
        <text x="${PAD + 22}" y="${BY + 120}" ${F} font-size="16" font-weight="600" fill="#9aa0a6" letter-spacing="1.5">SHARED FOR THE GP FARM</text>
        <text x="${PAD + 22}" y="${BY + 168}" ${F} font-size="40" font-weight="700" fill="${color}">${n(d.compartidas)}</text>
        <text x="${W - PAD - 22}" y="${BY + 168}" ${F} font-size="20" fill="#9aa0a6" text-anchor="end">${Math.round(d.compartidas / Math.max(1, d.cuentas) * 100)}% of all accounts</text>
        <text x="${PAD}" y="${BY + 240}" ${F} font-size="17" fill="#9aa0a6">GP totals from ${n(d.deMiembros)} of ${n(d.miembros)} members · Locked = a 30+ day pause, it needs 96 packs again</text>`;
    return sharp(Buffer.from(marco(BY + 280, color, cuerpo))).png().toBuffer();
}


// Amigos de cada miembro (Ale 2026-11-12): quien tiene Monitor Link y, abajo, a quien anoto como amigo,
// cada uno con su nombre y su @usuario de Discord (Ale: el nombre, no el ID).
// grupos: [{ dueno, duenoUser, online, amigos: [{ nombre, user, id }] }]   nombre null = no esta en el servidor (sale su ID)
async function tarjetaAmigos(grupos) {
    const sharp = require('sharp');
    const color = '#a970ff', LINEA = 40;
    const lista = [...grupos].sort((a, b) => b.amigos.length - a.amigos.length || String(a.dueno).localeCompare(String(b.dueno)));
    const XC = PAD + 56, XID = 520;
    let y = 168, svg = '';
    lista.forEach((g, i) => {
        const alto = 62 + g.amigos.length * LINEA + 10;
        const filas = g.amigos.map((a, k) => {
            const yy = y + 62 + k * LINEA + 26;
            const ultimo = k === g.amigos.length - 1;
            return `<path d="M ${PAD + 14} ${yy - 34} V ${yy - 7} H ${XC - 12}" stroke="#4a4d55" stroke-width="2" fill="none"/>
                ${ultimo ? '' : ''}
                <text x="${XC}" y="${yy}" ${F} font-size="21" font-weight="600" fill="${a.nombre ? '#e3d4ff' : '#9aa0a6'}">${xml(a.nombre ? limpio(a.nombre, 26) : 'Not in the server')}</text>
                <text x="${XID}" y="${yy}" font-family="Consolas, Menlo, monospace" font-size="19" fill="#9aa0a6">${xml(a.user ? '@' + a.user : 'ID ' + a.id)}</text>`;
        }).join('');
        svg += `<rect x="${PAD - 12}" y="${y}" width="${W - 2 * PAD + 24}" height="${alto}" rx="16" fill="${i % 2 ? '#202227' : '#24262c'}"/>
            <circle cx="${PAD + 14}" cy="${y + 30}" r="9" fill="${g.online ? '#3ddc84' : '#6f747c'}"/>
            <text x="${PAD + 36}" y="${y + 38}" ${F} font-size="24" font-weight="800" fill="#ffffff">${xml(limpio(g.dueno))}</text>
            <text x="${XID}" y="${y + 38}" font-family="Consolas, Menlo, monospace" font-size="19" fill="#c9cdd2">${xml(g.duenoUser ? '@' + g.duenoUser : '')}</text>
            <text x="${W - PAD}" y="${y + 38}" ${F} font-size="17" font-weight="600" fill="#9aa0a6" text-anchor="end">${g.amigos.length} friend${g.amigos.length === 1 ? '' : 's'}</text>
            ${filas}`;
        y += alto + 10;
    });
    const total = lista.reduce((a, g) => a + g.amigos.length, 0);
    const cuerpo = `${pastilla(PAD, PAD + 4, 'MONITOR LINK FRIENDS', color, '#ffffff').svg}
        <text x="${PAD}" y="${PAD + 78}" ${F} font-size="18" fill="#9aa0a6">${lista.length} members share their accounts with ${total} friends · friends use the bot without Monitor Link</text>
         <text x="${PAD + 36}" y="150" ${F} font-size="15" font-weight="700" fill="#6f747c" letter-spacing="1.5">MEMBER / FRIENDS</text>
        <text x="${XID}" y="150" ${F} font-size="15" font-weight="700" fill="#6f747c" letter-spacing="1.5">DISCORD USER</text>
        ${svg ? svg.replace(/^/, '') : `<text x="${PAD}" y="190" ${F} font-size="20" fill="#9aa0a6">Nobody has added friends yet</text>`}
        <circle cx="${PAD + 10}" cy="${y + 30}" r="7" fill="#3ddc84"/><text x="${PAD + 24}" y="${y + 36}" ${F} font-size="16" fill="#9aa0a6">Monitor Link on</text>
        <circle cx="${PAD + 180}" cy="${y + 30}" r="7" fill="#6f747c"/><text x="${PAD + 194}" y="${y + 36}" ${F} font-size="16" fill="#9aa0a6">off</text>`;
    return sharp(Buffer.from(marco(y + 70, color, cuerpo))).png().toBuffer();
}

module.exports = { tarjetaHosts, tarjetaCuentas, tarjetaAmigos, logo };
