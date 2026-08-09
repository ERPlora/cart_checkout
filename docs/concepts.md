# Cart & Checkout — Concepts

The things people get wrong on their first day.

## This is not the till, and nothing here is fiscal

`sales` also has a basket that becomes an order, and the two modules have nothing to do with each
other.

A **paid, completed order in this module has produced nothing else**: no invoice, no VeriFactu
record, no stock movement, no cash movement. If a purchase must be invoiced or reported, that has to
happen through `sales` and `invoice` — this module does not trigger it.

That is the single most important thing on this page.

## Marking an order paid does not take any money

There is no gateway, no card, no bank. "Paid" is a **state you set after the money arrived somewhere
else**. The same is true of "failed": it records a reason you supply.

## Two lifecycles, and they interlock at one point

**The cart**: `active → abandoned`, `converted` or `expired`.
**The order**: `initiated → paid` or `failed`, then `completed`.

They meet exactly once: **completing an order marks its cart `converted`**, in the same operation.
That is what stops a cart being checked out twice.

Note the asymmetry — initiating a checkout does *not* convert the cart. A cart with an `initiated`
order is still `active`.

## A quantity of zero removes the line

Updating a line to zero or less is the **delete path**, not an error. There is no separate "remove"
step in that flow, though a dedicated remove command also exists.

## Totals are a snapshot the engine maintains

The cart's item count and amount are **denormalised** and recomputed by the engine every time lines
change. Never write them by hand, and never assume they are stale — but do remember they are a copy,
not a live sum.

The order's total is a **separate snapshot**, taken from the cart when the checkout is initiated.
Changing the cart afterwards does not change the order.

## Quantities are scaled by a million; money is not

Two different conventions live side by side and mixing them is the classic bug:

- **Quantities** are fixed-point integers scaled by 10⁶ — `500000` is half a unit (ADR-0147). The
  cart's **item count** inherits that scale.
- **Money** is integer cents — `1250` is 12,50 € (ADR-0123). The cart's **amount** stays in cents and
  was deliberately not rescaled.

So on the same row, `total_items` and `total_amount` use different scales. That is intentional.

## The line total is computed from the logical quantity

A line's total is the **logical** quantity times the unit price, not the raw scaled integer times the
price. The engine does that conversion; nothing else should.

## Products are a free snapshot, with no link to any catalogue

A line stores a product reference, a name and a SKU as plain text, with **no foreign key**. This
module does not depend on `inventory` and does not verify that the product exists.

Consequences: a typo in the reference is accepted; renaming a product in the catalogue does not
update carts; and a cart survives the catalogue module being removed. Variant attributes are free
data too.

## Nothing expires by itself

There is a command that marks expired carts, and **nothing calls it on a schedule** — this module
declares no scheduled task. A cart with a past expiry stays `active` until somebody runs the sweep.

The same goes for abandonment: marking a cart abandoned is a deliberate action, not a timeout.

## Order numbers are per day and allocated atomically

`OS-YYYYMMDD-NNNN`, unique per hub, from a counter bumped in the same transaction that writes the
order. Two simultaneous checkouts cannot collide, and the sequence restarts each day.

## The session token is what identifies a guest cart

It is unique per hub, which is what lets an anonymous visitor keep a basket without an account. A
customer email and name can be attached, but neither is required and neither links to `customers`.

## Several events are emitted by the handler, not the manifest

Adding, updating and clearing items, expiring carts, initiating a checkout and completing an order all
emit their events **from the engine**. Grepping the manifest for them finds nothing, and you would
wrongly conclude they do not exist.

## Deleting is different from the rest

Cart deletion is described as permanent and takes the lines with it, while lines and carts elsewhere
in this module are soft-deleted. If you need the record, mark the cart **abandoned** instead.
