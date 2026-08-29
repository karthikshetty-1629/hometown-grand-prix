// First-launch screen shown only on native app builds with no server URL baked in or
// remembered yet (see config.js). "localhost" means the phone itself on-device, so the
// player has to point the app at wherever the server actually lives — a laptop's LAN IP
// for local-WiFi testing, or a cloud URL once one exists. Reachability is checked with a
// real request before continuing, so a typo fails here instead of on the route picker.

import { setApiBaseUrl } from './config.js';

export function showServerSetup(container) {
  return new Promise((resolve) => {
    container.innerHTML = `
      <div id="picker-header">
        <h1>Hometown Grand Prix</h1>
        <p>Connect to your race server</p>
      </div>

      <div id="picker-map-frame" style="display:flex; align-items:center; justify-content:center;">
        <div id="server-setup-card">
          <p id="server-setup-help">
            Enter the address of the machine running the game server.
            On the same WiFi as your laptop, that's usually
            <code>http://&lt;laptop-ip&gt;:3001</code>.
          </p>
          <input id="server-setup-input" type="text" placeholder="http://192.168.1.42:3001" autocapitalize="off" autocorrect="off" spellcheck="false" />
          <button id="server-setup-connect">Connect</button>
          <p id="server-setup-status"></p>
        </div>
      </div>
    `;

    const input = container.querySelector('#server-setup-input');
    const button = container.querySelector('#server-setup-connect');
    const status = container.querySelector('#server-setup-status');

    const saved = localStorage.getItem('apiBaseUrl');
    if (saved) input.value = saved;

    const attempt = async () => {
      const url = input.value.trim();
      if (!url) {
        status.textContent = 'Enter a server address first.';
        status.className = 'error';
        return;
      }

      button.disabled = true;
      status.textContent = 'Connecting…';
      status.className = '';

      const candidate = url.replace(/\/$/, '');
      try {
        const response = await fetch(`${candidate}/api/world/roadnetwork`, { method: 'GET' });
        if (!response.ok) throw new Error(`Server responded with ${response.status}`);
        setApiBaseUrl(candidate);
        resolve(candidate);
      } catch (err) {
        status.textContent = `Could not reach that server: ${err.message}`;
        status.className = 'error';
        button.disabled = false;
      }
    };

    button.addEventListener('click', attempt);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') attempt();
    });
  });
}
