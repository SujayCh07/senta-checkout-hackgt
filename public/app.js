import { authenticate, request, restoreSession, setCsrfToken, signOut } from './auth.js';

const messages = document.querySelector('#messages');
const composer = document.querySelector('#composer');
const input = document.querySelector('#message-input');
const sendButton = composer.querySelector('button');
const statusLabel = document.querySelector('#connection-status');
const authGate = document.querySelector('#auth-gate');
const appContent = document.querySelector('#app-content');
const authForm = document.querySelector('#auth-form');
const authError = document.querySelector('#auth-error');
const checkoutButton = document.querySelector('#checkout-button');
const conversationPicker = document.querySelector('#conversation-picker');
let account;
let conversationId;
let currentOrder;
let checkoutConfigured = false;
let resumeCheckoutUrl = null;
let cartMutationPending = false;

function money(cents, currency = 'USD') {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(cents / 100);
}

function showMessage(role, text, createdAt = Date.now()) {
  const message = document.createElement('div');
  message.className = `message ${role}`;
  message.textContent = text;
  const time = document.createElement('div');
  time.className = 'message-time';
  time.textContent = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(createdAt));
  message.append(time);
  messages.append(message);
}

function renderMessages(history) {
  messages.replaceChildren();
  for (const message of history ?? []) showMessage(message.role, message.text, message.createdAt);
  messages.scrollTop = messages.scrollHeight;
}

function renderCart(result) {
  const order = result.order;
  currentOrder = order;
  const empty = document.querySelector('#empty-cart');
  const content = document.querySelector('#cart-content');
  document.querySelector('#cart-count').textContent = order ? String(order.items.reduce((sum, line) => sum + line.quantity, 0)) : '0';
  empty.hidden = Boolean(order);
  content.hidden = !order;
  if (!order) return;

  document.querySelector('#merchant-name').textContent = order.restaurant.name;
  const cartItems = document.querySelector('#cart-items');
  cartItems.replaceChildren();
  for (const line of order.items) {
    const row = document.createElement('div');
    row.className = 'cart-item';
    const details = document.createElement('div');
    const name = document.createElement('strong');
    name.textContent = line.item.name;
    const options = document.createElement('span');
    options.className = 'item-modifier';
    options.textContent = line.modifiers.length ? line.modifiers.map((modifier) => modifier.name).join(', ') : 'No additional options';
    details.append(name, options);
    const controls = document.createElement('div');
    controls.className = 'cart-line-controls';
    const editable = order.status === 'ready' && !cartMutationPending;
    const decrease = createCartButton('Decrease quantity', '−', () => updateCartLine(line, line.quantity - 1));
    decrease.disabled = !editable || line.quantity <= 1;
    const quantity = document.createElement('span');
    quantity.className = 'item-quantity';
    quantity.textContent = String(line.quantity);
    const increase = createCartButton('Increase quantity', '+', () => updateCartLine(line, line.quantity + 1));
    increase.disabled = !editable || line.quantity >= 20;
    const remove = createCartButton(`Remove ${line.item.name}`, 'Remove', () => removeCartLine(line));
    remove.classList.add('cart-remove');
    remove.disabled = !editable;
    controls.append(decrease, quantity, increase, remove);
    row.append(details, controls);
    cartItems.append(row);
  }
  document.querySelector('#subtotal').textContent = money(order.subtotalCents, order.currency);
  document.querySelector('#total').textContent = money(order.totalCents, order.currency);
  document.querySelector('#cart-footnote').textContent = result.cart?.pricingNote ?? 'Tax and delivery are calculated by the restaurant.';
  document.querySelector('#order-state').textContent = order.status.replaceAll('_', ' ');
  checkoutButton.hidden = !checkoutConfigured || !['ready', 'payment_unknown'].includes(order.status);
  checkoutButton.disabled = !['ready', 'payment_unknown'].includes(order.status);
  resumeCheckoutUrl = null;
  checkoutButton.textContent = order.status === 'payment_unknown' ? 'Reconcile checkout' : 'Continue to Stripe Checkout ↗';
  document.querySelector('#conversation-status').textContent = `Order revision ${order.revision}`;
}

function createCartButton(label, text, onClick) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'cart-action';
  button.setAttribute('aria-label', label);
  button.textContent = text;
  button.addEventListener('click', onClick);
  return button;
}

