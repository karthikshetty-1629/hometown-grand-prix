"""
Combines the generated track and nearby buildings into one chunk JSON file, converting
everything from lat/lon into local flat meters (the 3D engine doesn't understand lat/lon).

Reads: raw-data/track_sjsu_001.json, raw-data/buildings.json, raw-data/footpaths.json
Writes: raw-data/chunk_sjsu_001.json, and copies it into server/storage-data/chunks/

Road width and lane markings come from real OSM `lanes`/`highway` data when available
(track_sjsu_001.json's segments_meta, from 06_generate_track.py), falling back to a
per-road-class default when the specific `lanes` tag is missing. Mirrors the same logic
used server-side in server/routes/customTrack.js for live-picked routes — keep both in
sync if you change one.

See docs/chunk-schema.md for the exact output format.
"""

import json
import math
import os
import shutil

CHECKPOINT_SPACING_M = 150  # roughly one checkpoint every N meters along the path
BUILDING_PROXIMITY_M = 40  # only keep buildings within this distance of the track
FOOTPATH_PROXIMITY_M = 20  # only keep footpaths that pass near the track

LANE_WIDTH_M = 3.25
MIN_ROAD_WIDTH_M = 5.0
# Used only when a segment's real `lanes` tag is missing.
DEFAULT_LANES_BY_CLASS = {
    "trunk": 4,
    "trunk_link": 2,
    "primary": 4,
    "primary_link": 2,
    "secondary": 2,
    "secondary_link": 2,
    "tertiary": 2,
    "tertiary_link": 2,
    "residential": 2,
    "living_street": 2,
    "unclassified": 2,
}
# Real streets in these classes are almost never painted with lane lines, even when
# nominally "2 lanes" (one each direction) -- so skip drawing markings there.
NO_MARKING_CLASSES = {"residential", "living_street", "unclassified", None}

TRACK_PATH = os.path.join(os.path.dirname(__file__), "raw-data", "track_sjsu_001.json")
BUILDINGS_PATH = os.path.join(os.path.dirname(__file__), "raw-data", "buildings.json")
FOOTPATHS_PATH = os.path.join(os.path.dirname(__file__), "raw-data", "footpaths.json")
OUTPUT_PATH = os.path.join(os.path.dirname(__file__), "raw-data", "chunk_sjsu_001.json")
SERVER_CHUNKS_DIR = os.path.join(
    os.path.dirname(__file__), "..", "server", "storage-data", "chunks"
)


def latlon_to_local_meters(lat, lon, origin_lat, origin_lon):
    R = 6371000  # Earth radius in meters
    dx = math.radians(lon - origin_lon) * R * math.cos(math.radians(origin_lat))
    dy = math.radians(lat - origin_lat) * R
    return dx, dy


