// Sobres de las expansiones que tienen mas de uno (Ale 2026-11-14): Genetic Apex (Mewtwo/Charizard/Pikachu),
// Space-Time Smackdown (Dialga/Palkia), Celestial Guardians (Solgaleo/Lunala), Wisdom of Sea and Sky (Ho-Oh/Lugia),
// Mega Rising (Mega Blaziken/Gyarados/Altaria), Dual Fusion (Mega Mewtwo X/Pikachu).
// Datos: assets/packs/card_packs.json (de Serebii: que sobre trae cada carta, por numero y por nombre) y los
// logos de WikiDex en assets/packs/. Una carta puede salir en varios sobres de su expansion.
const path = require('path');
const fs = require('fs');

const DIR = path.join(__dirname, 'assets', 'packs');
let _datos = null;
const datos = () => {
    if (!_datos) { try { _datos = JSON.parse(fs.readFileSync(path.join(DIR, 'card_packs.json'), 'utf8')); } catch (e) { _datos = {}; } }
    return _datos;
};
const norm = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9]/g, '');
// Separador del nombre "virtual" de expansion + sobre ("Genetic Apex · Pikachu").
const SEP = ' · ';

// Sobres de una expansion (por su codigo, ej. "A1"), o null si tiene uno solo.
function sobresDe(expansionId) {
    const d = datos()[String(expansionId || '')];
    return d && d.packs.length > 1 ? d.packs : null;
}
const logoDe = (expansionId, sobre) => {
    const f = datos()[expansionId]?.logos?.[sobre];
    return f ? path.join(DIR, f) : null;
};

// En que sobre(s) sale una carta del catalogo del bot ({ id, nombre, expansionId }). cardMap: el de bot.js.
function sobresDeCarta(carta, cardMap) {
    const d = datos()[carta.expansionId];
    if (!d) return [];
    const info = cardMap?.[carta.id];
    if (info && info.ExpansionID === carta.expansionId && d.byNum[String(info.CollectionNumber)]) return d.byNum[String(info.CollectionNumber)];
    return d.byName[norm(carta.nombre)] || [];
}

// Entradas extra del catalogo: una por sobre en que sale cada carta, con expansion "Genetic Apex · Pikachu" y
// `sobre`. Asi el resto del bot (que filtra por c.expansion === X) funciona igual eligiendo un sobre.
function entradasPorSobre(cartas, cardMap) {
    const extra = [];
    for (const c of cartas) {
        if (c.sobre || !sobresDe(c.expansionId)) continue;
        for (const s of sobresDeCarta(c, cardMap)) extra.push({ ...c, expansion: `${c.expansion}${SEP}${s}`, sobre: s, extra: true });
    }
    return extra;
}

// Imagen para elegir sobre: los logos uno al lado del otro, sobre fondo oscuro.
async function imagenSobres(expansionId, titulo) {
    const sharp = require('sharp');
    const sobres = sobresDe(expansionId);
    if (!sobres) return null;
    const W = 1000, H = 230, ALTO = 74;
    const ancho = Math.floor((W - 80) / sobres.length) - 20;
    const capas = [];
    for (let i = 0; i < sobres.length; i++) {
        const f = logoDe(expansionId, sobres[i]);
        if (!f || !fs.existsSync(f)) continue;
        const buf = await sharp(f).resize(ancho, ALTO, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
        capas.push({ input: buf, left: 40 + i * (ancho + 20) + 10, top: 110 });
    }
    const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#151a2e"/><stop offset="1" stop-color="#0d1020"/></linearGradient></defs>
<rect width="${W}" height="${H}" rx="24" fill="url(#bg)"/>
<text x="40" y="58" font-family="Segoe UI, Arial" font-weight="800" font-size="32" fill="#ffffff">${esc(String(titulo).toUpperCase())}</text>
<text x="40" y="90" font-family="Segoe UI, Arial" font-size="18" fill="#9aa3c7" letter-spacing="1.5">CHOOSE A BOOSTER PACK</text></svg>`;
    return sharp(Buffer.from(svg)).composite(capas).png().toBuffer();
}

module.exports = { sobresDe, sobresDeCarta, entradasPorSobre, imagenSobres, SEP };
