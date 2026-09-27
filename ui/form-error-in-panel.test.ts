// pm#513 (out of pm#478) — on a phone or a tablet, a refused «New cart» showed NOTHING: the person
// pressed «Save» and the sheet stayed as it was.
//
// The refusal did arrive; it was painted in the wrong place. The form lives in the `create` panel of
// the `ok-data-table`, and under 834 px that panel is a FULL-SCREEN sheet (outfitkit#75). The notice
// was a child of the PAGE, so on a phone it sat under the sheet, out of sight (bench: hub:stable
// 1.1.30, 390 and 820 px, ios and md: 4 of 6 hidden). On a desktop the panel sits beside the table
// and the notice happened to be visible.
//
// The rule, the same one customers#97 / tables#93 / reservations#73 / appointments#227 / tasks#47 /
// tickets#43 follow:
//
//   · what goes wrong while SAVING a form is painted INSIDE that form, above the button that was
//     pressed, and scrolled into view once — not again on every keystroke (rv-reservations-73);
//   · what goes wrong OUTSIDE the save stays on the PAGE: a refused row action («Abandon»,
//     «Delete») and a list that does not load. No panel is open then, and a notice inside a closed
//     panel is just as invisible (rv-appointments-227).
import { beforeEach, describe, expect, it, vi } from 'vitest';

const CART = {
  id: 'c1',
  session_token: 'sess_a1b2c3',
  customer_email: 'ana@example.com',
  customer_name: 'Ana García',
  status: 'active',
  total_items: 2_000_000,
  total_amount: 3150,
  currency: 'EUR',
  last_activity_at: null,
  created_at: null,
};

const REFUSAL = 'A manager has to approve this.';

let refuse: string | null = null;
/** When set, the next command waits on it: lets a test look at the screen while a save is in flight. */
let hold: Promise<void> | null = null;
let loadFails = false;
/** How many times the list was read: an action that goes through reloads it. */
let reads = 0;
let commands: string[] = [];
/** Every element the component scrolled into view. */
let revealed: Element[] = [];
/** Whether each revealed element had already painted itself when it was scrolled to. */
let paintedWhenRevealed: boolean[] = [];

beforeEach(() => {
  refuse = null;
  hold = null;
  loadFails = false;
  reads = 0;
  commands = [];
  revealed = [];
  paintedWhenRevealed = [];
  vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(function (this: HTMLElement) {
    revealed.push(this);
    // ok-inline-feedback lays itself out in its own update: scrolled to before it, a phone scrolls to
    // an empty, zero-height box and the notice ends up off the sheet anyway (online_booking#33).
    paintedWhenRevealed.push((this as unknown as { hasUpdated?: boolean }).hasUpdated !== false);
  });
  (globalThis as Record<string, unknown>).erplora = {
    query: async () => [],
    queryPage: async () => {
      reads++;
      if (loadFails) throw new Error(REFUSAL);
      return { rows: [CART], total: 1 };
    },
    command: async (name: string) => {
      commands.push(name);
      const wait = hold;
      if (wait) await wait;
      if (refuse) throw new Error(refuse);
      return {};
    },
    on: () => () => {},
    locale: 'es',
    t: (_c: unknown, key: string) => key,
    currency: 'EUR',
    currencyDecimals: 2,
    formatMoney: (cents: number) => `${(cents / 100).toFixed(2)} EUR`,
  };
});

type Wc = HTMLElement & { shadowRoot: ShadowRoot; updateComplete: Promise<unknown> } & Record<string, any>;

async function mount(): Promise<Wc> {
  await import('./components/erp-cart-checkout-carts/erp-cart-checkout-carts');
  const el = document.createElement('erp-cart-checkout-carts') as Wc;
  document.body.appendChild(el);
  await settle(el);
  return el;
}

async function settle(el: Wc): Promise<void> {
  for (let i = 0; i < 3; i++) {
    await el.updateComplete;
    await new Promise((r) => setTimeout(r, 0));
  }
}

const submitEvent = (): Event => new Event('submit', { cancelable: true });

const CREATE = 'form[slot="create"]';

/** The notice inside `scope`, or null. */
const inside = (el: Wc, scope: string, testid: string): Element | null =>
  el.shadowRoot.querySelector(`${scope} [data-testid="${testid}"]`);

/** Every place a notice with `text` is painted in, by where it sits. */
function whereIs(el: Wc, text: string): string[] {
  return [...el.shadowRoot.querySelectorAll('ok-inline-feedback')]
    .filter((n) => n.textContent?.trim() === text)
    .map((n) => (n.closest(CREATE) ? 'panel' : 'page'));
}

/** The notice sits above the button of its form. */
function aboveTheButton(form: Element, testid: string): boolean {
  const kids = [...form.children];
  const notice = kids.findIndex((k) => k.getAttribute('data-testid') === testid);
  const button = kids.findIndex((k) => k.tagName === 'ION-BUTTON' && k.getAttribute('type') === 'submit');
  return notice >= 0 && button >= 0 && notice < button;
}

async function refusedCreate(el: Wc): Promise<void> {
  el.newToken = 'sess_x9';
  refuse = REFUSAL;
  await el.createCart(submitEvent());
  await settle(el);
}

