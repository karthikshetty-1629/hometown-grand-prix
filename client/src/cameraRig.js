// Three driving views (cycle with V): chase (default third-person), drone (high overhead
// follow), and driver (first-person, roughly windshield height). All three smooth toward
// their target position/orientation instead of snapping instantly — the old single chase
// camera re-aimed itself exactly "directly behind the car's current heading" every single
// frame with no smoothing, so a quick steering input swung the camera hard enough to sweep
// through nearby buildings. Chase and drone also raycast against tagged building meshes and
// pull the camera closer if a wall is between it and the car, so buildings can no longer
// clip into (or block) the view.

import { UniversalCamera, Vector3 } from '@babylonjs/core';

const VIEW_MODES = ['chase', 'drone', 'driver'];

const CHASE_DISTANCE_M = 12;
const CHASE_HEIGHT_M = 5.5;
const DRONE_DISTANCE_M = 26;
const DRONE_HEIGHT_M = 32;
const DRIVER_FORWARD_OFFSET_M = 0.4;
const DRIVER_HEIGHT_M = 1.15;
const DRIVER_LOOK_AHEAD_M = 12;

const POSITION_SMOOTHING_RATE = 7; // higher = snappier / less lag behind the car
const TARGET_SMOOTHING_RATE = 9;
const OBSTRUCTION_MARGIN_M = 1.2; // how far in front of a hit wall the camera stops
const MIN_CAMERA_DISTANCE_M = 2;

export class CameraRig {
  constructor(scene, streetSpace) {
    this.streetSpace = streetSpace;
    this.scene = scene;
    this.camera = new UniversalCamera('gameCam', new Vector3(0, 5, -10), scene);
    this.camera.minZ = 0.1;
    this.camera.maxZ = 1400;
    this.modeIndex = 0;
    this._smoothedPosition = null;
    this._smoothedTarget = null;
    this._bindViewSwitch();
  }

  get mode() {
    return VIEW_MODES[this.modeIndex];
  }

  _bindViewSwitch() {
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyV') {
        this.modeIndex = (this.modeIndex + 1) % VIEW_MODES.length;
      }
    });
  }

  update(deltaSeconds, carPosition, carHeading) {
    const forward = new Vector3(Math.sin(carHeading), 0, Math.cos(carHeading));
    const mode = this.mode;

    let desiredPosition;
    let desiredTarget;
    let avoidObstruction = true;

    if (mode === 'driver') {
      desiredPosition = carPosition
        .add(forward.scale(DRIVER_FORWARD_OFFSET_M))
        .add(new Vector3(0, DRIVER_HEIGHT_M, 0));
      desiredTarget = desiredPosition.add(forward.scale(DRIVER_LOOK_AHEAD_M));
      avoidObstruction = false; // camera already sits at the car, nothing to clip through
    } else if (mode === 'drone') {
      const behind = forward.scale(-DRONE_DISTANCE_M);
      desiredPosition = new Vector3(carPosition.x + behind.x, DRONE_HEIGHT_M, carPosition.z + behind.z);
      desiredTarget = carPosition.add(new Vector3(0, 1, 0));
    } else {
      const behind = forward.scale(-CHASE_DISTANCE_M);
      desiredPosition = new Vector3(carPosition.x + behind.x, carPosition.y + CHASE_HEIGHT_M, carPosition.z + behind.z);
      desiredTarget = carPosition.add(new Vector3(0, 1, 0));
    }

    if (avoidObstruction) {
      desiredPosition = this._pullInFrontOfObstruction(desiredTarget, desiredPosition);
    }

    if (!this._smoothedPosition) {
      this._smoothedPosition = desiredPosition.clone();
      this._smoothedTarget = desiredTarget.clone();
    } else {
      // Frame-rate-independent exponential smoothing, not a fixed-fraction lerp -- stays
      // consistent whether the game runs at 30fps or 144fps.
      const posT = 1 - Math.exp(-POSITION_SMOOTHING_RATE * deltaSeconds);
      const targetT = 1 - Math.exp(-TARGET_SMOOTHING_RATE * deltaSeconds);
      Vector3.LerpToRef(this._smoothedPosition, desiredPosition, posT, this._smoothedPosition);
      Vector3.LerpToRef(this._smoothedTarget, desiredTarget, targetT, this._smoothedTarget);
    }

    this.camera.position.copyFrom(this._smoothedPosition);
    this.camera.setTarget(this._smoothedTarget);
  }

  _pullInFrontOfObstruction(target, desiredPosition) {
    const offset = desiredPosition.subtract(target);
    const fullDistance = offset.length();
    if (fullDistance < 1e-3) return desiredPosition;
    const dir = offset.scale(1 / fullDistance);

    // Spatial footprint lookup avoids raycasting every triangle in the city.
    for (let d = 1; d < fullDistance; d += .7) {
      const p = target.add(dir.scale(d));
      const blocked = this.streetSpace?.nearby(p, this.streetSpace.buildingCells).some(b =>
        (b.height_m || 12) > p.y && this.streetSpace.inBuilding(p, .4));
      if (blocked) return target.add(dir.scale(Math.max(MIN_CAMERA_DISTANCE_M, d - OBSTRUCTION_MARGIN_M)));
    }
    return desiredPosition;
  }
}

function isBuildingMesh(mesh) {
  let node = mesh;
  while (node) {
    if (node.metadata?.isBuilding) return true;
    node = node.parent;
  }
  return false;
}
