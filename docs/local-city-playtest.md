# City driving playtest

Open http://localhost:5173 with the API server on port 3001.

- Choose **Try Downtown → SJSU**, or choose two map points, then **Start race**.
- **Free drive** only needs a starting point and has no finish condition.
- Profile names and garage paint are saved locally on the device. This is not account authentication.
- Use WASD/arrows to drive, V to change camera. Phone-sized screens and touch devices expose steering, brake/reverse, accelerator, and camera controls.
- Hold above 110% of the estimated limit for 3 seconds to trigger pursuit. Stop for 3 seconds to accept a +10-second citation, or stay more than 45 m from the patrol while driving below the limit for 10 seconds to escape.
- Property collisions add 5 seconds. Pedestrian collisions add 20 seconds and dispatch an ambulance; major property impacts also dispatch it. A cooldown prevents per-frame penalties.
- Finish a race without an active pursuit. Penalties count toward elapsed time. Resetting the car adds 5 seconds.

## Two-player rooms

Select a race route, choose **Challenge a friend**, then **Create race room**. The game shows a six-character room code. A second browser/device on the same API server can use **Join room**. Both players load the same track and get a five-second countdown. Opponent position and paint are synchronized; results compare elapsed time including penalties. Rooms are in memory and disappear when the API server restarts.

For a phone on the same Wi-Fi, open the computer's LAN address at port 5173. The web client uses that hostname at port 3001 for its API. `localhost` on a phone means the phone itself. Native Capacitor builds keep the existing server-address setup screen.

## Scope and limitations

This is a local playable prototype. San Jose is the only installed city. Worldwide neighborhood search/download, authentication, cloud matchmaking, authoritative multiplayer/anti-cheat, full right-of-way and player red-light enforcement, crash damage, and production iOS/Android signing are not implemented. Police/emergency vehicles follow the directed road graph; their dispatch and driving behavior remain simplified. Pedestrians populate the vicinity of the starting area. Signals are visual and estimated road-class limits are not authoritative traffic-law data.

The player and traffic cars use the licensed CarConcept asset; responders, pedestrians, and building details are procedural. Facade detail is added within 800 m of the start for performance; these are not photorealistic replicas. Real map geometry comes from the existing OpenStreetMap dataset. Native device performance and app-store builds need dedicated testing.

## Validation

`npm run build --prefix client`

`node --test client/tests/trafficRules.test.js`

API smoke checks cover route creation, room membership/capacity, state synchronization, and synchronized start. Browser checks cover the dashboard, route launch, and 390 px mobile layout.

## Map-grounded rendering update

The October 4 rendering revision replaces inferred signal-at-every-junction placement with a cached Overpass snapshot: 8,519 elements, including 329 traffic-signal nodes, 1,778 crossing nodes, 338 tree nodes, and road/footway geometry. The runtime uses 4,850 in-bounds road segments, including 1,514 one-way segments and 1,703 with tagged speed limits. It preserves directed routing and renders speed in mph, marking heuristic limits `est.`.

Signal poles are derived offsets from mapped control nodes and pass shared road/building clearance checks. Only mapped trees with sufficient clearance are rendered. Sidewalk runs are clipped away from roads/buildings. Crosswalks come from mapped crossing nodes; lane markings are suppressed in junctions. Decorative race gates, checkpoint poles, invented building columns/spires, and traffic-overlay strips are removed from free drive.

The player uses the CC-BY-4.0 Khronos CarConcept model with physically based materials; nearby traffic uses exterior-only versions. There are up to ten simulated lane-following cars and twenty-eight animated pedestrians walking safe sidewalk paths around the start. Cars yield to other vehicles and simulated signal phases; vehicle impacts add eight seconds. Responders follow the directed road graph. These are simulated actors, not live tracked people or vehicles. Precise signal timing, hardware positions, missing limits/widths, and building textures are not surveyed data. See `/credits.html` for attribution and limitations.

Tests: `node --test client/tests/*.test.js`. Geometry tests cover junction clearance, clipping paths at roads, footprint clearance, and right-hand/one-way traffic lanes.

## Driving smoothness, curbs, guidance and loading (October 4)
- Corrected static batching: geometry is grouped by 160m tile AND shared material, with one submesh per batch. The earlier multi-material merge retained a draw call for each source piece.
- Replaced city-wide camera triangle picking with nearby footprint checks. Road lookup uses the existing spatial index; HUD and signal updates are throttled. Adaptive resolution only steps down below 26 FPS.
- Optimized the concept car from 213,347 to 32,282 triangles and 11.42 MB to 3.75 MB using glTF Transform. Original license remains in model credits.
- Raised curb meshes follow exposed road boundaries, with junction openings. Swept collision checks prevent crossing road edges, include front/rear body clearance, and permit sliding along curbs.
- Routes now retain their directed graph path. Navigation shows next left/right, distance, wrong-way/off-route feedback, and minimap route chevrons. Off-route guidance asks the driver to return; automatic rerouting is not implemented.
- Branded animated loading screen uses actual preparation milestones and exposes an error retry button.
- Validation: production build passes (existing large bundle warning); 14 unit tests pass; route/room smoke checks pass. The actual Downtown/SJSU spawn moved 12 m through the new collision function without obstruction.
- Browser preview measured 30–31 FPS after batching, versus 6–11 FPS during the initial pre-batching test. This is a stationary player with animated city traffic in the in-app browser, not a physical iOS/Android driving benchmark. Keyboard acceleration input was exercised; sustained manual driving on target phones still needs testing.
- Screenshots: loading-preview.png and smooth-driving-preview.png.
