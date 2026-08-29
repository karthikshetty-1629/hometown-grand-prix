const express = require('express');
const storage = require('../storage/localStorage');

const router = express.Router();

// Track ids come from chunk filenames, keep them predictable and safe to use in a path.
const SAFE_ID = /^[a-zA-Z0-9_-]+$/;

// GET /api/tracks -> list available local tracks (for a simple picker UI)
router.get('/', async (req, res) => {
  const files = await storage.listFiles('chunks');
  const trackIds = files.filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, ''));
  res.json({ tracks: trackIds });
});

// GET /api/tracks/:id -> chunk JSON for one track
router.get('/:id', async (req, res) => {
  const { id } = req.params;
  if (!SAFE_ID.test(id)) {
    return res.status(400).json({ error: 'invalid track id' });
  }

  try {
    const buffer = await storage.readFile('chunks', `${id}.json`);
    res.type('application/json').send(buffer);
  } catch (err) {
    res.status(404).json({ error: 'track not found' });
  }
});

module.exports = router;
