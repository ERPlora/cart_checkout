import { Component, State, h } from '@stencil/core';
// Importa el DataTable compartido (Stencil) para que se auto-registre y esbuild
// lo empaquete dentro del bundle del módulo. El shell provee los `ion-*`.
import '../../../../_shared/ui/components/data-table/data-table';
import type { DataTableColumn } from '../../../../_shared/ui/components/data-table/data-table';

// Web Component del módulo `cart_checkout` (Stencil) — vista de Pedidos (checkout sessions).
// Lista las sesiones de checkout del hub y permite avanzar el pipeline por fila:
// marcar pagado, completar (paid→completed, marca el carrito convertido) y fallar.
// NO toca la BD: todo vía SDK. El motor de checkout (initiate/complete) vive en WASM.

interface ErploraClientLike {
  query<T = unknown>(name: string, params?: Record<string, unknown>): Promise<T>;
  command<T = unknown>(name: string, payload?: Record<string, unknown>): Promise<T>;
  on(event: string, cb: (payload: unknown) => void): () => void;
}

interface Order {
  id: string;
  cart_id: string;
  order_number: string;
  customer_email: string;
  shipping_method: string;
  payment_method: string;
  status: string;
  total_amount: string;
  placed_at: string | null;
  created_at: string | null;
}

const STATUS_LABELS: Record<string, string> = {
  initiated: 'Initiated',
  paid: 'Paid',
  failed: 'Failed',
  completed: 'Completed',
};

function erplora(): ErploraClientLike {
  const c = (globalThis as { erplora?: ErploraClientLike }).erplora;
  if (!c) throw new Error('erplora SDK no inicializado por el shell');
  return c;
}

@Component({
  tag: 'erp-cart-checkout-orders',
  shadow: true,
  styles: `
    :host { display:block; font-family: system-ui, sans-serif; color: var(--ink, #1c1b18); }
    header { display:flex; gap:.5rem; align-items:center; margin-bottom:.75rem; }
    h2 { margin:0; font-size:1.15rem; flex:1; }
    .err { color:#d9480f; font-weight:600; }
  `,
})
export class ErpCartCheckoutOrders {
  @State() orders: Order[] = [];
  @State() loading = true;
  @State() error = '';

  private unsub?: () => void;

  private columns: DataTableColumn[] = [
    { key: 'order_number', header: 'Pedido' },
    { key: 'customer_email', header: 'Email' },
    { key: 'status', header: 'Estado', format: (r) => STATUS_LABELS[r.status as string] ?? (r.status as string) },
    { key: 'payment_method', header: 'Pago', format: (r) => (r.payment_method as string) || '—' },
    { key: 'total_amount', header: 'Total', align: 'right', format: (r) => Number(r.total_amount).toFixed(2) },
  ];

  private actions = [
    { id: 'pay', label: 'Marcar pagado', icon: 'card-outline', color: 'primary' },
    { id: 'complete', label: 'Completar', icon: 'checkmark-done-outline', color: 'success' },
    { id: 'fail', label: 'Fallar', icon: 'close-outline', color: 'danger' },
  ];

  async componentWillLoad() {
    await this.refresh();
    try {
      const off1 = erplora().on('cart_checkout.order.paid', () => this.refresh());
      const off2 = erplora().on('cart_checkout.order.failed', () => this.refresh());
      const off3 = erplora().on('cart_checkout.order.completed', () => this.refresh());
      const off4 = erplora().on('cart_checkout.checkout.initiated', () => this.refresh());
      this.unsub = () => {
        off1();
        off2();
        off3();
        off4();
      };
    } catch {
      /* sin SDK (preview) → sin reactividad en vivo */
    }
  }

  disconnectedCallback() {
    this.unsub?.();
  }

  private async refresh() {
    this.loading = true;
    this.error = '';
    try {
      this.orders =
        (await erplora().query<Order[]>('cart_checkout.orders.list', {
          status: '',
          customer_email: '',
        })) ?? [];
    } catch (e) {
      this.error = e instanceof Error ? e.message : 'Error cargando pedidos';
    } finally {
      this.loading = false;
    }
  }

  private async onRowAction(ev: CustomEvent<{ actionId: string; row: Record<string, unknown> }>) {
    const { actionId, row } = ev.detail;
    const checkoutId = row.id as string;
    this.error = '';
    try {
      if (actionId === 'pay') {
        await erplora().command('cart_checkout.orders.mark_paid', { checkout_id: checkoutId });
      } else if (actionId === 'complete') {
        await erplora().command('cart_checkout.orders.complete', { checkout_id: checkoutId });
      } else if (actionId === 'fail') {
        await erplora().command('cart_checkout.orders.fail', { checkout_id: checkoutId, reason: 'Cancelled by operator' });
      }
      await this.refresh();
    } catch (e) {
      this.error = e instanceof Error ? e.message : 'No se pudo completar la acción';
    }
  }

  render() {
    return (
      <div>
        <header>
          <h2>Pedidos</h2>
        </header>

        {this.error && <p class="err">{this.error}</p>}

        <data-table
          columns={this.columns}
          rows={this.orders as unknown as Record<string, unknown>[]}
          searchKeys={['order_number', 'customer_email']}
          searchPlaceholder="Buscar pedido o email…"
          actions={this.actions}
          onRowAction={(e: CustomEvent) => this.onRowAction(e)}
          emptyMessage={this.loading ? 'Cargando…' : 'Sin pedidos.'}
        />
      </div>
    );
  }
}
