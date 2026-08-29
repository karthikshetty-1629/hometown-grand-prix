# Hometown Grand Prix (MVP, Local-Only)

A driving game where the track is generated from **real street layout and building shapes** of an
actual neighborhood (starting area: Downtown San Jose / SJSU). On load, you pick a start and end
point on a schematic of the real street network, and the game builds a race route between them
through the actual roads. You drive a low-poly car in a chase-cam 3D scene. Your run is saved
locally, and a friend can later race against your saved path as a translucent "ghost" car.

This is v0.1 — everything runs on your own machine. No cloud storage, no paid APIs, no live
multiplayer. See `docs/build-spec.md` for the full original spec this repo was scaffolded from.

## What's in this repo

```
hometown-grand-prix/
├── data-pipeline/   # one-time offline scripts: OSM data -> track + building chunk JSON
├── server/          # local Express API that serves chunks and stores ghost runs
├── client/          # the playable Babylon.js web game
└── docs/            # schema + spec reference
```

## Prerequisites (install these once)

- **Docker Desktop** — runs the local PostgreSQL + PostGIS database in a container
- **Node.js** (v18+) — runs the server and the client dev build
- **Python 3** (3.10+) — runs the data pipeline scripts
- **osmium-tool** — clips the big California map file down to just our neighborhood
  - macOS: `brew install osmium-tool`
- **osm2pgsql** — imports the clipped map data into PostGIS
  - macOS: `brew install osm2pgsql`

No accounts, no API keys, no payment info needed anywhere in this build.

## First-time setup, in order

```bash
# 1. Start the local database (runs on host port 5433, not 5432, in case you already
#    have another Postgres running locally)
docker compose up -d

# 2. Run the data pipeline once, to pull the SJSU area's roads + buildings
cd data-pipeline
pip install -r requirements.txt
bash 01_download_extract.sh      # ~1GB one-time download from Geofabrik
bash 02_import_to_postgis.sh
python3 03_build_road_graph.py
python3 04_extract_buildings.py
python3 05_extract_footpaths.py   # sidewalks/paths, rendered as a placement-check reference
python3 06_generate_track.py      # generates one default loop (fallback track)
python3 07_export_chunk.py        # exports that default loop as a playable chunk
python3 08_copy_world_data.py     # publishes the road network + buildings + footpaths for live route picking

# 3. Start the local API server
cd ../server
npm install
node index.js
# -> http://localhost:3001

# 4. Start the client (in a new terminal)
cd ../client
npm install
npm run dev
# -> http://localhost:5173
```

Open the client URL in a browser. You'll see a schematic map of the real SJSU street network —
click a start point, then an end point, then "Generate Route" to build a track through those
actual streets. Drive it, finish, and your run is saved as a ghost; pick the same two points again
to race against it.

## Current build status

The full local pipeline runs end-to-end: real OSM data → PostGIS → road graph + buildings →
playable 3D scene, with a live route picker (steps 03–07 above only need to run once per machine;
after that, every route is generated on the fly from the same road network). Driving uses a
simplified movement model (steer left/right, speed ramps up automatically — no separate
accelerate/brake yet) and buildings render as plain colored blocks rather than shop/house-specific
models. Both are known next steps, not bugs.

## Explicitly out of scope for this version

- Live/real-time multiplayer
- Photorealistic or hand-modeled buildings
- Multiple cities/neighborhoods
- NPC traffic, pedestrians, elevation
- Cloud storage (placeholder left in `server/storage/localStorage.js` for swapping in later)
- Native mobile app — this is a browser-based web app
