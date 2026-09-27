// Contrato de la BARRA de la lista de CARRITOS.
//
// El alta de un carrito colgaba de un <form> suelto ENCIMA de la tabla (sesión, email, nombre y un
// botón «Nuevo carrito»). El resto del Hub —/employees en el core, el CRUD de productos de
// `inventory`, la lista de `services`— no lo hace así: el alta vive DENTRO de `ok-data-table`,
// detrás del «+» de su barra de herramientas, que despliega el panel `slot="create"`. Los filtros,
// igual: dentro, detrás del embudo, y los de dominio cerrado (el estado del carrito) con un
// `select`, no tecleando el valor a pelo.
import { beforeEach, describe, expect, it } from 'vitest';

const comandos: { name: string; payload: Record<string, unknown> }[] = [];

beforeEach(() => {
  comandos.length = 0;
  (globalThis as Record<string, unknown>).erplora = {
    query: async () => [],
    queryPage: async () => ({
      rows: [
        {
          id: 'c1',
          session_token: 'sess_a1b2c3',
          customer_email: 'ana@ejemplo.com',
          customer_name: 'Ana García',
          status: 'active',
          // Contratos de fila REALES: total_items en punto fijo 10⁶ (ADR-0147) y
          // total_amount en CÉNTIMOS enteros (ADR-0123) — la fixture anterior ('31.50',
          // 2) codificaba la creencia equivocada que producía el ×100 en pantalla.
          total_items: 2_000_000,
          total_amount: 3150,
          currency: 'EUR',
          last_activity_at: null,
          created_at: null,
        },
      ],
      total: 1,
    }),
    command: async (name: string, payload: Record<string, unknown>) => {
      comandos.push({ name, payload });
      return {};
    },
    on: () => () => {},
    locale: 'es',
    t: (_catalog: unknown, key: string) => key,
    currency: 'EUR',
    // The real client always exposes it (module-sdk getter); the list declares `moneyFilters` (pm#501).
    currencyDecimals: 2,
    formatMoney: (cents: number, opts?: { currency?: string }) =>
      `${(cents / 100).toFixed(2)} ${opts?.currency || 'EUR'}`,
  };
});

async function montar() {
  await import('./erp-cart-checkout-carts');
  const el = document.createElement('erp-cart-checkout-carts');
  document.body.appendChild(el);
  await (el as unknown as { updateComplete: Promise<unknown> }).updateComplete;
  await new Promise((r) => setTimeout(r, 0));
  await (el as unknown as { updateComplete: Promise<unknown> }).updateComplete;
  return el as HTMLElement & { shadowRoot: ShadowRoot };
}

const tabla = (el: HTMLElement & { shadowRoot: ShadowRoot }) =>
  el.shadowRoot.querySelector('ok-data-table') as (HTMLElement & { addable: boolean; fill: boolean; close: () => void }) | null;

describe('el alta vive DENTRO de la tabla (paridad con /employees, inventory y services)', () => {
  it('la tabla declara `addable` → pinta el «+» en su barra', async () => {
    const el = await montar();
    expect(tabla(el)?.addable, 'sin `addable` no hay «+» en la barra de la tabla').toBe(true);
  });

  it('la tabla declara `fill` → ocupa el alto de la vista (scroll interno, pie fijo)', async () => {
    const el = await montar();
    expect(tabla(el)?.fill).toBe(true);
  });

  it('el formulario de alta se proyecta en el panel `create` de la tabla', async () => {
    const el = await montar();
    const form = el.shadowRoot.querySelector('form[slot="create"]');
    expect(form, 'el formulario de alta no está en el slot `create`').toBeTruthy();
    expect(form?.closest('ok-data-table'), 'el formulario de alta cuelga fuera de la tabla').toBeTruthy();
  });

  it('no queda NINGÚN control de alta suelto fuera de la tabla', async () => {
    const el = await montar();
    const sueltos = [...el.shadowRoot.querySelectorAll('form, ion-input, ion-select, ion-button')].filter(
      (n) => !n.closest('ok-data-table'),
    );
    expect(sueltos.map((n) => n.tagName.toLowerCase()), 'hay controles de alta fuera de la tabla').toEqual([]);
  });

  it('el título de la página lo pinta el topbar del shell: la vista no repite un <h2>', async () => {
    const el = await montar();
    expect(el.shadowRoot.querySelector('h2'), 'la vista duplica el título del topbar').toBeNull();
  });
});

