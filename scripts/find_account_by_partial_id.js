const fs = require('fs');
const path = require('path');
const dir = 'C:/POKEMON/PTCGPB-ALE/Accounts/Cards/accounts';
const needle = '1c7e6e8f84';
function walk(dir) {
  const files = fs.readdirSync(dir);
  for (const f of files) {
    const p = path.join(dir, f);
    const stat = fs.statSync(p);
    if (stat.isDirectory()) {
      walk(p);
    } else if (p.toLowerCase().includes(needle)) {
      console.log('FOUND', p);
    }
  }
}
try { walk(dir); } catch (e) { console.error(e); process.exit(1); }
