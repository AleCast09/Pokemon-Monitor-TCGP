// Vigilante de salud del bot (Ale 2026-11-20: "evitemos que pase esto").
// El 2026-11-20 a las 05:47 el bot quedo vivo pero trabado: los comandos se quedaban en "thinking" y la tarjeta
// de 📦-farm-96p no se actualizaba mas. Lo mas probable: los hilos de trabajo de Node (archivos, imagenes, DNS)
// llenos con algo que no terminaba (p. ej. DNS colgado tras un corte de red), y todo lo demas en fila detras.
//   1. Cada minuto prueba un trabajo minimo (fs.stat). Si 2 seguidos no terminan en 45 s: reinicio.
//   2. Mide si el bot se congela (un timer de 5 s que llega muy tarde).
//   3. Anota en el log las interacciones que tardan mas de 60 s, con lo que estaba esperando el proceso
//      (para encontrar la causa la proxima vez).
// El reinicio deja .reiniciando (el host NO suelta el turno) y lo hace pm2 desde fuera de este proceso.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

let reiniciando = false;
let fallos = 0;
const inicio = Date.now();

// Que estaba esperando el proceso: { FSReqCallback: 3, GetAddrInfoReqWrap: 4, TCPWRAP: 12, ... }
function recursos() {
    try {
        const c = {};
        for (const r of process.getActiveResourcesInfo()) c[r] = (c[r] || 0) + 1;
        return JSON.stringify(c);
    } catch (e) { return '?'; }
}

function reiniciar(motivo) {
    if (reiniciando) return;
    reiniciando = true;
    console.error(`🩺 Health: ${motivo} — restarting the bot (keeps the community turn). Waiting on: ${recursos()}`);
    try { fs.writeFileSync(path.join(process.cwd(), '.reiniciando'), new Date().toISOString()); } catch (e) { /* nada */ }
    try { fs.writeFileSync(path.join(__dirname, '.reiniciando'), new Date().toISOString()); } catch (e) { /* nada */ }
    const pmId = process.env.pm_id;
    if (pmId !== undefined && process.platform === 'win32') {
        try {
            // Como host.js: el pm2 que reinicia corre colgado de WMI, no de este proceso (si no, el reinicio lo mata).
            const cmd = path.join(os.tmpdir(), `monitor-pokemon-reiniciar-${pmId}.cmd`);
            fs.writeFileSync(cmd, ['@echo off', 'timeout /t 2 /nobreak >nul', `call pm2 restart ${pmId}`, ''].join('\r\n'));
            execSync(`powershell -NoProfile -Command "Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = 'cmd /c \\"${cmd}\\"' } | Out-Null"`,
                { windowsHide: true, timeout: 30000 });
        } catch (e) { console.error('🩺 Health: could not ask pm2 to restart:', e?.message || e); }
    }
    // Si pm2 no lo reinicio en 90 s (o no hay pm2), salir: pm2 lo vuelve a levantar solo.
    setTimeout(() => process.exit(1), pmId !== undefined ? 90000 : 1000).unref();
}

function probarHilos() {
    if (reiniciando) return;
    let listo = false;
    const t0 = Date.now();
    fs.stat(__filename, () => {
        listo = true;
        const ms = Date.now() - t0;
        if (ms > 10000) console.error(`🩺 Health: worker threads slow (${Math.round(ms / 1000)} s). Waiting on: ${recursos()}`);
        fallos = 0;
    });
    setTimeout(() => {
        if (listo) return;
        fallos++;
        console.error(`🩺 Health: worker threads not answering for 45 s (${fallos}/2). Waiting on: ${recursos()}`);
        if (fallos >= 2) reiniciar('worker threads stuck');
    }, 45000).unref();
}

// El bot congelado (codigo que no suelta): un timer de 5 s que llega 30+ s tarde.
let esperado = Date.now() + 5000;
setInterval(() => {
    const tarde = Date.now() - esperado;
    if (tarde > 30000) console.error(`🩺 Health: the bot was frozen ${Math.round(tarde / 1000)} s. Waiting on: ${recursos()}`);
    esperado = Date.now() + 5000;
}, 5000).unref();

// A los 3 min del arranque (que el inicio, con todo cargando, no cuente) y despues cada minuto.
setTimeout(() => { probarHilos(); setInterval(probarHilos, 60000).unref(); }, 3 * 60 * 1000).unref();

// Para cada interaccion: devuelve fin(); si tarda mas de 60 s queda anotada (solo diagnostico, no reinicia:
// hay comandos largos a proposito, como ⚡ Share/Trade).
function vigilar(interaction) {
    const nombre = interaction.commandName ? `/${interaction.commandName}` : String(interaction.customId || '?').split('::')[0];
    const t = setTimeout(() => {
        console.error(`🩺 Health: ${nombre} by ${interaction.user?.id} still running after 60 s `
            + `(acknowledged: ${interaction.deferred || interaction.replied ? 'yes' : 'NO'}). Waiting on: ${recursos()}`);
    }, 60000);
    t.unref();
    return () => clearTimeout(t);
}

module.exports = { vigilar, reiniciar, recursos, desde: () => inicio };
