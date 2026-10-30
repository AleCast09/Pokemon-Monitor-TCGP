const fs = require('fs');
const path = require('path');
const axios = require('axios');

// Mismo repo/URL que scripts/sync-card-types.js (que era un paso manual) —
// esto lo convierte en automático: bot.js y s4t.js llaman iniciarAutoSyncCardTypes()
// una vez al arrancar, y de ahí en más se refresca solo cada INTERVALO_MS sin
// que nadie tenga que correr el script a mano cuando sale una expansión nueva.
// El repo movio el archivo a data/v4/ (la ruta vieja da 404 desde ~agosto 2026), mismo formato.
const URL_CARTAS = 'https://raw.githubusercontent.com/chase-mew/pokemon-tcg-pocket-cards/refs/heads/main/data/v4/cards.min.json';
const DESTINO = path.join(__dirname, 'assets', 'card_types.json');
// Tipo de CADA carta por set + numero (2026-10-30, a pedido de Ale): un mismo Pokemon puede cambiar
// de tipo en una expansion nueva (Giratina ex: Psychic en A2b, Dragon en C1), y por nombre solo
// queda el primero. { sets: ["a1", ...], tipos: { "a2b-35": "Psychic", ... } }
const DESTINO_POR_NUMERO = path.join(__dirname, 'assets', 'card_types_by_number.json');
const INTERVALO_MS = 12 * 60 * 60 * 1000; // cada 12 horas alcanza — no es algo que cambie seguido

async function refrescarCardTypesJson() {
    try {
        const resp = await axios.get(URL_CARTAS, { timeout: 15000 });
        const cartas = resp.data;
        const mapa = {};
        const porNumero = {};
        const sets = new Set();
        for (const carta of cartas) {
            const m = String(carta.id || '').match(/^([a-z0-9]+)-0*(\d+)$/i);
            if (m) sets.add(m[1].toLowerCase());
            if (!carta.name || !carta.type || carta.type === 'Trainer') continue;
            if (m) porNumero[`${m[1].toLowerCase()}-${m[2]}`] = carta.type;
            const clave = carta.name.toLowerCase().trim();
            if (!mapa[clave]) mapa[clave] = carta.type;
        }
        fs.writeFileSync(DESTINO, JSON.stringify(mapa, null, 2));
        fs.writeFileSync(DESTINO_POR_NUMERO, JSON.stringify({ sets: [...sets].sort(), tipos: porNumero }));
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
