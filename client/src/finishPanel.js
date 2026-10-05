// Post-race screen: shows the finished time, lets the player save it under a name, then
// shows the leaderboard — every saved ghost run for this track, sorted by finish time. A
// run's "time" is just its last recorded sample's timestamp, since runRecorder only ever
// uploads a run after it crosses the final checkpoint (see main.js), so every saved run is
// a completed one.

export function formatTime(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = (totalSeconds % 60).toFixed(2);
  return `${minutes}:${seconds.padStart(5, '0')}`;
}

export function showFinishPanel(container, apiBaseUrl, trackId, recorder, finalTimeSeconds) {
  container.innerHTML = `
    <div id="finish-card">
      <button id="finish-home" style="float:right;background:none;border:0;color:#d5fc51;cursor:pointer">← City</button>
      <h2>Finished!</h2>
      <p id="finish-time">${formatTime(finalTimeSeconds)}</p>
      <div id="finish-save-row">
        <input id="finish-name-input" type="text" placeholder="Your name" maxlength="24" autocapitalize="words" autocomplete="off" />
        <button id="finish-save-btn">Save score</button>
      </div>
      <p id="finish-status"></p>
      <div id="finish-leaderboard" style="display:none">
        <h3>Leaderboard</h3>
        <ol id="finish-leaderboard-list"></ol>
        <button id="finish-play-again">Play again</button>
      </div>
    </div>
  `;
  container.style.display = '';
  container.querySelector('#finish-home').onclick = () => location.reload();

  const input = container.querySelector('#finish-name-input');
  const saveBtn = container.querySelector('#finish-save-btn');
  const status = container.querySelector('#finish-status');
  const board = container.querySelector('#finish-leaderboard');
  const list = container.querySelector('#finish-leaderboard-list');
  const playAgainBtn = container.querySelector('#finish-play-again');

  const save = async () => {
    const name = input.value.trim() || 'Anonymous';
    saveBtn.disabled = true;
    status.textContent = 'Saving…';
    try {
      await recorder.upload(name);
      status.textContent = '';
      await renderLeaderboard(apiBaseUrl, trackId, list);
      board.style.display = '';
    } catch (err) {
      status.textContent = `Could not save: ${err.message}`;
      saveBtn.disabled = false;
    }
  };

  saveBtn.addEventListener('click', save);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') save();
  });
  playAgainBtn.addEventListener('click', () => window.location.reload());
}

async function renderLeaderboard(apiBaseUrl, trackId, listEl) {
  const response = await fetch(`${apiBaseUrl}/api/ghosts/${trackId}`);
  const { runs } = await response.json();

  const scored = runs
    .map((run) => ({
      name: run.player_name,
      time: run.samples[run.samples.length - 1]?.t ?? Infinity,
    }))
    .sort((a, b) => a.time - b.time)
    .slice(0, 10);

  listEl.innerHTML = scored.map((r) => `<li>${escapeHtml(r.name)} — ${formatTime(r.time)}</li>`).join('');
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
