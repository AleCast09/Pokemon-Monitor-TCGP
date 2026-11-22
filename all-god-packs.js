// Canal "all god packs" (Ale 2026-11-22): cada God Pack de los hosts de la comunidad (vivo o muerto) con su
// imagen (cartas en arco, brillo del color de cada carta, logo de la expansion + mini logo del sobre arriba al
// centro) y, una vez por dia a las 23:59, el resumen del dia. Lo publica solo el host que tiene el turno; lo ya
// publicado queda marcado en Upstash, asi un cambio de turno no repite nada.
const fs = require('fs');
const path = require('path');
const { EmbedBuilder, AttachmentBuilder } = require('discord.js');

// (Ale 2026-11-22) Va dentro de la categoria Elite_Reroll, junto a godpack_gallery y heartbeat_elite_four.
const CANAL = '📚all_god_packs';
const CATEGORIA = /elite[\s_-]*reroll/i;
const esCanal = c => /all[\s_-]*god[\s_-]*packs?/i.test(c.name) && c.isTextBased?.();
const DIR_EXP = path.join(__dirname, 'assets', 'expansions');
const DIR_PACKS = path.join(__dirname, 'assets', 'packs');
// Mismo mapa que motor-panel/discord_notifier.py (PACK_TAG_MAP): God Packs viejos sin pack_id.
const TAG_A_PACK = {
    DeluxeB: 'BN011_0010_00_000', RocketA: 'BN010_0010_00_000', MegaAltaria: 'BN001_0030_00_000', Charizard: 'BN001_0010_00_000',
    Mewtwo: 'BN001_0020_00_000', Pikachu: 'BN001_0040_00_000', DualMewtwo: 'CN001_0010_00_000', DualPikachu: 'CN001_0020_00_000',
};

let deps = null;   // { client, host (community-host), motor: () => ruta, log }
const log = (...a) => (deps?.log || console.log)('[all-gp]', ...a);

// ---------- datos de cada God Pack ----------
function etiquetas(h) {
    const t = String(h.tags || '');
    const rareza = (/\[(\d)\/5\]/.exec(t) || [])[1];
    const sobres = Number((/\[(\d+)P\]/.exec(t) || [])[1] || 0);
    const tag = (/\]\[([A-Za-z0-9_]+)\]$/.exec(t) || [])[1] || '';
    return { rareza: rareza ? Number(rareza) : null, sobres, packId: h.pack_id || TAG_A_PACK[tag] || (/^[A-Z]N\d{3}_/.test(tag) ? tag : '') };
}

// Nombre y expansion del sobre, del catalogo del motor (scripts/flow/pack_catalog.py).
function infoSobre(packId) {
    try {
        const cat = fs.readFileSync(path.join(deps.motor(), 'scripts', 'flow', 'pack_catalog.py'), 'utf8');
        const id = String(packId).replace(/[^A-Za-z0-9_]/g, '');
        const m = new RegExp(`"name":\\s*"([^"]+)",\\s*"expansion_id":\\s*"([^"]+)"[^}]*?"pack_id":\\s*"${id}"`).exec(cat);
        if (!m) return null;
        const [expansion, sobre] = m[1].split(/:\s*/);
        return { nombre: m[1], expansion: expansion.trim(), sobre: (sobre || '').trim(), set: m[2].toUpperCase() };
    } catch (e) { return null; }
}

function logoExpansion(expansion) {
    const dir = path.join(DIR_EXP, expansion);
    const f = path.join(dir, `${expansion}.png`);
    if (fs.existsSync(f)) return f;
    try { const otro = fs.readdirSync(dir).find(n => /\.png$/i.test(n) && n !== 'symbol.png'); return otro ? path.join(dir, otro) : null; } catch (e) { return null; }
}

