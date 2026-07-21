const fs = require('fs');
const path = require('path');
const http = require('http');
const { exec } = require('child_process');

const ENV_PATH = path.join(__dirname, '.env');
const ACCESO_DIRECTO_PATH = path.join(__dirname, 'Open configuration.url');
const PUERTOS_AVISO_PATH = path.join(__dirname, 'Ports in use.txt');

// Puertos que el usuario debe pegar en el bot de Kevin (P BOT): por defecto los
// de siempre, salvo que "Ports in use.txt" ya haya registrado uno real distinto
// (auto-fallback por puerto ocupado) o el .env traiga un override manual.
function obtenerUrlsPBot() {
    const base = {
        S4T: Number(process.env.S4T_PORT) || 3000,
        Heartbeat: Number(process.env.HEARTBEAT_PORT) || 3003
    };
    if (fs.existsSync(PUERTOS_AVISO_PATH)) {
        try {
            const contenido = fs.readFileSync(PUERTOS_AVISO_PATH, 'utf8');
            for (const linea of contenido.split(/\r?\n/)) {
                const match = linea.match(/^(\w+): http:\/\/localhost:(\d+)$/);
                if (match && base[match[1]] !== undefined) base[match[1]] = Number(match[2]);
            }
        } catch (e) { /* si falla la lectura, se usan los valores por defecto */ }
    }
    return { s4tUrl: `http://localhost:${base.S4T}`, heartbeatUrl: `http://localhost:${base.Heartbeat}` };
}

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

const NAVEGADORES_WINDOWS = [
    `${process.env['ProgramFiles']}\\Google\\Chrome\\Application\\chrome.exe`,
    `${process.env['ProgramFiles(x86)']}\\Google\\Chrome\\Application\\chrome.exe`,
    `${process.env['LOCALAPPDATA']}\\Google\\Chrome\\Application\\chrome.exe`,
    `${process.env['ProgramFiles(x86)']}\\Microsoft\\Edge\\Application\\msedge.exe`,
    `${process.env['ProgramFiles']}\\Microsoft\\Edge\\Application\\msedge.exe`
];

function abrirNavegador(url) {
    if (process.platform === 'win32') {
        const navegador = NAVEGADORES_WINDOWS.find((ruta) => ruta && fs.existsSync(ruta));
        if (navegador) {
            exec(`"${navegador}" --new-window "${url}"`, () => {});
            return;
        }
        exec(`start "" "${url}"`, () => {});
        return;
    }
    const comando = process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
    exec(comando, () => {});
}

function paginaHtml() {
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Configure Monitor Pokémon</title>
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
}
.wizard { width: 100%; max-width: 440px; background: var(--panel); border: 1px solid var(--panel-border);
  border-radius: 20px; box-shadow: 0 24px 60px -20px var(--panel-shadow); overflow: hidden; }
.wizard__head { padding: 24px 26px 18px; border-bottom: 1px solid var(--divider); display: flex; align-items: center; gap: 14px; }
.wizard__mark { width: 40px; height: 40px; border-radius: 12px; background: linear-gradient(155deg, var(--accent), var(--accent-strong));
  display: flex; align-items: center; justify-content: center; flex-shrink: 0; box-shadow: 0 6px 16px -6px var(--accent-strong); overflow: hidden; }
