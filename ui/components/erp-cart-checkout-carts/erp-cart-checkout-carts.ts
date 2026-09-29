import { LitElement, html, css, nothing } from 'lit';
import type { PropertyValues } from 'lit';
import { state } from 'lit/decorators.js';
import { define } from '@erplora/outfitkit/define';
import '@erplora/outfitkit/ok-inline-feedback';
import '@erplora/outfitkit/ok-data-table';
import type { DataTableColumn, DataTableAction } from '@erplora/outfitkit';
import { createListController, dataTableShowsLoadError } from '@erplora/module-sdk';
import type { ListController, ListClient, ListParams, ListPage } from '@erplora/module-sdk';
// Quantity scale boundary (ADR-0147): the row brings µ (10⁶), the screen speaks logical units.
import { formatQuantity } from '../../lib/quantity';
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
  /** Dinero (ADR-0059/0123): `formatMoney` recibe CÉNTIMOS y divide según la moneda. */
  currency: string;
  /** Decimals of the hub currency (2 EUR, 0 JPY, 3 KWD): the scale of a typed money filter. */
  currencyDecimals: number;
  formatMoney(cents: number, opts?: { currency?: string; locale?: string }): string;
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

  /** What «Save» in the «New cart» panel was refused: painted inside that form, never on the page (pm#513). */
  @state() formError = '';

  /** What a row action («Abandon», «Delete») was refused: no panel is open then, so it goes on the page. */
  @state() pageError = '';

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
      // total_items is µ (fixed point 10⁶, ADR-0147) and total_amount CENTS (ADR-0123): the screen
      // speaks logical units / euros. `toFixed(2)` over the raw value painted 3150 → «3150.00».
      // Their range filters are declared to the list controller below (`quantityFilters` /
      // `moneyFilters`, pm#501), so «2» and «12» are scaled to what the dispatcher compares.
      { key: 'total_items', header: t('ui.colItems'), align: 'right', sortable: true, filterable: true, filterType: 'range', format: (r) => formatQuantity(Number(r.total_items ?? 0)) },
      { key: 'total_amount', header: t('ui.colTotal'), align: 'right', sortable: true, filterable: true, filterType: 'range', format: (r) => erplora().formatMoney(Number(r.total_amount || 0), { currency: (r.currency as string) || undefined }) },
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
      moneyFilters: ['total_amount'],
      quantityFilters: ['total_items'],
    });
    await this.ctrl.load();
    try {
      // Los cambios de líneas/totales y el ciclo de vida (clear/expire/convert) los emite
      // el handler WASM; refrescan la lista igual que los eventos de los commands SQL.
            // Una suscripción por evento, con su literal EN la llamada (ADR-0127: el extractor
      // de contratos no sigue arrays; el nombre vive donde se usa).
      const offs = [
        erplora().on('cart_checkout.cart.created', () => this.ctrl.load()),
        erplora().on('cart_checkout.cart.abandoned', () => this.ctrl.load()),
        erplora().on('cart_checkout.cart.deleted', () => this.ctrl.load()),
        erplora().on('cart_checkout.cart.cleared', () => this.ctrl.load()),
        erplora().on('cart_checkout.carts.expired', () => this.ctrl.load()),
        erplora().on('cart_checkout.item.added', () => this.ctrl.load()),
        erplora().on('cart_checkout.item.updated', () => this.ctrl.load()),
        erplora().on('cart_checkout.item.removed', () => this.ctrl.load()),
        erplora().on('cart_checkout.order.completed', () => this.ctrl.load()),
      ];
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
    this.pageError = ''; // a save is the next thing the person did: an older row refusal is stale (staff#75)
    try {
      await erplora().command('cart_checkout.carts.create', {
        session_token: this.newToken.trim(),
        customer_email: this.newEmail.trim(),
        customer_name: this.newName.trim(),
        // The cart's total is painted in the cart's own currency: it is created in the hub's one. A
        // literal 'EUR' stored a yen cart as euros (cart_checkout#32). 'EUR' is only the SDK's own
        // fallback for a shell that does not publish a currency.
        currency: erplora().currency || 'EUR',
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
    this.pageError = '';
    try {
      if (actionId === 'abandon') {
        await erplora().command('cart_checkout.carts.mark_abandoned', { cart_id: cartId, reason: '' });
      } else if (actionId === 'delete') {
        await erplora().command('cart_checkout.carts.delete', { cart_id: cartId });
      }
      await this.ctrl.load();
    } catch (e) {
      this.pageError = e instanceof Error ? e.message : erplora().t(CATALOG, 'ui.errorActionFailed');
    }
  }

  /** pm#513: the refusal appears above the button that was pressed — on a phone that can leave it
   *  off the sheet. Bring it into view when it appears, not again on every keystroke. */
  updated(changed: PropertyValues): void {
    super.updated(changed);
    if (changed.has('formError') && this.formError) void this.revealRefusal('[data-testid="cart-checkout-carts-form-error"]');
  }

  /** ok-inline-feedback lays itself out in its own update: scrolled to before it, the box is empty. */
  private async revealRefusal(selector: string): Promise<void> {
    const banner = this.renderRoot.querySelector(selector) as (HTMLElement & { updateComplete?: Promise<unknown> }) | null;
    await banner?.updateComplete;
    banner?.scrollIntoView?.({ block: 'center' });
  }

  // El título de la vista lo pinta el topbar del shell: repetirlo aquí lo duplicaba en pantalla.
  render() {
    const t = (k: string): string => erplora().t(CATALOG, k);
    return html`<div class="page">
        ${this.pageError ? html`<ok-inline-feedback data-testid="cart-checkout-carts-error" tone="danger" icon="alert-circle-outline">${this.pageError}</ok-inline-feedback>` : nothing}
        ${this.ctrl?.error && !dataTableShowsLoadError() ? html`<ok-inline-feedback data-testid="cart-checkout-carts-list-error" tone="danger" icon="alert-circle-outline">${this.ctrl.error}</ok-inline-feedback>` : nothing}
        <ok-data-table .error=${this.ctrl?.error ?? ''} @retry=${() => this.ctrl?.load()} .serverSide=${true} .fill=${true} .addable=${true} .columns=${this.columns} .views=${true} .cardTitle=${(r: Record<string, unknown>) => String(r.customer_email || r.session_token || '—')} .cardIcon=${() => 'cart-outline'} .rows=${this.ctrl?.rows ?? []} .total=${this.ctrl?.total ?? 0} .page=${this.ctrl?.state.page ?? 0} .pageSize=${this.ctrl?.state.pageSize ?? 50} .sort=${this.ctrl?.state.sort} .sortDir=${this.ctrl?.state.dir ?? 'desc'} .searchable=${true} .searchPlaceholder=${t('ui.searchCarts')} .actions=${this.actions} .emptyMessage=${this.ctrl?.loading ? t('ui.loading') : t('ui.emptyCarts')} @rowAction=${(e: CustomEvent) => this.onRowAction(e)} @pageChange=${(e: CustomEvent<number>) => this.ctrl.setPage(e.detail)} @pageSizeChange=${(e: CustomEvent<number>) => this.ctrl.setPageSize(e.detail)} @sortChange=${(e: CustomEvent<{ sort: string; dir: 'asc' | 'desc' }>) => this.ctrl.setSort(e.detail.sort, e.detail.dir)} @searchChange=${(e: CustomEvent<string>) => this.ctrl.setSearch(e.detail)} @filterChange=${(e: CustomEvent<{ col: string; value: unknown }>) => this.ctrl.setFilter(e.detail.col, e.detail.value)}>
          <!-- Alta de carrito: se proyecta SIEMPRE (aunque el panel esté cerrado); si solo se
               pintara al abrirlo, el «+» desplegaría un panel vacío en el primer clic. -->
          <form slot="create" class="form" @submit=${(e: Event) => this.createCart(e)}>
            <ion-input fill="outline" label-placement="floating" label=${t('ui.colSession')} placeholder=${t('ui.placeholderSessionToken')} .value=${this.newToken} @ionInput=${(e: any) => (this.newToken = e.target.value)}></ion-input>
            <ion-input fill="outline" label-placement="floating" label=${t('ui.colEmail')} placeholder=${t('ui.placeholderEmailOptional')} .value=${this.newEmail} @ionInput=${(e: any) => (this.newEmail = e.target.value)}></ion-input>
            <ion-input fill="outline" label-placement="floating" label=${t('ui.labelName')} placeholder=${t('ui.placeholderNameOptional')} .value=${this.newName} @ionInput=${(e: any) => (this.newName = e.target.value)}></ion-input>
            <!-- pm#513: the refusal travels WITH the form — under 834 px the panel is a full-screen
                 sheet and a notice on the page underneath it is never seen. -->
            ${this.formError ? html`<ok-inline-feedback data-testid="cart-checkout-carts-form-error" tone="danger" icon="alert-circle-outline">${this.formError}</ok-inline-feedback>` : nothing}
            <ion-button type="submit" size="small" ?disabled=${this.saving || !this.newToken}>${this.saving ? t('ui.buttonSaving') : t('ui.buttonSave')}</ion-button>
          </form>
        </ok-data-table>
      </div>`;
  }
}

define('erp-cart-checkout-carts', ErpCartCheckoutCarts);
