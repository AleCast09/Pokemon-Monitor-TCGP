// Actualiza la clave del Upstash de wr98 (Dragonite) cuando la rota (~cada 15 dias).
// Pide la direccion y la clave (no quedan escritas en ningun archivo del repo), prueba que funcionen y las guarda:
//   - en NUESTRO Upstash, zenith:wr98_redis = {"url","token"}: todos los hosts la toman solos en ~10 min
//   - en el .env de esta PC (WR98_REDIS_URL / WR98_REDIS_TOKEN), por si nuestro Upstash no responde
// Uso: doble clic en "ACTUALIZAR UPSTASH WR98.bat".
'use strict';
const fs = require('fs');
const path = require('path');
const readline = require('readline');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const preguntar = (t) => new Promise(r => rl.question(t, a => r(String(a || '').trim())));
const pedir = (url, token, comando) => fetch(url.replace(/\/+$/, ''), {
    method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify(comando),
}).then(r => r.json());

(async () => {
    console.log('Update wr98 Upstash (Dragonite)\n');
    let url = '', token = '';
    while (!url) url = (await preguntar('1) Paste the Upstash URL (....upstash.io) and press Enter: ')).replace(/\/+$/, '');
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
    while (!token) token = await preguntar('2) Paste the token and press Enter: ');
    if (!/^https:\/\/[a-z0-9-]+\.upstash\.io$/i.test(url) || token.length < 20) {
        console.log('\n❌ That URL or token does not look right. Nothing changed.');
        return;
    }
    const prueba = await pedir(url, token, ['SCAN', '0', 'MATCH', 'users:*', 'COUNT', '200']).catch(e => ({ error: e.message }));
    if (prueba.error) {
        console.log(`\n❌ The new key does not work (${prueba.error}). Nothing changed.`);
        return;
    }
    console.log(`✅ New key works (${(prueba.result?.[1] || []).length} groups found).`);

    if (process.env.LINK_REDIS_URL && process.env.LINK_REDIS_TOKEN) {
        const r = await pedir(process.env.LINK_REDIS_URL, process.env.LINK_REDIS_TOKEN,
            ['SET', 'zenith:wr98_redis', JSON.stringify({ url, token })]).catch(e => ({ error: e.message }));
        console.log(r.result === 'OK' ? '✅ Saved for all hosts (they pick it up within 10 min).' : `⚠️ Could not save it for the hosts (${r.error || 'error'}).`);
    } else {
        console.log('⚠️ This .env has no LINK_REDIS_*: only saved on this PC.');
    }

    const archivo = path.join(__dirname, '..', '.env');
    const lineas = fs.existsSync(archivo) ? fs.readFileSync(archivo, 'utf8').split(/\r?\n/) : [];
    const resto = lineas.filter(l => !/^WR98_REDIS_(URL|TOKEN)=/.test(l));
    while (resto.length && resto[resto.length - 1] === '') resto.pop();
    resto.push(`WR98_REDIS_URL=${url}`, `WR98_REDIS_TOKEN=${token}`, '');
    fs.writeFileSync(archivo, resto.join('\n'));
    console.log('✅ Saved in this PC\'s .env too.');
    console.log('\nDone. The bots use the new key within 10 minutes (no restart needed).');
})().finally(() => rl.close());
