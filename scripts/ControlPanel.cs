// Panel de control de Monitor Pokemon, version compilada (C# / .NET
// Framework WinForms) - reemplaza al script de PowerShell equivalente para
// que Windows lo identifique como su propia app (icono y nombre propios en
// la barra de tareas), no como "Windows PowerShell" ejecutando un script.
// Misma logica que scripts/control-panel.ps1, portada 1:1.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Net.NetworkInformation;
using System.Reflection;
using System.Text.RegularExpressions;
using System.Web.Script.Serialization;
using System.Windows.Forms;

[assembly: AssemblyTitle("Monitor Pokemon")]
[assembly: AssemblyProduct("Monitor Pokemon")]

public class InfoDiscord {
    public string version;
    public bool tokenPresente;
    public bool apiKeyPresente;
    public bool? tokenValido;
    public string botNombre;
    public string servidorNombre;
    public string usuarioNombre;
    public string s4tUrl;
    public string heartbeatUrl;
    public bool updateAvailable;
    public string remoteVersion;
    public string discordChannelUrl;
}

public class ControlPanelForm : Form {
    string raiz;
    string rutaLock, rutaPendienteRestart, rutaExe, rutaStartBat, rutaReconfigureBat, rutaIcono, rutaImagenPokemon, rutaEnv;

    Color colorFondo = Color.FromArgb(30, 30, 30);
    Color colorTexto = Color.White;
    Color colorAcento = Color.White;
    Color colorCampoFondo = Color.FromArgb(20, 20, 24);
    Color colorSeccionControl = Color.FromArgb(95, 210, 130);
    Color colorSeccionInfo = Color.FromArgb(235, 155, 65);
    Color colorSeccionDiscord = Color.FromArgb(150, 160, 250);
    Color colorBotonFondo = Color.FromArgb(225, 225, 225);

    Label labelEstado, labelVersion, labelTokenEstado, labelApiEstado, labelBotNombre, labelServidorNombre, labelUsuarioNombre;
    TextBox txtToken, txtApi, txtS4t, txtHeartbeat;
    Button botonIniciar, botonApagar, botonReiniciar, botonAbrirConfig;
    System.Windows.Forms.Timer timer;

    Dictionary<string, string> envConocido;
    bool enTransicion = false;
    DateTime horaCambioDetectado;
    InfoDiscord infoDiscord;
    bool avisoActualizacionMostrado = false;

    public ControlPanelForm() {
        // El .exe vive directo en la raiz del proyecto (o en dist/, tambien
        // raiz de ese paquete) - a diferencia del script viejo de PowerShell
        // que vivia anidado en scripts/ y necesitaba subir dos niveles.
        raiz = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
        rutaLock = Path.Combine(raiz, ".monitor.lock");
        rutaPendienteRestart = Path.Combine(raiz, ".pending_restart.json");
        rutaExe = Path.Combine(raiz, "MonitorPokemonBot.exe");
        rutaStartBat = Path.Combine(raiz, "Advanced", "Start Monitor Pokemon.bat");
        rutaReconfigureBat = Path.Combine(raiz, "Advanced", "Reconfigure.bat");
        rutaIcono = Path.Combine(raiz, "assets", "tray_icon.ico");
        rutaImagenPokemon = Path.Combine(raiz, "assets", "element", "Poke_Ball.png");
        rutaEnv = Path.Combine(raiz, ".env");

        envConocido = LeerEnv();

        ConstruirUI();

        if (!EstaCorriendo()) IniciarBot();
        RefrescarEstado();
        RefrescarInfoDiscord();

        timer = new System.Windows.Forms.Timer();
        timer.Interval = 2000;
        timer.Tick += (s, e) => RefrescarEstado();
        timer.Start();
    }

    // ---------- Logica de proceso / puertos ----------

    bool ProcesoVivo(int pid) {
        try { Process.GetProcessById(pid); return true; } catch { return false; }
    }

    bool PuertoEnUso(int puerto) {
        var listeners = IPGlobalProperties.GetIPGlobalProperties().GetActiveTcpListeners();
        return listeners.Any(ep => ep.Port == puerto);
    }

    bool CorridoPorEstePanel() {
        if (!File.Exists(rutaLock)) return false;
        var texto = File.ReadAllText(rutaLock).Trim();
        int pid;
        if (!int.TryParse(texto, out pid)) return false;
        return ProcesoVivo(pid);
    }

