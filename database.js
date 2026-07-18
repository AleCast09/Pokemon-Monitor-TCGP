const { DatabaseSync } = require('node:sqlite');
const path = require('path');

let db;
try {
    db = new DatabaseSync(path.join(__dirname, 'database.db'));
    db.exec(`
        CREATE TABLE IF NOT EXISTS configs_extras (discord_id TEXT, tipo TEXT, estado TEXT, PRIMARY KEY (discord_id, tipo));
        CREATE TABLE IF NOT EXISTS configs_canales (discord_id TEXT, tipo TEXT, canal_id TEXT, webhook_url TEXT, PRIMARY KEY (discord_id, tipo));
        CREATE TABLE IF NOT EXISTS estados_modulos (nombre TEXT PRIMARY KEY, status TEXT);
    `);
    console.log("🟢 Base de datos 'database.db' conectada correctamente.");
} catch (err) {
    console.error("❌ Error grave al conectar la BD:", err);
    throw err;
}

module.exports = {
    get: async (q, p = []) => db.prepare(q).get(...p),
    all: async (q, p = []) => db.prepare(q).all(...p),
    run: async (q, p = []) => db.prepare(q).run(...p)
};
