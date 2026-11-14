// 🏆 All Missions (Ale 2026-11-14): colecciones tematicas de cada expansion (que cartas pide y que premio da),
// como tarjeta-imagen igual que las demas del bot. Datos: assets/missions/themed_collections.json (sacado de
// Serebii una vez); logos de premios en assets/missions/ (rewards_icons.json); cartas con las imagenes del bot.
const path = require('path');
const fs = require('fs');

const DIR = path.join(__dirname, 'assets', 'missions');
const POR_PAGINA = 4;
let _datos = null;
function datos() {
    if (!_datos) {
        try { _datos = JSON.parse(fs.readFileSync(path.join(DIR, 'themed_collections.json'), 'utf8')); } catch (e) { _datos = { expansions: [] }; }
        try { _datos.logos = JSON.parse(fs.readFileSync(path.join(DIR, 'rewards_icons.json'), 'utf8')); } catch (e) { _datos.logos = {}; }
    }
    return _datos;
}
const expansiones = () => datos().expansions.map(e => ({ nombre: e.expansion, total: e.collections.length, paginas: Math.ceil(e.collections.length / POR_PAGINA) }));
const buscar = (nombre) => datos().expansions.find(e => e.expansion.toLowerCase() === String(nombre).toLowerCase()) || null;

// Iconos del bot para los premios comunes (mismos que los emojis del servidor).
const ICONOS_BOT = {
    'Pack Hourglass': 'Reloj_de_arena_de_sobres_TCGP.png', 'Wonder Hourglass': 'Reloj_de_arena_magico_TCGP.png',
    'Shop Ticket': 'Cupon_de_tienda_TCGP.png', 'Shinedust': 'Polvo_iris_TCGP.png', 'Trade Hourglass': 'Reloj_de_arena_de_intercambio_TCGP.png',
};
const PREFIJO = { icon: 'Icon', binders: 'Binder', playmats: 'Playmat', sleeves: 'Sleeve', coin: 'Coin' };
const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// imagenCarta(id) -> ruta de la imagen (la da bot.js: CardImageCache / repo de cartas).
async function armarTarjetaMisiones({ expansion, pagina = 0, imagenCarta }) {
    const sharp = require('sharp');
    const exp = buscar(expansion);
    if (!exp) return null;
    const total = Math.ceil(exp.collections.length / POR_PAGINA);
    pagina = Math.min(Math.max(0, pagina), total - 1);
    const cols = exp.collections.slice(pagina * POR_PAGINA, (pagina + 1) * POR_PAGINA);
    const { logos } = datos();

    const W = 1100, PAD = 34, CW = 64, CH = 89, GAP = 8, GGAP = 22;
    const ZX0 = PAD + 6, ZX1 = 700;                 // zona de cartas
    const RX0 = 726, RX1 = W - PAD - 4;             // zona de premios
    const LBL = 30, LINEA = LBL + CH + 12, TITULO = 54, ICO = 64, RFILA = 76;
    const capas = [];
    let svg = '';

    const cacheImg = new Map();
    async function miniCarta(id) {
        const k = `c${id}`;
        if (cacheImg.has(k)) return cacheImg.get(k);
        let buf;
        const p = id ? await imagenCarta(id).catch(() => null) : null;
        const mask = Buffer.from(`<svg width="${CW}" height="${CH}"><rect width="${CW}" height="${CH}" rx="5" ry="5"/></svg>`);
        if (p) buf = await sharp(p).resize(CW, CH, { fit: 'cover' }).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
        else buf = await sharp({ create: { width: CW, height: CH, channels: 4, background: '#2a2f45' } }).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
        cacheImg.set(k, buf);
        return buf;
    }
    async function logoPremio(r) {
        const base = r.item.replace(/\s*\(.*\)$/, '');
        const archivo = ICONOS_BOT[base] ? path.join(__dirname, 'assets', 'element', ICONOS_BOT[base])
            : logos[r.item] ? path.join(DIR, logos[r.item]) : null;
        if (/card$/i.test(r.item) && !ICONOS_BOT[base]) {
            // premio = una carta: la imagen del bot (mas nitida que el logo)
            const nombre = r.item.replace(/ card$/i, '').toLowerCase();
            const id = exp.collections.flatMap(c => c.groups.flatMap(g => g.cards)).find(c => c.name.toLowerCase() === nombre)?.id;
            const p = id ? await imagenCarta(id).catch(() => null) : null;
            if (p) return sharp(p).resize(Math.round(ICO * 0.72), ICO, { fit: 'cover' }).png().toBuffer();
        }
        if (!archivo || !fs.existsSync(archivo)) return null;
        const redondo = ['icon', 'binders', 'playmats', 'sleeves'].includes(r.type);
        let s = sharp(archivo).resize(ICO, ICO, { fit: redondo ? 'cover' : 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } });
        if (redondo) {
            const mask = Buffer.from(`<svg width="${ICO}" height="${ICO}"><rect width="${ICO}" height="${ICO}" rx="${r.type === 'icon' ? ICO / 2 : 12}"/></svg>`);
            s = s.composite([{ input: mask, blend: 'dest-in' }]);
        }
        return s.png().toBuffer();
    }

    // 1) Medir cada coleccion: cartas en lineas (max 2), cada grupo con su etiqueta encima.
    const medidas = cols.map(c => {
        const piezas = [];   // {tipo:'carta', id, etiqueta?} | {tipo:'texto', texto}
        const anyVer = c.groups.some(g => g.cards.length === 1 && g.cards[0].anyVersion);
        for (const g of c.groups) {
            if (g.text) { piezas.push({ tipo: 'texto', texto: `Any ${g.text}` }); continue; }
            const et = g.any && g.cards.length > 1 ? `ANY OF ${g.cards.length}` : g.cards.length > 1 ? `ALL ${g.cards.length}` : '';
            // Una carta suelta ("any version") no abre un grupo nuevo: van juntas, con el espacio normal.
            const suelta = g.cards.length === 1 && !et;
            g.cards.forEach((k, i) => piezas.push({ tipo: 'carta', id: k.id, etiqueta: i === 0 ? et : '', inicioGrupo: i === 0 && !suelta }));
        }
        const lineas = [[]];
        let ancho = 0, sobran = 0;
        const maxW = ZX1 - ZX0;
        for (const p of piezas) {
            const w = p.tipo === 'texto' ? Math.round(p.texto.length * 9.5 + 28) : CW;
            const extra = lineas[lineas.length - 1].length ? (p.inicioGrupo || p.tipo === 'texto' ? GGAP : GAP) : 0;
            if (ancho + extra + w > maxW - (lineas.length === 2 ? 110 : 0)) {
                if (lineas.length === 2) { sobran++; continue; }
                lineas.push([]); ancho = 0;
            }
            const ex = lineas[lineas.length - 1].length ? (p.inicioGrupo || p.tipo === 'texto' ? GGAP : GAP) : 0;
            lineas[lineas.length - 1].push({ ...p, w, ex });
            ancho += ex + w;
        }
        const nLineas = lineas.filter(l => l.length).length;
        const altoCartas = TITULO + (anyVer ? 34 : 0) + nLineas * LINEA;
        const altoPremios = TITULO - 18 + Math.max(1, c.rewards.length) * RFILA;
        return { c, lineas: lineas.filter(l => l.length), sobran, anyVer, alto: Math.max(170, altoCartas, altoPremios) + 18 };
    });

    const TOP = 122;
    const H = TOP + medidas.reduce((s, m) => s + m.alto + 16, 0) + 18;
    svg += `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#151a2e"/><stop offset="1" stop-color="#0d1020"/></linearGradient></defs>
<rect width="${W}" height="${H}" rx="26" fill="url(#bg)"/>
<text x="${PAD}" y="58" font-family="Segoe UI, Arial" font-weight="800" font-size="34" fill="#ffffff">${esc(exp.expansion.toUpperCase())}</text>
<text x="${PAD}" y="92" font-family="Segoe UI, Arial" font-size="19" fill="#9aa3c7" letter-spacing="1.5">THEMED COLLECTIONS · ${exp.collections.length} MISSIONS · PAGE ${pagina + 1}/${total}</text>`;

    let y = TOP;
    for (const m of medidas) {
        const { c } = m;
        svg += `<rect x="${PAD - 12}" y="${y}" width="${W - 2 * PAD + 24}" height="${m.alto}" rx="18" fill="#1d2340" stroke="#2c3560"/>`;
        svg += `<text x="${(ZX0 + ZX1) / 2}" y="${y + 38}" text-anchor="middle" font-family="Segoe UI, Arial" font-weight="700" font-size="23" fill="#ffd54f">${esc(c.name.slice(0, 48))}</text>`;
        // 2) Cartas: cada linea centrada en su zona; bloque centrado en alto.
        const altoBloque = (m.anyVer ? 34 : 0) + m.lineas.length * LINEA;
        let ly = Math.round(y + TITULO + Math.max(0, (m.alto - TITULO - 12 - altoBloque) / 2));
        if (m.anyVer) {
            const t = 'ANY VERSION OF EACH CARD', w = t.length * 9 + 26, x = (ZX0 + ZX1) / 2 - w / 2;
            svg += `<rect x="${x}" y="${ly}" width="${w}" height="26" rx="13" fill="#1f4d3a"/><text x="${x + w / 2}" y="${ly + 18}" text-anchor="middle" font-family="Segoe UI, Arial" font-weight="700" font-size="14" fill="#7CF29A">${t}</text>`;
            ly += 34;
        }
        for (let li = 0; li < m.lineas.length; li++) {
            const linea = m.lineas[li];
            const anchoL = linea.reduce((s, p) => s + p.ex + p.w, 0) + (li === m.lineas.length - 1 && m.sobran ? 110 : 0);
            let x = Math.round((ZX0 + ZX1) / 2 - anchoL / 2);
            for (const p of linea) {
                x += p.ex;
                if (p.tipo === 'texto') {
                    svg += `<rect x="${x}" y="${ly + LBL + CH / 2 - 16}" width="${p.w}" height="32" rx="16" fill="#4a3a1a"/><text x="${x + p.w / 2}" y="${ly + LBL + CH / 2 + 6}" text-anchor="middle" font-family="Segoe UI, Arial" font-weight="700" font-size="16" fill="#ffd54f">${esc(p.texto)}</text>`;
                } else {
                    if (p.etiqueta) svg += `<text x="${x}" y="${ly + 20}" font-family="Segoe UI, Arial" font-weight="800" font-size="14" fill="#c7d0ff" letter-spacing="1">${p.etiqueta}</text>`;
                    capas.push({ input: await miniCarta(p.id), left: x, top: ly + LBL });
                }
                x += p.w;
            }
            if (li === m.lineas.length - 1 && m.sobran) {
                svg += `<text x="${x + 18}" y="${ly + LBL + CH / 2 + 7}" font-family="Segoe UI, Arial" font-weight="700" font-size="19" fill="#9aa3c7">+${m.sobran} more</text>`;
            }
            ly += LINEA;
        }
        // 3) Premios: logos grandes, centrados en alto.
        svg += `<line x1="${RX0 - 14}" y1="${y + 18}" x2="${RX0 - 14}" y2="${y + m.alto - 18}" stroke="#2c3560" stroke-width="2"/>`;
        const n = Math.max(1, c.rewards.length);
        const altoP = 26 + n * RFILA;
        let ry = Math.round(y + Math.max(14, (m.alto - altoP) / 2));
        svg += `<text x="${RX0}" y="${ry + 14}" font-family="Segoe UI, Arial" font-weight="700" font-size="14" fill="#9aa3c7" letter-spacing="2">REWARDS</text>`;
        ry += 26;
        for (const r of c.rewards) {
            const img = await logoPremio(r).catch(() => null);
            const base = r.item.replace(/\s*\(.*\)$/, '');
            const etiqueta = PREFIJO[r.type] ? `${PREFIJO[r.type]}: ${r.item}` : base;
            if (img) {
                const meta = await sharp(img).metadata();
                capas.push({ input: img, left: RX0 + Math.round((ICO - meta.width) / 2), top: Math.round(ry + (RFILA - 8 - meta.height) / 2) });
            }
            const largo = etiqueta.length > 20;
            svg += `<text x="${RX0 + ICO + 14}" y="${ry + RFILA / 2 + 3}" font-family="Segoe UI, Arial" font-weight="700" font-size="${largo ? 17 : 20}" fill="#ffffff">${esc(etiqueta.slice(0, 30))}</text>`;
            if (r.qty) svg += `<text x="${RX1}" y="${ry + RFILA / 2 + 4}" text-anchor="end" font-family="Segoe UI, Arial" font-weight="800" font-size="24" fill="#7CF29A">x${r.qty}</text>`;
            ry += RFILA;
        }
        y += m.alto + 16;
    }
    svg += '</svg>';
    const logo = path.join(__dirname, 'assets', 'embeds', 'symbol.png');
    if (fs.existsSync(logo)) capas.push({ input: await sharp(logo).resize(112, 78, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer(), left: W - PAD - 112, top: 20 });
    return sharp(Buffer.from(svg)).composite(capas).png().toBuffer();
}

