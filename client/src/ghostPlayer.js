// Loads a previously saved ghost run and plays it back as a translucent car, moving to
// the interpolated position matching the current race time each frame.

import { Color3 } from '@babylonjs/core';
import { createCarMesh } from './carMesh.js';

export class GhostPlayer {
  constructor(scene) {
    this.scene = scene;
    this.samples = null;
    this.mesh = null;
  }

  async loadGhost(apiBaseUrl, trackId) {
    const response = await fetch(`${apiBaseUrl}/api/ghosts/${trackId}`);
    if (!response.ok) return false;

    const { runs } = await response.json();
    if (!runs || runs.length === 0) return false;

    // Most recent run becomes the ghost to race against.
    const latest = runs.reduce((a, b) => (a.recorded_at > b.recorded_at ? a : b));
    this.samples = latest.samples;
    this._createGhostMesh();
    return true;
  }

  _createGhostMesh() {
    this.mesh = createCarMesh(this.scene, {
      name: 'ghostCar',
      bodyColor: new Color3(0.55, 0.6, 1),
      alpha: 0.45,
    });
  }

  // Call every frame with the current race time in seconds.
  update(currentTimeSeconds) {
    if (!this.samples || !this.mesh) return;

    const { a, b, t } = findSurroundingSamples(this.samples, currentTimeSeconds);
    if (!a) return;

    const x = lerp(a.x, b.x, t);
    const z = lerp(a.z, b.z, t);
    const rot = lerp(a.rot, b.rot, t);

    this.mesh.position.x = x;
    this.mesh.position.z = z;
    this.mesh.rotation.y = (rot * Math.PI) / 180;
  }
}

function findSurroundingSamples(samples, time) {
  if (time <= samples[0].t) return { a: samples[0], b: samples[0], t: 0 };
  if (time >= samples[samples.length - 1].t) {
    const last = samples[samples.length - 1];
    return { a: last, b: last, t: 0 };
  }

  for (let i = 0; i < samples.length - 1; i++) {
    const a = samples[i];
    const b = samples[i + 1];
    if (time >= a.t && time <= b.t) {
      const span = b.t - a.t;
      const t = span === 0 ? 0 : (time - a.t) / span;
      return { a, b, t };
    }
  }

  return { a: null, b: null, t: 0 };
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}
