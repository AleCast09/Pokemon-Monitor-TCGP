// Canal "all god packs" (Ale 2026-11-22): cada God Pack de los hosts de la comunidad (vivo o muerto) con su
// imagen (cartas en arco, brillo del color de cada carta, logo de la expansion + mini logo del sobre arriba al
// centro) y, una vez por dia a las 23:59, el resumen del dia. Lo publica solo el host que tiene el turno; lo ya
// publicado queda marcado en Upstash, asi un cambio de turno no repite nada.
const fs = require('fs');
const path = require('path');
const { EmbedBuilder, AttachmentBuilder } = require('discord.js');

const CANAL = '📚-all-god-packs';
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

async function imagenCarta(sharp, id) {
    const cache = path.join(deps.motor(), '.card_image_cache');
    const local = path.join(cache, `${id}.webp`);
    if (!fs.existsSync(local)) {
        // Misma fuente que el motor (discord_notifier.py) si la carta no esta en el cache.
        const r = await fetch(`https://assets.pokemon-zone.com/game-assets/CardPreviews/c${id}.webp`,
            { headers: { Referer: 'https://www.pokemon-zone.com/' }, signal: AbortSignal.timeout(15000) }).catch(() => null);
        if (!r?.ok) return null;
        fs.mkdirSync(cache, { recursive: true });
        fs.writeFileSync(local, Buffer.from(await r.arrayBuffer()));
    }
    return sharp(local).resize(CW, CH).png().toBuffer();
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
async function publicarGp(canal, h) {
    const e = etiquetas(h), info = e.packId ? infoSobre(e.packId) : null;
    const dueno = await nombreDe(canal.guild, await duenoDe(h));
    const ok = vivo(h);
    const embed = new EmbedBuilder()
        .setColor(ok ? 0x23d160 : 0xf23f43)
        .setTitle(ok ? 'God Pack — ALIVE' : 'God Pack — DEAD')
        .setDescription(ok ? 'Sent to the online Mains' : 'Not usable · no Mains were added')
        .addFields(
            { name: 'Owner', value: dueno, inline: true },
            { name: 'Host', value: String(h.host || '—'), inline: true },
            { name: 'Rarity', value: e.rareza ? `[${e.rareza}/5]` : '—', inline: true },
            ok ? { name: 'Packs', value: e.sobres ? `${e.sobres}P` : '—', inline: true } : { name: 'Why dead', value: motivoMuerte(h, e), inline: true },
            { name: 'Mode', value: ok ? 'GP farm' : 'Open Packs Only', inline: true },
            { name: 'Pack', value: info?.nombre || '—', inline: true })
        .setFooter({ text: 'All God Packs (alive and dead) from the community hosts' })
        .setTimestamp(new Date(Number(h.ts)));
    const files = [];
    const img = Array.isArray(h.cards) && h.cards.length
        ? await imagenArco(h.cards, info && logoExpansion(info.expansion), info && miniLogo(info.set, info.sobre)).catch(err => { log('image:', err?.message || err); return null; })
        : null;
    if (img) { files.push(new AttachmentBuilder(img, { name: 'god-pack.png' })); embed.setImage('attachment://god-pack.png'); }
    await canal.send({ embeds: [embed], files, allowedMentions: { parse: [] } });
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
    const vivos = hits.filter(vivo), muertos = hits.filter(h => !vivo(h));
    const mejor = Math.max(0, ...hits.map(h => etiquetas(h).rareza || 0));
    const cuenta = (lista, f) => { const m = new Map(); for (const x of lista) { const k = f(x); if (k) m.set(k, (m.get(k) || 0) + 1); } return [...m].sort((a, b) => b[1] - a[1]); };
    const nombres = new Map();
    for (const h of hits) { const id = await duenoDe(h); if (id && !nombres.has(id)) nombres.set(id, await nombreDe(canal.guild, id)); }
    const dueno = async h => nombres.get(await duenoDe(h)) || 'Unknown';
    const duenos = [];
    for (const h of hits) duenos.push(await dueno(h));
    const porDueno = cuenta(duenos, x => x);
    const lineaVivos = [];
    for (const h of vivos.slice(0, 10)) lineaVivos.push(`[${etiquetas(h).rareza || '?'}/5] ${await dueno(h)} · ${h.host || '—'}`);
    const noEleg = muertos.filter(h => { const e = etiquetas(h); return e.sobres && e.sobres < 96; }).length;
    const [y, mo, d] = dia.split('-').map(Number);
    const titulo = new Date(y, mo - 1, d).toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
    const embed = new EmbedBuilder()
        .setColor(0x7c83ff)
        .setTitle(`Daily God Pack recap — ${titulo}`)
        .setDescription('All community hosts · GP farm and /farm')
        .addFields(
            { name: '✨ God Packs', value: `**${hits.length}**`, inline: true },
            { name: '🟢 Alive', value: `**${vivos.length}**`, inline: true },
            { name: '🔴 Dead', value: `**${muertos.length}**`, inline: true },
            { name: '🏆 Best rarity', value: mejor ? `**[${mejor}/5]**` : '—', inline: true },
            { name: 'By host', value: cuenta(hits, h => h.host).map(([k, v]) => `${k} ${v}`).join(' · ') || '—', inline: true },
            { name: 'Why dead', value: muertos.length ? [noEleg ? `not eligible ${noEleg}` : '', muertos.length - noEleg ? `Open Packs Only ${muertos.length - noEleg}` : ''].filter(Boolean).join(' · ') : '—', inline: true },
            { name: 'Owners with a God Pack', value: porDueno.slice(0, 8).map(([k, v]) => `${k} ${v}`).join(' · ') + (porDueno.length > 8 ? ` · +${porDueno.length - 8}` : '') || '—' },
            { name: 'Alive today', value: lineaVivos.join('\n') || 'None today' })
        .setFooter({ text: 'Sent once a day at 11:59 PM · names only, nobody is mentioned' });
    const files = [];
    const img = await imagenResumen(hits).catch(err => { log('recap image:', err?.message || err); return null; });
    if (img) { files.push(new AttachmentBuilder(img, { name: 'recap.png' })); embed.setImage('attachment://recap.png'); }
    await canal.send({ embeds: [embed], files, allowedMentions: { parse: [] } });
}

// ---------- ciclo (cada 30 s desde bot.js, solo el host del turno) ----------
let corriendo = false;
async function ciclo(guild) {
    if (!deps || corriendo) return;
    const canal = guild.channels.cache.find(c => c.name === CANAL && c.isTextBased?.());
    if (!canal) return;
    corriendo = true;
    try {
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
