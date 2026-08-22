// Panel de control de Monitor Pokemon, version compilada (C# / .NET
// Framework WinForms) - reemplaza al script de PowerShell equivalente para
// que Windows lo identifique como su propia app (icono y nombre propios en
// la barra de tareas), no como "Windows PowerShell" ejecutando un script.
// Misma logica que scripts/control-panel.ps1, portada 1:1.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Linq;
using System.Net.NetworkInformation;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
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
    public string tutorialsUrl;
    public bool updateAvailable;
    public string remoteVersion;
    public string discordChannelUrl;
}

public class ControlPanelForm : Form {
    string raiz;
    string rutaLock, rutaPendienteRestart, rutaExe, rutaStartBat, rutaReconfigureBat, rutaIcono, rutaImagenPokemon, rutaEnv;

    // Paleta reskin (2026-08-07, a pedido explicito del usuario -- referencia visual:
    // dashboard de control climatico tipo smart-home, con modo dia/noche real). Tarjetas
    // redondeadas en vez de cajas con borde recto, un unico acento dorado (mismo tono base
    // 0xF0A93A que ya usan los embeds de Gold Cards/Settings en Discord) en vez de la
    // mezcla verde/naranja/azul de antes por seccion. Los valores reales se asignan en
    // AplicarPaleta() -- ver ahi las dos variantes (clara/oscura).
    Color colorFondo, colorSuperficie, colorSuperficie2, colorBorde, colorTexto, colorTextoDim, colorAcento, colorPeligro;
    Color colorBotonFondo, colorBotonTexto;
    Color colorSeccionControl, colorSeccionDiscord; // titulo de cada tarjeta -- en el tema oscuro son los colores de la version original (verde/azul-violeta); en el claro, las dos son el mismo acento
    bool temaOscuro = false;

    void AplicarPaleta(bool oscuro) {
        temaOscuro = oscuro;
        if (oscuro) {
            // Modo noche (2026-08-07): pareja del tema claro cream+gold, no la version con
            // los colores retro de la primera version del panel -- esa se probo a pedido del
            // usuario pero no convencio ("que feo"), asi que el modo noche real queda como
            // esta variante casi-negra con el mismo acento dorado que el modo dia.
            colorFondo = Color.FromArgb(21, 17, 10);
            colorSuperficie = Color.FromArgb(31, 25, 16);
            colorSuperficie2 = Color.FromArgb(16, 12, 7);
            colorBorde = Color.FromArgb(58, 46, 28);
            colorTexto = Color.FromArgb(243, 236, 223);
            colorTextoDim = Color.FromArgb(156, 144, 128);
            colorAcento = Color.FromArgb(240, 169, 58);
            colorPeligro = Color.FromArgb(214, 95, 87);
            colorBotonFondo = colorSuperficie2;
            colorBotonTexto = colorTexto;
            colorSeccionControl = colorAcento;
            colorSeccionDiscord = colorAcento;
        } else {
            colorFondo = Color.FromArgb(242, 236, 225);
            colorSuperficie = Color.FromArgb(251, 247, 239);
            colorSuperficie2 = Color.FromArgb(238, 229, 209);
            colorBorde = Color.FromArgb(224, 213, 185);
            colorTexto = Color.FromArgb(43, 38, 32);
            colorTextoDim = Color.FromArgb(134, 121, 95);
            colorAcento = Color.FromArgb(224, 163, 74);
            colorPeligro = Color.FromArgb(192, 72, 63);
            colorBotonFondo = colorSuperficie2;
            colorBotonTexto = colorTexto;
            colorSeccionControl = colorAcento;
            colorSeccionDiscord = colorAcento;
        }
    }

    // Los botones/iconos se recrean enteros al cambiar de tema (ver ToggleTema), asi que
    // este calculo corre de nuevo con la paleta ya actualizada -- sin closures viejas
    // apuntando a colores del tema anterior. Se decide oscurecer/aclarar segun la
    // LUMINOSIDAD del color base en si (no del tema de pagina) -- necesario desde que
    // colorBotonFondo puede ser un gris claro incluso en el tema oscuro (paleta original),
    // y un boton claro siempre debe oscurecer al pasar el mouse, nunca aclarar mas.
    Color ColorHover(Color baseColor) {
        bool esClaro = (baseColor.R + baseColor.G + baseColor.B) > 380;
        return esClaro ? ControlPaint.Dark(baseColor, 0.06f) : ControlPaint.Light(baseColor, 0.25f);
    }
    Color ColorPresionado(Color baseColor) {
        bool esClaro = (baseColor.R + baseColor.G + baseColor.B) > 380;
        return esClaro ? ControlPaint.Dark(baseColor, 0.12f) : ControlPaint.Light(baseColor, 0.4f);
    }

    Label labelEstado, labelVersion, labelTokenEstado, labelApiEstado, labelBotNombre, labelServidorNombre, labelUsuarioNombre;
    TextBox txtToken, txtApi, txtS4t, txtHeartbeat;
    Button botonIniciar, botonApagar, botonReiniciar, botonAbrirConfig;
    System.Windows.Forms.Timer timer;

    Dictionary<string, string> envConocido;
    bool enTransicion = false;
    bool arranqueAutoIntentado = false;
    DateTime horaCambioDetectado;
    InfoDiscord infoDiscord;
    bool avisoActualizacionMostrado = false;

    // Bloqueo de "Start" (2026-08-10, a pedido explicito del usuario): un usuario real le dio
    // "Start" en vez de "Restart" despues de cambiar el token, y terminaron abriendose varias
    // ventanas de cmd (el motor viejo seguia vivo mientras arrancaba uno nuevo encima -- mismo
    // sintoma que el Task de "doble arranque del engine"). "Start" ahora arranca deshabilitado
    // SIEMPRE que se abre el panel, y solo se vuelve a habilitar cuando el usuario aprieta
    // "Restart" -- Stop y Kill Everything lo vuelven a deshabilitar. La idea es forzar a que el
    // (re)arranque despues de cualquier cambio o corte pase siempre por el mismo camino
    // (ReiniciarBot(), que ya sabe distinguir "estaba corriendo" de "estaba parado"), nunca por
    // un click de Start hecho de apuro sin leer el aviso en pantalla.
    bool startHabilitado = false;