describe('los filtros van en la tabla, y los de dominio cerrado son `select`', () => {
  it('el estado se filtra con un select con los 4 estados reales de la migración', async () => {
    const el = await montar();
    const cols = (el as unknown as { columns: { key: string; filterType?: string; options?: { value: string }[] }[] }).columns;
    const estado = cols.find((c) => c.key === 'status');
    expect(estado?.filterType, 'el estado se filtra tecleando texto libre').toBe('select');
    // Dominio cerrado de la migración: `status TEXT ... -- active|abandoned|converted|expired`.
    expect(estado?.options?.map((o) => o.value)).toEqual(['active', 'abandoned', 'converted', 'expired']);
  });
});

describe('el alta sigue funcionando desde el panel', () => {
  it('crear un carrito manda cart_checkout.carts.create con los datos del panel', async () => {
    const el = await montar();
    const wc = el as unknown as { newToken: string; newEmail: string; newName: string; createCart: (ev: Event) => Promise<void> };
    wc.newToken = 'sess_x9';
    wc.newEmail = 'ana@ejemplo.com';
    wc.newName = 'Ana García';
    await wc.createCart(new Event('submit'));

    const alta = comandos.find((c) => c.name === 'cart_checkout.carts.create');
    expect(alta, 'no se mandó el alta del carrito').toBeTruthy();
    expect(alta!.payload.session_token).toBe('sess_x9');
    expect(alta!.payload.customer_email).toBe('ana@ejemplo.com');
  });

  it('tras crear con éxito se CIERRA el panel del «+» (si no, se queda abierto tapando la tabla)', async () => {
    const el = await montar();
    let cerrado = false;
    const t = tabla(el)!;
    t.close = () => {
      cerrado = true;
    };
    const wc = el as unknown as { newToken: string; createCart: (ev: Event) => Promise<void> };
    wc.newToken = 'sess_x9';
    await wc.createCart(new Event('submit'));
    expect(cerrado, 'el panel de alta no se cerró tras crear el carrito').toBe(true);
  });
});

describe('el pie de la tabla manda: cambiar filas/página recarga server-side', () => {
  it('`pageSizeChange` llega al controlador de lista', async () => {
    const el = await montar();
    tabla(el)!.dispatchEvent(new CustomEvent('pageSizeChange', { detail: 25 }));
    const ctrl = (el as unknown as { ctrl: { state: { pageSize: number } } }).ctrl;
    expect(ctrl.state.pageSize, 'el selector de filas por página no está cableado').toBe(25);
  });
});

describe('las columnas hablan el contrato: céntimos → formatMoney, µ → lógico', () => {
  it('el total divide céntimos (3150 → «31.50 EUR»), no pinta el crudo (bug ×100)', async () => {
    const el = await montar();
    const cols = (el as unknown as { columns: { key: string; format?: (r: unknown) => string }[] }).columns;
    const total = cols.find((c) => c.key === 'total_amount');
    expect(total?.format, 'la columna total no tiene formato de dinero').toBeTruthy();
    expect(total!.format!({ total_amount: 3150, currency: 'EUR' })).toBe('31.50 EUR');
  });

  it('los artículos salen en lógico (2000000 µ → «2»), no en µ crudos', async () => {
    const el = await montar();
    const cols = (el as unknown as { columns: { key: string; format?: (r: unknown) => string }[] }).columns;
    const items = cols.find((c) => c.key === 'total_items');
    expect(items!.format!({ total_items: 2_000_000 })).toBe('2');
  });
});
