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

interface Cart {
  id: string;
  session_token: string;
  customer_email: string;
  customer_name: string;
  status: string;
  total_items: number;
  total_amount: string;
  currency: string;
  last_activity_at: string | null;
  created_at: string | null;
}

const STATUS_LABELS: Record<string, string> = {
  active: 'Active',
  abandoned: 'Abandoned',
  converted: 'Converted',
  expired: 'Expired',
};

function erplora(): ErploraClientLike {
  const c = (globalThis as { erplora?: ErploraClientLike }).erplora;
  if (!c) throw new Error('erplora SDK no inicializado por el shell');
  return c;
}

export class ErpCartCheckoutCarts extends LitElement {
  static styles = css`
    :host { display:block; font-family: system-ui, sans-serif; color: var(--ink, #1c1b18); }
    header { display:flex; gap:.5rem; align-items:center; margin-bottom:.75rem; }
    h2 { margin:0; font-size:1.15rem; flex:1; }
    .form { display:flex; gap:.5rem; flex-wrap:wrap; align-items:end; margin:.5rem 0 1rem; }
    .form ion-input, .form ion-select { --background:var(--surface-2,#f7f4ec); border:1px solid var(--line,#e7e2d6); border-radius:8px; min-width:8rem; }
    .err { color:#d9480f; font-weight:600; }
  `;

  @state() formError = '';

  @state() newToken = '';

  @state() newEmail = '';

  @state() newName = '';

  @state() saving = false;

  @state() tick = 0;

  private ctrl!: ListController<Cart>;

  private unsub?: () => void;

  private columns: DataTableColumn[] = [
    { key: 'session_token', header: 'Sesión', sortable: true, filterable: true, filterType: 'text' },
    { key: 'customer_email', header: 'Email', sortable: true, filterable: true, filterType: 'text', format: (r) => (r.customer_email as string) || '—' },
    {
      key: 'status',
      header: 'Estado',
      sortable: true,
      filterable: true,
      filterType: 'select',
      options: Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label })),
      format: (r) => STATUS_LABELS[r.status as string] ?? (r.status as string),
    },
    { key: 'total_items', header: 'Ítems', align: 'right', sortable: true, filterable: true, filterType: 'range', format: (r) => String(r.total_items ?? 0) },
    { key: 'total_amount', header: 'Total', align: 'right', sortable: true, filterable: true, filterType: 'range', format: (r) => `${Number(r.total_amount).toFixed(2)} ${r.currency || 'EUR'}` },
  ];

  private actions = [
    { id: 'abandon', label: 'Abandonar', icon: 'close-circle-outline', color: 'warning' },
    { id: 'delete', label: 'Borrar', icon: 'trash-outline', color: 'danger' },
  ];

  // TODO-LIT: componentWillLoad → connectedCallback. Recuerda: connectedCallback se dispara
  // en CADA reconexión al DOM (no solo en el primer montaje). Si la init debe correr una
  // sola vez tras el primer render, considera firstUpdated() en su lugar.
  async connectedCallback() {
    super.connectedCallback();
    this.ctrl = createListController<Cart>(erplora(), 'cart_checkout.carts.list', () => this.requestUpdate(), {
      pageSize: 50,
      sort: 'created_at',
      dir: 'desc',
    });
    await this.ctrl.load();
    try {
      const off1 = erplora().on('cart_checkout.cart.created', () => this.ctrl.load());
      const off2 = erplora().on('cart_checkout.cart.abandoned', () => this.ctrl.load());
      const off3 = erplora().on('cart_checkout.cart.deleted', () => this.ctrl.load());
      this.unsub = () => {
        off1();
        off2();
        off3();
      };
    } catch {
      /* sin SDK (preview) → sin reactividad en vivo */
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.unsub?.();
  }

  private async createCart(ev: Event) {
    ev.preventDefault();
    if (!this.newToken.trim()) return;
    this.saving = true;
    this.formError = '';
    try {
      await erplora().command('cart_checkout.carts.create', {
        session_token: this.newToken.trim(),
        customer_email: this.newEmail.trim(),
        customer_name: this.newName.trim(),
        currency: 'EUR',
        expires_at: null,
      });
      this.newToken = '';
      this.newEmail = '';
      this.newName = '';
      await this.ctrl.load();
    } catch (e) {
      this.formError = e instanceof Error ? e.message : 'No se pudo crear el carrito';
    } finally {
      this.saving = false;
    }
  }

  private async onRowAction(ev: CustomEvent<{ actionId: string; row: Record<string, unknown> }>) {
    const { actionId, row } = ev.detail;
    const cartId = row.id as string;
    this.formError = '';
    try {
      if (actionId === 'abandon') {
        await erplora().command('cart_checkout.carts.mark_abandoned', { cart_id: cartId, reason: '' });
      } else if (actionId === 'delete') {
        await erplora().command('cart_checkout.carts.delete', { cart_id: cartId });
      }
      await this.ctrl.load();
    } catch (e) {
      this.formError = e instanceof Error ? e.message : 'No se pudo completar la acción';
    }
  }

  render() {
    return html`<div>
        <header>
          <h2>Carritos</h2>
        </header>
        <form class="form" @submit=${(e) => this.createCart(e)}>
          <ion-input placeholder="Session token" .value=${this.newToken} @ionInput=${(e: any) => (this.newToken = e.target.value)}></ion-input>
          <ion-input placeholder="Email (opcional)" .value=${this.newEmail} @ionInput=${(e: any) => (this.newEmail = e.target.value)}></ion-input>
          <ion-input placeholder="Nombre (opcional)" .value=${this.newName} @ionInput=${(e: any) => (this.newName = e.target.value)}></ion-input>
          <ion-button type="submit" size="small" ?disabled=${this.saving || !this.newToken}>${this.saving ? 'Guardando…' : 'Nuevo carrito'}</ion-button>
        </form>
        ${this.formError ? html`<p class="err">${this.formError}</p>` : nothing}
        ${this.ctrl?.error ? html`<p class="err">${this.ctrl.error}</p>` : nothing}
        <ok-data-table .serverSide=${true} .columns=${this.columns} .rows=${this.ctrl?.rows ?? []} .total=${this.ctrl?.total ?? 0} .page=${this.ctrl?.state.page ?? 0} .pageSize=${this.ctrl?.state.pageSize ?? 50} .sort=${this.ctrl?.state.sort} .sortDir=${this.ctrl?.state.dir ?? 'desc'} .searchable=${true} .searchPlaceholder=${"Buscar sesión o email…"} .actions=${this.actions} .emptyMessage=${this.ctrl?.loading ? 'Cargando…' : 'Sin carritos.'} @rowAction=${(e: CustomEvent) => this.onRowAction(e)} @pageChange=${(e: CustomEvent<number>) => this.ctrl.setPage(e.detail)} @sortChange=${(e: CustomEvent<{ sort: string; dir: 'asc' | 'desc' }>) => this.ctrl.setSort(e.detail.sort, e.detail.dir)} @searchChange=${(e: CustomEvent<string>) => this.ctrl.setSearch(e.detail)} @filterChange=${(e: CustomEvent<{ col: string; value: unknown }>) => this.ctrl.setFilter(e.detail.col, e.detail.value)}></ok-data-table>
      </div>`;
  }
}

define('erp-cart-checkout-carts', ErpCartCheckoutCarts);
