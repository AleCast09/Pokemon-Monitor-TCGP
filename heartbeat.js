require('dotenv').config();
const { exec, execFileSync } = require('child_process');
const db = require('./database.js');
const express = require('express');
const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');
const RUTA_HEARTBEAT_THUMBNAIL = path.join(__dirname, 'assets', 'heartbeat.png');

// Mismo criterio que rutaMuMuManager() de bot.js (duplicado a proposito -- heartbeat.js corre
// como proceso PM2 separado, sin importar nada de bot.js). Usado para el apagado/encendido
// automatico de una instancia congelada (ver recuperarInstanciaCongelada mas abajo).
function rutaMuMuManagerHb() {
    const carpetas = ['MuMuPlayer', 'MuMuPlayerGlobal-12.0'];
    const subrutas = ['nx_main', 'shell'];
    const discos = 'CDEFGHIJ'.split('');
    for (const disco of discos) {
        for (const carpeta of carpetas) {
            for (const sub of subrutas) {
                const candidato = `${disco}:\\Program Files\\Netease\\${carpeta}\\${sub}\\MuMuManager.exe`;
                if (fs.existsSync(candidato)) return candidato;
            }
        }
    }
    return null;
}

// Recuperacion automatica de una instancia realmente congelada (2026-08-14, a pedido
// explicito del usuario): en vez de solo avisar y esperar un clic manual en "Reload AHK"
// (que ademas requiere foco de teclado -- si un popup ajeno como el de MuMu pidiendo camara
// para escanear el QR de un amigo se robo el foco, el Shift+F5 nunca llegaba al script), esto
// apaga y vuelve a prender la instancia de MuMu directo por MuMuManager. Confirmado por el
// usuario: el AHK de esa instancia se vuelve a enganchar solo apenas la instancia esta
// disponible de nuevo, sin importar el orden en que se cierren/abran -- no hace falta tocar
// el AHK para nada, ni saber por que se congelo (el mismo popup de QR, u otra cosa
// cualquiera), el apagado/encendido de MuMu lo resuelve igual porque mata cualquier popup
// ajeno que dependa del proceso de esa instancia.
function obtenerInfoInstanciaHb(managerPath, index) {
    try {
        const salida = execFileSync(managerPath, ['info', '-v', String(index)], { windowsHide: true, timeout: 10000 }).toString();
        return JSON.parse(salida);
    } catch (e) {
        return null;
    }
}

// Mismo criterio que rutaAdbExe()/carpetaBaseMuMu() de bot.js -- ruta portable (no
// hardcodeada a la PC de Ale), derivada de donde sea que este PC tenga instalado MuMu.
function rutaAdbExeHb(managerPath) {
    const base = path.dirname(path.dirname(managerPath)); // .../shell/MuMuManager.exe -> raiz de MuMu
    const candidatos = [path.join(base, 'shell', 'adb.exe'), path.join(base, 'nx_main', 'adb.exe'), path.join(base, 'nx_device', '12.0', 'shell', 'adb.exe')];
    return candidatos.find((p) => fs.existsSync(p)) || null;
}

// Mismo dato que lee _InjectAccount.ahk (vm_config.json -> vm.nat.port_forward.adb.host_port),
// ubicado por indice numerico -- mas confiable que asumir una formula de puerto fija, que
// puede variar entre instalaciones.
function obtenerPuertoAdbInstanciaHb(managerPath, index) {
    const base = path.dirname(path.dirname(managerPath));
    const carpetaVms = path.join(base, 'vms');
    if (!fs.existsSync(carpetaVms)) return null;
    try {
        const carpetaInstancia = fs.readdirSync(carpetaVms).find((nombre) => nombre.endsWith(`-${index}`));
        if (!carpetaInstancia) return null;
        const rutaConfig = path.join(carpetaVms, carpetaInstancia, 'configs', 'vm_config.json');
        if (!fs.existsSync(rutaConfig)) return null;
        const config = JSON.parse(fs.readFileSync(rutaConfig, 'utf8'));
        return config?.vm?.nat?.port_forward?.adb?.host_port || null;
    } catch (e) {
        return null;
    }
}

// Reabre la app de Pokemon TCGP por ADB directo (2026-08-14, a pedido explicito del usuario:
// confirmado en vivo que apagar/prender MuMu no siempre alcanza -- a veces la instancia queda
// en el launcher de Android sin que el AHK vuelva a abrir la app solo). "monkey -c LAUNCHER"
// es el mismo mecanismo que usa Android para abrir una app desde su icono, sin necesitar tocar
// la pantalla -- funciona aunque la ventana este de fondo o tapada por otra.
async function reabrirAppPtcgpHb(managerPath, index) {
    const adbPath = rutaAdbExeHb(managerPath);
    if (!adbPath) return false;
    const puerto = obtenerPuertoAdbInstanciaHb(managerPath, index);
    if (!puerto) return false;
    const destino = `127.0.0.1:${puerto}`;
    try {
        execFileSync(adbPath, ['connect', destino], { windowsHide: true, timeout: 10000 });
        execFileSync(adbPath, ['-s', destino, 'shell', 'monkey', '-p', 'jp.pokemon.pokemontcgp', '-c', 'android.intent.category.LAUNCHER', '1'], { windowsHide: true, timeout: 10000 });
        return true;
    } catch (e) {
        console.error(`[HB] Error reabriendo la app por ADB en instancia ${index}:`, e?.stderr?.toString() || e?.message || e);
        return false;
    }
}

// Bug real reportado por el usuario 2026-08-14: si el AHK de una instancia se detiene a
// proposito (ej. "le di stop al ahk para que el bot deje de ejecutar cuentas"), los packs se
// quedan estancados para siempre -- sin este chequeo, cada TIEMPO_MAXIMO_INACTIVO_MS el
// sistema la daba por congelada y reiniciaba MuMu, lo cual nunca la arregla (nada va a volver
// a engancharse con el AHK ya cerrado) y entraba en un loop infinito de reinicios/avisos cada
// pocos minutos, para TODAS las instancias detenidas a la vez. Reusa el mismo script
// (scripts/ahk-window.ps1) que ya usa bot.js para el boton "Reload AHK".
function estaAhkCorriendoHb(index) {
    const rutaScript = path.join(__dirname, 'scripts', 'ahk-window.ps1');
    if (!fs.existsSync(rutaScript)) return true; // sin forma de chequear, no bloquear la recuperacion de siempre
    try {
        const salida = execFileSync(
            'powershell',
            ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', rutaScript, '-InstanceId', String(index), '-Action', 'check'],
            { windowsHide: true, timeout: 10000 }
        ).toString().trim();
        return salida.startsWith('FOUND:');
    } catch (e) {
        // powershell devuelve exit code 1 en NOT_FOUND -- eso es informacion valida, no un
        // error real. Solo lo tratamos como "sigue corriendo" (comportamiento de siempre) si
        // la salida no es reconocible.
        const salida = (e?.stdout || '').toString().trim();
        if (salida.startsWith('NOT_FOUND')) return false;
        return true;
    }
}

