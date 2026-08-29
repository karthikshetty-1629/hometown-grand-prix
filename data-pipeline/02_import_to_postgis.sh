#!/usr/bin/env bash
# Clips the statewide extract down to a small bounding box (Downtown San Jose / SJSU),
# then imports just that area into the local PostGIS database.
#
# Requires: osmium-tool (`brew install osmium-tool`), osm2pgsql (`brew install osm2pgsql`)
# Requires: `docker compose up -d` already running (see repo root README).
set -euo pipefail

BBOX="-121.895,37.330,-121.870,37.345"
DB_URL="postgresql://dev:dev@localhost:5433/hometown_gp"

osmium extract -b "$BBOX" \
  raw-data/california-latest.osm.pbf -o raw-data/sjsu-area.osm.pbf --overwrite

# hstore extension + --hstore flag: captures every OSM tag into a catch-all `tags` column,
# not just the fixed set osm2pgsql's default style pulls into real columns (building,
# highway, shop, amenity, ...). This is what lets 04_extract_buildings.py (and any future
# script) read tags like building:levels, height, lanes, maxspeed on demand.
psql "$DB_URL" -c "CREATE EXTENSION IF NOT EXISTS hstore;"

osm2pgsql -d "$DB_URL" \
  --create --slim --hstore \
  -C 2000 \
  raw-data/sjsu-area.osm.pbf

echo "Imported sjsu-area.osm.pbf into PostGIS (planet_osm_line, planet_osm_polygon, ...)"
