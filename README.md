# Senta Checkout

Senta is an existing conversational commerce platform.

During HackGT 13, we focused on building and hardening Senta Checkout, a conversational food-ordering workflow that takes a user from a natural-language request through restaurant and item selection, required customizations, cart creation, and checkout.

The production Senta backend is private and includes additional infrastructure that is not included here. The five verified post-cutoff production commits are preserved as a sanitized patch. This repository also contains a small local demo app, added separately after the HackGT evidence was packaged; the demo is not part of those weekend commits.

## What it does

A user can text something like:

> Get me 2 Crunchwrap Supremes from Taco Bell.

The local demo keeps a sample order together as the user chooses tomatoes, changes the quantity or item, and continues to a simulated checkout page. Its layers follow the same broad conversational-commerce boundaries as Senta while using original demo code and mock systems.

## Why we built it

Users who already know what they want should not have to repeatedly search, browse, navigate menus, configure items, and manually assemble a cart. A conversational flow can keep the order together while the user refines it.

## HackGT work

The verified weekend changes improved cuisine-only and named-merchant discovery, ordering continuation and corrections, and pickup checkout and payment handling. The evidence is in [WEEKEND_COMMITS.md](WEEKEND_COMMITS.md), [HACKGT_SCOPE.md](HACKGT_SCOPE.md), and [weekend-checkout.patch](weekend-checkout.patch). Those files describe the five commits after the cutoff; the local demo app is a separate addition.

## Existing before HackGT

The baseline commit already contains Senta’s messaging and conversation service, Food V2 orchestration, DoorDash ordering adapter, pickup cart and draft flow, Stripe checkout and webhook handling, and their tests. The HackGT contribution is a set of changes to this existing system, not a new standalone platform.

## Architecture

The demo app uses a browser chat UI, a small HTTP API, deterministic order state, an in-memory conversation store, a sample catalog, and a simulated checkout adapter. The language interpreter can recognize only a small set of demo phrases; deterministic application logic owns the merchant, item, quantity, modifiers, cart, and checkout status.

```text
Browser chat
    |
    v
POST /api/conversations/:id/messages
    |
    v
ConversationService
  /       |        \
parser  order     catalog adapter
          state
    |
    v
Cart builder -> in-memory conversation store
    |
    v
Mock checkout adapter -> local demo checkout page
```

This demo does not call Linq, a language model, DoorDash, Stripe, or a database. Its checkout action only changes an in-memory session to `simulated_paid`; it cannot collect card details or move money. See [ARCHITECTURE.md](ARCHITECTURE.md) for both the production flow described by the patch and the separate local demo architecture.

## Run locally

Requirements: Node.js 20 or newer. There are no third-party runtime dependencies.

```sh
npm run dev
```

Open [http://localhost:3002](http://localhost:3002). Try an order, answer the tomatoes question, send `checkout`, then use the simulated checkout button. No real orders or payments are made.

Run the checks with:

```sh
npm test
npm run check
```

The integration test uses `localhost:3002`; stop another local process using that port before running it.

## Demo boundaries

The sample menu and prices are local fixtures. Tax, delivery, restaurant availability, customer authentication, durable storage, and provider quote validation are not implemented in the demo. Conversations disappear when the server restarts. The server binds to `127.0.0.1` and is for local demonstration only. Do not enter personal, address, or payment information.

## Production note

The live Senta demo runs on private production infrastructure. This repository documents the verified HackGT code contribution and provides a separate local demo while keeping unrelated startup infrastructure and credentials private.

## Patch provenance

`weekend-checkout.patch` was generated with `git diff --unified=0 PRE_HACKGT_COMMIT..HEAD`, so it contains only the committed range and no unchanged source snapshots. The original range touched 24 files: 13 source files and 11 test files. Test-only phone/address fixtures, placeholder Stripe credentials, and a test return URL were replaced with synthetic/example values. No implementation logic was rewritten. The sanitized patch is for review and provenance; it has not been applied to or committed in this repository.
