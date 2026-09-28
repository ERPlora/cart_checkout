#!/usr/bin/env python3
"""A cart created without a currency is born in the HUB's currency, against the REAL kernel (cart_checkout#34).

The assistant and an API integration call `cart_checkout.carts.create` through the same door as
the Carts screen (`POST /api/command`), but they may leave `currency` out. The runtime fills an
absent property with its schema `default` before the SQL runs, so only a real runtime proves the
whole chain: the setting the admin screen writes (`PUT /api/settings`) is the one the command
reads, for THIS hub, after the runtime has applied the schema.

  1. Hub in yen + no `currency` → the cart reads back in JPY.
  2. Hub in yen + `currency: null` → JPY as well (the key sent empty is not an error).
  3. An explicit currency wins: hub in yen + `currency: "USD"` → USD.
  4. Hub back in euros + no `currency` → EUR — the euro did not move.

The hub is shared with every battery of the run, so the currency it had is restored at the end
whatever happens.

Usage: `erplora test <dir> --against-hub [dev|stable|sha256:…]` (module-toolkit#110). Never on its
own: without a runtime it fails, it does not skip.
"""

import sys
import uuid

import hub_harness
from hub_harness import Hub


def set_currency(hub: Hub, code: str) -> None:
    """The hub's currency through the real admin door — the write the settings screen makes."""
    status, body = hub._request("PUT", "/api/settings", {"currency": code})
    if status != 200 or (body or {}).get("currency") != code:
        raise AssertionError(
            f"PUT /api/settings currency={code} answered {status}: {body}"
        )


def created_currency(hub: Hub, extra: dict) -> str | None:
    """Creates a cart with `extra` merged into the payload and reads its currency back."""
    token = f"hub-battery-{uuid.uuid4().hex[:12]}"
    hub.run("cart_checkout.carts.create", {"session_token": token, **extra})
    rows = hub.query("cart_checkout.carts.get", {"session_token": token})
    hub.check("cart found", len(rows), 1)
    return rows[0].get("currency") if rows else None


def main() -> int:
    hub = Hub("cart_currency.hub")
    print(
        f"Hub battery · cart currency from the hub (cart_checkout#34) · {hub_harness.BASE} · hub {hub.hub_id} · user {hub.user}"
    )
    status, before = hub._request("GET", "/api/settings")
    if status != 200:
        print(f"GET /api/settings answered {status}: {before}")
        return 1
    original = (before or {}).get("currency") or "EUR"
    try:
        print("\n1 · hub in yen, payload without currency")
        set_currency(hub, "JPY")
        hub.check("currency", created_currency(hub, {}), "JPY")

        print("\n2 · hub in yen, currency sent as null")
        hub.check("currency", created_currency(hub, {"currency": None}), "JPY")

        print("\n3 · an explicit currency wins over the hub's")
        hub.check("currency", created_currency(hub, {"currency": "USD"}), "USD")

        print("\n4 · hub in euros, payload without currency")
        set_currency(hub, "EUR")
        hub.check("currency", created_currency(hub, {}), "EUR")
    finally:
        set_currency(hub, original)

    return hub.finish("a cart without a currency is born in the hub's currency")


if __name__ == "__main__":
    sys.exit(main())