// Segundo caso real reportado por el usuario 2026-08-14 ("y de la nada se abrian"): si solo
// se cierra la instancia de MuMu a mano (dejando el AHK corriendo, esperando), el proceso de
// MuMu directamente no existe -- no es un freeze real (nada esta trabado, la instancia
// simplemente ya no esta prendida), pero el sistema la trataba igual que un freeze y la
// reabria sola sin que el usuario lo pidiera. Un freeze real significa que el PROCESO sigue
// vivo pero no responde (Windows "Not Responding", un popup ajeno la tapa, etc.) -- si el
// proceso ya no existe, es un cierre limpio (a proposito o por Windows), no algo que "recuperar".
function estaInstanciaMuMuCorriendoHb(index) {
    const managerPath = rutaMuMuManagerHb();
    if (!managerPath) return true; // sin forma de chequear, no bloquear la recuperacion de siempre
    const info = obtenerInfoInstanciaHb(managerPath, index);
    if (!info) return true; // MuMuManager no respondio -- no asumir "cerrada a proposito"
    return !!(info.is_process_started && info.pid);
}

async function recuperarInstanciaCongelada(index) {
    const managerPath = rutaMuMuManagerHb();
    if (!managerPath) return false;

    try {
        execFileSync(managerPath, ['control', 'shutdown', '-v', String(index)], { windowsHide: true, timeout: 15000 });
    } catch (e) {
        // No se corta aca -- un "shutdown" normal es solo un PEDIDO. Si el proceso quedo
        // realmente colgado (ver mas abajo), es esperable que este comando falle o se quede
        // esperando sin efecto, y el force-kill de abajo lo cubre igual.
        console.error(`[HB] Apagado normal de instancia ${index} fallo/no respondio (se sigue con force-kill de todos modos):`, e?.stderr?.toString() || e?.message || e);
    }

    await new Promise((resolve) => setTimeout(resolve, 3000));

    // El apagado "normal" de MuMuManager es un pedido -- si el proceso quedo REALMENTE
    // colgado a nivel de Windows (confirmado en vivo 2026-08-14: el cursor de "cargando" al
    // pasar el mouse y "cerrar programa" al hacer clic encima, la señal clasica de "no
    // responde" de Windows), ese pedido nunca llega a procesarse y la instancia sigue viva.
    // Se verifica si de verdad se apago; si no, se mata el proceso a la fuerza (taskkill /F)
    // antes de intentar prenderla de nuevo -- confirmado que esto sí la destraba.
    const info = obtenerInfoInstanciaHb(managerPath, index);
    if (info?.is_process_started && info?.pid) {
        console.error(`[HB] Instancia ${index} no respondio al apagado normal (proceso colgado de verdad) -- forzando kill del PID ${info.pid}`);
        try {
            execFileSync('taskkill', ['/PID', String(info.pid), '/F', '/T'], { windowsHide: true, timeout: 10000 });
        } catch (e) {
            console.error(`[HB] Error forzando kill de la instancia ${index}:`, e?.stderr?.toString() || e?.message || e);
        }
        await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    try {
        execFileSync(managerPath, ['control', 'launch', '-v', String(index)], { windowsHide: true, timeout: 15000 });
    } catch (e) {
        console.error(`[HB] Error prendiendo instancia ${index} para recuperacion:`, e?.stderr?.toString() || e?.message || e);
        return false;
    }

    // Reabrir la app por ADB directo en vez de confiar en que el AHK la vuelva a abrir solo
    // (2026-08-14, a pedido explicito del usuario, "hazlo para que los usuarios tambien puedan
    // usarlo tranquilo" -- confirmado en vivo con la instancia 2: a veces MuMu arranca bien y
    // llega al launcher de Android, pero la app nunca se reabre sola, dejando la instancia
    // "recuperada" en los papeles pero sin hacer nada de verdad). Se espera a que Android
    // termine de arrancar (hasta 60s, alcanza de sobra en la práctica) antes de mandar la
    // señal -- pedirle a ADB que abra una app antes de que el sistema este listo no hace nada.
    const limiteBoot = Date.now() + 60000;
    let androidListo = false;
    while (Date.now() < limiteBoot) {
        await new Promise((resolve) => setTimeout(resolve, 3000));
        const infoBoot = obtenerInfoInstanciaHb(managerPath, index);
        if (infoBoot?.is_android_started) { androidListo = true; break; }
    }
    if (androidListo) {
        const reabierta = await reabrirAppPtcgpHb(managerPath, index);
        if (!reabierta) console.error(`[HB] No se pudo reabrir la app por ADB en instancia ${index} (MuMu si arranco) -- puede necesitar el Reload/reintento manual del AHK igual.`);
    } else {
        console.error(`[HB] Instancia ${index}: Android no termino de arrancar en 60s, no se intento reabrir la app por ADB.`);
    }

    return true;
}

async function enviarConThumbnail(url, metodo, payload) {
    if (!fs.existsSync(RUTA_HEARTBEAT_THUMBNAIL)) {
        return metodo === 'patch' ? axios.patch(url, payload) : axios.post(url, payload);
    }
    const form = new FormData();
    form.append('payload_json', JSON.stringify(payload));
    form.append('files[0]', fs.createReadStream(RUTA_HEARTBEAT_THUMBNAIL), { filename: 'heartbeat.png' });
    const config = { headers: form.getHeaders() };
    return metodo === 'patch' ? axios.patch(url, form, config) : axios.post(url, form, config);
}
const DISCORD_TOKEN = process.env.DISCORD_BOT_TOKEN;
const DISCORD_USER_ID = process.env.DISCORD_USER_ID || null;
const RUTA_HEARTBEAT_MSG_CACHE = path.join(__dirname, 'heartbeat_message_ids.json');
const INGEST_AUTH_TOKEN = process.env.INGEST_AUTH_TOKEN || '';
const REQUIRE_INGEST_AUTH = /^true$/i.test(process.env.REQUIRE_INGEST_AUTH || (process.env.NODE_ENV === 'production' ? 'true' : 'false'));

function validarIngestToken(req) {
    if (!REQUIRE_INGEST_AUTH) return true;
    if (!INGEST_AUTH_TOKEN) return false;
    const headerToken = req.headers['x-ingest-token'] || req.headers['x-bot-token'];
    return headerToken === INGEST_AUTH_TOKEN;
}

function rutaSegura(ruta) {
    if (!ruta) return 'none';
    return path.basename(String(ruta)) || 'none';
}

// Para credenciales (webhooks, tokens) — a diferencia de rutaSegura(), que usa
// path.basename() y expondría el token entero si se le pasa una URL de webhook
// por error (el token queda justo al final del path).
function redactarValor(valor, visibles = 4) {
    if (!valor) return 'none';
    const texto = String(valor);
    if (texto.length <= visibles) return '*'.repeat(texto.length);
    return `${texto.slice(0, visibles)}...${texto.slice(-2)}`;
}

// =====================================================================
// 💾 PERSISTENCIA DE DATOS
// =====================================================================
const RUTA_CACHE = path.join(__dirname, 'stats_cache.json');
let statsCache = {};

if (fs.existsSync(RUTA_CACHE)) {
    try {
        statsCache = JSON.parse(fs.readFileSync(RUTA_CACHE, 'utf8'));
    } catch (e) { console.log("Error loading cache, starting empty."); }
}

function guardarCache() {
    fs.writeFileSync(RUTA_CACHE, JSON.stringify(statsCache, null, 2));
}

// Aviso de instancia congelada (pedido explícito del usuario 2026-07-23):
// packs estancados durante `tiempoMaximoMs` sin importar si se reporta
// offline/sleeping o no (el usuario aclaró que también usa ese estado para
// detectar instancias caídas). `avisado` evita mandar el mismo aviso en cada
// ciclo de heartbeat mientras sigue congelada; se resetea solo cuando vuelve
// a avanzar. Además del mensaje en el canal, manda un DM directo — a pedido
// del usuario, porque las notificaciones de servidores de Discord suelen
// quedar silenciadas y un DM sí le llega.
async function avisarInstanciaCongeladaSiHaceFalta(webhookUrl, instId, packs, tiempoMaximoMs, canalId, discordUserId, rutaLogsInstancias, cuentasRestantes) {
    if (!webhookUrl) return;
    if (statsCache[instId].avisado) return;
    statsCache[instId].avisado = true;
    guardarCache();
    const minutos = Math.round(tiempoMaximoMs / 60000);

    // Señal precisa por instancia (leída del log local de la herramienta de
    // Kevin, ver instanciaSinCuentasElegibles) — con respaldo al pool global
    // de cuentas si por algo no hay ruta_raiz configurada.
    const sinCuentas = instanciaSinCuentasElegibles(rutaLogsInstancias, instId) || cuentasRestantes === 0;

    let titulo, cuerpo, boton;
    if (sinCuentas) {
        titulo = '⚠️ Instance stalled — out of 24h accounts';
        cuerpo = `**Instance ${instId}** hasn't opened any new packs in the last ${minutos} minute(s) (stuck at **${packs}** packs) — it's out of eligible 24h accounts, not actually frozen. Closing it saves resources since there's nothing left for it to do today.`;
        boton = { type: 2, style: 4, custom_id: `heartbeat_cerrar::${instId}`, label: '🔒 Close Instance' };
    } else {
        // Recuperacion automatica (2026-08-14, a pedido explicito del usuario): antes esto
        // solo avisaba con un boton "Reload AHK" (Shift+F5) que requiere foco de teclado -- si
        // un popup ajeno (ej. MuMu pidiendo camara para escanear el QR de un amigo, un mal
        // clic del script de Kevin) se robo el foco, la tecla nunca llegaba al panel y nada se
        // arreglaba solo. Ahora se apaga/prende la instancia de MuMu directo -- eso mata
        // cualquier popup ajeno de paso, y el AHK (que sigue corriendo, nunca se toca) se
        // reengancha solo apenas la instancia vuelve a estar disponible, sin importar la causa
        // original del freeze.
        const recuperado = await recuperarInstanciaCongelada(instId);
        if (recuperado) {
            titulo = '🔄 Frozen instance auto-recovered';
            cuerpo = `**Instance ${instId}** hadn't opened any new packs in the last ${minutos} minute(s) (stuck at **${packs}** packs) — restarted MuMu automatically to clear it (this also dismisses any stray popup, like MuMu asking for a camera to scan a friend's QR code). The AHK should reattach on its own once it's back up.`;
            boton = null;
        } else {
            titulo = '⚠️ Frozen instance detected — auto-recovery failed';
            cuerpo = `**Instance ${instId}** hasn't opened any new packs in the last ${minutos} minute(s) (stuck at **${packs}** packs) while others keep progressing, and the automatic restart didn't work (MuMuManager.exe not found, or it failed to respond). Try manually, or use the button below.`;
            boton = { type: 2, style: 4, custom_id: `heartbeat_reload_ahk::${instId}`, label: '🔄 Reload AHK' };
        }
    }

    try {
        const payload = { embeds: [{ title: titulo, description: cuerpo, color: sinCuentas ? 0xF0A93A : (boton ? 0xE74C3C : 0x57F287) }] };
        if (boton) payload.components = [{ type: 1, components: [boton] }];
        const respuesta = await axios.post(`${webhookUrl}?wait=true`, payload);
        // Auto-borrado (2026-08-14, a pedido explicito del usuario): estos avisos de
        // "auto-recovered" no requieren ninguna accion suya, pero se van acumulando y empujan
        // hacia arriba el mensaje de heartbeat con el resumen (cuentas/sobres) que es lo que
        // realmente quiere ver de un vistazo. Los que SI requieren accion (boton presente) se
        // quedan, para no perder el aviso.
        if (!boton && respuesta?.data?.id) {
            setTimeout(() => {
                axios.delete(`${webhookUrl}/messages/${respuesta.data.id}`).catch(() => {});
            }, 30000);
        }
    } catch (e) {
        console.error(`[HB] Error mandando aviso de instancia congelada (${instId}):`, e?.message || e);
    }

    const destinoDm = discordUserId || DISCORD_USER_ID;
    if (DISCORD_TOKEN && destinoDm) {
        try {
            const headers = { Authorization: `Bot ${DISCORD_TOKEN}` };
            const dm = await axios.post('https://discord.com/api/v10/users/@me/channels', { recipient_id: destinoDm }, { headers });
            const mensajeCanal = canalId ? ` Check <#${canalId}>.` : '';
            await axios.post(`https://discord.com/api/v10/channels/${dm.data.id}/messages`, {
                content: `${titulo} — **Instance ${instId}**, stuck at ${packs} packs for ${minutos}+ min.${mensajeCanal}`
            }, { headers });
        } catch (e) {
            console.error(`[HB] Error mandando DM de instancia congelada (${instId}):`, e?.response?.data || e?.message || e);
        }
    }
}

// El texto que llega a Discord nunca dice "sin cuentas elegibles" (confirmado
// leyendo el payload real), pero la herramienta de Kevin SÍ lo escribe cada
// minuto en su propio log local (Log_{instId}.txt, en la carpeta Logs de
// ruta_raiz) — como heartbeat.js corre en la misma PC, se puede leer directo
// en vez de depender de lo que llega por Discord. Se lee solo la cola del
// archivo (pueden pesar 1MB+) en vez de todo entero.
function instanciaSinCuentasElegibles(rutaLogsInstancias, instId) {
    if (!rutaLogsInstancias) return false;
    try {
        const rutaLog = path.join(rutaLogsInstancias, `Log_${instId}.txt`);
        if (!fs.existsSync(rutaLog)) return false;
        const stats = fs.statSync(rutaLog);
        const tamanoLectura = Math.min(stats.size, 2000);
        const fd = fs.openSync(rutaLog, 'r');
        const buffer = Buffer.alloc(tamanoLectura);
        fs.readSync(fd, buffer, 0, tamanoLectura, Math.max(0, stats.size - tamanoLectura));
        fs.closeSync(fd);
        const lineas = buffer.toString('utf8').trim().split(/\r?\n/);
        const ultimaLinea = lineas[lineas.length - 1] || '';
        return /no eligible accounts/i.test(ultimaLinea);
    } catch (e) {
        return false;
    }
}

function cargarHeartbeatMsgCache() {
    try {
        if (!fs.existsSync(RUTA_HEARTBEAT_MSG_CACHE)) return {};
        return JSON.parse(fs.readFileSync(RUTA_HEARTBEAT_MSG_CACHE, 'utf8')) || {};
    } catch (e) {
        return {};
    }
}

function guardarHeartbeatMsgCache(cache) {
    fs.writeFileSync(RUTA_HEARTBEAT_MSG_CACHE, JSON.stringify(cache, null, 2));
}

async function crearWebhookSiEsNecesario(row, tipo) {
    if (!DISCORD_TOKEN || !row?.canal_id) return null;
    try {
        const response = await axios.post(
            `https://discord.com/api/v10/channels/${row.canal_id}/webhooks`,
            { name: `Bot ${tipo}`, avatar: 'https://i.imgur.com/gK1q9yS.png' },
            { headers: { Authorization: `Bot ${DISCORD_TOKEN}`, 'Content-Type': 'application/json' } }
        );
        if (response.data?.url) {
            await db.run(`UPDATE configs_canales SET webhook_url = ? WHERE tipo = ? AND canal_id = ?`, [response.data.url, tipo, row.canal_id]);
            return response.data.url;
        }
    } catch (error) {
        console.error('DEBUG: no se pudo recrear webhook heartbeat:', error?.response?.data || error?.message || error);
    }
    return null;
}

// =====================================================================
// 🖥️ MODO SERVIDOR EXPRESS
// =====================================================================
if (require.main === module || process.env.MONITOR_ROLE === 'heartbeat') {
    const app = express();
    app.use(express.text({ type: '*/*', limit: '1mb' }));
    app.use(express.json({ limit: '1mb' }));
    app.use(express.urlencoded({ extended: true, limit: '1mb' }));

    // Configurable solo para poder correr una segunda copia de prueba en la
    // misma PC sin chocar de puerto con la real — en uso normal nunca hace
    // falta tocar esto, cada usuario ya tiene su propio "localhost".
    const PORT = Number(process.env.HEARTBEAT_PORT) || 3003;
    // Vuelto de 5 a 10 minutos (2026-08-14, a pedido explicito del usuario): al haber crecido
    // la lista de amigos a agregar (~20 en vez de ~5), cada ciclo de "Add Friend" tarda mas por
    // instancia, asi que 5 minutos empezaba a confundir un ciclo lento y legitimo con un freeze real.
    const TIEMPO_MAXIMO_INACTIVO_MS = 10 * 60 * 1000;

    function obtenerBalanceDesdeArchivo(rutaBalance) {
        try {
            if (fs.existsSync(rutaBalance)) {
                const contenido = fs.readFileSync(rutaBalance, 'utf8').trim();
                const match = contenido.match(/(\d+)/);
                return match ? parseInt(match[1], 10) : 0;
            }
        } catch (e) { console.log("Balance error:", e); }
        return 0;
    }

    function contarXMLs(directorio) {
        let resultado = { totales: 0 };
        try {
            if (!fs.existsSync(directorio)) return resultado;
            const elementos = fs.readdirSync(directorio, { withFileTypes: true });
            for (const elemento of elementos) {
                const rutaCompleta = path.join(directorio, elemento.name);
                if (elemento.isDirectory()) {
                    resultado.totales += contarXMLs(rutaCompleta).totales;
                } else if (elemento.isFile() && elemento.name.toLowerCase().endsWith('.xml')) {
                    resultado.totales++; 
                }
            }
        } catch (error) { return { totales: 0 }; }
        return resultado;
    }

    app.post('/', async (req, res) => {
        if (!validarIngestToken(req)) {
            return res.status(401).send('UNAUTHORIZED');
        }

        const estado = await db.get(`SELECT status FROM estados_modulos WHERE nombre = 'heartbeat'`);
        if (estado && estado.status !== 'online') {
            return res.status(200).send('OFFLINE');
        }

        try {
            let hbConfig = null;
            if (DISCORD_USER_ID) {
                hbConfig = await db.get(`SELECT canal_id, webhook_url, discord_id FROM configs_canales WHERE tipo = 'heartbeat' AND discord_id = ? ORDER BY rowid DESC LIMIT 1`, [DISCORD_USER_ID]);
            }
            if (!hbConfig || !hbConfig.canal_id || !hbConfig.webhook_url || hbConfig.webhook_url === 'N/A' || hbConfig.webhook_url === 'local') {
                hbConfig = await db.get(`SELECT canal_id, webhook_url, discord_id FROM configs_canales WHERE tipo = 'heartbeat' AND webhook_url NOT IN ('N/A', 'local') ORDER BY rowid DESC LIMIT 1`);
            }
            if (!hbConfig || !hbConfig.canal_id) {
                hbConfig = await db.get(`SELECT canal_id, webhook_url, discord_id FROM configs_canales WHERE tipo = 'heartbeat' ORDER BY rowid DESC LIMIT 1`);
            }

            let rutaConfig = null;
            if (DISCORD_USER_ID) {
                rutaConfig = await db.get(`SELECT webhook_url FROM configs_canales WHERE tipo = 'ruta_local' AND discord_id = ? AND webhook_url NOT IN ('N/A', 'local') ORDER BY rowid DESC LIMIT 1`, [DISCORD_USER_ID]);
            }
            if (!rutaConfig || !rutaConfig.webhook_url) {
                rutaConfig = await db.get(`SELECT webhook_url FROM configs_canales WHERE tipo = 'ruta_local' AND webhook_url NOT IN ('N/A', 'local') ORDER BY rowid DESC LIMIT 1`);
            }

            // Carpeta de logs por instancia (Log_1.txt, Log_2.txt, ...) — vive en
            // disco, en la misma PC donde corre este proceso, así que se puede
            // leer directo en vez de depender de que el texto llegue a Discord
            // (confirmado que "No eligible accounts" NUNCA llega al mensaje de
            // Discord, pero SÍ queda escrito acá cada minuto).
            let rutaRaizConfig = await db.get(`SELECT webhook_url FROM configs_canales WHERE tipo = 'ruta_raiz' AND webhook_url NOT IN ('N/A', 'local') ORDER BY rowid DESC LIMIT 1`);
            const RUTA_LOGS_INSTANCIAS = rutaRaizConfig?.webhook_url ? path.join(rutaRaizConfig.webhook_url, 'Logs') : null;

            if (!hbConfig || !hbConfig.canal_id) return res.status(400).send("Missing heartbeat channel configuration in the DB");
            console.log(`[HB-DEBUG] Config seleccionada canal=${hbConfig.canal_id} webhook=${redactarValor(hbConfig.webhook_url)}`);

            // If webhook_url is missing or marked N/A/local, try to recreate it
            if (!hbConfig.webhook_url || hbConfig.webhook_url === 'N/A' || hbConfig.webhook_url === 'local') {
                const newUrl = await crearWebhookSiEsNecesario(hbConfig, 'heartbeat');
                if (newUrl) {
                    hbConfig.webhook_url = newUrl;
                }
            }

            if (!hbConfig.webhook_url || !rutaConfig || !rutaConfig.webhook_url) {
                return res.status(400).send("Missing configuration in the DB");
            }

            // DEBUG: Log the received body to see what data is arriving
            let bodyStr = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
            const allKeys = Object.keys(req.body || {});
            console.log(`[HB-DEBUG] Body length: ${bodyStr.length}, total keys: ${allKeys.length}, keys=${allKeys.join(', ')}`);
            console.log(`[HB-DEBUG] RAW body (first 800 chars): ${bodyStr.substring(0, 800)}`);
            console.log(`[HB-DEBUG] Config seleccionada canal=${hbConfig.canal_id} webhook=${redactarValor(hbConfig.webhook_url)}`);

            let DISCORD_WEBHOOK = hbConfig.webhook_url;
            const RUTA_BALANCE_RESULT = rutaConfig.webhook_url; 
            const RUTA_CARPETA_XML = path.dirname(RUTA_BALANCE_RESULT); 
            const RUTA_ID_TXT_LEGACY = path.join(__dirname, 'mensaje_id.txt'); 

            let nombreCarpeta = "Local Host";
            const partesRuta = RUTA_BALANCE_RESULT.split(/[\/\\]/);
            if (partesRuta.length > 2) {
                nombreCarpeta = partesRuta[partesRuta.length - 3]; 
            }

            let bodyText = req.body || "";
            let cleanText = bodyText;
            if (typeof bodyText === 'string') {
                const jsonMatch = bodyText.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    try {
                        let jsonObj = JSON.parse(jsonMatch[0]);
                        cleanText = jsonObj.content || (jsonObj.embeds && jsonObj.embeds[0] && jsonObj.embeds[0].description) || jsonMatch[0];
                    } catch (e) {}
                }
            } else if (typeof bodyText === 'object') {
                cleanText = bodyText.content || (bodyText.embeds && bodyText.embeds[0] && bodyText.embeds[0].description) || JSON.stringify(bodyText);
            }
            
            cleanText = String(cleanText).replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/[\\{\\"}]/g, '').trim();

            let headerText = cleanText;
            let instancesText = "";
            let splitMarker = cleanText.match(/\[Instance status[^\]]*\]/i);
            if (splitMarker) {
                headerText = cleanText.substring(0, splitMarker.index).trim();
                instancesText = cleanText.substring(splitMarker.index);
            }

            let versionBot = headerText.match(/\[(kevnITG-v[0-9.]+)\]/i)?.[1] || "kevnITG-v9.6.4";
            let modVersion = headerText.match(/Mod Version:\s*([^\n]+)/i)?.[1]?.trim() || "Leanny-v0.10.0";
            let botType = headerText.match(/Type:\s*([^\n]+)/i)?.[1]?.trim() || "Inject 13P+";
            // Los 4 modos del "Bot Mode" son: Create Bots (13P), Inject 13P+, Inject
            // Wonderpick 96P+, Inject Rewards. Solo "Inject 13P+" y "Wonderpick" trabajan
            // con un pool de cuentas de 24h real -- ahi si tiene sentido avisar "sin
            // cuentas elegibles". "Create Bots" crea y descarta una cuenta nueva por
            // ciclo (~3 min c/u) e "Inject Rewards" tampoco depende de ese pool, asi que
            // una pausa de varios minutos ahi es normal, no un stall real (confirmado
            // por el usuario 2026-07-27, reporte real de un usuario que recibia el aviso
            // en loop sin estar realmente caido).
            const esModoSinPool24h = /create bots|inject rewards/i.test(botType);

            let openingType = "Automatic Detection";
            let openingMatch = headerText.match(/Opening:\s*([^\n]+)/i);
            if (openingMatch) {
                openingType = openingMatch[1].trim();
            } else {
                let backupMatch = headerText.match(/(Pulsing Aura|Space-Time Smackdown|Genetic Apex|Mythical Discovery|Island Guardians)/i);
                if (backupMatch) openingType = backupMatch[1].trim();
            }
            
            const globalTimeMinutosRaw = headerText.match(/^Time:\s*(\d+)\s*m/im)?.[1];
            let globalTime;
            if (globalTimeMinutosRaw) {
                const totalMin = parseInt(globalTimeMinutosRaw, 10);
                const horas = Math.floor(totalMin / 60);
                const minutos = totalMin % 60;
                globalTime = horas > 0 ? `${horas}h ${minutos}min` : `${minutos}min`;
            } else {
                globalTime = "190min";
            }

            let tabla = "";
            let totalPacksGlobal = 0;
            let ppmCombinadoReal = 0; 
            let currentTime = Date.now();

            let onlineInstancesList = [];
            let offlineInstancesList = [];

            if (instancesText.length > 0) {
                let lineas = instancesText.split('\n');
                console.log(`[HB-DEBUG] Found ${lineas.length} lines in instancesText`);
                let counter = 1;

                // Pre-pasada liviana: el texto real que manda el bot de Kevin NO
                // dice en ningún lado "sin cuentas elegibles" (se confirmó
                // leyendo el texto crudo en vivo) — la única señal disponible es
                // esta cuenta de cuántas cuentas de 24h quedan en el pool global.
                // Se calcula ANTES del aviso de instancia congelada para poder
                // aclarar "puede que ya no queden cuentas" en vez de asumir que
                // es un choque real (pedido explícito del usuario 2026-07-23).
                let totalPacksPrevio = 0;
                for (const lineaPre of lineas) {
                    const m = lineaPre.match(/Packs:\s*([0-9]+)/i);
                    if (m) totalPacksPrevio += parseInt(m[1], 10);
                }
                const balanceKevinPrevio = obtenerBalanceDesdeArchivo(RUTA_BALANCE_RESULT);
                const cuentasAbiertasPrevio = Math.floor(totalPacksPrevio / 2);
                const cuentasRestantesPrevio = balanceKevinPrevio > 0 ? Math.max(0, balanceKevinPrevio - cuentasAbiertasPrevio) : 0;

                for (let linea of lineas) {
                    let ppmMatch = linea.match(/Avg:\s*([0-9.]+)/i);
                    let packsMatch = linea.match(/Packs:\s*([0-9]+)/i);

                    if (ppmMatch && packsMatch) {
                        console.log(`[HB-DEBUG] Instance ${counter}: PPM=${ppmMatch[1]}, Packs=${packsMatch[1]}`);
                        let ppm = ppmMatch[1];
                        let packs = packsMatch[1];
                        let instId = counter.toString();
                        
                        totalPacksGlobal += parseInt(packs, 10);
                        
                        let contieneActividadExtra = linea.toLowerCase().includes("friend") || 
                                                     linea.toLowerCase().includes("inject") || 
                                                     linea.toLowerCase().includes("eligible");

                        if (!statsCache[instId]) {
                            statsCache[instId] = { packs: packs, lastUpdate: currentTime, lineaExtra: contieneActividadExtra ? linea : undefined };
                        } else if (statsCache[instId].packs !== packs) {
                            statsCache[instId].packs = packs;
                            statsCache[instId].lastUpdate = currentTime;
                            statsCache[instId].lineaExtra = contieneActividadExtra ? linea : undefined;
                        } else if (contieneActividadExtra && statsCache[instId].lineaExtra !== linea) {
                            // Bug real reportado 2026-08-14: antes esto reseteaba el timer con solo que
                            // la linea SIGUIERA mencionando friend/inject/eligible, sin chequear si el
                            // texto realmente cambio -- una instancia trabada en un popup (ej. "Scan" de
                            // agregar amigo que nunca se cierra) repite la MISMA linea de "friend" para
                            // siempre, asi que el timer nunca llegaba a cumplirse y jamas avisaba, por
                            // mas que pasaran horas. Ahora solo cuenta como progreso real si el texto de
                            // esa linea cambio desde el ciclo anterior.
                            statsCache[instId].lastUpdate = currentTime;
                            statsCache[instId].lineaExtra = linea;
                        }
                        
                        guardarCache(); // Guardado persistente

                        let estaCongelado = (currentTime - statsCache[instId].lastUpdate) >= TIEMPO_MAXIMO_INACTIVO_MS;
                        // Señal en tiempo real leída del log local de la instancia
                        // (ver instanciaSinCuentasElegibles) — no depende del
                        // temporizador de 10 min, se muestra apenas el log lo dice.
                        let sinCuentasInstancia = instanciaSinCuentasElegibles(RUTA_LOGS_INSTANCIAS, instId);

                        let idStr = instId.padStart(2, '0');
                        let packsVal = packs.padStart(3, ' ');

                        let instCuentas = Math.floor(parseInt(packs, 10) / 2);
                        let cuentasVal = instCuentas.toString().padStart(2, ' ');

                        // El aviso se dispara por packs estancados durante
                        // TIEMPO_MAXIMO_INACTIVO_MS, sin importar si la instancia
                        // se reporta como offline/sleeping o no — el usuario aclaró
                        // que ese estado también lo usa para detectar instancias
                        // caídas, así que debe avisar en los dos casos por igual.
                        // Excepto en "Create Bots": ahí no hay pool de 24h, crea y
                        // descarta una cuenta nueva por ciclo (~3 min c/u) y puede
                        // pasar varios minutos sin mover el contador de packs sin
                        // que sea un stall real -- de lo contrario el aviso se
                        // repite en loop para algo que sigue funcionando bien.
                        // "!contieneActividadExtra" sacado de esta condicion (2026-08-14, bug
                        // real reportado): bloqueaba el aviso CADA VEZ que la linea actual
                        // seguia mencionando friend/inject/eligible, sin importar que
                        // estaCongelado ya estuviera bien calculado (ver el fix de lineaExtra
                        // mas arriba) -- una instancia trabada justo EN un paso de friend
                        // request (ej. el popup de escaneo de QR de MuMu) nunca iba a avisar
                        // porque su propia linea de estado sigue diciendo "friend" para
                        // siempre. estaCongelado solo ya es confiable, no hace falta este
                        // chequeo extra.
                        if (estaCongelado && !esModoSinPool24h) {
                            // Ver estaAhkCorriendoHb y estaInstanciaMuMuCorriendoHb arriba: si el
                            // usuario ya detuvo el AHK a proposito, O si el proceso de MuMu
                            // directamente ya no existe (cierre limpio, no un freeze real), no
                            // tiene sentido reiniciar ni avisar -- eso solo generaba loops de
                            // reinicio para instancias que el usuario dejo apagadas adrede.
                            if (estaAhkCorriendoHb(instId) && estaInstanciaMuMuCorriendoHb(instId)) {
                                avisarInstanciaCongeladaSiHaceFalta(DISCORD_WEBHOOK, instId, packs, TIEMPO_MAXIMO_INACTIVO_MS, hbConfig.canal_id, hbConfig.discord_id, RUTA_LOGS_INSTANCIAS, cuentasRestantesPrevio).catch(() => {});
                            } else if (statsCache[instId].avisado) {
                                statsCache[instId].avisado = false;
                                guardarCache();
                            }
                        } else if (statsCache[instId].avisado) {
                            statsCache[instId].avisado = false;
                            guardarCache();
                        }

                        // Rediseñado a pedido explícito del usuario 2026-07-23:
                        // "Off" ahora es SOLO el temporizador de 10 min sin
                        // actualizar (antes dependía del texto "offline" del
                        // propio bot de Kevin); "zzz"/Pause ahora es SOLO la
                        // lectura en vivo del log local (instancia sin cuentas
                        // elegibles), no el mismo temporizador de congelamiento.
                        if (sinCuentasInstancia) {
                            onlineInstancesList.push(counter);
                            let pausaTexto = "Pause".padStart(5, ' ');
                            tabla += `> 🖥️ \`${idStr}\` | 💤 \`${pausaTexto}\` | 📦 \`${packsVal}\` | 🔓 \`${cuentasVal}\`\n`;
                        } else if (estaCongelado && !esModoSinPool24h) {
                            offlineInstancesList.push(counter);
                            let offlineTexto = " Off ".padStart(5, ' ');
                            tabla += `> 🖥️ \`${idStr}\` | 🔴 \`${offlineTexto}\` | 📦 \`${packsVal}\` | 🔓 \`${cuentasVal}\`\n`;
                        } else {
                            onlineInstancesList.push(counter);
                            let ppmVal = ppm.padStart(5, ' ');
                            tabla += `> 🖥️ \`${idStr}\` | ⚡ \`${ppmVal}\` | 📦 \`${packsVal}\` | 🔓 \`${cuentasVal}\`\n`;

                            let ppmNumerico = parseFloat(ppm);
                            if (!isNaN(ppmNumerico)) {
                                ppmCombinadoReal += ppmNumerico;
                            }
                            // Volvió a avanzar (o nunca estuvo congelada) — se
                            // limpia el flag para que un futuro congelamiento
                            // real vuelva a avisar.
                            if (statsCache[instId].avisado) {
                                statsCache[instId].avisado = false;
                                guardarCache();
                            }
                        }
                        counter++;
                    }
                }
            }

            let balanceKevin = obtenerBalanceDesdeArchivo(RUTA_BALANCE_RESULT);
            let cuentasAbiertas = Math.floor(totalPacksGlobal / 2);
            let totalFisico = contarXMLs(RUTA_CARPETA_XML).totales;

            let cuentasRestantes = balanceKevin > 0 ? (balanceKevin - cuentasAbiertas) : 0;
            if (cuentasRestantes < 0) cuentasRestantes = 0;

            let onlineStr = onlineInstancesList.length > 0 ? onlineInstancesList.sort((a,b)=>a-b).join(', ') : "none";
            let offlineStr = offlineInstancesList.length > 0 ? offlineInstancesList.sort((a,b)=>a-b).join(', ') : "none";

            console.log(`[HB-DEBUG] Total instances found: Online=${onlineInstancesList.length}, Offline=${offlineInstancesList.length}, Total=${onlineInstancesList.length + offlineInstancesList.length}`);

            let colorFinal = offlineInstancesList.length > 0 ? 0xED4245 : 0x57F287;
            let alerta = (offlineInstancesList.length > 0) ? "🔴 **ALERT: Offline instances detected.**\n\n" : "";

            let singleEmbedDescription = `**Data bot:**`;
            singleEmbedDescription += `\n🏷️ | Version: ${versionBot}`;
            singleEmbedDescription += `\n🔖 | Mod Version: ${modVersion}`;
            singleEmbedDescription += `\n💎 | Type: ${botType}`;
            singleEmbedDescription += `\n🌌 | Opening: ${openingType}\n\n`; 
            singleEmbedDescription += `**Local Host:**`;
            singleEmbedDescription += `\n🔥 | Host: ${nombreCarpeta}`;
            singleEmbedDescription += `\n🖥️ | Ints. Online: ${onlineStr}`;
            singleEmbedDescription += `\n🖥️ | Inst. Offline: ${offlineStr}\n\n`; 
            singleEmbedDescription += `**Data Accounts:**`;
            singleEmbedDescription += `\n📌 | Accounts: ${totalFisico}`;
            singleEmbedDescription += `\n🚀 | Accounts available 24 hrs: ${cuentasRestantes}`;
            singleEmbedDescription += `\n🗃️ | Accounts opened X2 P: ${cuentasAbiertas}`;
            singleEmbedDescription += `\n📦 | Total Packets claimed: ${totalPacksGlobal}\n\n`; 
            singleEmbedDescription += `**Data time:**`;
            singleEmbedDescription += `\n⚡️ | Avg: ${ppmCombinadoReal.toFixed(2)} packs/min`; 
            singleEmbedDescription += `\n⏱️ | Total time: ${globalTime}`;
            singleEmbedDescription += `\n📁 | Folder: ${nombreCarpeta}`;
            
            singleEmbedDescription += `\n\n🟢 **ONLINE**\n\n`; 
            singleEmbedDescription += `# Data instances:`;
            singleEmbedDescription += `\n# ⚡  ${ppmCombinadoReal.toFixed(2)} PPM\n\n` + tabla;

            const heartbeatMsgCache = cargarHeartbeatMsgCache();
            const cacheKey = hbConfig.canal_id || 'heartbeat_default';
            let cargandoID = heartbeatMsgCache[cacheKey] || null;

            // Legacy fallback for old deployments that only had mensaje_id.txt
            if (!cargandoID && fs.existsSync(RUTA_ID_TXT_LEGACY)) {
                const legacyId = fs.readFileSync(RUTA_ID_TXT_LEGACY, 'utf8').trim();
                if (legacyId) cargandoID = legacyId;
            }
            if (cargandoID && !heartbeatMsgCache[cacheKey]) {
                heartbeatMsgCache[cacheKey] = cargandoID;
                guardarHeartbeatMsgCache(heartbeatMsgCache);
            }

            let payload = {
                content: alerta || null,
                embeds: [{
                    description: singleEmbedDescription,
                    color: colorFinal,
                    thumbnail: { url: 'attachment://heartbeat.png' },
                    footer: { text: "Monitor Local Host ୨♡୧ • Updated " },
                    timestamp: new Date()
                }]
            };

            const persistHeartbeatMessageId = (messageId) => {
                heartbeatMsgCache[cacheKey] = messageId;
                guardarHeartbeatMsgCache(heartbeatMsgCache);
                // keep legacy file for compatibility with existing control flow
                fs.writeFileSync(RUTA_ID_TXT_LEGACY, messageId, 'utf8');
            };

            if (cargandoID) {
                try {
                    await enviarConThumbnail(`${DISCORD_WEBHOOK}/messages/${cargandoID}`, 'patch', payload);
                } catch (errEdit) {
                    if (errEdit?.response?.status === 404 && errEdit?.response?.data?.code === 10015) {
                        const newWebhook = await crearWebhookSiEsNecesario(hbConfig, 'heartbeat');
                        if (newWebhook) {
                            DISCORD_WEBHOOK = newWebhook;
                            hbConfig.webhook_url = newWebhook;
                            try {
                                await enviarConThumbnail(`${newWebhook}/messages/${cargandoID}`, 'patch', payload);
                                return res.status(200).send('OK');
                            } catch (errPatchNewWebhook) {
                                // message may not exist for new webhook; create one below
                            }
                        }
                    }
                    const respuesta = await enviarConThumbnail(`${DISCORD_WEBHOOK}?wait=true`, 'post', payload);
                    persistHeartbeatMessageId(respuesta.data.id);
                }
            } else {
                try {
                    const respuesta = await enviarConThumbnail(`${DISCORD_WEBHOOK}?wait=true`, 'post', payload);
                    persistHeartbeatMessageId(respuesta.data.id);
                } catch (errPost) {
                    if (errPost?.response?.status === 404 && errPost?.response?.data?.code === 10015) {
                        const newWebhook = await crearWebhookSiEsNecesario(hbConfig, 'heartbeat');
                        if (newWebhook) {
                            DISCORD_WEBHOOK = newWebhook;
                            hbConfig.webhook_url = newWebhook;
                            const respuesta = await enviarConThumbnail(`${newWebhook}?wait=true`, 'post', payload);
                            persistHeartbeatMessageId(respuesta.data.id);
                        }
                    } else {
                        throw errPost;
                    }
                }
            }

            res.status(200).send("OK");
        } catch (err) { console.error("Error in monitor:", err); res.status(500).send("Error"); }
    });

    // Aviso persistente (no un popup, que no se ve de forma confiable con el
    // proceso oculto) cuando el puerto real termina siendo distinto al de
    // siempre — así la persona sabe qué poner en la Webhook URL de "S4T"/
    // "Heartbeat" en el bot lector del emulador (ej. "P BOT" de Kevin). Un
    // archivo de texto queda ahí para consultar, a diferencia de un popup
    // que se puede cerrar sin querer.
    const RUTA_AVISO_PUERTOS = path.join(__dirname, 'Ports in use.txt');
    const ENCABEZADO_AVISO_PUERTOS = [
        'Some default ports were busy, so these services started on different ones.',
        'Update the Webhook URL in your reroll tool (P BOT) to match:',
        ''
    ];
    function avisarPuertoCambiado(nombreServicio, puertoReal) {
        try {
            const prefijo = `${nombreServicio}: `;
            const lineaNueva = `${prefijo}http://localhost:${puertoReal}`;
            const lineasDatos = fs.existsSync(RUTA_AVISO_PUERTOS)
                ? fs.readFileSync(RUTA_AVISO_PUERTOS, 'utf8').split(/\r?\n/).filter((l) => l.includes(': http://localhost:') && !l.startsWith(prefijo))
                : [];
            fs.writeFileSync(RUTA_AVISO_PUERTOS, [...ENCABEZADO_AVISO_PUERTOS, ...lineasDatos, lineaNueva].join('\r\n') + '\r\n', 'utf8');
        } catch (e) { /* si falla, el puerto real igual queda en el log */ }
    }

    // Sin esto, si el conflicto de puertos era pasajero y el servicio vuelve
    // a arrancar bien en su puerto de siempre, el archivo se quedaba con el
    // aviso viejo para siempre (bug real encontrado 2026-07-24: el panel
    // mostraba un puerto que ya no correspondía a nada real).
    function limpiarAvisoPuertoSiVuelveAlDefault(nombreServicio) {
        try {
            if (!fs.existsSync(RUTA_AVISO_PUERTOS)) return;
            const prefijo = `${nombreServicio}: `;
            const lineasDatos = fs.readFileSync(RUTA_AVISO_PUERTOS, 'utf8').split(/\r?\n/).filter((l) => l.includes(': http://localhost:') && !l.startsWith(prefijo));
            if (lineasDatos.length === 0) {
                fs.unlinkSync(RUTA_AVISO_PUERTOS);
            } else {
                fs.writeFileSync(RUTA_AVISO_PUERTOS, [...ENCABEZADO_AVISO_PUERTOS, ...lineasDatos].join('\r\n') + '\r\n', 'utf8');
            }
        } catch (e) { /* no bloquea el arranque */ }
    }

    // Mismo criterio que s4t.js: todo lo que le manda datos corre en la misma PC.
    // Si el puerto ya está en uso, prueba automáticamente con el siguiente hasta
    // encontrar uno libre, sin necesitar tocar el .env a mano.
    (function iniciarServidorHeartbeat(puerto, intento = 0) {
        const servidor = app.listen(puerto, '127.0.0.1', () => {
            console.log(`🚀 Production Monitor Online on port ${puerto}`);
            if (puerto !== PORT) avisarPuertoCambiado('Heartbeat', puerto);
            else limpiarAvisoPuertoSiVuelveAlDefault('Heartbeat');
        });
        servidor.on('error', (err) => {
            if (err.code === 'EADDRINUSE' && intento < 10) {
                console.log(`⚠️ Port ${puerto} is busy, trying ${puerto + 1}...`);
                iniciarServidorHeartbeat(puerto + 1, intento + 1);
            } else {
                console.error(`❌ Could not start heartbeat: ${err.message}`);
            }
        });
    })(PORT);
}

// =====================================================================
// 🕹️ MODO COMANDOS DISCORD
// =====================================================================
else {
    module.exports = {
        async ejecutar(interaction, generarPanelControl) {
            const userId = interaction.user.id;
            try {
                const rowHb = await db.get(`SELECT webhook_url FROM configs_canales WHERE discord_id = ? AND tipo = 'heartbeat' AND webhook_url NOT IN ('N/A', 'local') ORDER BY rowid DESC LIMIT 1`, [userId]);
                const rowRuta = await db.get(`SELECT webhook_url FROM configs_canales WHERE discord_id = ? AND tipo = 'ruta_local' AND webhook_url NOT IN ('N/A', 'local') ORDER BY rowid DESC LIMIT 1`, [userId]);
                
                if (!rowHb || !rowHb.webhook_url || rowHb.webhook_url === 'N/A') {
                    return await interaction.reply({ content: "❌ **First configure the Heartbeat Webhook in the panel.**", ephemeral: true });
                }
                if (!rowRuta || !rowRuta.webhook_url || rowRuta.webhook_url === 'local' || rowRuta.webhook_url === 'N/A') {
                    return await interaction.reply({ content: "❌ **First configure the Local Path in the panel.**", ephemeral: true });
                }

                await interaction.deferUpdate(); 

                exec('pm2 jlist', { windowsHide: true }, async (err, stdout) => {
                    if (err) return console.error("Error reading PM2:", err);
                    try {
                        const procesos = JSON.parse(stdout);
                        const proc = procesos.find(p => p.name === 'heartbeat');
                        const estaOnline = proc && proc.pm2_env.status === 'online';

                        if (estaOnline) {
                            try {
                                const cache = cargarHeartbeatMsgCache();
                                const idMensaje = cache[rowHb?.canal_id] || (fs.existsSync(path.join(__dirname, 'mensaje_id.txt')) ? fs.readFileSync(path.join(__dirname, 'mensaje_id.txt'), 'utf8').trim() : null);
                                if (idMensaje) {
                                    const mensajeActual = await axios.get(`${rowHb.webhook_url}/messages/${idMensaje}`);
                                    if (mensajeActual.data && mensajeActual.data.embeds && mensajeActual.data.embeds.length > 0) {
                                        let embedCongelado = mensajeActual.data.embeds[0];
                                        let desc = embedCongelado.description;
                                        if (desc.includes('🟢 **ONLINE**')) {
                                            desc = desc.replace('🟢 **ONLINE**', '🔴 **STATUS: OFFLINE**');
                                        } else if (!desc.includes('🔴 **STATUS: OFFLINE**')) {
                                            desc = desc.replace('# Data instances:', '🔴 **STATUS: OFFLINE**\n\n# Data instances:');
                                        }
                                        embedCongelado.description = desc;
                                        embedCongelado.color = 0xED4245;
                                        await axios.patch(`${rowHb.webhook_url}/messages/${idMensaje}`, { embeds: [embedCongelado] });
                                    }
                                }
                            } catch(e) { console.log("Visual error offline:", e.message); }
                            exec('pm2 stop heartbeat', { windowsHide: true });
                        } else {
                            try {
                                const cache = cargarHeartbeatMsgCache();
                                const idMensaje = cache[rowHb?.canal_id] || (fs.existsSync(path.join(__dirname, 'mensaje_id.txt')) ? fs.readFileSync(path.join(__dirname, 'mensaje_id.txt'), 'utf8').trim() : null);
                                if (idMensaje) {
                                    const mensajeActual = await axios.get(`${rowHb.webhook_url}/messages/${idMensaje}`);
                                    if (mensajeActual.data && mensajeActual.data.embeds && mensajeActual.data.embeds.length > 0) {
                                        let embedCongelado = mensajeActual.data.embeds[0];
                                        let desc = embedCongelado.description;
                                        if (desc.includes('🔴 **STATUS: OFFLINE**')) {
                                            desc = desc.replace('🔴 **STATUS: OFFLINE**', '🟢 **ONLINE**');
                                        } else if (!desc.includes('🟢 **ONLINE**')) {
                                            desc = desc.replace('# Data instances:', '🟢 **ONLINE**\n\n# Data instances:');
                                        }
                                        embedCongelado.description = desc;
                                        embedCongelado.color = 0x57F287;
                                        await axios.patch(`${rowHb.webhook_url}/messages/${idMensaje}`, { embeds: [embedCongelado] });
                                    }
                                }
                            } catch(e) { console.log("Visual error online:", e.message); }
                            exec('pm2 start heartbeat.js --name "heartbeat"', { windowsHide: true });
                        }
                        setTimeout(async () => {
                            const nuevoPanel = await generarPanelControl(userId);
                            await interaction.editReply(nuevoPanel);
                        }, 1000);
                    } catch (e) { console.error("Error processing PM2:", e); }
                });
            } catch (error) { console.error("Error in Heartbeat module:", error); }
        }
    };
}
