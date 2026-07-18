const fs = require('fs');
const path = require('path');
const db = require('../database.js');

function parseFecha(ts) {
    if (!ts) return null;
    const texto = ts.toString().trim().replace(/\s+/, ' ');
    const candidato = texto.includes('T') ? texto : texto.replace(' ', 'T');
    const fecha = new Date(candidato);
    return isNaN(fecha.getTime()) ? null : fecha;
}

(async ()=>{
    try {
        const xmlPath = 'C:/POKEMON/PTCGPB-ALE/Accounts/Saved/2/138P_20260118105216_3(XR).xml';
        if (!fs.existsSync(xmlPath)) return console.error('XML not found', xmlPath);
        const xml = fs.readFileSync(xmlPath,'utf8');
        const m = xml.match(/name="deviceAccount">([^<]+)</);
        if (!m) return console.error('No deviceAccount in XML');
        const accountId = m[1];
        console.log('accountId=', accountId);

        const rutaMasterRow = await db.get("SELECT webhook_url FROM configs_canales WHERE tipo = 'ruta_master' LIMIT 1");
        const rutaJsonRow = await db.get("SELECT webhook_url FROM configs_canales WHERE tipo = 'ruta_json_cuentas' LIMIT 1");
        const rutaMaster = rutaMasterRow?.webhook_url;
        const rutaJson = rutaJsonRow?.webhook_url;
        console.log('ruta_master=', rutaMaster);
        console.log('ruta_json=', rutaJson);

        const accountJsonPath = path.join(rutaJson, `${accountId}.json`);
        if (!fs.existsSync(accountJsonPath)) return console.error('Account JSON not found:', accountJsonPath);
        const account = JSON.parse(fs.readFileSync(accountJsonPath,'utf8'));

        // get pulls
        let pulls = Array.isArray(account.pulls) ? account.pulls : (account.pulls && typeof account.pulls === 'object' ? Object.values(account.pulls) : Object.values(account).filter(i=>i && i.timestamp && Array.isArray(i.cards)));
        if (!pulls.length) return console.error('No pulls');

        // find nearest to now
        const ahora = new Date();
        const form = d=> `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
        const claveAhora = form(ahora);
        let mejor = null; let mejorDiff = Infinity;
        for (const p of pulls) {
            const fecha = parseFecha(p.timestamp);
            if (!fecha) continue;
            const clave = form(fecha);
            if (clave === claveAhora) { mejor = p; break; }
            const diff = Math.abs(ahora.getTime() - fecha.getTime());
            if (diff < mejorDiff) { mejorDiff = diff; mejor = p; }
        }
        if (!mejor) return console.error('No pull selected');
        console.log('Selected pull timestamp=', mejor.timestamp, 'pack=', mejor.pack, 'cards=', mejor.cards.length);

        // load master and cardmap (be robust to invalid JSON files)
        let masterCardmaster = {};
        if (rutaMaster) {
            const masterPaths = [path.join(rutaMaster,'cardmaster.json'), path.join(rutaMaster,'master.json'), path.join(rutaMaster,'CardMaster','cardmaster.json')];
            for (const p of masterPaths) {
                if (fs.existsSync(p)) {
                    try {
                        masterCardmaster = JSON.parse(fs.readFileSync(p,'utf8'));
                        console.log('Loaded master from', p);
                        break;
                    } catch (e) {
                        console.warn('Failed to parse JSON from', p, '-', e.message);
                    }
                }
            }
        }
        const cardmapPaths = [path.join(rutaMaster,'Helper','cardmap.json'), path.join(rutaMaster,'cardmap.json'), path.join(rutaMaster,'CardImageCache','cardmap.json')];
        let cardmap = null; for (const p of cardmapPaths) if (fs.existsSync(p)) { cardmap = JSON.parse(fs.readFileSync(p,'utf8')); console.log('Loaded cardmap',p); break; }

        const imageExists = (name)=>{
            const tries = [path.join(rutaMaster,'CardImageCache', `${name}.png`), path.join(rutaMaster,`${name}.png`), path.join(rutaMaster,'cardmap',`${name}.png`), path.join(rutaMaster,'cardmaster',`${name}.png`)];
            for (const t of tries) if (fs.existsSync(t)) return t;
            return null;
        }

        const results = [];
        for (const code of mejor.cards) {
            const c = code;
            let detalle = null;
            if (account[c] && typeof account[c] === 'object') detalle = account[c];
            if (!detalle && account.registeredCards && account.registeredCards[c]) detalle = account.registeredCards[c];
            if (!detalle && account.tradedCards && account.tradedCards[c]) detalle = account.tradedCards[c];
            if (!detalle && account.sharedCards && account.sharedCards[c]) detalle = account.sharedCards[c];
            if (!detalle && masterCardmaster[c]) detalle = masterCardmaster[c];
            const rarity = detalle ? (detalle.Rarity || detalle.rarity || null) : null;
            const cardmapEntry = cardmap && cardmap[c] ? cardmap[c] : null;
            const illustration = cardmapEntry ? cardmapEntry.IllustrationID : (detalle ? (detalle.IllustrationID || null) : null);
            const imgPath = illustration ? imageExists(illustration) : null;
            results.push({ code: c, rarity, illustration, imgPath });
        }

        console.table(results);
        const immersive = results.filter(r=> r.rarity && r.rarity.toString().toLowerCase().includes('immers'));
        console.log('IMMERSIVE CARDS FOUND:', immersive.length);
        immersive.forEach(i=> console.log(i.code, i.illustration, i.imgPath));

    } catch (e) { console.error(e); }
})();