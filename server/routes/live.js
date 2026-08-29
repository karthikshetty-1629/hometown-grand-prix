// Serves live data files produced by data-pipeline/match_traffic_to_roads.js — this route
// never touches the network itself, it only reads what that offline step already wrote via
// the storage adapter (see storage/localStorage.js for why routes never touch fs directly).

const express = require('express');
const storage = require('../storage/localStorage');

const router = express.Router();

router.get('/traffic', async (req, res) => {
  try {
    const buffer = await storage.readFile('live', 'traffic.json');
    res.type('application/json').send(buffer);
  } catch (err) {
    // No traffic data fetched yet — a normal, expected state, not an error the client needs
    // to handle specially. It just renders no congestion overlay.
    res.json({ fetched_at: null, source: null, segments: [] });
  }
});

module.exports = router;
