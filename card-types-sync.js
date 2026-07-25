const fs = require('fs');
const path = require('path');
const axios = require('axios');

// Mismo repo/URL que scripts/sync-card-types.js (que era un paso manual) —
// esto lo convierte en automático: bot.js y s4t.js llaman iniciarAutoSyncCardTypes()
// una vez al arrancar, y de ahí en más se refresca solo cada INTERVALO_MS sin
// que nadie tenga que correr el script a mano cuando sale una expansión nueva.
const URL_CARTAS = 'https://raw.githubusercontent.com/chase-mew/pokemon-tcg-pocket-cards/refs/heads/main/v4.json';
const DESTINO = path.join(__dirname, 'assets', 'card_types.json');
const INTERVALO_MS = 12 * 60 * 60 * 1000; // cada 12 horas alcanza — no es algo que cambie seguido

async function refrescarCardTypesJson() {
    try {
        const resp = await axios.get(URL_CARTAS, { timeout: 15000 });
        const cartas = resp.data;
        const mapa = {};
        for (const carta of cartas) {
            if (!carta.name || !carta.type || carta.type === 'Trainer') continue;
            const clave = carta.name.toLowerCase().trim();
            if (!mapa[clave]) mapa[clave] = carta.type;
        }
        fs.writeFileSync(DESTINO, JSON.stringify(mapa, null, 2));
        console.log(`DEBUG: card_types.json refrescado automáticamente (${Object.keys(mapa).length} Pokémon).`);
    } catch (e) {
        // Si falla (sin internet, repo caído, etc.) se deja el archivo como
        // estaba — no rompe nada, simplemente no se entera de cartas nuevas
        // hasta el próximo intento.
        console.error('DEBUG: no se pudo refrescar card_types.json automáticamente:', e?.message || e);
    }
}

function iniciarAutoSyncCardTypes() {
    refrescarCardTypesJson();
    setInterval(refrescarCardTypesJson, INTERVALO_MS);
}

module.exports = { refrescarCardTypesJson, iniciarAutoSyncCardTypes };
