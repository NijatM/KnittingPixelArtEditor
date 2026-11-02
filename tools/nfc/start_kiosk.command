#!/bin/sh
# Double-click in Finder: starts the Knitting Taxonomy exhibition kiosk (local site, reader, Chrome full screen) in a
# Terminal window. Build the site once first ("npm run build" in the repository). The window stays open for commands
# (type help: test tags, the reader's state, reload, close, quit); quit there, or close the window, to stop.
cd "$(dirname "$0")" && exec python3 taxonomy_reader.py kiosk
