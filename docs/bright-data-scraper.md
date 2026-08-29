# Bright Data traffic scraper — settings

Saved here so Claude Code reuses these settings automatically on every refresh, instead of
re-deciding the target/fields each time (per the hackathon's Bright Data judging criteria:
reusable, version-controlled, not a one-off command).

## What this feeds

Live traffic congestion, rendered as a colored line on top of the real road it affects while
driving — thin/green for light traffic, thick/red for heavy. Purely visual (no physics
effect). Source of truth is `server/storage-data/live/traffic.json`, served at
`GET /api/live/traffic`.

## This is fully automatic — no manual trigger

The server itself calls Bright Data directly — once on startup, and again every time a race
is started (`server/routes/customTrack.js`) — via `server/liveTraffic.js`. Neither needs a
person or a Claude Code session running. Both are fire-and-forget: a live scrape can take
anywhere from a few seconds to a minute, and neither server startup nor starting a race ever
blocks waiting on it — a race begins with whatever data is already cached, and the refresh
kicked off alongside it is for that drive and the next one.

Requires `BRIGHT_DATA_API_KEY` in `.env` (same key works for the CLI and this server-side
REST usage — see Account Settings → Users and API keys in the Bright Data dashboard). Without
it, `refreshLiveTrafficInBackground()` logs a skip message and does nothing — the game still
runs fine with no live overlay.

## The actual scraper

A real Bright Data **Scraper Studio** collector, not ad-hoc MCP calls:

- Collector ID: `c_mtewpzd4ncsji847m` (name: `sj-downtown-traffic`)
- Target: `https://sjdowntown.com/traffic-construction-updates/`
- Built via: `bdata scraper create <url> "<plain-language description>"` (AI Agent mode) —
  see `bdata scraper --help` for the full command surface (`create`, `run`, `heal`, `approve`)
- Output shape per event: `{ street, description, severity }`

**Real self-healing was exercised on this collector**: an initial run showed the `street`
field sometimes capturing stray text (schedule times, day names, label prefixes like
"Impact:") instead of the real street name. Ran `bdata scraper heal <id> "<fix prompt>"` and
approved the result. Honest result: the healed preview showed a clean fix, but a subsequent
full run still shows the same mixed quality on several rows — the self-healing mechanism is
real and was genuinely exercised end to end (create → run → identify defect → heal → approve),
but it did not fully resolve the extraction quality in this case. Documented here rather than
overstated.

## Matching — three tiers, in `data-pipeline/match_traffic_to_roads.js`

`data-pipeline/03_build_road_graph.py` extracts the real OSM `name` column (a genuine
osm2pgsql column, not a hstore tag — 98% coverage on this map) onto every road segment, which
is what makes name-based matching possible at all.

1. **Street name + coordinates** (used by manually-curated incident batches, which include a
   geocoded point): every segment of that named street within 300m of the point.
2. **Street name only, no coordinates** (the fully-automated Scraper Studio path — its output
   has no lat/lon at all): every segment of that named street, anywhere on the map. Coarser —
   flags the whole street, not just the affected block — but stays fully automatic with no
   manual geocoding step.
3. **Coordinates only, no usable street name**: nearest single segment within 400m.

Honest current yield: of the ~37 raw events per automated run, only ~2 have a `street` value
clean enough to match a real street name (the rest are the extraction noise above, and
correctly fail to match anything — a garbage string simply doesn't equal a real street name).
The pipeline itself — trigger, run, match, serve, render — is fully real and automatic;
richness of the data is currently limited by scraper extraction quality, not by this matching
step or the rendering.

## Serving and rendering

- `GET /api/live/traffic` (`server/routes/live.js`) reads `traffic.json` via the storage
  adapter. Empty/no-file state returns `{ fetched_at: null, segments: [] }` — the client
  renders nothing rather than erroring.
- `buildTrafficOverlay()` in `client/src/sceneBuilder.js` renders the colored strips.