let _packs = null;
function miniLogo(set, sobre) {
    if (!sobre) return null;
    try {
        _packs = _packs || JSON.parse(fs.readFileSync(path.join(DIR_PACKS, 'card_packs.json'), 'utf8'));
        const logos = _packs[set]?.logos || {};
        const k = Object.keys(logos).find(x => x.toLowerCase().replace(/[^a-z0-9]/g, '') === sobre.toLowerCase().replace(/[^a-z0-9]/g, ''));
        return k ? path.join(DIR_PACKS, logos[k]) : null;
    } catch (e) { return null; }
}

// ---------- imagen en arco (diseño B elegido por Ale) ----------
const CW = 367, CH = 512, GAP = 34, M = 90, RADIO = 18, BAJADA = [0, 75, 150, 75, 0];

let _imagenes = null;   // id -> archivo de la imagen (statics/cards.json del motor)
const _rarezas = new Map();   // id -> rareza (C, U, R, RR, AR, SR, SAR, IM, S, SSR, UR)
function nombreImagen(id) {
    if (!_imagenes) {
        _imagenes = new Map();
        try {
            for (const c of JSON.parse(fs.readFileSync(path.join(deps.motor(), 'statics', 'cards.json'), 'utf8'))) {
                const m = /^c([A-Z]{2}_\d+_\d+_\d+)_/.exec(String(c.image || ''));
                if (m) { _imagenes.set(m[1], c.image); _rarezas.set(m[1], String(c.rarity || '')); }
            }
        } catch (e) { /* sin base */ }
    }
    return _imagenes.get(id) || null;
}

async function imagenCarta(sharp, id) {
    const cache = path.join(deps.motor(), '.card_image_cache');
    const local = path.join(cache, `${id}.webp`);
    if (!fs.existsSync(local)) {
        // Misma fuente que el motor (discord_notifier.py) si la carta no esta en el cache.
        // El archivo lleva el nombre interno de la carta (ej. cPK_20_022020_02_HOGATORex_UR.webp): sale de statics/cards.json.
        const completo = nombreImagen(id);
        let r = null;
        for (const f of [completo, `c${id}.webp`].filter(Boolean)) {
            r = await fetch(`https://assets.pokemon-zone.com/game-assets/CardPreviews/${f}`,
                { headers: { Referer: 'https://www.pokemon-zone.com/' }, signal: AbortSignal.timeout(15000) }).catch(() => null);
            if (r?.ok) break;
        }
        if (!r?.ok) return null;
        fs.mkdirSync(cache, { recursive: true });
        fs.writeFileSync(local, Buffer.from(await r.arrayBuffer()));
    }
    return sharp(local).resize(CW, CH).png().toBuffer();
}

