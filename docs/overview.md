# Cart & Checkout — Overview

## What this module does

Cart & Checkout is the e-commerce basket. It holds **carts** — a guest or identified basket with its
lines — and the **checkout sessions** those carts become: an order with a number, an address, a
shipping and payment method, and a payment state.

It covers two lifecycles: the cart (`active → abandoned / converted / expired`) and the order
(`initiated → paid / failed → completed`).

## It is not the point of sale

This module and `sales` both have "a basket that becomes an order", and they are **completely
separate**:

| | **Cart & Checkout** | **Sales** |
|---|---|---|
| For | Online / self-service purchases | The counter |
| Basket | A cart with a session token | An open check (order) |
| Result | A checkout session with an order number | An immutable sale |
| Fiscal | **No** — nothing fiscal happens here | Yes — invoices, VeriFactu |
| Stock | **Not touched** | Decremented via events |

**Nothing here is fiscal and nothing here moves stock.** A paid order in this module has produced no
invoice, no tax record and no stock movement.

## What this module does NOT do

- **It does not take payments.** Marking an order paid is a state change; no gateway is called.
- **It does not decrement stock.** No event of this module is consumed by `inventory`.
- **It does not produce an invoice or a fiscal record.**
- **It does not know your catalogue.** A cart line stores a product reference, name and SKU as a
  free snapshot, with **no foreign key**.
- **It does not compute tax.** Amounts are what was put in.
- **It does not expire carts on a timer.** Expiry is a command someone or something must call.
- **It does not send abandoned-cart emails.**

## Modules it connects to

**Depends on nothing**, and nothing depends on it. It listens to no events.

**Events it emits**

| Event | When |
|---|---|
| `cart_checkout.cart.created` / `.abandoned` / `.deleted` / `.cleared` | the cart changes |
| `cart_checkout.carts.expired` | the expiry sweep runs |
| `cart_checkout.item.added` / `.updated` / `.removed` | lines change |
| `cart_checkout.checkout.initiated` | a cart becomes an order |
| `cart_checkout.order.paid` / `.failed` / `.completed` | the order advances |

Several of these are emitted **by the handler**, not declared in the manifest — adding, updating and
clearing items, expiry, initiating checkout and completing an order.

## Where its numbers come from

- **Money is integer cents** (ADR-0123): unit prices, line totals and order totals.
- **Quantities are fixed-point integers scaled by 1 000 000** (ADR-0147): `500000` is half a unit.
  The cart's item count inherits that scale; **its amount does not** — that stays in cents.
- **Order numbers** are `OS-YYYYMMDD-NNNN`, from an atomic per-hub, per-day counter.
- **A cart's totals are a denormalised snapshot**, recomputed by the engine whenever lines change.
