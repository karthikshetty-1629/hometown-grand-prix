// Pre-game screen: draws the real downloaded street network as a schematic 2D map (no
// satellite/street imagery — that would require a paid map-tile API; this draws the actual
// OSM road geometry we already have, which stays free and fully local) and lets the player
// click a start and a finish point on real streets. Resolves with the generated chunk_id
// once the player confirms a route.

const ROAD_COLOR = 'rgba(140, 150, 168, 0.55)';
const START_COLOR = '#2ecc71';
const END_COLOR = '#ff5c5c';
const BG_COLOR = '#12141a';
const PADDING_PX = 40;

export function showRoutePicker(apiBaseUrl, container) {
  return new Promise((resolve) => {
    init(apiBaseUrl, container, resolve);
  });
}

async function init(apiBaseUrl, container, resolve) {
  container.innerHTML = `
    <div id="picker-header">
      <h1>Hometown Grand Prix</h1>
      <p>Plan a race route through Downtown San Jose's real streets</p>
    </div>

    <div id="picker-map-frame">
      <canvas id="picker-canvas"></canvas>

      <div id="picker-loading">
        <div class="spinner"></div>
        <span>Loading street map…</span>
      </div>

      <div id="picker-hud">
        <ol id="picker-steps">
          <li data-step="start"><span class="step-num">1</span>Set start</li>
          <li data-step="end"><span class="step-num">2</span>Set finish</li>
          <li data-step="generate"><span class="step-num">3</span>Generate route</li>
        </ol>

        <p id="picker-status">Loading street map…</p>

        <div id="picker-legend">
          <span><i class="dot" style="background:${START_COLOR}"></i>Start</span>
          <span><i class="dot" style="background:${END_COLOR}"></i>Finish</span>
        </div>

        <div id="picker-buttons">
          <button id="picker-generate" disabled>Generate Route</button>
          <button id="picker-reset">Reset</button>
        </div>
      </div>

      <div id="picker-attribution">
        Map data &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors, ODbL
      </div>
    </div>
  `;

  const frame = container.querySelector('#picker-map-frame');
  const canvas = container.querySelector('#picker-canvas');
  const loadingEl = container.querySelector('#picker-loading');
  const statusEl = container.querySelector('#picker-status');
  const generateBtn = container.querySelector('#picker-generate');
  const resetBtn = container.querySelector('#picker-reset');
  const stepEls = container.querySelectorAll('#picker-steps li');
  const ctx = canvas.getContext('2d');

  // Static road network is drawn once onto an offscreen layer; the visible canvas just
  // blits that layer + redraws the (animated, pulsing) markers every frame. Keeps marker
  // animation smooth without re-stroking 9000+ road segments every frame.
  const roadLayer = document.createElement('canvas');
  const roadCtx = roadLayer.getContext('2d');

  function resizeCanvas() {
    const rect = frame.getBoundingClientRect();
    canvas.width = roadLayer.width = rect.width;
    canvas.height = roadLayer.height = rect.height;
  }
  resizeCanvas();

  let nodes = [];
  let edges = [];
  let nodesById = new Map();
  let bounds = null;

  window.addEventListener('resize', () => {
    resizeCanvas();
    if (bounds) drawRoadLayer();
  });

  try {
    const response = await fetch(`${apiBaseUrl}/api/world/roadnetwork`);
    ({ nodes, edges } = await response.json());
  } catch (err) {
    loadingEl.querySelector('span').textContent = `Could not load the street map: ${err.message}`;
    loadingEl.classList.add('error');
    return;
  }

  nodesById = new Map(nodes.map((n) => [n.id, n]));
  bounds = computeBounds(nodes);
  drawRoadLayer();
  loadingEl.classList.add('hidden');

  const state = { start: null, end: null };

  function project(lat, lon) {
    const avgLat = (bounds.minLat + bounds.maxLat) / 2;
    const latCos = Math.cos((avgLat * Math.PI) / 180);
    const w = canvas.width - PADDING_PX * 2;
    const h = canvas.height - PADDING_PX * 2;
    const spanX = (bounds.maxLon - bounds.minLon) * latCos;
    const spanY = bounds.maxLat - bounds.minLat;
    const scale = Math.min(w / spanX, h / spanY);
    const offsetX = (w - spanX * scale) / 2;
    const offsetY = (h - spanY * scale) / 2;
    const x = PADDING_PX + offsetX + (lon - bounds.minLon) * latCos * scale;
    const y = PADDING_PX + offsetY + (bounds.maxLat - lat) * scale; // north up
    return [x, y];
  }

  function unproject(px, py) {
    const avgLat = (bounds.minLat + bounds.maxLat) / 2;
    const latCos = Math.cos((avgLat * Math.PI) / 180);
    const w = canvas.width - PADDING_PX * 2;
    const h = canvas.height - PADDING_PX * 2;
    const spanX = (bounds.maxLon - bounds.minLon) * latCos;
    const spanY = bounds.maxLat - bounds.minLat;
    const scale = Math.min(w / spanX, h / spanY);
    const offsetX = (w - spanX * scale) / 2;
    const offsetY = (h - spanY * scale) / 2;
    const lon = bounds.minLon + (px - PADDING_PX - offsetX) / (latCos * scale);
    const lat = bounds.maxLat - (py - PADDING_PX - offsetY) / scale;
    return { lat, lon };
  }

  function nearestNode(lat, lon) {
    let best = null;
    let bestDist = Infinity;
    for (const n of nodes) {
      const d = (n.lat - lat) ** 2 + (n.lon - lon) ** 2;
      if (d < bestDist) {
        bestDist = d;
        best = n;
      }
    }
    return best;
  }

  function drawRoadLayer() {
    roadCtx.fillStyle = BG_COLOR;
    roadCtx.fillRect(0, 0, roadLayer.width, roadLayer.height);

    roadCtx.strokeStyle = ROAD_COLOR;
    roadCtx.lineWidth = 1;
    roadCtx.beginPath();
    for (const [aId, bId] of edges) {
      const a = nodesById.get(aId);
      const b = nodesById.get(bId);
      if (!a || !b) continue;
      const [ax, ay] = project(a.lat, a.lon);
      const [bx, by] = project(b.lat, b.lon);
      roadCtx.moveTo(ax, ay);
      roadCtx.lineTo(bx, by);
    }
    roadCtx.stroke();
  }

  function drawMarker(node, color, pulseT) {
    if (!node) return;
    const [x, y] = project(node.lat, node.lon);

    // Soft pulsing ring so a chosen point reads as "live", not just a static dot.
    const ringRadius = 9 + Math.sin(pulseT) * 4;
    ctx.beginPath();
    ctx.arc(x, y, ringRadius, 0, Math.PI * 2);
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.globalAlpha = 1;

    ctx.beginPath();
    ctx.arc(x, y, 7, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  let rafId = null;
  function animate(timeMs) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(roadLayer, 0, 0);
    const t = timeMs / 400;
    drawMarker(state.start, START_COLOR, t);
    drawMarker(state.end, END_COLOR, t);
    rafId = requestAnimationFrame(animate);
  }
  rafId = requestAnimationFrame(animate);
  window.addEventListener('beforeunload', () => cancelAnimationFrame(rafId));

  function updateStatus() {
    if (!state.start) {
      statusEl.textContent = 'Click anywhere on the map to set your START point.';
      setActiveStep('start');
    } else if (!state.end) {
      statusEl.textContent = 'Now click a point to set your FINISH.';
      setActiveStep('end');
    } else {
      statusEl.textContent = 'Ready — click "Generate Route" to build the track.';
      setActiveStep('generate');
    }
    generateBtn.disabled = !(state.start && state.end);
  }

  function setActiveStep(stepName) {
    stepEls.forEach((li) => {
      const step = li.dataset.step;
      li.classList.toggle('active', step === stepName);
      li.classList.toggle(
        'done',
        (stepName === 'end' && step === 'start') ||
          (stepName === 'generate' && (step === 'start' || step === 'end'))
      );
    });
  }

  canvas.addEventListener('click', (e) => {
    const rect = canvas.getBoundingClientRect();
    const { lat, lon } = unproject(e.clientX - rect.left, e.clientY - rect.top);
    const node = nearestNode(lat, lon);
    if (!node) return;

    if (!state.start) {
      state.start = node;
    } else if (!state.end) {
      if (node.id === state.start.id) return;
      state.end = node;
    } else {
      state.start = node;
      state.end = null;
    }
    updateStatus();
  });

  resetBtn.addEventListener('click', () => {
    state.start = null;
    state.end = null;
    statusEl.classList.remove('error');
    updateStatus();
  });

  generateBtn.addEventListener('click', async () => {
    generateBtn.disabled = true;
    generateBtn.classList.add('loading');
    statusEl.classList.remove('error');
    statusEl.textContent = 'Generating route…';
    try {
      const res = await fetch(`${apiBaseUrl}/api/routes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ startNodeId: state.start.id, endNodeId: state.end.id }),
      });
      const data = await res.json();
      if (!res.ok) {
        statusEl.textContent = `Could not build that route: ${data.error}. Try different points.`;
        statusEl.classList.add('error');
        generateBtn.disabled = false;
        generateBtn.classList.remove('loading');
        return;
      }
      cancelAnimationFrame(rafId);
      resolve(data.chunk_id);
    } catch (err) {
      statusEl.textContent = `Error: ${err.message}`;
      statusEl.classList.add('error');
      generateBtn.disabled = false;
      generateBtn.classList.remove('loading');
    }
  });

  updateStatus();
}

function computeBounds(nodes) {
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLon = Infinity;
  let maxLon = -Infinity;
  for (const n of nodes) {
    if (n.lat < minLat) minLat = n.lat;
    if (n.lat > maxLat) maxLat = n.lat;
    if (n.lon < minLon) minLon = n.lon;
    if (n.lon > maxLon) maxLon = n.lon;
  }
  return { minLat, maxLat, minLon, maxLon };
}
