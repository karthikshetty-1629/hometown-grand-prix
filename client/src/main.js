import {routeInstruction} from './routeGuidance.js';
import { loadVehicleAssets } from './vehicleAssets.js';
import { Engine, Scene, HemisphericLight, DirectionalLight, Vector3, Color3, Color4, CubeTexture, ShadowGenerator } from '@babylonjs/core';
import { buildScene } from './sceneBuilder.js';
import { CarController } from './carController.js';
import { RunRecorder } from './runRecorder.js';
import { GhostPlayer } from './ghostPlayer.js';
import { CitySimulation } from './citySimulation.js';
import { Multiplayer } from './multiplayer.js';
import { driveSession } from './routePicker.js';
import { showRoutePicker } from './routePicker.js';
import { getApiBaseUrl, needsServerSetup } from './config.js';
import { showServerSetup } from './serverSetup.js';
import { shouldShowTouchControls, mountTouchControls } from './touchControls.js';
import { AudioManager } from './audioManager.js';
import { showFinishPanel, formatTime } from './finishPanel.js';
import { findNearestRoadSegment } from './roadLookup.js';
import { buildNavigationIndex, findNavigationInfo } from './navigationHud.js';

const CHECKPOINT_RADIUS_M = 8; // wider than the old rail-guided value — free driving means
// the car is realistically off the exact road centerline sometimes
const COLLISION_SOUND_COOLDOWN_S = 0.4; // scraping a wall spans many frames — don't spam the thud
const SPEEDING_THRESHOLD_MULTIPLIER = 1.1; // 10% over the (heuristic) road-class speed limit

