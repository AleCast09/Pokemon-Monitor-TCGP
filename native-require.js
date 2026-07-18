const { createRequire } = require('module');

let seaMod = null;
try { seaMod = require('node:sea'); } catch (e) { seaMod = null; }
const esSea = !!(seaMod && seaMod.isSea());

const baseParaResolucion = esSea ? process.execPath : (require.main?.filename || __filename);
const requireDesdeDisco = createRequire(baseParaResolucion);

module.exports = function requireNativo(nombrePaquete) {
    return requireDesdeDisco(nombrePaquete);
};
