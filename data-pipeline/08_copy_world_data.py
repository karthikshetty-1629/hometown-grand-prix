"""
Copies the whole-area road graph, building set, and footpaths into server storage, so the
running server can offer live route picking (pick a start/end point on the map, generate a
race route between them) instead of only serving the one pre-baked loop from
07_export_chunk.py.

Reads: raw-data/road_graph.json, raw-data/buildings.json, raw-data/footpaths.json
Writes: matching copies under server/storage-data/world/
"""

import os
import shutil

RAW_DATA_DIR = os.path.join(os.path.dirname(__file__), "raw-data")
SERVER_WORLD_DIR = os.path.join(
    os.path.dirname(__file__), "..", "server", "storage-data", "world"
)


def main():
    os.makedirs(SERVER_WORLD_DIR, exist_ok=True)

    for filename in ("road_graph.json", "buildings.json", "footpaths.json"):
        src = os.path.join(RAW_DATA_DIR, filename)
        dest = os.path.join(SERVER_WORLD_DIR, filename)
        shutil.copy(src, dest)
        print(f"Copied {filename} -> {dest}")


if __name__ == "__main__":
    main()
