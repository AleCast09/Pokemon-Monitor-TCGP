(async ()=>{
    try {
        const db = require('../database.js');
        const r = await db.get("SELECT webhook_url FROM configs_canales WHERE tipo = 'ruta_json_cuentas' LIMIT 1");
        console.log(JSON.stringify(r || null));
    } catch (e) {
        console.error('ERR', e.message);
        process.exit(1);
    }
})();