    public ControlPanelForm() {
        // El .exe vive directo en la raiz del proyecto (o en dist/, tambien
        // raiz de ese paquete) - a diferencia del script viejo de PowerShell
        // que vivia anidado en scripts/ y necesitaba subir dos niveles.
        raiz = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
        rutaLock = Path.Combine(raiz, ".monitor.lock");
        rutaPendienteRestart = Path.Combine(raiz, ".pending_restart.json");
        rutaExe = Path.Combine(raiz, "MonitorPokemon.exe");
        rutaStartBat = Path.Combine(raiz, "Advanced", "Start Monitor Pokemon.bat");
        rutaReconfigureBat = Path.Combine(raiz, "Advanced", "Reconfigure.bat");
        rutaIcono = Path.Combine(raiz, "assets", "tray_icon.ico");
        rutaImagenPokemon = Path.Combine(raiz, "assets", "element", "Poke_Ball.png");
        rutaEnv = Path.Combine(raiz, ".env");

        envConocido = LeerEnv();

        AplicarPaleta(false); // clara por default, a pedido explicito del usuario
        ConstruirUI();
        // Reforzado en Load (2026-08-07): pedir el atributo DWM demasiado temprano (antes de
        // que la ventana este realmente compuesta) a veces no tiene efecto visual -- se
        // vuelve a pedir aca, que es el momento estandar recomendado para esto.
        this.Load += (s, e) => AplicarTemaBarraTitulo(this.Handle);

        // Solo arranca el bot solo al abrir el panel si ya hay un token guardado -
        // si no, el motor abriria el wizard del navegador sin que el usuario haya
        // apretado nada (bug real: parecia un loop de abre/cierra al abrir el panel).
        string tokenGuardadoInicio;
        bool tieneTokenGuardado = envConocido.TryGetValue("DISCORD_BOT_TOKEN", out tokenGuardadoInicio) && !string.IsNullOrWhiteSpace(tokenGuardadoInicio);
        if (!EstaCorriendo() && tieneTokenGuardado) IniciarBot();
        RefrescarEstado();
        RefrescarInfoDiscord();

        timer = new System.Windows.Forms.Timer();
        timer.Interval = 2000;
        timer.Tick += (s, e) => RefrescarEstado();
        timer.Start();
    }

