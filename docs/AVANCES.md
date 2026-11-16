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

### 2026-11-16 (tarde) — cuenta 1 — Farm 96P, Who's rerolling, bloqueos (PUBLICADO)
- **Farm 96P** (canal 📦-farm-96p con Sync, comando `/farm`): el miembro abre sus cuentas PRESTADAS que todavía no son elegibles (`e > 0`, 96 desde la última pausa) con sus sobres gratis + relojes, hasta llegar o hasta Stop. Máx 3 a la vez (cola), proxies del host, sin solicitudes. Resultado público en el canal. Ale pidió QUITAR la revisión de relojes (hacía cola masiva): `/farm` muestra solo **Start Farm 96P**; quien quiera saber relojes por cuenta le escribe a Ale. `inject.py` marca `FILL96_V1` (`--scan-only`, `--pack-targets`).
- Relojes: Dual Fusion SÍ acepta relojes si la cuenta empieza sin sobres gratis (probado Ale_Cast_101: 660→636). Si la cuenta tiene sus 2 gratis, abre esos 2 y el juego rechaza el 3.º pagado AUNQUE se vuelva a loguear (400 relogins, 0 cuentas pasaron de 2). **Pendiente**: probar abrir primero los pagados y después los gratis (cuando haya cuentas con energía).
- **Who's rerolling** (menú de hosts, solo staff): IDs de la lista elite (vinculados/desconocidos), vip-elite con dueño del GP (`gp_votes`), embed Dragonite (registrados/online/fuera del server/sin rol), buscar miembro, **bloquear** IDs (`zenith:bloqueados` → `reports/blocked_ids.json`, el motor no les manda solicitudes). Ale dijo que hay algo que reparar ahí ("luego vemos"): preguntarle qué.
- Panel God Pack UI: "Cuentas restantes" ya no cuenta las de miembros con el Monitor Link apagado (30 min desde que no contesta).

