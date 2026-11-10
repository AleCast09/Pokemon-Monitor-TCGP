# Cuaderno de avances (compartido entre cuentas de Claude)

Ale usa **dos cuentas de Claude** en esta misma PC (la de siempre y una nueva, Claude Pro). Las dos trabajan en esta carpeta, pero **no comparten la conversación**: lo único que comparten son los archivos. Este cuaderno es cómo se pasan el trabajo.

## Reglas (para cualquier cuenta)

1. **Al empezar**: leer este archivo completo (y `CLAUDE.md` + `docs/COMO-FUNCIONA.md` si se toca el bot).
2. **Al terminar algo** (o antes de que se acabe el uso): agregar una entrada **arriba de todo** en "Registro", con fecha, cuenta, proyecto, qué se hizo, en qué quedó y qué falta. Corto, en español.
3. **No trabajar las dos cuentas en el mismo archivo a la vez.** Si una está con el bot, la otra con otro proyecto.
4. Si se cambia algo importante del bot, actualizar también `CLAUDE.md` / `docs/COMO-FUNCIONA.md`.
5. Nada de claves, tokens, webhooks ni contraseñas en este archivo.

## Proyectos

| Proyecto | Carpeta | Chat en la app (Code) | Estado |
|---|---|---|---|
| Bot Pokémon (Monitor Pokemon) | `C:\Users\Ale TCG\Documents\Monitor Pokemon` | "Headless BOT" | En producción; ver `CLAUDE.md` |
| GD Art Agent (Geometry Dash) | `C:\Users\Ale TCG\Documents\gd-art-agent` | "Geometry dash AI" | Su propio `CLAUDE.md` + `docs\AVANCES.md` en esa carpeta |
| Mundo de Roblox (G1113) | `C:\Users\Ale TCG\Documents\G1113` | "Roblox mundo" | Su propio `CLAUDE.md` + `AVANCES.md` + `RESUMEN_G1113.md` en esa carpeta |

Cada proyecto tiene **su propio cuaderno de avances** en su carpeta; este de aquí es el del bot.

Los chats de la app también están copiados a la cuenta nueva (`C:\Users\Ale TCG\.claude-cuenta2\projects\...`, se abren con `/resume` en la terminal). La memoria de la cuenta vieja se copió a la nueva el 2026-11-08 (41 archivos); desde ahí cada una sigue por su lado, por eso lo nuevo se anota **aquí**.

## Registro (lo más nuevo arriba)

### 2026-11-10 — diegoikrew123 — Bot: Monitor Link 1.9.29 (sin publicar)
- La cuenta regresiva del Sync (Launch all Mumu / Start Bot) ahora se escribe dentro del panel de PTCGPB, debajo de "CC BY-NC 4.0 international license" (cambia ese texto y lo agranda); si no lo encuentra, usa el globito de antes. Probado en la PC de Ale (encontró el texto). Falta publicar con OK de Ale.

### 2026-11-10 09:55 — diegoikrew123 — Bot: Monitor Link 1.9.28 (publicado host-2026.11.10-0952)
- Botón de Dragonite con **circulito** dentro (verde = online, "Go offline"; rojo = offline, "Go online"; gris = no se sabe). Consulta el estado solo al abrir la ventana y al arrancar (GET `/link/online`), para no gastar el Upstash de wr98.
- Sync: cuenta regresiva de 10 s antes de Launch all Mumu y de 45 s antes de Start Bot; cada clic se comprueba en `Logs\Log_PTCGPB.txt` (hasta 3 intentos). Probado en la PC de Ale: arrancó.
- **Clave de wr98**: ahora vive en NUESTRO Upstash `zenith:wr98_redis` ({url, token}); `community.js` la toma de ahí (cada 10 min) y si no, del `.env`. Cuando wr98 la rote, actualizar solo esa clave. (La de los `.env` de los hosts era vieja: por eso el online no llegaba desde ArcaWindows.)
- Probado contra el host del turno: `/link/online` responde bien.

