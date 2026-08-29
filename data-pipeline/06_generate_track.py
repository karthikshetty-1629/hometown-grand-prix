"""
Generates one race loop by doing a randomized walk through the road graph.

Reads: raw-data/road_graph.json (from 03_build_road_graph.py)
Writes: raw-data/track_sjsu_001.json

Approach:
  1. Pick a start node roughly in the center of the area.
  2. Randomly walk the graph, trying to return close to the start within a target
     length (600-900m).
  3. Reject loops that: reuse the same edge twice, have extremely sharp back-to-back
     turns, or come out shorter than ~400m.
  4. Save the resulting ordered lat/lon path.

This is intentionally simple (randomized search, not a proper routing algorithm) —
good enough for MVP, and easy to re-run if a generated loop looks bad.
"""

import json
import math
import os
import random

MIN_LOOP_METERS = 400
TARGET_LOOP_METERS = (600, 900)
MAX_ATTEMPTS = 200
CLOSE_ENOUGH_METERS = 60  # how close back to start counts as "closed the loop"
SHARP_TURN_DEGREES = 150  # reject a turn sharper than this (back-to-back hairpins)

GRAPH_PATH = os.path.join(os.path.dirname(__file__), "raw-data", "road_graph.json")
OUTPUT_PATH = os.path.join(os.path.dirname(__file__), "raw-data", "track_sjsu_001.json")


def haversine_m(lat1, lon1, lat2, lon2):
    R = 6371000
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


def turn_angle_degrees(p_prev, p_cur, p_next):
    def bearing(a, b):
        return math.degrees(math.atan2(b[1] - a[1], b[0] - a[0]))

    b1 = bearing(p_prev, p_cur)
    b2 = bearing(p_cur, p_next)
    diff = abs(b1 - b2) % 360
    return min(diff, 360 - diff)


def load_graph():
    with open(GRAPH_PATH) as f:
        data = json.load(f)

    nodes = {n["id"]: (n["lat"], n["lon"]) for n in data["nodes"]}
    adjacency = {}
    edge_attrs = {}
    for link in data["links"]:
        adjacency.setdefault(link["source"], []).append(link["target"])
        adjacency.setdefault(link["target"], []).append(link["source"])
        key = tuple(sorted((link["source"], link["target"])))
        edge_attrs[key] = {"highway": link.get("highway"), "lanes": link.get("lanes")}

    return nodes, adjacency, edge_attrs


def attempt_loop(nodes, adjacency, start_id):
    path_ids = [start_id]
    used_edges = set()
    total_m = 0.0

    current = start_id
    while total_m < TARGET_LOOP_METERS[1]:
        neighbors = [n for n in adjacency.get(current, []) if n != path_ids[-2:-1]]
        random.shuffle(neighbors)

        moved = False
        for nxt in neighbors:
            edge = tuple(sorted((current, nxt)))
            if edge in used_edges:
                continue

            if len(path_ids) >= 2:
                p_prev = nodes[path_ids[-2]]
                p_cur = nodes[current]
                p_next = nodes[nxt]
                if turn_angle_degrees(p_prev, p_cur, p_next) > SHARP_TURN_DEGREES:
                    continue

            used_edges.add(edge)
            path_ids.append(nxt)
            lat1, lon1 = nodes[current]
            lat2, lon2 = nodes[nxt]
            total_m += haversine_m(lat1, lon1, lat2, lon2)
            current = nxt
            moved = True
            break

        if not moved:
            return None  # dead end, this attempt failed

        if total_m >= TARGET_LOOP_METERS[0]:
            lat1, lon1 = nodes[current]
            lat2, lon2 = nodes[start_id]
            if haversine_m(lat1, lon1, lat2, lon2) <= CLOSE_ENOUGH_METERS:
                if total_m >= MIN_LOOP_METERS:
                    return path_ids, total_m
                return None

    return None


def main():
    nodes, adjacency, edge_attrs = load_graph()
    if not nodes:
        raise SystemExit("road_graph.json has no nodes — run 03_build_road_graph.py first")

    # Rough "center" of the area: average of all node positions.
    avg_lat = sum(lat for lat, _ in nodes.values()) / len(nodes)
    avg_lon = sum(lon for _, lon in nodes.values()) / len(nodes)
    start_id = min(
        nodes, key=lambda nid: haversine_m(nodes[nid][0], nodes[nid][1], avg_lat, avg_lon)
    )

    result = None
    for _ in range(MAX_ATTEMPTS):
        result = attempt_loop(nodes, adjacency, start_id)
        if result:
            break

    if not result:
        raise SystemExit(
            f"Could not find a valid loop after {MAX_ATTEMPTS} attempts. "
            "Try a different start node or loosen the constraints."
        )

    path_ids, length_m = result
    segments_meta = [
        edge_attrs.get(tuple(sorted((a, b))), {"highway": None, "lanes": None})
        for a, b in zip(path_ids, path_ids[1:])
    ]
    track = {
        "track_id": "sjsu_001",
        "length_m": round(length_m, 1),
        "path_latlon": [{"lat": nodes[nid][0], "lon": nodes[nid][1]} for nid in path_ids],
        "segments_meta": segments_meta,
    }

    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
    with open(OUTPUT_PATH, "w") as f:
        json.dump(track, f)

    print(f"Generated loop: {len(path_ids)} points, {length_m:.0f}m")
    print(f"Saved to {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
