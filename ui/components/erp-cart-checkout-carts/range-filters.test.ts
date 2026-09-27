// The «Total» and «Items» range filters of Carts filter in the unit the column shows
// (cart_checkout#26, pm#498).
//
// `cart_checkout_cart.total_amount` is an INTEGER in the minor unit (cents in EUR, ADR-0123) and
// `total_items` a BIGINT in fixed point 10⁶ (ADR-0147); the dispatcher compares the `range` filter
// against those integers. The columns paint «12,10 €» and «2», so the person types «12» meaning
// twelve euros and «2» meaning two items — and the screen sent `12` and `2` as is: «Total from 12»
// let a 1,00 € cart through and «Items from 2» let every cart with anything in it through.
//
// Money is scaled with the hub's currency decimals, items with the quantity scale, before the list
// is asked for; the edges of every other column travel untouched.
import { beforeEach, describe, expect, it } from 'vitest';
import './erp-cart-checkout-carts';

/** The `filters` of every page the screen asked the hub for, in call order. */
const asked: Array<Record<string, unknown>> = [];
let decimals = 2;

beforeEach(() => {
  document.body.replaceChildren();
  asked.length = 0;
  decimals = 2;
  (globalThis as Record<string, unknown>).erplora = {
    query: async () => [],
    queryPage: async (name: string, params: { filters?: Record<string, unknown> }) => {
      if (name === 'cart_checkout.carts.list') asked.push(structuredClone(params.filters ?? {}));
      return { rows: [], total: 0, limit: 50, offset: 0 };
    },
    command: async () => ({}),
    on: () => () => {},
    locale: 'es',
    t: (_catalog: unknown, key: string) => key,
    formatMoney: (minor: number) => `MONEY(${minor})`,
    get currencyDecimals() {
      return decimals;
    },
  };
});

type Mounted = HTMLElement & { shadowRoot: ShadowRoot; updateComplete: Promise<unknown> };

async function settle(el: Mounted): Promise<void> {
  await el.updateComplete;
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
}

async function mount(): Promise<Mounted> {
  const el = document.createElement('erp-cart-checkout-carts') as Mounted;
  document.body.appendChild(el);
  await settle(el);
  return el;
}

/** Fires what `ok-data-table` emits when one edge of a filter is typed. */
async function type(el: Mounted, col: string, value: unknown): Promise<Record<string, unknown>> {
  el.shadowRoot
    .querySelector('ok-data-table')!
    .dispatchEvent(new CustomEvent('filterChange', { detail: { col, value } }));
  await settle(el);
  return asked[asked.length - 1];
}

type Table = HTMLElement & { open(panel: 'filters'): void; shadowRoot: ShadowRoot; updateComplete: Promise<unknown> };

/** The «from» field of a range column in the real Filters panel of the table. */
function fromField(table: Table, header: string): HTMLInputElement {
  const label = [...table.shadowRoot.querySelectorAll('.flabel')].find((l) => l.textContent === header);
  return label!.parentElement!.querySelector('ion-input') as unknown as HTMLInputElement;
}

