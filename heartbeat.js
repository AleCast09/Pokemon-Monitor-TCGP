require('dotenv').config();
const { exec, execFileSync, spawn } = require('child_process');
const db = require('./database.js');
const express = require('express');
const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');
const os = require('os');
const RUTA_HEARTBEAT_THUMBNAIL = path.join(__dirname, 'assets', 'heartbeat.png');

// Reintento generico ante rate-limit de Discord (2026-09-11, bug real reproducido en vivo:
// varias instancias quedandose sin cuentas en el mismo ciclo de heartbeat disparan varios
// POSTs seguidos -- canal + DM por cada una -- y Discord devolvio 429 "You are being rate
// limited" para alguno de ellos, perdiendo ese aviso sin ningun reintento). Discord ya manda
// el tiempo de espera exacto en retry_after (segundos) -- se usa ese valor en vez de uno fijo.
async function axiosPostConReintento(url, data, config, intentos = 2) {
    for (let i = 0; i < intentos; i++) {
        try {
            return await axios.post(url, data, config);
        } catch (e) {
            if (e?.response?.status === 429 && i < intentos - 1) {
                const esperaMs = Math.ceil((e.response.data?.retry_after || 1) * 1000);
                await new Promise((resolve) => setTimeout(resolve, esperaMs));
                continue;
            }
            throw e;
        }
    }
}

// Mismo criterio que rutaMuMuManager() de bot.js (duplicado a proposito -- heartbeat.js corre
// como proceso PM2 separado, sin importar nada de bot.js). Usado para el apagado/encendido
// automatico de una instancia congelada (ver recuperarInstanciaCongelada mas abajo).
//
// Elige entre VARIAS instalaciones de MuMu (2026-09-11, bug real reportado en vivo por
// wR98 -- primera vez que esto corrio en una PC que no fuera la de Ale): antes devolvia el
// PRIMER candidato que existiera en disco, sin importar si tenia instancias configuradas de
// verdad. wR98 tiene DOS instalaciones (MuMuPlayer normal en C:, sin instancias reales, y
// MuMuPlayerGlobal-12.0 con su farm de verdad) -- como 'MuMuPlayer' esta primero en la
// lista, siempre se conectaba a la instalacion vacia y nunca veia sus instancias reales, sin
// ningun error visible. Ahora se consulta cada candidato encontrado y se elige el que
// reporte mas instancias reales configuradas (cualquier slot que no sea el template
// is_main/"Android Device", corriendo o no -- la sola existencia del slot ya indica cual
// instalacion es la que el usuario usa). Cacheado una vez resuelto para no pagar el costo de
// consultar cada candidato en cada ciclo.
let _rutaMuMuManagerCacheadaHb;
function rutaMuMuManagerHb() {
    if (_rutaMuMuManagerCacheadaHb !== undefined) return _rutaMuMuManagerCacheadaHb;

    const carpetas = ['MuMuPlayer', 'MuMuPlayerGlobal-12.0'];
    const subrutas = ['nx_main', 'shell'];
    const discos = 'CDEFGHIJ'.split('');
    const candidatos = [];
    for (const disco of discos) {
        for (const carpeta of carpetas) {
            for (const sub of subrutas) {
                const candidato = `${disco}:\\Program Files\\Netease\\${carpeta}\\${sub}\\MuMuManager.exe`;
                if (fs.existsSync(candidato)) candidatos.push(candidato);
            }
        }
    }
    if (candidatos.length === 0) return (_rutaMuMuManagerCacheadaHb = null);
    if (candidatos.length === 1) return (_rutaMuMuManagerCacheadaHb = candidatos[0]);

    let mejorCandidato = candidatos[0];
    let mejorConteo = -1;
    for (const candidato of candidatos) {
        try {
            const info = JSON.parse(execFileSync(candidato, ['info', '-v', 'all'], { windowsHide: true, timeout: 15000 }).toString());
            const conteo = Object.values(info).filter((i) => i && !i.is_main && i.name !== 'Android Device').length;
            console.error(`[HB] MuMuManager candidato ${candidato}: ${conteo} instancia(s) configurada(s).`);
            if (conteo > mejorConteo) { mejorConteo = conteo; mejorCandidato = candidato; }
        } catch (e) {
            console.error(`[HB] Error consultando candidato MuMuManager ${candidato}:`, e?.message || e);
        }
    }
    return (_rutaMuMuManagerCacheadaHb = mejorCandidato);
}

// Mismo criterio que rutaAutoHotkey() de bot.js (duplicado a proposito, ver nota de
// rutaMuMuManagerHb arriba). Usado para reacomodar la ventana de una instancia que se
// acaba de recuperar sola -- sin esto quedaba con tamaño/posicion cualquiera, ver
// _ArrangeWindows.ahk.
let _rutaAutoHotkeyCacheadaHb;
function rutaAutoHotkeyHb() {
    if (_rutaAutoHotkeyCacheadaHb !== undefined) return _rutaAutoHotkeyCacheadaHb;
    // Extendido a varios discos (2026-09-12, mismo fix que rutaAutoHotkey() de bot.js --
    // bug real reportado en vivo, usuario con AutoHotkey instalado fuera de C:).
    const discos = 'CDEFGHIJ'.split('');
    const candidatosFijos = [];
    for (const disco of discos) {
        candidatosFijos.push(
            `${disco}:\\Program Files\\AutoHotkey\\v1.1.37.02\\AutoHotkeyU64.exe`,
            `${disco}:\\Program Files\\AutoHotkey\\v1.1.37.02\\AutoHotkeyU32.exe`,
            `${disco}:\\Program Files\\AutoHotkey\\AutoHotkeyU64.exe`,
            `${disco}:\\Program Files\\AutoHotkey\\AutoHotkeyU32.exe`,
            `${disco}:\\Program Files\\AutoHotkey\\AutoHotkey.exe`,
            `${disco}:\\Program Files (x86)\\AutoHotkey\\AutoHotkeyU64.exe`,
            `${disco}:\\Program Files (x86)\\AutoHotkey\\AutoHotkeyU32.exe`,
            `${disco}:\\Program Files (x86)\\AutoHotkey\\AutoHotkey.exe`
        );
    }
    _rutaAutoHotkeyCacheadaHb = candidatosFijos.find(p => fs.existsSync(p)) || null;
    return _rutaAutoHotkeyCacheadaHb;
}
const RUTA_ARRANGE_WINDOWS_SCRIPT_HB = path.join(__dirname, 'automation', '_ArrangeWindows.ahk');

