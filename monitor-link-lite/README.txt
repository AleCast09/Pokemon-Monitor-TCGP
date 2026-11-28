Monitor Link Lite (Mac / Linux / Windows) - Zenith Rise

For members who don't use Windows or PTCGPB. Your own bot keeps working as always:
this only connects your accounts and proxies to the community.

1) Put both files in one folder: monitor_link_lite.py and "Monitor Link Lite.command".
2) Mac, first time only: open Terminal in that folder and run
      chmod +x "Monitor Link Lite.command"
   Then double-click "Monitor Link Lite.command" (if macOS blocks it: right-click > Open).
3) Answer the questions:
   - Link key: type /link in Zenith Rise and paste the ML2-... key.
   - Accounts: the folder or the SQLite .db file where your bot saves the accounts.
   - Lend accounts to the GP farm: y/n.
   - Proxy list file (optional) and your Main friend ID (optional).
4) Keep the window open. Closing it = hosts can't use your accounts until you open it again.

Change the settings later:  python3 monitor_link_lite.py --setup

Important:
- Your accounts are never saved on any host. A host asks for one only when it opens packs and deletes it after.
- Don't let your bot and a host use the same account at the same time (the game kicks one of them).
  If you lend accounts, lend ones your bot is not playing right now.
- Settings and logs: ~/.monitor_link_lite/  (reroll_log.txt shows what the hosts opened)
- SQLite: it finds the table with the account + password columns by itself. If it doesn't, add to
  ~/.monitor_link_lite/config.json:  "sqlite_table", "sqlite_account_col", "sqlite_password_col"
