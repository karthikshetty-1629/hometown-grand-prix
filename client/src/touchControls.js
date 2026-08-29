// On-screen touch controls for phones/tablets: pedals bottom-right, steering bottom-left,
// view-switch top-right — same layout convention as most mobile arcade racers. Only mounted
// when the device actually uses touch (coarse pointer) so desktop/keyboard play is untouched.
// Drives the exact same `car.input` flags the keyboard handler in carController.js sets, and
// cycles the camera the same way KeyV does, so both input paths stay in sync with zero
// duplicated game logic.

export function shouldShowTouchControls() {
  return window.matchMedia('(pointer: coarse)').matches;
}

export function mountTouchControls(container, car) {
  container.innerHTML = `
    <div id="touch-steer">
      <button id="touch-left" class="touch-btn" aria-label="Steer left">&#9664;</button>
      <button id="touch-right" class="touch-btn" aria-label="Steer right">&#9654;</button>
    </div>
    <div id="touch-pedals">
      <button id="touch-brake" class="touch-btn touch-btn-round" aria-label="Brake">&#9660;</button>
      <button id="touch-accelerate" class="touch-btn touch-btn-round" aria-label="Accelerate">&#9650;</button>
    </div>
    <button id="touch-view" class="touch-btn touch-btn-small" aria-label="Switch view">&#8635;</button>
  `;

  bindHold(container.querySelector('#touch-left'), (down) => (car.input.left = down));
  bindHold(container.querySelector('#touch-right'), (down) => (car.input.right = down));
  bindHold(container.querySelector('#touch-accelerate'), (down) => (car.input.accelerate = down));
  bindHold(container.querySelector('#touch-brake'), (down) => (car.input.brake = down));

  container.querySelector('#touch-view').addEventListener('pointerdown', (e) => {
    e.preventDefault();
    car.cameraRig.modeIndex = (car.cameraRig.modeIndex + 1) % 3;
  });
}

// Pointer (not touch) events so this also works with a mouse during desktop testing;
// pointer capture keeps the "up" firing even if the finger slides off the button.
function bindHold(button, setDown) {
  const start = (e) => {
    e.preventDefault();
    button.setPointerCapture(e.pointerId);
    setDown(true);
  };
  const end = (e) => {
    e.preventDefault();
    setDown(false);
  };
  button.addEventListener('pointerdown', start);
  button.addEventListener('pointerup', end);
  button.addEventListener('pointercancel', end);
}