async function rowAction(el: Wc, actionId: 'abandon' | 'delete'): Promise<void> {
  await el.onRowAction({ detail: { actionId, row: CART } });
  await settle(el);
}

describe('pm#513 · carts: a refused «New cart» is shown INSIDE the panel form', () => {
  it('lands in the form, with its text, painted and scrolled into view — nothing on the page under the sheet', async () => {
    const el = await mount();
    await refusedCreate(el);
    const notice = inside(el, CREATE, 'cart-checkout-carts-form-error');
    expect(notice, 'on a phone the panel covers the page: the refusal has to travel with the form').not.toBeNull();
    expect(notice?.textContent?.trim()).toBe(REFUSAL);
    expect(revealed, 'and it is scrolled into view').toEqual([notice]);
    expect(paintedWhenRevealed, 'once it has painted itself').toEqual([true]);
    expect(whereIs(el, REFUSAL)).toEqual(['panel']);
  });

  it('sits above the «Save» button that was pressed', async () => {
    const el = await mount();
    await refusedCreate(el);
    expect(aboveTheButton(el.shadowRoot.querySelector(CREATE)!, 'cart-checkout-carts-form-error')).toBe(true);
  });

  it('is revealed once, not again on every keystroke while the person corrects the session', async () => {
    const el = await mount();
    await refusedCreate(el);
    revealed = [];
    el.newToken = 'sess_x10';
    await settle(el);
    el.newEmail = 'ana@example.com';
    await settle(el);
    expect(inside(el, CREATE, 'cart-checkout-carts-form-error'), 'the refusal is still there').not.toBeNull();
    expect(revealed, 'but the sheet stays where the person is typing').toEqual([]);
  });

  it('a second refusal with a different reason is revealed again', async () => {
    const el = await mount();
    await refusedCreate(el);
    revealed = [];
    refuse = 'The session already has a cart.';
    await el.createCart(submitEvent());
    await settle(el);
    expect(revealed).toEqual([inside(el, CREATE, 'cart-checkout-carts-form-error')]);
  });

  it('while the new attempt is being saved, the previous refusal is already gone', async () => {
    const el = await mount();
    await refusedCreate(el);
    refuse = null;
    let release!: () => void;
    hold = new Promise((r) => (release = r));
    el.newToken = 'sess_x9';
    const attempt = el.createCart(submitEvent());
    await settle(el);
    expect(inside(el, CREATE, 'cart-checkout-carts-form-error')).toBeNull();
    release();
    await attempt;
  });

  it('a save that goes through also clears the page notice of an earlier refused row action', async () => {
    const el = await mount();
    refuse = REFUSAL;
    await rowAction(el, 'abandon');
    expect(whereIs(el, REFUSAL)).toEqual(['page']);
    refuse = null;
    el.newToken = 'sess_x9';
    await el.createCart(submitEvent());
    await settle(el);
    expect(whereIs(el, REFUSAL)).toEqual([]);
  });
});

describe('pm#513 · carts: what goes wrong OUTSIDE the save stays on the page (rv-appointments-227)', () => {
  it('a refused «Abandon» from a row is shown on the page, not in the (closed) panel', async () => {
    const el = await mount();
    refuse = REFUSAL;
    await rowAction(el, 'abandon');
    expect(commands).toEqual(['cart_checkout.carts.mark_abandoned']);
    expect(inside(el, '.page', 'cart-checkout-carts-error')?.textContent?.trim()).toBe(REFUSAL);
    expect(whereIs(el, REFUSAL)).toEqual(['page']);
    expect(inside(el, CREATE, 'cart-checkout-carts-form-error')).toBeNull();
  });

  it('a refused «Delete» from a row is shown on the page too', async () => {
    const el = await mount();
    refuse = REFUSAL;
    await rowAction(el, 'delete');
    expect(commands).toEqual(['cart_checkout.carts.delete']);
    expect(whereIs(el, REFUSAL)).toEqual(['page']);
  });

  it('a new row action clears the previous refusal while it runs', async () => {
    const el = await mount();
    refuse = REFUSAL;
    await rowAction(el, 'abandon');
    refuse = null;
    let release!: () => void;
    hold = new Promise((r) => (release = r));
    const action = el.onRowAction({ detail: { actionId: 'delete', row: CART } });
    await settle(el);
    expect(whereIs(el, REFUSAL)).toEqual([]);
    release();
    await action;
  });

  it('a row action does not wipe a refusal the person is still reading in the form', async () => {
    const el = await mount();
    await refusedCreate(el);
    refuse = null;
    await rowAction(el, 'abandon');
    expect(whereIs(el, REFUSAL)).toEqual(['panel']);
  });

  it('a row action that goes through reloads the list', async () => {
    const el = await mount();
    const before = reads;
    await rowAction(el, 'abandon');
    expect(reads, 'the abandoned cart would keep showing as active').toBe(before + 1);
    await rowAction(el, 'delete');
    expect(reads, 'the deleted cart would stay on the list').toBe(before + 2);
  });

  it('a list that does not load is shown on the page, not in the form', async () => {
    loadFails = true;
    const el = await mount();
    expect(whereIs(el, REFUSAL)).toEqual(['page']);
    expect(inside(el, CREATE, 'cart-checkout-carts-form-error')).toBeNull();
  });
});