// Iconos de rareza del bot (assets/rarezas, los emojis rareza_*): cuantos y cual va debajo de cada carta.
const ICONO_RAREZA = {
    C: ['diamante', 1], U: ['diamante', 2], R: ['diamante', 3], RR: ['diamante', 4],
    AR: ['estrella', 1], SR: ['estrella', 2], SAR: ['estrella', 2], IM: ['estrella', 3],
    S: ['brillante', 1], SSR: ['brillante', 2], UR: ['corona', 1],
};
async function filaRareza(sharp, id) {
    nombreImagen(id);
    const [icono, n] = ICONO_RAREZA[_rarezas.get(id)] || [];
    if (!icono) return null;
    const T = 72, SEP = 8;
    const img = await sharp(path.join(__dirname, 'assets', 'rarezas', `${icono}.png`)).resize(T, T, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer().catch(() => null);
    if (!img) return null;
    const ancho = n * T + (n - 1) * SEP;
    const png = await sharp({ create: { width: ancho, height: T, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
        .composite(Array.from({ length: n }, (_, i) => ({ input: img, left: i * (T + SEP), top: 0 }))).png().toBuffer();
    return { png, ancho, alto: T };
}

async function colorBrillo(sharp, buf) {
    const { dominant: d } = await sharp(buf).extract({ left: 40, top: 90, width: 287, height: 240 }).resize(30, 25).stats();
    const [r, g, b] = [d.r / 255, d.g / 255, d.b / 255];
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    let h = 0.75;   // gris -> violeta
    if (mx !== mn) {
        const dd = mx - mn;
        h = (mx === r ? (g - b) / dd + (g < b ? 6 : 0) : mx === g ? (b - r) / dd + 2 : (r - g) / dd + 4) / 6;
    }
    const s = 0.85, l = 0.55, q = l + s - l * s, p = 2 * l - q;
    const f = t => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
    return [f(h + 1 / 3), f(h), f(h - 1 / 3)].map(x => Math.round(x * 255));
}

async function bloqueLogos(sharp, logo, mini) {
    if (!logo) return null;
    const lg = await sharp(await sharp(logo).trim().png().toBuffer()).resize(460, 130, { fit: 'inside' }).png().toBuffer();
    const lm = await sharp(lg).metadata();
    const capas = [{ input: lg, left: 0, top: 0 }];
    let alto = lm.height;
    if (mini) {
        const sb = await sharp(await sharp(mini).trim().png().toBuffer()).resize(270, 76, { fit: 'inside' }).png().toBuffer();
        const sm = await sharp(sb).metadata();
        capas.push({ input: sb, left: Math.round((lm.width - sm.width) / 2), top: lm.height - 6 });
        alto = lm.height - 6 + sm.height;
    }
    const png = await sharp({ create: { width: lm.width, height: alto, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite(capas).png().toBuffer();
    return { png, ancho: lm.width, alto };
}

async function imagenArco(ids, logo, mini) {
    const sharp = require('sharp');
    const W = M * 2 + CW * 5 + GAP * 4;
    const blq = await bloqueLogos(sharp, logo, mini);
    const y0 = M + (blq ? Math.max(0, blq.alto + 30 - 150) : 0);
    const H = y0 + CH + 150 + M;
    const capas = [];
    for (let i = 0; i < 5; i++) {
        const buf = ids[i] ? await imagenCarta(sharp, ids[i]) : null;
        if (!buf) continue;
        const mascara = Buffer.from(`<svg width="${CW}" height="${CH}"><rect width="${CW}" height="${CH}" rx="${RADIO}" fill="#fff"/></svg>`);
        const carta = await sharp(buf).composite([{ input: mascara, blend: 'dest-in' }]).png().toBuffer();
        const [r, g, b] = await colorBrillo(sharp, buf);
        const x = M + i * (CW + GAP), y = y0 + BAJADA[i], P = 80;
        const brillo = Buffer.from(`<svg width="${CW + P * 2}" height="${CH + P * 2}"><rect x="${P - 6}" y="${P - 6}" width="${CW + 12}" height="${CH + 12}" rx="${RADIO + 6}" fill="rgb(${r},${g},${b})" fill-opacity="0.6"/></svg>`);
        capas.push({ input: await sharp(brillo).blur(26).png().toBuffer(), left: x - P, top: y - P });
        capas.push({ input: carta, left: x, top: y });
        // (Ale 2026-11-22) Debajo de cada carta, su icono de rareza (estrellas, corona, diamantes o shiny).
        const fila = await filaRareza(sharp, ids[i]).catch(() => null);
        if (fila) capas.push({ input: fila.png, left: x + Math.round((CW - fila.ancho) / 2), top: y + CH + 18 });
    }
    if (!capas.length) return null;
    if (blq) capas.push({ input: blq.png, left: Math.round((W - blq.ancho) / 2), top: y0 + 150 - 30 - blq.alto });
    return sharp({ create: { width: W, height: H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite(capas).png().toBuffer();
}

// ---------- nombres ----------
let _hosts = { ts: 0, lista: [] };
let _prestadas = { ts: 0, mapa: new Map() };   // archivo XML -> dueño (cuentas compartidas de cada miembro)
async function duenoDe(h) {
    if (/^\d{17,20}$/.test(String(h.owner || ''))) return String(h.owner);
    // God Packs de antes de GP_OWNER_V1 (sin dueño): cuenta prestada -> se busca su XML en las compartidas.
    if (h.lent && h.xml && deps.ml?.cuentasReroll) {
        if (Date.now() - _prestadas.ts > 10 * 60 * 1000) {
            const mapa = new Map();
            for (const m of await deps.ml.cuentasReroll().catch(() => []) || []) for (const c of m.cuentas || []) mapa.set(String(c.f).toLowerCase(), m.discord_id);
            _prestadas = { ts: Date.now(), mapa };
        }
        const id = _prestadas.mapa.get(String(h.xml).toLowerCase());
        if (id) return id;
        return null;   // prestada de alguien que ya no la comparte
    }
    if (Date.now() - _hosts.ts > 10 * 60 * 1000) {
        _hosts = { ts: Date.now(), lista: await deps.host.hostsConocidos().catch(() => []) || [] };
    }
    return (_hosts.lista.find(x => x.nombre === h.host)?.duenos || [])[0] || null;   // cuenta propia del host
}
async function nombreDe(guild, id) {
    if (!id) return 'Unknown';
    const m = await guild.members.fetch(id).catch(() => null);
    return m?.displayName || m?.user?.username || (await deps.client.users.fetch(id).catch(() => null))?.username || 'Unknown';
}
const vivo = h => String(h.mode) === 'godpack';
function motivoMuerte(h, e) {
    if (e.sobres && e.sobres < 96) return `Not eligible (${e.sobres}P of 96P)`;
    return 'Open Packs Only (no Mains added)';
}

// ---------- aviso de cada God Pack ----------
// (Ale 2026-11-22) Sin embed: una sola foto con todo (tarjeta-gp.js, estilo del tablero de 📦-farm-96p).
async function publicarGp(canal, h) {
    const e = etiquetas(h), info = e.packId ? infoSobre(e.packId) : null;
    const dueno = await nombreDe(canal.guild, await duenoDe(h));
    const ok = vivo(h);
    const arco = Array.isArray(h.cards) && h.cards.length
        ? await imagenArco(h.cards, info && logoExpansion(info.expansion), info && miniLogo(info.set, info.sobre)).catch(err => { log('image:', err?.message || err); return null; })
        : null;
    const png = await require('./tarjeta-gp.js').tarjetaGp({
        vivo: ok, dueno, host: h.host || '—', rareza: e.rareza, sobres: e.sobres, sobre: info?.nombre || '',
        // (Ale 2026-11-22) "unpickable": God Pack con Crown/Shiny/Immersive (UNPICKABLE_LIST_V1 en inject.py).
        modo: ok ? 'GP farm' : String(h.mode) === 'unpickable' ? 'Unpickable' : 'Packs Only',
        motivo: ok ? '' : String(h.mode) === 'unpickable' ? 'Unpickable — Crown / Shiny / Immersive card (no Wonder Pick)'
            : (e.sobres && e.sobres < 96 ? `Not eligible — ${e.sobres}P of 96P (Open Packs Only, no Mains added)` : 'Open Packs Only — no Mains were added'),
    }, arco);
    await canal.send({ files: [new AttachmentBuilder(png, { name: ok ? 'god-pack-alive.png' : 'god-pack-dead.png' })], allowedMentions: { parse: [] } });
}

// ---------- resumen del dia ----------
const diaLocal = (ms = Date.now()) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

async function imagenResumen(hits) {
    // Por expansion: su logo y debajo cada sobre (mini logo, o el nombre si no tiene) con sus God Packs.
    const sharp = require('sharp');
    const grupos = new Map();
    for (const h of hits) {
        const info = infoSobre(etiquetas(h).packId);
        if (!info) continue;
        const g = grupos.get(info.expansion) || { info, sobres: new Map() };
        const s = g.sobres.get(info.sobre) || { vivos: 0, muertos: 0 };
        vivo(h) ? s.vivos++ : s.muertos++;
        g.sobres.set(info.sobre, s);
        grupos.set(info.expansion, g);
    }
    if (!grupos.size) return null;
    const W = 1400, FILA = 360, H = grupos.size * FILA + 20;
    const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
    let svg = '', capas = [], fila = 0;
    for (const [exp, g] of grupos) {
        const y0 = 10 + fila * FILA;
        const logo = logoExpansion(exp);
        if (logo) {
            const lg = await sharp(await sharp(logo).trim().png().toBuffer()).resize(460, 125, { fit: 'inside' }).png().toBuffer();
            const lm = await sharp(lg).metadata();
            capas.push({ input: lg, left: Math.round((W - lm.width) / 2), top: y0 });
        } else svg += `<text x="${W / 2}" y="${y0 + 80}" text-anchor="middle" font-family="Segoe UI" font-size="54" font-weight="800" fill="#fff">${esc(exp)}</text>`;
        const sobres = [...g.sobres];
        const paso = W / (sobres.length + 1);
        for (let i = 0; i < sobres.length; i++) {
            const [nombre, c] = sobres[i], cx = Math.round(paso * (i + 1));
            const mini = miniLogo(g.info.set, nombre);
            if (mini) {
                const mb = await sharp(await sharp(mini).trim().png().toBuffer()).resize(320, 85, { fit: 'inside' }).png().toBuffer();
                const mm = await sharp(mb).metadata();
                capas.push({ input: mb, left: cx - Math.round(mm.width / 2), top: y0 + 150 });
            } else if (nombre) svg += `<text x="${cx}" y="${y0 + 205}" text-anchor="middle" font-family="Segoe UI" font-size="34" font-weight="800" fill="#fff">${esc(nombre)}</text>`;
            const total = c.vivos + c.muertos;
            svg += `<text x="${cx}" y="${y0 + 285}" text-anchor="middle" font-family="Segoe UI" font-size="34" font-weight="700" fill="#ffffff">${total} God Pack${total === 1 ? '' : 's'}</text>`;
            svg += `<text x="${cx}" y="${y0 + 325}" text-anchor="middle" font-family="Segoe UI" font-size="26" fill="#c9cdfb">${c.vivos} alive · ${c.muertos} dead</text>`;
        }
        fila++;
    }
    const base = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${svg}</svg>`);
    return sharp(base).composite(capas).png().toBuffer();
}

async function publicarResumen(canal, dia, hits) {
    // (Ale 2026-11-22) Una sola foto (tarjeta-gp.js): totales, sobres del dia y una fila por dueño.
    const nombres = new Map();
    const filas = new Map();
    for (const h of hits) {
        const id = await duenoDe(h) || '?';
        if (!nombres.has(id)) nombres.set(id, id === '?' ? 'Unknown' : await nombreDe(canal.guild, id));
        const f = filas.get(id) || { nombre: nombres.get(id), hosts: [], vivos: 0, muertos: 0 };
        vivo(h) ? f.vivos++ : f.muertos++;
        if (h.host && !f.hosts.includes(h.host)) f.hosts.push(h.host);
        filas.set(id, f);
    }
    const porSobre = new Map();
    for (const h of hits) { const nom = infoSobre(etiquetas(h).packId)?.nombre; if (nom) porSobre.set(nom, (porSobre.get(nom) || 0) + 1); }
    const [y, mo, d] = dia.split('-').map(Number);
    const png = await require('./tarjeta-gp.js').tarjetaResumen({
        dia: new Date(y, mo - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        total: hits.length, vivos: hits.filter(vivo).length, muertos: hits.filter(h => !vivo(h)).length,
        mejor: Math.max(0, ...hits.map(h => etiquetas(h).rareza || 0)),
        sobres: [...porSobre].sort((a, b) => b[1] - a[1]).map(([k]) => k),
        filas: [...filas.values()],
    });
    await canal.send({ files: [new AttachmentBuilder(png, { name: 'god-packs-recap.png' })], allowedMentions: { parse: [] } });
}

// ---------- ciclo (cada 30 s desde bot.js, solo el host del turno) ----------
let corriendo = false, creando = false;
async function ciclo(guild) {
    if (!deps || corriendo) return;
    // Solo el de Elite_Reroll (si quedo uno de prueba en otra categoria, no se usa).
    let canal = guild.channels.cache.find(c => esCanal(c) && CATEGORIA.test(c.parent?.name || ''));
    if (!canal) {
        // Se crea una sola vez dentro de Elite_Reroll, con los permisos de la categoria.
        const cat = guild.channels.cache.find(c => c.type === 4 && CATEGORIA.test(c.name));
        if (!cat || creando) return;
        creando = true;
        canal = await guild.channels.create({ name: CANAL, type: 0, parent: cat.id, topic: 'Every God Pack from the community hosts (alive and dead) and a daily recap at 11:59 PM' })
            .then(async c => { await c.lockPermissions().catch(() => {}); log(`channel ${CANAL} created in ${cat.name}`); return c; })
            .catch(e => { log('could not create the channel:', e?.message || e); return null; })
            .finally(() => { creando = false; });
        if (!canal) return;
    }
    corriendo = true;
    try {
        // (Ale 2026-11-22) KyuremBot (wR98) publica el canal: deja su señal de vida en zenith:allgp_kyurem (ms) cada
        // minuto. Con la señal al dia (< 5 min) el nuestro no publica; si KyuremBot se apaga, publica el nuestro.
        // Los dos usan la misma marca zenith:allgp_ts, asi no hay repetidos ni saltos. zenith:allgp_off = 1 lo apaga del todo.
        if (String(await deps.host.marcaAllGp('off').catch(() => '')) === '1') return;
        const kyurem = Number(await deps.host.marcaAllGp('kyurem').catch(() => 0)) || 0;
        if (Date.now() - kyurem < 5 * 60 * 1000) return;
        const lista = (await deps.host.godPacksComunidad(false).catch(() => null) || []).filter(h => h && Number(h.ts));
        let marca = Number(await deps.host.marcaAllGp('ts').catch(() => null));
        if (!marca) {   // primera vez: se empieza desde ahora (sin publicar los de antes)
            await deps.host.marcaAllGp('ts', String(Date.now()));
            return;
        }
        const nuevos = lista.filter(h => Number(h.ts) > marca).sort((a, b) => a.ts - b.ts).slice(0, 5);
        for (const h of nuevos) {
            await publicarGp(canal, h).catch(err => log('post:', err?.message || err));
            await deps.host.marcaAllGp('ts', String(h.ts));
        }
        // Resumen: desde las 23:59 hasta las 00:10 (si el bot estuvo apagado justo a esa hora, no se manda).
        const ahora = new Date();
        const hoy = diaLocal(), ayer = diaLocal(Date.now() - 20 * 60 * 1000);
        const dia = ahora.getHours() === 23 && ahora.getMinutes() >= 59 ? hoy : (ahora.getHours() === 0 && ahora.getMinutes() < 10 ? ayer : null);
        if (dia && await deps.host.marcaAllGp('recap') !== dia) {
            const [y, mo, d] = dia.split('-').map(Number);
            const ini = new Date(y, mo - 1, d).getTime(), fin = ini + 24 * 3600 * 1000;
            const delDia = lista.filter(h => Number(h.ts) >= ini && Number(h.ts) < fin);
            await deps.host.marcaAllGp('recap', dia);
            await publicarResumen(canal, dia, delDia).catch(err => log('recap:', err?.message || err));
        }
    } finally { corriendo = false; }
}

function iniciar(d) { deps = d; }
module.exports = { iniciar, ciclo, CANAL, publicarGp, publicarResumen, imagenArco };