const loading=document.getElementById('city-loading');
async function loadingStage(percent,label){loading.hidden=false;loading.querySelector('progress').value=percent;loading.querySelector('[role=status]').textContent=label;await new Promise(r=>setTimeout(r,30));}
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
  await loadingStage(12,'Finding your route through San Jose…');
  const chunk = await fetchWorldAndTrack(API_BASE_URL, trackId);
  pickerEl.style.display = 'none';
  document.getElementById('renderCanvas').style.display = '';
  document.getElementById('hud').style.display = '';
  document.getElementById('osm-attribution').style.display = '';
  document.getElementById('nav-billboard').style.display = '';

  statusEl.textContent = `Loading ${chunk.chunk_id}…`;

  const canvas = document.getElementById('renderCanvas');
  const engine = new Engine(canvas, true, {powerPreference:'high-performance'});
  engine.setHardwareScalingLevel(1);
  const scene = new Scene(engine);
  scene.clearColor = new Color4(.72,.8,.81,1);
  scene.fogMode = Scene.FOGMODE_EXP2;
  scene.fogDensity = .0006;
  scene.fogColor = new Color3(.72,.8,.81);

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
  scene.environmentTexture = CubeTexture.CreateFromPrefilteredData('/models/environment.env', scene);
  scene.environmentIntensity = .65;
  scene.imageProcessingConfiguration.exposure = 1.15;
  scene.imageProcessingConfiguration.contrast = 1.12;
  await loadingStage(25,'Getting your car ready…');
  await loadVehicleAssets(scene);
  await buildScene(scene, chunk, loadingStage);
  statusEl.textContent = driveSession.mode === 'drive' ? 'SAN JOSE · FREE DRIVE' : 'SAN JOSE · RACE TO YOUR FINISH';

  const car = new CarController(scene, canvas, chunk.start, chunk.buildings, chunk.streetSpace);
  const shadows = new ShadowGenerator(512, sunLight);
  shadows.usePercentageCloserFiltering = true;
  shadows.blurKernel = 16;
  for (const mesh of car.mesh.getChildMeshes()) shadows.addShadowCaster(mesh, false);
  const navIndex = buildNavigationIndex(chunk);
  if(driveSession.mode === 'drive' && !driveSession.hasDestination) chunk.navigation_path = [];

  if (shouldShowTouchControls()) {
    const touchEl = document.getElementById('touch-controls');
    touchEl.style.display = '';
    mountTouchControls(touchEl, car);
    document.getElementById('hud-hint-keyboard').style.display = 'none';
  }

  const recorder = new RunRecorder(API_BASE_URL, trackId);
  const ghost = new GhostPlayer(scene);
  if (driveSession.mode === 'race' && !driveSession.room) await ghost.loadGhost(API_BASE_URL, trackId);
  const simulation = new CitySimulation(scene, chunk, car, recorder);
  const multiplayer = new Multiplayer(API_BASE_URL, scene);

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
  const hudTimerEl = document.getElementById('hud-timer');
  const hudSpeedEl = document.getElementById('hud-speed');
  const hudSpeedValueEl = document.getElementById('hud-speed-value');
  const hudSpeedLimitEl = document.getElementById('hud-speed-limit');
  const finishEl = document.getElementById('finish-overlay');
  const navEl = document.getElementById('nav-billboard');

  await loadingStage(95,'Warming up the engine…');
  await scene.whenReadyAsync();
  loading.hidden=true;
  let hudTick=0, performanceTick=0, frameCount=0;
  engine.runRenderLoop(() => {
    const deltaSeconds = Math.min(engine.getDeltaTime() / 1000, .1);
    const carState = car.update(multiplayer.started && !raceState.finished ? deltaSeconds : 0);
    multiplayer.update(carState);
    audio.updateEngine(carState.speedFraction, car.input.accelerate);

    if (!raceState.finished && multiplayer.started) {
      recorder.tick(deltaSeconds, carState);
      hudTick += deltaSeconds;

      // Nearest road segment is used both to warn the player of the current speed limit
      // *before* they get flagged, and to feed the steward triggers below — computed once
      // per frame and shared, rather than twice.
      const nearestRoad = chunk.streetSpace.nearest(carState);
      if(hudTick>=.1){
        hudTick=0;hudTimerEl.textContent=formatTime(recorder.elapsed);
        updateSpeedHud(hudSpeedEl,hudSpeedValueEl,hudSpeedLimitEl,carState,nearestRoad);
        if(chunk.navigation_path?.length){
          const instruction=routeInstruction(chunk.navigation_path,carState,car.heading);
          navEl.querySelector('#nav-current').textContent=instruction.title;
          navEl.querySelector('#nav-ahead').textContent=instruction.detail;
          simulation.nextTurn=instruction.turn;
        }else updateNavigationBillboard(navEl,navIndex,carState,car.heading,nearestRoad);
      }

      if (carState.collided && recorder.elapsed - lastCollisionSoundAt > COLLISION_SOUND_COOLDOWN_S) {
        audio.playCollision();
        lastCollisionSoundAt = recorder.elapsed;
      }

      simulation.update(deltaSeconds, carState, nearestRoad);
      const crossedCheckpoint = driveSession.mode === 'race' && !simulation.rules.wanted && checkCheckpointProgress(carState, chunk.checkpoints, raceState);
      if (crossedCheckpoint) audio.playCheckpoint();
      ghost.update(recorder.elapsed);



      if (raceState.finished) {
        recorder.stop();
        audio.playFinish();
        if (driveSession.room) multiplayer.finished = recorder.elapsed;
        else showFinishPanel(finishEl, API_BASE_URL, trackId, recorder, recorder.elapsed);
      }
    }

    scene.render();
    frameCount++;performanceTick+=engine.getDeltaTime();
    if(performanceTick>2000){
      const fps=Math.round(frameCount*1000/performanceTick);
      document.getElementById('performance-readout').textContent=`${fps} FPS`;
      if(fps<26 && engine.getHardwareScalingLevel()<2)engine.setHardwareScalingLevel(Math.min(2,engine.getHardwareScalingLevel()+.2));
      frameCount=0;performanceTick=0;
    }
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
  const speedKmh = Math.round(carState.speedMps * 2.23694);
  speedValueEl.textContent = String(speedKmh);

  if (!nearestRoad) {
    speedLimitEl.textContent = 'limit —';
    speedEl.classList.remove('over-limit');
    speedLimitEl.classList.remove('over-limit');
    return;
  }

  const limitKmh = Math.round(nearestRoad.segment.speed_limit_kmh / 1.609344);
  speedLimitEl.textContent = `${nearestRoad.segment.speed_source === 'osm' ? 'limit' : 'est.'} ${limitKmh}`;
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

// The whole road network/buildings/footpaths come from /api/world/full (cached server-side,
// identical for every race), the track-specific start point and finish checkpoint come from
// /api/tracks/:id, and any live traffic-congestion data (scraped via Bright Data, see
// data-pipeline/match_traffic_to_roads.js) comes from /api/live/traffic — merged into one
// object so the rest of the app can treat it as a single chunk, same as before.
async function fetchWorldAndTrack(apiBaseUrl, trackId) {
  const [worldResponse, trackResponse] = await Promise.all([
    fetch(`${apiBaseUrl}/api/world/full`),
    fetch(`${apiBaseUrl}/api/tracks/${trackId}`),
  ]);
  if (!worldResponse.ok || !trackResponse.ok) throw new Error('Could not load this city or route. Please reload and try again.');
  const world = await worldResponse.json();
  const track = await trackResponse.json();
  return { ...world, ...track };
}

main().catch((err) => {
  loading.hidden=false;loading.querySelector('[role=status]').textContent=`Could not start: ${err.message}`;loading.querySelector('button').hidden=false;
  statusEl.textContent = `Error: ${err.message}`;
  const routeStatus = document.getElementById('route-status');
  if (routeStatus) { routeStatus.textContent = `Could not start: ${err.message}. Reload to retry.`; routeStatus.classList.add('error'); }
  console.error(err);
});
