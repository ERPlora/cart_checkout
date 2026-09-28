#!/usr/bin/env python3
"""A cart created without a currency is stored in the HUB's currency, not in euros (cart_checkout#34).

The Carts screen sends the hub's currency itself (cart_checkout#32), but the assistant and an API
integration may leave `currency` out of `cart_checkout.carts.create`. The runtime fills every
absent property with its schema `default` BEFORE the SQL runs (`registry.rs::apply_defaults`), so
a static `"default": "EUR"` in `schemas/cart_create.json` turned a yen hub's cart into a euro cart.
The currency now resolves on the server: the caller's code if it sent one, otherwise the hub's
own `hub_settings.currency` (the key the settings screen writes, ADR-0085), otherwise EUR — the
same fallback the runtime applies to a hub that never set it.

What this file pins, against a REAL Postgres and with the runtime's own order of operations
(schema defaults first, then the command's SQL with the injected binds):

  1. Hub in yen + no `currency` in the payload → the cart is in JPY.
  2. Hub in yen + `currency: null` (a JSON caller that sends the key empty) → JPY as well.
  3. An explicit currency still wins: hub in yen + `currency: "USD"` → USD.
  4. A hub that never set its currency → EUR, as before.
  5. A hub whose currency row is empty → EUR too (never an empty currency on the cart).
  6. TENANCY: the hub's OWN `currency` key — a hub without a currency next to hubs in yen and in dinars
     still gets EUR, and the yen hub never gets the dinars.

Usage: tests/cart_currency.postgres.test.py   (exit 0 = green)
  Uses the `erplora-test-pg-5433` container (override: ERPLORA_TEST_PG_CONTAINER) and drops its
  scratch database at the end, pass or fail.
"""

import json
import os
import pathlib
import re
import subprocess
import sys
import uuid

MODULE_DIR = pathlib.Path(__file__).resolve().parent.parent
MANIFEST = json.loads((MODULE_DIR / "module.json").read_text())

CONTAINER = os.environ.get("ERPLORA_TEST_PG_CONTAINER", "erplora-test-pg-5433")
DB = f"cart_checkout_currency_test_{os.getpid()}"
COMMAND = "cart_checkout.carts.create"
NOW = "2026-09-28T12:00:00Z"

failures: list[str] = []


def fail(message: str) -> None:
    failures.append(message)
    print(f"  FAIL: {message}")


def check(label: str, got, want) -> None:
    if got != want:
        fail(f"{label} — expected [{want!r}], got [{got!r}]")
    else:
        print(f"  ok: {label} = {got!r}")


def psql(args: list[str], db: str | None = None, stdin: str | None = None) -> str:
    cmd = [
        "docker",
        "exec",
        "-i",
        CONTAINER,
        "psql",
        "-v",
        "ON_ERROR_STOP=1",
        "-U",
        "postgres",
    ]
    if db:
        cmd += ["-d", db]
    res = subprocess.run(cmd + args, input=stdin, capture_output=True, text=True)
    if res.returncode != 0:
        raise RuntimeError(res.stderr.strip() or res.stdout.strip())
    return res.stdout


def literal(value) -> str:
    if value is None:
        return "NULL"
    return "'" + str(value).replace("'", "''") + "'"


def bind(sql: str, params: dict) -> str:
    return re.sub(
        r"(?<!:):([a-z_][a-z0-9_]*)",
        lambda m: literal(params.get(m.group(1))),
        sql,
        flags=re.IGNORECASE,
    )


def apply_schema_defaults(payload: dict) -> dict:
    """What the runtime does before the SQL (hub `crates/runtime/src/registry.rs::apply_defaults`):
    every ABSENT top-level property takes its schema `default`; a present key — `null` included —
    is left alone."""
    spec = MANIFEST["commands"][COMMAND]
    schema = json.loads((MODULE_DIR / spec["schema"]).read_text())
    params = dict(payload)
    for key, prop in schema.get("properties", {}).items():
        if key not in params and "default" in prop:
            params[key] = prop["default"]
    return params