// Detalle de UNA mision (Ale 2026-11-14: "ese +14 more, como seria para que vean las cartas?"): todas sus cartas,
// mas grandes, cada grupo en su bloque con su etiqueta; premios a la derecha.
async function armarDetalleMision({ expansion, indice, imagenCarta }) {
    const sharp = require('sharp');
    const exp = buscar(expansion);
    const c = exp?.collections[indice];
    if (!c) return null;
    const { logos } = datos();
    const W = 1100, PAD = 34, CW = 86, CH = 120, GAP = 10, POR_FILA = 7;
    const ZX0 = PAD + 6, ZX1 = 740, RX0 = 772, RX1 = W - PAD - 4, ICO = 72, RFILA = 86;
    const capas = [];
    const mask = Buffer.from(`<svg width="${CW}" height="${CH}"><rect width="${CW}" height="${CH}" rx="6" ry="6"/></svg>`);
    const carta = async (id) => {
        const p = id ? await imagenCarta(id).catch(() => null) : null;
        return p ? sharp(p).resize(CW, CH, { fit: 'cover' }).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer()
            : sharp({ create: { width: CW, height: CH, channels: 4, background: '#2a2f45' } }).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
    };
    // bloques: un grupo = etiqueta + sus cartas en filas de 7
    const bloques = c.groups.map(g => {
        if (g.text) return { texto: `Any ${g.text}`, cartas: [] };
        const et = g.any && g.cards.length > 1 ? `ANY ${1} OF THESE ${g.cards.length}`.replace('ANY 1 OF', 'ANY OF') : g.cards.length > 1 ? `ALL ${g.cards.length} OF THESE` : (g.cards[0]?.anyVersion ? 'ANY VERSION' : '');
        return { etiqueta: et, cartas: g.cards };
    });
    // juntar las cartas sueltas "any version" en un solo bloque
    const juntos = [];
    for (const b of bloques) {
        const prev = juntos[juntos.length - 1];
        if (b.etiqueta === 'ANY VERSION' && prev?.etiqueta === 'ANY VERSION OF EACH') prev.cartas.push(...b.cartas);
        else juntos.push(b.etiqueta === 'ANY VERSION' ? { etiqueta: 'ANY VERSION OF EACH', cartas: [...b.cartas] } : b);
    }
    const altoBloque = (b) => b.texto ? 56 : 34 + Math.ceil(b.cartas.length / POR_FILA) * (CH + GAP) + 6;
    const altoCartas = juntos.reduce((s, b) => s + altoBloque(b), 0);
    const altoPremios = 40 + c.rewards.length * RFILA;
    const TOP = 150;
    const H = TOP + Math.max(altoCartas, altoPremios) + 40;
    let svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#151a2e"/><stop offset="1" stop-color="#0d1020"/></linearGradient></defs>
<rect width="${W}" height="${H}" rx="26" fill="url(#bg)"/>
<text x="${PAD}" y="56" font-family="Segoe UI, Arial" font-size="19" fill="#9aa3c7" letter-spacing="1.5">${esc(exp.expansion.toUpperCase())} · MISSION ${indice + 1}/${exp.collections.length}</text>
<text x="${PAD}" y="100" font-family="Segoe UI, Arial" font-weight="800" font-size="32" fill="#ffd54f">${esc(c.name.slice(0, 50))}</text>
<line x1="${PAD}" y1="${TOP - 22}" x2="${W - PAD}" y2="${TOP - 22}" stroke="#2c3560" stroke-width="2"/>`;
    let y = TOP;
    for (const b of juntos) {
        if (b.texto) {
            const w = b.texto.length * 10 + 36;
            svg += `<rect x="${ZX0}" y="${y}" width="${w}" height="38" rx="19" fill="#4a3a1a"/><text x="${ZX0 + w / 2}" y="${y + 26}" text-anchor="middle" font-family="Segoe UI, Arial" font-weight="700" font-size="18" fill="#ffd54f">${esc(b.texto)}</text>`;
            y += 56;
            continue;
        }
        if (b.etiqueta) svg += `<text x="${ZX0}" y="${y + 20}" font-family="Segoe UI, Arial" font-weight="800" font-size="16" fill="#c7d0ff" letter-spacing="1.5">${b.etiqueta}</text>`;
        let i = 0;
        for (const k of b.cartas) {
            const fila = Math.floor(i / POR_FILA), col = i % POR_FILA;
            capas.push({ input: await carta(k.id), left: ZX0 + col * (CW + GAP), top: y + 34 + fila * (CH + GAP) });
            i++;
        }
        y += altoBloque(b);
    }
    svg += `<line x1="${RX0 - 16}" y1="${TOP}" x2="${RX0 - 16}" y2="${H - 30}" stroke="#2c3560" stroke-width="2"/>`;
    svg += `<text x="${RX0}" y="${TOP + 16}" font-family="Segoe UI, Arial" font-weight="700" font-size="15" fill="#9aa3c7" letter-spacing="2">REWARDS</text>`;
    let ry = TOP + 36;
    for (const r of c.rewards) {
        const base = r.item.replace(/\s*\(.*\)$/, '');
        const archivo = ICONOS_BOT[base] ? path.join(__dirname, 'assets', 'element', ICONOS_BOT[base]) : logos[r.item] ? path.join(DIR, logos[r.item]) : null;
        if (archivo && fs.existsSync(archivo)) {
            const redondo = ['icon', 'binders', 'playmats', 'sleeves'].includes(r.type);
            let s = sharp(archivo).resize(ICO, ICO, { fit: redondo ? 'cover' : 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } });
            if (redondo) s = s.composite([{ input: Buffer.from(`<svg width="${ICO}" height="${ICO}"><rect width="${ICO}" height="${ICO}" rx="${r.type === 'icon' ? ICO / 2 : 12}"/></svg>`), blend: 'dest-in' }]);
            capas.push({ input: await s.png().toBuffer(), left: RX0, top: ry });
        }
        const etiqueta = PREFIJO[r.type] ? `${PREFIJO[r.type]}: ${r.item}` : base;
        svg += `<text x="${RX0 + ICO + 14}" y="${ry + ICO / 2 + 7}" font-family="Segoe UI, Arial" font-weight="700" font-size="${etiqueta.length > 14 ? 16 : 19}" fill="#ffffff">${esc(etiqueta.slice(0, 26))}</text>`;
        if (r.qty) svg += `<text x="${RX1}" y="${ry + ICO / 2 + 8}" text-anchor="end" font-family="Segoe UI, Arial" font-weight="800" font-size="24" fill="#7CF29A">x${r.qty}</text>`;
        ry += RFILA;
    }
    svg += '</svg>';
    const logo = path.join(__dirname, 'assets', 'embeds', 'symbol.png');
    if (fs.existsSync(logo)) capas.push({ input: await sharp(logo).resize(112, 78, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer(), left: W - PAD - 112, top: 20 });
    return sharp(Buffer.from(svg)).composite(capas).png().toBuffer();
}

// Nombres de las misiones de una pagina (para la lista "View a mission").
const misionesDePagina = (expansion, pagina) => (buscar(expansion)?.collections || [])
    .map((c, i) => ({ indice: i, nombre: c.name })).slice(pagina * POR_PAGINA, (pagina + 1) * POR_PAGINA);

module.exports = { armarTarjetaMisiones, armarDetalleMision, misionesDePagina, expansiones, POR_PAGINA };