.wizard__mark img { width: 100%; height: 100%; object-fit: contain; padding: 6px; }
.wizard__title { font-weight: 800; font-size: 17px; letter-spacing: -0.01em; margin: 0; }
.wizard__subtitle { margin: 3px 0 0; font-size: 13px; color: var(--ink-muted); }
.wizard__body { padding: 20px 26px 6px; display: flex; flex-direction: column; gap: 16px; }
.field { display: flex; flex-direction: column; gap: 7px; }
.field__label-row { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
.field__label { font-weight: 700; font-size: 13px; }
.pill { font-size: 10px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; padding: 3px 8px; border-radius: 999px; white-space: nowrap; }
.pill--required { color: var(--danger); background: rgba(193,67,63,0.14); }
.pill--optional { color: var(--ink-muted); background: var(--divider); }
.field__help { font-size: 12px; line-height: 1.5; color: var(--ink-muted); margin: -2px 0 0; }
.input-shell { position: relative; display: flex; align-items: center; background: var(--field-bg);
  border: 1.5px solid var(--field-border); border-radius: 11px; transition: border-color 0.15s ease; }
.input-shell:focus-within { border-color: var(--accent); }
.input-shell input { flex: 1; min-width: 0; background: transparent; border: 0; outline: none; color: var(--ink);
  font: 13px/1.4 ui-monospace, "SF Mono", "Cascadia Code", Consolas, monospace; letter-spacing: 0.01em; padding: 10px 12px; }
.input-shell input::placeholder { color: var(--ink-faint); font-family: -apple-system, "Segoe UI", sans-serif; }
.eye-btn { border: 0; background: transparent; color: var(--ink-faint); cursor: pointer; padding: 8px 10px; display: flex; align-items: center; border-radius: 8px; }
.eye-btn:hover { color: var(--ink-muted); }
.eye-btn svg { width: 16px; height: 16px; }
.field__status { display: flex; align-items: center; gap: 6px; font-size: 11.5px; min-height: 16px; color: var(--ink-faint); }
.field__status .dot { width: 6px; height: 6px; border-radius: 50%; background: var(--ink-faint); flex-shrink: 0; }
.field__status.is-good { color: var(--good); } .field__status.is-good .dot { background: var(--good); }
.field__status.is-bad { color: var(--danger); } .field__status.is-bad .dot { background: var(--danger); }
.toggle-card { display: flex; align-items: flex-start; gap: 12px; padding: 12px 13px; border-radius: 12px;
  background: var(--field-bg); border: 1.5px solid var(--field-border); transition: opacity 0.2s ease, border-color 0.2s ease, background 0.2s ease; }
.toggle-card.is-locked { opacity: 0.55; }
.toggle-card.is-active { border-color: rgba(24,145,107,0.4); background: var(--good-soft); }
.toggle-card__text { flex: 1; min-width: 0; }
.toggle-card__title { font-weight: 600; font-size: 12.5px; margin: 0 0 2px; }
.toggle-card__desc { margin: 0; font-size: 11.5px; line-height: 1.5; color: var(--ink-muted); }
.switch { position: relative; width: 38px; height: 22px; border-radius: 999px; background: var(--track-off);
  flex-shrink: 0; cursor: pointer; border: none; padding: 0; margin-top: 1px; transition: background 0.2s ease; }
.switch::after { content: ''; position: absolute; top: 2.5px; left: 2.5px; width: 17px; height: 17px; border-radius: 50%;
  background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,0.3); transition: transform 0.2s ease; }
.switch.on { background: var(--good); } .switch.on::after { transform: translateX(16px); }
.switch:disabled { cursor: not-allowed; }
.wizard__foot { padding: 18px 26px 24px; display: flex; flex-direction: column; gap: 10px; }
.btn-primary { border: none; border-radius: 12px; padding: 12px 18px; font-weight: 700; font-size: 14px;
  color: var(--accent-ink); background: linear-gradient(155deg, var(--accent), var(--accent-strong)); cursor: pointer;
  box-shadow: 0 10px 24px -10px var(--accent-strong); transition: transform 0.12s ease, box-shadow 0.12s ease, opacity 0.12s ease; }
.btn-primary:hover { transform: translateY(-1px); box-shadow: 0 14px 28px -10px var(--accent-strong); }
.btn-primary:disabled { opacity: 0.6; cursor: not-allowed; transform: none; }
.foot-note { margin: 0; text-align: center; font-size: 11px; line-height: 1.5; color: var(--ink-faint); }
.foot-note b { color: var(--ink-muted); }
.error-banner { display: none; background: rgba(193,67,63,0.12); border: 1px solid rgba(193,67,63,0.35);
  color: var(--danger); font-size: 12px; padding: 9px 12px; border-radius: 10px; }
.error-banner.show { display: block; }
.connected-shell { display: flex; align-items: center; justify-content: space-between; gap: 10px;
  background: var(--good-soft); border: 1.5px solid rgba(24,145,107,0.35); border-radius: 11px; padding: 10px 12px; }
.connected-shell__text { display: flex; align-items: center; gap: 6px; font-size: 12.5px; font-weight: 600; color: var(--good); }
.connected-shell__actions { display: flex; gap: 6px; flex-shrink: 0; }
.link-btn { border: 0; background: transparent; color: var(--ink-muted); cursor: pointer; font-size: 11.5px;
  font-weight: 600; padding: 4px 8px; border-radius: 7px; }
.link-btn:hover { background: var(--divider); color: var(--ink); }
.link-btn--danger:hover { color: var(--danger); }
.hidden { display: none !important; }
.success-screen { display: none; flex-direction: column; align-items: center; text-align: center; padding: 48px 26px; gap: 12px; }
.success-screen.show { display: flex; }
.ports-box { margin-top: 8px; width: 100%; max-width: 320px; text-align: left; background: var(--field-bg);
  border: 1px solid var(--field-border); border-radius: 11px; padding: 12px 14px; }