    bool EstaCorriendo() {
        return CorridoPorEstePanel() || PuertoEnUso(3000);
    }

    void IniciarBot() {
        if (EstaCorriendo()) return;
        try {
            if (File.Exists(rutaExe)) {
                Process.Start(new ProcessStartInfo { FileName = rutaStartBat, WorkingDirectory = raiz, WindowStyle = ProcessWindowStyle.Hidden, UseShellExecute = true });
            } else {
                Process.Start(new ProcessStartInfo { FileName = "node.exe", Arguments = "\"launcher.js\"", WorkingDirectory = raiz, WindowStyle = ProcessWindowStyle.Hidden, UseShellExecute = true });
            }
        } catch (Exception ex) {
            MessageBox.Show("Could not start the bot: " + ex.Message, "Monitor Pokemon");
        }
    }

    void ApagarBot() {
        if (!CorridoPorEstePanel()) {
            if (PuertoEnUso(3000)) {
                MessageBox.Show("Monitor Pokemon is running but not managed by this panel (e.g. PM2 on a dev PC) - it can't be stopped from here.", "Monitor Pokemon");
            }
            return;
        }
        var texto = File.ReadAllText(rutaLock).Trim();
        try {
            var psi = new ProcessStartInfo("taskkill", "/PID " + texto + " /T /F") { WindowStyle = ProcessWindowStyle.Hidden, UseShellExecute = false, CreateNoWindow = true };
            Process.Start(psi).WaitForExit();
        } catch { }
        try { File.Delete(rutaLock); } catch { }
    }

    void ReiniciarBot() {
        if (EstaCorriendo()) {
            File.WriteAllText(rutaPendienteRestart, "1");
        } else {
            IniciarBot();
        }
    }

    Dictionary<string, string> LeerEnv() {
        var valores = new Dictionary<string, string>();
        if (!File.Exists(rutaEnv)) return valores;
        foreach (var linea in File.ReadAllLines(rutaEnv)) {
            var m = Regex.Match(linea, @"^([A-Z_][A-Z0-9_]*)=(.*)$");
            if (m.Success) valores[m.Groups[1].Value] = m.Groups[2].Value;
        }
        return valores;
    }

    void RefrescarInfoDiscord() {
        try {
            string salida;
            var psi = new ProcessStartInfo {
                UseShellExecute = false,
                RedirectStandardOutput = true,
                CreateNoWindow = true,
                WorkingDirectory = raiz
            };
            psi.EnvironmentVariables["MONITOR_ROLE"] = "panel_info";
            if (File.Exists(rutaExe)) {
                psi.FileName = rutaExe;
            } else {
                psi.FileName = "node.exe";
                psi.Arguments = "\"scripts\\panel-info.js\"";
            }
            var proc = Process.Start(psi);
            salida = proc.StandardOutput.ReadToEnd();
            proc.WaitForExit(8000);
            var serializer = new JavaScriptSerializer();
            infoDiscord = serializer.Deserialize<InfoDiscord>(salida);
        } catch {
            infoDiscord = null;
        }
        PintarInfoDiscord();
    }