// La cantidad de columnas de la grilla (y el espacio entre filas) la define cada
// usuario DENTRO de la herramienta de Kevin (Settings.ini, [General] Columns= y
// [ToolsAndSystem] RowGap=) - varia por usuario (algunos usan 5, otros 10, 20...).
// _ArrangeWindows.ahk tenia esto hardcodeado a 2 columnas fijas, así que cualquier
// instancia con indice >= 2 quedaba mal ubicada para quien usara mas de 2 columnas
// (bug real reportado en vivo 2026-08-31, confirmado: Columns=5 en su Settings.ini
// real). Se lee siempre fresco (no cacheado) por si el usuario lo cambia sin
// reiniciar heartbeat.
async function obtenerRutaRaizHb() {
    try {
        const rutaRaizConfig = await db.get(`SELECT webhook_url FROM configs_canales WHERE tipo = 'ruta_raiz' AND webhook_url NOT IN ('N/A', 'local') ORDER BY rowid DESC LIMIT 1`);
        return rutaRaizConfig?.webhook_url || null;
    } catch (e) {
        return null;
    }
}

async function leerGrillaDesdeSettingsIniHb() {
    try {
        const rutaRaiz = await obtenerRutaRaizHb();
        if (!rutaRaiz) return {};
        const rutaIni = path.join(rutaRaiz, 'Settings.ini');
        if (!fs.existsSync(rutaIni)) return {};
        // Settings.ini de Kevin es UTF-16LE con BOM (formato tipico de .NET WriteAllText).
        const contenido = fs.readFileSync(rutaIni).toString('utf16le');
        const columnas = parseInt((contenido.match(/\bColumns\s*=\s*(\S+)/i) || [])[1], 10);
        const rowGap = parseInt((contenido.match(/\bRowGap\s*=\s*(-?\d+)/i) || [])[1], 10);
        // Bug real reportado en vivo 2026-08-31: _ArrangeWindows.ahk decidia si Main ocupa el
        // slot 0 de la grilla mirando si una ventana titulada "Main" EXISTE en pantalla en ese
        // instante -- si Main tarda en abrir su propia instancia (el script/hack puede estar
        // corriendo sin que la instancia real haya arrancado todavia), o esa ventana cambia de
        // estado entre una llamada y la siguiente, dos instancias distintas podian calcular el
        // mismo offset y terminar en el mismo lugar. runMain= en Settings.ini es la fuente de
        // verdad real y estable (la define el modo de operacion elegido, no el estado de una
        // ventana en un instante puntual).
        const runMainMatch = contenido.match(/\brunMain\s*=\s*(\S+)/i);
        return {
            columnas: Number.isFinite(columnas) && columnas > 0 ? columnas : null,
            rowGap: Number.isFinite(rowGap) ? rowGap : null,
            incluyeMain: runMainMatch ? runMainMatch[1] === '1' : null
        };
    } catch (e) {
        return {};
    }
}

// Relanza el script numerado de Kevin directo (2026-08-31, a pedido explicito del usuario,
// confirmado en vivo: "si tu corres el 2.ahk, va a estar ahi pendiente hasta que abras la
// instancia 2 -- una vez que hacen match se conectan automaticamente y siguen su flujo solos").
// Necesario porque forzar el cierre de un AHK colgado (ver elAhkEstaColgadoHb) mata el proceso
// entero -- a diferencia de un power-cycle de MuMu solo (que deja el AHK VIEJO vivo, esperando
// a reengancharse), aca no queda nada corriendo para esa instancia si no se relanza el script.
function relanzarScriptAhkHb(index, rutaRaiz) {
    try {
        const ahkExe = rutaAutoHotkeyHb();
        if (!ahkExe || !rutaRaiz) return false;
        const rutaScript = path.join(rutaRaiz, 'Scripts', `${index}.ahk`);
        if (!fs.existsSync(rutaScript)) return false;
        spawn(ahkExe, [rutaScript], { windowsHide: false, detached: true, stdio: 'ignore', cwd: path.dirname(rutaScript) }).unref();
        return true;
    } catch (e) {
        console.error(`[HB] No se pudo relanzar el script AHK de la instancia ${index}:`, e?.message || e);
        return false;
    }
}

async function reacomodarVentanaInstanciaHb(index) {
    try {
        const ahkExe = rutaAutoHotkeyHb();
        if (!ahkExe || !fs.existsSync(RUTA_ARRANGE_WINDOWS_SCRIPT_HB)) return;
        const { columnas, rowGap, incluyeMain } = await leerGrillaDesdeSettingsIniHb();
        const args = [RUTA_ARRANGE_WINDOWS_SCRIPT_HB, String(index)];
        if (columnas) {
            args.push(String(columnas), rowGap != null ? String(rowGap) : '0');
            if (incluyeMain !== null) args.push(incluyeMain ? '1' : '0');
        }
        spawn(ahkExe, args, { windowsHide: false, detached: true, stdio: 'ignore' }).unref();
    } catch (e) {
        console.error(`[HB] No se pudo reacomodar la ventana de la instancia ${index}:`, e?.message || e);
    }
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
        // HUNG cuenta como "sigue corriendo" aca -- no es un cierre a proposito, necesita
        // recuperacion igual (ver elAhkEstaColgadoHb, que es el chequeo especifico para esto).
        return salida.startsWith('FOUND:') || salida.startsWith('HUNG:');
    } catch (e) {
        // powershell devuelve exit code 1 en NOT_FOUND y exit code 2 en HUNG -- ambos son
        // informacion valida, no un error real. Solo lo tratamos como "sigue corriendo"
        // (comportamiento de siempre) si la salida no es reconocible.
        const salida = (e?.stdout || '').toString().trim();
        if (salida.startsWith('NOT_FOUND')) return false;
        if (salida.startsWith('HUNG:')) return true;
        return true;
    }
}

