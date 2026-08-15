# Módulo `cart_checkout` — carrito y checkout

Carrito de la compra y proceso de checkout: líneas, totales denormalizados y conversión del carrito
en un **pedido** con número. Cubre dos ciclos de vida: el carrito
(`active → abandoned/converted/expired`) y el pedido (`initiated → paid/failed → completed`).

> 🔴 **No es el TPV, y aquí NO pasa nada fiscal.** Un pedido pagado y completado en este módulo **no**
> genera factura, **no** genera registro VeriFactu, **no** mueve stock y **no** toca caja. Marcar
> «pagado» tampoco **cobra**: no hay pasarela, es un cambio de estado que haces tras confirmar el
> dinero en otro sitio.

<!-- -->

> **Module id:** `cart_checkout`. **Depende de:** nada — y nada depende de él; no escucha eventos.
> Módulo híbrido: SQL + handler WASM (6 funciones).

## Documentación de usuario — [`docs/`](docs/)

Viaja **dentro** del módulo y se versiona con él: el asistente del hub (ADR-0282) la indexa por
versión instalada y cita la de TU versión, no la de la última publicada. En inglés (idioma fuente).

| Fichero | Para qué |
| ------- | -------- |
| [`docs/overview.md`](docs/overview.md) | Qué hace y qué NO hace; por qué NO es `sales` |
| [`docs/screens.md`](docs/screens.md) | Carts y Orders, y el flujo completo de punta a punta |
| [`docs/concepts.md`](docs/concepts.md) | Nada fiscal, cantidad ≤ 0 **borra la línea**, **cantidad ×10⁶ pero dinero en céntimos** en la MISMA fila, completar el pedido es lo que convierte el carrito |
| [`docs/limits.md`](docs/limits.md) | Las integraciones que **no existen** (stock, factura, pasarela), permisos y diagnóstico |

## Dos escalas en la misma fila

| Campo | Escala |
| ----- | ------ |
| `cart_checkout_item.quantity`, `cart.total_items` | punto fijo **10⁶** (ADR-0147) — `500000` = 0,5 uds |
| `unit_price`, `line_total`, `cart.total_amount`, `total_amount` del pedido | **céntimos** (ADR-0123) — el dinero NO se reescaló |

## Qué expone hoy

| Tipo | Nombre | Permiso |
| ---- | ------ | ------- |
| query | `cart_checkout.carts.list` / `.get` · `items.list` / `.get` · `orders.list` / `.get` | `view_cart` |
| command | `carts.create` / `.mark_abandoned` / `.delete` / `.clear` (WASM) / `.cleanup_expired` (WASM) | `manage_cart` |
| command | `items.add` (WASM) / `.update` (WASM, `qty ≤ 0` borra) / `.remove` | `manage_cart` |
| command | `checkout.initiate` (WASM) · `orders.mark_paid` / `.fail` / `.complete` (WASM) | `checkout` |
| emite | `cart_checkout.cart.*`, `.item.*`, `.checkout.initiated`, `.order.paid/failed/completed`, `.carts.expired` | — |
| escucha | — | — |

⚠️ Varios eventos los emite **el handler**, no el manifest (`item.added/updated`, `cart.cleared`,
`carts.expired`, `checkout.initiated`, `order.completed`): buscarlos en `module.json` no los
encuentra.

Navegación: `erp-cart-checkout-carts` («Carts») y `erp-cart-checkout-orders` («Orders»).

## Layout

```text
module.json                   # manifest (contrato técnico)
migrations/postgres/          # esquema §2.5 + contador de pedidos por hub/día + reescala 10⁶
queries/*.sql                 # lecturas declarativas (:hub_id inyectado)
commands/*.sql                # escrituras declarativas (las `_` son intenciones del WASM)
schemas/*.json                # JSON Schemas de input (draft 2020-12)
handler/                      # WASM Tier 2 → dist/handler.wasm
ui/                           # Web Components (Lit/Ionic/OutfitKit)
docs/                         # documentación de usuario + corpus del asistente
```

## Estado y trabajo abierto

El estado vive en las **Issues de este repo**, no aquí. Limitaciones documentadas en
`docs/limits.md`: sin puente a `sales`/`invoice`/`inventory`, sin pasarela de pago, **sin
`scheduled_tasks`** (los carritos no caducan solos: `cleanup_expired` hay que invocarlo) y sin
validación del catálogo (`product_ref` es texto libre).

Doc de arquitectura: `architecture/modules/cart_checkout.md` (cargarlo antes de tocar el módulo).