.ports-box__title { margin: 0 0 8px; font-size: 11.5px; font-weight: 700; color: var(--ink-muted); }
.ports-box__row { display: flex; justify-content: space-between; align-items: center; gap: 8px; font-size: 12px; padding: 3px 0; }
.ports-box__row b { color: var(--ink); }
.ports-box__row code { color: var(--accent-strong); font-weight: 600; }
.success-icon { width: 52px; height: 52px; border-radius: 50%; background: var(--good-soft); display: flex; align-items: center; justify-content: center; }
.success-icon svg { width: 26px; height: 26px; color: var(--good); }
.success-title { font-weight: 800; font-size: 16px; margin: 0; }
.success-desc { margin: 0; font-size: 12.5px; color: var(--ink-muted); line-height: 1.5; max-width: 300px; }
@media (prefers-reduced-motion: reduce) { * { transition: none !important; } }
</style>
</head>
<body>
<div class="wizard" id="wizard">
  <div class="wizard__head">
    <div class="wizard__mark">
      <img src="data:image/png;base64,__LOGO_B64__" alt="Monitor Pokémon">
    </div>
    <div>
      <p class="wizard__title">Configure Monitor Pokémon</p>
      <p class="wizard__subtitle">Connect your bot before you start</p>
    </div>
  </div>

  <div id="formView">
    <div class="wizard__body">
      <div class="error-banner" id="errorBanner"></div>

      <div class="field">
        <div class="field__label-row">
          <span class="field__label">Discord bot token</span>
          <span class="pill pill--required">Required</span>
        </div>
        <p class="field__help">Discord Developer Portal → your application → Bot → Reset Token.</p>
        <div class="connected-shell hidden" id="tokenConnectedView">
          <span class="connected-shell__text">✓ Token connected</span>
          <div class="connected-shell__actions">
            <button class="link-btn" type="button" onclick="mostrarEdicionToken()">Replace</button>
          </div>
        </div>
        <div id="tokenEditView">
          <div class="input-shell">
            <input id="tokenInput" type="password" placeholder="Paste your token here..." autocomplete="off">
            <button class="eye-btn" onclick="toggleVis('tokenInput')" type="button">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M1.5 12S5 5 12 5s10.5 7 10.5 7-3.5 7-10.5 7S1.5 12 1.5 12Z"/><circle cx="12" cy="12" r="3"/></svg>
            </button>
          </div>
          <div class="field__status" id="tokenStatus"><span class="dot"></span><span>Not connected yet</span></div>
        </div>
      </div>

      <div class="field">
        <div class="field__label-row">
          <span class="field__label">Google Drive API key</span>
          <span class="pill pill--optional">Optional</span>
        </div>
        <p class="field__help">Only if you want cards to show in high definition. Without this, the bot works the same at normal quality.</p>
        <div class="connected-shell hidden" id="driveConnectedView">
          <span class="connected-shell__text">✓ Connected</span>
          <div class="connected-shell__actions">
            <button class="link-btn" type="button" onclick="mostrarEdicionDrive()">Replace</button>
            <button class="link-btn link-btn--danger" type="button" onclick="quitarDrive()">Remove</button>
          </div>
        </div>
        <div id="driveEditView">
          <div class="input-shell">
            <input id="driveInput" type="password" placeholder="AIzaSy... (leave empty to skip)" autocomplete="off">
            <button class="eye-btn" onclick="toggleVis('driveInput')" type="button">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M1.5 12S5 5 12 5s10.5 7 10.5 7-3.5 7-10.5 7S1.5 12 1.5 12Z"/><circle cx="12" cy="12" r="3"/></svg>
            </button>
          </div>
          <div class="field__status" id="driveStatus"><span class="dot"></span><span>Not connected — normal quality will be used</span></div>
        </div>
      </div>

      <div class="toggle-card is-locked" id="hdCard">
        <div class="toggle-card__text">
          <p class="toggle-card__title">Save high-definition images on your PC</p>
          <p class="toggle-card__desc" id="hdCardDesc">Turns on once you paste a valid API key above. Uses disk space (~3 MB per card).</p>
        </div>
        <button class="switch" id="hdSwitch" type="button" onclick="toggleHd()" disabled></button>
      </div>
    </div>

    <div class="wizard__foot">
      <button class="btn-primary" id="btnGuardar" type="button" onclick="guardar()">Save and continue</button>
      <p class="foot-note">Everything is saved on your <b>own PC</b>, in a local file. Nothing is sent to external servers except Discord and, if you turn it on, Google Drive.</p>
    </div>
  </div>

  <div class="success-screen" id="successView">
    <div class="success-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6 9 17l-5-5"/></svg></div>
    <p class="success-title">Done!</p>
    <p class="success-desc">Monitor Pokémon is starting up. You can close this tab now.</p>
    <div class="ports-box">
      <p class="ports-box__title">Use these addresses in Kevin's bot (P BOT):</p>
      <div class="ports-box__row"><b>S4T</b> <code>__S4T_URL__</code></div>
      <div class="ports-box__row"><b>Heartbeat</b> <code>__HEARTBEAT_URL__</code></div>
    </div>
    <p class="success-desc">If a port was busy, check "Ports in use.txt" in this same folder for the real ones.</p>
  </div>
