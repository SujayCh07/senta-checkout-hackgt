# Senta Checkout architecture

This document separates the production flow represented by the historical weekend patch from the local demo app added after the HackGT evidence was packaged.

## Production flow represented by the patch

1. **User action:** the customer texts a restaurant or food request, answers a menu/modifier question, corrects quantity, cancels, or changes an unpaid pickup request to delivery.
2. **Messaging and conversation:** the existing Linq inbound path reaches `CloudConversationService`. It recovers the session and active checkout task, then the semantic planner and deterministic continuation code decide whether to discover, continue, edit, or cancel.
3. **Restaurant and item resolution:** the existing DoorDash adapter searches. The weekend changes give named-merchant searches the discovery wait budget and, when provider-reported identity matches exactly, inspect the requested merchant rather than nearby alternatives. Food V2 can continue from saved menu categories and cuisine-only requests.
4. **Order state:** deterministic code updates the active task for quantity, merchant, item, and modifier changes. An in-flight restaurant search is not replanned into a duplicate provider call. Explicit cancellation clears/supersedes the appropriate foreground checkout state.
5. **Cart and persistence:** the pickup worker owns cart edits and quote rebuilding. Draft ownership checks bind the user and conversation to the task/cart context. Stored pickup drafts remain the durable source for checkout and payment reconciliation.
6. **Checkout:** an unpaid pickup checkout can be changed to a manual delivery handoff. The old Stripe session must be confirmed unpaid and expired before replacement; the provider cart is not converted into DoorDash delivery. Delivery and Senta service fees are itemized separately from the authoritative DoorDash quote.
7. **Payment and handoff:** Stripe sends a signed payment event through the existing webhook path. The payment service validates mode, session, amount, currency, cart/task identity, and fee metadata before persisting payment. Existing Linq/outbox paths notify the customer and operator; provider order submission remains a separate, manually verified step.

The production path above is explained from the baseline and five post-cutoff commits. This public repo does not contain the full production modules, tables, migrations, API server, or credentials.

### Production state and external systems

Conversation/session state owns the current task and pending question. The pickup draft persisted in the existing `senta_pickup_order_drafts` store records the canonical order/cart/payment snapshot. DoorDash remains authoritative for its cart and quote; Stripe remains authoritative for checkout/payment events. The weekend commits add fields to the existing draft schema for requested fulfillment mode, delivery address/status, and fee snapshots; they do not add database tables or copy migrations into this evidence package.

The changed pickup path checks persisted user and conversation ownership and checks task/cart linkage before making the delivery update. The in-process cart reservation also records conversation and store ownership. Stripe signatures and saved checkout identity are validated in the existing payment path. The patch does not add an auth system.

External integrations already present at baseline include Linq messaging/outbox, DoorDash CLI/catalog/cart behavior, Stripe Checkout/webhooks, and existing durable session/draft storage. This extraction includes no provider credentials, customer records, API endpoint, or deployment configuration.

### Production failure cases represented in the patch

- A slow named-merchant lookup may outlive the bounded response wait; the agent loop avoids launching a duplicate search while it is still in flight.
- A merchant search result must have exact provider-reported identity before its menu is treated as the named merchant.
- Unclear menu or modifier replies remain clarification steps; quantity/merchant corrections operate on the active task.
- Cart ownership mismatch, stale cart state, or inability to verify ownership stops the mutation for review.
- A manual delivery change on a paid/submitted order is rejected. If an unpaid Stripe session cannot be verified/expired, the existing order is left unchanged.
- Payment events with mismatched amount, currency, task/cart identity, or fee metadata are rejected.
- Networked provider behavior and live credentials are not tested by the included mocked test suites.

## Local demo app

The local demo is separate from the historical patch and does not connect to production services.

### Request path

1. The browser sends a natural-language message to `POST /api/conversations/:id/messages`.
2. `ConversationService` checks that the in-memory conversation exists, records the message, and calls `parseFoodIntent`.
3. The parser extracts a small supported action: start an order, set a quantity, replace an item, select the tomatoes modifier, cancel, or request checkout.
4. `createMockMenuCatalog` resolves the fixed Taco Bell fixture. `domain/order.js` enforces the order status and required-modifier state; `domain/cart.js` computes integer-cent totals.
5. `InMemoryConversationStore` retains the order for the lifetime of the process. A correction clears the old checkout session. The UI renders the response and cart.
6. When required modifiers are complete, the user can request checkout. `MockCheckoutProvider` creates a local checkout URL. Its test button can move an open session to `simulated_paid` once; it performs no payment operation.

### Demo routes

| Route | Behavior |
|---|---|
| `GET /` | Serves the local chat/cart UI |
| `GET /api/health` | Returns local demo status |
| `POST /api/conversations` | Creates an in-memory conversation with a random ID |
| `POST /api/conversations/:id/messages` | Applies one message to deterministic order state |
| `GET /checkout/:sessionId` | Serves the simulated checkout screen |
| `GET /api/mock-checkout/:sessionId` | Reads a mock checkout session |
| `POST /api/mock-checkout/:sessionId/complete` | Marks an open demo session simulated-paid once |

### Data, identity, and limits

The demo has no database tables: conversations and checkout sessions are stored in process memory and disappear at restart. A random conversation ID is only a local demo handle, not customer authentication or authorization. The server binds to `127.0.0.1:3002`, does not enable cross-origin access, caps JSON request bodies at 16 KiB, and serves only known static files. It does not accept addresses or card details.

The catalog is one merchant with three sample items. Prices are static, with zero tax and delivery fee. There is no live availability, provider quote, AI model, order submission, or payment processor. Unsupported items/merchants, empty messages, unknown conversation IDs, malformed/oversized request bodies, and stale checkout sessions return a clarification or HTTP error. Quantity edits, item replacement, modifier updates, and cancellation expire any open checkout. A simulated-paid order is kept unchanged; the user can start a new conversation instead.

The local demo code is independently written and added separately after the HackGT cutoff. Its presence does not change the weekend commit count or the claims in `WEEKEND_COMMITS.md`.
