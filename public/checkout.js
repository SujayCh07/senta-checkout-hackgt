const sessionId = location.pathname.split('/').filter(Boolean).at(-1);
const summary = document.querySelector('#checkout-summary');
const status = document.querySelector('#checkout-status');
const button = document.querySelector('#simulate-payment');

function money(cents) {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(cents / 100);
}

async function loadSession() {
  const response = await fetch(`/api/mock-checkout/${sessionId}`);
  const body = await response.json();
  if (!response.ok) {
    summary.textContent = body.error ?? 'This demo checkout could not be found.';
    return;
  }
  summary.innerHTML = '';
  const description = document.createElement('p');
  description.textContent = `Demo order total: ${money(body.amountCents)} ${body.currency}`;
  const state = document.createElement('p');
  state.textContent = `Session status: ${body.status.replaceAll('_', ' ')}`;
  summary.append(description, state);
  button.disabled = body.status !== 'open';
  if (body.status === 'complete') status.textContent = 'Demo payment simulated. No money moved.';
  if (body.status === 'expired') status.textContent = 'This checkout expired after the order changed. Return to the conversation to create a new checkout.';
}

button.addEventListener('click', async () => {
  button.disabled = true;
  const response = await fetch(`/api/mock-checkout/${sessionId}/complete`, { method: 'POST' });
  const body = await response.json();
  if (!response.ok) {
    status.textContent = body.error ?? 'Could not complete the demo checkout.';
    await loadSession();
    return;
  }
  status.textContent = 'Demo payment simulated. No money moved.';
  await loadSession();
});

loadSession().catch(() => { summary.textContent = 'Could not load this local demo checkout.'; });