</div>

<script>
const TOKEN_CONECTADO = __TOKEN_CONECTADO__;
const DRIVE_CONECTADO = __DRIVE_CONECTADO__;
const HD_ACTUAL = __HD_ACTUAL__;
let driveKeyQuitada = false;

function toggleVis(id) {
  const el = document.getElementById(id);
  el.type = el.type === 'password' ? 'text' : 'password';
}

function mostrarEdicionToken() {
  document.getElementById('tokenConnectedView').classList.add('hidden');
  document.getElementById('tokenEditView').classList.remove('hidden');
  document.getElementById('tokenInput').focus();
}

function mostrarEdicionDrive() {
  driveKeyQuitada = false;
  document.getElementById('driveConnectedView').classList.add('hidden');
  document.getElementById('driveEditView').classList.remove('hidden');
  document.getElementById('driveInput').focus();
}

function quitarDrive() {
  driveKeyQuitada = true;
  document.getElementById('driveConnectedView').classList.add('hidden');
  document.getElementById('driveEditView').classList.remove('hidden');
  document.getElementById('driveInput').value = '';
  document.getElementById('driveInput').dispatchEvent(new Event('input'));
}

let hdEnabled = HD_ACTUAL;

if (TOKEN_CONECTADO) {
  document.getElementById('tokenConnectedView').classList.remove('hidden');
  document.getElementById('tokenEditView').classList.add('hidden');
}

if (DRIVE_CONECTADO) {
  document.getElementById('driveConnectedView').classList.remove('hidden');
  document.getElementById('driveEditView').classList.add('hidden');
  const hdCard = document.getElementById('hdCard');
  const hdSwitch = document.getElementById('hdSwitch');
  const hdCardDesc = document.getElementById('hdCardDesc');
  hdSwitch.disabled = false;
  hdCard.classList.remove('is-locked');
  hdSwitch.classList.toggle('on', hdEnabled);
  hdCard.classList.toggle('is-active', hdEnabled);
  hdCardDesc.textContent = hdEnabled
    ? 'On — cards will show in high definition.'
    : 'Off — normal quality will be used to save disk space.';
}

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
    status.innerHTML = '<span class="dot"></span><span>Key detected — high definition turned on</span>';
    if (!hdEnabled) { hdEnabled = true; hdSwitch.classList.add('on'); }
    hdCard.classList.toggle('is-active', hdEnabled);
    hdCardDesc.textContent = 'On — cards will show in high definition.';
  } else {
    status.classList.remove('is-good');
    status.innerHTML = '<span class="dot"></span><span>Not connected — normal quality will be used</span>';
    hdEnabled = false; hdSwitch.classList.remove('on'); hdCard.classList.remove('is-active');
    hdCardDesc.textContent = 'Turns on once you paste a valid API key above. Uses disk space (~3 MB per card).';
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
    ? 'On — cards will show in high definition.'
    : 'Off — normal quality will be used to save disk space.';
}

document.getElementById('tokenInput').addEventListener('input', () => {
  const val = document.getElementById('tokenInput').value.trim();
  const status = document.getElementById('tokenStatus');
  document.getElementById('errorBanner').classList.remove('show');
  if (val.length > 0) {
    status.classList.remove('is-bad');
    status.classList.add('is-good');
    status.innerHTML = '<span class="dot"></span><span>Looks like a valid token</span>';
  } else {
    status.classList.remove('is-good');
    status.innerHTML = '<span class="dot"></span><span>Not connected yet</span>';
  }
});