async function mutateCart(path, method, body) {
  if (!currentOrder || cartMutationPending) return;
  const conversationAtStart = conversationId;
  cartMutationPending = true;
  renderCart({ order: currentOrder });
  try {
    const order = await request(path, { method, body: { ...body, expectedRevision: currentOrder.revision } });
    if (order) {
      renderCart({ order });
      document.querySelector('#conversation-status').textContent = `Order revision ${order.revision}`;
    } else {
      currentOrder = null;
      renderCart({ order: null });
      document.querySelector('#conversation-status').textContent = 'Cart cleared. Choose an item to start another order.';
    }
  } catch (error) {
    document.querySelector('#order-state').textContent = error.message;
    if (error.status === 409 && conversationAtStart === conversationId) {
      try {
        const refreshed = await request(`/api/conversations/${encodeURIComponent(conversationId)}`);
        renderCart(refreshed);
      } catch { /* Keep the conflict visible if the refresh also fails. */ }
    }
  } finally {
    cartMutationPending = false;
    if (currentOrder) renderCart({ order: currentOrder });
  }
}

function updateCartLine(line, quantity) {
  if (quantity < 1 || quantity > 20) return;
  return mutateCart(`/api/orders/${currentOrder.id}/items/${line.id}`, 'PATCH', { quantity });
}

function removeCartLine(line) {
  return mutateCart(`/api/orders/${currentOrder.id}/items/${line.id}`, 'DELETE', {});
}

async function createConversation() {
  const created = await request('/api/conversations', { method: 'POST' });
  conversationId = created.id;
  try { localStorage.setItem(`senta.conversation.${account.id}`, conversationId); } catch { /* storage can be disabled */ }
  renderMessages(created.messages);
  renderCart({ order: null });
  document.querySelector('#conversation-status').textContent = 'Ready';
  await refreshConversationPicker();
}

async function resumeConversation() {
  let savedId;
  try { savedId = localStorage.getItem(`senta.conversation.${account.id}`); } catch { savedId = null; }
  if (!savedId) return createConversation();
  try {
    const result = await request(`/api/conversations/${encodeURIComponent(savedId)}`);
    conversationId = result.conversation.id;
    renderMessages(result.conversation.messages);
    renderCart(result);
    await syncCheckoutAttempt();
    await refreshConversationPicker();
  } catch (error) {
    if (error.status !== 404) throw error;
    await createConversation();
  }
}

async function refreshConversationPicker() {
  const page = await request('/api/conversations?limit=25');
  conversationPicker.replaceChildren();
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = 'Recent conversations';
  conversationPicker.append(placeholder);
  for (const conversation of page.items) {
    const option = document.createElement('option');
    option.value = conversation.id;
    option.textContent = conversation.latestMessage.slice(0, 42) || 'New conversation';
    if (conversation.id === conversationId) option.selected = true;
    conversationPicker.append(option);
  }
  conversationPicker.hidden = page.items.length < 2;
}

async function openConversation(id) {
  const result = await request(`/api/conversations/${encodeURIComponent(id)}`);
  conversationId = result.conversation.id;
  try { localStorage.setItem(`senta.conversation.${account.id}`, conversationId); } catch { /* storage can be disabled */ }
  renderMessages(result.conversation.messages);
  renderCart(result);
  await syncCheckoutAttempt();
}

async function syncCheckoutAttempt() {
  if (!currentOrder || !['checkout_pending', 'payment_unknown'].includes(currentOrder.status)) return;
  try {
    const attempt = await request(`/api/orders/${currentOrder.id}/checkout`);
    if (attempt.status === 'open' && attempt.checkoutUrl) {
      resumeCheckoutUrl = attempt.checkoutUrl;
      checkoutButton.hidden = false;
      checkoutButton.disabled = false;
      checkoutButton.textContent = 'Resume Stripe Checkout ↗';
    }
  } catch { /* Keep the checkout boundary unavailable if status cannot be read. */ }
}

async function loadSuggestions() {
  const { restaurants } = await request('/api/catalog');
  const items = restaurants.flatMap((restaurant) => restaurant.items.map((item) => ({ ...item, restaurantName: restaurant.name }))).slice(0, 4);
  renderSuggestions(items);
}

function renderSuggestions(items) {
  const container = document.querySelector('#suggestions');
  container.replaceChildren();
  for (const item of items) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'suggestion';
    button.textContent = `${item.name} · ${money(item.priceCents, item.currency)}`;
    button.addEventListener('click', () => sendMessage(`Get ${item.name} from ${item.restaurantName}`));
    container.append(button);
  }
}

async function searchMenu(query) {
  if (!query.trim()) return loadSuggestions();
  const result = await request(`/api/catalog?q=${encodeURIComponent(query)}&limit=8`);
  renderSuggestions(result.items.map((item) => ({ ...item, restaurantName: item.restaurant.name })));
}

async function loadCheckoutConfiguration() {
  const health = await request('/api/health');
  checkoutConfigured = health.checkout === 'stripe_test';
  checkoutButton.hidden = !checkoutConfigured;
  if (!checkoutConfigured) {
    document.querySelector('#cart-footnote').textContent = 'Checkout needs Stripe test-mode credentials and a webhook signing secret.';
  }
}

