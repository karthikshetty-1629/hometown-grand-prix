// POST /api/steward -> one AI Race Steward decision for a single rule-violation event
// (speeding, off-road driving). The client shows this as an approval-gated overlay — the
// steward never applies anything itself, it only proposes.

const express = require('express');
const { getStewardDecision } = require('../steward');

const router = express.Router();

router.post('/', async (req, res) => {
  try {
    const decision = await getStewardDecision(req.body);
    res.json(decision);
  } catch (error) {
    console.error('Steward error:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
