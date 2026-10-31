#!/bin/sh
# Double-click in Finder: starts the Knitting Taxonomy desk reader in a Terminal window (close it to stop).
cd "$(dirname "$0")" && exec python3 taxonomy_reader.py
