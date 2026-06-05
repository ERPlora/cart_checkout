import { Component, State, h } from '@stencil/core';
// Importa el DataTable compartido (Stencil) para que se auto-registre y esbuild
// lo empaquete dentro del bundle del módulo. El shell provee los `ion-*`.
import '../../../../_shared/ui/components/data-table/data-table';
import type { DataTableColumn } from '../../../../_shared/ui/components/data-table/data-table';

// Web Component del módulo `cart_checkout` (Stencil) — vista de Carritos.
// Lista los carritos del hub (active/abandoned/converted/expired) + alta rápida de
// carrito y acciones por fila (marcar abandonado, borrar). NO toca la BD: todo vía SDK
// (erplora.query/command/on). El motor de totales y el checkout viven en WASM.

interface ErploraClientLike {
  query<T = unknown>(name: string, params?: Record<string, unknown>): Promise<T>;
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

@Component({
  tag: 'erp-cart-checkout-carts',
  shadow: true,
  styles: `
    :host { display:block; font-family: system-ui, sans-serif; color: var(--ink, #1c1b18); }
    header { display:flex; gap:.5rem; align-items:center; margin-bottom:.75rem; }
    h2 { margin:0; font-size:1.15rem; flex:1; }
    .form { display:flex; gap:.5rem; flex-wrap:wrap; align-items:end; margin:.5rem 0 1rem; }
    .form ion-input, .form ion-select { --background:var(--surface-2,#f7f4ec); border:1px solid var(--line,#e7e2d6); border-radius:8px; min-width:8rem; }
    .err { color:#d9480f; font-weight:600; }
  `,
})
export class ErpCartCheckoutCarts {
  @State() carts: Cart[] = [];
  @State() loading = true;
  @State() error = '';
  @State() statusFilter = '';
  @State() newToken = '';
  @State() newEmail = '';
  @State() newName = '';
  @State() saving = false;

  private unsub?: () => void;

  private columns: DataTableColumn[] = [
    { key: 'session_token', header: 'Sesión' },
    { key: 'customer_email', header: 'Email', format: (r) => (r.customer_email as string) || '—' },
    { key: 'status', header: 'Estado', format: (r) => STATUS_LABELS[r.status as string] ?? (r.status as string) },
    { key: 'total_items', header: 'Ítems', align: 'right', format: (r) => String(r.total_items ?? 0) },
    { key: 'total_amount', header: 'Total', align: 'right', format: (r) => `${Number(r.total_amount).toFixed(2)} ${r.currency || 'EUR'}` },
  ];

  private actions = [
    { id: 'abandon', label: 'Abandonar', icon: 'close-circle-outline', color: 'warning' },
    { id: 'delete', label: 'Borrar', icon: 'trash-outline', color: 'danger' },
  ];

  async componentWillLoad() {
    await this.refresh();
    try {
      const off1 = erplora().on('cart_checkout.cart.created', () => this.refresh());
      const off2 = erplora().on('cart_checkout.cart.abandoned', () => this.refresh());
      const off3 = erplora().on('cart_checkout.cart.deleted', () => this.refresh());
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
    this.unsub?.();
  }

  private async refresh() {
    this.loading = true;
    this.error = '';
    try {
      this.carts =
        (await erplora().query<Cart[]>('cart_checkout.carts.list', {
          status: this.statusFilter,
          customer_email: '',
        })) ?? [];
    } catch (e) {
      this.error = e instanceof Error ? e.message : 'Error cargando carritos';
    } finally {
      this.loading = false;
    }
  }

  private async createCart(ev: Event) {
    ev.preventDefault();
    if (!this.newToken.trim()) return;
    this.saving = true;
    this.error = '';
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
      await this.refresh();
    } catch (e) {
      this.error = e instanceof Error ? e.message : 'No se pudo crear el carrito';
    } finally {
      this.saving = false;
    }
  }

  private async onRowAction(ev: CustomEvent<{ actionId: string; row: Record<string, unknown> }>) {
    const { actionId, row } = ev.detail;
    const cartId = row.id as string;
    this.error = '';
    try {
      if (actionId === 'abandon') {
        await erplora().command('cart_checkout.carts.mark_abandoned', { cart_id: cartId, reason: '' });
      } else if (actionId === 'delete') {
        await erplora().command('cart_checkout.carts.delete', { cart_id: cartId });
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
          <h2>Carritos</h2>
        </header>

        <form class="form" onSubmit={(e) => this.createCart(e)}>
          <ion-input
            placeholder="Session token"
            value={this.newToken}
            onIonInput={(e: any) => (this.newToken = e.target.value)}
          />
          <ion-input
            placeholder="Email (opcional)"
            value={this.newEmail}
            onIonInput={(e: any) => (this.newEmail = e.target.value)}
          />
          <ion-input
            placeholder="Nombre (opcional)"
            value={this.newName}
            onIonInput={(e: any) => (this.newName = e.target.value)}
          />
          <ion-button type="submit" size="small" disabled={this.saving || !this.newToken}>
            {this.saving ? 'Guardando…' : 'Nuevo carrito'}
          </ion-button>
        </form>

        {this.error && <p class="err">{this.error}</p>}

        <data-table
          columns={this.columns}
          rows={this.carts as unknown as Record<string, unknown>[]}
          searchKeys={['session_token', 'customer_email', 'customer_name']}
          searchPlaceholder="Buscar sesión o email…"
          actions={this.actions}
          onRowAction={(e: CustomEvent) => this.onRowAction(e)}
          emptyMessage={this.loading ? 'Cargando…' : 'Sin carritos.'}
        />
      </div>
    );
  }
}
