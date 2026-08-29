import { Engine, Scene, HemisphericLight, DirectionalLight, Vector3, Color3, Color4 } from '@babylonjs/core';
import { buildScene } from './sceneBuilder.js';
import { CarController } from './carController.js';
import { RunRecorder } from './runRecorder.js';
import { GhostPlayer } from './ghostPlayer.js';
import { showRoutePicker } from './routePicker.js';
import { getApiBaseUrl, needsServerSetup } from './config.js';
import { showServerSetup } from './serverSetup.js';
import { shouldShowTouchControls, mountTouchControls } from './touchControls.js';
import { AudioManager } from './audioManager.js';
import { showFinishPanel, formatTime } from './finishPanel.js';
import { findNearestRoadSegment } from './roadLookup.js';
import { reportToSteward } from './steward.js';
import { buildNavigationIndex, findNavigationInfo } from './navigationHud.js';

const CHECKPOINT_RADIUS_M = 8; // wider than the old rail-guided value — free driving means
// the car is realistically off the exact road centerline sometimes
const COLLISION_SOUND_COOLDOWN_S = 0.4; // scraping a wall spans many frames — don't spam the thud
const SPEEDING_THRESHOLD_MULTIPLIER = 1.1; // 10% over the (heuristic) road-class speed limit
const OFFROAD_MARGIN_M = 3; // beyond the road's half-width before counting as "off road" —
// avoids flagging a car that's merely near the curb/edge of its own lane
const STEWARD_COOLDOWN_S = 10; // per event type, per project instruction

const statusEl = document.getElementById('status');