    // Dos caminos para lo mismo: bajarla directo desde el panel, o ir al
    // canal de Discord y usar el boton "Update now" que ya existe ahi. Da
    // igual cual use el usuario - los dos terminan escribiendo la misma
    // señal (.pending_update.json) que launcher.js revisa cada 2s para
    // hacer el reemplazo real, asi que no hay riesgo de que se "dupliquen"
    // ni se corrompa nada por usar los dos (apply-update.js ademas chequea
    // si ya hay una descarga en camino antes de bajar una segunda vez).
    void MostrarAvisoActualizacion(string versionActual, string versionNueva, string discordChannelUrl) {
        var dialogo = new Form {
            Text = "Update available",
            ClientSize = new Size(380, 170),
            FormBorderStyle = FormBorderStyle.FixedDialog,
            MaximizeBox = false,
            MinimizeBox = false,
            StartPosition = FormStartPosition.CenterScreen,
            BackColor = colorFondo
        };
        if (File.Exists(rutaIcono)) dialogo.Icon = new Icon(rutaIcono);

        var lbl = new Label {
            Text = "A new version is available: v" + versionNueva + " (you have v" + versionActual + ").",
            ForeColor = colorTexto,
            Font = new Font("Segoe UI", 9),
            Location = new Point(20, 20),
            Size = new Size(340, 50)
        };
        dialogo.Controls.Add(lbl);

        var btnDescargar = new Button {
            Text = "Download Now",
            Size = new Size(340, 34),
            Location = new Point(20, 80),
            FlatStyle = FlatStyle.Flat,
            BackColor = Color.FromArgb(225, 225, 225),
            ForeColor = Color.Black
        };
        btnDescargar.FlatAppearance.BorderColor = Color.FromArgb(150, 150, 150);
        dialogo.Controls.Add(btnDescargar);

        var btnDiscord = new Button {
            Text = "Open Discord Channel Instead",
            Size = new Size(340, 34),
            Location = new Point(20, 122),
            FlatStyle = FlatStyle.Flat,
            BackColor = Color.FromArgb(225, 225, 225),
            ForeColor = Color.Black
        };
        btnDiscord.FlatAppearance.BorderColor = Color.FromArgb(150, 150, 150);
        dialogo.Controls.Add(btnDiscord);

        btnDiscord.Click += (s, e) => {
            var destino = !string.IsNullOrEmpty(discordChannelUrl) ? discordChannelUrl : "https://discord.com/app";
            try { Process.Start(new ProcessStartInfo { FileName = destino, UseShellExecute = true }); } catch { }
            dialogo.Close();
        };

        btnDescargar.Click += (s, e) => {
            btnDescargar.Enabled = false;
            btnDiscord.Enabled = false;
            btnDescargar.Text = "Downloading...";
            DescargarActualizacionDesdePanel(dialogo);
        };

        dialogo.ShowDialog(this);
    }

    void DescargarActualizacionDesdePanel(Form dialogo) {
        string salida = null;
        try {
            var psi = new ProcessStartInfo {
                UseShellExecute = false,
                RedirectStandardOutput = true,
                CreateNoWindow = true,
                WorkingDirectory = raiz
            };
            psi.EnvironmentVariables["MONITOR_ROLE"] = "apply_update";
            if (File.Exists(rutaExe)) {
                psi.FileName = rutaExe;
            } else {
                psi.FileName = "node.exe";
                psi.Arguments = "\"scripts\\apply-update.js\"";
            }
            var proc = Process.Start(psi);
            salida = proc.StandardOutput.ReadToEnd();
            proc.WaitForExit(120000);
            var serializer = new JavaScriptSerializer();
            var resultado = serializer.Deserialize<Dictionary<string, object>>(salida);
            dialogo.Close();
            if (resultado != null && resultado.ContainsKey("ok") && (bool)resultado["ok"]) {
                if (EjecutarSwapPanelSiExiste(raiz)) {
                    // Se descargo tambien una version nueva del panel - este
                    // .exe no se puede reemplazar a si mismo mientras corre,
                    // asi que un script aparte espera a que cierre, lo
                    // reemplaza, y lo vuelve a abrir solo.
                    Application.Exit();
                    return;
                }
                MessageBox.Show("Update downloaded. The bot will restart on its own in a few seconds to finish installing it.", "Monitor Pokemon");
            } else {
                MessageBox.Show("Could not download the update. Try the Discord channel instead.", "Monitor Pokemon");
            }
        } catch (Exception ex) {
            dialogo.Close();
            // Si lo que imprimió el proceso hijo no era JSON válido, el mensaje del
            // parser solo (ex.Message) no dice nada útil para diagnosticar a
            // distancia — se muestra también la salida cruda (recortada) para que,
            // si esto le pasa a otro usuario, la captura que mande tenga la pista
            // real en vez de solo "Invalid JSON primitive".
            var detalle = !string.IsNullOrEmpty(salida) ? salida.Substring(0, Math.Min(300, salida.Length)) : "(no output)";
            MessageBox.Show("Could not download the update: " + ex.Message + "\n\nProcess output: " + detalle, "Monitor Pokemon");
        }
    }

    // ---------- UI ----------