def create_cart(hub: str, payload: dict) -> str:
    """Runs `cart_checkout.carts.create` for `hub` and returns the stored currency."""
    new_id = str(uuid.uuid4())
    params = apply_schema_defaults(payload)
    params.update(hub_id=hub, new_id=new_id, current_user_id="u-1", now=NOW)
    for rel in MANIFEST["commands"][COMMAND]["sql"]:
        psql(["-c", bind((MODULE_DIR / rel).read_text(), params)], db=DB)
    return psql(
        [
            "-tA",
            "-c",
            f"SELECT currency FROM cart_checkout_cart WHERE id = {literal(new_id)}",
        ],
        db=DB,
    ).strip()


def set_setting(hub: str, key: str, value: str) -> None:
    psql(
        [
            "-c",
            f"INSERT INTO hub_settings (hub_id, key, value) VALUES ({literal(hub)}, {literal(key)}, {literal(value)})",
        ],
        db=DB,
    )


def set_currency(hub: str, code: str) -> None:
    set_setting(hub, "currency", code)


def main() -> int:
    print(
        f"Postgres battery · cart currency from the hub (cart_checkout#34) · {CONTAINER}"
    )
    if (
        subprocess.run(["docker", "inspect", CONTAINER], capture_output=True).returncode
        != 0
    ):
        print(
            f"container `{CONTAINER}` is not running — this can only be proven against Postgres"
        )
        return 1

    psql(["-c", f'CREATE DATABASE "{DB}"'])
    try:
        for entry in MANIFEST["migrations"]["postgres"]:
            # `{ file, kind, since }` is the object form a `contract` migration takes (hub#542).
            rel = entry if isinstance(entry, str) else entry["file"]
            psql([], db=DB, stdin=(MODULE_DIR / rel).read_text())
        # The core's settings table (hub/crates/runtime/src/settings.rs) — the hub creates it.
        psql(
            [
                "-c",
                "CREATE TABLE hub_settings (hub_id TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL DEFAULT '', "
                "updated_at TEXT, updated_by TEXT, PRIMARY KEY (hub_id, key))",
            ],
            db=DB,
        )
        # A real hub keeps many settings next to `currency` (country, timezone, decimals…): the
        # lookup must pick the `currency` key, not "the hub's only row".
        for hub in ("hub-yen", "hub-dinar", "hub-blank", "hub-plain"):
            set_setting(hub, "country_code", "ES")
            set_setting(hub, "timezone", "Europe/Madrid")
        set_currency("hub-yen", "JPY")
        set_currency("hub-dinar", "KWD")
        set_currency("hub-blank", "")

        print("\n1 · hub in yen, payload without currency")
        check("currency", create_cart("hub-yen", {"session_token": "s-1"}), "JPY")

        print("\n2 · hub in yen, currency sent as null")
        check(
            "currency",
            create_cart("hub-yen", {"session_token": "s-2", "currency": None}),
            "JPY",
        )

        print("\n3 · an explicit currency wins over the hub's")
        check(
            "currency",
            create_cart("hub-yen", {"session_token": "s-3", "currency": "USD"}),
            "USD",
        )

        print("\n4 · a hub that never set its currency stays in euros")
        check("currency", create_cart("hub-plain", {"session_token": "s-4"}), "EUR")

        print("\n5 · a hub whose currency row is empty stays in euros")
        check("currency", create_cart("hub-blank", {"session_token": "s-7"}), "EUR")

        print("\n6 · tenancy: each hub reads its own setting")
        check("dinar hub", create_cart("hub-dinar", {"session_token": "s-5"}), "KWD")
        check(
            "hub without setting",
            create_cart("hub-plain", {"session_token": "s-6"}),
            "EUR",
        )
    except RuntimeError as err:
        fail(f"Postgres refused the command: {err}")
    finally:
        psql(["-c", f'DROP DATABASE IF EXISTS "{DB}"'])

    print()
    if failures:
        print(f"✗ cart_currency.postgres: {len(failures)} failure(s)")
        return 1
    print(
        "✓ cart_currency.postgres: a cart without a currency is born in the hub's currency"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
