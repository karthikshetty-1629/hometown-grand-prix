# Street Steward — AI Race Governance System
## Context for Claude Code

---

## What This Project Is

A 3D street racing game built on real OpenStreetMap roads, governed by live AI agents
that enforce traffic rules, guide the driver in real time, and scrape live road data.

This is being built at the **Agent Harness Hackathon** (Aug 29, 2026, San Francisco)
hosted by WeMakeDevs, sponsored by TrueFoundry, Bright Data, Qodo, and OpenAI.

**Deadline: 6:00 PM today.**

---

## Tech Stack (Already Built)

- **Client:** Babylon.js (WebGL 3D engine) + Vanilla JavaScript
- **Bundler:** Vite (runs at localhost:5173)
- **Server:** Node.js + Express
- **Data:** Python scripts pulling real OpenStreetMap data into PostGIS
- **Database:** PostgreSQL with PostGIS extension
- **AI:** Anthropic Claude API (claude-sonnet-4-6)
- **Agent Platform:** TrueForge (open-source agent harness by TrueFoundry)
- **Web Scraping:** Bright Data (for live OSM speed limit data)

---

## Project Folder Structure

```
MyProject/
├── client/          → Babylon.js game (frontend)
├── server/          → Node.js + Express (backend)
├── data-pipeline/   → Python OSM → PostGIS scripts
├── docs/
├── .claude/
├── Claude.pdf
├── docker-compose.yml
├── README.md
└── CLAUDE.md        ← this file
```

---

## What We Are Building Today (Add On Top of Existing Game)

### The Core Feature: AI Race Steward System

When the player drives the car, AI agents monitor the race in real time and:
1. Detect rule violations (speeding, wrong turn, running red lights)
2. Issue warnings and penalties to the driver
3. Show an overlay on screen with agent decisions
4. Require player approval before applying penalties (human-in-the-loop)
5. Generate live race commentary

### The Agent Architecture (4 Agents)

```
Agent 1 — Traffic Steward (PRIMARY)
  - Monitors car speed vs OSM road speed limits
  - Issues warnings: "You are 35 km/h over limit on Market St"
  - Triggers penalty countdown if ignored

Agent 2 — Route Navigator
  - Detects when car goes off the route path
  - Recalculates and guides driver back
  - Warns about sharp turns ahead

Agent 3 — Safety Car Agent
  - Detects collisions or dangerous situations
  - Deploys safety car events
  - Recommends pit stops

Agent 4 — Race Commentator
  - Gets updates from all 3 agents
  - Generates dramatic live race commentary
  - Shows as ticker at bottom of screen
```

---

## What Needs To Be Built (Priority Order)

### PRIORITY 1 — Core Agent Integration (Do This First)

**File to create: `server/steward.js`**

```javascript
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

export async function getStewardDecision(gameEvent) {
  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 300,
    messages: [{
      role: "user",
      content: `You are an AI Race Steward monitoring a live street race 
      on real OpenStreetMap roads in San Francisco.
      
      LIVE GAME EVENT:
      ${JSON.stringify(gameEvent, null, 2)}
      
      Respond ONLY with a JSON object, no other text:
      {
        "alert": "short urgent message for driver (max 10 words)",
        "severity": "info OR warning OR critical",
        "instruction": "specific action driver should take",
        "reason": "brief explanation",
        "penalty": true or false,
        "penaltySeconds": number (0 if no penalty)
      }`
    }]
  });

  const text = response.content[0].text;
  return JSON.parse(text);
}
```

**Add to Express server (server/index.js or server/app.js):**

```javascript
import { getStewardDecision } from './steward.js';

// New endpoint — AI Steward decisions
app.post('/api/steward', async (req, res) => {
  try {
    const decision = await getStewardDecision(req.body);
    res.json(decision);
  } catch (error) {
    console.error('Steward error:', error);
    res.status(500).json({ error: error.message });
  }
});
```

**Install required package:**
```bash
npm install @anthropic-ai/sdk dotenv
```

**Create `.env` in project root:**
```
ANTHROPIC_API_KEY=<get from user or console.anthropic.com>
BRIGHT_DATA_API_KEY=<get from brightdata.com with code wemakedevs>
```

---

### PRIORITY 2 — Game Event Triggers in Babylon.js

**Find in client code where car speed and position are tracked.**
**Add these trigger calls:**

