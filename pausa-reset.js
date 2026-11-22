// Aviso de la pausa del reset diario (Ale 2026-11-22, como el farm de Melody). De 20:30 a 21:15 UTC el GP farm no
// manda solicitudes (ver pausaReset en reroll-comunidad.js). El bot del turno avisa en 💬chat mencionando a
// @Elite_Four; al terminar borra ese aviso y manda "resumed", que se borra solo a los 10 min. Lo hecho queda
// marcado en Upstash (zenith:allgp_pausa*), asi un cambio de turno o un reinicio no repite nada.
const CANAL = /^💬?\s*chat$/i;
const ROL = 'Elite_Four';
let deps = null, corriendo = false;

const diaUtc = (ms = Date.now()) => new Date(ms).toISOString().slice(0, 10);
const t = ms => `<t:${Math.floor(ms / 1000)}:t>`;

async function borrar(guild, guardado) {
    const [canalId, msgId] = String(guardado || '').split(':');
    if (!canalId || !msgId) return;
    const canal = await guild.channels.fetch(canalId).catch(() => null);
    await canal?.messages.delete(msgId).catch(() => {});
}

async function ciclo(guild) {
    if (!deps || corriendo) return;
    corriendo = true;
    try {
        const marca = deps.host.marcaAllGp;
        const canal = guild.channels.cache.find(c => CANAL.test(c.name) && c.isTextBased?.() && !/staff|host/i.test(c.parent?.name || ''));
        if (!canal) return;
        const fin = deps.pausaReset();
        const hoy = diaUtc();
        if (fin) {
            if (await marca('pausa') === hoy) return;
            await marca('pausa', hoy);
            const rol = guild.roles.cache.find(r => r.name === ROL);
            const inicio = fin - 45 * 60 * 1000, reset = fin - 15 * 60 * 1000;
            const msg = await canal.send({
                content: `${rol ? `<@&${rol.id}> ` : ''}⏸️ **GP farm paused** at ${t(inicio)} before the daily reset (${t(reset)}) so God Packs can go live. `
                    + `Please **go offline**, then **refresh your Wonder Pick** to check whether your God Pack is live. The farm resumes at ${t(fin)} with the online users.`,
                allowedMentions: { roles: rol ? [rol.id] : [] },
            }).catch(() => null);
            if (msg) await marca('pausamsg', `${canal.id}:${msg.id}`);
            return;
        }
        // Termino la pausa de hoy (o la de ayer, si cruzo la medianoche UTC): se borra el aviso y se avisa que volvio.
        const dia = await marca('pausa');
        if (dia && (dia === hoy || dia === diaUtc(Date.now() - 86400000)) && await marca('pausafin') !== dia) {
            await marca('pausafin', dia);
            await borrar(guild, await marca('pausamsg'));
            const msg = await canal.send({ content: '▶️ **GP farm resumed** — you can go back online. Good luck with your God Packs!' }).catch(() => null);
            if (msg) await marca('reanudomsg', `${canal.id}:${msg.id}:${Date.now()}`);
            return;
        }
        // El "resumed" se borra a los 10 min.
        const r = String(await marca('reanudomsg') || '');
        const [, , cuando] = r.split(':');
        if (r && Number(cuando) && Date.now() - Number(cuando) > 10 * 60 * 1000) {
            await borrar(guild, r);
            await marca('reanudomsg', '');
        }
    } finally { corriendo = false; }
}

function iniciar(d) { deps = d; }
module.exports = { iniciar, ciclo };
