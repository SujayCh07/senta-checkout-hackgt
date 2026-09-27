# Senta Checkout

Senta Checkout is a conversational ordering application. A signed-in customer can build and revise a cart from the application catalog, review its server-calculated price, and hand off payment to Stripe Checkout in test mode.

This repository also preserves a separately audited snapshot of five HackGT 13 commits in [`WEEKEND_COMMITS.md`](WEEKEND_COMMITS.md) and [`weekend-checkout.patch`](weekend-checkout.patch). The patch records changes to an existing private production codebase; this standalone app does not contain that private backend or claim production deployment.

## Run locally

Requirements: Node.js 24.4 or newer. The app uses Node's built-in SQLite API and has no third-party runtime dependencies.

```sh
cp .env.example .env
npm run dev
```

Open [http://localhost:3002](http://localhost:3002). Create an account, choose a menu item, edit the quantity or options, then continue to Stripe Checkout when test credentials are configured.

Stripe checkout is enabled only when both `STRIPE_SECRET_KEY` (`sk_test_...`) and `STRIPE_WEBHOOK_SECRET` (`whsec_...`) are set. For local webhook delivery, forward events to `http://localhost:3002/api/webhooks/stripe` and place the listener's signing secret in `.env`. Live Stripe keys are refused. Without both test-mode values, ordering works and the checkout button stays unavailable.

Run the checks with:

```sh
npm test
npm run check
```

The HTTP integration test binds to `127.0.0.1:3002`; the remaining tests use temporary SQLite databases and injected network boundaries. The app itself binds to `127.0.0.1` by default. SQLite currently emits Node's experimental API warning.

## System flow

```text
Browser
  ├─ account/session ──> auth routes ──> scrypt credentials + SQLite sessions
  ├─ menu and messages ─> conversation service ─> parser proposal
  │                                           ├─ catalog and order repositories
  │                                           └─ atomic conversation/message/order transaction
  └─ checkout button ───> checkout service ───> Stripe Checkout test API
                              ^                         │
                              └── signed webhook <──────┘
```

SQLite stores accounts, token hashes, the catalog, conversations and ordered messages, order snapshots, checkout attempts, and Stripe event IDs. Every conversation, order, and checkout read is scoped to the authenticated account. Order edits require the current revision, and catalog prices are stored in integer cents.

Stripe owns payment confirmation. A return-page redirect does not change order status; only a signed webhook with matching session, order, revision, amount, currency, and payment state can mark an order paid. Timeouts enter `payment_unknown` and retries reuse the same idempotency key. Restaurant order submission and fulfillment are not implemented.

See [`ARCHITECTURE.md`](ARCHITECTURE.md) for the request path, table ownership, permissions, external service boundary, and failure handling.
