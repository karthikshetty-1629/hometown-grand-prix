"""
Extracts real pedestrian footpaths (sidewalks, paths, pedestrian streets) from PostGIS —
these were deliberately excluded from the drivable road graph in 03_build_road_graph.py
(you can't drive on a sidewalk), but they're useful to render as a visual reference: real
footpaths run alongside real roads, so if buildings are correctly placed, they should sit
just past the footpath on either side of the street.

Reads: planet_osm_line (roads) from the local PostGIS database.
Writes: raw-data/footpaths.json
"""

import json
import os

from sqlalchemy import create_engine, text

DB_URL = "postgresql://dev:dev@localhost:5433/hometown_gp"
FOOTPATH_HIGHWAY_TYPES = ("footway", "path", "pedestrian")

OUTPUT_PATH = os.path.join(os.path.dirname(__file__), "raw-data", "footpaths.json")


def main():
    engine = create_engine(DB_URL)

    query = text(
        """
        SELECT osm_id, ST_AsText(ST_Transform(way, 4326)) AS geom_text
        FROM planet_osm_line
        WHERE highway = ANY(:included)
        """
    )

    with engine.connect() as conn:
        rows = conn.execute(query, {"included": list(FOOTPATH_HIGHWAY_TYPES)}).fetchall()

    footpaths = []
    for osm_id, geom_text in rows:
        points = _parse_linestring(geom_text)
        if len(points) < 2:
            continue
        footpaths.append(
            {
                "osm_id": osm_id,
                "points": [{"lat": lat, "lon": lon} for lon, lat in points],
            }
        )

    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
    with open(OUTPUT_PATH, "w") as f:
        json.dump(footpaths, f)

    print(f"Extracted {len(footpaths)} footpaths")
    print(f"Saved to {OUTPUT_PATH}")


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
