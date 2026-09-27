const messages = document.querySelector('#messages');
const composer = document.querySelector('#composer');
const input = document.querySelector('#message-input');
const sendButton = composer.querySelector('button');
const statusLabel = document.querySelector('#connection-status');
let conversationId;

function addMessage(role, text) {
  const message = document.createElement('div');
  message.className = `message ${role}`;
  message.textContent = text;
  const time = document.createElement('div');
  time.className = 'message-time';
  time.textContent = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date());
  message.append(time);
  messages.append(message);
  messages.scrollTop = messages.scrollHeight;
}

function money(cents) {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(cents / 100);
}

function renderCart(result) {
  const order = result.order;
  const empty = document.querySelector('#empty-cart');
  const content = document.querySelector('#cart-content');
  const checkoutLink = document.querySelector('#checkout-link');
  document.querySelector('#cart-count').textContent = order ? String(order.quantity) : '0';
  empty.hidden = Boolean(order);
  content.hidden = !order;
  if (!order) return;

  document.querySelector('#merchant-name').textContent = order.merchant.name;
  document.querySelector('#item-name').textContent = order.item.name;
  document.querySelector('#item-modifier').textContent = order.modifiers.tomatoes
    ? `${order.modifiers.tomatoes === 'none' ? 'No' : order.modifiers.tomatoes} tomatoes`
    : 'Tomatoes choice needed';
  document.querySelector('#item-quantity').textContent = `× ${order.quantity}`;
  document.querySelector('#subtotal').textContent = money(result.cart.subtotalCents);
  document.querySelector('#total').textContent = money(result.cart.totalCents);
  document.querySelector('#order-state').textContent = order.status.replaceAll('_', ' ');
  checkoutLink.hidden = !result.checkout;
  if (result.checkout) checkoutLink.href = result.checkout.url;
}

async function newConversation() {
  const response = await fetch('/api/conversations', { method: 'POST' });
  if (!response.ok) throw new Error('Could not start a conversation.');
  const conversation = await response.json();
  conversationId = conversation.id;
  messages.replaceChildren();
  addMessage('assistant', conversation.reply);
  renderCart({ order: null, cart: null, checkout: null });
  statusLabel.textContent = 'Local session';
}

async function sendMessage(text) {
  if (!conversationId || !text.trim()) return;
  addMessage('user', text.trim());
  input.value = '';
  sendButton.disabled = true;
  try {
    const response = await fetch(`/api/conversations/${conversationId}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? 'Message could not be sent.');
    addMessage('assistant', result.reply);
    renderCart(result);
  } catch (error) {
    addMessage('assistant', error.message ?? 'Could not reach the local demo. Please try again.');
  } finally {
    sendButton.disabled = false;
    input.focus();
  }
}

composer.addEventListener('submit', (event) => {
  event.preventDefault();
  sendMessage(input.value);
});

document.querySelector('#new-order').addEventListener('click', async () => {
  try { await newConversation(); }
  catch (error) { addMessage('assistant', error.message); }
});

document.querySelectorAll('[data-message]').forEach((button) => {
  button.addEventListener('click', () => sendMessage(button.dataset.message));
});

newConversation().catch((error) => {
  statusLabel.textContent = 'Offline';
  addMessage('assistant', error.message);
});
