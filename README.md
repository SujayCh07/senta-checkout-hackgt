# Senta Checkout

Senta is an existing conversational commerce platform.

During HackGT 13, we focused on building and hardening Senta Checkout, a conversational food-ordering workflow that takes a user from a natural-language request through restaurant and item selection, required customizations, cart creation, and checkout.

This repository contains code and documentation for work completed during the HackGT 13 hacking period. The production Senta backend is private and includes additional infrastructure that is not included here.

## What it does

A user can text something like:

> Get me 2 Crunchwrap Supremes from Taco Bell.

The HackGT changes improve how the existing service carries restaurant, item, quantity, modifier, cart, and checkout intent across messages. The patch documents the committed implementation changes and their regression tests; this repository is not a standalone ordering service.

## Why we built it

Users who already know what they want should not have to repeatedly search, browse, navigate menus, configure items, and manually assemble a cart. A conversational flow can keep the order together while the user refines it.

## HackGT work

The following claims are tied to the five commits after the stated cutoff:

- Made cuisine-only and named-merchant requests continue into restaurant discovery, including exact provider-name handling for a requested merchant.
- Improved conversation continuation for saved menu categories, order quantity corrections, merchant changes, cancellation, and slow in-flight restaurant searches.
- Added an unpaid pickup-to-manual-delivery path, delivery and service-fee line items, and fee-aware payment validation and summaries.
- Tightened pickup cart ownership checks across user, conversation, task, and store state.

The detailed evidence is in [WEEKEND_COMMITS.md](WEEKEND_COMMITS.md) and [HACKGT_SCOPE.md](HACKGT_SCOPE.md). All 24 touched files already existed before the cutoff; the weekend range modifies them and adds no new production source files.

## Existing before HackGT

The baseline commit already contains Senta’s messaging and conversation service, Food V2 orchestration, DoorDash ordering adapter, pickup cart and draft flow, Stripe checkout and webhook handling, and their tests. The HackGT contribution is a set of changes to this existing system, not a new standalone platform.

## Architecture

```text
User text over Linq
        |
        v
Conversation recovery and intent/planner interpretation
        |
        v
Deterministic continuation and checkout-task state
        |
        v
DoorDash merchant/menu/cart/quote capabilities
        |
        v
Persisted pickup draft and provider-verified quote
        |
        v
Stripe Checkout with separately itemized fees
        |
        v
Payment webhook validation and Linq/outbox handoff
```

The language model can interpret flexible wording, but deterministic application state owns merchant identity, item, quantity, modifiers, cart identity, payment status, and checkout transitions. A successful payment event must match the saved checkout session, amount, currency, fee metadata, task, and cart before it can update the order.

See [ARCHITECTURE.md](ARCHITECTURE.md) for the end-to-end flow, persistence, ownership checks, external services, and failure cases.

## Running the code

This repository is a review artifact containing a sanitized patch and documentation, not a runnable source checkout. The patch references private/pre-existing modules and requires the original Senta repository and its private provider infrastructure to build or run.

This repository contains the HackGT-specific implementation and tests extracted from a larger private system. The production environment requires private provider infrastructure and credentials that are intentionally not included.

No standalone `npm run dev` or test command is provided because that would imply this extracted patch is independently executable.

## Production note

The live Senta demo runs on private production infrastructure. This repository documents and contains the HackGT-specific code contribution while keeping unrelated startup infrastructure and credentials private.

## Patch provenance

`weekend-checkout.patch` was generated with `git diff --unified=0 PRE_HACKGT_COMMIT..HEAD`, so it contains only the committed range and no unchanged source snapshots. The original range touched 24 files: 13 source files and 11 test files. Test-only phone/address fixtures, placeholder Stripe credentials, and a test return URL were replaced with synthetic/example values. No implementation logic was rewritten. The sanitized patch is for review and provenance; it has not been applied to or committed in this repository.
