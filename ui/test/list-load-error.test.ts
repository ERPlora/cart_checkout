// A list that could not load must not read «No carts» + «0 records» (pm#533, hub#2328).
//
// The shell's `<ok-data-table>` (OutfitKit ≥ 0.1.113) paints a failed load itself: «could not
// load», the reason and a Retry button. Every list screen hands it its controller's `error` and
// reloads on its `retry` event — and drops its own red banner, which would say the same thing
// twice. But a module paints with the SHELL's OutfitKit (ADR-0451): on a hub whose table has no
// `error` property the banner is the only place the reason is shown, so it stays.
//
// The shell's table is stood in for by a bare element registered BEFORE the screens load (as the
// shell does at boot; the screen's own `define()` then loses, like in the hub). Its `error`
// property is added or removed per test, which is exactly what `dataTableShowsLoadError()` reads.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

class ShellTable extends HTMLElement {}
const errors = new WeakMap<HTMLElement, unknown>();

function shellTableKnowsErrors(yes: boolean) {
  if (yes) {
    Object.defineProperty(ShellTable.prototype, 'error', {
      configurable: true,
      get(this: HTMLElement) { return errors.get(this) ?? ''; },
      set(this: HTMLElement, v: unknown) { errors.set(this, v); },
    });
  } else {
    delete (ShellTable.prototype as { error?: unknown }).error;
  }
}

const SCREENS = [
  { tag: 'erp-cart-checkout-carts', banner: 'cart-checkout-carts-list-error' },
  { tag: 'erp-cart-checkout-orders', banner: 'cart-checkout-orders-list-error' },
] as const;

const ROW = { id: 'r1', session_token: 'sess-1', order_number: 'ORD-1', customer_email: 'ana@example.com', status: 'active', total_amount: '1000', total_items: '1000000' };

let hubAnswers = false;
let pageCalls = 0;

beforeAll(async () => {
  customElements.define('ok-data-table', ShellTable);
  await import('../components/erp-cart-checkout-carts/erp-cart-checkout-carts');
  await import('../components/erp-cart-checkout-orders/erp-cart-checkout-orders');
});

beforeEach(() => {
  document.body.innerHTML = '';
  hubAnswers = false;
  pageCalls = 0;
  const answer = async () => {
    if (!hubAnswers) throw new Error('The hub is not responding.');
    return [];
  };
  (globalThis as Record<string, unknown>).erplora = {
    query: answer,
    queryOptional: answer,
    queryPage: async () => {
      pageCalls++;
      if (!hubAnswers) throw new Error('The hub is not responding.');
      return { rows: [ROW], total: 1 };
    },
    queryAll: async () => [],
    command: async () => ({}),
    hasPermission: () => true,
    on: () => () => {},
    locale: 'es',
    t: (_catalog: unknown, key: string) => key,
    currency: 'EUR',
    currencyDecimals: 2,
    formatMoney: (cents: number) => `${(cents / 100).toFixed(2)} €`,
  };
});

type Screen = HTMLElement & { shadowRoot: ShadowRoot; updateComplete: Promise<unknown> };

async function mountFailed(tag: string): Promise<{ el: Screen; table: HTMLElement }> {
  const el = document.createElement(tag) as Screen;
  document.body.appendChild(el);
  await vi.waitFor(() => {
    if (pageCalls === 0) throw new Error('the list has not asked for its page yet');
  });
  await el.updateComplete;
  await new Promise((r) => setTimeout(r, 0));
  await el.updateComplete;
  const table = el.shadowRoot.querySelector<HTMLElement>('ok-data-table');
  expect(table, `${tag} paints its table`).toBeTruthy();
  return { el, table: table! };
}

describe.each(SCREENS)('$tag — a list that could not load (pm#533)', ({ tag, banner }) => {
  it('hands the reason to the shell table and paints no second banner', async () => {
    shellTableKnowsErrors(true);
    const { el, table } = await mountFailed(tag);
    expect((table as unknown as { error: string }).error).toBe('The hub is not responding.');
    expect(el.shadowRoot.querySelector(`[data-testid="${banner}"]`), 'the reason would be said twice').toBeNull();
  });

  it('Retry on the table asks the hub again and paints the rows that now arrive', async () => {
    shellTableKnowsErrors(true);
    const { el, table } = await mountFailed(tag);
    const before = pageCalls;
    hubAnswers = true;
    table.dispatchEvent(new CustomEvent('retry', { detail: {} }));
    await vi.waitFor(() => {
      if (pageCalls === before) throw new Error('Retry did not ask the hub again');
    });
    await vi.waitFor(async () => {
      await el.updateComplete;
      if ((table as unknown as { error: string }).error !== '') throw new Error('the error is still on the table');
    });
    expect((table as unknown as { rows: unknown[] }).rows).toEqual([ROW]);
  });

  it('on a shell whose table cannot paint the error, keeps its own banner with the reason', async () => {
    shellTableKnowsErrors(false);
    const { el } = await mountFailed(tag);
    const shown = el.shadowRoot.querySelector(`[data-testid="${banner}"]`);
    expect(shown, 'an older hub would show the failure nowhere').toBeTruthy();
    expect(shown!.textContent).toContain('The hub is not responding.');
  });
});
