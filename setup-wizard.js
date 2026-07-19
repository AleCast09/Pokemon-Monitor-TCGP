const fs = require('fs');
const path = require('path');
const http = require('http');
const { exec } = require('child_process');

const ENV_PATH = path.join(__dirname, '.env');

function leerEnvExistente() {
    if (!fs.existsSync(ENV_PATH)) return {};
    const contenido = fs.readFileSync(ENV_PATH, 'utf8');
    const valores = {};
    for (const linea of contenido.split(/\r?\n/)) {
        const match = linea.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
        if (match) valores[match[1]] = match[2];
    }
    return valores;
}

function guardarEnv(valores) {
    const contenido = Object.entries(valores)
        .map(([clave, valor]) => `${clave}=${valor}`)
        .join('\n') + '\n';
    fs.writeFileSync(ENV_PATH, contenido, 'utf8');
}

function necesitaConfiguracion() {
    const valores = leerEnvExistente();
    return !valores.DISCORD_BOT_TOKEN || valores.DISCORD_BOT_TOKEN.trim() === '';
}

function logoBase64() {
    try {
        return fs.readFileSync(path.join(__dirname, 'assets', 'embeds', 'symbol.png')).toString('base64');
    } catch (e) {
        return '';
    }
}

function abrirNavegador(url) {
    const comando = process.platform === 'win32'
        ? `start "" "${url}"`
        : process.platform === 'darwin'
            ? `open "${url}"`
            : `xdg-open "${url}"`;
    exec(comando, () => {});
}