def main():
    with open(TRACK_PATH) as f:
        track = json.load(f)
    with open(BUILDINGS_PATH) as f:
        buildings_raw = json.load(f)
    with open(FOOTPATHS_PATH) as f:
        footpaths_raw = json.load(f)

    path_latlon = track["path_latlon"]
    origin = path_latlon[0]

    road_path = []
    for point in path_latlon:
        x, z = latlon_to_local_meters(point["lat"], point["lon"], origin["lat"], origin["lon"])
        road_path.append({"x": round(x, 2), "z": round(z, 2)})

    _apply_road_specs(road_path, track.get("segments_meta", []))
    checkpoints = _place_checkpoints(road_path)

    buildings = []
    skipped_far = 0
    for b in buildings_raw:
        footprint = [
            {
                "x": round(latlon_to_local_meters(p["lat"], p["lon"], origin["lat"], origin["lon"])[0], 2),
                "z": round(latlon_to_local_meters(p["lat"], p["lon"], origin["lat"], origin["lon"])[1], 2),
            }
            for p in b["footprint"]
        ]

        if _distance_to_nearest_road_point(footprint, road_path) > BUILDING_PROXIMITY_M:
            skipped_far += 1
            continue

        buildings.append(
            {
                "footprint": footprint,
                "height_m": b["height_m"],
                "category": b.get("category", "generic"),
            }
        )

    footpaths = []
    for fp in footpaths_raw:
        points = [
            {
                "x": round(latlon_to_local_meters(p["lat"], p["lon"], origin["lat"], origin["lon"])[0], 2),
                "z": round(latlon_to_local_meters(p["lat"], p["lon"], origin["lat"], origin["lon"])[1], 2),
            }
            for p in fp["points"]
        ]
        if _footpath_near_road(points, road_path, FOOTPATH_PROXIMITY_M):
            footpaths.append(points)

    chunk = {
        "chunk_id": track["track_id"],
        "origin": {"lat": origin["lat"], "lon": origin["lon"]},
        "road_path": road_path,
        "checkpoints": checkpoints,
        "buildings": buildings,
        "footpaths": footpaths,
    }

    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
    with open(OUTPUT_PATH, "w") as f:
        json.dump(chunk, f)

    os.makedirs(SERVER_CHUNKS_DIR, exist_ok=True)
    dest = os.path.join(SERVER_CHUNKS_DIR, f"{track['track_id']}.json")
    shutil.copy(OUTPUT_PATH, dest)

    print(
        f"Exported chunk with {len(road_path)} road points, {len(buildings)} buildings, "
        f"{len(footpaths)} footpaths ({skipped_far} buildings skipped as too far from the track)"
    )
    print(f"Saved to {OUTPUT_PATH}")
    print(f"Copied to {dest}")


def _road_width_and_lanes(highway, lanes_raw):
    lanes = None
    if lanes_raw:
        try:
            lanes = int(lanes_raw)
        except (TypeError, ValueError):
            lanes = None
    if not lanes or lanes <= 0:
        lanes = DEFAULT_LANES_BY_CLASS.get(highway, 2)

    width = max(lanes * LANE_WIDTH_M, MIN_ROAD_WIDTH_M)
    draw_markings = lanes >= 2 and highway not in NO_MARKING_CLASSES
    return width, lanes, draw_markings


def _apply_road_specs(road_path, segments_meta):
    """Attaches width_m/lanes/draw_markings to each point, using the segment starting
    there (the last point reuses the final segment's spec)."""
    specs = [
        _road_width_and_lanes(meta.get("highway"), meta.get("lanes")) for meta in segments_meta
    ] or [(MIN_ROAD_WIDTH_M, 2, False)]

    for i, point in enumerate(road_path):
        width, lanes, draw_markings = specs[i] if i < len(specs) else specs[-1]
        point["width_m"] = round(width, 2)
        point["lanes"] = lanes
        point["draw_markings"] = draw_markings


def _distance_to_nearest_road_point(footprint, road_path):
    cx = sum(p["x"] for p in footprint) / len(footprint)
    cz = sum(p["z"] for p in footprint) / len(footprint)
    return min(math.hypot(cx - r["x"], cz - r["z"]) for r in road_path)


def _footpath_near_road(points, road_path, threshold_m):
    """Keeps the whole footpath if ANY point of it comes near the route -- simpler than
    clipping, and fine for a visual reference."""
    for p in points:
        for r in road_path:
            if math.hypot(p["x"] - r["x"], p["z"] - r["z"]) <= threshold_m:
                return True
    return False


def _place_checkpoints(road_path):
    checkpoints = []
    accumulated = 0.0
    next_threshold = CHECKPOINT_SPACING_M
    index = 0

    for prev, cur in zip(road_path, road_path[1:]):
        accumulated += math.hypot(cur["x"] - prev["x"], cur["z"] - prev["z"])
        if accumulated >= next_threshold:
            checkpoints.append({"x": cur["x"], "z": cur["z"], "index": index})
            index += 1
            next_threshold += CHECKPOINT_SPACING_M

    return checkpoints


if __name__ == "__main__":
    main()