async function sendMessage(text) {
  const cleanText = text.trim();
  if (!conversationId || !cleanText || sendButton.disabled) return;
  sendButton.disabled = true;
  input.value = '';
  try {
    const result = await request(`/api/conversations/${conversationId}/messages`, {
      method: 'POST', body: { text: cleanText },
    });
    renderMessages(result.conversation.messages);
    renderCart(result);
  } catch (error) {
    showMessage('assistant', error.message);
    messages.scrollTop = messages.scrollHeight;
  } finally {
    sendButton.disabled = false;
    input.focus();
  }
}

async function startCheckout() {
  if (!currentOrder) return;
  if (resumeCheckoutUrl) {
    location.assign(resumeCheckoutUrl);
    return;
  }
  checkoutButton.disabled = true;
  const label = checkoutButton.textContent;
  checkoutButton.textContent = 'Connecting to Stripe…';
  try {
    const result = await request(`/api/orders/${currentOrder.id}/checkout`, {
      method: 'POST', body: { expectedRevision: currentOrder.revision },
    });
    if (result.status === 'open' && result.url) {
      location.assign(result.url);
      return;
    }
    document.querySelector('#order-state').textContent = 'Payment status needs reconciliation';
    checkoutButton.textContent = 'Retry safe reconciliation';
  } catch (error) {
    document.querySelector('#order-state').textContent = error.message;
    checkoutButton.textContent = label;
  } finally {
    checkoutButton.disabled = false;
  }
}

async function inspectCheckoutReturn() {
  const params = new URLSearchParams(location.search);
  const orderId = params.get('order_id');
  if (!orderId || !location.pathname.startsWith('/checkout/')) return;
  try {
    const attempt = await request(`/api/orders/${encodeURIComponent(orderId)}/checkout`);
    const canceledReturn = location.pathname === '/checkout/cancel';
    const message = canceledReturn
      ? 'Checkout was canceled. Your cart is saved; you can resume payment when ready.'
      : attempt.status === 'paid'
      ? 'Payment confirmed by the checkout provider.'
      : attempt.status === 'open'
        ? 'Checkout returned. Payment is still waiting for provider confirmation.'
        : 'Checkout status is being reconciled. This page does not confirm payment.';
    document.querySelector('#conversation-status').textContent = message;
  } catch (error) {
    document.querySelector('#conversation-status').textContent = error.message;
  }
  history.replaceState(null, '', '/');
}

async function showWorkspace(user) {
  account = user;
  authGate.hidden = true;
  appContent.hidden = false;
  document.querySelector('#sign-out').hidden = false;
  document.querySelector('#new-order').hidden = false;
  statusLabel.textContent = user.email;
  await Promise.all([loadSuggestions(), loadCheckoutConfiguration()]);
  await resumeConversation();
  await inspectCheckoutReturn();
}

async function bootstrap() {
  try {
    const session = await restoreSession();
    await showWorkspace(session.user);
  } catch (error) {
    if (error.status !== 401) {
      statusLabel.textContent = 'Unavailable';
      authError.textContent = error.message;
      return;
    }
    authGate.hidden = false;
    statusLabel.textContent = 'Sign in required';
  }
}

async function submitAuthentication(path) {
  authError.textContent = '';
  const data = new FormData(authForm);
  const email = String(data.get('email') || '');
  const password = String(data.get('password') || '');
  try {
    const result = await authenticate(path, { email, password });
    authForm.reset();
    await showWorkspace(result.user);
  } catch (error) {
    authError.textContent = error.message;
  }
}

composer.addEventListener('submit', (event) => {
  event.preventDefault();
  sendMessage(input.value);
});

authForm.addEventListener('submit', (event) => {
  event.preventDefault();
  submitAuthentication('/api/auth/login');
});

document.querySelector('#register').addEventListener('click', () => submitAuthentication('/api/auth/register'));
document.querySelector('#catalog-search').addEventListener('submit', (event) => {
  event.preventDefault();
  const query = document.querySelector('#catalog-query').value;
  searchMenu(query).catch((error) => showMessage('assistant', error.message));
});
let searchTimer;
document.querySelector('#catalog-query').addEventListener('input', (event) => {
  clearTimeout(searchTimer);
  const query = event.target.value;
  searchTimer = setTimeout(() => searchMenu(query).catch(() => {}), 180);
});
document.querySelector('#new-order').addEventListener('click', () => createConversation().catch((error) => showMessage('assistant', error.message)));
conversationPicker.addEventListener('change', (event) => {
  if (event.target.value) openConversation(event.target.value).catch((error) => showMessage('assistant', error.message));
});
document.querySelector('#sign-out').addEventListener('click', async () => {
  try { await signOut(); } finally {
    account = null;
    currentOrder = null;
    conversationId = null;
    setCsrfToken(null);
    appContent.hidden = true;
    authGate.hidden = false;
    statusLabel.textContent = 'Sign in required';
  }
});
checkoutButton.addEventListener('click', startCheckout);

bootstrap();