function paginaHtml() {
    return `<!doctype html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Configurar Monitor Pokémon</title>
<style>
:root {
  --bg: #eef0f7; --bg-a: #f6f3ff; --bg-b: #e7ecff;
  --panel: #ffffff; --panel-border: #dde1ee; --panel-shadow: rgba(30,40,80,0.12);
  --ink: #1b2030; --ink-muted: #626a85; --ink-faint: #9aa1ba;
  --accent: #c9791a; --accent-strong: #a8620f; --accent-ink: #ffffff;
  --good: #18916b; --good-soft: #e3f7ee; --danger: #c1433f;
  --field-bg: #f7f8fc; --field-border: #d7dbea; --track-off: #d7dbea; --divider: #e3e6f2;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0e1120; --bg-a: #171b30; --bg-b: #0c0f1c;
    --panel: #161a2c; --panel-border: #2a2f4a; --panel-shadow: rgba(0,0,0,0.45);
    --ink: #eef1f8; --ink-muted: #9199b8; --ink-faint: #6b7290;
    --accent: #f0a93a; --accent-strong: #ffc266; --accent-ink: #201404;
    --good: #4fd1a5; --good-soft: #103427; --danger: #ef6461;
    --field-bg: #10131f; --field-border: #2e3350; --track-off: #2e3350; --divider: #262b45;
  }
}
* { box-sizing: border-box; }
html, body { margin: 0; min-height: 100vh; }
body {
  background: radial-gradient(circle at 15% -10%, var(--bg-a), transparent 55%),
              radial-gradient(circle at 100% 110%, var(--bg-b), transparent 50%), var(--bg);
  color: var(--ink);
  font-family: -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  display: flex; align-items: center; justify-content: center; padding: 40px 16px;
  position: relative; overflow: hidden;
}
.bg-logo { position: fixed; width: 620px; height: 620px; right: -160px; bottom: -160px;
  background-image: url(data:image/png;base64,__LOGO_B64__); background-size: contain; background-repeat: no-repeat;
  opacity: 0.05; pointer-events: none; z-index: 0; filter: grayscale(1); }
.wizard { position: relative; z-index: 1; width: 100%; max-width: 460px; background: var(--panel); border: 1px solid var(--panel-border);
  border-radius: 20px; box-shadow: 0 24px 60px -20px var(--panel-shadow); overflow: hidden; }
.wizard__head { padding: 28px 30px 22px; border-bottom: 1px solid var(--divider); display: flex; align-items: center; gap: 14px; }
.wizard__mark { width: 42px; height: 42px; border-radius: 12px; background: linear-gradient(155deg, var(--accent), var(--accent-strong));
  display: flex; align-items: center; justify-content: center; flex-shrink: 0; box-shadow: 0 6px 16px -6px var(--accent-strong); overflow: hidden; }
.wizard__mark img { width: 100%; height: 100%; object-fit: contain; padding: 6px; }
.wizard__title { font-weight: 800; font-size: 18px; letter-spacing: -0.01em; margin: 0; text-wrap: balance; }
.wizard__subtitle { margin: 3px 0 0; font-size: 13px; color: var(--ink-muted); }
.wizard__body { padding: 26px 30px 8px; display: flex; flex-direction: column; gap: 22px; }
.field { display: flex; flex-direction: column; gap: 8px; }
.field__label-row { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
.field__label { font-weight: 700; font-size: 13.5px; }
.pill { font-size: 10.5px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; padding: 3px 8px; border-radius: 999px; white-space: nowrap; }
.pill--required { color: var(--danger); background: color-mix(in srgb, var(--danger) 14%, transparent); }
.pill--optional { color: var(--ink-muted); background: var(--divider); }
.field__help { font-size: 12.5px; line-height: 1.5; color: var(--ink-muted); margin: -2px 0 0; }
.input-shell { position: relative; display: flex; align-items: center; background: var(--field-bg);
  border: 1.5px solid var(--field-border); border-radius: 11px; transition: border-color 0.15s ease; }
.input-shell:focus-within { border-color: var(--accent); }
.input-shell input { flex: 1; min-width: 0; background: transparent; border: 0; outline: none; color: var(--ink);
  font: 13.5px/1.4 ui-monospace, "SF Mono", "Cascadia Code", Consolas, monospace; letter-spacing: 0.01em; padding: 11px 12px; }
.input-shell input::placeholder { color: var(--ink-faint); font-family: -apple-system, "Segoe UI", sans-serif; }
.eye-btn { border: 0; background: transparent; color: var(--ink-faint); cursor: pointer; padding: 8px 10px; display: flex; align-items: center; border-radius: 8px; }
.eye-btn:hover { color: var(--ink-muted); }
.eye-btn svg { width: 17px; height: 17px; }
.field__status { display: flex; align-items: center; gap: 6px; font-size: 12px; min-height: 16px; color: var(--ink-faint); }
.field__status .dot { width: 6px; height: 6px; border-radius: 50%; background: var(--ink-faint); flex-shrink: 0; }
.field__status.is-good { color: var(--good); } .field__status.is-good .dot { background: var(--good); }
.field__status.is-bad { color: var(--danger); } .field__status.is-bad .dot { background: var(--danger); }
.divider-line { height: 1px; background: var(--divider); margin: 2px 0 4px; }
.toggle-card { display: flex; align-items: flex-start; gap: 12px; padding: 14px 15px; border-radius: 13px;
  background: var(--field-bg); border: 1.5px solid var(--field-border); transition: opacity 0.2s ease, border-color 0.2s ease; }
.toggle-card.is-locked { opacity: 0.55; }
.toggle-card.is-active { border-color: color-mix(in srgb, var(--good) 45%, var(--field-border)); background: var(--good-soft); }
.toggle-card__text { flex: 1; min-width: 0; }
.toggle-card__title { font-weight: 600; font-size: 13px; margin: 0 0 2px; }
.toggle-card__desc { margin: 0; font-size: 12px; line-height: 1.5; color: var(--ink-muted); }
.switch { position: relative; width: 40px; height: 23px; border-radius: 999px; background: var(--track-off);
  flex-shrink: 0; cursor: pointer; border: none; padding: 0; margin-top: 1px; transition: background 0.2s ease; }
.switch::after { content: ''; position: absolute; top: 2.5px; left: 2.5px; width: 18px; height: 18px; border-radius: 50%;
  background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,0.3); transition: transform 0.2s ease; }
.switch.on { background: var(--good); } .switch.on::after { transform: translateX(17px); }
.switch:disabled { cursor: not-allowed; }
.wizard__foot { padding: 22px 30px 28px; display: flex; flex-direction: column; gap: 12px; }
.btn-primary { border: none; border-radius: 12px; padding: 13px 18px; font-weight: 700; font-size: 14.5px;
  color: var(--accent-ink); background: linear-gradient(155deg, var(--accent), var(--accent-strong)); cursor: pointer;
  box-shadow: 0 10px 24px -10px var(--accent-strong); transition: transform 0.12s ease, box-shadow 0.12s ease, opacity 0.12s ease; }
.btn-primary:hover { transform: translateY(-1px); box-shadow: 0 14px 28px -10px var(--accent-strong); }
.btn-primary:disabled { opacity: 0.6; cursor: not-allowed; transform: none; }
.foot-note { margin: 0; text-align: center; font-size: 11.5px; line-height: 1.5; color: var(--ink-faint); }
.foot-note b { color: var(--ink-muted); }
.error-banner { display: none; background: color-mix(in srgb, var(--danger) 12%, transparent); border: 1px solid color-mix(in srgb, var(--danger) 35%, transparent);
  color: var(--danger); font-size: 12.5px; padding: 10px 13px; border-radius: 10px; }
.error-banner.show { display: block; }
.success-screen { display: none; flex-direction: column; align-items: center; text-align: center; padding: 52px 30px; gap: 14px; }
.success-screen.show { display: flex; }
.success-icon { width: 56px; height: 56px; border-radius: 50%; background: var(--good-soft); display: flex; align-items: center; justify-content: center; }
.success-icon svg { width: 28px; height: 28px; color: var(--good); }
.success-title { font-weight: 800; font-size: 17px; margin: 0; }
.success-desc { margin: 0; font-size: 13px; color: var(--ink-muted); line-height: 1.5; max-width: 320px; }
@media (prefers-reduced-motion: reduce) { * { transition: none !important; } }
</style>
</head>
<body>
<div class="bg-logo"></div>
<div class="wizard" id="wizard">
  <div class="wizard__head">
    <div class="wizard__mark">
      <img src="data:image/png;base64,__LOGO_B64__" alt="Monitor Pokémon">
    </div>
    <div>
      <p class="wizard__title">Configurar Monitor Pokémon</p>
      <p class="wizard__subtitle">Conectá tu bot antes de empezar</p>
    </div>
  </div>

  <div id="formView">
    <div class="wizard__body">
      <div class="error-banner" id="errorBanner"></div>

      <div class="field">
        <div class="field__label-row">
          <span class="field__label">Token del bot de Discord</span>
          <span class="pill pill--required">Obligatorio</span>
        </div>
        <p class="field__help">Developer Portal de Discord → tu aplicación → Bot → Reset Token.</p>
        <div class="input-shell">
          <input id="tokenInput" type="password" placeholder="Pegá aquí tu token..." autocomplete="off">
          <button class="eye-btn" onclick="toggleVis('tokenInput')" type="button">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M1.5 12S5 5 12 5s10.5 7 10.5 7-3.5 7-10.5 7S1.5 12 1.5 12Z"/><circle cx="12" cy="12" r="3"/></svg>
          </button>
        </div>
        <div class="field__status" id="tokenStatus"><span class="dot"></span><span>Sin conectar todavía</span></div>
      </div>

      <div class="divider-line"></div>

      <div class="field">
        <div class="field__label-row">
          <span class="field__label">API key de Google Drive</span>
          <span class="pill pill--optional">Opcional</span>
        </div>
        <p class="field__help">Solo si querés que las cartas se vean en alta definición. Sin esto, el bot funciona igual con calidad normal.</p>
        <div class="input-shell">
          <input id="driveInput" type="password" placeholder="AIzaSy... (dejalo vacío para omitir)" autocomplete="off">
          <button class="eye-btn" onclick="toggleVis('driveInput')" type="button">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M1.5 12S5 5 12 5s10.5 7 10.5 7-3.5 7-10.5 7S1.5 12 1.5 12Z"/><circle cx="12" cy="12" r="3"/></svg>
          </button>
        </div>
        <div class="field__status" id="driveStatus"><span class="dot"></span><span>No conectado — se usará calidad normal</span></div>
      </div>

      <div class="toggle-card is-locked" id="hdCard">
        <div class="toggle-card__text">
          <p class="toggle-card__title">Guardar las imágenes en alta definición en tu PC</p>
          <p class="toggle-card__desc" id="hdCardDesc">Se activa al pegar una API key válida arriba. Ocupan espacio en disco (~3 MB por carta — puede sumar varios cientos de MB con el uso).</p>
        </div>
        <button class="switch" id="hdSwitch" type="button" onclick="toggleHd()" disabled></button>
      </div>
    </div>

    <div class="wizard__foot">
      <button class="btn-primary" id="btnGuardar" type="button" onclick="guardar()">Guardar y continuar</button>
      <p class="foot-note">Todo se guarda en tu <b>propia PC</b>, en un archivo local. Nada se envía a servidores externos salvo Discord y, si la activás, Google Drive.</p>
    </div>
  </div>

  <div class="success-screen" id="successView">
    <div class="success-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6 9 17l-5-5"/></svg></div>
    <p class="success-title">¡Listo!</p>
    <p class="success-desc">Monitor Pokémon está iniciando. Ya podés cerrar esta pestaña.</p>
  </div>
</div>

<script>
function toggleVis(id) {
  const el = document.getElementById(id);
  el.type = el.type === 'password' ? 'text' : 'password';
}

let hdEnabled = false;

document.getElementById('driveInput').addEventListener('input', () => {
  const val = document.getElementById('driveInput').value.trim();
  const status = document.getElementById('driveStatus');
  const hdCard = document.getElementById('hdCard');
  const hdSwitch = document.getElementById('hdSwitch');
  const hdCardDesc = document.getElementById('hdCardDesc');
  const hasKey = val.length > 0;

  hdSwitch.disabled = !hasKey;
  hdCard.classList.toggle('is-locked', !hasKey);

  if (hasKey) {
    status.classList.add('is-good');
    status.innerHTML = '<span class="dot"></span><span>Clave detectada — alta definición activada</span>';
    if (!hdEnabled) { hdEnabled = true; hdSwitch.classList.add('on'); }
    hdCard.classList.toggle('is-active', hdEnabled);
    hdCardDesc.textContent = 'Activado — las cartas se van a ver en alta definición (~3 MB por carta, puede sumar varios cientos de MB con el uso).';
  } else {
    status.classList.remove('is-good');
    status.innerHTML = '<span class="dot"></span><span>No conectado — se usará calidad normal</span>';
    hdEnabled = false; hdSwitch.classList.remove('on'); hdCard.classList.remove('is-active');
    hdCardDesc.textContent = 'Se activa al pegar una API key válida arriba. Ocupan espacio en disco (~3 MB por carta — puede sumar varios cientos de MB con el uso).';
  }
});

function toggleHd() {
  const hdSwitch = document.getElementById('hdSwitch');
  const hdCard = document.getElementById('hdCard');
  const hdCardDesc = document.getElementById('hdCardDesc');
  if (hdSwitch.disabled) return;
  hdEnabled = !hdEnabled;
  hdSwitch.classList.toggle('on', hdEnabled);
  hdCard.classList.toggle('is-active', hdEnabled);
  hdCardDesc.textContent = hdEnabled
    ? 'Activado — las cartas se van a ver en alta definición (~3 MB por carta, puede sumar varios cientos de MB con el uso).'
    : 'Desactivado — se va a usar la calidad normal para ahorrar espacio en disco, aunque tengas la API key puesta.';
}

document.getElementById('tokenInput').addEventListener('input', () => {
  const val = document.getElementById('tokenInput').value.trim();
  const status = document.getElementById('tokenStatus');
  document.getElementById('errorBanner').classList.remove('show');
  if (val.length > 0) {
    status.classList.remove('is-bad');
    status.classList.add('is-good');
    status.innerHTML = '<span class="dot"></span><span>Se ve como un token válido</span>';
  } else {
    status.classList.remove('is-good');
    status.innerHTML = '<span class="dot"></span><span>Sin conectar todavía</span>';
  }
});

async function guardar() {
  const token = document.getElementById('tokenInput').value.trim();
  const driveKey = document.getElementById('driveInput').value.trim();
  const errorBanner = document.getElementById('errorBanner');
  const btn = document.getElementById('btnGuardar');

  if (!token) {
    errorBanner.textContent = 'Falta el token del bot — es obligatorio para continuar.';
    errorBanner.classList.add('show');
    document.getElementById('tokenStatus').classList.add('is-bad');
    document.getElementById('tokenStatus').innerHTML = '<span class="dot"></span><span>Falta el token</span>';
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Guardando...';

  try {
    const resp = await fetch('/guardar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, driveKey, hdEnabled })
    });
    if (!resp.ok) throw new Error('fallo');

    document.getElementById('formView').style.display = 'none';
    document.getElementById('successView').classList.add('show');
  } catch (e) {
    errorBanner.textContent = 'No se pudo guardar la configuración. Probá de nuevo.';
    errorBanner.classList.add('show');
    btn.disabled = false;
    btn.textContent = 'Guardar y continuar';
  }
}
</script>
</body>
</html>`;
}

