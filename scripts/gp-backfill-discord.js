// Carga una sola vez los God Packs viejos (Ale 2026-11-09) en la lista del God Pack UI.
// Lee los foros de KyuremBot (elite_gp_list y gym_leader_gp_list): cada post es un God Pack con nombre,
// ID, XML (pie del embed), sobres, set, fecha, quien lo encontro y la foto. Los guarda en Upstash
// zenith:gp_hits_old (lista fija, lo mas nuevo primero); los hosts la bajan una vez (zenith:gp_hits_old_v).
// Uso: node scripts/gp-backfill-discord.js [--dry]
require('dotenv').config({ quiet: true });

const GUILD = '1483615153743462571';
const FOROS = ['1497179653276827720', '1501347022773686483'];   // elite_gp_list, gym_leader_gp_list
const HASTA = Date.parse('2026-11-09T11:48:00Z');               // lo de despues ya lo anota cada host
const SECO = process.argv.includes('--dry');

const H = { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}` };
async function api(ruta) {
    for (;;) {
        const r = await fetch(`https://discord.com/api/v10${ruta}`, { headers: H });
        if (r.status === 429) {
            const espera = ((await r.json()).retry_after || 1) * 1000 + 250;
            await new Promise(s => setTimeout(s, espera));
            continue;
        }
        if (!r.ok) return null;
        return r.json();
    }
}
async function redis(...cmd) {
    const r = await fetch(process.env.LINK_REDIS_URL.replace(/\/+$/, ''), {
        method: 'POST', headers: { Authorization: `Bearer ${process.env.LINK_REDIS_TOKEN}` }, body: JSON.stringify(cmd)
    });
    const j = await r.json();
    if (j.error) throw new Error(j.error);
    return j.result;
}

async function hilos(foro) {
    const lista = (await api(`/guilds/${GUILD}/threads/active`))?.threads.filter(t => t.parent_id === foro) || [];
    let antes = '';
    for (;;) {
        const a = await api(`/channels/${foro}/threads/archived/public?limit=100${antes ? `&before=${encodeURIComponent(antes)}` : ''}`);
        if (!a?.threads) break;
        lista.push(...a.threads);
        if (!a.has_more || !a.threads.length) break;
        antes = a.threads[a.threads.length - 1].thread_metadata.archive_timestamp;
    }
    return lista;
}

const usuarios = new Map();
async function nombreUsuario(id) {
    if (!id) return '';
    if (!usuarios.has(id)) {
        const m = await api(`/guilds/${GUILD}/members/${id}`);
        usuarios.set(id, m ? (m.nick || m.user?.global_name || m.user?.username || '') : '');
    }
    return usuarios.get(id);
}

// Avance guardado (por si se corta): un post ya leido no se vuelve a pedir.
const CACHE = require('path').join(require('os').tmpdir(), 'gp-backfill-cache.json');
const fsx = require('fs');
let cache = {};
try { cache = JSON.parse(fsx.readFileSync(CACHE, 'utf8')); } catch (e) { /* primera vez */ }

(async () => {
    const todos = [];
    const pendientes = [];
    for (const foro of FOROS) {
        const lista = await hilos(foro);
        console.log(`forum ${foro}: ${lista.length} posts`);
        pendientes.push(...lista);
    }
    let n = 0;
    // 6 posts a la vez (cada post es otro canal: los limites de Discord son por canal).
    const trabajar = async () => {
        for (let t = pendientes.shift(); t; t = pendientes.shift()) {
            if (cache[t.id] !== undefined) { if (cache[t.id]) todos.push(cache[t.id]); continue; }
            const h = await leer(t).catch(() => undefined);
            if (h === undefined) continue;
            cache[t.id] = h;
            if (h) todos.push(h);
            if (++n % 100 === 0) { console.log(`  ${n}...`); fsx.writeFileSync(CACHE, JSON.stringify(cache)); }
        }
    };
    await Promise.all(Array.from({ length: 6 }, trabajar));
    fsx.writeFileSync(CACHE, JSON.stringify(cache));
    await terminar(todos);
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });

async function leer(t) {
    {
        {
            const creado = Date.parse(t.thread_metadata?.create_timestamp || '') || Number((BigInt(t.id) >> 22n) + 1420070400000n);
            if (creado >= HASTA) return null;
            const m = t.name.match(/^(\S*)\s*\[(\d)\/5\]\s*\[(\d+)P\]\s*(.+?)\s*\[(\d{16})\]/);
            if (!m) return null;
            const inicio = await api(`/channels/${t.id}/messages/${t.id}`);
            const img = (inicio?.attachments?.[0]?.url || '').split('?')[0];
            // El embed (Found By, set, pie con el XML) va en el 2do mensaje del post.
            const msgs = await api(`/channels/${t.id}/messages?limit=5&after=${t.id}`) || [];
            const emb = msgs.map(x => x.embeds?.[0]).find(e => e && e.fields) || {};
            const campo = (txt) => (emb.fields || []).find(f => f.name.includes(txt))?.value || '';
            const xml = ((emb.footer?.text || '').match(/📄\s*(.+\.xml)/i) || [])[1] || '';
            const set = ((emb.description || '').match(/Expansion:\*\*\s*`([^`]+)`/) || [])[1] || '';
            const cuando = Number(((emb.description || '').match(/<t:(\d+)/) || [])[1]) * 1000 || creado;
            const quien = await nombreUsuario((campo('Found By').match(/<@!?(\d+)>/) || [])[1]);
            const est = m[1].includes('✅') ? 'alive' : /❌|💀|☠/.test(m[1]) ? 'dead' : '';
            return {
                ts: cuando, name: m[4], id: m[5], xml, tags: `[${m[2]}/5][${m[3]}P]${set ? `[${set}]` : ''}`,
                mode: 'godpack', host: 'Discord', found_by: quien, status: est, img,
                post: `https://discord.com/channels/${GUILD}/${t.id}`,
            };
        }
    }
}

async function terminar(todos) {
    todos.sort((a, b) => b.ts - a.ts);
    console.log(`God Packs found: ${todos.length} (with image: ${todos.filter(h => h.img).length}, with XML: ${todos.filter(h => h.xml).length})`);
    console.log('example:', JSON.stringify(todos[0]));
    if (SECO) return;
    await redis('DEL', 'zenith:gp_hits_old');
    for (let i = 0; i < todos.length; i += 200) {
        await redis('RPUSH', 'zenith:gp_hits_old', ...todos.slice(i, i + 200).map(h => JSON.stringify(h)));
    }
    await redis('INCR', 'zenith:gp_hits_old_v');
    console.log('Saved to Upstash zenith:gp_hits_old:', await redis('LLEN', 'zenith:gp_hits_old'));
}
