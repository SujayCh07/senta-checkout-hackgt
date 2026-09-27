# HackGT 13 scope and evidence

## Verified scope

| Area | Before HackGT | Changed during HackGT |
|---|---|---|
| Messaging and conversation runtime | Existing Linq and conversation service | Added continuation and checkout-routing behavior for food conversations |
| Restaurant discovery | Existing Food V2 and DoorDash discovery | Improved cuisine-only discovery, named-merchant identity matching, and bounded waits |
| Order editing | Existing pickup task and cart flow | Improved quantity correction, merchant switching, modifier/menu continuation, and cancellation behavior |
| Pickup and checkout | Existing pickup draft, provider quote, Stripe Checkout, and payment webhook | Added an unpaid manual-delivery switch and separate service/delivery fee handling and validation |
| Tests | Existing conversation, provider, and payment tests | Modified 11 test files to cover the weekend changes |

The before/after distinction is based on the pre-cutoff commit and the diff to current HEAD. These commits modify existing files; none adds a new production source or test file.

## Git baseline

- Cutoff used: September 26, 2026, 8:00 PM America/New_York (EDT, UTC−04:00), equal to September 27, 2026, 00:00 UTC.
- Baseline commit: `7d8e3b6c64dc6e9bcbb4ee4615f8e60939d2391c` — `Fix orderable restaurant discovery`, committed September 26, 2026 at 6:52:52 PM EDT.
- Current commit: `73e0827e5c95e59237c6436c46c514574c1a8813` — `fixeddd`, committed September 26, 2026 at 9:29:53 PM EDT.
- Commits after cutoff: 5.
- Unique committed files changed: 24 (13 source files and 11 test files; all were existing files).
- Relevant checkout files changed: 24.
- Test files added or modified: 11 modified; no new test files.

## Changed-file classification

The categories overlap: every changed file was pre-existing, and each is classified by its weekend role as well.

**Clear checkout work (A):** `src/conversations/cloudConversationService.ts`, `src/conversations/foodOrderingCoordinator.ts`, `src/food-v2/FoodOrchestrator.ts`, `src/ordering/liveDoorDashAdapter.ts`, `src/pickup/pickupIntakeWorker.ts`, `src/pickup/pickupOrderDraft.ts`, `src/pickup/pickupPaymentService.ts`, `src/pickup/quantityCorrection.ts`, `src/payments/stripeProvider.ts`.

**Supporting checkout work (B):** `src/conversations/agentLoop.ts` (avoid replanning while restaurant search is still in flight), `src/messaging/types.ts` (fee totals in the response contract), `src/payments/provider.ts` (fee fields in the checkout request), and `src/routes/server.ts` (fee breakdown in the operator handoff).

**Pre-existing files modified during HackGT (C):** all 24 files above. The patch records only their changes from the baseline; it does not copy entire modules into this repository.

**Unrelated committed changes (D):** none identified in the five-commit range; all changed paths relate to food discovery, ordering state, pickup, checkout, payment, or their tests.

**Ambiguous uncommitted work (E):** excluded. Git cannot timestamp the current uncommitted changes: `src/conversations/cloudConversationService.ts`, `src/food-v2/FoodReducer.ts`, `src/pickup/doorDashPickupCatalog.ts`, `src/pickup/pickupIntakeWorker.ts`, `src/pickup/pickupOrderRepository.ts`, `tests/foodOrchestratorV2.test.ts`, `tests/foodV2StateIntegrity.test.ts`, `tests/pickupConversation.test.ts`, `tests/pickupIntakeWorker.test.ts`, `tests/pickupOrderDraft.test.ts`, `demo_assets/`, and `hackgt-senta-checkout-demo.mp4`.

**Secrets / unsafe material (F):** no production credentials or environment files are included. Test fixture phone/address literals and placeholder Stripe credentials were sanitized in the patch. Private modules, deployment files, the production environment, the uncommitted demo assets, and unrelated startup code are omitted.

## Test status at the committed snapshots

On a clean archive of current HEAD, the focused 11-file suite reported **675 passed, 10 failed** (685 total); `npm run typecheck` passed. The same focused suite on the baseline reported **652 passed, 1 failed** (653 total). The one baseline failure is `pickupPaymentUx.test.ts`’s operator-outbox ordering assertion. Nine failures appear only at current HEAD: one Food V2 merchant-replacement assertion, two pre-existing pickup total assertions that still expect the pre-fee amount, four payment-status fixtures rejected by fee validation, and two merchant/task-switch assertions. These failures are included in the report rather than hidden or patched in the extraction.

Commands, run against clean `git archive` snapshots with the repository's existing local dependencies:

```sh
npm test -- tests/agentLoop.test.ts tests/doorDashPickupCatalog.test.ts tests/foodOrchestratorV2Integration.test.ts tests/foodOrderingCoordinator.test.ts tests/pickupCheckoutBoundary.test.ts tests/pickupConversation.test.ts tests/pickupIntakeWorker.test.ts tests/pickupPaymentService.test.ts tests/pickupPaymentUx.test.ts tests/searchResultBoundary.test.ts tests/stripePaymentProvider.test.ts
npm run typecheck
```

The tests use mocks and fixtures; they do not verify live DoorDash, Stripe, Linq, or hosted database behavior.

## Public-safety scan

Scanned this directory for environment files, phone-number patterns, email addresses, credential-shaped Stripe keys/webhook secrets, bearer tokens, common database/provider endpoints, and address-like test literals. No such live values remain. The patch necessarily names Stripe, DoorDash, and Linq in code paths; those are integration names, not credentials. Test sender/address values and placeholder credentials were replaced with non-personal placeholders. No screenshot was included because the only screenshot/demo artifacts in the production checkout are uncommitted and cannot be date-verified.

## Separate local demo app

The repository also contains a small independently written demo app added after this historical audit, on September 27, 2026. It is not part of the five-commit HackGT range and is excluded from the baseline/current commit counts and the sanitized production patch.

The demo's `src/` modules model conversation orchestration, deterministic order state, cart totals, an in-memory session store, and a mock checkout adapter. `public/` contains a chat/cart UI and a simulated checkout page. `tests/` covers the service state transitions and the HTTP path. The demo does not include the production backend or connect to Linq, a model API, DoorDash, Stripe, or a database. Its simulated payment cannot move money. See `ARCHITECTURE.md` for routes, state ownership, and limitations.
