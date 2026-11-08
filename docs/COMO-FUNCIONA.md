# Monitor Pokemon — cómo funciona por dentro

Guía para cualquier cuenta de Claude que trabaje en este repo (actualizada 2026-11-08).
`CLAUDE.md` dice **qué** hay y las reglas para trabajar con Ale; este archivo explica **cómo funciona** cada parte, **dónde** vive cada dato y **por qué** se decidió así. Antes de cambiar algo de estas partes, leer la sección correspondiente.

---

## 1. Piezas y quién habla con quién

```
Miembro (su PC)                       Hosts (PCs de Ale, wr98, Arcade)                Juego
───────────────                       ──────────────────────────────                  ─────
Monitor Link (.ahk) ──HTTPS──► túnel cloudflared ──► monitor-link-server.js (dentro de bot.js)
  - manda resumen de cartas                         bot.js  (Discord: comandos, paneles)
  - presta cuentas (solo nombres)                   reroll-comunidad.js (GP farm)
  - entrega XML al momento                          fast-transfer.js (Fast Share/Trade/Farm/Shinedust)
                                                    motor de Miguel (Python) ──túnel 9090──► servidor PTCGP
Upstash (Redis en la nube): turno, lista de hosts, registro, baneadas, direcciones
```

- **bot.js** es un solo proceso PM2 que levanta el bot de Discord, el servidor HTTP del dashboard/Monitor Link y el GP farm.
- El **motor** (bot "Headless" de Miguel, carpeta `ptcgp-capturedeluxe`) es Python y habla con el servidor del juego por el túnel local `proxy\takasho-proxy.exe` (puerto 9090). El bot lo lanza como proceso hijo.
- **Upstash** tiene dos bases: la nuestra (`LINK_REDIS_*` en `.env`) y la de wr98 (`WR98_REDIS_*`, registro de Mains "Dragonite", solo lectura para nosotros).

---

## 2. Turno entre hosts (`community-host.js`)

- Cada host corre el mismo bot. Solo **uno** atiende comandos y Monitor Link: el que tiene la clave `zenith:host` (candado `SET ... PX 90000` que su dueño renueva con un script Lua que solo renueva si el valor es su propio nombre).
- `zenith:hosts`: cada host anota su estado cada pocos segundos (`ts`, versión, motor, prestadas, farm). Un host con `ts` viejo se considera apagado.
- Pasar el turno a mano: `SET zenith:host <nombre> PX 90000`. El viejo deja de renovar solo.
- Al apagarse bien (pm2 stop), el host suelta el turno; otro lo toma en su siguiente ciclo.
- **Vigilante del enlace** (bot.js, cada 2 min): prueba su propia dirección pública `.../link/ping` (cualquier respuesta de nuestro servidor = vivo; errores de Cloudflare 502/521-524/530 o no conectar = caído). 3 fallos → reinicia cloudflared (dirección nueva, se publica sola). Si está en espera y la dirección del turno (`monitor_link:url`) no responde 3 veces seguidas (~6 min), toma el turno y avisa en 🔒-hosts.
  - **Por qué:** el 2026-11-07 el túnel de ZenithBot murió con el turno y nadie podía conectar su Monitor Link por una hora.

---

## 3. Monitor Link (`monitor-link/Monitor Link.ahk` + `monitor-link-server.js`)

- Programa AutoHotkey en la PC del miembro. Se vincula con `/link` (clave de un solo uso); guarda token en `%APPDATA%\MonitorLink\monitor-link-ahk.ini` (la lista de cuentas compartidas en `reroll_accounts.txt`, **por PC, no por usuario de Discord**).
- Se conecta a `monitor_link:url` (el host del turno) y además a todas las direcciones de `monitor_link:hosts` ("espejos"), así cualquier host que tome el turno ya tiene los datos.
- Rutas del servidor: `/link/claim` (vincular), `/link/ping` (cada 60 s: estado, versión, baneadas, espejos), `/link/summary` (resumen de cartas), `/link/proxies`, `/link/friends`, `/link/main` (My Main ID), `/link/reroll-accounts` (cuentas prestadas: solo nombre, packCount, lastPackPulled y `e`), `/link/jobs` + `/link/xml` (el host pide archivos y el Monitor Link los responde).
- **Las XML de los miembros nunca se guardan en un host**: se piden por `/link/jobs` en el momento, se usan en una carpeta temporal `ml_reroll_*` y se borran (también se borran carpetas viejas de tandas cortadas).
- Se autoactualiza: el ping trae la última versión publicada; el `.ahk` se reemplaza y se reinicia.
- **Elegibilidad GP** (`SobresFaltanGP`): devuelve cuántos sobres faltan (0 = elegible). Menos de 96 en total → faltan `96 - total`. Una pausa de 30+ días entre sobres (o desde el último hasta hoy) reinicia la cuenta: necesita 96 sobres desde esa pausa. La misma regla está en `inject.py` (`_gp_packs_missing`) para las cuentas propias del host.
- **Amigos**: un miembro anota IDs de Discord (+ ID del juego) de personas que pueden usar SUS cuentas en el bot; reciben el rol Monitor sin instalar nada.
- **My Main ID** (1.9.18+): la Main propia, tabla `link_main`; el bot la usa como destino de Share/Trade y Farm Tickets (`destinosComunidad` en bot.js). Todavía **no** se escribe en Dragonite (pendiente, ver §9).

