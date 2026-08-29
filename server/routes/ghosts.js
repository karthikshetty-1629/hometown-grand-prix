const express = require('express');
const storage = require('../storage/localStorage');

const router = express.Router();

const SAFE_ID = /^[a-zA-Z0-9_-]+$/;

// POST /api/ghosts/:trackId -> upload a recorded run
// Body: { player_name, samples: [{ t, x, z, rot }, ...] }
router.post('/:trackId', async (req, res) => {
  const { trackId } = req.params;
  if (!SAFE_ID.test(trackId)) {
    return res.status(400).json({ error: 'invalid track id' });
  }

  const { player_name: playerName, samples } = req.body;
  if (!Array.isArray(samples) || samples.length === 0) {
    return res.status(400).json({ error: 'samples must be a non-empty array' });
  }

  const ghostRun = {
    track_id: trackId,
    player_name: playerName || 'anonymous',
    recorded_at: new Date().toISOString(),
    samples,
  };

  const filename = `${trackId}_${Date.now()}.json`;
  await storage.saveFile('ghosts', filename, JSON.stringify(ghostRun));

  res.status(201).json({ saved_as: filename });
});

// GET /api/ghosts/:trackId -> saved ghost run(s) for that track
router.get('/:trackId', async (req, res) => {
  const { trackId } = req.params;
  if (!SAFE_ID.test(trackId)) {
    return res.status(400).json({ error: 'invalid track id' });
  }

  const files = await storage.listFiles('ghosts');
  const matches = files.filter((f) => f.startsWith(`${trackId}_`) && f.endsWith('.json'));

  const runs = await Promise.all(
    matches.map(async (filename) => {
      const buffer = await storage.readFile('ghosts', filename);
      return JSON.parse(buffer.toString());
    })
  );

  res.json({ runs });
});

module.exports = router;
