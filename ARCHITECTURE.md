# Senta Checkout architecture

This file describes the application in this repository. The historical HackGT commit evidence is separate and linked from the README.

## Customer flow

1. The browser registers or signs in through `POST /api/auth/register` or `POST /api/auth/login`. The account service normalizes email and verifies scrypt password hashes. A random session token is sent in an HttpOnly, SameSite cookie; only its SHA-256 digest is stored in SQLite. Authenticated mutations also require the session's CSRF token and the configured same-origin value.
2. The browser loads `GET /api/catalog`, then creates a conversation at `POST /api/conversations`. The conversation route derives the owner from the session; clients never submit an account ID as authority.
3. `POST /api/conversations/:id/messages` stores the user's message, assistant reply, and new conversation state in one SQLite transaction. `catalogIntent.js` proposes a supported action based on menu records; it does not determine prices or directly mutate database state.
4. The persistent conversation service calls the order repository for new carts, quantity changes, option changes, and cancellation. `orders` and `order_items` are the durable commerce records. Price totals come from the current catalog and integer-cent modifiers. Every edit requires an expected revision and an account-owner predicate.
5. `POST /api/orders/:id/checkout` rechecks ownership, revision, status, and stored amount. It creates a durable `checkout_attempts` row before calling Stripe's Checkout Sessions API. The outbound request uses the saved amount, an order/revision metadata snapshot, card-only payment methods, and one stable idempotency key per order revision.
6. Stripe redirects the browser back to the application, but that redirect does not mark the order paid. `POST /api/webhooks/stripe` verifies Stripe's signature against the raw request bytes and timestamp, then matches event ID, attempt, Stripe session ID, order ID, order revision, amount, and currency before updating payment state.

## Components

| Area | Files | Responsibility |
|---|---|---|
| Browser | `public/index.html`, `public/app.js`, `public/auth.js` | Account gate, conversation, current menu suggestions, cart, and Stripe handoff |
| HTTP | `src/server.js`, `src/http/routes/*`, `src/http/body.js`, `src/http/security.js` | Route dispatch, bounded request parsing, session/CSRF/origin enforcement, stable error responses |
| Application | `src/application/*` | Account lifecycle, conversational transitions, checkout attempt coordination, webhook orchestration |
| Domain | `src/domain/*` | Catalog intent proposals and integer-cent pricing rules |
| Persistence | `src/persistence/*` | Prepared SQLite reads/writes scoped by account and revision |
| Infrastructure | `src/infrastructure/*`, `src/config.js`, `src/runtime.js` | SQLite setup/migrations, scrypt, session tokens, config, process composition |
| Provider | `src/providers/*` | Stripe Checkout API call and raw-body webhook signature verification |

## Data and trust boundaries

- `users` stores normalized email and salted scrypt credentials. `sessions` stores the session digest, CSRF token, account owner, and expiry.
- `restaurants`, `menu_items`, and `modifiers` are the application catalog. The current Northstar Kitchen records are a locally maintained starter catalog; there is no live restaurant menu or availability feed.
- `conversations` stores account ownership and compact state; `messages` stores an ordered user/assistant history.
- `orders` stores the durable status, amount, currency, and revision; `order_items` stores the current item and selected option snapshot.
- `checkout_attempts` records the order revision, amount, currency, Stripe session, and idempotency key. `provider_events` deduplicates webhook event IDs. `outbox_events` is reserved for durable follow-up work; this app does not submit a restaurant order.
- Stripe test mode is the only external service. Its hosted page collects payment details. The app itself never receives card data or uses a redirect as payment evidence.

## Permissions and failure behavior

- Conversation and order queries include both the resource ID and authenticated user ID. A guessed ID owned by another account returns not found.
- Browser mutations require same-origin and CSRF checks. Request JSON is bounded and malformed bodies receive a client error.
- Orders can only be edited in `draft` or `ready`. A stale revision returns a conflict instead of replacing a newer cart.
- Missing Stripe test credentials disable checkout. A known Stripe rejection restores the order to `ready`; a network timeout records `payment_unknown` and retries use the existing idempotency key.
- Webhook signatures use the exact raw body and a five-minute timestamp tolerance. Replayed event IDs are acknowledged without a second transition. Session, metadata, revision, amount, currency, mode, or unpaid-state mismatches cannot mark an order paid.
- A Stripe-confirmed payment is not proof that a restaurant received or fulfilled the order. Provider order submission is outside this application.

## Historical HackGT evidence

The standalone app is separate from the five verified post-cutoff changes described in [`WEEKEND_COMMITS.md`](WEEKEND_COMMITS.md). The public repository does not include the full production source tree, its credentials, or its deployment environment.
