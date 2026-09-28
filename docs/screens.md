# Cart & Checkout — Screens

The module contributes two tabs to the hub navigation: **Carts** and **Orders**.

## Carts

Active and recent shopping carts (`cart_checkout.carts.list`, 50 rows per page). Requires
`cart_checkout.view_cart` — an employee can read this.

Open a cart for its full detail including its lines (`cart_checkout.carts.get`), or list the lines on
their own (`cart_checkout.items.list`).

A cart carries a **session token** (unique per hub), the customer's email and name, the currency
(the hub's currency unless the caller names another), an expiry, the time of last activity, notes, and its denormalised totals.

### Create a cart

Create it for a customer or for an anonymous session. It starts `active`. Requires
`cart_checkout.manage_cart`.

### Add a line

1. Give the product reference, the name, the SKU, the unit price and the quantity.
2. Optionally add variant attributes — size, colour, whatever the product needs.

The engine writes the line and **recomputes the cart's totals** in the same transaction. Requires
`cart_checkout.manage_cart`.

### Change a quantity

Update the line with the new quantity. **A quantity of zero or less removes the line** — that is the
delete path, not an error. Totals are recomputed. Requires `cart_checkout.manage_cart`.

### Remove a line

Removes one line and recomputes the totals. Requires `cart_checkout.manage_cart`.

### Empty a cart

Clears every line at once, leaving the cart empty and its totals at zero. The cart itself survives.
Requires `cart_checkout.manage_cart`.

### Mark a cart abandoned

Records that the customer never finished. The cart moves to `abandoned` and keeps its lines. Requires
`cart_checkout.manage_cart`.

### Expire old carts

A sweep marks every `active` cart whose expiry has passed as `expired`. **Nothing calls this on a
schedule** — it is a command somebody or something must invoke. Requires
`cart_checkout.manage_cart`.

### Delete a cart

Destructive: the cart and all its lines go. Requires `cart_checkout.manage_cart`.

## Orders

The checkout sessions produced from carts (`cart_checkout.orders.list`, 50 rows per page). Requires
`cart_checkout.view_cart`.

An order carries its **order number** `OS-YYYYMMDD-NNNN` (unique per hub), the shipping and billing
addresses, the shipping and payment methods, the total taken as a snapshot from the cart, and the
timestamps of each step.

### Start a checkout

Converting an **active** cart into an order:

1. Provide the addresses, the shipping method and the payment method.
2. The engine allocates the order number and creates the order as `initiated`.

The total is snapshotted from the cart at that moment. Requires `cart_checkout.checkout`.

### Mark an order paid

Records that the payment succeeded: the order becomes `paid` and the payment time is stamped.

**No payment is processed.** Nothing calls a gateway; this is a state change made after you confirmed
the money elsewhere. Requires `cart_checkout.checkout`.

### Record a failed payment

Marks the order `failed` and stores the reason. Requires `cart_checkout.checkout`.

### Complete an order

Moves a `paid` order to `completed` **and marks its cart as `converted`** in the same operation —
which is what stops the cart being reused. Requires `cart_checkout.checkout`.

## The full flow, end to end

1. Create a cart, or let one be created for a session.
2. Add lines; totals recompute automatically.
3. **Initiate checkout** — the cart becomes an `initiated` order with a number.
4. Take the money **outside this module**.
5. **Mark paid**, or **record the failure** with its reason.
6. **Complete** — the order closes and the cart becomes `converted`.

Nothing after step 3 is automatic, and nothing in the whole sequence produces an invoice, a fiscal
record or a stock movement.
