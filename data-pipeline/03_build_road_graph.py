"""
Builds a simple road graph from the roads PostGIS just imported.

Reads: planet_osm_line (roads) from the local PostGIS database.
Writes: raw-data/road_graph.json

Each road segment becomes an edge; each segment endpoint becomes a node (keyed by
rounded lat/lon so shared intersections merge into the same node). We keep this
file so later steps (track generation) don't have to re-query the DB every run.

Each edge also carries `highway` (road class), `lanes` (real lane count when OSM has it,
else null), and `name` (the real OSM street name — a genuine osm2pgsql column, not hstore,
populated for most named streets) — used later to size road width, draw lane markings, and
match live scraped incidents (which name streets, not coordinates) to the exact real street.
"""

import json
import os

import networkx as nx
from sqlalchemy import create_engine, text

DB_URL = "postgresql://dev:dev@localhost:5433/hometown_gp"

# Allowlist, not a blocklist: only road classes a car can actually drive on. Excludes
# motorway/motorway_link on purpose (no freeways in this MVP), and excludes footway,
# cycleway, path, steps, pedestrian, track, corridor, elevator, service, private — none of
# those are real driving roads, even though they show up as graph edges in OSM.
CAR_HIGHWAY_TYPES = (
    "trunk",
    "trunk_link",
    "primary",
    "primary_link",
    "secondary",
    "secondary_link",
    "tertiary",
    "tertiary_link",
    "residential",
    "living_street",
    "unclassified",
)

OUTPUT_PATH = os.path.join(os.path.dirname(__file__), "raw-data", "road_graph.json")


def node_key(lon, lat, precision=6):
    """Round coordinates so nearby endpoints from different segments snap to one node."""
    return f"{round(lon, precision)},{round(lat, precision)}"


def main():
    engine = create_engine(DB_URL)
    graph = nx.Graph()

    query = text(
        """
        SELECT osm_id, highway, name, tags -> 'lanes' AS lanes_raw,
               ST_AsText(ST_Transform(way, 4326)) AS geom_text
        FROM planet_osm_line
        WHERE highway = ANY(:included)
        """
    )

    with engine.connect() as conn:
        rows = conn.execute(query, {"included": list(CAR_HIGHWAY_TYPES)}).fetchall()

    for osm_id, highway, name, lanes_raw, geom_text in rows:
        points = _parse_linestring(geom_text)
        if len(points) < 2:
            continue

        lanes = _parse_lanes(lanes_raw)

        for (lon1, lat1), (lon2, lat2) in zip(points, points[1:]):
            n1, n2 = node_key(lon1, lat1), node_key(lon2, lat2)
            graph.add_node(n1, lon=lon1, lat=lat1)
            graph.add_node(n2, lon=lon2, lat=lat2)
            graph.add_edge(n1, n2, osm_id=osm_id, highway=highway, name=name, lanes=lanes)

    data = nx.node_link_data(graph)
    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
    with open(OUTPUT_PATH, "w") as f:
        json.dump(data, f)

    with_lanes = sum(1 for *_, d in graph.edges(data=True) if d.get("lanes"))
    with_name = sum(1 for *_, d in graph.edges(data=True) if d.get("name"))
    print(f"Road graph: {graph.number_of_nodes()} nodes, {graph.number_of_edges()} edges")
    print(f"  ({with_lanes} edges have a real OSM lane count; the rest fall back to a class default)")
    print(f"  ({with_name} edges have a real OSM street name)")
    print(f"Saved to {OUTPUT_PATH}")


def _parse_lanes(lanes_raw):
    if not lanes_raw:
        return None
    try:
        # Some values are like "2;3" (varies along the way) -- just take the first number.
        return int(float(str(lanes_raw).split(";")[0]))
    except ValueError:
        return None


def _parse_linestring(wkt_text):
    """Turns 'LINESTRING(lon1 lat1, lon2 lat2, ...)' into [(lon1, lat1), (lon2, lat2), ...]."""
    inner = wkt_text.strip().removeprefix("LINESTRING(").removesuffix(")")
    points = []
    for pair in inner.split(","):
        lon_str, lat_str = pair.strip().split(" ")
        points.append((float(lon_str), float(lat_str)))
    return points


if __name__ == "__main__":
    main()