describe('Carts «Total» range filter compares in the unit the column shows (cart_checkout#26)', () => {
  it('«from 12» asks for 12,00 € (1200 cents), not 12 cents', async () => {
    const el = await mount();
    expect(await type(el, 'total_amount', { from: 12 })).toEqual({ total_amount: { from: 1200 } });
  });

  it('«to 50» keeps the other edge and asks for 5000 cents, so a 1 € cart is not hidden', async () => {
    const el = await mount();
    await type(el, 'total_amount', { from: 12 });
    expect(await type(el, 'total_amount', { to: 50 })).toEqual({ total_amount: { from: 1200, to: 5000 } });
  });

  it('a decimal amount is rounded to the minor unit (12.10 → 1210, never 1209)', async () => {
    const el = await mount();
    expect(await type(el, 'total_amount', { from: 12.1 })).toEqual({ total_amount: { from: 1210 } });
    expect(await type(el, 'total_amount', { to: 0.29 })).toEqual({ total_amount: { from: 1210, to: 29 } });
  });

  it('the inline control emits text: «12.5» and «12,5» both mean 12,50 €', async () => {
    const el = await mount();
    expect(await type(el, 'total_amount', { from: '12.5' })).toEqual({ total_amount: { from: 1250 } });
    expect(await type(el, 'total_amount', { from: '12,5' })).toEqual({ total_amount: { from: 1250 } });
  });

  it('uses the scale of the hub currency: 0 decimals (JPY) sends the amount as is, 3 (KWD) ×1000', async () => {
    decimals = 0;
    const jpy = await mount();
    expect(await type(jpy, 'total_amount', { from: 1999 })).toEqual({ total_amount: { from: 1999 } });
    jpy.remove();
    decimals = 3;
    const kwd = await mount();
    expect(await type(kwd, 'total_amount', { from: 1.5 })).toEqual({ total_amount: { from: 1500 } });
  });

  it('clearing an edge drops it instead of filtering «from 0»', async () => {
    const el = await mount();
    await type(el, 'total_amount', { from: 12 });
    await type(el, 'total_amount', { to: 50 });
    expect(await type(el, 'total_amount', { from: '' })).toEqual({ total_amount: { to: 5000 } });
    expect(await type(el, 'total_amount', { to: '' })).toEqual({});
  });

  it('text that is not a number is not turned into «from 0»', async () => {
    const el = await mount();
    expect(await type(el, 'total_amount', { from: 'abc' })).toEqual({});
    expect(await type(el, 'total_amount', { to: '   ' })).toEqual({});
  });

  it('a cleared filter (null) clears it, never a crash', async () => {
    const el = await mount();
    await type(el, 'total_amount', { from: 12 });
    expect(await type(el, 'total_amount', null)).toEqual({});
  });

  it('typed in the real Filters panel: asks for cents and the field still shows what was typed', async () => {
    const el = await mount();
    const table = el.shadowRoot.querySelector('ok-data-table') as Table;
    table.open('filters');
    await table.updateComplete;
    fromField(table, 'ui.colTotal').value = '12';
    fromField(table, 'ui.colTotal').dispatchEvent(new CustomEvent('ionInput', { bubbles: true, composed: true }));
    await settle(el);
    await table.updateComplete;
    expect(asked[asked.length - 1]).toEqual({ total_amount: { from: 1200 } });
    // The cents only travel to the hub: the field keeps «12», never «1200».
    expect(String(fromField(table, 'ui.colTotal').value)).toBe('12');
  });
});

describe('Carts «Items» range filter compares in the unit the column shows (cart_checkout#26)', () => {
  it('«from 2» asks for 2 items (2 000 000 µ), not two millionths of an item', async () => {
    const el = await mount();
    expect(await type(el, 'total_items', { from: 2 })).toEqual({ total_items: { from: 2_000_000 } });
  });

  it('«to 10» keeps the other edge; a fraction typed with a comma is exact (1,5 → 1 500 000)', async () => {
    const el = await mount();
    await type(el, 'total_items', { from: '1,5' });
    expect(await type(el, 'total_items', { to: 10 })).toEqual({ total_items: { from: 1_500_000, to: 10_000_000 } });
  });

  it('never scaled with the currency: items stay ×10⁶ in a hub in yen', async () => {
    decimals = 0;
    const el = await mount();
    expect(await type(el, 'total_items', { from: 3 })).toEqual({ total_items: { from: 3_000_000 } });
  });

  it('an empty, blank or invalid edge is dropped instead of filtering «from 0» or sending the raw text', async () => {
    const el = await mount();
    await type(el, 'total_items', { from: 2 });
    expect(await type(el, 'total_items', { from: '' })).toEqual({});
    expect(await type(el, 'total_items', { from: 'abc' })).toEqual({});
    expect(await type(el, 'total_items', { to: '   ' })).toEqual({});
    expect(await type(el, 'total_items', { to: '-1' })).toEqual({});
  });

  it('a cleared filter (null) clears it, never a crash', async () => {
    const el = await mount();
    await type(el, 'total_items', { from: 2 });
    expect(await type(el, 'total_items', null)).toEqual({});
  });

  it('typed in the real Filters panel: asks for µ and the field still shows what was typed', async () => {
    const el = await mount();
    const table = el.shadowRoot.querySelector('ok-data-table') as Table;
    table.open('filters');
    await table.updateComplete;
    fromField(table, 'ui.colItems').value = '2';
    fromField(table, 'ui.colItems').dispatchEvent(new CustomEvent('ionInput', { bubbles: true, composed: true }));
    await settle(el);
    await table.updateComplete;
    expect(asked[asked.length - 1]).toEqual({ total_items: { from: 2_000_000 } });
    expect(String(fromField(table, 'ui.colItems').value)).toBe('2');
  });
});

describe('Carts: every other column travels untouched (cart_checkout#26)', () => {
  it('dates stay ISO and the status stays the value picked', async () => {
    const el = await mount();
    expect(await type(el, 'created_at', { from: '2026-09-01' })).toEqual({ created_at: { from: '2026-09-01' } });
    expect(await type(el, 'status', 'active')).toEqual({ created_at: { from: '2026-09-01' }, status: 'active' });
  });
});