    // Barra de titulo nativa en oscuro (2026-08-07, parte del reskin completo):
    // sin esto, Windows sigue dibujando la barra de titulo clara de siempre
    // encima de una ventana con contenido oscuro -- se ve cortado a la mitad.
    // DWMWA_USE_IMMERSIVE_DARK_MODE (20 en builds recientes de Win10/Win11).
    // Si falla (Windows viejo sin soporte), no rompe nada -- solo se queda con
    // la barra de titulo clara de siempre.
    [DllImport("dwmapi.dll")]
    static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int attrValue, int attrSize);

    void AplicarTemaBarraTitulo(IntPtr hwnd) {
        try {
            int valor = temaOscuro ? 1 : 0;
            DwmSetWindowAttribute(hwnd, 20, ref valor, sizeof(int));
        } catch { }
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

    // Antes tambien miraba PuertoEnUso(3000) como señal de "ya esta corriendo" -- pensado
    // para no chocar con una instancia de PM2 en una PC de desarrollo, pero el puerto 3000
    // puede estar ocupado por CUALQUIER cosa (otra copia de Monitor Pokemon con un token
    // distinto, otra app sin ninguna relacion) -- no hay forma de saber por que esta ocupado
    // solo mirando el puerto. Bug real 2026-08-20: esto bloqueaba "Start" en silencio, sin
    // ningun aviso, para cualquiera que tuviera otra cosa usando ese puerto. s4t.js ya sabe
    // reintentar con el siguiente puerto libre solo (ver iniciarServidorS4T) y avisar cual usó
    // realmente via "Ports in use.txt" (que este panel ya lee y muestra) -- no hace falta que
    // el panel adivine de antemano, alcanza con saber si ESTA copia especifica ya esta viva.
    bool EstaCorriendo() {
        return CorridoPorEstePanel();
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

    // "Kill Everything" (2026-08-06, a pedido explicito del usuario -- un
    // usuario real quedo con una ventana de actualizacion trabada en loop
    // infinito, sin ninguna forma de pararla desde la app, solo yendo a
    // Advanced\Quit Monitor Pokemon.bat a mano). A diferencia de "Stop"
    // (que solo mata el PID guardado en .monitor.lock, con /T para el arbol
    // de hijos), esto tambien caza el cmd.exe del _update.bat -- ese proceso
    // se lanza "detached" a proposito (para sobrevivir al cierre del launcher
    // durante una actualizacion), asi que /T nunca lo alcanza si ya quedo
    // huerfano. Se filtra por CommandLine conteniendo esta misma carpeta,
    // para no tocar ninguna otra ventana de cmd del usuario.
    void MatarTodo() {
        var confirmacion = MessageBox.Show(
            "This force-stops Monitor Pokemon completely (engine, panel, and any stuck update window), even if something is frozen.\n\nUse this if Stop/Restart don't work, or a black console window is stuck looping.\n\nContinue?",
            "Kill Everything",
            MessageBoxButtons.YesNo,
            MessageBoxIcon.Warning
        );
        if (confirmacion != DialogResult.Yes) return;

        try {
            var raizEscapada = raiz.Replace("'", "''");
            var script =
                "Get-Process MonitorPokemon,MonitorPokemonPanel -ErrorAction SilentlyContinue | Stop-Process -Force; " +
                "Get-CimInstance Win32_Process -Filter \"Name='cmd.exe'\" | " +
                "Where-Object { $_.CommandLine -and $_.CommandLine.Contains('" + raizEscapada + "') } | " +
                "ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }";
            var psi = new ProcessStartInfo("powershell", "-NoProfile -WindowStyle Hidden -Command \"" + script + "\"") {
                WindowStyle = ProcessWindowStyle.Hidden, UseShellExecute = false, CreateNoWindow = true
            };
            Process.Start(psi).WaitForExit();
        } catch (Exception ex) {
            MessageBox.Show("Could not kill everything: " + ex.Message, "Monitor Pokemon");
        }

        try { File.Delete(rutaLock); } catch { }
        try { File.Delete(Path.Combine(raiz, "_update.bat")); } catch { }
        try { File.Delete(rutaPendienteRestart); } catch { }
        try { File.Delete(Path.Combine(raiz, ".pending_update.json")); } catch { }

        MessageBox.Show("Done. Everything was force-stopped.\n\nIf a MonitorPokemon.new.exe file exists in this folder, an update was mid-way through - delete MonitorPokemon.exe and rename MonitorPokemon.new.exe to MonitorPokemon.exe before pressing Start again.", "Monitor Pokemon");
    }

    // "Repair Broken Files" (2026-08-21, a pedido explicito del usuario -- caso real en vivo:
    // un usuario tenia el .exe viejo corriendo desde una instalacion en OneDrive mientras las
    // imagenes de assets/ ya se habian actualizado solas, dejando un mix roto donde el codigo
    // empaquetado (viejo) buscaba archivos que ya no existian con ese nombre. Diagnosticar eso
    // a mano -- cerrar todo, bajar el .exe de nuevo, pisarlo -- le tomo un buen rato yendo y
    // viniendo por Discord. Este boton hace exactamente esos 3 pasos de una: mata todo lo que
    // este corriendo (mismo mecanismo que Kill Everything), pisa el .exe Y los assets con la
    // version mas nueva de GitHub Releases (mismas URLs "latest/download" ya usadas por
    // "Download Manually"), y prende todo de nuevo -- sin depender de que el chequeo normal de
    // actualizacion detecte que hace falta, ni de que el usuario sepa cual carpeta es la real.
    void RepararArchivosRotos() {
        var confirmacion = MessageBox.Show(
            "This force-stops everything, then re-downloads the app and its assets fresh from the latest release, overwriting anything in this folder (your saved token/settings are kept).\n\nUse this if something stays broken after a normal update (wrong icons, stale files) or you're not sure this is the right/only copy running.\n\nContinue?",
            "Repair Broken Files",
            MessageBoxButtons.YesNo,
            MessageBoxIcon.Warning
        );
        if (confirmacion != DialogResult.Yes) return;

        var raizEscapada = raiz.Replace("'", "''");
        try {
            var scriptMatar =
                "Get-Process MonitorPokemon,MonitorPokemonPanel -ErrorAction SilentlyContinue | Stop-Process -Force; " +
                "Get-CimInstance Win32_Process -Filter \"Name='cmd.exe'\" | " +
                "Where-Object { $_.CommandLine -and $_.CommandLine.Contains('" + raizEscapada + "') } | " +
                "ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }";
            var psiMatar = new ProcessStartInfo("powershell", "-NoProfile -WindowStyle Hidden -Command \"" + scriptMatar + "\"") {
                WindowStyle = ProcessWindowStyle.Hidden, UseShellExecute = false, CreateNoWindow = true
            };
            Process.Start(psiMatar).WaitForExit();
        } catch (Exception ex) {
            MessageBox.Show("Could not stop the running processes: " + ex.Message, "Monitor Pokemon");
            return;
        }

        try { File.Delete(rutaLock); } catch { }
        try { File.Delete(Path.Combine(raiz, "_update.bat")); } catch { }
        try { File.Delete(rutaPendienteRestart); } catch { }
        try { File.Delete(Path.Combine(raiz, ".pending_update.json")); } catch { }

        try {
            string tempAssets = Path.Combine(Path.GetTempPath(), "MonitorPokemon-assets-repair.zip");
            string tempExe = Path.Combine(Path.GetTempPath(), "MonitorPokemon-repair.exe");
            using (var client = new System.Net.WebClient()) {
                client.DownloadFile("https://github.com/AleCast09/Pokemon-Monitor-TCGP/releases/latest/download/MonitorPokemon-assets.zip", tempAssets);
                client.DownloadFile("https://github.com/AleCast09/Pokemon-Monitor-TCGP/releases/latest/download/MonitorPokemon.exe", tempExe);
            }

            var scriptExtraer = "Expand-Archive -Path '" + tempAssets.Replace("'", "''") + "' -DestinationPath '" + raizEscapada + "' -Force";
            var psiExtraer = new ProcessStartInfo("powershell", "-NoProfile -WindowStyle Hidden -Command \"" + scriptExtraer + "\"") {
                WindowStyle = ProcessWindowStyle.Hidden, UseShellExecute = false, CreateNoWindow = true
            };
            Process.Start(psiExtraer).WaitForExit();

            string exeDestino = Path.Combine(raiz, "MonitorPokemon.exe");
            File.Copy(tempExe, exeDestino, true);

            try { File.Delete(tempAssets); } catch { }
            try { File.Delete(tempExe); } catch { }

            // Bug real encontrado 2026-08-22: MonitorPokemon-assets.zip solo trae assets/ y
            // automation/ (ver generarAssetsZip en build-exe.js) -- version.json NUNCA viene
            // ahi, asi que sin esto el archivo local se quedaba con el numero de version
            // VIEJO despues de reparar, aunque el .exe y los assets ya fueran los nuevos de
            // verdad (el propio chequeo de "hay actualizacion" del bot se hubiera confundido
            // creyendo que seguia desactualizado).
            using (var client = new System.Net.WebClient()) {
                var jsonRemoto = client.DownloadString("https://raw.githubusercontent.com/AleCast09/Pokemon-Monitor-TCGP/main/version.json");
                File.WriteAllText(Path.Combine(raiz, "version.json"), jsonRemoto);
            }
        } catch (Exception ex) {
            MessageBox.Show("Everything was stopped, but the fresh download/repair failed: " + ex.Message + "\n\nCheck your internet connection and try again, or use \"Download Manually\" instead.", "Monitor Pokemon");
            return;
        }

        // Mismo aviso de "Sync Channels + re-guardar Main Path" que ya manda una actualizacion
        // normal (ver avisarPasosManualesTrasDescarga en update-checker.js) -- Repair hace su
        // PROPIA descarga en C#, sin pasar por esa funcion, asi que se dispara aparte con este
        // rol chico (scripts/notify-repair-done.js). No bloqueante (no importa si tarda o
        // falla en la red -- Start no debe esperar por esto).
        try {
            var psiAviso = new ProcessStartInfo {
                FileName = rutaExe,
                UseShellExecute = false,
                CreateNoWindow = true,
                WindowStyle = ProcessWindowStyle.Hidden,
                WorkingDirectory = raiz
            };
            psiAviso.EnvironmentVariables["MONITOR_ROLE"] = "notify_repair_done";
            Process.Start(psiAviso);
        } catch { }

        MessageBox.Show("Repair complete. Starting Monitor Pokemon...", "Monitor Pokemon");
        IniciarBot();
    }

    // "Quit" (2026-08-06, a pedido explicito del usuario): mismo comportamiento
    // que Advanced\Quit Monitor Pokemon.bat, ahora tambien como boton -- para
    // cuando el usuario ya termino de usarlo y no quiere que se abra solo la
    // proxima vez que prende la PC (a diferencia de Kill Everything, que es
    // para desatascar algo trabado sin dejar de usar el programa).
    void SalirDeMonitorPokemon() {
        var confirmacion = MessageBox.Show(
            "This stops Monitor Pokemon and turns off automatic startup with Windows.\n\nYour token and settings stay saved - you can open \"Start Monitor Pokemon.bat\" (in Advanced) anytime to use it again.\n\nContinue?",
            "Quit Monitor Pokemon",
            MessageBoxButtons.YesNo,
            MessageBoxIcon.Question
        );
        if (confirmacion != DialogResult.Yes) return;

        try {
            var rutaAcceso = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Startup), "Monitor Pokemon.lnk");
            var script =
                "Get-Process MonitorPokemon,MonitorPokemonPanel -ErrorAction SilentlyContinue | Stop-Process -Force; " +
                "Remove-Item -Path '" + rutaAcceso.Replace("'", "''") + "' -ErrorAction SilentlyContinue";
            var psi = new ProcessStartInfo("powershell", "-NoProfile -WindowStyle Hidden -Command \"" + script + "\"") {
                WindowStyle = ProcessWindowStyle.Hidden, UseShellExecute = false, CreateNoWindow = true
            };
            Process.Start(psi).WaitForExit();
        } catch (Exception ex) {
            MessageBox.Show("Could not quit: " + ex.Message, "Monitor Pokemon");
        }

        try { File.Delete(rutaLock); } catch { }

        MessageBox.Show("Monitor Pokemon is stopped and will no longer start automatically when Windows starts.\n\nYour token and settings are still saved.", "Monitor Pokemon");
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
    // Boton "Download Manually" agregado 2026-08-20 (bug real reportado en vivo): un usuario
    // con problemas de red no podia bajar la actualizacion ni con "Download Now" (la descarga
    // interna del programa, via axios) ni con "Open Discord Channel Instead" (esa solo abre
    // Discord, y el boton "Update now" DE ADENTRO de Discord dispara la MISMA descarga interna
    // que ya le fallaba -- ningun camino existente lo sacaba de esa descarga rota). Este boton
    // no depende del programa para nada, abre la pagina del release en el navegador de verdad
    // del usuario -- si su navegador SI puede bajar el zip (como le paso a el), esto lo
    // desbloquea aunque la descarga interna del programa nunca funcione en su red.
    const string URL_RELEASES = "https://github.com/AleCast09/Pokemon-Monitor-TCGP/releases/latest";

    void MostrarAvisoActualizacion(string versionActual, string versionNueva, string discordChannelUrl) {
        var dialogo = new Form {
            Text = "Update available",
            ClientSize = new Size(380, 235),
            FormBorderStyle = FormBorderStyle.FixedDialog,
            MaximizeBox = false,
            MinimizeBox = false,
            StartPosition = FormStartPosition.CenterScreen,
            BackColor = colorFondo
        };
        if (File.Exists(rutaIcono)) dialogo.Icon = new Icon(rutaIcono);

        // Icono grande del bot + texto "Monitor Pokemon" bien visible (2026-08-21, a pedido
        // explicito del usuario: dijo que el aviso pelado "Downloading..." le daba
        // desconfianza incluso A ELLA MISMA, con ganas de cerrarlo -- nada en pantalla
        // confirmaba de que programa era ni que seguia vivo). Reusa la misma imagen que ya
        // usa el logo chico de la ventana principal.
        if (File.Exists(rutaImagenPokemon)) {
            var iconoGrande = new PictureBox {
                Size = new Size(36, 36),
                Location = new Point(20, 16),
                SizeMode = PictureBoxSizeMode.Zoom,
                Image = Image.FromFile(rutaImagenPokemon),
                BackColor = colorFondo
            };
            dialogo.Controls.Add(iconoGrande);
        }
        var lblMarca = new Label {
            Text = "Monitor Pokemon",
            ForeColor = colorAcento,
            Font = new Font("Segoe UI", 10, FontStyle.Bold),
            Location = new Point(62, 22),
            AutoSize = true
        };
        dialogo.Controls.Add(lblMarca);

        var lbl = new Label {
            Text = "A new version is available: v" + versionNueva + " (you have v" + versionActual + ").",
            ForeColor = colorTexto,
            Font = new Font("Segoe UI", 9),
            Location = new Point(20, 56),
            Size = new Size(340, 30)
        };
        dialogo.Controls.Add(lbl);

        var btnDescargar = new Button {
            Text = "Download Now",
            Size = new Size(340, 34),
            Location = new Point(20, 95),
            FlatStyle = FlatStyle.Flat,
            Cursor = Cursors.Hand
        };
        AplicarEstiloPrimario(btnDescargar);
        dialogo.Controls.Add(btnDescargar);

        var btnManual = new Button {
            Text = "Download Manually (opens browser)",
            Size = new Size(340, 34),
            Location = new Point(20, 137),
            FlatStyle = FlatStyle.Flat,
            BackColor = colorSuperficie2,
            ForeColor = colorTexto,
            Cursor = Cursors.Hand
        };
        btnManual.FlatAppearance.BorderColor = colorBorde;
        dialogo.Controls.Add(btnManual);

        var btnDiscord = new Button {
            Text = "Open Discord Channel Instead",
            Size = new Size(340, 34),
            Location = new Point(20, 179),
            FlatStyle = FlatStyle.Flat,
            BackColor = colorSuperficie2,
            ForeColor = colorTexto,
            Cursor = Cursors.Hand
        };
        btnDiscord.FlatAppearance.BorderColor = colorBorde;
        dialogo.Controls.Add(btnDiscord);

        // Barra de progreso real + estado en texto (2026-08-21, a pedido explicito del
        // usuario) -- ocupa el mismo lugar que btnDescargar, oculta hasta que empieza la
        // descarga de verdad. Antes esto se quedaba con el texto pelado "Downloading..."
        // sin ningun avance visible durante el minuto+ que puede tardar el .exe (~100MB).
        var barraProgreso = new ProgressBar {
            Location = new Point(20, 95),
            Size = new Size(340, 22),
            Minimum = 0,
            Maximum = 100,
            Value = 0,
            Style = ProgressBarStyle.Continuous,
            Visible = false
        };
        dialogo.Controls.Add(barraProgreso);
        var lblProgreso = new Label {
            Text = "Downloading Monitor Pokemon update...",
            ForeColor = colorTexto,
            Font = new Font("Segoe UI", 8),
            Location = new Point(20, 120),
            Size = new Size(340, 18),
            TextAlign = ContentAlignment.MiddleCenter,
            Visible = false
        };
        dialogo.Controls.Add(lblProgreso);

        AplicarTemaBarraTitulo(dialogo.Handle);

        btnManual.Click += (s, e) => {
            try { Process.Start(new ProcessStartInfo { FileName = URL_RELEASES, UseShellExecute = true }); } catch { }
            dialogo.Close();
        };

        btnDiscord.Click += (s, e) => {
            var destino = !string.IsNullOrEmpty(discordChannelUrl) ? discordChannelUrl : "https://discord.com/app";
            try { Process.Start(new ProcessStartInfo { FileName = destino, UseShellExecute = true }); } catch { }
            dialogo.Close();
        };

        btnDescargar.Click += (s, e) => {
            btnManual.Enabled = false;
            btnDiscord.Enabled = false;
            btnDescargar.Visible = false;
            barraProgreso.Visible = true;
            lblProgreso.Visible = true;
            DescargarActualizacionDesdePanel(dialogo, barraProgreso, lblProgreso);
        };

        dialogo.ShowDialog(this);
    }

    // Async (2026-08-21, a pedido explicito del usuario -- ver el comentario largo en
    // MostrarAvisoActualizacion) para poder leer la salida del proceso hijo LINEA POR LINEA a
    // medida que llega (antes: ReadToEnd() bloqueante, esperaba TODA la salida junta al final,
    // asi que no habia forma de mostrar progreso en vivo aunque update-checker.js lo mandara).
    // Las lineas "PROGRESS:<n>" (ver descargarActualizacion en update-checker.js) actualizan
    // la barra; la ultima linea (JSON real) es el resultado final, igual que antes.
    async void DescargarActualizacionDesdePanel(Form dialogo, ProgressBar barra, Label lblEstado) {
        var lineasSalida = new List<string>();
        string ultimaLineaJson = null;
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
            var proc = new Process { StartInfo = psi, EnableRaisingEvents = true };
            var tcsSalida = new TaskCompletionSource<bool>();
            proc.OutputDataReceived += (s, e) => {
                if (e.Data == null) return;
                lineasSalida.Add(e.Data);
                if (e.Data.StartsWith("PROGRESS:")) {
                    int porcentaje;
                    if (int.TryParse(e.Data.Substring(9), out porcentaje)) {
                        porcentaje = Math.Max(0, Math.Min(100, porcentaje));
                        try {
                            barra.Invoke((Action)(() => {
                                barra.Value = porcentaje;
                                lblEstado.Text = "Downloading Monitor Pokemon update... " + porcentaje + "%";
                            }));
                        } catch { }
                    }
                } else {
                    ultimaLineaJson = e.Data;
                }
            };
            proc.Exited += (s, e) => tcsSalida.TrySetResult(true);
            proc.Start();
            proc.BeginOutputReadLine();

            var completado = await Task.WhenAny(tcsSalida.Task, Task.Delay(120000));
            if (completado != tcsSalida.Task) {
                try { proc.Kill(); } catch { }
                throw new Exception("Timed out waiting for the update process.");
            }

            var serializer = new JavaScriptSerializer();
            var resultado = serializer.Deserialize<Dictionary<string, object>>(ultimaLineaJson);
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
                MessageBox.Show("Could not download the update. Close this and use \"Download Manually\" instead, or try the Discord channel.", "Monitor Pokemon");
            }
        } catch (Exception ex) {
            dialogo.Close();
            // Si lo que imprimió el proceso hijo no era JSON válido, el mensaje del
            // parser solo (ex.Message) no dice nada útil para diagnosticar a
            // distancia — se muestra también la salida cruda (recortada) para que,
            // si esto le pasa a otro usuario, la captura que mande tenga la pista
            // real en vez de solo "Invalid JSON primitive".
            var salidaCompleta = string.Join("\n", lineasSalida);
            var detalle = !string.IsNullOrEmpty(salidaCompleta) ? salidaCompleta.Substring(0, Math.Min(300, salidaCompleta.Length)) : "(no output)";
            MessageBox.Show("Could not download the update: " + ex.Message + "\n\nProcess output: " + detalle, "Monitor Pokemon");
        }
    }

    // ---------- UI ----------

    void ConstruirUI() {
        Text = "Monitor Pokemon";
        ClientSize = new Size(650, 546);
        FormBorderStyle = FormBorderStyle.FixedSingle;
        MaximizeBox = false;
        StartPosition = FormStartPosition.CenterScreen;
        BackColor = colorFondo;
        if (File.Exists(rutaIcono)) Icon = new Icon(rutaIcono);

        // Columna izquierda: Control y S4T/Heartbeat en sus propias tarjetas
        // redondeadas ajustadas al contenido; el logo+version va suelto abajo, sin borde.
        // El titulo de cada tarjeta ahora va ADENTRO (arriba a la izquierda), no encima
        // del borde -- por eso el contenido de cada una arranca 40px mas abajo que antes.
        var seccionControl = NuevaSeccion("CONTROL", 15, 15, 260, 283, colorSeccionControl);
        var seccionPuertos = NuevaSeccion("S4T / HEARTBEAT", 15, 308, 260, 157, colorSeccionDiscord);
        var seccionDiscord = NuevaSeccion("DISCORD", 290, 15, 345, 332, colorSeccionDiscord);

        labelEstado = new Label { Font = new Font("Segoe UI", 10), AutoSize = true, Location = new Point(30, 55), ForeColor = colorTexto };
        Controls.Add(labelEstado);

        botonIniciar = NuevoBoton("Start", 30, 79, 225);
        botonIniciar.Click += (s, e) => { IniciarBot(); System.Threading.Thread.Sleep(500); RefrescarEstado(); };
        botonApagar = NuevoBoton("Stop", 30, 121, 225);
        botonApagar.Click += (s, e) => { ApagarBot(); startHabilitado = false; System.Threading.Thread.Sleep(500); RefrescarEstado(); };
        botonReiniciar = NuevoBoton("Restart", 30, 163, 225);
        botonReiniciar.Click += (s, e) => { ReiniciarBot(); startHabilitado = true; System.Threading.Thread.Sleep(500); RefrescarEstado(); };

        var botonMatarTodo = NuevoBoton("🔴 Kill Everything", 30, 205, 135);
        AplicarEstiloPeligro(botonMatarTodo);
        botonMatarTodo.Click += (s, e) => { MatarTodo(); startHabilitado = false; System.Threading.Thread.Sleep(500); RefrescarEstado(); };
        var botonSalir = NuevoBoton("Quit", 170, 205, 85);
        botonSalir.Click += (s, e) => { SalirDeMonitorPokemon(); System.Threading.Thread.Sleep(500); RefrescarEstado(); };

        var botonReparar = NuevoBoton("🔧 Repair Broken Files", 30, 247, 225);
        AplicarEstiloPeligro(botonReparar);
        botonReparar.Click += (s, e) => { RepararArchivosRotos(); startHabilitado = true; System.Threading.Thread.Sleep(500); RefrescarEstado(); };

        NuevoTitulo("S4T (paste in P BOT)", 30, 348);
        txtS4t = NuevoCampo(30, 368, 225);
        HacerCopiableAlClick(txtS4t);
        NuevoTitulo("Heartbeat (paste in P BOT)", 30, 405);
        txtHeartbeat = NuevoCampo(30, 425, 225);
        HacerCopiableAlClick(txtHeartbeat);

        var pictureBox = new PictureBox { Size = new Size(46, 46), Location = new Point(30, 480), SizeMode = PictureBoxSizeMode.Zoom, BackColor = colorFondo };
        if (File.Exists(rutaImagenPokemon)) pictureBox.Image = Image.FromFile(rutaImagenPokemon);
        Controls.Add(pictureBox);
        pictureBox.BringToFront();

        labelVersion = new Label { Text = "Monitor Pokemon", Font = new Font("Segoe UI", 9, FontStyle.Bold), ForeColor = colorAcento, AutoSize = true, MaximumSize = new Size(180, 0), Location = new Point(85, 496) };
        Controls.Add(labelVersion);
        labelVersion.BringToFront();

        NuevoTitulo("Token", 305, 55);
        txtToken = NuevoCampo(305, 75, 315);
        labelTokenEstado = NuevaEtiquetaInfo(305, 103);

        NuevoTitulo("Google Drive API Key", 305, 135);
        txtApi = NuevoCampo(305, 155, 315);
        labelApiEstado = NuevaEtiquetaInfo(305, 183);

        botonAbrirConfig = NuevoBoton("Open Token / API Settings", 305, 215, 315);
        botonAbrirConfig.Click += (s, e) => {
            try {
                Process.Start(new ProcessStartInfo { FileName = rutaReconfigureBat, WorkingDirectory = raiz, UseShellExecute = true });
            } catch (Exception ex) {
                MessageBox.Show("Could not open configuration: " + ex.Message, "Monitor Pokemon");
            }
        };

        labelBotNombre = NuevaEtiquetaInfo(305, 267);
        labelServidorNombre = NuevaEtiquetaInfo(305, 290);
        labelUsuarioNombre = NuevaEtiquetaInfo(305, 313);

        // Cuarta tarjeta (2026-08-08, a pedido explicito del usuario: los 3 iconos
        // circulares de abajo confundian -- el de "?" encima era un placeholder de Notion
        // que nunca se reemplazo. Ahora son botones normales con texto, mismo estilo que
        // el resto del panel, y el link de Tutorials abre la pagina real (no el placeholder).
        var seccionMas = NuevaSeccion("MORE", 290, 362, 345, 100, colorSeccionDiscord);
        var botonTutoriales = NuevoBoton("📚 Tutorials", 305, 397, 150);
        botonTutoriales.Click += (s, e) => {
            // Puerto leido de panel-info.js en vez de hardcodeado (2026-08-13, bug real
            // encontrado en auditoria): si esta PC tiene DASHBOARD_PORT distinto en el .env,
            // el boton abria una pagina muerta. infoDiscord puede ser null si panel-info.js
            // todavia no corrio -- 3005 queda de fallback para ese caso.
            var url = (infoDiscord != null && !string.IsNullOrEmpty(infoDiscord.tutorialsUrl)) ? infoDiscord.tutorialsUrl : "http://localhost:3005/tutorials";
            try { Process.Start(new ProcessStartInfo { FileName = url, UseShellExecute = true }); } catch { }
        };
        var botonDonar = NuevoBoton("☕ Support (Ko-fi)", 465, 397, 155);
        botonDonar.Click += (s, e) => {
            try { Process.Start(new ProcessStartInfo { FileName = "https://ko-fi.com/alecast", UseShellExecute = true }); } catch { }
        };

        // Toggle dia/noche (reubicado 2026-08-08 -- antes vivia en la fila de iconos que
        // se saco de abajo): un icono chico en la esquina, discreto, no un boton principal.
        // Letra ASCII simple, no emoji -- los emoji a color salen como icono roto en este
        // Label (GDI+ clasico), a diferencia de un Button normal que si los renderiza bien.
        NuevoIconoAccion(temaOscuro ? "L" : "D", "Switch to " + (temaOscuro ? "light" : "dark") + " mode", (s, e) => ToggleTema(), 605, 15, 30);

        AplicarTemaBarraTitulo(this.Handle);
    }

    // Tarjeta redondeada (2026-08-07): antes era una caja rectangular con el
    // titulo cortando el borde de arriba (estilo GroupBox clasico) -- ahora es
    // una superficie con esquinas redondeadas de verdad (Region recortada con
    // GraphicsPath) y el titulo va ADENTRO, arriba a la izquierda, como en la
    // referencia visual que uso el usuario. El contenido (botones/campos) se
    // sigue agregando aparte, directo al Form -- la tarjeta es solo el fondo.
    GraphicsPath RutaRedondeada(int w, int h, int radio) {
        var path = new GraphicsPath();
        int d = radio * 2;
        path.AddArc(0, 0, d, d, 180, 90);
        path.AddArc(Math.Max(0, w - d), 0, d, d, 270, 90);
        path.AddArc(Math.Max(0, w - d), Math.Max(0, h - d), d, d, 0, 90);
        path.AddArc(0, Math.Max(0, h - d), d, d, 90, 90);
        path.CloseFigure();
        return path;
    }

    Panel NuevaSeccion(string titulo, int x, int y, int ancho, int alto, Color colorTitulo) {
        const int radio = 16;
        var panel = new Panel { Location = new Point(x, y), Size = new Size(ancho, alto), BackColor = colorSuperficie };
        using (var region = RutaRedondeada(ancho, alto, radio)) {
            panel.Region = new Region(region);
        }
        panel.Paint += (s, e) => {
            e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
            using (var borde = RutaRedondeada(panel.Width - 1, panel.Height - 1, radio))
            using (var pen = new Pen(colorBorde, 1)) {
                e.Graphics.DrawPath(pen, borde);
            }
        };
        Controls.Add(panel);

        var lbl = new Label {
            Text = titulo,
            Font = new Font("Segoe UI", 8, FontStyle.Bold),
            ForeColor = colorTitulo,
            BackColor = Color.Transparent,
            AutoSize = true,
            Location = new Point(x + 16, y + 13)
        };
        Controls.Add(lbl);
        lbl.BringToFront();
        return panel;
    }

    void AplicarEstiloPrimario(Button b) {
        b.BackColor = colorAcento;
        b.ForeColor = Color.FromArgb(26, 18, 4);
        b.FlatAppearance.BorderColor = colorAcento;
        b.FlatAppearance.MouseOverBackColor = ControlPaint.Light(colorAcento, 0.15f);
        b.FlatAppearance.MouseDownBackColor = ControlPaint.Dark(colorAcento, 0.1f);
    }

    void AplicarEstiloPeligro(Button b) {
        b.ForeColor = colorPeligro;
        b.FlatAppearance.BorderColor = colorPeligro;
    }

    Button NuevoBoton(string texto, int x, int y, int ancho) {
        const int radio = 10;
        var boton = new Button {
            Text = texto,
            Size = new Size(ancho, 36),
            Location = new Point(x, y),
            Font = new Font("Segoe UI", 10),
            FlatStyle = FlatStyle.Flat,
            BackColor = colorBotonFondo,
            ForeColor = colorBotonTexto,
            Cursor = Cursors.Hand
        };
        boton.FlatAppearance.BorderSize = 0; // el borde redondeado se dibuja a mano abajo, no con el borde recto nativo
        boton.FlatAppearance.MouseOverBackColor = ColorHover(colorBotonFondo);
        boton.FlatAppearance.MouseDownBackColor = ColorPresionado(colorBotonFondo);
        using (var region = RutaRedondeada(ancho, 36, radio)) {
            boton.Region = new Region(region);
        }
        boton.Paint += (s, e) => {
            e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
            using (var borde = RutaRedondeada(boton.Width - 1, boton.Height - 1, radio))
            using (var pen = new Pen(colorBorde, 1)) {
                e.Graphics.DrawPath(pen, borde);
            }
        };
        Controls.Add(boton);
        boton.BringToFront();
        return boton;
    }

    const int RADIO_CAMPO = 8;

    // TextBox es un control nativo de Windows -- ponerle Region propia para redondearlo
    // resulto poco confiable (el borde dibujado aparte quedaba desalineado y se veia
    // cortado en un lado, bug real visto en captura). Patron mas solido: un Panel propio
    // (SI se redondea bien, ver NuevaSeccion) hace de fondo+borde, y el TextBox va METIDO
    // adentro con un margen chico y sin su propio borde -- sus esquinas rectas quedan
    // siempre dentro del area redondeada del panel, nunca asoman.
    TextBox NuevoCampo(int x, int y, int ancho) {
        int alto = 24;
        var contenedor = new Panel { Location = new Point(x, y), Size = new Size(ancho, alto), BackColor = colorSuperficie2 };
        using (var region = RutaRedondeada(ancho, alto, RADIO_CAMPO)) {
            contenedor.Region = new Region(region);
        }
        contenedor.Paint += (s, e) => {
            e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
            using (var borde = RutaRedondeada(contenedor.Width - 1, contenedor.Height - 1, RADIO_CAMPO))
            using (var pen = new Pen(colorBorde, 1)) {
                e.Graphics.DrawPath(pen, borde);
            }
        };
        Controls.Add(contenedor);
        contenedor.BringToFront();

        var txt = new TextBox {
            Location = new Point(3, 2),
            Size = new Size(Math.Max(10, ancho - 6), alto - 4),
            ReadOnly = true,
            BorderStyle = BorderStyle.None,
            BackColor = colorSuperficie2,
            ForeColor = colorAcento,
            Font = new Font("Consolas", 10),
            Tag = contenedor // referencia al panel contenedor, usada por AjustarAnchoAlTexto
        };
        contenedor.Controls.Add(txt);
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
        int anchoContenedor = medida.Width + 14;
        var contenedor = txt.Tag as Panel;
        if (contenedor != null) {
            contenedor.Width = anchoContenedor;
            using (var region = RutaRedondeada(contenedor.Width, contenedor.Height, RADIO_CAMPO)) {
                contenedor.Region = new Region(region);
            }
            contenedor.Invalidate();
        }
        txt.Width = Math.Max(10, anchoContenedor - 6);
    }

    // Icono circular chico que dispara una accion propia (no una URL) -- usado para el
    // toggle de tema dia/noche.
    Panel NuevoIconoAccion(string texto, string tooltipTexto, EventHandler alClick, int x, int y, int tamano) {
        var contenedor = new Panel {
            Size = new Size(tamano, tamano),
            Location = new Point(x, y),
            BackColor = colorBotonFondo,
            Cursor = Cursors.Hand
        };
        using (var region = RutaRedondeada(tamano, tamano, tamano / 2)) {
            contenedor.Region = new Region(region);
        }
        var tooltip = new ToolTip();
        tooltip.SetToolTip(contenedor, tooltipTexto);
        contenedor.Click += alClick;
        EventHandler resaltar = (s, e) => contenedor.BackColor = ColorHover(colorBotonFondo);
        EventHandler apagar = (s, e) => contenedor.BackColor = colorBotonFondo;
        contenedor.MouseEnter += resaltar;
        contenedor.MouseLeave += apagar;
        var lbl = new Label {
            Text = texto,
            Dock = DockStyle.Fill,
            Font = new Font("Segoe UI", (float)(tamano / 3.0), FontStyle.Bold),
            ForeColor = colorBotonTexto,
            BackColor = Color.Transparent,
            TextAlign = ContentAlignment.MiddleCenter,
            Enabled = false
        };
        contenedor.Controls.Add(lbl);
        Controls.Add(contenedor);
        contenedor.BringToFront();
        return contenedor;
    }

    // Alterna toda la paleta y reconstruye la UI entera desde cero con los colores
    // nuevos -- mas simple y confiable que ir a buscar cada control ya creado para
    // recolorearlo a mano, y esta ventana no tiene tantos controles como para que
    // reconstruirla entera se note lento.
    void ToggleTema() {
        var controlesViejos = Controls.Cast<Control>().ToList();
        Controls.Clear();
        foreach (var c in controlesViejos) c.Dispose();
        AplicarPaleta(!temaOscuro);
        ConstruirUI();
        RefrescarEstado();
        PintarInfoDiscord();
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
        botonIniciar.Enabled = startHabilitado;

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
                arranqueAutoIntentado = false;
                horaCambioDetectado = DateTime.Now;
            }
        }

        if (enTransicion) {
            // Bug real (2026-08-08, reproducido en vivo): si el motor todavia NUNCA se
            // habia arrancado (instalacion recien descomprimida, se guarda el token antes
            // de tocar "Start"), el .env cambia igual pero no hay ningun proceso vivo que
            // vaya a notar ".pending_restart.json" -- se quedaba mostrando "restarting..."
            // para siempre, sin arrancar nada nunca. Si detectamos que no esta corriendo,
            // arrancamos directo (una sola vez por cambio) en vez de esperar un reinicio
            // que nunca va a pasar solo.
            if (!corriendo && !arranqueAutoIntentado) {
                arranqueAutoIntentado = true;
                IniciarBot();
                // Arranco solo (instalacion recien descomprimida, nunca hubo un "Restart" para
                // apretar) -- cuenta igual como el (re)arranque legitimo que desbloquea "Start".
                startHabilitado = true;
            }
            labelTokenEstado.Text = corriendo ? "Token changed - restarting..." : "Token saved - starting...";
            labelTokenEstado.ForeColor = Color.FromArgb(240, 170, 60);
            labelApiEstado.Text = corriendo ? "Restarting..." : "Starting...";
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

        // Bug real reportado en vivo 2026-08-21: a este ProcessStartInfo le faltaba
        // WindowStyle = Hidden (las otras ventanas ocultas del proyecto, ej. MatarTodo,
        // siempre lo llevan junto con CreateNoWindow) -- sin el, un usuario vio la consola
        // de "ping 127.0.0.1 -n 2" real en pantalla cada vez que se reemplazaba el panel.
        Process.Start(new ProcessStartInfo {
            FileName = "cmd.exe",
            Arguments = "/c \"" + rutaBat + "\"",
            WorkingDirectory = raizBase,
            UseShellExecute = false,
            CreateNoWindow = true,
            WindowStyle = ProcessWindowStyle.Hidden
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
