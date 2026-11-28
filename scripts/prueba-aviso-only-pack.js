// Prueba del aviso de Open Packs Only: lo manda al canal 🔒-hosts con los datos reales de esta PC.
require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');
const os = require('os');
const { DatabaseSync } = require('node:sqlite');
const { armarAvisoImagen } = require('../aviso-only-pack.js');

const MOTOR = 'C:\\Users\\Ale TCG\\Desktop\\ptcgp-capturedeluxe';
const API = 'https://discord.com/api/v10';
const H = { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}` };

(async () => {
    const db = new DatabaseSync(process.env.MONITOR_DB_PATH || path.join(__dirname, '..', 'database.db'), { readOnly: true });
    const hosts = db.prepare(`SELECT discord_id, canal_id FROM configs_canales WHERE tipo = 'hosts' AND canal_id IS NOT NULL LIMIT 1`).get();
    const filas = db.prepare(`SELECT discord_id, cuentas FROM link_reroll`).all();
    const miembros = [];
    for (const f of filas) {
        const cuentas = JSON.parse(f.cuentas || '[]').filter(c => typeof c === 'object' && c.e > 0).length;
        let nombre = f.discord_id;
        try {
            const r = await fetch(`${API}/guilds/${hosts.discord_id}/members/${f.discord_id}`, { headers: H });
            if (r.ok) { const m = await r.json(); nombre = m.nick || m.user.global_name || m.user.username; }
        } catch (e) { /* queda el id */ }
        miembros.push({ nombre, cuentas });
    }
    const s = JSON.parse(fs.readFileSync(path.join(MOTOR, 'tools', 'god_pack_gui', 'settings.json'), 'utf8'));
    // Números de ejemplo (prueba): 25 min abriendo a ~120 PPM.
    const { embed, archivo, total, sobre } = await armarAvisoImagen({ motor: MOTOR, packId: s.pack_id, host: os.hostname(), miembros,
        progreso: { sobres: 3012, minutos: 25 } });
    embed.author = { name: '🧪 TEST' };
    const form = new FormData();
    form.append('payload_json', JSON.stringify({ embeds: [embed], allowed_mentions: { parse: [] } }));
    if (archivo) form.append('files[0]', new Blob([archivo.buffer], { type: 'image/png' }), archivo.nombre);
    const r = await fetch(`${API}/channels/${hosts.canal_id}/messages`, { method: 'POST', headers: H, body: form });
    console.log('enviado:', r.status, '| sobre:', sobre, '| imagen:', archivo ? archivo.nombre : 'ninguna', '| total:', total, '| miembros:', miembros.filter(m => m.cuentas > 0).length);
    if (!r.ok) console.log((await r.text()).slice(0, 300));
})();
