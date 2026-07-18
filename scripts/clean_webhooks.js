require('dotenv').config();
const axios = require('axios');
const sqlite = require('sqlite');
const sqlite3 = require('sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'database.db');

(async () => {
  const db = await sqlite.open({ filename: DB_PATH, driver: sqlite3.Database });
  try {
    const rows = await db.all(`SELECT rowid, discord_id, tipo, canal_id, webhook_url FROM configs_canales WHERE webhook_url LIKE 'https://discord.com/api/webhooks/%'`);
    console.log(`Found ${rows.length} webhook rows to validate.`);
    for (const r of rows) {
      try {
        const res = await axios.get(r.webhook_url, { validateStatus: s => true });
        if (res.status === 200 && res.data && res.data.id) {
          console.log(`OK: row ${r.rowid} tipo=${r.tipo} canal=${r.canal_id}`);
          continue;
        }
        console.log(`Invalid webhook (status=${res.status}) - marking N/A: row ${r.rowid} tipo=${r.tipo} canal=${r.canal_id}`);
        await db.run(`UPDATE configs_canales SET webhook_url = 'N/A' WHERE rowid = ?`, [r.rowid]);
      } catch (e) {
        console.log(`Error checking row ${r.rowid}:`, e.message);
        await db.run(`UPDATE configs_canales SET webhook_url = 'N/A' WHERE rowid = ?`, [r.rowid]);
      }
    }
    console.log('Done.');
  } catch (err) {
    console.error('Error scanning DB:', err);
  } finally {
    await db.close();
  }
})();