async function main() {
  const pickerEl = document.getElementById('picker');

  // On native app builds, "localhost" means the phone itself — there is no server to find
  // until the player tells us where one is. Web dev builds always have a same-machine
  // default (see config.js) and skip this screen entirely.
  if (needsServerSetup()) {
    await showServerSetup(pickerEl);
  }
  const API_BASE_URL = getApiBaseUrl();

  const trackId = await showRoutePicker(API_BASE_URL, pickerEl);
  pickerEl.style.display = 'none';
  document.getElementById('renderCanvas').style.display = '';
  document.getElementById('hud').style.display = '';
  document.getElementById('osm-attribution').style.display = '';
  document.getElementById('nav-billboard').style.display = '';

  const chunk = await fetchWorldAndTrack(API_BASE_URL, trackId);
  statusEl.textContent = `Loading ${chunk.chunk_id}…`;

  const canvas = document.getElementById('renderCanvas');
  const engine = new Engine(canvas, true);
  const scene = new Scene(engine);
  scene.clearColor = new Color4(0.53, 0.75, 0.9, 1);

  // HemisphericLight alone defaults groundColor to black, so any surface facing away
  // from straight up (i.e. every vertical building wall) renders toward pure black — the
  // "black buildings" people were seeing. A non-black groundColor simulates bounced sky
  // light; the added DirectionalLight (a low sun angle) gives walls real shading instead
  // of flat, uniform brightness.
  const skyLight = new HemisphericLight('skyLight', new Vector3(0, 1, 0), scene);
  skyLight.groundColor = new Color3(0.35, 0.38, 0.42);
  skyLight.intensity = 0.7;

  const sunLight = new DirectionalLight('sunLight', new Vector3(-0.5, -1, -0.3), scene);
  sunLight.intensity = 0.6;
  await buildScene(scene, chunk);
  statusEl.textContent = `Track: ${chunk.chunk_id} — drive the route!`;

  const car = new CarController(scene, canvas, chunk.start, chunk.buildings);
  const navIndex = buildNavigationIndex(chunk);

  if (shouldShowTouchControls()) {
    const touchEl = document.getElementById('touch-controls');
    touchEl.style.display = '';
    mountTouchControls(touchEl, car);
    document.getElementById('hud-hint-keyboard').style.display = 'none';
  }

  const recorder = new RunRecorder(API_BASE_URL, trackId);
  const ghost = new GhostPlayer(scene);
  await ghost.loadGhost(API_BASE_URL, trackId);

  const audio = new AudioManager();
  const resumeAudioOnce = () => {
    audio.resume();
    window.removeEventListener('keydown', resumeAudioOnce);
    window.removeEventListener('pointerdown', resumeAudioOnce);
  };
  window.addEventListener('keydown', resumeAudioOnce);
  window.addEventListener('pointerdown', resumeAudioOnce);

  const raceState = { nextCheckpointIndex: 0, finished: false };
  let lastCollisionSoundAt = -Infinity;
  const lastStewardCallAt = { speeding: -Infinity, off_road: -Infinity };
  const hudTimerEl = document.getElementById('hud-timer');
  const hudSpeedEl = document.getElementById('hud-speed');
  const hudSpeedValueEl = document.getElementById('hud-speed-value');
  const hudSpeedLimitEl = document.getElementById('hud-speed-limit');
  const finishEl = document.getElementById('finish-overlay');
  const stewardEl = document.getElementById('steward-overlay');
  const navEl = document.getElementById('nav-billboard');

  engine.runRenderLoop(() => {
    const deltaSeconds = engine.getDeltaTime() / 1000;
    const carState = car.update(deltaSeconds);
    audio.updateEngine(carState.speedFraction, car.input.accelerate);

    if (!raceState.finished) {
      recorder.tick(deltaSeconds, carState);
      hudTimerEl.textContent = formatTime(recorder.elapsed);

      // Nearest road segment is used both to warn the player of the current speed limit
      // *before* they get flagged, and to feed the steward triggers below — computed once
      // per frame and shared, rather than twice.
      const nearestRoad =
        chunk.road_segments && chunk.road_segments.length > 0
          ? findNearestRoadSegment(chunk.road_segments, carState.x, carState.z)
          : null;
      updateSpeedHud(hudSpeedEl, hudSpeedValueEl, hudSpeedLimitEl, carState, nearestRoad);
      updateNavigationBillboard(navEl, navIndex, carState, car.heading, nearestRoad);

      if (carState.collided && recorder.elapsed - lastCollisionSoundAt > COLLISION_SOUND_COOLDOWN_S) {
        audio.playCollision();
        lastCollisionSoundAt = recorder.elapsed;
      }

      const crossedCheckpoint = checkCheckpointProgress(carState, chunk.checkpoints, raceState);
      if (crossedCheckpoint) audio.playCheckpoint();
      ghost.update(recorder.elapsed);

      checkStewardTriggers(nearestRoad, carState, recorder, lastStewardCallAt, API_BASE_URL, stewardEl);

      if (raceState.finished) {
        recorder.stop();
        audio.playFinish();
        showFinishPanel(finishEl, API_BASE_URL, trackId, recorder, recorder.elapsed);
      }
    }

    scene.render();
  });

  window.addEventListener('resize', () => engine.resize());
}

// Returns true the frame a checkpoint is actually crossed (used to trigger the sound cue
// exactly once per checkpoint, not every frame the car happens to be near one).
function checkCheckpointProgress(carState, checkpoints, raceState) {
  if (raceState.nextCheckpointIndex >= checkpoints.length) {
    raceState.finished = true;
    return false;
  }

  const target = checkpoints[raceState.nextCheckpointIndex];
  const dx = carState.x - target.x;
  const dz = carState.z - target.z;
  const distance = Math.sqrt(dx * dx + dz * dz);

  if (distance <= CHECKPOINT_RADIUS_M) {
    raceState.nextCheckpointIndex += 1;
    if (raceState.nextCheckpointIndex >= checkpoints.length) raceState.finished = true;
    return true;
  }
  return false;
}

// Live speedometer + the current road's speed limit, shown together so the player can see
// a violation coming and lift off the accelerator instead of only finding out after the AI
// steward already flagged it.
function updateSpeedHud(speedEl, speedValueEl, speedLimitEl, carState, nearestRoad) {
  const speedKmh = Math.round(carState.speedMps * 3.6);
  speedValueEl.textContent = String(speedKmh);

  if (!nearestRoad) {
    speedLimitEl.textContent = 'limit —';
    speedEl.classList.remove('over-limit');
    speedLimitEl.classList.remove('over-limit');
    return;
  }

  const limitKmh = nearestRoad.segment.speed_limit_kmh;
  speedLimitEl.textContent = `limit ${limitKmh}`;
  const over = speedKmh > limitKmh * SPEEDING_THRESHOLD_MULTIPLIER;
  speedEl.classList.toggle('over-limit', over);
  speedLimitEl.classList.toggle('over-limit', over);
}

