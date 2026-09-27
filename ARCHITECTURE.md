# Senta Checkout: weekend implementation flow

This document describes the production path touched by the verified weekend diff. This directory contains only the sanitized diff and explanatory documents, so the path below cannot run from this directory by itself.

## End-to-end flow

1. **User action:** the customer texts a restaurant or food request, answers a menu/modifier question, corrects quantity, cancels, or changes an unpaid pickup request to delivery.
2. **Messaging and conversation:** the existing Linq inbound path reaches `CloudConversationService`. It recovers the session and active checkout task, then the semantic planner and deterministic continuation code decide whether to discover, continue, edit, or cancel.
3. **Restaurant and item resolution:** the existing DoorDash adapter searches. The weekend changes give named-merchant searches the discovery wait budget and, when provider-reported identity matches exactly, inspect the requested merchant rather than nearby alternatives. Food V2 can continue from saved menu categories and cuisine-only requests.
4. **Order state:** deterministic code updates the active task for quantity, merchant, item, and modifier changes. An in-flight restaurant search is not replanned into a duplicate provider call. Explicit cancellation clears/supersedes the appropriate foreground checkout state.
5. **Cart and persistence:** the pickup worker owns cart edits and quote rebuilding. Draft ownership checks bind the user and conversation to the task/cart context. Stored pickup drafts remain the durable source for checkout and payment reconciliation.
6. **Checkout:** an unpaid pickup checkout can be changed to a manual delivery handoff. The old Stripe session must be confirmed unpaid and expired before replacement; the provider cart is not converted into DoorDash delivery. Delivery and Senta service fees are itemized separately from the authoritative DoorDash quote.
7. **Payment and handoff:** Stripe sends a signed payment event through the existing webhook path. The payment service validates mode, session, amount, currency, cart/task identity, and fee metadata before persisting payment. Existing Linq/outbox paths notify the customer and operator; provider order submission remains a separate, manually verified step.

## State ownership and data stores

Conversation/session state owns the current task and pending question. The pickup draft persisted in the existing `senta_pickup_order_drafts` store records the canonical order/cart/payment snapshot. DoorDash remains authoritative for its cart and quote; Stripe remains authoritative for checkout/payment events. The weekend commits add fields to the existing draft schema for requested fulfillment mode, delivery address/status, and fee snapshots; they do not add database tables or copy migrations into this evidence package.

The checkout task and draft are linked. Newer explicit user input can update an unpaid order, but paid/submitted orders are protected from automatic changes. A checkout URL or model response is not proof of payment or provider submission.

## Permissions and external services

The changed pickup path checks persisted user and conversation ownership and checks task/cart linkage before making the delivery update. The in-process cart reservation also records conversation and store ownership. Stripe signatures and saved checkout identity are validated in the existing payment path. The patch does not add an auth system.

External integrations already present at baseline include Linq messaging/outbox, DoorDash CLI/catalog/cart behavior, Stripe Checkout/webhooks, and existing durable session/draft storage. This extraction includes no provider credentials, customer records, API endpoint, or deployment configuration.

## Failure cases covered or guarded

- A slow named-merchant lookup may outlive the bounded response wait; the agent loop avoids launching a duplicate search while it is still in flight.
- A merchant search result must have exact provider-reported identity before its menu is treated as the named merchant.
- Unclear menu or modifier replies remain clarification steps; quantity/merchant corrections operate on the active task.
- Cart ownership mismatch, stale cart state, or inability to verify ownership stops the mutation for review.
- A manual delivery change on a paid/submitted order is rejected. If an unpaid Stripe session cannot be verified/expired, the existing order is left unchanged.
- Payment events with mismatched amount, currency, task/cart identity, or fee metadata are rejected.
- Networked provider behavior and live credentials are not tested by the included mocked test suites.