    void ConstruirUI() {
        Text = "Monitor Pokemon";
        ClientSize = new Size(650, 415);
        FormBorderStyle = FormBorderStyle.FixedSingle;
        MaximizeBox = false;
        StartPosition = FormStartPosition.CenterScreen;
        BackColor = colorFondo;
        if (File.Exists(rutaIcono)) Icon = new Icon(rutaIcono);

        // Columna izquierda: Control y S4T/Heartbeat en sus propias cajas
        // ajustadas al contenido; el logo+version va suelto abajo, sin borde.
        var seccionControl = NuevaSeccion("CONTROL", colorSeccionControl, 15, 15, 260, 185);
        var seccionPuertos = NuevaSeccion("S4T / HEARTBEAT", colorSeccionDiscord, 15, 210, 260, 130);
        var seccionDiscord = NuevaSeccion("DISCORD", colorSeccionDiscord, 290, 15, 345, 325);

        labelEstado = new Label { Font = new Font("Segoe UI", 10), AutoSize = true, Location = new Point(30, 34), ForeColor = colorTexto };
        Controls.Add(labelEstado);

        botonIniciar = NuevoBoton("Start", 30, 58, 225);
        botonIniciar.Click += (s, e) => { IniciarBot(); System.Threading.Thread.Sleep(500); RefrescarEstado(); };
        botonApagar = NuevoBoton("Stop", 30, 100, 225);
        botonApagar.Click += (s, e) => { ApagarBot(); System.Threading.Thread.Sleep(500); RefrescarEstado(); };
        botonReiniciar = NuevoBoton("Restart", 30, 142, 225);
        botonReiniciar.Click += (s, e) => { ReiniciarBot(); System.Threading.Thread.Sleep(500); RefrescarEstado(); };

        NuevoTitulo("S4T (paste in P BOT)", 30, 228);
        txtS4t = NuevoCampo(30, 248, 225);
        HacerCopiableAlClick(txtS4t);
        NuevoTitulo("Heartbeat (paste in P BOT)", 30, 285);
        txtHeartbeat = NuevoCampo(30, 305, 225);
        HacerCopiableAlClick(txtHeartbeat);

        var pictureBox = new PictureBox { Size = new Size(46, 46), Location = new Point(30, 355), SizeMode = PictureBoxSizeMode.Zoom, BackColor = colorFondo };
        if (File.Exists(rutaImagenPokemon)) pictureBox.Image = Image.FromFile(rutaImagenPokemon);
        Controls.Add(pictureBox);
        pictureBox.BringToFront();

        labelVersion = new Label { Text = "Monitor Pokemon", Font = new Font("Segoe UI", 9, FontStyle.Bold), ForeColor = colorAcento, AutoSize = true, MaximumSize = new Size(180, 0), Location = new Point(85, 371) };
        Controls.Add(labelVersion);
        labelVersion.BringToFront();

        NuevoTitulo("Token", 305, 32);
        txtToken = NuevoCampo(305, 52, 315);
        labelTokenEstado = NuevaEtiquetaInfo(305, 80);

        NuevoTitulo("Google Drive API Key", 305, 112);
        txtApi = NuevoCampo(305, 132, 315);
        labelApiEstado = NuevaEtiquetaInfo(305, 160);

        botonAbrirConfig = NuevoBoton("Open Token / API Settings", 305, 192, 315);
        botonAbrirConfig.Click += (s, e) => {
            try {
                Process.Start(new ProcessStartInfo { FileName = rutaReconfigureBat, WorkingDirectory = raiz, UseShellExecute = true });
            } catch (Exception ex) {
                MessageBox.Show("Could not open configuration: " + ex.Message, "Monitor Pokemon");
            }
        };

        labelBotNombre = NuevaEtiquetaInfo(305, 244);
        labelServidorNombre = NuevaEtiquetaInfo(305, 267);
        labelUsuarioNombre = NuevaEtiquetaInfo(305, 290);

        // Afuera de la caja de Discord (debajo), asi la caja se puede achicar
        // al tamano real de su contenido en vez de quedar estirada por estos.
        NuevoIconoLink(Path.Combine(raiz, "assets", "element", "coin_bag_3.png"), "Support the project (Ko-fi)", "https://ko-fi.com/alecast", 305, 355, 52);
        // TODO: reemplazar por el link real de la pagina de tutoriales
        // (Notion) cuando Ale la tenga armada - por ahora un placeholder.
        NuevoIconoTexto("?", "Tutorials", "https://www.notion.so", 372, 355, 52);
    }