```javascript
// Utility function to call the steward
async function reportToSteward(eventType, data) {
  try {
    const response = await fetch('/api/steward', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: eventType,
        timestamp: Date.now(),
        ...data
      })
    });
    const decision = await response.json();
    showStewardOverlay(decision);
    return decision;
  } catch (err) {
    console.error('Steward call failed:', err);
  }
}

// TRIGGER 1: Speeding
// Call this in your game loop where speed is tracked
if (carSpeed > roadSpeedLimit * 1.1 && !stewardCooldown) {
  stewardCooldown = true;
  setTimeout(() => stewardCooldown = false, 10000); // 10s cooldown
  reportToSteward('speeding', {
    speed: Math.round(carSpeed),
    limit: roadSpeedLimit,
    road: currentRoadName,
    position: { x: car.position.x, z: car.position.z }
  });
}

// TRIGGER 2: Wrong turn / off route
// Call when car deviates from the yellow route path
reportToSteward('wrong_turn', {
  position: { x: car.position.x, z: car.position.z },
  expectedRoad: expectedRoadName,
  actualRoad: currentRoadName
});

// TRIGGER 3: Sharp turn ahead
// Call when next waypoint angle > 45 degrees
reportToSteward('sharp_turn_ahead', {
  turnAngle: angleDegrees,
  distanceMeters: distanceToTurn,
  currentSpeed: Math.round(carSpeed),
  road: upcomingRoadName
});
```

---

### PRIORITY 3 — In-Game UI Overlay

**Add to client HTML (index.html):**

```html
<!-- AI Steward Overlay -->
<div id="steward-overlay" style="
  position: fixed;
  top: 20px;
  right: 20px;
  background: rgba(0, 0, 0, 0.88);
  color: white;
  padding: 16px 20px;
  border-radius: 10px;
  border-left: 4px solid #e74c3c;
  max-width: 320px;
  display: none;
  font-family: 'Courier New', monospace;
  z-index: 9999;
  box-shadow: 0 4px 20px rgba(0,0,0,0.5);
">
  <div id="steward-header" style="font-size:11px;color:#aaa;margin-bottom:6px;
    letter-spacing:0.1em;">🤖 AI RACE STEWARD</div>
  <div id="steward-alert" style="font-size:15px;font-weight:bold;
    margin-bottom:6px;"></div>
  <div id="steward-instruction" style="font-size:13px;color:#ddd;
    margin-bottom:10px;"></div>
  <div id="steward-buttons" style="display:flex;gap:8px;">
    <button id="btn-comply" onclick="playerResponds('comply')" style="
      flex:1;padding:6px;background:#27ae60;color:white;
      border:none;border-radius:4px;cursor:pointer;font-size:12px;">
      ✅ Comply
    </button>
    <button id="btn-ignore" onclick="playerResponds('ignore')" style="
      flex:1;padding:6px;background:#c0392b;color:white;
      border:none;border-radius:4px;cursor:pointer;font-size:12px;">
      ❌ Ignore
    </button>
  </div>
</div>

<!-- Commentary Ticker -->
<div id="commentary-ticker" style="
  position: fixed;
  bottom: 20px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(0,0,0,0.75);
  color: #f1c40f;
  padding: 8px 20px;
  border-radius: 20px;
  font-family: monospace;
  font-size: 13px;
  display: none;
  z-index: 9999;
  max-width: 80%;
  text-align: center;
"></div>
```

**Add to client JavaScript:**

```javascript
const severityColors = {
  info: '#3498db',
  warning: '#f39c12',
  critical: '#e74c3c'
};

let currentDecision = null;
let overlayTimeout = null;

function showStewardOverlay(decision) {
  currentDecision = decision;
  const overlay = document.getElementById('steward-overlay');
  const alert = document.getElementById('steward-alert');
  const instruction = document.getElementById('steward-instruction');

  overlay.style.borderLeftColor = severityColors[decision.severity] || '#e74c3c';
  alert.textContent = decision.alert;
  instruction.textContent = decision.instruction;
  overlay.style.display = 'block';

  // Auto hide after 8 seconds if no response
  if (overlayTimeout) clearTimeout(overlayTimeout);
  overlayTimeout = setTimeout(() => {
    overlay.style.display = 'none';
  }, 8000);
}

function playerResponds(choice) {
  const overlay = document.getElementById('steward-overlay');
  overlay.style.display = 'none';
  
  if (choice === 'ignore' && currentDecision?.penalty) {
    // Apply penalty — add time to race clock
    applyTimePenalty(currentDecision.penaltySeconds || 5);
    showCommentary(`Penalty applied! +${currentDecision.penaltySeconds}s for ignoring steward`);
  } else if (choice === 'comply') {
    showCommentary('Good call. Steward decision acknowledged.');
  }
  currentDecision = null;
}

function showCommentary(text) {
  const ticker = document.getElementById('commentary-ticker');
  ticker.textContent = `📢 ${text}`;
  ticker.style.display = 'block';
  setTimeout(() => ticker.style.display = 'none', 5000);
}

function applyTimePenalty(seconds) {
  // Hook into your existing race timer
  // Add `seconds` to the current race time
  console.log(`Penalty: +${seconds} seconds applied`);
}
```

---

