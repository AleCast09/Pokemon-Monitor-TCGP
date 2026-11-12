# Monitor Pokemon — contexto para Claude

Bot de Discord para Pokémon TCG Pocket (PTCGP) y la comunidad **Zenith Rise**. Lo mantiene **Ale** (Ale Cast).
Este archivo resume lo que hace falta saber para trabajar acá con cualquier cuenta de Claude.

## Cómo trabajar con Ale

- **Responder siempre en español neutro** (no voseo ni modismos rioplatenses). Llamarlo "Ale".
- **Todo texto visible en Discord va en inglés.** Los mensajes para otros miembros (Arcade, Chester, etc.) se le dan listos para pegar, en inglés; para wr98, en español.
- **Respuestas cortas y paso a paso.** Si se confunde ("no entiendo"), simplificar más, no alargar.
- **Dar siempre la ruta completa** de cada archivo o carpeta (ej. `C:\Users\Ale TCG\Documents\Monitor Pokemon\bot.js`).
- **Producción:** no cambiar código que funciona sin pedir confirmación. **Preguntar antes de reiniciar** procesos PM2 (corta corridas en curso). Publicar a los hosts solo con su OK.
- **Nunca** pegar en Discord ni en chats tokens, webhooks, claves de proxies ni contraseñas. No leer archivos `.pem` ni de credenciales.
- Las cuentas (XML) de los miembros **nunca se guardan en un host** y su JSON nunca sale de su PC.
- Hay más memoria local en `C:\Users\Ale TCG\.claude\projects\C--Users-Ale-TCG-Documents-Monitor-Pokemon\memory\` (solo en esta PC).
- **Cómo funciona por dentro** (turno, Monitor Link, GP farm, PPM, solicitudes, limpieza, motor, publicar): leer `docs/COMO-FUNCIONA.md` antes de tocar esas partes.
- **Ale usa dos cuentas de Claude** que no comparten la conversación. **Al empezar, leer `docs/AVANCES.md`**; al terminar algo (o antes de quedarse sin uso), **anotar ahí** qué se hizo y en qué quedó (lo más nuevo arriba). Ahí también están los otros proyectos (Geometry Dash, Roblox).

## Procesos (PM2, en la PC de Ale)

Deben ser **4**: `bot` (bot.js), `trading` (s4t.js), `heartbeat` (heartbeat.js), `monitorlink` (monitor-link/monitor-link.js).
En Windows `pm2 restart bot` a veces deja una copia vieja viva: reiniciar con `pm2 stop bot` → cerrar los `ProcessContainerFork` sobrantes → `pm2 start bot`, y contar que queden 4.

## Archivos principales

- `bot.js` — slash commands, paneles, canales, Info Accounts, panel de hosts de la comunidad.
- `s4t.js` (+ `collage-mesa.js`) — avisos de cartas por webhook (Save for Trade), collage.
- `heartbeat.js` — recibe el heartbeat del bot de Lean en `localhost:3003` y arma la telemetría.
- `monitor-link-server.js` + `monitor-link/Monitor Link.ahk` — enlace con la PC de cada miembro (`/link`).
- `community-host.js` — turno entre hosts, estado en Upstash (`zenith:hosts`, `zenith:reroll`, `zenith:miembros`).
- `reroll-comunidad.js` — **GP farm** de la comunidad (cuentas prestadas).
- `fast-transfer.js` — ⚡ Fast Share/Trade con el motor.
- `card-types-sync.js` — tipos de cartas (repo PocketDecks, data/v4 + data/v5 para sets nuevos).
- `host.js`, `host-setup.js`, `host-updater.js` — instalación y autoactualización de hosts (Windows y Mac).
- `motor-panel/` — `god_pack_gui.py` e `inject.py` que el bot copia al motor de cada host (solo si no fueron modificados a mano; deja `.bak`).

## Motor (bot de Miguel, "Headless")

Carpeta en la PC de Ale: `C:\Users\Ale TCG\Desktop\ptcgp-capturedeluxe`. Habla directo con el servidor del juego (sin MuMu) a través del túnel `proxy\takasho-proxy.exe` (puerto 9090).
- Panel: `tools\god_pack_gui\god_pack_gui.py` (se abre con `_god_pack_gui.bat`).
- Apertura de sobres: `scripts\god_pack\inject.py`. **Siempre pasar `--product-id`** del sobre (`scripts\flow\pack_catalog.py`); sin él usa el de Team Rocket y el juego responde `PurchaseV2 INTERNAL`.
- Actualizar a una versión nueva del juego: XAPK en `workbench\xapk` + `scripts\update_bot.py`.

## Comunidad Zenith Rise

**Hosts** (nombre del host / bot de Discord):
- Ale → `DESKTOP-SLADB1P` / Pokedex! (corre desde este repo, no se autoactualiza). Su Monitor Link es `C:\POKEMON\PTCGPB-ALE\Monitor Link.ahk`, vinculado a Discord **alecast_09** (Ale Cast).
- wr98 → `ZenithBot` / TradeBot (Windows). wr98 también maneja **LatiasBot** (telemetría/PPM de Zenith) y **Dragonite** (registro de Mains, Upstash `users:<grupo>`).
- Arcade → `ArcaWindows` / GengarBot (Windows desde 2026-11-07; la Mac `ArcaMac` se desinstaló: daba demasiados problemas).

Un host tiene el **turno** (atiende los comandos y los Monitor Link); los demás quedan en espera. Los comandos exigen el rol **Monitor**, que da el bot del turno al vincular: el rol de ese bot debe estar **por encima** de "Monitor" en Discord.
- El turno es la clave `zenith:host` en Upstash (candado de 90 s que renueva el dueño). Pasarlo a mano: `SET zenith:host <nombre> PX 90000`.
- **Vigilante del enlace** (bot.js): cada host prueba su dirección pública de Monitor Link cada 2 min y reinicia cloudflared si no responde; un host en espera toma el turno si la del turno no responde ~6 min (avisa en 🔒-hosts).
- El turno **no tiene que ver con el reroll**: un host puede tener el turno sin farmear.

**GP farm** (abrir sobres de cuentas prestadas por Monitor Link + las propias del host):
- Al prender la PC el host queda **Offline**. Se prende solo con **Start** en el God Pack UI con *Community farm*. **Stop** o cerrar el panel lo apaga. **Nunca hacer que farmee solo.**
- **Run Mode**: *God Pack* abre solo cuentas **elegibles**; *Open Packs Only* abre solo las **bloqueadas** (no manda solicitudes y no reporta PPM). Primero las propias del host, después las prestadas; el panel vuelve a revisar las propias cada 15 min.
- **Elegible** (regla de Ale, en Monitor Link `SobresFaltanGP` y en `inject.py` `_gp_packs_missing`): 96+ sobres en total y 96 sobres desde la última pausa de 30+ días. Monitor Link 1.9.19 deja compartir también cuentas con menos de 96 (van a Only Pack hasta llegar).
- Las prestadas se reparten entre los hosts del mismo modo. Cada cuenta va en **un solo lugar**: XML dir (propia) **o** compartida. Las XML prestadas se piden al Monitor Link del dueño al momento y se borran (mientras una tanda abre, ya se piden las del siguiente miembro).
- **Velocidad (para no dar soft-ban de amigos a los Mains)**: tope total **40 PPM** (2026-11-12 se probó 45 y Arcade tuvo ban de IP: se volvió a 40) entre todos los hosts en God Pack (`PPM_COMUNIDAD` en `reroll-comunidad.js` → `reports/ppm_cap.json`, se reparte entre los hosts en Start); las cuentas mandan solicitudes **espaciadas** (no en ráfagas); una cuenta que falla devuelve su lugar.
- **Solicitudes de amistad**: cada cuenta las manda a **todos** los Mains en línea (lista del worker `onlineids.zenithrise.workers.dev`). **No se pausan Mains** (dio falsos positivos); los que rechazaron hace poco reciben al final y de a uno. Si el proxy se bloquea ("blocked by the proxy (web page)"), se corta para esa cuenta.
- **Limpieza**: cada cuenta queda anotada en `reports/fr_pending/` antes de mandar solicitudes; si el motor se corta, la siguiente corrida borra esas amistades (las prestadas pidiendo la XML otra vez). Así las listas de los Mains no llegan a 99.
- Avisos de God Pack: el motor los manda al webhook de la comunidad (KyuremBot crea el post). Necesita Pillow (el motor lo instala solo si falta).

**Monitor Link** (versión actual ahk-1.9.34; el GP test automático al pasar a Offline está **apagado** desde 2026-11-12 (lo pidieron Arcade y cy); se prende solo con `gpTest=1` en `[offline]` de la config): cartas, proxies, cuentas para reroll, amigos (ID de Discord + ID del juego), **"My Main ID"** (destino de Share/Trade; todavía no se escribe en Dragonite: esperando formato/permiso de wr98), baneadas.

**Fast Farm / Shinedust / Fast Share-Trade**: corren en el host del turno; si el juego bloquea su IP, reintentan por 1-2 proxies del host (`scripts/respaldo_proxy.py`; Share/Trade solo reintenta el login).

## Publicar a los hosts

Con los cambios ya commiteados (los demás cambios sin commitear se apartan):

```
git push -q origin fast-transfer
git stash push -q -m pre-publicar
node scripts/publicar-host.js
git stash pop -q
```

Los hosts se actualizan solos en ~2 min. El bot de Ale no se actualiza solo: hay que reiniciarlo (ver arriba).
- Un cambio en `motor-panel/inject.py` llega a los hosts solo si se cambia también la marca obligatoria (`'..._V1'`, último argumento de `instalarArchivoMotor` para inject.py en `reroll-comunidad.js`) por una que exista en el inject nuevo.
- Después de publicar, cada host debe **cerrar y abrir** (o Stop/Start) el God Pack UI para usar el motor nuevo.
- El clasificador de seguridad a veces bloquea `publicar-host.js` aunque Ale haya dicho que sí: pedirle el OK otra vez en el chat.

## Pendientes conocidos

- `inject.py` de wr98 tiene cambios propios: armarle una versión con sus cambios + los arreglos de `motor-panel/inject.py`.
- Sobre especial **First Partners (SP1)**: protocolo de **Naja** (`SpecialPack/GetUnpackRightV1` + `SpecialPack/PurchaseV1`, product_id `SP1_001`, 1 gratis por semana, se renueva sábados 01:00 UTC). Publicado a los hosts 2026-11-09.
- **Lista de God Packs** (clic en GOD PACK HITS del panel, 2026-11-09): `reports/gp_hits.jsonl` → Upstash `zenith:gp_hits` → `reports/gp_hits_all.json`. Falta confirmar con el primer God Pack real entre hosts.
- "My Main ID" de Monitor Link → escribir en Dragonite (`users:<grupo>`, mismo formato que el bot de wr98: name, heartbeatName, aliases, main_id, sec_id; grupo por rol de Discord).
- Reordenar la ventana de Monitor Link (agrupar por tema, puede ser más ancha).
- Ideas de Arcade para el God Pack UI: elegir varios sobres a la vez, el "&" de los títulos, ancho del panel, ocultar la ventana negra del log, separar el log.
- Revisar la automatización de MuMu (el juego cambió imágenes) y el **REPETIR** de Gold Trade en `automation/_DonorOfferCard.ahk`.
- El bot público (versión para todos) todavía no tiene el arreglo de tipos de Dual Fusion.
