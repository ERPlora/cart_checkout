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

It talks to the runtime through the public doors under the runtime's own `hub_id`
(`GET /api/hub/context`, hub#594) and a user minted per run (dev auth trusts `X-User-Id`). The hub
is shared with every battery of the run, so the currency it had is restored at the end whatever
happens.

Usage: `erplora test <dir> --against-hub [dev|stable|sha256:…]` (module-toolkit#110). Never on its
own: without a runtime it FAILS, it does not skip (module-toolkit#50).
"""

import json
import os
import sys
import urllib.error
import urllib.request
import uuid

BASE = (os.environ.get("ERPLORA_HUB_BASE_URL") or "").rstrip("/")
BATTERY = "cart_currency.hub"
USER = f"u-{uuid.uuid4().hex[:8]}"

failures: list[str] = []


def request(hub_id: str, method: str, path: str, body=None):
    """`(status, json body)` of one call to the runtime, whatever it answered."""
    req = urllib.request.Request(
        f"{BASE}{path}",
        data=None if body is None else json.dumps(body).encode(),
        headers={
            "content-type": "application/json",
            "x-hub-id": hub_id,
            "x-user-id": USER,
        },
        method=method,
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as res:
            return res.status, json.loads(res.read().decode() or "null")
    except urllib.error.HTTPError as err:
        raw = err.read().decode()
        try:
            return err.code, json.loads(raw or "null")
        except json.JSONDecodeError:
            return err.code, {"raw": raw}


def check(label: str, got, want) -> None:
    if got != want:
        failures.append(f"{label} — expected [{want!r}], got [{got!r}]")
        print(f"  FAIL: {label} — expected [{want!r}], got [{got!r}]")
    else:
        print(f"  ok: {label} = {got!r}")


def set_currency(hub_id: str, code: str) -> None:
    """The hub's currency through the real admin door — the write the settings screen makes."""
    status, body = request(hub_id, "PUT", "/api/settings", {"currency": code})
    if status != 200 or (body or {}).get("currency") != code:
        raise AssertionError(
            f"PUT /api/settings currency={code} answered {status}: {body}"
        )


def created_currency(hub_id: str, label: str, extra: dict) -> None:
    """Creates a cart with `extra` merged into the payload; a refusal is recorded, not raised, so a
    red run names every broken case."""
    token = f"hub-battery-{uuid.uuid4().hex[:12]}"
    payload = {"session_token": token, **extra}
    status, body = request(
        hub_id,
        "POST",
        "/api/command",
        {"name": "cart_checkout.carts.create", "payload": payload},
    )
    if status != 200 or not (body or {}).get("ok"):
        check(f"{label}: create answered", (status, body), (200, "ok"))
        return
    status, body = request(
        hub_id,
        "POST",
        "/api/query",
        {"name": "cart_checkout.carts.get", "params": {"session_token": token}},
    )
    rows = (body or {}).get("data") if status == 200 else None
    if isinstance(rows, dict):
        rows = rows.get("rows")
    if not rows:
        check(f"{label}: cart read back", (status, body), "one row")
        return
    return rows[0].get("currency")


def main() -> int:
    if not BASE:
        print(
            f"{BATTERY}: no runtime at the other end (ERPLORA_HUB_BASE_URL is empty)."
        )
        print(
            "Run it with `erplora test <dir> --against-hub`; without a hub this is NOT a skip."
        )
        return 1
    with urllib.request.urlopen(f"{BASE}/api/hub/context", timeout=60) as res:
        hub_id = json.loads(res.read().decode()).get("hub_id")
    if not hub_id:
        print(f"{BATTERY}: GET /api/hub/context did not say the hub_id")
        return 1
    print(
        f"Hub battery · cart currency from the hub (cart_checkout#34) · {BASE} · hub {hub_id} · user {USER}"
    )

    status, before = request(hub_id, "GET", "/api/settings")
    if status != 200:
        print(f"GET /api/settings answered {status}: {before}")
        return 1
    original = (before or {}).get("currency") or "EUR"
    try:
        print("\n1 · hub in yen, payload without currency")
        set_currency(hub_id, "JPY")
        check("currency", created_currency(hub_id, "no currency", {}), "JPY")

        print("\n2 · hub in yen, currency sent as null")
        check(
            "currency",
            created_currency(hub_id, "null currency", {"currency": None}),
            "JPY",
        )

        print("\n3 · an explicit currency wins over the hub's")
        check(
            "currency",
            created_currency(hub_id, "explicit USD", {"currency": "USD"}),
            "USD",
        )

        print("\n4 · hub in euros, payload without currency")
        set_currency(hub_id, "EUR")
        check("currency", created_currency(hub_id, "euro hub", {}), "EUR")
    finally:
        set_currency(hub_id, original)

    print()
    if failures:
        print(f"✗ {BATTERY}: {len(failures)} failure(s):")
        for f in failures:
            print(f"  - {f}")
        return 1
    print(f"✓ {BATTERY}: a cart without a currency is born in the hub's currency")
    return 0


if __name__ == "__main__":
    sys.exit(main())