    Panel NuevaSeccion(string titulo, Color colorTitulo, int x, int y, int ancho, int alto) {
        var panel = new Panel { Location = new Point(x, y), Size = new Size(ancho, alto) };
        panel.Paint += (s, e) => {
            using (var pen = new Pen(Color.White, 1)) {
                e.Graphics.DrawRectangle(pen, 0, 8, panel.Width - 1, panel.Height - 9);
            }
        };
        Controls.Add(panel);

        var lbl = new Label {
            Text = "  " + titulo + "  ",
            Font = new Font("Segoe UI", 8, FontStyle.Bold),
            ForeColor = colorTitulo,
            BackColor = colorFondo,
            AutoSize = true,
            Location = new Point(x + 10, y - 2)
        };
        Controls.Add(lbl);
        lbl.BringToFront();
        return panel;
    }

    Button NuevoBoton(string texto, int x, int y, int ancho) {
        var boton = new Button {
            Text = texto,
            Size = new Size(ancho, 36),
            Location = new Point(x, y),
            Font = new Font("Segoe UI", 10),
            FlatStyle = FlatStyle.Flat,
            BackColor = Color.FromArgb(225, 225, 225),
            ForeColor = Color.Black
        };
        boton.FlatAppearance.BorderColor = Color.FromArgb(150, 150, 150);
        boton.FlatAppearance.BorderSize = 1;
        boton.FlatAppearance.MouseOverBackColor = Color.FromArgb(190, 222, 246);
        boton.FlatAppearance.MouseDownBackColor = Color.FromArgb(160, 200, 235);
        Controls.Add(boton);
        boton.BringToFront();
        return boton;
    }

    TextBox NuevoCampo(int x, int y, int ancho) {
        var txt = new TextBox {
            Location = new Point(x, y),
            Size = new Size(ancho, 24),
            ReadOnly = true,
            BorderStyle = BorderStyle.FixedSingle,
            BackColor = colorCampoFondo,
            ForeColor = colorAcento,
            Font = new Font("Consolas", 10)
        };
        Controls.Add(txt);
        txt.BringToFront();
        return txt;
    }

    ToolTip tooltipCopiado = new ToolTip();

    // Un solo click copia el valor (S4T/Heartbeat son direcciones que hay que
    // pegar en otra herramienta - copiar a mano seleccionando+Ctrl+C es
    // incomodo para un campo de solo lectura).
    void HacerCopiableAlClick(TextBox txt) {
        txt.Cursor = Cursors.Hand;
        txt.Click += (s, e) => {
            if (string.IsNullOrEmpty(txt.Text)) return;
            if (CopiarAlPortapapelesConReintentos(txt.Text)) {
                tooltipCopiado.Show("Copied!", txt, txt.Width / 2, -20, 1200);
            } else {
                tooltipCopiado.Show("Could not copy, try again", txt, txt.Width / 2, -20, 1500);
            }
        };
    }

    // Bug real reportado por un usuario externo: Clipboard.SetText puede
    // tirar "Requested Clipboard operation did not succeed" si el
    // portapapeles esta momentaneamente ocupado por otro programa (o el
    // historial del portapapeles de Windows) - es una condicion de carrera
    // conocida de la API de Windows, no algo que dependa de nuestro codigo.
    // Reintentar un par de veces con una espera corta casi siempre alcanza.
    bool CopiarAlPortapapelesConReintentos(string texto) {
        for (int intento = 0; intento < 4; intento++) {
            try {
                Clipboard.SetText(texto);
                return true;
            } catch (System.Runtime.InteropServices.ExternalException) {
                System.Threading.Thread.Sleep(80);
            }
        }
        return false;
    }

    // El cuadro se achica/agranda para que ocupe justo el largo del texto
    // real (ej. "http://localhost:3000"), no un ancho fijo mas grande de lo
    // necesario.
    void AjustarAnchoAlTexto(TextBox txt) {
        var medida = TextRenderer.MeasureText(txt.Text, txt.Font);
        txt.Width = medida.Width + 14;
    }

    // Icono circular clickeable que abre un link (mismo estilo que la fila
    // de iconos de Discord/Ayuda/Config de "Arturo's PTCGP BOT") - acá se usa
    // para el link de apoyo/donacion (Ko-fi).
    Panel NuevoIconoBase(string tooltipTexto, string url, int x, int y, int tamano) {
        var contenedor = new Panel {
            Size = new Size(tamano, tamano),
            Location = new Point(x, y),
            BackColor = colorBotonFondo,
            Cursor = Cursors.Hand
        };
        var tooltip = new ToolTip();
        tooltip.SetToolTip(contenedor, tooltipTexto);

        EventHandler abrir = (s, e) => {
            try { Process.Start(new ProcessStartInfo { FileName = url, UseShellExecute = true }); } catch { }
        };
        contenedor.Click += abrir;

        EventHandler resaltar = (s, e) => contenedor.BackColor = Color.FromArgb(190, 222, 246);
        EventHandler apagar = (s, e) => contenedor.BackColor = colorBotonFondo;
        contenedor.MouseEnter += resaltar;
        contenedor.MouseLeave += apagar;

        Controls.Add(contenedor);
        contenedor.BringToFront();
        return contenedor;
    }