---

## 4. GP farm (`reroll-comunidad.js` + motor)

### Encendido
- El God Pack UI (`motor-panel/god_pack_gui.py`, copiado al motor de cada host) escribe `reports/community_farm.json {on, ts, busy, own}` cada 30 s mientras está en Start con *Community farm*. Sin renovar 2 min = apagado. `busy=true` mientras el panel abre cuentas **propias**.
- `sincronizarPanel` (cada 20 s) detecta on/off y anota el host en `zenith:reroll` con su modo (`godpack` / `packs-only`).

### Ciclo (`ciclo()`)
1. Si el panel está ocupado con cuentas propias, espera (las propias van primero). El panel re-escanea las propias cada 15 min.
2. `limpiarPrestadasPendientes`: limpia amistades que quedaron de tandas cortadas (ver §5).
3. Lee las cuentas prestadas de todos los miembros; a cada host le toca un reparto fijo (`miCuenta`: md5 de `discordId|archivo` módulo cantidad de hosts del mismo modo).
4. Filtra por modo (`cuentaDelModo`: God Pack → `e === 0`; Only Pack → `e > 0`), baneadas, y cooldown de 24 h.
5. Por miembro: pide sus XML (hasta 50), las escribe en temp, corre `inject.py` (`correrInject`), anota los sobres al miembro (`anotarSobresReroll`, vuelven a su JSON por Monitor Link), borra la carpeta. **Mientras una tanda abre, ya pide las XML del siguiente miembro** (prefetch).
6. Si hubo trabajo, el siguiente ciclo arranca a los 30 s; si no, cada 10 min.

### PPM y tope de velocidad
- **Tope de la comunidad**: `PPM_COMUNIDAD` (40) se reparte entre los hosts en God Pack con Start → `reports/ppm_cap.json {cap, total, hosts, ts}` cada 30 s. El motor (`_community_ppm_cap`) usa el menor entre ese cap y el "Packs/min Cap" del panel.
- El tope es **por Main** (cada cuenta manda solicitud a todos los Mains, así que PPM del host = solicitudes por minuto que recibe cada Main).
- **Espaciado**: cada cuenta espera `60 * packs / cap` segundos después de la anterior (con 20 → una cada 6 s). Sin esto salían ráfagas de 5 cuentas en el mismo segundo.
- **Devolución**: si una cuenta reserva su lugar y después falla al mandar solicitudes (proxy bloqueado), lo devuelve (`_refund_pack_budget`).
- **Por qué tan bajo**: el 2026-11-07 varios Mains recibieron soft-ban de amigos (error 102-084-007). Causas: ráfagas, amistades sin borrar (listas en 99), reintentos que bloqueaban proxies. Naja (otro server, mismo motor) usa ~35 sin soft-ban.
- El PPM que ve LatiasBot lo manda `enviarPpm` al "PPM webhook" del panel: sobres prestados + propios (contados solo desde el Start, leyendo líneas nuevas de `god_pack_live.log`). En Only Pack **no** se reporta PPM.

### Solicitudes de amistad (`inject.py`, paso 4 de `inject_one`)
- Mains en línea: lista del worker `onlineids.zenithrise.workers.dev/<grupo>` (de wr98).
- Se mandan en lotes de 2; si un lote falla (un Main lleno rechaza el lote entero) se reintenta **solo a los que no la recibieron**, de a uno.
- **No se pausa a ningún Main** (`PAUSE_COLLECTORS = False`): la pausa dio falsos positivos una y otra vez (fallos del servidor/proxy contados como rechazo). En su lugar, los Mains que rechazaron hace poco (`reports/collectors_suspect.json`, 30 min) reciben **al final y de a uno**, así los sanos salen en el primer envío.
- Si el proxy responde con una página web ("blocked by the proxy"), se corta para esa cuenta (insistir bloquea más la IP).
- Se espera `wait_accept` (6 s) a que acepten, se abren los 2 sobres, y si no hay God Pack se borran las amistades.

### Avisos de God Pack
- El motor (`discord_notifier.py`) manda imagen + texto al webhook de la comunidad (`reports/community_gp_webhook.txt`); **KyuremBot** (de wr98) crea el post con votación. El texto tiene un formato fijo que KyuremBot lee (`<@dueño>\nNick (16 dígitos)\n[x/5][2P][Pack]\nFile name: x.xml`).
- Necesita Pillow; si falta, el motor lo instala solo (antes el aviso se apagaba en silencio: la Mac de Arcade nunca avisó por eso).
- `vigilarGodPacks` lee los logs y avisa en 🔒-hosts si un God Pack guardado no se publicó en 5 min.

