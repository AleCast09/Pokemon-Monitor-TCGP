#!/bin/bash
# Double-click on a Mac to open Monitor Link Lite (keep this window open while you want to be linked).
cd "$(dirname "$0")"
if ! command -v python3 >/dev/null 2>&1; then
  echo "Python 3 is not installed. Install it from https://www.python.org/downloads/ and open this again."
  read -r -p "Press Enter to close..."
  exit 1
fi
python3 monitor_link_lite.py "$@"
read -r -p "Press Enter to close..."
