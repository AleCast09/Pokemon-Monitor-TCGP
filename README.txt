MONITOR POKÉMON — HOW TO INSTALL
==================================

1. Right click on the .zip you downloaded → "Extract All..."
   (IMPORTANT: don't open it with a double click to "look inside" —
   you need to EXTRACT it to a folder first, or you'll lose files).

2. Go into the folder where you extracted it.

3. If Windows shows you a security warning when opening something (SmartScreen
   or "Smart App Control"):
   - Open "Unblock.bat" first (let it finish, it closes itself).
   - Then try again with "Start Monitor Pokemon.bat".

   IF "Unblock.bat" IS ALSO BLOCKED:
   a) Inside the folder (on empty space), hold down SHIFT
      and right click → "Open PowerShell window here"
      (or "Open in Terminal").
   b) Paste this line and press Enter:
      Get-ChildItem -Recurse -Force | Unblock-File
   c) Close that window and try again with "Start Monitor Pokemon.bat".

4. Open "Start Monitor Pokemon.bat". After a few seconds your browser will
   open asking for your Discord token — follow the instructions there.

   Nothing opened? A new file called "Open configuration.url" will appear
   in the same folder — double click it to open the page yourself.

5. If you accidentally open it twice, nothing bad happens — the program
   detects it's already open and won't start a second copy.

6. Want to change the token or add the Google Drive API key later? Open
   "Reconfigure.bat" — it works even while the program is already running,
   and opens in the same browser with the same shortcut fallback if needed.

7. Once it starts for the first time, Monitor Pokémon registers itself to
   start automatically every time you turn on your PC — no need to open it
   by hand again, not even after restarting Windows.

Something not working? Let whoever gave you this know.