### 2026-11-16 (mañana) — cuenta 1 — Relojes Dual Fusion (PUBLICADO), Gold trade, bot público, Upstash wr98
- PUBLICADO host-2026.11.16-0757 (commit b498fbc): `RELOGIN_EVERY_2_V1`. El juego rechaza el **3.er PurchaseV2 de cada login** (`PERMISSION_DENIED` con página HTML; el motor lo llama "proxy dead" pero no lo es), con cualquier sobre. Ahora en Open Packs Only el motor vuelve a loguear y sigue. Probado en Ale_Cast_185_18: 4/4 Dual Fusion pagados con relojes (Dual Fusion SÍ acepta relojes, 12 LARGE). La versión 0705 (`SPEND_ALL_HG_V2`, "Dual Fusion solo gratis") era un diagnóstico equivocado y quedó revertida. Hosts deben cerrar/abrir el God Pack UI.
- Upstash de wr98 (Dragonite) se llenó (500k/mes); wr98 hizo uno nuevo (`relieved-pegasus`). Clave nueva puesta en `zenith:wr98_redis` y en el .env (los hosts la toman en ~10 min). Nuestro bot lee poco (caché 30 min); se le preguntó a wr98 si su worker `onlineids` tiene caché.
- SIN PUBLICAR, sin probar (bot.js + fast-transfer.js): Gold Cards — el Threshold = cuántas copias quiere; si ninguna cuenta llega, suma varias (`cuentasGoldParaCarta`). ⚡ Gold trade ya no pregunta "How many copies?" (venía de MuMu): usa el Threshold, muestra de qué cuentas sale y un Bulk trade por cuenta. Bulk trade con emojis nuestros (Ficha, reloj y energía de intercambio, nice/bad, Poké Ball) y la misma carta en UNA línea con el total (x/N).
- S4T de Ale: vuelto a la grilla de siempre (el estilo "mesa" sin commitear quedó en `respaldos\estilo-mesa-2026-11-15\`). Falta reiniciar `trading` para verlo.
- Bot público (`C:\Users\Ale TCG\Documents\MP-release-1.6.8`, sin commitear ni publicar): Trade, Share y Farm Tickets fuera (sin botones, sin /farmtickets, sin sus canales; botones viejos responden "DM alecast_09"). Ale quiere sumar un embed + video (falta el archivo del video, <10 MB).

### 2026-11-15 (noche) — cuenta 1 — GP farm espera a que los Mains acepten (sin publicar aún)
- Problema (alerieva, cy, Ale): a veces la cuenta del God Pack no le aparece al Main. Causa: el farm mandaba la solicitud, esperaba 6 s fijos y abría sin mirar si aceptaron; un Main solo ve los sobres abiertos DESPUÉS de aceptar.
- Arreglo `ACCEPT_WAIT_V1` en `motor-panel/inject.py`: en God Pack, tras los 6 s revisa la lista de amigos cada 2 s hasta 45 s (`--accept-wait-max`); abre igual con los que aceptaron y anota en el log quiénes NO aceptaron. Marca en `reroll-comunidad.js` cambiada a `ACCEPT_WAIT_V1`.
- Emojis: 14 íconos de WikiDex (cupones de evento, energías, reloj de eventos, rareza arcoíris) en `assets/element`, solo como emojis de la APLICACIÓN (`EMOJIS_EXTRA_APP` en `guild-emojis.js`), no ocupan lugares del server.
- Íconos HD originales del juego: repo GitHub `alevalls99-maker/ptcgp-assets` (Git LFS: bajar por `media.githubusercontent.com/media/.../main/<ruta>`), carpeta `Texture Dump/UI/Textures` (Mission, Home, Common). Son blancos (el juego los colorea). Misiones = `cmn_pict_mission` / `mission_pict_mission`. Bulbapedia bloquea descargas automáticas.
- Pendiente: elegir emoji de misiones y armar los embeds de "Get these cards" en Trading (vista previa aprobada: foto de la misión arriba, cada cuenta con fotos de sus cartas, resumen al final editando el primer mensaje).

### 2026-11-15 (mediodía) — cuenta 1 — Bot: PUBLICADO todo lo del 14-15/11
- Eventos que cobra "Claim gifts & finished missions": Pikachu, 30 Days of Gifts (+barra 1/15/30), 1★★ (login `_07_01..14` + Collect cards `_07_15..`), Bonus Week, Welcome Back (`MI_AC_2607000_RETURN_01_NN`, "any": prueba cada una; barra a las 4 `MI_GR_RS_2607000_RETURN_01_01`). Barra de 1★★ (12/20/24) no encontrada. Scripts: `scripts/misiones/buscar_ids_evento.py` (--raros, --grupos) y `buscar_premios_barra.py` (GetGroupRewardStepStatesV1 solo devuelve IDs que existen).
- God Pack UI: botón ES/EN (traduce todo, `tools/god_pack_gui/lang.txt`), cooldown mín. 0 h.
- `/missions` y "View Missions": embed + grupos A/B/C con collage de logos, como All Cards. Webhook "All Missions 🎯" con avatar.
- Get these cards: el menú nunca llegaba (fast-transfer cortaba todo lo que no era botón) -> arreglado; emojis del servidor.
- Sync Channels repone paneles borrados (webhook vivo pero sin mensaje suyo en el canal).
- 🔒-hosts: el host del turno borra los paneles de hosts viejos de otros bots. Host de Ale renombrado a **AleCast** (borrado DESKTOP-SLADB1P de zenith:hosts/hosts_ctrl/reroll).
- Reiniciar sin perder el turno: archivo `.reiniciando` antes de `pm2 stop` (community-host.js).

### 2026-11-15 (mañana) — cuenta 1 — Bot: más eventos + premios de la barra (SOLO en el bot de Ale, sin publicar)
- IDs sacados con una cuenta prestada por Arcade (XML borrado después): 30 Days of Gifts `MI_AC_2602000_06_NN`, 1★★ Card Guaranteed `MI_AC_2610000_07_NN`, Bonus Week `MI_AC_2610000_12_NN`. En `LOGIN_EVENTS` de `motor-panel/inject.py`.
- Premios de la barra de 30 Days (1/15/30 misiones, 120 relojes c/u): `MI_GR_RS_2602000_EVENT_04_01..03` (`MILESTONES`).
- Pedir otra vez un premio de la barra ya cobrado responde OK con "120", pero NO los suma (Ale lo verificó en el juego: 552). GetGroupRewardStepStatesV1 dice "cleared" siempre. El motor igual solo lo pide cuando en esa corrida cruza el número (antes < N <= después), para no hacer llamadas de más.
- Cuenta de prueba: **Ale_Cast_192_7** (`C:\POKEMON\PTCGPB-ALE\Accounts\Saved\1`). Cobró 30 días + Day 1 de 1★★ y Bonus Week + 3 premios; quedó con 552 relojes (sin repetidos). Está cargada en la instancia 1 de MuMu.
- Buzón: recibir 23 juntos da INTERNAL; ahora de a 10 (y de a 1 si falla).
- Falta: IDs de premios de barra de Pikachu/1★★/Bonus Week, Welcome Back; publicar cuando Ale diga.

### 2026-11-15 (madrugada) — cuenta 1 — Bot: misiones de evento, Spend all, varios (SIN PUBLICAR, probado en el bot de Ale)
- **Cobro de días de login de eventos** (`motor-panel/inject.py`, `_claim_login_events`, marca `EVENT_LOGIN_CLAIM_V1`): el barrido vacío de Mission/CompleteV2 no cobra "Log in (Day N)". IDs Pika Pika! Pikachu = `MI_AC_2609000_06_01..` (2 dígitos). Probado: cobró Day 1 en Ale_Cast_192_7 (sobre EVP001 al buzón). Ahora cobra misiones antes que el buzón. OJO: el juego solo suma días si la cuenta entra por MuMu/celular, no por el motor.
- Cómo sacar IDs nuevos: cobrar a mano en el juego una vez y correr `scripts/misiones/buscar_ids_evento.py` (Mission/IsCompletedV1 solo devuelve las ya cobradas). `engine/config/eventMission.json` del motor tiene IDs viejos (hasta 2604). Faltan: **30 Days of Gifts** (cuentas nuevas; Arcade va a prestar una) y **Welcome Back**.
- Arreglos de Arcade copiados al inject oficial: Spend all usa 12 LARGE por sobre si el catálogo dice 0 (menos SP) (`SPEND_ALL_HG_COST_V1`, marca obligatoria en `reroll-comunidad.js`); QUARANTINE va a `Accounts\QUARANTINE`. Spend all todavía sin probar en vivo.
- "Get these cards": el menú quedaba sin responder si el turno pasaba a otro host -> deferUpdate inmediato y se atiende en standby (`bot.js`, `fast-transfer.js`).
- All Cards con sobre elegido: logo expansión + sobre (`assets/packs/combined`, `scripts/sobres/logos_combinados.py`) en la carta y listas; línea "Pack:".
- También sin publicar de antes: Mew/SECRET en All Missions, Get these cards, elegir sobre, oro de reimpresiones, íconos del God Pack UI, rueda del mouse.
- `/missions` (nuevo comando, comunidad): abre el selector de All Missions privado en cualquier canal (el canal 🎯-all-missions apareció vacío con el turno en Arcade).
- Cooldown del God Pack UI: mínimo 0 h (Arcade). Arcade confirmó que Spend all funciona.
- **Falta**: IDs de 30 Days of Gifts/Welcome Back (cuenta nueva de Arcade); ver por qué el panel de 🎯-all-missions quedó vacío.

### 2026-11-14 (3) — diegoikrew123 — All Missions: un logo por premio
- Premios con el mismo nombre (ej. "Mythical Island Mew" tapete/fundas/carpeta) tenían el mismo logo: ahora cada premio trae su campo `logo` (archivo por ruta de Serebii) en themed_collections.json; se quitó rewards_icons.json.
- Títulos y nombres de premios en 2 líneas (tipo arriba: PLAYMAT, BINDER...); misiones sin cartas dicen "NO CARDS NEEDED".
- Publicado; Ale pidió apagar la PC después (su bot queda apagado hasta que la prenda; otro host toma el turno).

### 2026-11-14 (2) — diegoikrew123 — Bot: 🙋 pedido de ayuda en ⚡ Share/Trade
- Si la PC del dueño de las cuentas está offline (ej. un amigo usa las de Ale): mensaje privado "🔴 PC offline" + **🙋 Ask for help** (ya no un error).
- El pedido menciona **solo** a miembros con Monitor Link en línea que tienen esa carta; uno presiona **🤝 Lend my accounts**; quien pidió presiona **⚡ Use their accounts**, elige cuenta y corre el ⚡ como el que presta (su Monitor Link da la XML). Pedido vence a los 30 min. Código: `manejarAyuda` en fast-transfer.js.
- Publicado host-2026.11.14-0238; bot de Ale reiniciado. Sin probar en Discord.

### 2026-11-14 — diegoikrew123 — Bot: 🎯 All Missions (colecciones temáticas)
- Canal nuevo **🎯-all-missions** en MANAGER, solo lectura (nadie escribe; los botones sí). Lo crea el host del turno al sincronizar (`cmd_all_missions`).
- **🎯 View Missions** (respuesta privada) → elegir expansión → páginas de 4 misiones (imagen) → "🔍 View a mission" muestra todas las cartas de una.
- Datos: `assets/missions/themed_collections.json` (Serebii, 23 expansiones, 505 misiones, cartas mapeadas a nuestros IDs) + 116 logos de premios en `assets/missions/` (`rewards_icons.json`). Imagen: `tarjeta-misiones.js`.
- Publicado host-2026.11.14-0218; bot de Ale reiniciado. Falta ver el canal creado y probar los botones en Discord. Para actualizar datos cuando salga una expansión: volver a sacar la página de Serebii (scripts de prueba en el scratchpad, no en el repo).

### 2026-11-14 — diegoikrew123 — Bot: comandos "La aplicación no ha respondido"
- Causa: `/link/summary` (monitor-link-server.js) leía y limpiaba el resumen en el hilo principal; uno de 8.000 cuentas (119 MB) congelaba el bot ~13 s y ningún comando respondía (le pasó a TTKLord con TradeBot, y a Ale con /shinedust).
- Arreglo: se procesa en un worker_thread (`limpiarResumenEnHilo`); medido: congelamiento máx. 14 ms, mismo resultado. Publicado host-2026.11.14-0117; bot de Ale reiniciado.

### 2026-11-13 (tarde) — diegoikrew123 — Bot: resumen de baneadas, /shinedust ordenado
- "Likely banned": ya no un aviso por cuenta; **un resumen al día** (23:55 Perú = 04:55 UTC) en 🔒-hosts por dueño con los nombres XML (`zenith:baneadas`, lo manda el host del turno, candado `zenith:ban_resumen:<día>`). Embed: no lo toca el borrado de 10 min.
- Cualquier bot host borra los avisos de texto viejos de los otros bots host (los de GengarBot quedaban si Arcade estaba apagado).
- `/shinedust`: columnas Account / Dust / HG, totales arriba con emojis del juego (Polvo_iris, Reloj_de_arena_de_sobres).
- Publicado host-2026.11.13-0710; bot de Ale reiniciado. `/shinedust` falló justo después del reinicio (turno volviendo de Arcade + comandos re-registrados); falta que Ale confirme que ya anda. El resumen de baneadas aún no se vio en Discord.

### 2026-11-13 — diegoikrew123 — Motor: varios sobres, relojes, regalos; /shinedust con relojes
- God Pack UI (Open Packs Only): lista con casillas de sobres, las cuentas se turnan (`--pack-rotation`, también en el GP farm).
- Casillas: **Spend all hourglasses** (solo Open Packs Only, cuentas propias), **Claim gifts & finished missions** (cuentas propias); botón **⏳ Hourglasses list** (`reports/hourglasses.json` + `hourglasses_history.jsonl`). Las prestadas nunca gastan ni se tocan.
- Community Farm con texto: desmarcada = solo tus cuentas.
- `/shinedust`: ⏳ relojes por cuenta y total al pie (los lee ⚡ Refresh).
- Publicado host-2026.11.13-0654; bot de Ale reiniciado. Sin probar con cuentas reales. Falta (opcional): botón "Claim rewards" sin abrir sobres.

### 2026-11-12 (noche) — diegoikrew123 — Bot: GP farm de Arcade en 0 sobres (403)
- Causa: el Main 2695515994221625 venía **dos veces** en la lista online del worker; la 2.ª solicitud daba 403 y el motor retiraba las otras 20 → ninguna cuenta abría.
- `motor-panel/inject.py`: cada Main una sola vez; si uno da 403 desde todos los proxies pero llegaron la mayoría, la cuenta sigue (marca `FR_403_ONE_MAIN_V1`, obligatoria en `reroll-comunidad.js`).
- Publicado host-2026.11.12-1747; bot de Ale reiniciado. Arcade quedó contento. Pedirle a wr98 que revise el registro doble en Dragonite.

### 2026-11-12 (tarde) — diegoikrew123 — Bot: GP test apagado, PPM 40, sin aviso aparte de Only Pack
- Monitor Link 1.9.34: el GP test automático al pasar a Offline queda **apagado** (lo pidieron Arcade y cy); solo se prende con `gpTest=1` en `[offline]` de la config.
- PPM de la comunidad de vuelta a **40** (Arcade tuvo ban de IP con 45).
- Only Pack ya no publica aviso aparte en 🔒-hosts (está la tarjeta del host en el panel); los viejos se borran.
- Publicado host-2026.11.12-1322; bot de Ale reiniciado (4 procesos).
- Pendiente: el aviso "God Packs while you were online" sale en 0 con los GP del PTCGPB propio (solo conoce `zenith:gp_hits` del motor). Arreglo propuesto: que Monitor Link mande los IDs VIP nuevos de la sesión.

### 2026-11-12 — diegoikrew123 — Bot: canal 🔒-hosts + Only Pack
- Panel "Community hosts": lista "Select an option" con Take the turn (solo el host del que eres dueño: `duenos` = dueño de la app del bot) y Hand over (hosts en línea, staff). Ya no hay mensaje de control por host (se borra solo). GP webhook quitado de la lista (ya está puesto).
- Canal de hosts: el bot reusa su mensaje (no publica otro) y borra duplicados; avisos de texto (Likely banned, Turn moved) se borran a los 10 min.
- Only Pack ya no manda PPM a LatiasBot (Arcade salió con 92 PPM en Only Pack con sus cuentas). GOD PACK HITS del panel cuenta los God Packs también en Only Pack.
- Tarjetas (imagen) hechas pero SIN conectar todavía: `tarjetas-comunidad.js` (hosts, cuentas, amigos de Monitor Link) y `tarjeta-gp-farm.js`; logo de Pokémon en la de Only Pack.
- Kathleen (Lv 6) mandando solicitudes: no está en nuestros datos; posible hueco = prestada sin datos de sobres cuenta como elegible. Propuesto (sin hacer): 96+ confirmados y nivel 9+ para mandar solicitudes.

### 2026-11-11 — diegoikrew123 — Bot: reporte del GP test (Offline)
- Reporte final: solo los God Packs que salieron mientras el miembro estaba en línea (desde que abrió el Main hasta Offline), campo "Stuck at" si no termina, tope 10 min (normal 3-4 min).
- Monitor Link 1.9.33: arreglado que la hora de inicio se pisaba con el tamaño del log (nunca filtraba); Offline desde Dragonite pone el botón en rojo.
- Publicado a los hosts (este día). Falta confirmar con un reporte real que salga solo el God Pack de la sesión.

### 2026-11-11 — diegoikrew123 — Bot: clave nueva del Upstash de wr98
- wr98 rotó su Upstash (Dragonite). Nuevo `ACTUALIZAR UPSTASH WR98.bat` (+ `scripts/actualizar-wr98.js`): Ale pega URL y token, se prueba y se guarda en `zenith:wr98_redis` (todos los hosts en ~10 min) y en el `.env`. Ya corrido OK (4 grupos). Claude no puede escribir claves (lo bloquea el clasificador): siempre que wr98 la rote, que Ale corra ese .bat.

### 2026-11-11 02:40 — diegoikrew123 — Bot: PUBLICADO host-2026.11.11-0237 (Monitor Link ahk-1.9.32)
- Sale: Offline (Monitor o Dragonite) → GP test con ventanita + embed en vivo en #logging → cierra PTCGPB y MuMu Main; Sync reroll cierra el PTCGPB abierto y espera a MuMu Main; proxies Webshare en el motor. Arcade y wr98 confirmados en 0237; bot de Ale reiniciado (4 procesos). Probado en la PC de Ale: GP test completo y elimina amigos; el embed no salía antes porque el turno (GengarBot) tenía código viejo.
- Paquete para host nuevo: `C:\Users\Ale TCG\Desktop\Host Zenith Rise.rar` (bot + motor limpio + README). La clave de host y la contraseña las pasa Ale por privado. Pendiente: ver lo del "amigo" (nuevo host).

### 2026-11-11 — diegoikrew123 — Bot: Offline con GP test (Monitor Link 1.9.31) + Sync reroll (1.9.30), sin publicar
- 1.9.30: Sync reroll aprieta Start Bot recién cuando MuMuManager dice que Android de "Main" arrancó (antes 45 s fijos: el Main.ahk quedaba sin ADB).
- 1.9.31: al quedar Offline (botón de Monitor Link, o el de Dragonite de wr98: se detecta porque su Main sale de la lista pública `onlineids…/elite` 2 veces seguidas) con el Main de PTCGPB corriendo → `stopPreferenceMain=gp_test` + botón Stop del Main ("Run GP Test then Stop", Standard) → espera que Main.ahk termine (máx 20 min) → cierra PTCGPB y la instancia MuMu "Main" → restaura la preferencia. Avisa por POST `/link/gp-stop` (start/done/timeout) y el bot pone el mensaje en #logging (`avisarGpStop` en bot.js).
- Falta: publicar (hosts + reiniciar bot de Ale) y probarlo de verdad.
- Después (1.9.32, commits 99961f8/7aad6bf/01a6deb): el Main ID sale de Dragonite en el ping (no hace falta "My Main ID"); ventanita "GP Test running" con paso 1/3-2/3 (contador del Main leído de su ventana)-3/3 y tiempo; el mensaje de #logging se edita en vivo con lo mismo (fase `step`). Ignora el lanzador AutoHotkeyUX al buscar Main.ahk; texto del contador de Sync ya no se ve borroso. Prueba en la PC de Ale: el GP test arrancó solo con Offline del Monitor, pero se canceló a los 86 s (alguien apretó Stop/GP Test). Monitor Link local de Ale ya tiene esta versión; **sin publicar**.

### 2026-11-11 00:10 — diegoikrew123 — Bot: Monitor Link Lite (Mac) + formato Webshare
- Nuevo `monitor-link-lite/` (`monitor_link_lite.py` + `Monitor Link Lite.command` + `README.txt`): Monitor Link en Python sin dependencias para Mac/Linux, para MysticWind (Mac, bot headless propio que guarda cuentas en **SQLite**). Vincula con la clave ML2, ping, presta cuentas (lee XML, JSON o .db SQLite y arma el XML en memoria), anota sobres de los hosts (`add_pulls`) en `~/.monitor_link_lite/state.json` para la regla de 96, proxies y Main ID. Lo demás (MuMu, wishlist, cartas) responde "not supported". Probado contra un servidor falso, falta probarlo con el bot real (vincularlo desde otra cuenta de Discord, no la de Ale: un vínculo nuevo reemplaza el anterior).
- Falta: que MysticWind diga tabla/columnas de su SQLite si no las detecta solo; que no preste cuentas que su bot esté usando a la vez.
- Commit 54c81dc (proxies Webshare `IP:puerto:user:pass` en el motor, marca `PROXY_IP_PORT_USER_PASS_V1`) **sin publicar**. La bolsa de proxies de la comunidad estaba en 0 (no abría nada en la PC de Ale): hay que compartir proxies por Monitor Link.

### 2026-11-10 15:24 — diegoikrew123 — Bot: 2º arreglo proxy web page (publicado host-2026.11.10-1524)
- En Arcade seguía "blocked by the proxy (web page)" sin reintento: el bloqueo llegaba después de que algunos Mains ya habían recibido. Ahora se reenvía solo el resto desde otro proxy (marca `PROXY_WEB_PAGE_V2`) y el log muestra el título de la página del proxy.
- Falta: que Arcade cierre/abra el God Pack UI y mande captura (buscar "[proxy] this proxy blocks friend requests" y el título de la página).

### 2026-11-10 15:12 — diegoikrew123 — Bot: proxy web page ≠ ban + lista de God Packs sin congelarse (publicado host-2026.11.10-1512)
- Arcade: 13 cuentas de jasonshied salieron "Likely banned" y muchas "SendRequestsV1 blocked by the proxy (web page)" (DataImpulse en su host). Se borraron las 13 de `zenith:baneadas` (quedan 3 de otro miembro).
- `motor-panel/inject.py` (marca `PROXY_WEB_PAGE_V1`): una página web del proxy (HTML/403 Forbidden) nunca cuenta como ban; si el proxy bloquea las solicitudes antes de que llegue alguna, se aparta ese proxy, se vuelve a entrar con otro y se reenvía (hasta 2 proxies).
- `motor-panel/god_pack_gui.py`: la ventana GOD PACK HITS (Last 7 days) se congelaba; ahora muestra las tarjetas al instante con "Loading cards..." y las fotos llegan en segundo plano.
- Falta: Arcade cierra/abre el God Pack UI; pasarle el mensaje para revisar su DataImpulse. Pendiente de Ale: ¿Offline de Dragonite también cierra la Main de MuMu? (no hecho).

### 2026-11-10 — diegoikrew123 — Bot: Monitor Link 1.9.29 (publicado host-2026.11.10-1103)
- La cuenta regresiva del Sync (Launch all Mumu / Start Bot) ahora se escribe dentro del panel de PTCGPB, debajo de "CC BY-NC 4.0 international license" (cambia ese texto y lo agranda); si no lo encuentra, usa el globito de antes. Probado en la PC de Ale (encontró el texto).

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