### Cuentas bloqueadas / baneadas
- Login rechazado con detalles reales en 2+ proxies → `reports/banned_accounts.jsonl` → el bot las marca en Upstash (`zenith:baneadas`) y el Monitor Link del dueño las muestra con botones para abrir carpeta / borrar.
- "Abierta en otro lado" (ABORTED en GetPackPower) 3 veces en 6+ horas → se trata como bloqueada (una cuenta "locked" responde igual que una en uso).

---

## 5. Limpieza de amistades (por qué las listas no llegan a 99)

- El motor de Miguel trae el "ledger" de limpieza **vacío** (stubs). Lo reemplazamos en `inject.py`: antes de mandar solicitudes, cada cuenta escribe `reports/fr_pending/<cuenta>.json`; al limpiar, se borra.
- Cada proceso escribe `reports/fr_pending/_alive_<run>` cada 30 s. Las entradas de un run sin latido (2+ min) son sobras.
- Al arrancar, cada inject limpia las sobras **propias**. Las **prestadas** solo guardan dueño + nombre de archivo (nunca la XML): el farm le vuelve a pedir la XML al dueño y corre `inject.py --cleanup-only`.
- Una entrada que no se puede limpiar en 3 días se descarta.

---

## 6. Motor: cómo llegan nuestros cambios a cada host

- `motor-panel/inject.py`, `god_pack_gui.py`, `discord_notifier.py`, `ppm_monitor.py` se copian al motor de cada host al arrancar el bot (`instalarArchivoMotor` / `instalarPanel` en `reroll-comunidad.js`).
- Se reemplaza un archivo si es el original de Miguel o uno nuestro anterior (tiene la "marca"). Si el host lo modificó a mano y **le falta el texto obligatorio** (`'NOMBRE_V1'`, último argumento), se instala igual y el suyo queda como `.bak-propio`.
- **Al cambiar `motor-panel/inject.py`, agregar una constante nueva `ALGO_V1 = True` y poner ese nombre como obligatorio en `reroll-comunidad.js`**; si no, hosts con versiones intermedias no reciben el cambio.
- `pack_catalog.py` (sobres del motor) recibe sobres extra (`SOBRES_EXTRA`) al arrancar.
- `reports/pack_sets.json` (de Leanny): el motor anota `pulls[].pack` con el código del set (`C1`) como hace PTCGPB.

---

## 7. Fast Share/Trade, Fast Farm, Shinedust (`fast-transfer.js` + `scripts/fast_*.py`)

- Corren en el **host del turno**, con su IP. Piden la XML del miembro por Monitor Link al momento.
- Si el juego bloquea la IP (PERMISSION_DENIED / página web), reintentan por 1-2 proxies de la lista del host (`scripts/respaldo_proxy.py`). Share/Trade solo reintenta el **login** (antes de mandar nada) para no repetir un trade.
- Los botones de una lista de Shinedust solo los puede usar quien la pidió.
- Farm Tickets: "Gift to a member" (registro de wr98) y "📋 Paste an ID" (cualquier ID de 16 dígitos).

---

## 8. Publicar

1. Commit en `fast-transfer`, `git push`.
2. `git stash push -q -m pre-publicar` (lo no commiteado, incluso trabajo de otros chats, no se publica), `node scripts/publicar-host.js` (arma un zip con `git archive HEAD`, crea un release en GitHub `host-AAAA.MM.DD-HHMM` y anota `zenith:release`; incluye la última versión de Monitor Link), `git stash pop -q`.
3. Los hosts bajan el zip solos en ~2 min y se reinician (la tanda prestada en curso se corta y se limpia sola).
4. Reiniciar el bot de Ale a mano: `pm2 stop bot` → contar 3 `ProcessContainerFork` → `pm2 start bot` → deben quedar 4.

---

## 9. Pendientes con contexto

- **SP1 (First Partners)**: se abre con el servicio `SpecialPack` (`GetUnpackRightV1` + `PurchaseV1`, `consumed_resource = SPECIAL_PACK_UNPACK_RIGHT`), no con `PackShop/PurchaseV2` (ese da INTERNAL). Otro chat lo integró en `motor-panel/inject.py` (sin commitear al 2026-11-08) con el protocolo de Naja; falta probar con una cuenta real (la `168P_20260119060000_4` de Ale mostraba "Can be opened") y publicar.
- **My Main ID → Dragonite**: formato de wr98 (de su `index.js`): `users:<grupo>` con campo = ID de Discord y valor `{name, heartbeatName, aliases[], main_id, sec_id, updatedAt}`; el grupo sale del rol de Discord (`active_roles:<id>` o prioridad Rivals → Elite_Four → Gym_Leader → Trainer). Hay que mezclar con lo que ya exista y confirmar que nuestra clave puede escribir.
- Reordenar la ventana de Monitor Link; ideas de Arcade para el God Pack UI (varios sobres a la vez, etc.).
