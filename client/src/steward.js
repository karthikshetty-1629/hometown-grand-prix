// Calls the AI Race Steward (/api/steward) when the player breaks a rule and shows the
// decision as an approval-gated overlay. The steward only ever proposes — a penalty is
// applied only if the player explicitly clicks Ignore, never automatically.

const SEVERITY_COLORS = { info: '#3498db', warning: '#f39c12', critical: '#e74c3c' };
const AUTO_HIDE_MS = 8000;

let hideTimeout = null;

export async function reportToSteward(apiBaseUrl, overlayEl, recorder, eventType, data) {
  try {
    const response = await fetch(`${apiBaseUrl}/api/steward`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: eventType, timestamp: Date.now(), ...data }),
    });
    if (!response.ok) throw new Error(`steward request failed: ${response.status}`);

    const decision = await response.json();
    showStewardOverlay(overlayEl, recorder, decision);
    return decision;
  } catch (err) {
    console.error('Steward call failed:', err);
    return null;
  }
}

function showStewardOverlay(overlayEl, recorder, decision) {
  overlayEl.innerHTML = `
    <div id="steward-card" style="border-left-color: ${SEVERITY_COLORS[decision.severity] || SEVERITY_COLORS.warning}">
      <div id="steward-header">AI Race Steward</div>
      <div id="steward-alert">${escapeHtml(decision.alert || '')}</div>
      <div id="steward-instruction">${escapeHtml(decision.instruction || '')}</div>
      ${decision.reason ? `<div id="steward-reason">${escapeHtml(decision.reason)}</div>` : ''}
      <div id="steward-buttons">
        <button id="steward-comply">Comply</button>
        <button id="steward-ignore">Ignore</button>
      </div>
    </div>
  `;
  overlayEl.style.display = '';

  const hide = () => {
    overlayEl.style.display = 'none';
  };

  overlayEl.querySelector('#steward-comply').addEventListener('click', hide);
  overlayEl.querySelector('#steward-ignore').addEventListener('click', () => {
    hide();
    if (decision.penalty && decision.penaltySeconds > 0) {
      recorder.addPenalty(decision.penaltySeconds);
    }
  });

  if (hideTimeout) clearTimeout(hideTimeout);
  hideTimeout = setTimeout(hide, AUTO_HIDE_MS);
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
