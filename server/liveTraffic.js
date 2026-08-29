// Automatic live-traffic refresh: runs the real Bright Data Scraper Studio scraper (built via
// `bdata scraper create`, see docs/bright-data-scraper.md) as a subprocess, matches its
// output to real road segments, and writes server/storage-data/live/traffic.json — with no
// human or Claude Code session needing to trigger it by hand.
//
// Runs are fire-and-forget (never awaited by a request handler): the live scrape can take
// anywhere from a few seconds to a minute depending on the target page, and a race should
// never stall waiting on it. Triggered once on server startup, and again on every race start
// (server/routes/customTrack.js) so data drifts toward fresh over time without ever blocking
// the player.

const { execFile } = require('child_process');
const storage = require('./storage/localStorage');
const { getFullMapPayload } = require('./world/fullMapBuilder');
const { matchIncidentsToRoads } = require('../data-pipeline/match_traffic_to_roads');

const COLLECTOR_ID = 'c_mtewpzd4ncsji847m'; // sj-downtown-traffic, see docs/bright-data-scraper.md
const TARGET_URL = 'https://sjdowntown.com/traffic-construction-updates/';
const RUN_TIMEOUT_MS = 120000;

let refreshInFlight = false;

function refreshLiveTrafficInBackground() {
  if (!process.env.BRIGHT_DATA_API_KEY) {
    console.log('Live traffic refresh skipped: BRIGHT_DATA_API_KEY not set in .env');
    return;
  }
  if (refreshInFlight) return; // don't stack overlapping scrapes if triggered in quick succession
  refreshInFlight = true;

  refreshLiveTraffic()
    .then((result) => {
      console.log(
        `Live traffic refreshed: ${result.matched_incident_count}/${result.raw_incident_count} incidents -> ${result.matched_segment_count} segments`
      );
    })
    .catch((err) => {
      console.error('Live traffic refresh failed (keeping previous data):', err.message);
    })
    .finally(() => {
      refreshInFlight = false;
    });
}

async function refreshLiveTraffic() {
  const rawEvents = await runScraperViaCli();
  const incidents = rawEvents.map((e) => ({
    street_name: e.street,
    description: e.description,
    severity: normalizeSeverity(e.severity),
  }));

  const { road_segments: roadSegments } = await getFullMapPayload();
  const output = matchIncidentsToRoads(incidents, roadSegments);

  await storage.saveFile('live', 'traffic.json', JSON.stringify(output, null, 2));
  return output;
}

function normalizeSeverity(value) {
  const v = String(value || '').toLowerCase();
  return v === 'low' || v === 'medium' || v === 'high' ? v : 'medium';
}

function runScraperViaCli() {
  return new Promise((resolve, reject) => {
    execFile(
      'npx',
      ['-p', '@brightdata/cli', 'bdata', 'scraper', 'run', COLLECTOR_ID, TARGET_URL, '--json'],
      {
        timeout: RUN_TIMEOUT_MS,
        maxBuffer: 10 * 1024 * 1024,
        env: { ...process.env }, // BRIGHT_DATA_API_KEY already loaded into process.env by dotenv in index.js
      },
      (err, stdout) => {
        if (err) return reject(err);
        try {
          const parsed = JSON.parse(stdout);
          const events = parsed?.[0]?.events;
          if (!Array.isArray(events)) return reject(new Error('unexpected scraper output shape'));
          resolve(events);
        } catch (parseErr) {
          reject(parseErr);
        }
      }
    );
  });
}

module.exports = { refreshLiveTrafficInBackground, refreshLiveTraffic };
