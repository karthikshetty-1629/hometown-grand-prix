// All sound here is synthesized with the Web Audio API rather than sampled audio files —
// keeps the project fully offline/local with nothing to source or license, consistent with
// everything else built so far. Engine pitch/volume track the car's live speed and throttle
// input every frame; short one-shot cues punctuate checkpoints, wall/building hits, and the
// finish.
//
// Browsers block audio output until a real user gesture, so the context is created suspended
// and resume() must be called from the first keydown/pointerdown the page sees (main.js does
// this once, then removes the listener).

export class AudioManager {
  constructor() {
    this.ctx = null;
    this.engineOsc = null;
    this.engineGain = null;
    this.engineFilter = null;
  }

  resume() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new Ctx();
    this._startEngine();
  }

  _startEngine() {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 55;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 500;

    const gain = ctx.createGain();
    gain.gain.value = 0;

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    osc.start();

    this.engineOsc = osc;
    this.engineGain = gain;
    this.engineFilter = filter;
  }

  // speedFraction: 0..1 of top speed (either direction). accelerating: throttle currently held.
  //
  // Called every render frame (~60Hz) — direct assignment already updates smoothly enough at
  // that rate. `setTargetAtTime` was used here originally for a smoother approach curve, but
  // it schedules a new automation point on the AudioParam's timeline every call and never
  // clears the old ones; called every frame, that queue grows without bound for as long as
  // the race runs. Prime suspect for a real, reproduced bug (FPS falling from ~22 to ~4
  // within seconds of driving) since it's the one thing in the per-frame path whose cost
  // grows with elapsed time rather than scene size.
  updateEngine(speedFraction, accelerating) {
    if (!this.ctx) return;
    this.engineOsc.frequency.value = 55 + speedFraction * 220 + (accelerating ? 35 : 0);
    this.engineGain.gain.value = 0.05 + speedFraction * 0.12 + (accelerating ? 0.03 : 0);
    this.engineFilter.frequency.value = 500 + speedFraction * 2500;
  }

  playCheckpoint() {
    this._blip(880, 0.12, 'sine', 0);
  }

  playFinish() {
    [660, 880, 1100, 1320].forEach((freq, i) => this._blip(freq, 0.18, 'triangle', i * 0.12));
  }

  playCollision() {
    this._noiseThud();
  }

  _blip(freq, duration, type, delay) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const start = ctx.currentTime + delay;

    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(0.25, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, start + duration);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(start);
    osc.stop(start + duration + 0.02);
  }

  _noiseThud() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const bufferSize = Math.floor(ctx.sampleRate * 0.15);
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
    }

    const noise = ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 300;

    const gain = ctx.createGain();
    gain.gain.value = 0.35;

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    noise.start();
  }
}