async function guardar() {
  const tokenEditando = !document.getElementById('tokenEditView').classList.contains('hidden');
  const driveEditando = !document.getElementById('driveEditView').classList.contains('hidden');
  const errorBanner = document.getElementById('errorBanner');
  const btn = document.getElementById('btnGuardar');

  let token = null;
  if (tokenEditando) {
    token = document.getElementById('tokenInput').value.trim();
    if (!token) {
      errorBanner.textContent = 'Bot token is missing — it is required to continue.';
      errorBanner.classList.add('show');
      document.getElementById('tokenStatus').classList.add('is-bad');
      document.getElementById('tokenStatus').innerHTML = '<span class="dot"></span><span>Token missing</span>';
      return;
    }
  }

  let driveKey = null;
  if (driveKeyQuitada) {
    driveKey = '';
  } else if (driveEditando) {
    driveKey = document.getElementById('driveInput').value.trim();
  }

  btn.disabled = true;
  btn.textContent = 'Saving...';

  try {
    const resp = await fetch('/guardar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, driveKey, driveKeyQuitada, hdEnabled })
    });
    if (!resp.ok) throw new Error('fallo');

    document.getElementById('formView').style.display = 'none';
    document.getElementById('successView').classList.add('show');
  } catch (e) {
    errorBanner.textContent = 'Could not save the configuration. Try again.';
    errorBanner.classList.add('show');
    btn.disabled = false;
    btn.textContent = 'Save and continue';
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
                const tokenConectado = !!(valores.DISCORD_BOT_TOKEN && valores.DISCORD_BOT_TOKEN.trim());
                const driveConectado = !!(valores.GOOGLE_DRIVE_API_KEY && valores.GOOGLE_DRIVE_API_KEY.trim());
                const hdActual = driveConectado && valores.GOOGLE_DRIVE_HD_ENABLED !== 'false';
                const { s4tUrl, heartbeatUrl } = obtenerUrlsPBot();
                const html = paginaHtml()
                    .split('__LOGO_B64__').join(logoBase64())
                    .split('__TOKEN_CONECTADO__').join(String(tokenConectado))
                    .split('__DRIVE_CONECTADO__').join(String(driveConectado))
                    .split('__HD_ACTUAL__').join(String(hdActual))
                    .split('__S4T_URL__').join(s4tUrl)
                    .split('__HEARTBEAT_URL__').join(heartbeatUrl);
                res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                res.end(html);
                return;
            }

            if (req.method === 'POST' && req.url === '/guardar') {
                let cuerpo = '';
                req.on('data', (trozo) => { cuerpo += trozo; });
                req.on('end', () => {
                    try {
                        const datos = JSON.parse(cuerpo);
                        const hdEnabled = !!datos.hdEnabled;

                        // token === null/undefined significa "no tocado" — se conserva el que ya
                        // había en el .env en vez de pedirlo de nuevo cada vez que se reabre el asistente.
                        if (datos.token !== null && datos.token !== undefined) {
                            const token = String(datos.token).trim();
                            if (!token) {
                                res.writeHead(400, { 'Content-Type': 'application/json' });
                                res.end(JSON.stringify({ error: 'token_vacio' }));
                                return;
                            }
                            valores.DISCORD_BOT_TOKEN = token;
                        } else if (!valores.DISCORD_BOT_TOKEN) {
                            res.writeHead(400, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ error: 'token_vacio' }));
                            return;
                        }

                        if (datos.driveKeyQuitada) {
                            valores.GOOGLE_DRIVE_API_KEY = '';
                            valores.GOOGLE_DRIVE_HD_ENABLED = 'false';
                        } else if (datos.driveKey !== null && datos.driveKey !== undefined) {
                            const driveKey = String(datos.driveKey).trim();
                            valores.GOOGLE_DRIVE_API_KEY = driveKey;
                            valores.GOOGLE_DRIVE_HD_ENABLED = driveKey ? String(hdEnabled) : 'false';
                        } else {
                            // Drive key no tocada (ya estaba conectada) — solo se actualiza el switch de HD.
                            valores.GOOGLE_DRIVE_HD_ENABLED = valores.GOOGLE_DRIVE_API_KEY ? String(hdEnabled) : 'false';
                        }
                        guardarEnv(valores);

                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ ok: true }));

                        setTimeout(() => {
                            server.close();
                            try { fs.unlinkSync(ACCESO_DIRECTO_PATH); } catch (e) {}
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
            console.log('🌐 Opening configuration in your browser...');
            console.log('   If it does not open automatically, go to:', url);
            console.log('');

            // Acceso directo real como respaldo: si el intento automático de abrir
            // el navegador no se ve en pantalla, la persona puede hacerle doble
            // clic a este archivo (un acceso directo .url es un mecanismo nativo
            // de Windows, mucho más confiable que forzar la apertura por código).
            try {
                fs.writeFileSync(ACCESO_DIRECTO_PATH, `[InternetShortcut]\r\nURL=${url}\r\n`, 'utf8');
            } catch (e) {}

            abrirNavegador(url);
        });
    });
}

module.exports = { necesitaConfiguracion, ejecutarWizard };
