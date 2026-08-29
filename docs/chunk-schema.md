# Chunk file schema

A "chunk" is one track's worth of data: the road path to drive, checkpoints, and nearby
buildings — everything the client needs to build the 3D scene for one race. Chunks are plain
JSON so they're easy to open and eyeball while debugging.

Coordinates are **local meters**, not lat/lon — `x` is east/west, `z` is north/south, both
measured from the `origin` point. The data pipeline does this conversion (see
`data-pipeline/06_generate_track.py` / `07_export_chunk.py`); the client never touches
lat/lon at all.

## Example

```json
{
  "chunk_id": "sjsu_001",
  "origin": { "lat": 37.3352, "lon": -121.8811 },
  "road_path": [
    { "x": 0, "z": 0, "width_m": 6.5, "lanes": 2, "draw_markings": true },
    { "x": 12.4, "z": 3.1, "width_m": 13.0, "lanes": 4, "draw_markings": true },
    { "x": 40.0, "z": 5.5, "width_m": 6.5, "lanes": 2, "draw_markings": false }
  ],
  "checkpoints": [
    { "x": 40.0, "z": 5.5, "index": 0 },
    { "x": 120.0, "z": -10.2, "index": 1 }
  ],
  "buildings": [
    {
      "footprint": [
        { "x": 5, "z": 5 },
        { "x": 15, "z": 5 },
        { "x": 15, "z": 20 },
        { "x": 5, "z": 20 }
      ],
      "height_m": 9.6,
      "category": "house"
    }
  ],
  "footpaths": [
    [
      { "x": 3, "z": -2 },
      { "x": 3, "z": 18 },
      { "x": 3, "z": 38 }
    ]
  ]
}
```

## Field reference

| Field | Type | Notes |
|---|---|---|
| `chunk_id` | string | Unique id, also the filename (without `.json`) |
| `origin` | `{ lat, lon }` | Real-world point that `x=0, z=0` maps to |
| `road_path` | array of road points | Ordered points describing the racing line, start to finish. See below |
| `checkpoints` | array of `{ x, z, index }` | Ordered checkpoints along the path, used for lap/timer logic |
| `buildings` | array of building objects | See below |
| `footpaths` | array of polylines (`{ x, z }[]`) | Real OSM sidewalks/paths near the route, kept whole (not clipped) if any point comes within ~20m of the road. Rendered as thin light strips — a visual reference for checking building placement, since real footpaths run alongside real roads |

### Road path point

| Field | Type | Notes |
|---|---|---|
| `x`, `z` | number | Position in local meters |
| `width_m` | number | Real road width for the segment starting at this point — from OSM `lanes` × a per-lane width when available, else a per-road-class default (see `server/routes/customTrack.js` / `data-pipeline/07_export_chunk.py`) |
| `lanes` | number | Real OSM lane count when tagged, else the same class-based default used for width |
| `draw_markings` | boolean | Whether the client should paint lane-divider dashes on this segment (skipped for residential-type streets, which are rarely painted in reality) |

Both server-generated (live-picked) and pipeline-generated (default) chunks compute these
the same way — the two implementations are kept in sync by hand, so check both if you
change the width/lane logic.

### Building object

| Field | Type | Notes |
|---|---|---|
| `footprint` | array of `{ x, z }` | Polygon outline, in order, forming a closed shape — the real OSM building footprint |
| `height_m` | number | Extrusion height in meters. Real OSM `height` tag when present, else `building:levels` × 3.2m, else an area-based estimate — see `data-pipeline/04_extract_buildings.py` |
| `category` | string | One of `house`, `apartments`, `garage`, `church`, `university`, `office`, `commercial`, `generic` — derived from OSM `shop=`/`amenity=`/`office=`/`building=` tags. The client (`client/src/buildingModels.js`) picks a distinct color and procedural roof/decoration per category |

## Ghost run file schema

Saved separately, one per recorded run, in `server/storage-data/ghosts/`.

```json
{
  "track_id": "sjsu_001",
  "player_name": "Meera",
  "recorded_at": "2026-08-16T10:00:00Z",
  "samples": [
    { "t": 0.0, "x": 0, "z": 0, "rot": 0 },
    { "t": 0.1, "x": 1.2, "z": 0.1, "rot": 2 }
  ]
}
```

Sampled ~10 times/second while driving (`t` in seconds since run start, `rot` in degrees).