// Chequeo especifico de "colgado" (Windows "Not Responding" real, via
// SendMessageTimeout/SMTO_ABORTIFHUNG en ahk-window.ps1) -- bug real reportado en vivo
// 2026-08-31: un AHK genuinamente colgado ("AutoHotkey Unicode 64-bit no responde", visible
// con el cursor de carga de Windows) segui pasando el chequeo de "check" de siempre (la
// ventana EXISTE, solo no responde), asi que recuperarInstanciaCongelada solo reiniciaba MuMu
// en loop sin efecto: el AHK colgado nunca se reenganchaba porque el proceso viejo seguia
// vivo, trabado, ocupando el lugar. Se llama ANTES del power-cycle de MuMu para forzar el
// cierre del AHK colgado primero (via forzarCierreAhkInstanciaHb, mismo mecanismo elevado por
// Tarea Programada), dejando que Kevin arranque uno fresco solo apenas la instancia vuelva.
function elAhkEstaColgadoHb(index) {
    const rutaScript = path.join(__dirname, 'scripts', 'ahk-window.ps1');
    if (!fs.existsSync(rutaScript)) return false;
    try {
        const salida = execFileSync(
            'powershell',
            ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', rutaScript, '-InstanceId', String(index), '-Action', 'check'],
            { windowsHide: true, timeout: 10000 }
        ).toString().trim();
        return salida.startsWith('HUNG:');
    } catch (e) {
        const salida = (e?.stdout || '').toString().trim();
        return salida.startsWith('HUNG:');
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

// Opt-in a pedido explicito del usuario 2026-08-21: si esta prendido (ver
// autoApagadoSinCuentasHabilitado en bot.js, misma tabla estados_modulos), en vez de mandar el
// aviso con el boton "Close Instance" y esperar un clic manual, heartbeat.js cierra la instancia
// y su AHK solo, sin mandar ningun aviso. Reusa el mismo mecanismo que el boton "Close Instance"
// de bot.js (ver heartbeat_cerrar:: y forzarCierreAhkInstancia ahi), duplicado a proposito --
// heartbeat.js corre como proceso PM2 separado, sin importar nada de bot.js.
async function autoApagadoSinCuentasHabilitadoHb() {
    const fila = await db.get(`SELECT status FROM estados_modulos WHERE nombre = 'auto_apagado_sin_cuentas'`);
    return fila?.status === 'on';
}

// Mismo script y mismo criterio que ejecutarAccionAhkInstancia() de bot.js (duplicado a
// proposito, ver nota de rutaMuMuManagerHb arriba) -- manda la señal 0x500 (Kevin ya la
// escucha en su propio script para "detenerse tras terminar la corrida actual").
function ejecutarAccionAhkInstanciaHb(index, accion) {
    const rutaScript = path.join(__dirname, 'scripts', 'ahk-window.ps1');
    if (!fs.existsSync(rutaScript)) return false;
    try {
        const salida = execFileSync(
            'powershell',
            ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', rutaScript, '-InstanceId', String(index), '-Action', accion],
            { windowsHide: true, timeout: 10000 }
        ).toString().trim();
        return salida.startsWith('RELOADED:') || salida.startsWith('CLOSED:');
    } catch (e) {
        console.error(`[HB] Error ejecutando accion "${accion}" sobre el AHK de la instancia ${index}:`, e?.stderr?.toString() || e?.message || e);
        return false;
    }
}

// Mismo mecanismo (misma Tarea Programada "MonitorPokemon_KillAHK" y mismo archivo compartido en
// %TEMP%) que forzarCierreAhkInstancia() de bot.js -- ver el comentario largo ahi arriba para el
// por que (el AHK de Kevin corre elevado, heartbeat.js no, taskkill directo siempre falla con
// "Acceso denegado"). Duplicado a proposito, mismo criterio que el resto de este archivo.
const RUTA_KILL_AHK_TARGET_HB = path.join(os.tmpdir(), 'MonitorPokemon_kill_ahk_target.txt');
function forzarCierreAhkInstanciaHb(index) {
    try {
        const rutaScript = path.join(__dirname, 'scripts', 'ahk-window.ps1');
        if (!fs.existsSync(rutaScript)) return false;
        // Bug real reportado en vivo 2026-08-31: "check" ahora sale con exit code 2 en el
        // caso HUNG (antes solo existia 0=FOUND / 1=NOT_FOUND) -- execFileSync TIRA una
        // excepcion con cualquier exit code distinto de 0, asi que el caso HUNG (justo el que
        // esta funcion necesita para forzar el cierre) caia directo al catch de abajo sin
        // llegar a leer el PID nunca. Mismo criterio que estaAhkCorriendoHb/elAhkEstaColgadoHb
        // (que ya leian e.stdout en el catch) -- se aplica aca tambien.
        let salida;
        try {
            salida = execFileSync(
                'powershell',
                ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', rutaScript, '-InstanceId', String(index), '-Action', 'check'],
                { windowsHide: true, timeout: 10000 }
            ).toString().trim();
        } catch (e) {
            salida = (e?.stdout || '').toString().trim();
        }
        const match = salida.match(/^(?:FOUND|HUNG):(\d+)$/);
        if (!match) return false;
        const pidObjetivo = match[1];
        try {
            fs.writeFileSync(RUTA_KILL_AHK_TARGET_HB, pidObjetivo);
            execFileSync('schtasks', ['/run', '/tn', 'MonitorPokemon_KillAHK'], { windowsHide: true, timeout: 8000 });
        } catch (e) {
            console.error(`[HB] No se pudo disparar la tarea programada de cierre forzado (¿esta creada?):`, e?.stderr?.toString() || e?.message || e);
            try { execFileSync('taskkill', ['/PID', pidObjetivo, '/F'], { windowsHide: true, timeout: 8000 }); } catch (e2) { /* ver retorno final abajo */ }
        }
        return true;
    } catch (e) {
        console.error(`[HB] No se pudo forzar el cierre del AHK de la instancia ${index}:`, e?.stderr?.toString() || e?.message || e);
        return false;
    }
}

// Cierra el popup nativo de MuMu "El dispositivo Android esta apagado -- se apago de manera
// anormal, reinicie el dispositivo Android" (2026-09-10, bug real reportado en vivo -- una
// instancia crasheo, y aunque la instancia en si se recupero sola via el shutdown/relaunch
// normal de mas abajo (confirmado en vivo: ADB volvio a conectar bien), este popup especifico
// quedo huerfano en pantalla -- es un proceso SEPARADO (MuMuNxCrashReporter.exe), no parte del
// proceso de la instancia, asi que apagar/reiniciar la instancia no lo toca ni lo cierra solo.
// Se mata por nombre de imagen (no hace falta saber el PID ni de que instancia vino -- este
// reporter no identifica la instancia en su propio proceso) en CADA ciclo de heartbeat, para
// no depender de que primero se cumplan los 10 min de instancia congelada -- confirmado en
// vivo con el usuario que cerrarlo asi es seguro (la instancia de abajo sigue andando bien).
function cerrarCrashReporterMuMuSiExisteHb() {
    try {
        // stdio 'ignore' (2026-09-10, ruido real visto en vivo en heartbeat-error.log): sin
        // esto, el "ERROR: no se encontro el proceso..." que taskkill imprime el en caso
        // normal (sin ningun popup abierto, la gran mayoria de los ciclos) se hereda directo
        // al stderr de este proceso pese al catch de abajo -- taskkill lo imprime el SOLO, no
        // es este codigo el que lo logueaba. Enterraba cualquier error real de otro lado bajo
        // un muro de este mensaje esperado repetido en cada ciclo.
        execFileSync('taskkill', ['/IM', 'MuMuNxCrashReporter.exe', '/F'], { windowsHide: true, timeout: 8000, stdio: 'ignore' });
        console.error('[HB] Popup huerfano de MuMuNxCrashReporter detectado y cerrado.');
    } catch (e) {
        // Exit code no-cero cuando no hay ningun proceso con ese nombre -- caso normal en
        // casi todos los ciclos, no es un error real.
    }
}

// Mismo flujo y mismo orden que el boton "Close Instance" de bot.js (ver heartbeat_cerrar:: ahi
// -- señal 0x500 primero con MuMu todavia vivo, wait, apagar MuMu, y de respaldo un ciclo
// prender/apagar + force-kill por si el AHK quedo colgado de verdad por dentro). Se usa cuando
// autoApagadoSinCuentasHabilitadoHb() esta en ON, en vez de mandar el aviso con boton.
async function cerrarInstanciaAutoSinCuentasHb(index) {
    const managerPath = rutaMuMuManagerHb();
    ejecutarAccionAhkInstanciaHb(index, 'close');
    await new Promise((resolve) => setTimeout(resolve, 2000));
    if (managerPath) {
        try { execFileSync(managerPath, ['control', 'shutdown', '-v', String(index)], { windowsHide: true, timeout: 15000 }); }
        catch (e) { console.error(`[HB] Auto-close: apagado normal de instancia ${index} fallo/no respondio:`, e?.stderr?.toString() || e?.message || e); }
    }
    setTimeout(() => {
        if (managerPath) {
            try { execFileSync(managerPath, ['control', 'launch', '-v', String(index)], { windowsHide: true, timeout: 15000 }); }
            catch (e) { /* si esto falla no hay mucho mas que hacer, se sigue igual con el force-kill de abajo */ }
        }
        setTimeout(() => {
            if (managerPath) {
                try { execFileSync(managerPath, ['control', 'shutdown', '-v', String(index)], { windowsHide: true, timeout: 15000 }); }
                catch (e) { /* idem */ }
            }
            setTimeout(() => forzarCierreAhkInstanciaHb(index), 3000);
        }, 15000);
    }, 20000);
}

// Cola global para serializar TODAS las recuperaciones de MuMu, sin importar cuantas
// instancias distintas se detecten congeladas en el mismo ciclo (2026-08-31, bug real
// encontrado en vivo probando esta misma sesion): con muchas instancias corriendo, si 2+ se
// congelan cerca en el tiempo, cada una dispara su propio recuperarInstanciaCongelada SIN
// esperar a la anterior (avisarInstanciaCongeladaSiHaceFalta se llama con .catch(() => {}),
// sin await, por cada instancia del loop) -- varios shutdown/launch de MuMuManager casi
// simultaneos terminan tumbando su backend entero ("mainnx request failed" en TODAS las
// instancias, incluidas las que estaban bien). Confirmado reproduciendolo en vivo. Ahora cada
// recuperacion espera a que termine la anterior antes de arrancar, cueste lo que cueste
// (nunca se rompe la cola si una falla).
let colaRecuperacionMuMuHb = Promise.resolve();
function recuperarInstanciaCongeladaEnCola(index) {
    const resultado = colaRecuperacionMuMuHb.then(() => recuperarInstanciaCongelada(index));
    colaRecuperacionMuMuHb = resultado.catch(() => {});
    return resultado;
}

async function recuperarInstanciaCongelada(index) {
    const managerPath = rutaMuMuManagerHb();
    if (!managerPath) return false;

    // Bug real reportado en vivo 2026-08-31: un AHK realmente colgado ("Not Responding" de
    // Windows) seguia ahi ocupando el lugar despues de reiniciar MuMu -- power-cyclear la VM no
    // toca el proceso de AHK para nada, asi que el mismo proceso trabado seguia sin engancharse
    // nunca, en loop, sin que el usuario tuviera que estar presente para forzar "Finalizar
    // tarea" a mano. Se fuerza su cierre (mismo mecanismo elevado por Tarea Programada que ya
    // usa el auto-apagado sin cuentas) ANTES del power-cycle.
    //
    // CORRECCION 2026-08-31 (aclarado en vivo por el usuario tras confirmar que la instancia 2
    // se quedo sin NINGUN AHK corriendo despues de este paso): a diferencia de un power-cycle
    // de MuMu solo (que deja el AHK VIEJO vivo, esperando a reengancharse solo), matar el
    // proceso colgado entero NO deja nada corriendo para esa instancia -- hay que relanzar el
    // script fresco nosotros mismos. Una vez relanzado, el propio script de Kevin queda
    // esperando a que la instancia este disponible y se engancha solo apenas hace match (mismo
    // criterio confirmado en vivo por el usuario).
    if (elAhkEstaColgadoHb(index)) {
        console.error(`[HB] AHK de la instancia ${index} detectado colgado (Not Responding) -- forzando su cierre antes de reiniciar MuMu.`);
        forzarCierreAhkInstanciaHb(index);
        await new Promise((resolve) => setTimeout(resolve, 2000));
        const rutaRaiz = await obtenerRutaRaizHb();
        if (!relanzarScriptAhkHb(index, rutaRaiz)) {
            console.error(`[HB] No se pudo relanzar el script AHK de la instancia ${index} tras cerrar el colgado.`);
        }
    }

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

    // Bug real reportado en vivo 2026-08-31: MuMuManager puede devolver un error DENTRO del
    // JSON (ej. {"errcode":-502,"errmsg":"mainnx request failed"}) sin lanzar excepcion ni
    // devolver un exit code distinto de 0 -- antes esto se trataba como "encendido pedido
    // con exito" y se pasaba directo a esperar 60s a que Android arrancara, cosa que nunca
    // iba a pasar. Confirmado en vivo: el mismo error salio 2 veces seguidas en instancias
    // distintas, sugiriendo que es transitorio (servicio de MuMu momentaneamente ocupado) --
    // se reintenta unas veces con espera antes de rendirse, para que esto se resuelva solo
    // sin necesitar que alguien este ahi para abrirla a mano.
    let lanzada = false;
    for (let intento = 0; intento < 3 && !lanzada; intento++) {
        if (intento > 0) await new Promise((resolve) => setTimeout(resolve, 5000));
        try {
            const salida = execFileSync(managerPath, ['control', 'launch', '-v', String(index)], { windowsHide: true, timeout: 15000 }).toString();
            const resultado = JSON.parse(salida);
            if (resultado?.errcode === 0 || resultado?.errcode === undefined) {
                lanzada = true;
            } else {
                console.error(`[HB] MuMuManager devolvio error al prender instancia ${index} (intento ${intento + 1}/3): ${resultado.errmsg || resultado.errcode}`);
            }
        } catch (e) {
            console.error(`[HB] Error prendiendo instancia ${index} para recuperacion (intento ${intento + 1}/3):`, e?.stderr?.toString() || e?.message || e);
        }
    }
    if (!lanzada) return false;
    // A pedido explicito del usuario 2026-08-21 (bug real en vivo: la ventana quedaba mal
    // ubicada/con tamaño raro despues de una recuperacion automatica, porque este flujo nunca
    // llamaba al mismo acomodo de ventanas que ya usa Main Trade). No bloqueante -- cosmetico,
    // no debe demorar el resto de la recuperacion si la ventana tarda en aparecer.
    reacomodarVentanaInstanciaHb(index);

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
        // "Android listo" (is_android_started) no significa que el daemon de ADB ya
        // este aceptando comandos de forma confiable -- bug real visto en vivo
        // (2026-08-31): "error: closed" al reabrir la app justo despues de detectar
        // Android listo, dejando la instancia con MuMu abierto pero el juego nunca
        // reabierto. Reintenta unas veces con espera antes de rendirse.
        let reabierta = false;
        for (let intento = 0; intento < 4 && !reabierta; intento++) {
            if (intento > 0) await new Promise((resolve) => setTimeout(resolve, 3000));
            reabierta = await reabrirAppPtcgpHb(managerPath, index);
        }
        if (!reabierta) console.error(`[HB] No se pudo reabrir la app por ADB en instancia ${index} (MuMu si arranco) -- puede necesitar el Reload/reintento manual del AHK igual.`);
        // Bug real reportado en vivo 2026-08-31: esto siempre devolvia true aca abajo sin
        // importar si la app realmente reabrio o no -- avisarInstanciaCongeladaSiHaceFalta
        // mandaba "auto-recovered" (que se autoborra a los 30s) igual, y como "avisado" ya
        // queda marcado, la instancia se quedaba muerta para siempre sin ningun aviso
        // persistente ni boton para reintentar a mano.
        return reabierta;
    }

    console.error(`[HB] Instancia ${index}: Android no termino de arrancar en 60s, no se intento reabrir la app por ADB.`);
    return false;
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

// Cache en memoria de dueño-de-servidor por canal (2026-09-07): el DM de instancia
// congelada resuelve el destinatario real via API (canal -> guild -> owner_id) en vez de
// confiar en discord_id de configs_canales, que para 'heartbeat' es siempre el guildId (ver
// comentario completo en avisarInstanciaCongeladaSiHaceFalta) -- esto evita pagar esas 2
// llamadas de API en cada ciclo que dispare un aviso, ya que el dueño de un servidor casi
// nunca cambia. Se limpia una entrada puntual si la llamada con ese owner falla (ver catch).
const cacheDuenioServidorPorCanal = new Map();

// Aviso de instancia congelada (pedido explícito del usuario 2026-07-23):
// packs estancados durante `tiempoMaximoMs` sin importar si se reporta
// offline/sleeping o no (el usuario aclaró que también usa ese estado para
// detectar instancias caídas). `avisado` evita mandar el mismo aviso en cada
// ciclo de heartbeat mientras sigue congelada; se resetea solo cuando vuelve
// a avanzar. Además del mensaje en el canal, manda un DM directo — a pedido
// del usuario, porque las notificaciones de servidores de Discord suelen
// quedar silenciadas y un DM sí le llega.
async function avisarInstanciaCongeladaSiHaceFalta(webhookUrl, instId, packs, tiempoMaximoMs, canalId, discordUserId, rutaLogsInstancias, cuentasRestantes, sinCuentasYaConfirmado = false) {
    if (!webhookUrl) return;
    if (statsCache[instId].avisado) return;
    statsCache[instId].avisado = true;
    guardarCache();
    const minutos = Math.round(tiempoMaximoMs / 60000);

    // Señal precisa por instancia (leída del log local de la herramienta de
    // Kevin, ver instanciaSinCuentasElegibles) — con respaldo al pool global
    // de cuentas si por algo no hay ruta_raiz configurada. sinCuentasYaConfirmado
    // (2026-09-06, a pedido explicito del usuario): el llamador ya la calculo este
    // mismo ciclo para decidir si llamar a esta funcion de entrada -- se reusa en vez
    // de volver a leer el log, para no arriesgar una lectura ligeramente distinta
    // entre el chequeo de arriba y este.
    const sinCuentas = sinCuentasYaConfirmado || instanciaSinCuentasElegibles(rutaLogsInstancias, instId) || cuentasRestantes === 0;

    // Opt-in (2026-08-21, a pedido explicito del usuario): si esta prendido, cierra la
    // instancia/AHK sola -- ver cerrarInstanciaAutoSinCuentasHb arriba.
    if (sinCuentas && await autoApagadoSinCuentasHabilitadoHb()) {
        cerrarInstanciaAutoSinCuentasHb(instId).catch((e) => console.error(`[HB] Error en auto-close de instancia ${instId}:`, e?.message || e));
        // Aviso agregado (2026-09-06, bug real reportado en vivo -- "pero deberia mandar un
        // mensaje, no mando nada"): antes esta rama cortaba en silencio total, sin mandar
        // NADA a Discord -- una instancia se cerraba sola y desaparecia de la tabla sin
        // ningun rastro de por que.
        // Autoborrado: SACADO el 2026-09-10 y REPUESTO el 2026-09-25, las dos veces a pedido
        // explicito de Ale. Vale la pena dejar la historia porque es la misma discusion:
        //  - 2026-09-10 se saco porque con 30s, si no estabas mirando el canal en ese instante,
        //    nunca te enterabas de por que una instancia habia desaparecido de la tabla.
        //  - 2026-09-25 se repone porque cambio el contexto: desde el 2026-09-11 este mismo
        //    aviso tambien sale por DM al dueño del servidor (ver mandarDmDuenioServidorHb mas
        //    abajo), asi que el registro YA NO se pierde al borrar el del canal. Y en la practica
        //    se acumulan: con 11 instancias quedandose sin cuentas el mismo dia, once avisos
        //    seguidos empujan fuera de pantalla el resumen de sobres/cuentas, que es lo que Ale
        //    realmente mira ("no tape la opcion de donde sale toda la data").
        // El plazo es 10 minutos, no 30 segundos como los de "auto-recovered": esos no
        // requieren nada de nadie, este si conviene alcanzar a verlo en el canal.
        // Los avisos CON boton (los que piden una accion) siguen sin borrarse nunca.
        const MS_BORRAR_AVISO_AUTOCLOSE = 10 * 60 * 1000;
        try {
            const respuestaAutoClose = await axiosPostConReintento(`${webhookUrl}?wait=true`, {
                embeds: [{ title: '🔒 Instance auto-closed — out of 24h accounts', description: `**Instance ${instId}** ran out of eligible 24h accounts (stuck at **${packs}** packs) and was closed automatically to save resources.`, color: 0xF0A93A }]
            });
            if (respuestaAutoClose?.data?.id) {
                setTimeout(() => {
                    axios.delete(`${webhookUrl}/messages/${respuestaAutoClose.data.id}`).catch(() => {});
                }, MS_BORRAR_AVISO_AUTOCLOSE);
            }
        } catch (e) {
            console.error(`[HB] Error mandando aviso de auto-close de instancia (${instId}):`, e?.message || e);
        }
        await mandarDmDuenioServidorHb(canalId, `🔒 Instance auto-closed — out of 24h accounts — **Instance ${instId}**, stuck at ${packs} packs.`);
        return;
    }

    let titulo, cuerpo, boton;
    if (sinCuentas) {
        // Texto ya no asume los 10 minutos completos (2026-09-06, mismo pedido de arriba):
        // este aviso ahora puede dispararse de inmediato, apenas el log de la instancia dice
        // "sin cuentas elegibles" -- decir "hasn't opened packs in the last 10 minutes" seria
        // enganoso si en realidad se quedo sin cuentas hace unos segundos.
        titulo = '⚠️ Instance stalled — out of 24h accounts';
        cuerpo = `**Instance ${instId}** is out of eligible 24h accounts (stuck at **${packs}** packs) — not actually frozen, just nothing left for it to do today. Closing it saves resources.`;
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
        //
        // try/catch agregado (2026-08-26, bug real reportado en vivo): "avisado" ya queda en
        // true ANTES de este punto (linea de arriba), a proposito, para no spammear el mismo
        // aviso en cada ciclo -- pero eso significa que si recuperarInstanciaCongelada tira una
        // excepcion sin capturar (ej. MuMuManager.exe fallo de una forma que no se esperaba),
        // la funcion entera se cortaba ACA, nunca llegaba a mandar ningun aviso a Discord, y la
        // instancia quedaba silenciada para siempre (avisado nunca se resetea solo si los packs
        // nunca vuelven a avanzar, que es justo el caso de un freeze real). Ahora una excepcion
        // se trata igual que "recuperado = false" -- se sigue de largo y se manda el aviso de
        // "auto-recovery failed" con el boton manual, en vez de morir en silencio.
        let recuperado = false;
        try {
            recuperado = await recuperarInstanciaCongeladaEnCola(instId);
        } catch (e) {
            console.error(`[HB] Excepcion sin capturar en recuperarInstanciaCongelada(${instId}), tratada como fallo de recuperacion:`, e?.message || e);
        }
        if (recuperado) {
            titulo = '🔄 Frozen instance auto-recovered';
            cuerpo = `**Instance ${instId}** hadn't opened any new packs in the last ${minutos} minute(s) (stuck at **${packs}** packs) — restarted MuMu automatically to clear it (this also dismisses any stray popup, like MuMu asking for a camera to scan a friend's QR code). The AHK should reattach on its own once it's back up.`;
            boton = null;
        } else {
            titulo = '⚠️ Frozen instance detected — auto-recovery failed';
            cuerpo = `**Instance ${instId}** hasn't opened any new packs in the last ${minutos} minute(s) (stuck at **${packs}** packs) while others keep progressing, and the automatic restart didn't work (MuMuManager.exe not found, or it failed to respond). Try manually, or use the button below.`;
            // Renombrado de "Reload AHK" (2026-08-31, a pedido explicito del usuario): ese
            // boton antes SOLO mandaba Shift+F5 al panel de AHK, asumiendo que MuMu ya estaba
            // prendido -- inutil si la auto-recuperacion fallo justamente porque MuMu no
            // arranco (ver bot.js, mismo customId). Ahora hace el ciclo completo: prende MuMu
            // si hace falta, reabre el juego por ADB, y recien despues intenta el reload.
            boton = { type: 2, style: 4, custom_id: `heartbeat_reload_ahk::${instId}`, label: '🔧 Restart Instance' };
        }
    }

    try {
        const payload = { embeds: [{ title: titulo, description: cuerpo, color: sinCuentas ? 0xF0A93A : (boton ? 0xE74C3C : 0x57F287) }] };
        if (boton) payload.components = [{ type: 1, components: [boton] }];
        const respuesta = await axiosPostConReintento(`${webhookUrl}?wait=true`, payload);
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

    await mandarDmDuenioServidorHb(canalId, `${titulo} — **Instance ${instId}**, stuck at ${packs} packs for ${minutos}+ min.`);
}

// Extraido a funcion propia (2026-09-11, bug real reportado en vivo -- "estos mensajes lo
// enviaba por privado el bot!!!"): la rama de auto-close de arriba corta con `return` ANTES
// de llegar a este envio de DM (estaba mas abajo en la funcion, solo alcanzable por el
// camino normal de "stalled" con boton) -- una instancia que se cierra sola por falta de
// cuentas nunca mandaba el DM que el usuario esperaba, solo el mensaje del canal. Ahora
// ambas ramas llaman a esta misma funcion.
//
// Resolucion del destinatario del DM (reescrito 2026-09-07, bug real reproducido en vivo:
// el intento anterior -- 2026-09-05 -- de guardar el USER ID en discord_id para poder
// mandar el DM rompio tieneConfiguracion(guildId, 'heartbeat') y el toggle On/Off del
// panel ("se me desactivo el heartbeat, y cuando lo activo no deja"), porque esa MISMA
// columna se usa en TODOS los demas tipos de configs_canales como el guildId -- no hay
// forma de guardar ahi un user id sin romper el panel. discord_id/discordUserId (el
// parametro de avisarInstanciaCongeladaSiHaceFalta) es siempre el guildId ahora, nunca un
// usuario real -- no sirve como destino de DM. En cambio, se resuelve el dueño real del
// servidor por API en el momento (2 llamadas: canal -> guild_id -> owner_id), con cache en
// memoria por canal (el dueño de un servidor no cambia seguido) para no pagar esas 2
// llamadas en cada ciclo de heartbeat que dispare un aviso.
// Restauradas 2026-09-23 (bug real en produccion, reportado por Ale: "el heartbeat esta
// malogrado, no enciende, no me daba los resultados"). Las dos se usan mas abajo pero sus
// DEFINICIONES se habian perdido en algun refactor -- probablemente al renombrarlas con el
// sufijo Hb se actualizaron los llamados y no se copiaron los cuerpos. Efecto real: el monitor
// se caia en CADA ciclo con "ReferenceError: obtenerBalanceDesdeArchivoHb is not defined"
// (heartbeat.js:1118), antes de llegar a reportar nada -- por eso el heartbeat nunca daba
// resultados aunque el proceso figurara "online" en PM2.
// Recuperadas del primer commit del repo (5bf304e), donde existian sin el sufijo, con el mismo
// cuerpo. contarXMLsHb tambien estaba sin definir (se usa en la linea siguiente, 1282), asi que
// arreglar solo la primera habria movido el mismo crash dos lineas mas abajo.
function obtenerBalanceDesdeArchivoHb(rutaBalance) {
    try {
        if (fs.existsSync(rutaBalance)) {
            const contenido = fs.readFileSync(rutaBalance, 'utf8').trim();
            const match = contenido.match(/(\d+)/);
            return match ? parseInt(match[1], 10) : 0;
        }
    } catch (e) { /* si no se puede leer, se reporta balance 0 -- nunca debe tirar el ciclo */ }
    return 0;
}

function contarXMLsHb(directorio) {
    let resultado = { totales: 0 };
    try {
        if (!fs.existsSync(directorio)) return resultado;
        const elementos = fs.readdirSync(directorio, { withFileTypes: true });
        for (const elemento of elementos) {
            const rutaCompleta = path.join(directorio, elemento.name);
            if (elemento.isDirectory()) {
                resultado.totales += contarXMLsHb(rutaCompleta).totales;
            } else if (elemento.isFile() && elemento.name.toLowerCase().endsWith('.xml')) {
                resultado.totales++;
            }
        }
    } catch (error) { return { totales: 0 }; }
    return resultado;
}

async function mandarDmDuenioServidorHb(canalId, mensaje) {
    if (!DISCORD_TOKEN || !canalId) return;
    try {
        const headers = { Authorization: `Bot ${DISCORD_TOKEN}` };
        let ownerId = cacheDuenioServidorPorCanal.get(canalId);
        if (!ownerId) {
            const infoCanal = await axios.get(`https://discord.com/api/v10/channels/${canalId}`, { headers });
            const infoGuild = await axios.get(`https://discord.com/api/v10/guilds/${infoCanal.data.guild_id}`, { headers });
            ownerId = infoGuild.data.owner_id;
            if (ownerId) cacheDuenioServidorPorCanal.set(canalId, ownerId);
        }
        if (ownerId) {
            const dm = await axiosPostConReintento('https://discord.com/api/v10/users/@me/channels', { recipient_id: ownerId }, { headers });
            await axiosPostConReintento(`https://discord.com/api/v10/channels/${dm.data.id}/messages`, {
                content: `${mensaje} Check <#${canalId}>.`
            }, { headers });
        }
    } catch (e) {
        // Si el dueño del servidor tiene los DMs cerrados a bots, esto va a fallar con
        // "Invalid Recipient(s)" igual -- caso legitimo (nada que autocorregir), a
        // diferencia del bug de 2026-09-05 (ahi el ID en si estaba mal). El aviso en el
        // canal ya salio de todas formas, asi que no queda en silencio total.
        console.error(`[HB] Error mandando DM (canal ${canalId}):`, e?.response?.data || e?.message || e);
        cacheDuenioServidorPorCanal.delete(canalId);
    }
}

// El texto que llega a Discord nunca dice "sin cuentas elegibles" (confirmado
// leyendo el payload real), pero la herramienta de Kevin SÍ lo escribe cada
// minuto en su propio log local (Log_{instId}.txt, en la carpeta Logs de
// ruta_raiz) — como heartbeat.js corre en la misma PC, se puede leer directo
// en vez de depender de lo que llega por Discord. Se lee solo la cola del
// archivo (pueden pesar 1MB+) en vez de todo entero.
// Lee el ultimo "stuck" real que el PROPIO script de Kevin ya detecto y resolvio solo (2026-08-31,
// a pedido explicito del usuario: "por que no mejor leemos los logs de cada instancia" -- Kevin
// ya tiene su propia deteccion de atascos por PANTALLA especifica, mas fina y rapida que la
// nuestra por packs estancados, incluida Main -- que ni siquiera abre sobres, asi que nuestro
// chequeo de packs nunca la cubre). Formato real visto en Log_Main.txt:
//   [warn] Instance Main has been stuck at Social for 90s. (EL: 4521, sT: 0) Killing it...
//   [info] Restarted game. Reason: Stuck at Social...
// Solo reporta EVENTOS NUEVOS (dedupeado por el timestamp exacto de la linea, guardado en
// statsCache) -- Kevin ya se recupera solo, esto es puramente informativo.
function leerUltimoStuckKevin(rutaLogsInstancias, instId) {
    if (!rutaLogsInstancias) return null;
    try {
        const rutaLog = path.join(rutaLogsInstancias, `Log_${instId}.txt`);
        if (!fs.existsSync(rutaLog)) return null;
        const stats = fs.statSync(rutaLog);
        const tamanoLectura = Math.min(stats.size, 4000);
        const fd = fs.openSync(rutaLog, 'r');
        const buffer = Buffer.alloc(tamanoLectura);
        fs.readSync(fd, buffer, 0, tamanoLectura, Math.max(0, stats.size - tamanoLectura));
        fs.closeSync(fd);
        const lineas = buffer.toString('utf8').trim().split(/\r?\n/);
        for (let i = lineas.length - 1; i >= 0; i--) {
            const m = lineas[i].match(/^\[([^\]]+)\]\s*\[warn\]\s*Instance\s+\S+\s+has been stuck at\s+(\S+)\s+for\s+(\d+)s/i);
            if (m) return { timestamp: m[1], razon: m[2], segundos: m[3] };
        }
        return null;
    } catch (e) {
        return null;
    }
}

async function reportarStuckKevinSiEsNuevo(webhookUrl, instId, rutaLogsInstancias) {
    if (!webhookUrl) return;
    const stuck = leerUltimoStuckKevin(rutaLogsInstancias, instId);
    if (!stuck) return;
    statsCache[instId] = statsCache[instId] || {};
    if (statsCache[instId].ultimoStuckKevin === stuck.timestamp) return; // ya reportado
    statsCache[instId].ultimoStuckKevin = stuck.timestamp;
    guardarCache();
    try {
        const respuesta = await axios.post(`${webhookUrl}?wait=true`, {
            embeds: [{
                title: 'ℹ️ Kevin auto-recovered a stuck screen',
                description: `**Instance ${instId}** was stuck at **${stuck.razon}** for ${stuck.segundos}s — Kevin's own tool detected it and restarted the game automatically. No action needed.`,
                color: 0x5865F2
            }]
        });
        if (respuesta?.data?.id) {
            setTimeout(() => { axios.delete(`${webhookUrl}/messages/${respuesta.data.id}`).catch(() => {}); }, 30000);
        }
    } catch (e) {
        console.error(`[HB] Error mandando aviso de stuck de Kevin (${instId}):`, e?.message || e);
    }
}

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

    app.post('/', async (req, res) => {
        if (!validarIngestToken(req)) {
            return res.status(401).send('UNAUTHORIZED');
        }

        const estado = await db.get(`SELECT status FROM estados_modulos WHERE nombre = 'heartbeat'`);
        if (estado && estado.status !== 'online') {
            return res.status(200).send('OFFLINE');
        }

        cerrarCrashReporterMuMuSiExisteHb();

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

            // Reporta stuck's que el propio Kevin ya detecto/resolvio solo (ver
            // leerUltimoStuckKevin) -- incluye "Main" (nunca cubierta por el chequeo de packs
            // estancados de mas abajo, ya que Main no abre sobres) mas cualquier instancia
            // numerada ya conocida por ciclos anteriores. No bloqueante -- puramente
            // informativo, nunca debe frenar el resto del procesamiento del heartbeat.
            (async () => {
                for (const inst of ['Main', ...Object.keys(statsCache).filter(k => k !== 'Main')]) {
                    await reportarStuckKevinSiEsNuevo(DISCORD_WEBHOOK, inst, RUTA_LOGS_INSTANCIAS).catch(() => {});
                }
            })().catch(() => {});

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
                const balanceKevinPrevio = obtenerBalanceDesdeArchivoHb(RUTA_BALANCE_RESULT);
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
                        // "|| sinCuentasInstancia" agregado (2026-09-06, a pedido explicito del
                        // usuario -- "si dice que ya no hay mas cuentas disponibles deberia
                        // mandar directamente"): antes el aviso de "sin cuentas" (dentro de
                        // avisarInstanciaCongeladaSiHaceFalta) solo se disparaba si TAMBIEN se
                        // cumplian los 10 minutos de estaCongelado, aunque el log de la propia
                        // instancia ya dice "sin cuentas elegibles" en tiempo real -- una
                        // instancia legitimamente sin cuentas se quedaba sin avisar hasta 10
                        // minutos despues de haberse quedado sin nada que hacer. Un freeze de
                        // verdad (con cuentas disponibles) sigue esperando los 10 min como
                        // siempre -- esta condicion no lo cambia, solo agrega el caso "sin
                        // cuentas" como disparador aparte e inmediato.
                        // Chequeo de AHK/MuMu "corriendo" SALTEADO para el caso sin-cuentas
                        // (2026-09-10, causa real confirmada en vivo: MuMuManager.exe reporto
                        // "is_process_started: false" para VARIAS instancias que en ese mismo
                        // instante seguian escribiendo lineas frescas en su propio log cada
                        // minuto -- un dato directamente falso de la API de MuMu, probablemente
                        // por la carga del sistema con 10+ instancias simultaneas. Ese chequeo
                        // esta pensado para no avisar de instancias que el usuario cerro a
                        // proposito -- pero sinCuentasInstancia YA es, en si mismo, una prueba
                        // directa de que la instancia esta viva de verdad (la linea "no eligible
                        // accounts" se acaba de escribir recien en su log real): no hace falta
                        // ademas confirmarlo con una API que en ese momento estaba mintiendo.
                        // Confirmado en vivo: bloqueaba el aviso por completo para 6-7 instancias
                        // a la vez, todas realmente corriendo.
                        if ((estaCongelado && estaAhkCorriendoHb(instId) && estaInstanciaMuMuCorriendoHb(instId)) || sinCuentasInstancia) {
                            if (!esModoSinPool24h) {
                                avisarInstanciaCongeladaSiHaceFalta(DISCORD_WEBHOOK, instId, packs, TIEMPO_MAXIMO_INACTIVO_MS, hbConfig.canal_id, hbConfig.discord_id, RUTA_LOGS_INSTANCIAS, cuentasRestantesPrevio, sinCuentasInstancia).catch(() => {});
                            }
                        // Bug real reportado en vivo 2026-09-12 (wR98 -- "las instancias estan
                        // como locas se reinician a cada rato"): el reset de "avisado" no puede
                        // depender de estaAhkCorriendoHb/estaInstanciaMuMuCorriendoHb (flaky bajo
                        // carga, ver mas arriba) -- una lectura falsa resetea el flag y el ciclo
                        // siguiente vuelve a disparar un power-cycle completo de la nada, aunque
                        // la instancia siga genuinamente congelada. Ahora depende solo de que
                        // haya avanzado de verdad.
                        } else if (!estaCongelado && statsCache[instId].avisado) {
                            statsCache[instId].avisado = false;
                            guardarCache();
                        }

                        // Rediseñado a pedido explícito del usuario 2026-07-23:
                        // "Off" ahora es SOLO el temporizador de 10 min sin
                        // actualizar (antes dependía del texto "offline" del
                        // propio bot de Kevin); "zzz"/Pause ahora es SOLO la
                        // lectura en vivo del log local (instancia sin cuentas
                        // elegibles), no el mismo temporizador de congelamiento.
                        //
                        // Bug real reportado en vivo 2026-08-26: "Pause" se seguia mostrando
                        // aunque la instancia ya estuviera completamente cerrada (ej. despues
                        // de cerrarInstanciaAutoSinCuentasHb) -- instanciaSinCuentasElegibles
                        // solo lee la ULTIMA LINEA del log local, que se queda congelada
                        // diciendo "no eligible accounts" para siempre una vez que nada mas le
                        // escribe encima (el proceso ya no existe). "Pause" implica que sigue
                        // viva pero esperando cuentas -- "Stop" es el estado real cuando ya no
                        // hay ni AHK ni MuMu corriendo. Se agrega el mismo chequeo que ya usa
                        // el aviso de congelamiento (estaAhkCorriendoHb/estaInstanciaMuMuCorriendoHb)
                        // para decidir entre los dos, en vez de confiar ciegamente en el log.
                        if (sinCuentasInstancia && !(estaAhkCorriendoHb(instId) && estaInstanciaMuMuCorriendoHb(instId))) {
                            offlineInstancesList.push(counter);
                            let stopTexto = " Stop".padStart(5, ' ');
                            tabla += `> 🖥️ \`${idStr}\` | ⏹️ \`${stopTexto}\` | 📦 \`${packsVal}\` | 🔓 \`${cuentasVal}\`\n`;
                        } else if (sinCuentasInstancia) {
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

            let balanceKevin = obtenerBalanceDesdeArchivoHb(RUTA_BALANCE_RESULT);
            let cuentasAbiertas = Math.floor(totalPacksGlobal / 2);
            let totalFisico = contarXMLsHb(RUTA_CARPETA_XML).totales;

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
    (function iniciarServidorHeartbeat(puerto, intento = 0, intentosMismoPuerto = 0) {
        const servidor = app.listen(puerto, '127.0.0.1', () => {
            console.log(`🚀 Production Monitor Online on port ${puerto}`);
            if (puerto !== PORT) avisarPuertoCambiado('Heartbeat', puerto);
            else limpiarAvisoPuertoSiVuelveAlDefault('Heartbeat');
        });
        servidor.on('error', (err) => {
            if (err.code === 'EADDRINUSE' && intentosMismoPuerto < 5) {
                // Mismo criterio que s4t.js: reintentar el mismo puerto unas
                // veces antes de saltar a otro, para cubrir el toggle On/Off
                // desde /setup (pm2 restart casi inmediato tras el stop).
                console.log(`⚠️ Port ${puerto} is busy, retrying same port (${intentosMismoPuerto + 1}/5)...`);
                setTimeout(() => iniciarServidorHeartbeat(puerto, intento, intentosMismoPuerto + 1), 1000);
            } else if (err.code === 'EADDRINUSE' && intento < 10) {
                console.log(`⚠️ Port ${puerto} is busy, trying ${puerto + 1}...`);
                iniciarServidorHeartbeat(puerto + 1, intento + 1, 0);
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
