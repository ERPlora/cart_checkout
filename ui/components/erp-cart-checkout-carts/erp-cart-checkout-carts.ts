import { LitElement, html, css, nothing } from 'lit';
import { state } from 'lit/decorators.js';
import { define } from '@erplora/outfitkit/define';
import '@erplora/outfitkit/ok-data-table';
import type { DataTableColumn, DataTableAction } from '@erplora/outfitkit';
import { createListController } from '@erplora/module-sdk';
import type { ListController, ListClient, ListParams, ListPage } from '@erplora/module-sdk';
// Catálogo i18n del módulo (ADR-0055): esbuild inlinea estos JSON en el `dist` del WC. Los textos
// internos se resuelven con `erplora.t(CATALOG, 'ui.clave')` (idioma activo, fallback locale→en→clave).
import esLocale from '../../../locales/es.json';
import enLocale from '../../../locales/en.json';
const CATALOG: Record<string, unknown> = { es: esLocale, en: enLocale };

interface ErploraClientLike extends ListClient {
  query<T = unknown>(name: string, params?: Record<string, unknown>): Promise<T>;
  queryPage<R = unknown>(name: string, params: ListParams): Promise<ListPage<R>>;
  command<T = unknown>(name: string, payload?: Record<string, unknown>): Promise<T>;
  on(event: string, cb: (payload: unknown) => void): () => void;
  /** i18n del módulo (ADR-0055): idioma activo + traducción del catálogo `ui`. */
  locale: string;
  t(catalog: Record<string, unknown>, key: string, params?: Record<string, unknown>): string;
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

// Estados → clave i18n del catálogo `ui` (el `value` enviado al runtime NO cambia).
const STATUS_KEYS: Record<string, string> = {
  active: 'ui.statusActive',
  abandoned: 'ui.statusAbandoned',
  converted: 'ui.statusConverted',
  expired: 'ui.statusExpired',
};

function erplora(): ErploraClientLike {
  const c = (globalThis as { erplora?: ErploraClientLike }).erplora;
  if (!c) throw new Error('erplora SDK no inicializado por el shell');
  return c;
}

export class ErpCartCheckoutCarts extends LitElement {
  static styles = css`
    :host { display:flex; flex-direction:column; height:100%; min-height:0; font-family: system-ui, sans-serif; color: var(--ion-text-color, #1c1b18); }
    /* La vista llena el alto: el data-table ocupa todo (scroll interno, pie fijo). */
    .page { display:flex; flex-direction:column; min-height:0; flex:1 1 auto; }
    .page > ok-data-table { flex:1 1 auto; min-height:0; }
    /* Formulario del panel de alta (drawer estrecho) → una columna, no en fila. */
    .form { display:flex; flex-direction:column; gap:.7rem; }
    .form ion-button { align-self:flex-end; }
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

  // Getters (no campos): se re-evalúan en cada render, así los textos cambian con el idioma activo
  // (ADR-0055). `connectedCallback` re-renderiza al recibir `erplora:locale-changed`.
  private get columns(): DataTableColumn[] {
    const t = (k: string): string => erplora().t(CATALOG, k);
    return [
      { key: 'session_token', header: t('ui.colSession'), sortable: true, filterable: true, filterType: 'text' },
      { key: 'customer_email', header: t('ui.colEmail'), sortable: true, filterable: true, filterType: 'text', format: (r) => (r.customer_email as string) || '—' },
      {
        key: 'status',
        header: t('ui.colStatus'),
        sortable: true,
        filterable: true,
        filterType: 'select',
        options: Object.entries(STATUS_KEYS).map(([value, key]) => ({ value, label: t(key) })),
        format: (r) => (STATUS_KEYS[r.status as string] ? t(STATUS_KEYS[r.status as string]) : (r.status as string)),
      },
      { key: 'total_items', header: t('ui.colItems'), align: 'right', sortable: true, filterable: true, filterType: 'range', format: (r) => String(r.total_items ?? 0) },
      { key: 'total_amount', header: t('ui.colTotal'), align: 'right', sortable: true, filterable: true, filterType: 'range', format: (r) => `${Number(r.total_amount).toFixed(2)} ${r.currency || 'EUR'}` },
    ];
  }

  private get actions(): DataTableAction[] {
    const t = (k: string): string => erplora().t(CATALOG, k);
    return [
      { id: 'abandon', label: t('ui.actionAbandon'), icon: 'close-circle-outline', color: 'warning' },
      { id: 'delete', label: t('ui.actionDelete'), icon: 'trash-outline', color: 'danger' },
    ];
  }

  // TODO-LIT: componentWillLoad → connectedCallback. Recuerda: connectedCallback se dispara
  // en CADA reconexión al DOM (no solo en el primer montaje). Si la init debe correr una
  // sola vez tras el primer render, considera firstUpdated() en su lugar.
  private readonly onLocaleChange = (): void => this.requestUpdate();

  async connectedCallback() {
    super.connectedCallback();
    window.addEventListener('erplora:locale-changed', this.onLocaleChange);
    this.ctrl = createListController<Cart>(erplora(), 'cart_checkout.carts.list', () => this.requestUpdate(), {
      pageSize: 50,
      sort: 'created_at',
      dir: 'desc',
    });
    await this.ctrl.load();
    try {
      // Los cambios de líneas/totales y el ciclo de vida (clear/expire/convert) los emite
      // el handler WASM; refrescan la lista igual que los eventos de los commands SQL.
      const events = [
        'cart_checkout.cart.created',
        'cart_checkout.cart.abandoned',
        'cart_checkout.cart.deleted',
        'cart_checkout.cart.cleared',
        'cart_checkout.carts.expired',
        'cart_checkout.item.added',
        'cart_checkout.item.updated',
        'cart_checkout.item.removed',
        'cart_checkout.order.completed',
      ];
      const offs = events.map((ev) => erplora().on(ev, () => this.ctrl.load()));
      this.unsub = () => offs.forEach((off) => off());
    } catch {
      /* sin SDK (preview) → sin reactividad en vivo */
    }
  }

  disconnectedCallback() {
    window.removeEventListener('erplora:locale-changed', this.onLocaleChange);
    super.disconnectedCallback();
    this.unsub?.();
  }

  // Referencia al ok-data-table para abrir/cerrar su panel lateral (el «+» de su barra).
  private dataTable(): { open(p?: 'filters' | 'create'): void; close(): void } | null {
    return this.renderRoot.querySelector('ok-data-table') as
      | { open(p?: 'filters' | 'create'): void; close(): void }
      | null;
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
      this.dataTable()?.close(); // el panel del «+» taparía la tabla y el carrito recién creado
      await this.ctrl.load();
    } catch (e) {
      this.formError = e instanceof Error ? e.message : erplora().t(CATALOG, 'ui.errorCreateCart');
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
      this.formError = e instanceof Error ? e.message : erplora().t(CATALOG, 'ui.errorActionFailed');
    }
  }

  // El título de la vista lo pinta el topbar del shell: repetirlo aquí lo duplicaba en pantalla.
  render() {
    const t = (k: string): string => erplora().t(CATALOG, k);
    return html`<div class="page">
        ${this.formError ? html`<p class="err">${this.formError}</p>` : nothing}
        ${this.ctrl?.error ? html`<p class="err">${this.ctrl.error}</p>` : nothing}
        <ok-data-table .serverSide=${true} .fill=${true} .addable=${true} .columns=${this.columns} .rows=${this.ctrl?.rows ?? []} .total=${this.ctrl?.total ?? 0} .page=${this.ctrl?.state.page ?? 0} .pageSize=${this.ctrl?.state.pageSize ?? 50} .sort=${this.ctrl?.state.sort} .sortDir=${this.ctrl?.state.dir ?? 'desc'} .searchable=${true} .searchPlaceholder=${t('ui.searchCarts')} .actions=${this.actions} .emptyMessage=${this.ctrl?.loading ? t('ui.loading') : t('ui.emptyCarts')} @rowAction=${(e: CustomEvent) => this.onRowAction(e)} @pageChange=${(e: CustomEvent<number>) => this.ctrl.setPage(e.detail)} @pageSizeChange=${(e: CustomEvent<number>) => this.ctrl.setPageSize(e.detail)} @sortChange=${(e: CustomEvent<{ sort: string; dir: 'asc' | 'desc' }>) => this.ctrl.setSort(e.detail.sort, e.detail.dir)} @searchChange=${(e: CustomEvent<string>) => this.ctrl.setSearch(e.detail)} @filterChange=${(e: CustomEvent<{ col: string; value: unknown }>) => this.ctrl.setFilter(e.detail.col, e.detail.value)}>
          <!-- Alta de carrito: se proyecta SIEMPRE (aunque el panel esté cerrado); si solo se
               pintara al abrirlo, el «+» desplegaría un panel vacío en el primer clic. -->
          <form slot="create" class="form" @submit=${(e: Event) => this.createCart(e)}>
            <ion-input fill="outline" label-placement="floating" label=${t('ui.colSession')} placeholder=${t('ui.placeholderSessionToken')} .value=${this.newToken} @ionInput=${(e: any) => (this.newToken = e.target.value)}></ion-input>
            <ion-input fill="outline" label-placement="floating" label=${t('ui.colEmail')} placeholder=${t('ui.placeholderEmailOptional')} .value=${this.newEmail} @ionInput=${(e: any) => (this.newEmail = e.target.value)}></ion-input>
            <ion-input fill="outline" label-placement="floating" label=${t('ui.labelName')} placeholder=${t('ui.placeholderNameOptional')} .value=${this.newName} @ionInput=${(e: any) => (this.newName = e.target.value)}></ion-input>
            <ion-button type="submit" size="small" ?disabled=${this.saving || !this.newToken}>${this.saving ? t('ui.buttonSaving') : t('ui.buttonSave')}</ion-button>
          </form>
        </ok-data-table>
      </div>`;
  }
}

define('erp-cart-checkout-carts', ErpCartCheckoutCarts);
