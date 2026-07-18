const db = require('../database.js');
const fs = require('fs');
const path = require('path');

(async () => {
    const w = await db.get(`SELECT webhook_url FROM configs_canales WHERE tipo = 'ruta_wishlist' ORDER BY rowid DESC LIMIT 1`);
    const j = await db.get(`SELECT webhook_url FROM configs_canales WHERE tipo = 'ruta_json_cuentas' ORDER BY rowid DESC LIMIT 1`);

    if (w) {
        let wpath = w.webhook_url;
        if (fs.existsSync(wpath) && fs.lstatSync(wpath).isDirectory()) wpath = path.join(wpath, 'wishlist.json');
        if (fs.existsSync(wpath)) {
            const data = JSON.parse(fs.readFileSync(wpath, 'utf8'));
            const cards = data.cards || [];
            console.log('wishlist total:', cards.length);
            console.log('wishlist sample (raw):', JSON.stringify(cards.slice(0, 5), null, 2));
        } else {
            console.log('wishlist.json not found at:', wpath);
        }
    } else {
        console.log('No ruta_wishlist in DB');
    }

    if (j) {
        const dir = (fs.existsSync(j.webhook_url) && fs.lstatSync(j.webhook_url).isDirectory())
            ? j.webhook_url : path.dirname(j.webhook_url);
        const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
        console.log('\naccount JSON folder:', dir, '| files:', files.length);
        if (files.length) {
            const acc = JSON.parse(fs.readFileSync(path.join(dir, files[0]), 'utf8'));
            const pulls = Array.isArray(acc.pulls) ? acc.pulls : Object.values(acc.pulls || {});
            const last = pulls[pulls.length - 1];
            if (last) {
                console.log('last pull timestamp:', last.timestamp);
                console.log('last pull card codes (raw):', last.cards.slice(0, 8));
            }
        }
    } else {
        console.log('No ruta_json_cuentas in DB');
    }
    process.exit();
})();