    void NuevoIconoLink(string rutaImagen, string tooltipTexto, string url, int x, int y, int tamano = 28) {
        var contenedor = NuevoIconoBase(tooltipTexto, url, x, y, tamano);
        var pic = new PictureBox {
            Dock = DockStyle.Fill,
            SizeMode = PictureBoxSizeMode.Zoom,
            Padding = new Padding(6),
            Cursor = Cursors.Hand,
            Enabled = false // los clicks los maneja el contenedor, no la imagen
        };
        if (File.Exists(rutaImagen)) pic.Image = Image.FromFile(rutaImagen);
        contenedor.Controls.Add(pic);
    }

    // Version con un caracter simple (ej. "?") en vez de imagen - un caracter
    // ASCII normal SI se dibuja bien con GDI+ clasico (a diferencia de los
    // emoji a color, que salian como icono roto).
    void NuevoIconoTexto(string texto, string tooltipTexto, string url, int x, int y, int tamano = 28) {
        var contenedor = NuevoIconoBase(tooltipTexto, url, x, y, tamano);
        var lbl = new Label {
            Text = texto,
            Dock = DockStyle.Fill,
            Font = new Font("Segoe UI", (float)(tamano / 3.2), FontStyle.Bold),
            ForeColor = colorTexto,
            BackColor = Color.Transparent,
            TextAlign = ContentAlignment.MiddleCenter,
            Enabled = false
        };
        contenedor.Controls.Add(lbl);
    }

    void NuevoTitulo(string texto, int x, int y) {
        var lbl = new Label { Text = texto, Font = new Font("Segoe UI", 9, FontStyle.Bold), ForeColor = colorAcento, AutoSize = true, Location = new Point(x, y) };
        Controls.Add(lbl);
        lbl.BringToFront();
    }

    Label NuevaEtiquetaInfo(int x, int y) {
        var lbl = new Label { Font = new Font("Segoe UI", 9), ForeColor = colorTexto, AutoSize = true, Location = new Point(x, y) };
        Controls.Add(lbl);
        lbl.BringToFront();
        return lbl;
    }

    // ---------- Refresco de estado ----------

    void RefrescarEstado() {
        bool corriendo = EstaCorriendo();
        if (corriendo) {
            labelEstado.Text = "Status: Running";
            labelEstado.ForeColor = Color.FromArgb(80, 220, 140);
        } else {
            labelEstado.Text = "Status: Stopped";
            labelEstado.ForeColor = Color.FromArgb(235, 90, 90);
        }

        var envActual = LeerEnv();
        if (!enTransicion) {
            string tokenViejo, tokenNuevo, apiViejo, apiNuevo;
            envConocido.TryGetValue("DISCORD_BOT_TOKEN", out tokenViejo);
            envActual.TryGetValue("DISCORD_BOT_TOKEN", out tokenNuevo);
            envConocido.TryGetValue("GOOGLE_DRIVE_API_KEY", out apiViejo);
            envActual.TryGetValue("GOOGLE_DRIVE_API_KEY", out apiNuevo);
            if (tokenViejo != tokenNuevo || apiViejo != apiNuevo) {
                enTransicion = true;
                horaCambioDetectado = DateTime.Now;
            }
        }

        if (enTransicion) {
            labelTokenEstado.Text = "Token changed - restarting...";
            labelTokenEstado.ForeColor = Color.FromArgb(240, 170, 60);
            labelApiEstado.Text = "Restarting...";
            labelApiEstado.ForeColor = Color.FromArgb(240, 170, 60);
            if ((DateTime.Now - horaCambioDetectado).TotalSeconds >= 5 && corriendo) {
                envConocido = envActual;
                enTransicion = false;
                RefrescarInfoDiscord();
            }
        }
    }

