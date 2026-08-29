#!/usr/bin/env bash
# Downloads a California map extract from Geofabrik (free, no signup, no API key).
# This is a big file (~800MB+) covering the whole state — we clip it down to just
# our neighborhood in the next script (02_import_to_postgis.sh).
set -euo pipefail

mkdir -p raw-data

# -L: follow redirects (Geofabrik's "-latest" URL redirects to a dated filename)
# -f: fail loudly on HTTP errors instead of saving the error page as if it were the file
curl -L -f -o raw-data/california-latest.osm.pbf \
  https://download.geofabrik.de/north-america/us/california-latest.osm.pbf

echo "Downloaded raw-data/california-latest.osm.pbf"