### PRIORITY 4 — Bright Data Integration (AirPods Prize)

**Superseded — corrected after checking the actual data.** OpenStreetMap's website isn't a
live speed-limit source (speed limits here are a road-class heuristic, computed locally —
see `server/world/geo.js`, no scraping involved). What's actually built instead: live
**traffic congestion**, scraped via Bright Data and rendered as a colored line on the real
road it affects while driving (thin/green = light, thick/red = heavy).

Full scraper settings, target, and pipeline steps: **`docs/bright-data-scraper.md`** — Claude
Code reads that file to reuse the same config on every refresh rather than re-deciding it.

Quick reference:
- Extraction: Claude Code terminal, via the Bright Data MCP connection (registered at user
  scope — see `claude mcp list`)
- Matching: `node data-pipeline/match_traffic_to_roads.js <raw-incidents.json>`
- Serving: `GET /api/live/traffic` (`server/routes/live.js`)
- Rendering: `buildTrafficOverlay()` in `client/src/sceneBuilder.js`

---

### PRIORITY 5 — TrueForge Dashboard (DGX Spark Prize)

Run TrueForge alongside your game for the demo.

In TrueForge browser UI:
1. Create Agent: "Traffic Steward" — system prompt + exa connector
2. Create Agent: "Route Navigator" — system prompt + parallel-web connector
3. Create Agent: "Race Commentator" — system prompt, no connectors

During demo:
- Game runs on LEFT side of screen
- TrueForge dashboard runs on RIGHT side
- You show judges both screens simultaneously

**TrueForge Traffic Steward system prompt (paste into TrueForge UI):**
```
You are an AI Traffic Steward for a real street race on OpenStreetMap 
roads in San Francisco. 

When given a race incident, you must:
1. Search the web for official traffic laws for San Francisco
2. Apply the correct rule to the situation
3. Issue a clear penalty decision with reasoning
4. Specify exactly what the driver must do

Always cite the specific law or rule you are applying.
Be concise, authoritative, and fair.
```

---

## Demo Script (Practice This)

**What to say to judges (60 seconds):**

> "I built a 3D street racing game on real OpenStreetMap roads in San Francisco.
> The roads, intersections, and buildings are all real.
>
> But I wanted to make it governed by real AI agents — not just a game.
>
> Four agents run in real time: a Traffic Steward that enforces speed limits,
> a Route Navigator that guides the driver, a Safety Agent, and a Commentator.
>
> When the car speeds — watch this — the steward agent detects it,
> searches real San Francisco traffic law, and issues a decision.
>
> The driver gets a choice: comply or ignore. If they ignore,
> a time penalty is applied. The agent waits for human approval
> before doing anything irreversible. That's the harness pattern.
>
> The speed limit data is scraped live from OpenStreetMap using Bright Data,
> so it's always current. If OSM changes its structure, the scraper auto-repairs."

---

## Prize Tracks This Project Targets

| Prize | How |
|---|---|
| 🏆 DGX Spark $5000 | TrueForge subagents + approval gate + connectors |
| 📱 iPad | Best UI — in-game overlay with approve/ignore |
| 🎧 AirPods | Bright Data live OSM scraping pipeline |
| 💻 Mac Mini | Qodo code review on all PRs |
| ⌨️ Keyboard | Blog post after hackathon |

---

## Environment Variables Needed

```
ANTHROPIC_API_KEY=       # From console.anthropic.com
BRIGHT_DATA_API_KEY=     # From brightdata.com (code: wemakedevs = $50 free)
OPENAI_API_KEY=          # From event ($50 free credits)
```

---

## Packages To Install

```bash
# In server/
npm install @anthropic-ai/sdk dotenv

# In data-pipeline/
pip install psycopg2-binary>=2.9 SQLAlchemy>=2.0 shapely>=2.0 networkx>=3.2
```

---

## Important Rules For Claude Code

1. Do NOT break existing game functionality — only ADD new features
2. All new server endpoints go in server/ folder
3. All new client code goes in client/ folder
4. Keep existing OSM data pipeline intact
5. Use claude-sonnet-4-6 as the model for all Claude API calls
6. All API responses from steward must be valid JSON
7. Add cooldown timers to all steward triggers (min 10 seconds between calls)
8. Never block the game loop — all API calls must be async/await
9. Test each feature individually before combining
10. Keep the .env file in .gitignore — never commit API keys

---

## What Already Works (Do Not Break)

- 3D Babylon.js car driving on real OSM roads ✅
- OpenStreetMap road data loading from PostGIS ✅
- Yellow route path visualization ✅
- Car physics and controls (WASD / arrow keys) ✅
- Vite dev server at localhost:5173 ✅
- Express backend server ✅
- Docker compose setup ✅

---

## Current Time: 11:45 AM | Deadline: 6:00 PM | Hours Left: ~6
