const path = require('path');
const fs = require('fs');
const db = require('../database.js');

(async ()=>{
    try {
        const rutaMasterRow = await db.get("SELECT webhook_url FROM configs_canales WHERE tipo = 'ruta_master' LIMIT 1");
        const rutaJsonRow = await db.get("SELECT webhook_url FROM configs_canales WHERE tipo = 'ruta_json_cuentas' LIMIT 1");
        const rutaMaster = rutaMasterRow?.webhook_url;
        const rutaJson = rutaJsonRow?.webhook_url;
        console.log('ruta_master=', rutaMaster);
        console.log('ruta_json=', rutaJson);
        if (!rutaMaster) return console.error('No ruta_master configurada');
        if (!rutaJson) return console.error('No ruta_json_cuentas configurada');

        const accountJsonPath = 'C:/POKEMON/PTCGPB-ALE/Accounts/Cards/accounts/aca22aa55f791829.json';
        if (!fs.existsSync(accountJsonPath)) return console.error('Account JSON not found:', accountJsonPath);
        const account = JSON.parse(fs.readFileSync(accountJsonPath,'utf8'));
        const pulls = Array.isArray(account.pulls)? account.pulls : Object.values(account.pulls || {});
        if (!pulls.length) return console.error('No pulls in account');
        const pull = pulls[0];
        console.log('Using pull timestamp=', pull.timestamp, 'pack=', pull.pack, 'cards=', pull.cards.length);

        const posiblesCardmap = [
            path.join(rutaMaster, 'Helper', 'cardmap.json'),
            path.join(rutaMaster, 'cardmap.json'),
            path.join(rutaMaster, 'CardImageCache', 'cardmap.json')
        ];
        let cardmap = null;
        for (const p of posiblesCardmap) {
            if (fs.existsSync(p)) { cardmap = JSON.parse(fs.readFileSync(p,'utf8')); console.log('Loaded cardmap from', p); break; }
        }
        if (!cardmap) return console.error('No cardmap found in ruta_master');

        const checkPaths = (ilustr) => {
            const tries = [
                path.join(rutaMaster, 'CardImageCache', `${ilustr}.png`),
                path.join(rutaMaster, `${ilustr}.png`),
                path.join(rutaMaster, 'cardmap', `${ilustr}.png`),
                path.join(rutaMaster, 'cardmaster', `${ilustr}.png`)
            ];
            for (const t of tries) if (fs.existsSync(t)) return t;
            return null;
        };

        for (const code of pull.cards) {
            const c = code.trim();
            const entry = cardmap[c];
            const ilustr = entry ? entry.IllustrationID : null;
            const found = ilustr ? checkPaths(ilustr) : null;
            console.log(c, '-> IllustrationID=', ilustr || 'MISSING', 'image=', found || 'NOT FOUND');
        }

    } catch (e) { console.error('ERR', e); }
})();