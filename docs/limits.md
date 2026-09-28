# Cart & Checkout — Limits and troubleshooting

## Known limitations you should know about

- **Nothing fiscal happens here.** No invoice, no tax record, no VeriFactu. A completed order is not
  a documented sale.
- **No stock is moved.** No module consumes this one's events.
- **No payment is processed.** "Paid" and "failed" are states you set.
- **No scheduled task.** Carts do not expire on their own; the sweep must be invoked.
- **No abandoned-cart notifications.**
- **No catalogue validation.** A product reference is free text.
- **No tax calculation.** Amounts are taken as given.

## Accepted values

| Field | Values |
|---|---|
| Cart status | `active`, `abandoned`, `converted`, `expired` |
| Order status | `initiated`, `paid`, `failed`, `completed` |
| Currency | ISO 4217 code; when left out, the hub's currency (`EUR` if the hub never set one) |
| Quantity | fixed-point integer, scale 10⁶; **≤ 0 removes the line** |
| Money | integer cents |

## Caps and sizes

| Limit | Value |
|---|---|
| Rows per page (carts, items, orders) | 50 |
| Maximum rows a paginated request may ask for | 500 |
| Session token | unique per hub |
| Order number | unique per hub, `OS-YYYYMMDD-NNNN` |
| Orders per day per hub, by numbering | 9999 |

## Permissions per action

| To do this | You need |
|---|---|
| See carts, lines and orders | `cart_checkout.view_cart` |
| Create a cart, add / update / remove lines, clear, abandon, expire, delete | `cart_checkout.manage_cart` |
| Initiate a checkout, mark paid, record a failure, complete | `cart_checkout.checkout` |

By role: **admin** has everything. **manager** has all three. **employee** is **read-only** — an
employee cannot touch a cart or a checkout at all.

## Dependencies

**None in either direction.** The module depends on nothing, nothing depends on it, and it listens to
no events.

That isolation is why product data is a free snapshot. It also means the obvious integrations do
**not** exist:

| You might expect | Reality |
|---|---|
| A paid order decrements stock | It does not — `inventory` does not listen |
| A completed order becomes a sale or an invoice | It does not — nothing bridges to `sales` or `invoice` |
| The order appears in the till's reports | It does not |
| A payment gateway is involved | It is not |

Its events are published for anybody who wants to build those bridges; none is declared today.

## When something looks wrong

**"An order was paid but stock did not move."** Correct. This module moves no stock and nothing
listens to its events.

**"A completed order has no invoice."** Correct. Nothing fiscal happens here.

**"The money never arrived."** Marking an order paid takes no payment. It records that you confirmed
one elsewhere.

**"The cart totals look wrong."** They are a snapshot recomputed by the engine on every line change.
If they disagree with the lines, the lines were changed by something that bypassed the commands.

**"The item count is a huge number."** Quantities — and the cart's item count — are scaled by
1 000 000. `2000000` is two units. The **amount** is in cents and is *not* scaled that way.

**"Setting a quantity to zero deleted the line."** That is the intended behaviour.

**"Old carts never expire."** Nothing runs the sweep automatically. Invoke the expiry command.

**"A cart was checked out twice."** Initiating a checkout does not convert the cart — only
**completing** the order does. If you need the cart locked earlier, complete the order or abandon the
cart.

**"The order total did not follow a change to the cart."** By design: the order snapshots the total
when the checkout starts.

**"A product reference points at nothing."** It is free text with no validation and no link to the
catalogue.

**"I deleted a cart and lost the record."** Cart deletion takes the lines with it. Use **abandoned**
when you want to keep the history.