    void PintarInfoDiscord() {
        if (infoDiscord == null) return;

        if (!string.IsNullOrEmpty(infoDiscord.version)) labelVersion.Text = "Monitor Pokemon v" + infoDiscord.version;

        if (infoDiscord.updateAvailable && !avisoActualizacionMostrado) {
            avisoActualizacionMostrado = true;
            MostrarAvisoActualizacion(infoDiscord.version, infoDiscord.remoteVersion, infoDiscord.discordChannelUrl);
        }

        if (infoDiscord.tokenPresente) {
            txtToken.Text = "********************";
            if (infoDiscord.tokenValido == true) {
                labelTokenEstado.Text = "Token connected successfully";
                labelTokenEstado.ForeColor = Color.FromArgb(80, 220, 140);
            } else {
                labelTokenEstado.Text = "Invalid token";
                labelTokenEstado.ForeColor = Color.FromArgb(235, 90, 90);
            }
        } else {
            txtToken.Text = "(not configured)";
            labelTokenEstado.Text = "Not configured";
            labelTokenEstado.ForeColor = Color.FromArgb(140, 145, 165);
        }

        if (infoDiscord.apiKeyPresente) {
            txtApi.Text = "********************";
            labelApiEstado.Text = "API connected successfully";
            labelApiEstado.ForeColor = Color.FromArgb(80, 220, 140);
        } else {
            txtApi.Text = "(not configured)";
            labelApiEstado.Text = "Not configured (optional)";
            labelApiEstado.ForeColor = Color.FromArgb(140, 145, 165);
        }

        labelBotNombre.Text = "Bot: " + (infoDiscord.botNombre ?? "-");
        labelServidorNombre.Text = "Server: " + (infoDiscord.servidorNombre ?? "-");
        labelUsuarioNombre.Text = "User: " + (infoDiscord.usuarioNombre ?? "-");

        if (!string.IsNullOrEmpty(infoDiscord.s4tUrl)) { txtS4t.Text = infoDiscord.s4tUrl; AjustarAnchoAlTexto(txtS4t); }
        if (!string.IsNullOrEmpty(infoDiscord.heartbeatUrl)) { txtHeartbeat.Text = infoDiscord.heartbeatUrl; AjustarAnchoAlTexto(txtHeartbeat); }
    }

    // Mismo truco que usa launcher.js para reemplazar el .exe del bot
    // (rutaBat/_update.bat en iniciarActualizacion()): un .exe no se puede
    // borrar/reemplazar a si mismo mientras esta corriendo, asi que un
    // proceso aparte (cmd.exe, detached) espera a que este cierre del todo,
    // recien ahi hace el reemplazo, y vuelve a abrir el panel actualizado.
    // Se llama tanto al arrancar (por si la actualizacion se bajo por
    // Discord mientras el panel no estaba abierto) como justo despues de
    // bajarla desde el propio boton "Download Now".
    static bool EjecutarSwapPanelSiExiste(string raizBase) {
        var rutaNueva = Path.Combine(raizBase, "MonitorPokemonPanel.new.exe");
        if (!File.Exists(rutaNueva)) return false;

        var rutaPropia = Assembly.GetExecutingAssembly().Location;
        var rutaBat = Path.Combine(raizBase, "_update_panel.bat");
        var contenido =
            "@echo off\r\n" +
            "ping 127.0.0.1 -n 2 >nul\r\n" +
            ":retry\r\n" +
            "del \"" + rutaPropia + "\" 2>nul\r\n" +
            "if exist \"" + rutaPropia + "\" (\r\n" +
            "  ping 127.0.0.1 -n 2 >nul\r\n" +
            "  goto retry\r\n" +
            ")\r\n" +
            "move /y \"" + rutaNueva + "\" \"" + rutaPropia + "\"\r\n" +
            "start \"\" \"" + rutaPropia + "\"\r\n" +
            "del \"%~f0\"\r\n";
        File.WriteAllText(rutaBat, contenido);

        Process.Start(new ProcessStartInfo {
            FileName = "cmd.exe",
            Arguments = "/c \"" + rutaBat + "\"",
            WorkingDirectory = raizBase,
            UseShellExecute = false,
            CreateNoWindow = true
        });
        return true;
    }

    [STAThread]
    public static void Main() {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        var raizInicial = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
        if (EjecutarSwapPanelSiExiste(raizInicial)) return;
        Application.Run(new ControlPanelForm());
    }
}