### 2026-11-10 09:00 — diegoikrew123 — Bot: Monitor Link 1.9.25/1.9.26 + Dragonite (publicado host-2026.11.10-0859)
- **1.9.25**: Sync reroll for Zenith Rise además pone 0 instancias + 1 Main, abre PTCGPB, aprieta Launch all Mumu y ~45 s después Start Bot (+ Yes). Al cargar, mueve todas las XML a `Accounts\Saved\1` (baneadas a la carpeta de baneadas). Probado el orden de XML; el arranque automático de PTCGPB no se probó en vivo.
- **1.9.26 / Dragonite** (Upstash de wr98, `.env` WR98_REDIS_URL/TOKEN, ahora con permiso de escritura): **My Main ID** de Monitor Link también se guarda en `users:<grupo>` (misma forma que el bot de wr98, con heartbeatName del Settings.ini de PTCGPB). **Sync** pone online (`SADD online:<grupo>`, tope 25, Rivals no). Botón nuevo **Go offline**. Nuestro bot avisa en #logging ("you are now ONLINE/OFFLINE", se borra a los 2 min). Rutas: `/link/main` (con `dragonite:true`) y `/link/online`. Código: `community.js` (registrarMainDragonite, onlineDragonite), `bot.js` (avisarDragonite).
- Probado en vivo con Ale Cast (Elite Four): online/offline + avisos OK.
- Falta: confirmar con un miembro real (registro + Sync) en el host del turno.

