import { LitElement, html, css, nothing } from 'lit';
import { state } from 'lit/decorators.js';
import { define } from '@erplora/outfitkit/define';
import '@erplora/outfitkit/ok-data-table';
import type { DataTableColumn } from '@erplora/outfitkit';
import { createListController } from '@erplora/module-sdk';
import type { ListController, ListClient, ListParams, ListPage } from '@erplora/module-sdk';

interface ErploraClientLike extends ListClient {
  query<T = unknown>(name: string, params?: Record<string, unknown>): Promise<T>;
  queryPage<R = unknown>(name: string, params: ListParams): Promise<ListPage<R>>;
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

export class ErpCartCheckoutOrders extends LitElement {
  static styles = css`
    :host { display:block; font-family: system-ui, sans-serif; color: var(--ink, #1c1b18); }
    header { display:flex; gap:.5rem; align-items:center; margin-bottom:.75rem; }
    h2 { margin:0; font-size:1.15rem; flex:1; }
    .err { color:#d9480f; font-weight:600; }
  `;

  @state() formError = '';

  @state() tick = 0;

  private ctrl!: ListController<Order>;

  private unsub?: () => void;

  private columns: DataTableColumn[] = [
    { key: 'order_number', header: 'Pedido', sortable: true, filterable: true, filterType: 'text' },
    { key: 'customer_email', header: 'Email', sortable: true, filterable: true, filterType: 'text' },
    {
      key: 'status',
      header: 'Estado',
      sortable: true,
      filterable: true,
      filterType: 'select',
      options: Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label })),
      format: (r) => STATUS_LABELS[r.status as string] ?? (r.status as string),
    },
    { key: 'payment_method', header: 'Pago', sortable: true, filterable: true, filterType: 'text', format: (r) => (r.payment_method as string) || '—' },
    { key: 'total_amount', header: 'Total', align: 'right', sortable: true, filterable: true, filterType: 'range', format: (r) => Number(r.total_amount).toFixed(2) },
  ];

  private actions = [
    { id: 'pay', label: 'Marcar pagado', icon: 'card-outline', color: 'primary' },
    { id: 'complete', label: 'Completar', icon: 'checkmark-done-outline', color: 'success' },
    { id: 'fail', label: 'Fallar', icon: 'close-outline', color: 'danger' },
  ];

  // TODO-LIT: componentWillLoad → connectedCallback. Recuerda: connectedCallback se dispara
  // en CADA reconexión al DOM (no solo en el primer montaje). Si la init debe correr una
  // sola vez tras el primer render, considera firstUpdated() en su lugar.
  async connectedCallback() {
    super.connectedCallback();
    this.ctrl = createListController<Order>(erplora(), 'cart_checkout.orders.list', () => this.requestUpdate(), {
      pageSize: 50,
      sort: 'created_at',
      dir: 'desc',
    });
    await this.ctrl.load();
    try {
      const off1 = erplora().on('cart_checkout.order.paid', () => this.ctrl.load());
      const off2 = erplora().on('cart_checkout.order.failed', () => this.ctrl.load());
      const off3 = erplora().on('cart_checkout.order.completed', () => this.ctrl.load());
      const off4 = erplora().on('cart_checkout.checkout.initiated', () => this.ctrl.load());
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
    super.disconnectedCallback();
    this.unsub?.();
  }

  private async onRowAction(ev: CustomEvent<{ actionId: string; row: Record<string, unknown> }>) {
    const { actionId, row } = ev.detail;
    const checkoutId = row.id as string;
    this.formError = '';
    try {
      if (actionId === 'pay') {
        await erplora().command('cart_checkout.orders.mark_paid', { checkout_id: checkoutId });
      } else if (actionId === 'complete') {
        await erplora().command('cart_checkout.orders.complete', { checkout_id: checkoutId });
      } else if (actionId === 'fail') {
        await erplora().command('cart_checkout.orders.fail', { checkout_id: checkoutId, reason: 'Cancelled by operator' });
      }
      await this.ctrl.load();
    } catch (e) {
      this.formError = e instanceof Error ? e.message : 'No se pudo completar la acción';
    }
  }

  render() {
    return html`<div>
        <header>
          <h2>Pedidos</h2>
        </header>
        ${this.formError ? html`<p class="err">${this.formError}</p>` : nothing}
        ${this.ctrl?.error ? html`<p class="err">${this.ctrl.error}</p>` : nothing}
        <ok-data-table .serverSide=${true} .columns=${this.columns} .rows=${this.ctrl?.rows ?? []} .total=${this.ctrl?.total ?? 0} .page=${this.ctrl?.state.page ?? 0} .pageSize=${this.ctrl?.state.pageSize ?? 50} .sort=${this.ctrl?.state.sort} .sortDir=${this.ctrl?.state.dir ?? 'desc'} .searchable=${true} .searchPlaceholder=${"Buscar pedido o email…"} .actions=${this.actions} .emptyMessage=${this.ctrl?.loading ? 'Cargando…' : 'Sin pedidos.'} @rowAction=${(e: CustomEvent) => this.onRowAction(e)} @pageChange=${(e: CustomEvent<number>) => this.ctrl.setPage(e.detail)} @sortChange=${(e: CustomEvent<{ sort: string; dir: 'asc' | 'desc' }>) => this.ctrl.setSort(e.detail.sort, e.detail.dir)} @searchChange=${(e: CustomEvent<string>) => this.ctrl.setSearch(e.detail)} @filterChange=${(e: CustomEvent<{ col: string; value: unknown }>) => this.ctrl.setFilter(e.detail.col, e.detail.value)}></ok-data-table>
      </div>`;
  }
}

define('erp-cart-checkout-orders', ErpCartCheckoutOrders);
