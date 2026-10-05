// Records the live player's path while driving, then uploads it as a ghost run once
// the race finishes (last checkpoint crossed). Samples ~10 times/second per the spec.

const SAMPLE_INTERVAL_S = 0.1;

export class RunRecorder {
  constructor(apiBaseUrl, trackId) {
    this.apiBaseUrl = apiBaseUrl;
    this.trackId = trackId;
    this.samples = [];
    this._timeSinceLastSample = SAMPLE_INTERVAL_S; // sample immediately on first tick
    this.elapsed = 0;
    this.recording = true;
  }

  // Call every frame with deltaSeconds and the car's current { x, z, rot }.
  tick(deltaSeconds, carState) {
    if (!this.recording) return;

    this.elapsed += deltaSeconds;
    this._timeSinceLastSample += deltaSeconds;

    if (this._timeSinceLastSample >= SAMPLE_INTERVAL_S) {
      this._timeSinceLastSample = 0;
      this.samples.push({
        t: Math.round(this.elapsed * 100) / 100,
        x: carState.x,
        z: carState.z,
        rot: carState.rot,
      });
    }
  }

  stop() {
    const last = this.samples[this.samples.length - 1];
    if (last) this.samples.push({ ...last, t: Math.round(this.elapsed * 100) / 100 });
    this.recording = false;
  }

  // A steward penalty just adds straight to elapsed time, same as a real race time penalty —
  // the next recorded sample (and the final finish time) reflects it automatically.
  addPenalty(seconds) {
    this.elapsed += seconds;
  }

  async upload(playerName) {
    const response = await fetch(`${this.apiBaseUrl}/api/ghosts/${this.trackId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ player_name: playerName, samples: this.samples }),
    });

    if (!response.ok) {
      throw new Error(`Failed to upload run: ${response.status}`);
    }

    return response.json();
  }
}
