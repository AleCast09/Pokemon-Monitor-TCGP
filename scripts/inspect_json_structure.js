const db = require('../database.js');
const fs = require('fs');
const path = require('path');

(async () => {
    const j = await db.get(`SELECT webhook_url FROM configs_canales WHERE tipo = 'ruta_json_cuentas' ORDER BY rowid DESC LIMIT 1`);
    const x = await db.get(`SELECT webhook_url FROM configs_canales WHERE tipo = 'ruta_xml_cuentas' ORDER BY rowid DESC LIMIT 1`);

    console.log('ruta_json_cuentas:', j?.webhook_url);
    console.log('ruta_xml_cuentas:', x?.webhook_url);

    const dir = j?.webhook_url;
    if (!dir || !fs.existsSync(dir)) { console.log('JSON dir not found'); process.exit(); }

    const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
    console.log('\nJSON files count:', files.length);

    // Read first file to see structure
    const acc = JSON.parse(fs.readFileSync(path.join(dir, files[0]), 'utf8'));
    console.log('Top-level keys:', Object.keys(acc).slice(0, 10));

    const pulls = Array.isArray(acc.pulls) ? acc.pulls
        : (acc.pulls && typeof acc.pulls === 'object') ? Object.values(acc.pulls)
        : [];

    console.log('\npulls count:', pulls.length);
    if (pulls.length) {
        const last = pulls[pulls.length - 1];
        console.log('last pull keys:', Object.keys(last));
        console.log('last pull timestamp:', last.timestamp);
        console.log('last pull cards (first 3):', JSON.stringify(last.cards?.slice(0, 3)));
    }

    // Also show XML files if available
    if (x?.webhook_url && fs.existsSync(x.webhook_url)) {
        const xmlFiles = fs.readdirSync(x.webhook_url).filter(f => f.endsWith('.xml'));
        console.log('\nXML files count:', xmlFiles.length);
        if (xmlFiles.length) console.log('Recent XMLs:', xmlFiles.slice(-3));
    }

    process.exit();
})();