const TURN_LABEL = { left: 'turn left', right: 'turn right', straight: 'continues straight' };

// Live "You are on: X" + "Ahead: Y — turn left" billboard, built entirely from our own real
// OSM street-name data (see navigationHud.js) — not from Bright Data, which only supplies
// the separate traffic-congestion overlay.
function updateNavigationBillboard(navEl, navIndex, carState, heading, nearestRoad) {
  const currentName = nearestRoad?.segment?.name;
  const currentEl = navEl.querySelector('#nav-current');
  currentEl.textContent = currentName ? `On ${currentName}` : 'Off named road';

  const { ahead } = findNavigationInfo(navIndex, carState.x, carState.z, heading);
  const aheadEl = navEl.querySelector('#nav-ahead');
  if (!ahead) {
    aheadEl.textContent = '';
    aheadEl.style.display = 'none';
    return;
  }

  aheadEl.style.display = '';
  aheadEl.textContent = ahead.options
    .slice(0, 2)
    .map((o) => `${o.name} — ${TURN_LABEL[o.turn]}`)
    .join(' · ');
}

// Checks the two AI Race Steward triggers (speeding, off-road) against the car's position
// relative to the nearest real road segment. Each trigger has its own cooldown so speeding
// down one long straight doesn't spam the steward every frame it stays true.
function checkStewardTriggers(nearestRoad, carState, recorder, lastStewardCallAt, apiBaseUrl, stewardEl) {
  if (!nearestRoad) return;

  const speedKmh = carState.speedMps * 3.6;
  const limitKmh = nearestRoad.segment.speed_limit_kmh;
  const halfWidth = nearestRoad.segment.width_m / 2;
  const isOffRoad = nearestRoad.distance > halfWidth + OFFROAD_MARGIN_M;

  if (
    speedKmh > limitKmh * SPEEDING_THRESHOLD_MULTIPLIER &&
    recorder.elapsed - lastStewardCallAt.speeding > STEWARD_COOLDOWN_S
  ) {
    lastStewardCallAt.speeding = recorder.elapsed;
    reportToSteward(apiBaseUrl, stewardEl, recorder, 'speeding', {
      speed_kmh: Math.round(speedKmh),
      limit_kmh: limitKmh,
      position: { x: carState.x, z: carState.z },
    });
  }

  if (isOffRoad && recorder.elapsed - lastStewardCallAt.off_road > STEWARD_COOLDOWN_S) {
    lastStewardCallAt.off_road = recorder.elapsed;
    reportToSteward(apiBaseUrl, stewardEl, recorder, 'off_road', {
      distance_from_road_m: Math.round(nearestRoad.distance),
      position: { x: carState.x, z: carState.z },
    });
  }
}

// The whole road network/buildings/footpaths come from /api/world/full (cached server-side,
// identical for every race), the track-specific start point and finish checkpoint come from
// /api/tracks/:id, and any live traffic-congestion data (scraped via Bright Data, see
// data-pipeline/match_traffic_to_roads.js) comes from /api/live/traffic — merged into one
// object so the rest of the app can treat it as a single chunk, same as before.
async function fetchWorldAndTrack(apiBaseUrl, trackId) {
  const [worldResponse, trackResponse, trafficResponse] = await Promise.all([
    fetch(`${apiBaseUrl}/api/world/full`),
    fetch(`${apiBaseUrl}/api/tracks/${trackId}`),
    fetch(`${apiBaseUrl}/api/live/traffic`),
  ]);
  const world = await worldResponse.json();
  const track = await trackResponse.json();
  const traffic = await trafficResponse.json();
  return { ...world, ...track, traffic };
}

main().catch((err) => {
  statusEl.textContent = `Error: ${err.message}`;
  console.error(err);
});
