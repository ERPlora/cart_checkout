import { it, expect } from 'vitest';
import { checkMoneyDisplay } from '@erplora/module-toolkit/money-display-guard';

// GUARD (pm#289, shared since pm#505/pm#508): money on screen is never formatted by hand in this
// module, and OutfitKit comes in by entry point, never as a value from the barrel.
//
// The rules live in `@erplora/module-toolkit/money-display-guard` (one piece for every module,
// tested there against its own positives); this test only says what is specific to Cart & Checkout:
//
// * witnesses — the two amounts this module paints (the Total column of carts and of orders) go
//   through the shell's formatter. They count the CALL, not the name: both screens also declare
//   `formatMoney(cents: number, …)` in their `erplora()` interface, and a scan over empty or
//   over-stripped content must not stay green on that declaration (rv-combos-22). The quantity
//   helper of `lib/` is a witness too, so `lib/` provably stays in what the detector reads
//   (rv-taxes-78).
// * notDisplay — none: both amount columns already go through `erplora().formatMoney(minor)`.
//   Add an entry (`'file: exact code line'` → why) only with the reason it is not a screen amount.
// * outfitkitImporters — both screens import OutfitKit (entry points + types), so the barrel scan
//   provably read them (rv-pricing-53).
it('money on screen goes through the shared formatter and OutfitKit by entry point (pm#289)', () => {
  expect(
    checkMoneyDisplay({
      from: import.meta.url,
      witnesses: {
        'components/erp-cart-checkout-carts/erp-cart-checkout-carts.ts': { text: 'erplora().formatMoney(', atLeast: 1 },
        'components/erp-cart-checkout-orders/erp-cart-checkout-orders.ts': { text: 'erplora().formatMoney(', atLeast: 1 },
        'lib/quantity.ts': { text: 'export function formatQuantity(', atLeast: 1 },
      },
      notDisplay: {},
      outfitkitImporters: [
        'components/erp-cart-checkout-carts/erp-cart-checkout-carts.ts',
        'components/erp-cart-checkout-orders/erp-cart-checkout-orders.ts',
      ],
    }),
  ).toEqual([]);
});
