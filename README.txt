MONITOR POKÉMON — HOW TO INSTALL
==================================

1. Right click on the .zip you downloaded → "Extract All..."
   (IMPORTANT: don't open it with a double click to "look inside" —
   you need to EXTRACT it to a folder first, or you'll lose files).

2. Go into the folder where you extracted it.

3. If Windows shows you a security warning when opening something (SmartScreen
   or "Smart App Control"):
   - Open the "Advanced" folder → "Unblock.bat" (let it finish, it closes
     itself). Then try again with step 4.

   IF "Unblock.bat" IS ALSO BLOCKED:
   a) Inside the main folder (on empty space), hold down SHIFT
      and right click → "Open PowerShell window here"
      (or "Open in Terminal").
   b) Paste this line and press Enter:
      Get-ChildItem -Recurse -Force | Unblock-File
   c) Close that window and try again with step 4.

4. Open "Open Control Panel.bat". A window called "Monitor Pokemon" opens
   with buttons — click "Iniciar" (Start). After a few seconds your browser
   will open asking for your Discord token — follow the instructions there.

5. If you accidentally open the panel twice, nothing bad happens — it
   detects it's already open and just brings up the same window again.

6. Want to change the token or add the Google Drive API key later? Open the
   panel and click "Open Api y token change" — it works even while the
   program is already running.

7. Once it starts for the first time, Monitor Pokémon registers itself to
   start automatically every time you turn on your PC — the control panel
   opens by itself, no need to open anything by hand again.

8. Don't want to use it anymore? Click "Apagar" (Stop) in the panel — it
   closes everything running in the background without deleting your token
   or settings. Click "Iniciar" again anytime to use it again. If you want
   to also turn off the automatic start completely, use the "Advanced"
   folder → "Quit Monitor Pokemon.bat" instead.

Something not working? Let whoever gave you this know.
