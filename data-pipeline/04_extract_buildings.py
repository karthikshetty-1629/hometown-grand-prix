"""
Extracts building footprints from PostGIS for the target area.

Reads: planet_osm_polygon (buildings) from the local PostGIS database.
Writes: raw-data/buildings.json

For each building we keep its footprint (list of lat/lon points), a real-world category
(house/apartments/garage/church/university/office/commercial/generic — derived from
shop=/amenity=/office=/building= tags), and a height in meters, preferring real OSM data:
  1. `height` tag (exact meters) if present
  2. `building:levels` tag * 3.2m/level if present
  3. otherwise a heuristic based on footprint area, same as before

Reading `height`/`building:levels`/`shop`/`amenity`/`office` requires the `tags` hstore
column, which only exists if 02_import_to_postgis.sh ran with --hstore (it does by
default now — see that script for why).
"""

import json
import os
import random

from sqlalchemy import create_engine, text

DB_URL = "postgresql://dev:dev@localhost:5433/hometown_gp"
METERS_PER_LEVEL = 3.2
DEFAULT_HEIGHT_RANGE = (6.0, 12.0)

OUTPUT_PATH = os.path.join(os.path.dirname(__file__), "raw-data", "buildings.json")

# building= values -> our category set. Anything not listed here (including the very
# common generic `building=yes`) falls back to "generic".
BUILDING_TAG_CATEGORY = {
    "house": "house",
    "detached": "house",
    "semidetached_house": "house",
    "terrace": "house",
    "bungalow": "house",
    "residential": "house",
    "static_caravan": "house",
    "apartments": "apartments",
    "dormitory": "apartments",
    "garage": "garage",
    "garages": "garage",
    "carport": "garage",
    "shed": "garage",
    "church": "church",
    "cathedral": "church",
    "chapel": "church",
    "mosque": "church",
    "temple": "church",
    "synagogue": "church",
    "university": "university",
    "school": "university",
    "college": "university",
    "public": "university",
    "civic": "university",
    "office": "office",
    "commercial": "commercial",
    "retail": "commercial",
    "supermarket": "commercial",
    "kiosk": "commercial",
    "hotel": "commercial",
    "warehouse": "commercial",
}

# amenity= values that clearly mean "shop-like commercial storefront" or a specific
# category, when there's no more specific shop=/building= match.
AMENITY_CATEGORY = {
    "restaurant": "commercial",
    "cafe": "commercial",
    "fast_food": "commercial",
    "bar": "commercial",
    "pub": "commercial",
    "bank": "commercial",
    "pharmacy": "commercial",
    "place_of_worship": "church",
    "school": "university",
    "university": "university",
    "college": "university",
}


def main():
    engine = create_engine(DB_URL)

    query = text(
        """
        SELECT osm_id, building, shop, amenity, office, way_area,
               tags -> 'height' AS height_raw,
               tags -> 'building:levels' AS levels_raw,
               ST_AsText(ST_Transform(way, 4326)) AS geom_text
        FROM planet_osm_polygon
        WHERE building IS NOT NULL
        """
    )

    with engine.connect() as conn:
        rows = conn.execute(query).fetchall()

    buildings = []
    height_sources = {"osm_height_tag": 0, "osm_levels_tag": 0, "estimated": 0}

    for osm_id, building_tag, shop, amenity, office, way_area, height_raw, levels_raw, geom_text in rows:
        footprint = _parse_polygon(geom_text)
        if len(footprint) < 3:
            continue  # not a real polygon, skip rather than repair

        height_m, source = _estimate_height(height_raw, levels_raw, way_area)
        height_sources[source] += 1
        category = _derive_category(building_tag, shop, amenity, office)

        buildings.append(
            {
                "osm_id": osm_id,
                "category": category,
                "footprint": [{"lon": lon, "lat": lat} for lon, lat in footprint],
                "height_m": round(height_m, 1),
            }
        )

    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
    with open(OUTPUT_PATH, "w") as f:
        json.dump(buildings, f)

    print(f"Extracted {len(buildings)} buildings")
    print(
        f"  heights: {height_sources['osm_height_tag']} from real OSM height, "
        f"{height_sources['osm_levels_tag']} from building:levels, "
        f"{height_sources['estimated']} estimated"
    )
    print(f"Saved to {OUTPUT_PATH}")


def _derive_category(building_tag, shop, amenity, office):
    if shop:
        return "commercial"
    if office:
        return "office"
    if amenity and amenity in AMENITY_CATEGORY:
        return AMENITY_CATEGORY[amenity]
    if building_tag:
        return BUILDING_TAG_CATEGORY.get(building_tag.lower(), "generic")
    return "generic"


def _parse_float(raw):
    if not raw:
        return None
    try:
        # Some values have units/ranges like "12 m" or "3;4" -- take the first numeric token.
        cleaned = raw.strip().split(";")[0].split(" ")[0]
        return float(cleaned)
    except ValueError:
        return None


def _estimate_height(height_raw, levels_raw, way_area):
    real_height = _parse_float(height_raw)
    if real_height and real_height > 0:
        return real_height, "osm_height_tag"

    levels = _parse_float(levels_raw)
    if levels and levels > 0:
        return levels * METERS_PER_LEVEL, "osm_levels_tag"

    # No real data: rough heuristic, bigger footprint -> taller, within a random band.
    lo, hi = DEFAULT_HEIGHT_RANGE
    area = way_area or 0
    area_bias = min(area / 2000.0, 1.0)  # 2000 sq-meter footprint ~= biggest bias
    base = lo + (hi - lo) * area_bias
    return random.uniform(base - 1, base + 1), "estimated"


def _parse_polygon(wkt_text):
    """Turns 'POLYGON((lon1 lat1, lon2 lat2, ...))' into [(lon1, lat1), ...]. Outer ring only."""
    inner = wkt_text.strip().removeprefix("POLYGON((").split("),(")[0].removesuffix("))")
    points = []
    for pair in inner.split(","):
        parts = pair.strip().split(" ")
        if len(parts) != 2:
            continue
        lon_str, lat_str = parts
        points.append((float(lon_str), float(lat_str)))
    return points


if __name__ == "__main__":
    main()
