# Hometown Grand Prix — MVP Build Specification (v0.1, Local-Only)

This is the original spec this repo was scaffolded from. Kept here as the source of truth while
we build out each file. See `README.md` for setup instructions and `chunk-schema.md` for the
data format reference.

## 1. What we are building

A driving game where the track is generated from real street layout and building shapes of an
actual neighborhood (starting with a small area around Downtown San Jose / SJSU). The player
drives a car in a stylized low-poly 3D scene from a chase camera. Buildings are simple extruded
colored blocks in the correct real-world positions — not photorealistic. After a run, the
player's path is saved. A friend can later load the same track and race against that saved path,
shown as a translucent "ghost" car.

**Explicitly out of scope for this build:**
- Live/real-time multiplayer
- Photorealistic buildings or hand-modeled landmarks
- Multiple cities (one small area only)
- NPC traffic, pedestrians, terrain/elevation
- Cloud storage (S3/R2) — local filesystem only for now, with a clearly marked placeholder for
  swapping in cloud storage later
- Native mobile app / Unity — this is a web app (runs in any browser, can be wrapped later)

## 2. Tech stack

| Layer | Choice | Why |
|---|---|---|
| Map data source | OpenStreetMap `.osm.pbf` extract via Geofabrik | Free, open license (ODbL) |
| Data import | `osm2pgsql` | Standard open-source tool for OSM → PostgreSQL |
| Spatial database | PostgreSQL + PostGIS | Spatial queries: roads near a point, buildings in a box |
| Processing scripts | Python 3 (`psycopg2`/`SQLAlchemy`, `shapely`, `networkx`) | Generates tracks and chunk files from the DB |
| Chunk file format | Plain JSON | Simple to debug; optimize to binary later only if needed |
| Local file storage | `./server/storage-data/` | Placeholder for future S3/R2 |
| Backend API | Node.js + Express | Serves chunk files, accepts ghost-run uploads |
| 3D rendering (client) | Babylon.js | Free, lightweight, browser-based |
| Car/asset models | Kenney.nl free low-poly packs | Free, CC0, matches the intended visual style |

## 3. Data pipeline steps (offline, run once per area)

1. **Download** — `01_download_extract.sh` pulls the California Geofabrik extract.
2. **Clip + import** — `02_import_to_postgis.sh` uses `osmium extract` to clip to a small
   bounding box (Downtown San Jose / SJSU: `-121.895,37.330,-121.870,37.345`), then
   `osm2pgsql` imports it into PostGIS (`planet_osm_line` for roads, `planet_osm_polygon` for
   buildings).
3. **Road graph** — `03_build_road_graph.py` queries roads (excluding `motorway`,
   `motorway_link`, `service`, private roads), builds a graph with `networkx`
   (edges = segments, nodes = intersections), saves to `raw-data/road_graph.json`.
4. **Buildings** — `04_extract_buildings.py` queries building polygons in the bounding box,
   extracts footprint + `building:levels`. Height rule: `height_m = levels * 3.2` if known,
   else a random 6–12m scaled loosely by footprint area. Saves `raw-data/buildings.json`.
5. **Track generation** — `05_generate_track.py` picks a start node near the center, does a
   randomized walk returning close to start within 600–900m, rejecting reused edges, overly
   sharp back-to-back turns, and loops under ~400m. Outputs an ordered lat/lon path, saved as
   `raw-data/track_sjsu_001.json`.
6. **Local coordinate conversion** — before export, every lat/lon is converted to local flat
   meters centered on the track's start point:

   ```python
   import math

   def latlon_to_local_meters(lat, lon, origin_lat, origin_lon):
       R = 6371000  # Earth radius in meters
       dx = math.radians(lon - origin_lon) * R * math.cos(math.radians(origin_lat))
       dy = math.radians(lat - origin_lat) * R
       return dx, dy
   ```
7. **Chunk export** — `06_export_chunk.py` combines the track path, nearby buildings
   (converted to local meters), and checkpoints into one chunk JSON (see `chunk-schema.md`),
   copied into `server/storage-data/chunks/`.

## 4. Local storage placeholder (server side)

`server/storage/localStorage.js` is the **only** place the server touches the filesystem.
Every route calls this module (`storage.readFile(...)`, `storage.saveFile(...)`,
`storage.listFiles(...)`) instead of using `fs` directly — that's the seam where S3/R2 gets
swapped in later without touching the rest of the codebase.

## 5. Server API

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/tracks/:id` | Returns the chunk JSON for a given track |
| GET | `/api/tracks` | Lists available local tracks |
| POST | `/api/ghosts/:trackId` | Upload a recorded run (`{t, x, z, rotation}` samples) |
| GET | `/api/ghosts/:trackId` | Returns saved ghost run(s) for that track |

## 6. Client (Babylon.js)

- `sceneBuilder.js` — fetches a chunk, builds a ribbon/tube road mesh, extrudes each building
  footprint by `height_m` (colored by `color_class`), places checkpoint markers.
- `carController.js` — third-person chase camera; MVP movement is **not real physics** — the
  car moves forward at a constant/ramping speed along the road direction, steering applies a
  lateral offset within a lane width (a "spline-based" approach, simpler than full vehicle
  physics). Desktop input first (arrow keys/WASD), touch drag-to-steer later.
- `runRecorder.js` — every ~100ms while driving, pushes `{t, x, z, rot}`; on finishing (last
  checkpoint), POSTs the array to `/api/ghosts/:trackId`.
- `ghostPlayer.js` — fetches any existing ghost for the track on load, moves a second
  translucent car mesh to the interpolated position matching current race time each frame.

## 7. Build order

Each step should be fully working and testable before moving to the next.

1. Data pipeline only — get one chunk JSON generated in `server/storage-data/chunks/`, sanity
   check it (don't touch the game yet).
2. Static scene render — load that chunk in Babylon.js, look at it, no car/controls yet.
3. Add the car and steering — get driving feeling smooth.
4. Add checkpoints + timer.
5. Add run recording + upload — confirm a full run saves via the local API.
6. Add ghost playback.
7. Polish pass — visuals, sounds, track picker menu if more than one track exists.

## 8. Acceptance criteria for "MVP works"

- [ ] One real neighborhood's roads and buildings are visibly, recognizably rendered in-browser
- [ ] Player can drive the loop with keyboard/touch controls and it feels responsive
- [ ] A completed run is saved locally (visible as a JSON file in `storage-data/ghosts/`)
- [ ] A second run against the saved ghost shows both cars on screen, ghost path matching the
      first recorded run
- [ ] Everything works with zero cloud services — fully offline-capable on localhost

## 9. Reference links

- OSM data extracts: https://download.geofabrik.de/
- osm2pgsql docs: https://osm2pgsql.org/
- PostGIS docs: https://postgis.net/
- Babylon.js docs: https://doc.babylonjs.com/
- Kenney free game assets: https://kenney.nl/assets
- osmium tool: https://osmcode.org/osmium-tool/

## 10. Ground rules

- Keep the storage adapter pattern strict — no direct filesystem calls outside
  `server/storage/localStorage.js`.
- Favor plain JSON and simple Node/Python scripts over frameworks not listed here — this is an
  MVP, optimized for "runs and is easy to debug," not production polish.
- No live multiplayer, user accounts, or authentication in this version.
- If road graph or building extraction produces broken geometry (self-intersecting polygons,
  disconnected roads), skip/filter that item rather than trying to repair it.
