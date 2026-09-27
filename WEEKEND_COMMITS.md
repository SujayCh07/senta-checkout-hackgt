# Verified post-cutoff commits

The commit messages below are preserved as recorded, even though several are uninformative. Author and committer timestamps match for all five commits. The commits form a direct parent chain from the baseline to current HEAD, with no merge commit in this range. Git metadata has no independent marker that can rule out an unmarked cherry-pick.

## `9f9285f` — `fixed`

- Author and committer timestamp: 2026-09-26 20:22:40 EDT (2026-09-27 00:22:40 UTC)
- Files: `src/conversations/agentLoop.ts`, `src/conversations/cloudConversationService.ts`, `src/conversations/foodOrderingCoordinator.ts`, `src/food-v2/FoodOrchestrator.ts`, `src/ordering/liveDoorDashAdapter.ts`, `src/pickup/quantityCorrection.ts`, `tests/agentLoop.test.ts`, `tests/doorDashPickupCatalog.test.ts`, `tests/foodOrchestratorV2Integration.test.ts`, `tests/foodOrderingCoordinator.test.ts`, `tests/pickupConversation.test.ts`, `tests/searchResultBoundary.test.ts`.
- What changed: added named-merchant and cuisine discovery handling, saved menu-category continuation, quantity correction precedence, and protection against replanning while a timed-out restaurant search remains in flight.
- Why it matters: the conversation can carry a food request farther through discovery and correction without changing cart truth based on a planner response alone.

## `e4acbdb` — `fixed`

- Author and committer timestamp: 2026-09-26 20:57:10 EDT (2026-09-27 00:57:10 UTC)
- Files: `src/conversations/cloudConversationService.ts`, `src/messaging/types.ts`, `src/payments/provider.ts`, `src/payments/stripeProvider.ts`, `src/pickup/pickupIntakeWorker.ts`, `src/pickup/pickupOrderDraft.ts`, `src/pickup/pickupPaymentService.ts`, `src/routes/server.ts`, `tests/pickupCheckoutBoundary.test.ts`, `tests/pickupConversation.test.ts`, `tests/pickupIntakeWorker.test.ts`, `tests/pickupPaymentService.test.ts`, `tests/pickupPaymentUx.test.ts`, `tests/stripePaymentProvider.test.ts`.
- What changed: implemented a manual delivery switch for an unpaid pickup checkout, draft/ownership and old-session checks, and separate service/delivery fee fields and Stripe line items.
- Why it matters: delivery intent can update the payment handoff while preserving the provider cart/quote boundary and without claiming the provider supports delivery.

## `d93dc31` — `fixed`

- Author and committer timestamp: 2026-09-26 21:12:15 EDT (2026-09-27 01:12:15 UTC)
- Files: `src/conversations/cloudConversationService.ts`, `src/messaging/types.ts`, `src/payments/provider.ts`, `src/payments/stripeProvider.ts`, `src/pickup/pickupIntakeWorker.ts`, `src/pickup/pickupOrderDraft.ts`, `src/pickup/pickupPaymentService.ts`, `src/routes/server.ts`, `tests/pickupConversation.test.ts`, `tests/pickupPaymentService.test.ts`, `tests/pickupPaymentUx.test.ts`, `tests/stripePaymentProvider.test.ts`.
- What changed: included fee amounts in payment idempotency and Stripe metadata, displayed a fee-inclusive total, and validated fee metadata and charged totals when consuming payment events.
- Why it matters: payment confirmation must reconcile against the saved quote and fee snapshot instead of accepting a generated or stale total.

## `412ee8a` — `fixed`

- Author and committer timestamp: 2026-09-26 21:16:24 EDT (2026-09-27 01:16:24 UTC)
- Files: `src/conversations/cloudConversationService.ts`, `tests/pickupConversation.test.ts`.
- What changed: allowed cancellation while a manual delivery handoff is pending and added a test that the following order starts without stale delivery state.
- Why it matters: cancellation remains user-controlled across the new delivery continuation path.

## `73e0827` — `fixeddd`

- Author and committer timestamp: 2026-09-26 21:29:53 EDT (2026-09-27 01:29:53 UTC)
- Files: `src/conversations/cloudConversationService.ts`, `src/pickup/pickupIntakeWorker.ts`, `src/pickup/pickupPaymentService.ts`, `tests/pickupConversation.test.ts`, `tests/pickupPaymentService.test.ts`.
- What changed: tied cart-reservation ownership to conversation/store state and refined repeated cart-review, delivery, and verification responses while retaining the current provider quote for the replacement checkout flow.
- Why it matters: the service can stop unsafe cart reuse and make recovery responses clearer while retaining persisted checkout evidence.

## Range summary

- `PRE_HACKGT_COMMIT`: `7d8e3b6c64dc6e9bcbb4ee4615f8e60939d2391c`
- Current HEAD: `73e0827e5c95e59237c6436c46c514574c1a8813`
- Five commits, 24 unique files: 13 existing source files and 11 existing test files.
- No content from the current uncommitted working tree is represented in `weekend-checkout.patch`.
- Four messages are `fixed`; the last is `fixeddd`. No commit timestamps were altered for this package.
