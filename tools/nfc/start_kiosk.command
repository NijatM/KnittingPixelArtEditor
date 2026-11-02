#!/bin/sh
# Double-click in Finder: starts the Knitting Taxonomy exhibition kiosk (local site, reader, Chrome full screen) in a
# Terminal window. Build the site once first ("npm run build" in the repository). cmd-Q leaves Chrome; close this
# window to stop the reader and the local site.
cd "$(dirname "$0")" && exec python3 taxonomy_reader.py kiosk
