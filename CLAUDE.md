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
- Ale → `DESKTOP-SLADB1P` / Pokedex! (corre desde este repo, no se autoactualiza)
- wr98 → `ZenithBot` / TradeBot (Windows). wr98 también maneja **LatiasBot** (telemetría/PPM de Zenith).
- Arcade → `ArcaMac` / GengarBot (Mac M2, carpeta `/Users/arcade/Documents/PokemonBot/`)

Un host tiene el **turno** (atiende los comandos y los Monitor Link); los demás quedan en espera. Los comandos exigen el rol **Monitor**, que da el bot del turno al vincular: el rol de ese bot debe estar **por encima** de "Monitor" en Discord.

**GP farm** (abrir sobres de las cuentas que los miembros prestan por Monitor Link):
- Al prender la PC el host queda **Offline**. Se prende solo con **Start** en el God Pack UI con la casilla *"Also open the community's lent accounts"*: abre las cuentas propias (XML dir) **y** las prestadas. **Stop** o cerrar el panel lo apaga. **Nunca hacer que farmee solo.**
- Las prestadas se reparten entre los hosts que están en Start. Cada cuenta va en **un solo lugar**: en el XML dir (propia) **o** compartida en Monitor Link.
- Cada vuelta: cada 10 min, hasta 20 cuentas por miembro, 5 collectors online por cuenta (rotando), y el PPM se manda al "PPM webhook" del panel (con Stop: Offline y 0 PPM).
- Detecta mains con la lista de amigos llena y avisa en 🔒-hosts como posible **doble reroll** (por ahora solo aviso).

## Publicar a los hosts

Con los cambios ya commiteados (los demás cambios sin commitear se apartan):

```
git push -q origin fast-transfer
git stash push -q -m pre-publicar
node scripts/publicar-host.js
git stash pop -q
```

Los hosts se actualizan solos en ~2 min. El bot de Ale no se actualiza solo: hay que reiniciarlo (ver arriba).

## Pendientes conocidos

- `inject.py` de wr98 tiene cambios propios: armarle una versión con sus cambios + los arreglos de `motor-panel/inject.py`.
- Sobre especial **First Partners (SP1)**: el motor no tiene la llamada nueva del juego; esperar a Lean.
- Revisar la automatización de MuMu (el juego cambió imágenes) y el **REPETIR** de Gold Trade en `automation/_DonorOfferCard.ahk`.
- El bot público (versión para todos) todavía no tiene el arreglo de tipos de Dual Fusion.
