// AI Race Steward — one Claude call per rule-violation event (speeding, off-road driving),
// returning a structured decision the client shows as an approval-gated overlay (the player
// must Comply or Ignore; nothing is applied automatically). Model is claude-sonnet-4-6 per
// project instruction.

const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = 'claude-sonnet-4-6';

async function getStewardDecision(gameEvent) {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 300,
    messages: [
      {
        role: 'user',
        content: `You are an AI Race Steward monitoring a live street race on real
OpenStreetMap roads. Roads in this game do not have real-world names or speed-limit
signs recorded — describe the road generically (e.g. "this residential street"), never
invent a street name or a specific numeric law citation.

LIVE GAME EVENT:
${JSON.stringify(gameEvent, null, 2)}

Respond ONLY with a JSON object, no other text, no markdown code fences:
{
  "alert": "short urgent message for driver (max 10 words)",
  "severity": "info OR warning OR critical",
  "instruction": "specific action driver should take",
  "reason": "brief explanation",
  "penalty": true or false,
  "penaltySeconds": number (0 if no penalty)
}`,
      },
    ],
  });

  const text = response.content[0].text;
  return parseStewardJson(text);
}

// Claude is instructed to return raw JSON, but models occasionally wrap it in a markdown
// code fence anyway — strip that before parsing rather than letting JSON.parse throw.
function parseStewardJson(text) {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '');
  return JSON.parse(cleaned);
}

module.exports = { getStewardDecision };
