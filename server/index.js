// .env lives at the project root (one level up from server/), not inside server/ itself —
// the default dotenv.config() looks in process.cwd(), which is wrong when this is launched
// via `node index.js` from inside server/.
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const express = require('express');
const cors = require('cors');
const tracksRouter = require('./routes/tracks');
const ghostsRouter = require('./routes/ghosts');
const worldRouter = require('./routes/world');
const customTrackRouter = require('./routes/customTrack');
const stewardRouter = require('./routes/steward');
const liveRouter = require('./routes/live');
const { refreshLiveTrafficInBackground } = require('./liveTraffic');

const app = express();
app.use(cors()); // client and server are always different origins (dev ports, or app + cloud host)
app.use(express.json());

app.use('/api/tracks', tracksRouter);
app.use('/api/ghosts', ghostsRouter);
app.use('/api/world', worldRouter);
app.use('/api/routes', customTrackRouter);
app.use('/api/steward', stewardRouter);
app.use('/api/live', liveRouter);

// Cloud hosts (Render, Fly.io, Railway, etc.) assign a port at runtime via $PORT and
// require the app to listen on it — 3001 stays as the local dev fallback.
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  refreshLiveTrafficInBackground(); // warm the live-traffic cache without blocking startup
});