### 2026-11-10 (01:42) — cuenta extra — Monitor Link 1.9.23 publicado
- Publicado `host-2026.11.10-0142`. Monitor Link: ventana nueva (oscura, 3 columnas, una caja por tema, logo Zekrom embebido -> `%APPDATA%\MonitorLink\logo-v2.png`), clave vinculada como ***** con botón **Change**, estado en 2 líneas.
- Botón **Sync reroll for Zenith Rise**: escribe en `Settings.ini` del bot de Lean (PTCGPB) Group Reroll (elite/vip-elite, auto GP test 3600 Standard 150), Group Discord (ID del miembro + webhook), Wonderpick (min 2★, ignore invalid) y modo Inject Wonderpick 96P+ (70, PacksDesc); deja `.before-zenith.bak` y abre PTCGPB. Pide cerrarlo antes. El webhook vive en Upstash `zenith:group_webhook` y lo entrega `/link/reroll-config` (nunca va en el .ahk público).
- Ojo AHK: `ruta` dentro de una función es la super-global `Ruta`; y el regex con `\` no matcheaba (usar `[^""]*`).
- Siguiente: Dragonite (My Main ID -> `users:<grupo>`), esperando OK/formato de wr98.

### 2026-11-10 (00:10) — cuenta extra — Log de Fast Trade, proxies
- Publicado `host-2026.11.10-0010`: cada ⚡ Fast Share/Trade guarda su log en `<motor>\logsast_transfer.log` (tokens tapados) y, si el juego rechaza la oferta, Discord muestra "game said: …". Bot de Ale sin reiniciar (no tiene el turno).
- Fast Trade de Cyrus ☆☆ (creeeder91) fallaba con ABORTED **4008**: la cuenta tiene el juego en inglés pero sus cartas en español, y el bot ofrecía la carta en inglés. Arreglado en `scripts/fast_transfer.py` (usa el idioma de la copia que tiene la cuenta, de `card_stocks[].language_tags`); confirmado por creeeder91 y publicado en `host-2026.11.10-0100`. Códigos del juego: `engine/takasho/schema/lettuce_server/resource/player_api_error/code_pb2.py`.
- **Corrección:** DataImpulse es de Ale (comprado, se acabaron los GB porque lo compartía con todos los hosts), no regalado. Los regalados eran los 10 gratis de Webshare (ya caducados). El bloqueo `dd985ff0b1b1192f` en `monitor-link-server.js` es la cuenta de DataImpulse de Ale: quitarlo si recarga. Proxies que funcionan en la PC de Ale: `proxies2.txt` 18/19, `proxies.txt` 8/27.

### 2026-11-09 (20:30) — cuenta extra — Aviso Only Pack, versión del panel, proxies
- Publicado `host-2026.11.09-1439` + bot de Ale reiniciado (4 procesos; Arcade tiene el turno).
- **Aviso de Open Packs Only** (`aviso-only-pack.js`): al dar Start en Only Pack, tarjeta (imagen hecha con sharp) en **🔒-hosts** (no en #chat, pedido de Ale): sobre + imagen (`assets/expansions`), PPM de Only Pack (no va a LatiasBot), sobres, tiempo, cuentas que le faltan a cada miembro. Se edita cada 5 min; STOPPED en gris al parar. **Falta verlo con un Start real.** Mejora pendiente: sumar las cuentas propias del host a la lista. Prueba: `node scripts/prueba-aviso-only-pack.js`. Quedan 4 mensajes 🧪 TEST en 🔒-hosts (borrar con OK de Ale).
- God Pack UI en la PC de Ale: la versión se lee al arrancar el bot y sale ✅ si ya incluye lo publicado (antes decía "updating…" siempre).
- Lista de God Packs: se vuelve a bajar también si cambia la cantidad (hosts con código viejo no suben el contador). 17 desde el 8/11.
- **Proxies DataImpulse regalados sin tráfico** (TRAFFIC_EXHAUSTED desde 14:51): borrados de la bolsa en la PC de Ale (eran de Ale Cast y Olivel GD). Falta: Ale y Olivel → "Stop sharing proxies" en Monitor Link; revisar que Arcade/wr98 no los sigan usando.

### 2026-11-09 (13:22) — cuenta extra — Monitor Link 1.9.21 publicado
- El cuadro de la clave ya no se bloquea: un Monitor Link vinculado puede pegar una clave nueva (`/link` → Get a new key). Publicado `host-2026.11.09-1322`.
- Los que siguen en 1.9.19 (base vieja) deben borrar la línea `token=` de `%APPDATA%\MonitorLink\monitor-link-ahk.ini`, abrir Monitor Link y pegar la clave nueva (texto dado a Ale).
- Arcade ya está en la base nueva; wr98 recibió `Actualizar-Upstash-Host.bat` (escritorio de Ale; borrarlo cuando lo use).
- (Aviso de Only Pack: hecho, ver arriba.)

### 2026-11-09 (12:35) — cuenta extra — Upstash: base nueva en uso (PC de Ale)
- Base nueva gratis **zenitth** (`present-joey-109243.upstash.io`, cuenta Upstash "Ale Cast"). `.env` de Ale actualizado (respaldo `.env.antes-zenitth`), publicado `host-2026.11.09-1233` (ML 1.9.20) y bot de Ale reiniciado (4 procesos, tomó el turno).
- **God Packs viejos:** solo desde el 8 de noviembre (pedido de Ale). `gp-backfill-discord.js` ya limita a esa fecha y no repite los que subió un host; se corrió 2026-11-09 (14 de Discord + 3 de wr98). Nada más viejo.
- **Falta:** wr98 y Arcade ponen los 3 datos nuevos en su `.env` y reinician (hasta entonces siguen en la base vieja agotada y no se actualizan). Los miembros con Monitor Link 1.9.19 no encuentran al bot (la dirección cambió y la base vieja no responde): deben hacer `/link` otra vez y pegar la clave nueva; con eso pasan a 1.9.20.

### 2026-11-09 (mañana) — cuenta extra — ⚠️ Upstash sin cuota (resuelto arriba)
- **Upstash `magnetic-grackle` (la nuestra, no la de wr98) llegó a 500,000/500,000 pedidos del mes el día 9.** Turno de hosts congelado, Monitor Link no encuentra direcciones nuevas, GP farm compartido, lista de God Packs y auto-actualización de hosts sin funcionar.
- Causa: Monitor Link desconectado preguntaba la dirección cada 5 s (~17k/día por miembro) + lecturas cada 20-60 s en cada host.
- Ale **no quiere pagar** → plan: **base nueva gratis**. Código listo y commiteado (`8695fe3`, SIN publicar): ML 1.9.20 (una vez cada 2 min + recibe la base nueva por el ping), lecturas en memoria 5 min, turno cada 60 s, el webhook de GP ya no se borra si Upstash falla, vinculaciones se juntan 1 día en base nueva.
- **Falta (Ale, en casa):** crear base Free en console.upstash.com y poner `LINK_REDIS_URL`, `LINK_REDIS_TOKEN`, `LINK_REDIS_READONLY_TOKEN` en `.env` (no pegar tokens en el chat). Después: publicar, reiniciar bot de Ale (con OK), `node scripts/gp-backfill-discord.js` (sube 1,883 God Packs viejos; usa caché en %TEMP%), y wr98/Arcade ponen los mismos 3 datos en su `.env` + reinician.
- Riesgo mientras tanto: el bot viejo de wr98/Arcade puede borrar `community_gp_webhook.txt` → God Packs sin postear. Se les pidió poner el webhook en el God Pack UI.

### 2026-11-09 — cuenta extra (diegoikrew123) — Bot Pokémon: God Pack UI
- Publicado `host-2026.11.09-0648` y bot de Ale reiniciado (4 procesos). Archivos instalados en el motor de Ale.
- **Clic en GOD PACK HITS** → ventana con los God Packs de **todos los hosts**: nombre, ID 16 dígitos, XML, host, fecha/hora, collage de 5 cartas. Filtros: This session / Today / Last 7 days / All · All hosts / Only this PC · ✅/❌. ✅ = modo God Pack (Mains agregados); ❌ = Open Packs Only (no sirve, no se postea).
  - `discord_notifier.py` anota en `reports/gp_hits.jsonl`; el bot sube a Upstash `zenith:gp_hits` (últimos 1000) cada 30 s y baja `reports/gp_hits_all.json`. Solo cuenta desde hoy (los viejos no están). **Falta ver el primer God Pack real** pasar entre hosts.
- **Time left** en ACCOUNTS LEFT (cuentas que faltan ÷ velocidad de la sesión).
- **Open Packs Only** pone solo Parallel 15 · 1 s entre cuentas · 2 s entre sobres (~120 PPM por host, sin tope: el de 40 PPM es solo God Pack). Cada modo recuerda sus valores.
- inject.py: marca obligatoria ahora `GP_LIST_V1`. **SP1 también quedó publicado** (iba en el mismo archivo).
- Share de prueba: el ⚡ Share funciona; el primo de Ale (FabricioSN, nivel 13) no puede recibir (el juego responde INTERNAL). Ale probará compartirle a mano para ver el motivo.
- Siguiente idea: las de Arcade para el panel (varios sobres, "&", ancho, ventana negra, log aparte).

### 2026-11-08 (noche) — cuenta extra (diegoikrew123) — cómo se cambia de cuenta
- Cambiar de cuenta en la app: `/login` (o cerrar sesión y entrar). El chat sigue con todo su historial.
- La app guarda **una lista de chats por cuenta**: con la cuenta nueva no aparecían. El chat "Hola" copió las entradas de Headless BOT, Geometry dash AI y Roblox mundo a la lista de la cuenta nueva (`%LOCALAPPDATA%\Claude-Data\claude_pzs8sxrjxfjjc\claude-code-sessions`, respaldo en `C:\Users\Ale TCG\Documents\respaldo-lista-chats-2026-11-08`) y se reabrió la app. Las dos listas apuntan al mismo historial.
- **Para volver a la principal (diego.092626):** `/login` con esa cuenta; sus chats ya están en su lista. Un chat nuevo creado con una cuenta solo aparece en la lista de esa cuenta.
- Respaldo extra de memoria + chats al 2026-11-08: `C:\Users\Ale TCG\.claude-cuenta2` (~2,9 GB; se puede borrar cuando todo funcione bien).

### 2026-11-08 — cuenta principal — Bot Pokémon
- Hecho 07-08/11 (todo publicado salvo lo indicado): tope de PPM de la comunidad (ahora 40), solicitudes espaciadas, limpieza automática de amistades (`fr_pending`), sin pausa de Mains (los que rechazan van al final), Main pause off, devolución de lugar en el tope, cuentas propias según el modo (God Pack = elegibles, Only Pack = bloqueadas) y re-escaneo cada 15 min, prefetch de XML entre tandas, arreglo de tandas dobles, regla de elegibilidad con menos de 96 sobres, Monitor Link 1.9.19 (My Main ID, compartir < 96), vigilante del enlace/turno, respaldo por proxy en Fast Farm/Shinedust/Share-Trade, botón "Paste an ID" en Farm Tickets, destinos de Share/Trade solo propios (Friend Trade ve los dos), PPM de Only Pack no se reporta, avisos de God Pack (Pillow).
- Arcade pasó de Mac a Windows (`ArcaWindows`). El turno ahora lo toma cualquier host sano solo.
- **SP1 (sobre especial First Partners)**: funciona en la PC de Ale con el código que el chat "Roblox mundo" (antes "Proyecto Minecraft G1113") dejó en `motor-panel/inject.py` **sin commitear**. Falta commitear y publicar para que llegue a los demás hosts. Ojo: con Community farm abre también el SP1 semanal de las cuentas prestadas.
- Pendientes: "My Main ID" → Dragonite (esperando a wr98), reordenar ventana de Monitor Link, ideas de Arcade para el God Pack UI, probar en Discord "Paste an ID" y los destinos nuevos.
