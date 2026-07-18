const fs = require('fs');
const path = require('path');
const accountPath = 'C:/POKEMON/PTCGPB-ALE/Accounts/Cards/accounts/1c7e6e8f84dacdce.json';
const xmlName = '58P_20260323135559_2(B).xml';
const content = fs.readFileSync(accountPath, 'utf8');
const account = JSON.parse(content);
const pulls = Array.isArray(account.pulls) ? account.pulls : Object.values(account.pulls || {});
console.log('pull count', pulls.length);
for (const pull of pulls) {
    if (!pull || !pull.timestamp || !Array.isArray(pull.cards)) continue;
    if (pull.cards.some(c => c.includes('012030'))) {
        console.log('FOUND pull', pull.timestamp, pull.pack, pull.cards.filter(c => c.includes('012030')).join(', '));
    }
}
const needle = 'PK_20_012030_';
let found = false;
for (const pull of pulls) {
    if (pull.cards.includes(needle + '01') || pull.cards.includes(needle + '02')) {
        console.log('pull has indeedee', pull.timestamp, pull.pack, pull.cards.filter(c => c.startsWith('PK_20_012030_')).join(', '));
        found = true;
    }
}
const parseDate = (name) => {
    const m = name.match(/_(\d{8})(\d{6})_/);
    if (!m) return null;
    return new Date(`${m[1].slice(0,4)}-${m[1].slice(4,6)}-${m[1].slice(6,8)}T${m[2].slice(0,2)}:${m[2].slice(2,4)}:${m[2].slice(4,6)}`);
};
console.log('xml date', parseDate(xmlName));
console.log('now date', new Date());
if (!found) console.log('No Indeedee pull found by code');
