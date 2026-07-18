const axios = require('axios');
const fs = require('fs');
const path = require('path');

const URL_CARTAS = 'https://raw.githubusercontent.com/chase-mew/pokemon-tcg-pocket-cards/refs/heads/main/v4.json';
const DESTINO = path.join(__dirname, '..', 'assets', 'card_types.json');

async function main() {
    const resp = await axios.get(URL_CARTAS);
    const cartas = resp.data;

    const mapa = {};
    for (const carta of cartas) {
        if (!carta.name || !carta.type || carta.type === 'Trainer') continue;
        const clave = carta.name.toLowerCase().trim();
        if (!mapa[clave]) mapa[clave] = carta.type;
    }

    fs.writeFileSync(DESTINO, JSON.stringify(mapa, null, 2));
    console.log(`✅ Guardado assets/card_types.json con ${Object.keys(mapa).length} Pokémon.`);
}

main().catch(err => {
    console.error('❌ Error sincronizando tipos de carta:', err.message);
    process.exit(1);
});
