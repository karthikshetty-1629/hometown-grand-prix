import { constrainToRoad } from './roadBoundary.js';
import { driveSession } from './routePicker.js';
import { Color3, Vector3 } from '@babylonjs/core';
import { createCarMesh } from './carMesh.js';
import { CameraRig } from './cameraRig.js';
import { buildBuildingColliders, resolveBuildingCollisions } from './collision.js';

const MAX_SPEED_MPS = 22; // top forward speed
const MAX_REVERSE_SPEED_MPS = 8;
const BASE_ACCELERATION_MPS2 = 9; // reached only once at/near top speed — see accelerationCurve()
const MIN_ACCELERATION_FRACTION = 0.35; // launch acceleration is this fraction of base — a real
// car doesn't hit full pull from a dead stop; it builds as it goes
const BRAKE_DECEL_MPS2 = 16; // braking bites harder than accelerating
const COAST_DECEL_MPS2 = 5; // natural slow-down with no input held, so releasing keys stops the car
const STEER_RATE_RAD_S = 2.3; // max yaw rate at full steering lock
const STEER_INPUT_SMOOTHING_RATE = 4; // how fast the steering input itself ramps toward
// full lock — this is what makes a tap feel gentle instead of snapping the wheel over
const MIN_TURN_SPEED_MPS = 2.5; // steering effect ramps to zero below this (no spinning in place)
const CAR_COLLISION_RADIUS_M = 1.0;
const COLLISION_SPEED_DAMPING = 0.9; // scraping a wall bleeds a bit of speed each frame

export class CarController {
  constructor(scene, canvas, start, buildings = [], streetSpace) {
    this.scene = scene;
    this.streetSpace = streetSpace;
    this.buildingColliders = buildBuildingColliders(buildings);

    const startPoint = start || { x: 0, z: 0, dirX: 0, dirZ: 1 };
    this.position = new Vector3(startPoint.x, 0, startPoint.z);
    this.heading = Math.atan2(startPoint.dirX ?? 0, startPoint.dirZ ?? 1);

    this.speed = 0; // signed: positive = forward, negative = reverse
    this._steerValue = 0; // smoothed steering input, ramps toward the target instead of snapping

    this.input = { accelerate: false, brake: false, left: false, right: false };
    this._bindInput();

    this.mesh = this._createCarMesh();
    this.cameraRig = new CameraRig(scene, streetSpace);
    this.camera = this.cameraRig.camera;
  }

  _bindInput() {
    const keyMap = {
      ArrowUp: 'accelerate',
      KeyW: 'accelerate',
      ArrowDown: 'brake',
      KeyS: 'brake',
      ArrowLeft: 'left',
      KeyA: 'left',
      ArrowRight: 'right',
      KeyD: 'right',
    };
    window.addEventListener('keydown', (e) => {
      if (keyMap[e.code]) { e.preventDefault(); this.input[keyMap[e.code]] = true; }
    });
    window.addEventListener('blur', () => { Object.keys(this.input).forEach(k => this.input[k] = false); });
    window.addEventListener('keyup', (e) => {
      if (keyMap[e.code]) this.input[keyMap[e.code]] = false;
    });
  }

  _createCarMesh() {
    return createCarMesh(this.scene, { name: 'car', bodyColor: Color3.FromHexString(driveSession.color) });
  }

  // Returns { x, z, rot } for the current frame — used by runRecorder.
  update(deltaSeconds) {
    // --- Accelerate / brake / coast ---
    if (this.input.accelerate) {
      // Real cars don't hit full pull from a dead stop — launch acceleration is weaker,
      // building toward full strength as speed climbs. Lifting off the accelerator still
      // coasts down immediately (the branch below), so easing off early is how you actually
      // hold under a speed limit rather than just flooring it everywhere.
      const speedFraction = clamp(Math.abs(this.speed) / MAX_SPEED_MPS, 0, 1);
      const accelerationMultiplier = MIN_ACCELERATION_FRACTION + (1 - MIN_ACCELERATION_FRACTION) * speedFraction;
      this.speed += BASE_ACCELERATION_MPS2 * accelerationMultiplier * deltaSeconds;
    } else if (this.input.brake) {
      this.speed -= BRAKE_DECEL_MPS2 * deltaSeconds;
    } else if (this.speed > 0) {
      this.speed = Math.max(0, this.speed - COAST_DECEL_MPS2 * deltaSeconds);
    } else if (this.speed < 0) {
      this.speed = Math.min(0, this.speed + COAST_DECEL_MPS2 * deltaSeconds);
    }
    this.speed = clamp(this.speed, -MAX_REVERSE_SPEED_MPS, MAX_SPEED_MPS);

    // --- Steer (only takes effect once actually moving; reverses feel when backing up,
    // same as a real car) ---
    // The raw key state is a hard on/off, which used to snap the wheel straight to full
    // lock the instant a key was pressed. Smoothing the input itself toward that target
    // (not just the resulting turn rate) is what actually gives a gentle-tap-in feel.
    let targetSteer = 0;
    if (this.input.left) targetSteer -= 1;
    if (this.input.right) targetSteer += 1;
    const steerSmoothingT = 1 - Math.exp(-STEER_INPUT_SMOOTHING_RATE * deltaSeconds);
    this._steerValue += (targetSteer - this._steerValue) * steerSmoothingT;

    const turnFactor = clamp(Math.abs(this.speed) / MIN_TURN_SPEED_MPS, 0, 1);
    const speedSign = Math.sign(this.speed);
    const previousHeading = this.heading;
    this.heading += this._steerValue * STEER_RATE_RAD_S * turnFactor * speedSign * deltaSeconds;

    // --- Move forward along heading ---
    const forward = new Vector3(Math.sin(this.heading), 0, Math.cos(this.heading));
    const proposed = this.position.add(forward.scale(this.speed * deltaSeconds));
    const curb = constrainToRoad(this.streetSpace, this.position, proposed, 1.05, this.heading);
    this.position.x = curb.x; this.position.z = curb.z;
    if (curb.hit) { this.speed *= Math.exp(-8 * deltaSeconds); this.heading=previousHeading; }

    // --- Collision: buildings only now (no single road corridor to constrain to) ---
    const buildingResult = resolveBuildingCollisions(
      this.position.x,
      this.position.z,
      CAR_COLLISION_RADIUS_M,
      this.buildingColliders
    );
    this.position.x = buildingResult.x;
    this.position.z = buildingResult.z;
    if (buildingResult.hit) {
      this.speed *= COLLISION_SPEED_DAMPING;
    }

    this.mesh.position.x = this.position.x;
    this.mesh.position.z = this.position.z;
    this.mesh.rotation.y = this.heading;

    this.cameraRig.update(deltaSeconds, this.mesh.position, this.heading);
    // Driver view puts the camera inside the car's own cabin geometry -- hide the mesh
    // there (standard for cars with no modeled interior), show it for the outside views.
    this.mesh.setEnabled(this.cameraRig.mode !== 'driver');

    return {
      x: round2(this.position.x),
      z: round2(this.position.z),
      rot: round2((this.heading * 180) / Math.PI),
      speedFraction: round2(Math.abs(this.speed) / MAX_SPEED_MPS),
      speedMps: round2(Math.abs(this.speed)),
      collided: buildingResult.hit,
    };
  }
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round2(n) {
  return Math.round(n * 100) / 100;
}
