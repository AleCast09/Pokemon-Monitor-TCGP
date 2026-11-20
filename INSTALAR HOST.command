#!/bin/bash
# Host de la comunidad (Zenith Rise) en Mac: lo mismo que "INSTALAR HOST.bat" en Windows.
# Revisa Node.js 22+, instala los componentes y PM2, y abre el asistente (host-setup.js).
# Si macOS no lo deja abrir con doble clic, en Terminal:  bash "INSTALAR HOST.command"
cd "$(dirname "$0")" || exit 1
echo "Monitor Pokemon - Community host setup (Mac)"
echo

if ! command -v node >/dev/null 2>&1 || ! node -e "process.exit(Number(process.versions.node.split('.')[0]) < 22 ? 1 : 0)"; then
    echo "Node.js 22 or newer is needed."
    echo "Install the LTS version from https://nodejs.org (or: brew install node) and run this file again."
    read -r -p "Press Enter to close..."
    exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
    echo "Python 3 is needed for Miguel's bot."
    echo "Install it from https://www.python.org (or: brew install python) and run this file again."
    read -r -p "Press Enter to close..."
    exit 1
fi

echo "Installing the bot's components (the first time takes a few minutes)..."
if ! npm install --omit=dev --no-audit --no-fund; then
    echo "Could not install the components. Check your internet connection and try again."
    read -r -p "Press Enter to close..."
    exit 1
fi

if ! command -v pm2 >/dev/null 2>&1; then
    echo "Installing PM2 - keeps the bot running in the background..."
    npm install -g pm2 || sudo npm install -g pm2
fi

echo
node host-setup.js
echo
read -r -p "Press Enter to close..."
