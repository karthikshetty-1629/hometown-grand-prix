# Cached San Jose OSM details

`san-jose-details.json` is public OpenStreetMap data fetched with `../fetch_city_details.py`. © OpenStreetMap contributors, ODbL: https://www.openstreetmap.org/copyright.

The snapshot records its source and download timestamp. Refresh manually with `python3 data-pipeline/fetch_city_details.py`, then restart the API server. Do not call Overpass per race or per frame. Query bounds cover the existing San Jose locality; no player location or private addresses are sent.

Features are mapped road controls, not surveyed pole coordinates. Client clearance checks offset traffic-control hardware outside all drivable road surfaces and building footprints. OSM coverage varies, so missing widths, speeds, and building appearance are explicitly treated as estimates.
