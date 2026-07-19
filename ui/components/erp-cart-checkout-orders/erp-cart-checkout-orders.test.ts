// Contrato de la lista de PEDIDOS: el dinero es CÉNTIMOS enteros (ADR-0123) y se pinta con
// formatMoney (que divide según la moneda). El `toFixed(2)` directo sobre el crudo pintaba
// 3150 céntimos como «3150.00» (bug ×100, issue #9).
import { beforeEach, describe, expect, it } from 'vitest';

beforeEach(() => {
  (globalThis as Record<string, unknown>).erplora = {
    query: async () => [],
    queryPage: async () => ({
      rows: [
        {
          id: 'o1', cart_id: 'c1', order_number: 'OS-20260719-0001',
          customer_email: 'ana@ejemplo.com', shipping_method: '', payment_method: 'card',
          status: 'paid', total_amount: 3150, placed_at: null, created_at: null,
        },
      ],
      total: 1,
    }),
    command: async () => ({}),
    on: () => () => {},
    locale: 'es',
    t: (_catalog: unknown, key: string) => key,
    currency: 'EUR',
    formatMoney: (cents: number) => `${(cents / 100).toFixed(2)} €`,
  };
});

async function montar() {
  await import('./erp-cart-checkout-orders');
  const el = document.createElement('erp-cart-checkout-orders');
  document.body.appendChild(el);
  await (el as unknown as { updateComplete: Promise<unknown> }).updateComplete;
  await new Promise((r) => setTimeout(r, 0));
  await (el as unknown as { updateComplete: Promise<unknown> }).updateComplete;
  return el as HTMLElement & { shadowRoot: ShadowRoot };
}

describe('la columna total habla céntimos → formatMoney', () => {
  it('3150 céntimos se pintan como «31.50 €», no «3150.00»', async () => {
    const el = await montar();
    const cols = (el as unknown as { columns: { key: string; format?: (r: unknown) => string }[] }).columns;
    const total = cols.find((c) => c.key === 'total_amount');
    expect(total?.format, 'la columna total no tiene formato de dinero').toBeTruthy();
    expect(total!.format!({ total_amount: 3150 })).toBe('31.50 €');
  });
});