function ejecutarWizard() {
    return new Promise((resolve) => {
        const valores = leerEnvExistente();

        const server = http.createServer((req, res) => {
            if (req.method === 'GET' && (req.url === '/' || req.url === '')) {
                res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                res.end(paginaHtml().split('__LOGO_B64__').join(logoBase64()));
                return;
            }

            if (req.method === 'POST' && req.url === '/guardar') {
                let cuerpo = '';
                req.on('data', (trozo) => { cuerpo += trozo; });
                req.on('end', () => {
                    try {
                        const datos = JSON.parse(cuerpo);
                        const token = String(datos.token || '').trim();
                        const driveKey = String(datos.driveKey || '').trim();
                        const hdEnabled = !!datos.hdEnabled;

                        if (!token) {
                            res.writeHead(400, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ error: 'token_vacio' }));
                            return;
                        }

                        valores.DISCORD_BOT_TOKEN = token;
                        valores.GOOGLE_DRIVE_API_KEY = driveKey;
                        valores.GOOGLE_DRIVE_HD_ENABLED = driveKey ? String(hdEnabled) : 'false';
                        guardarEnv(valores);

                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ ok: true }));

                        setTimeout(() => {
                            server.close();
                            resolve();
                        }, 400);
                    } catch (e) {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: 'invalido' }));
                    }
                });
                return;
            }

            res.writeHead(404);
            res.end();
        });

        server.listen(0, '127.0.0.1', () => {
            const puerto = server.address().port;
            const url = `http://127.0.0.1:${puerto}/`;
            console.log('');
            console.log('🌐 Abriendo configuración en el navegador...');
            console.log('   Si no se abre solo, entrá manualmente a:', url);
            console.log('');
            abrirNavegador(url);
        });
    });
}

module.exports = { necesitaConfiguracion, ejecutarWizard };
