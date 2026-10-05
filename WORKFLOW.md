# WORKFLOW — Carrito y pago

Prefijo: CART_CHECKOUT
Alcance MVP: fuera del MVP

> Este documento describe **lo que el módulo hace hoy** en `origin/main` (v1.0.26). No se amplía:
> quien necesite que un pedido genere venta, factura o movimiento de stock tiene que escribir antes
> ese flujo (y el de los módulos afectados) en una PR propia. El módulo **no tiene página pública
> ni tienda**: es una libreta interna de carritos y pedidos que maneja personal con sesión.

## Para qué sirve y para quién

Guarda **carritos** (de una persona identificada o de una sesión anónima, que se distingue por un
código de sesión) con sus líneas, y los convierte en **pedidos** con número, direcciones, método de
envío y de pago y un estado de pago. Lo usan el **administrador** y el **responsable** (los dos con
permiso para tocar carritos y pedidos); el **empleado** solo los ve. El **asistente** puede hacer lo
que la pantalla no ofrece (añadir líneas, iniciar el pedido).

Lo más importante: **no es el TPV y nada de lo que hace es fiscal**. Un pedido pagado y completado
aquí no genera venta, ni factura, ni registro VeriFactu, ni movimiento de caja, ni movimiento de
stock, y nadie en el hub escucha sus avisos. «Pagado» es un estado que una persona marca después de
cobrar por otra vía; el módulo no cobra.

## Referencia adoptada

El módulo imita el modelo de carrito y checkout de una tienda en línea (Shopify Checkout, WooCommerce,
Odoo eCommerce): carrito con código de sesión, pedido con número correlativo y estados
iniciado → pagado/fallido → completado. Se adopta solo el modelo de estados; la tienda pública, la
pasarela de pago, los impuestos, el envío y el stock de esas referencias **no existen aquí**. Sin
investigación de mercado nueva (oleada 5).

## Antes de empezar

- No depende de ningún módulo y ninguno depende de él (`depends_on` vacío; no escucha avisos).
- Permisos: «ver carritos» (`view_cart`), «gestionar carritos» (`manage_cart`) y «cobrar»
  (`checkout`). El administrador tiene todos, el responsable los tres, el empleado solo ver.
- No hay ajustes ni pestaña «Ajustes» (el módulo no declara `settings`). La moneda de un carrito
  nuevo sale de la moneda del negocio.
- No hay tarea programada: nada caduca solo (CART_CHECKOUT-F07).

## Pantallas

### Carritos
Pestaña «Carritos» del menú del módulo. Tabla con búsqueda («Buscar sesión o email…»; el servidor solo busca por email y nombre, así que un código de sesión no encuentra nada) y columnas
Sesión, Email, Estado (Activo, Abandonado, Convertido, Expirado), Ítems y Total, con filtros por
columna y paginación de 50. El botón «+» abre un panel con Sesión, Email y Nombre y «Guardar». Cada
fila ofrece «Abandonar» y «Borrar». Vacía: «Sin carritos.»; cargando: «Cargando…»; con error de
carga, la tabla ofrece reintentar; si una acción falla, «No se pudo completar la acción» o «No se
pudo crear el carrito». **No hay pantalla de las líneas** de un carrito ni para añadirlas.

### Pedidos
Pestaña «Pedidos». Tabla con búsqueda («Buscar pedido o email…») y columnas Pedido, Email, Estado
(Iniciado, Pagado, Fallido, Completado), Pago y Total. El Total se pinta con la moneda del negocio, no la del pedido. Cada fila ofrece «Marcar pagado»,
«Completar» y «Fallar». Vacía: «Sin pedidos.». No hay botón para crear un pedido: nacen del flujo
CART_CHECKOUT-F08.

## Flujos

### CART_CHECKOUT-F01 Crear un carrito
Estado: hecho
Actor: administrador, responsable, asistente
Pantalla: Carritos
Pasos:
1. En «Carritos» pulsar «+».
2. Escribir la Sesión (obligatoria; el botón «Guardar» no se activa sin ella) y, si se quiere, Email y Nombre.
3. Pulsar «Guardar».
4. El carrito aparece en la lista como «Activo», sin líneas y con total cero.
Entra: código de sesión (único por negocio, máximo 128 caracteres), email, nombre, moneda y caducidad opcionales; desde la pantalla va la moneda del negocio.
Sale: un carrito activo con la moneda indicada o, si no se dice, la del negocio (`EUR` si nunca se fijó) (aviso `cart_checkout.cart.created`).
Si falla: un código de sesión ya usado en el negocio lo rechaza el índice único, **también si lo usó un carrito borrado** (el índice no excluye los borrados: ese código no se puede reutilizar). Es un error de base de datos que el hub redacta como genérico, sin código; la pantalla muestra «No se pudo crear el carrito» o ese mensaje. Sin permiso, la orden se rechaza.
Implicados: FLOWS-F13
QA: ninguno

### CART_CHECKOUT-F02 Añadir una línea a un carrito
Estado: parcial — sin pantalla (solo asistente o API) y el precio lo manda quien llama (solo se rechaza el negativo), sin comprobar contra el catálogo
Actor: administrador, responsable, asistente
Pantalla: asistente
Pasos:
1. Pedir al asistente (o a la API) añadir un producto a un carrito dando su código de sesión, la referencia, el nombre, la cantidad y el precio unitario.
2. Confirmar la tarjeta del asistente.
3. La línea queda guardada y los totales del carrito (ítems e importe) se recalculan.
Entra: código de sesión, referencia y nombre del producto (texto libre), SKU y atributos de variante opcionales, cantidad como entero con escala 10⁶ (`500000` = media unidad) y precio unitario en céntimos que **manda quien llama**.
Sale: la línea con su total (cantidad lógica × precio, redondeo del SDK de dinero), los totales del carrito y la hora de última actividad (aviso `cart_checkout.item.added`, que sale del manejador y no del manifiesto).
Si falla: el esquema para antes del manejador el código, la referencia o el nombre vacíos y la cantidad < 1; el precio < 0 (o ilegible) lo rechaza el manejador. En todos los casos quien llama ve un error genérico del hub («no se pudo completar»): lo que el manejador devuelve como error no viaja con su código. Si el carrito no existe, o no está «Activo», **la orden contesta bien, no guarda nada y emite igualmente el aviso** (la guarda está en el SQL, sin comprobar filas cambiadas).
En este mismo documento se apoya en: CART_CHECKOUT-F01 (Crear un carrito).
Implicados: FLOWS-F13, HUB-F10, HUB-F18
QA: ninguno

### CART_CHECKOUT-F03 Cambiar la cantidad de una línea o quitarla
Estado: parcial — sin pantalla (solo asistente o API)
Actor: administrador, responsable, asistente
Pantalla: asistente
Pasos:
1. Pedir al asistente cambiar la cantidad de una línea (o quitarla).
2. Confirmar la tarjeta.
3. Con cantidad mayor que cero la línea cambia y su total se recalcula con el precio guardado en la propia línea; con cantidad cero o menos la línea se quita. Existe además la orden «quitar línea», que hace solo lo segundo.
4. Los totales del carrito se recalculan en la misma operación.
Entra: identificador de la línea y cantidad (escala 10⁶); el precio unitario lo lee el hub de la fila de la línea, no de quien llama.
Sale: línea cambiada o borrada (borrado lógico), totales del carrito y última actividad (aviso `cart_checkout.item.updated`, también al poner la cantidad a cero, con `removed: true`; `cart_checkout.item.removed` solo sale de la orden aparte «quitar línea»).
Si falla: línea inexistente con cantidad > 0 o cantidad no entera: error genérico del hub, sin código (`item_not_found` e `invalid_quantity` no llegan a quien llama). Un carrito que ya no está «Activo» no cambia y la orden **contesta bien** (y emite el aviso).
En este mismo documento se apoya en: CART_CHECKOUT-F02 (Añadir una línea a un carrito).
Implicados: FLOWS-F13, HUB-F11
QA: ninguno

### CART_CHECKOUT-F04 Vaciar un carrito
Estado: parcial — sin pantalla (solo asistente o API)
Actor: administrador, responsable, asistente
Pantalla: asistente
Pasos:
1. Pedir al asistente vaciar el carrito dando su código de sesión.
2. Confirmar la tarjeta.
3. Todas las líneas se quitan y los totales vuelven a cero; el carrito sigue «Activo».
Entra: código de sesión.
Sale: líneas con borrado lógico, totales a cero (aviso `cart_checkout.cart.cleared`).
Si falla: código vacío: lo para el esquema con un error genérico, sin código. Un carrito que no es «Activo» no cambia y la orden contesta bien igualmente.
Implicados: FLOWS-F13
QA: ninguno

### CART_CHECKOUT-F05 Abandonar un carrito
Estado: parcial — sobre un carrito que no está «Activo» la orden contesta bien sin cambiar nada y el aviso de carrito abandonado sale igual
Actor: administrador, responsable, asistente
Pantalla: Carritos
Pasos:
1. En «Carritos», en la fila del carrito, pulsar «Abandonar».
2. El carrito pasa a «Abandonado» y conserva sus líneas. La pantalla manda el motivo vacío; el asistente puede dar uno, que se añade a las notas.
Entra: identificador del carrito y motivo opcional (máximo 500 caracteres).
Sale: estado «Abandonado» (aviso `cart_checkout.cart.abandoned`).
Si falla: solo cambia un carrito «Activo»; en cualquier otro estado la orden contesta bien sin cambiar nada, y el aviso sale igual. La pantalla no pide confirmación.
Implicados: FLOWS-F13
QA: ninguno

### CART_CHECKOUT-F06 Borrar un carrito
Estado: parcial — con un identificador que no existe la orden contesta bien sin borrar nada y el aviso de carrito borrado sale igual; no toca las líneas ni los pedidos del carrito
Actor: administrador, responsable, asistente
Pantalla: Carritos
Pasos:
1. En «Carritos», en la fila, pulsar «Borrar».
2. El carrito desaparece de la lista. No hay confirmación en la pantalla. Por el asistente tampoco hay confirmación reforzada: ninguna orden del módulo declara `ai.risk` y no hay etiquetas de orden, así que la tarjeta es la genérica («Una acción que esta app no sabe nombrar»), sin marcarla como peligrosa.
Entra: identificador del carrito.
Sale: el carrito queda con borrado lógico en cualquier estado, también «Convertido» (aviso `cart_checkout.cart.deleted`). Sus líneas **no** se tocan, aunque la descripción de la orden diga que se borran con él; ya no se pueden consultar porque la lista de líneas pide el carrito, pero siguen en la base. Los pedidos del carrito siguen existiendo.
Si falla: un identificador inexistente contesta bien sin cambiar nada y el aviso `cart_checkout.cart.deleted` sale igual.
Implicados: FLOWS-F13
QA: ninguno

### CART_CHECKOUT-F07 Caducar los carritos vencidos
Estado: parcial — la orden existe pero nada la ejecuta sola ni hay botón
Actor: administrador, asistente
Pantalla: asistente
Pasos:
1. Pedir al asistente (o a la API) caducar los carritos vencidos.
2. Confirmar la tarjeta.
3. Todo carrito «Activo» con fecha de caducidad ya pasada pasa a «Expirado».
Entra: nada; la hora la pone el hub.
Sale: los carritos pasan a «Expirado» (aviso `cart_checkout.carts.expired`, que no dice cuántos).
Si falla: sin carritos vencidos la orden contesta bien y el aviso sale igual. El módulo no declara tarea programada: un carrito vencido sigue «Activo» hasta que alguien lance la orden. Un carrito sin caducidad no caduca nunca.
Implicados: FLOWS-F13
QA: ninguno

### CART_CHECKOUT-F08 Iniciar el pedido desde un carrito
Estado: parcial — sin pantalla (solo asistente o API); no bloquea el carrito ni comprueba precios, stock ni impuestos
Actor: administrador, responsable, asistente
Pantalla: asistente
Pasos:
1. Pedir al asistente iniciar el pedido de un carrito dando el código de sesión y el email del cliente, y si se quiere direcciones, método de envío, método de pago y notas.
2. Confirmar la tarjeta.
3. Aparece en «Pedidos» un pedido «Iniciado» con número `OS-AAAAMMDD-NNNN` (correlativo por negocio y día) y el total del carrito copiado en ese momento.
Entra: código de sesión, email obligatorio con forma `algo@algo`, direcciones (si falta la de facturación se copia la de envío), métodos y notas.
Sale: un pedido «Iniciado» con el total del carrito en ese instante y el contador del día incrementado (aviso `cart_checkout.checkout.initiated`, con el email del cliente).
Si falla: código vacío o email de menos de 3 caracteres los para el esquema, y un email sin forma `algo@algo` el manejador: quien llama ve siempre un error genérico del hub, sin código (`missing_*` e `invalid_email` no llegan). Si el carrito no existe, no está «Activo» o no tiene líneas, **no se crea pedido pero la orden contesta bien, el contador sube (hueco en la numeración) y el aviso de iniciado sale igual**. Con un carrito válido, el carrito sigue «Activo» tras iniciar: se pueden cambiar sus líneas y se puede iniciar otro pedido del mismo carrito; el total del pedido ya no cambia.
En este mismo documento se apoya en: CART_CHECKOUT-F02 (Añadir una línea a un carrito).
Implicados: FLOWS-F13, HUB-F10
QA: ninguno

### CART_CHECKOUT-F09 Marcar un pedido como pagado
Estado: parcial — sobre un pedido que no está «Iniciado» la orden contesta bien sin cambiar nada y el aviso de pedido pagado sale igual
Actor: administrador, responsable
Pantalla: Pedidos
Pasos:
1. Cobrar al cliente fuera del módulo.
2. En «Pedidos», en la fila del pedido, pulsar «Marcar pagado».
3. El pedido pasa a «Pagado» con la hora del pago.
Entra: identificador del pedido.
Sale: estado «Pagado» y hora de pago (aviso `cart_checkout.order.paid`). No se cobra, ni se pide importe, medio ni justificante, y no se crea venta, factura, registro fiscal, movimiento de caja ni de stock.
Si falla: solo cambia un pedido «Iniciado»; en otro estado la orden contesta bien sin cambiar nada y el aviso sale igual. Sin permiso «cobrar» (el empleado), se rechaza.
En este mismo documento se apoya en: CART_CHECKOUT-F08 (Iniciar el pedido desde un carrito).
Implicados: FLOWS-F13
QA: ninguno

### CART_CHECKOUT-F10 Registrar que el pago falló
Estado: parcial — un pedido ya «Pagado» puede pasar a «Fallido» sin rastro de devolución
Actor: administrador, responsable, asistente
Pantalla: Pedidos
Pasos:
1. En «Pedidos», en la fila del pedido, pulsar «Fallar».
2. El pedido pasa a «Fallido». La pantalla no pide el motivo: guarda siempre el texto «Cancelled by operator» (en inglés, sin traducir); el asistente puede dar uno propio.
Entra: identificador del pedido y motivo (obligatorio, máximo 500 caracteres).
Sale: estado «Fallido» y el motivo añadido a las notas del pedido (aviso `cart_checkout.order.failed`).
Si falla: cambia cualquier pedido que no esté «Completado», **también uno ya «Pagado»** (el dinero cobrado queda como fallido sin rastro de devolución; por el asistente tampoco hay confirmación reforzada) o uno ya «Fallido» (se repite la nota). Un pedido «Fallido» no se puede volver a iniciar ni pagar; el carrito queda «Activo».
En este mismo documento se apoya en: CART_CHECKOUT-F08 (Iniciar el pedido desde un carrito).
Implicados: FLOWS-F13
QA: ninguno

### CART_CHECKOUT-F11 Completar un pedido
Estado: parcial — sobre un pedido que no está «Pagado» la orden contesta bien sin cambiar nada y el aviso sale igual; y convierte el carrito aunque sus líneas hayan cambiado después de iniciar el pedido
Actor: administrador, responsable, asistente
Pantalla: Pedidos
Pasos:
1. En «Pedidos», en la fila de un pedido «Pagado», pulsar «Completar».
2. El pedido pasa a «Completado» y su carrito a «Convertido».
Entra: identificador del pedido.
Sale: pedido «Completado» con hora y carrito «Convertido», en la misma operación (aviso `cart_checkout.order.completed`). No se emite nada fiscal ni de stock.
Si falla: solo se completa un pedido «Pagado»; en otro estado no cambia nada, la orden contesta bien y el aviso sale igual. El carrito se convierte aunque sus líneas hayan cambiado después de iniciar el pedido.
En este mismo documento se apoya en: CART_CHECKOUT-F09 (Marcar un pedido como pagado).
Implicados: FLOWS-F13
QA: ninguno

### CART_CHECKOUT-F12 Consultar carritos, líneas y pedidos
Estado: parcial — la pantalla no muestra las líneas de un carrito ni las direcciones de un pedido
Actor: administrador, responsable, empleado, asistente
Pantalla: Carritos
Pasos:
1. Abrir «Carritos» o «Pedidos».
2. Buscar por email o nombre (carritos) o por número de pedido o email (pedidos), filtrar por columna y ordenar.
3. Las líneas de un carrito y el detalle de un pedido (direcciones, métodos, fechas) solo se leen con el asistente o la API.
Entra: permiso «ver carritos»; el empleado lo tiene.
Sale: listas de 50 filas (hasta 500 si se pide). Cantidad de ítems con escala 10⁶, importes en céntimos con la moneda de la fila.
Si falla: error de carga con botón para reintentar; sin permiso, rechazo del servidor.
Implicados: ninguno
QA: ninguno

### CART_CHECKOUT-F13 Avisar a otros módulos de lo que ocurre
Estado: parcial — varios avisos salen aunque la orden no haya cambiado nada (abandonar, borrar, pagar, completar, iniciar), y Automatizaciones los ofrece como disparador
Actor: sistema
Pantalla: ninguna
Pasos:
1. Cada orden de los flujos anteriores deja un aviso `cart_checkout.*` en la cola del hub al terminar.
2. Las dos pantallas del módulo se refrescan al recibirlos.
Entra: la orden que lo provoca.
Sale: doce avisos publicados (`cart.created`, `cart.abandoned`, `cart.deleted`, `cart.cleared`, `carts.expired`, `item.added`, `item.updated`, `item.removed`, `checkout.initiated`, `order.paid`, `order.failed`, `order.completed`). Ningún módulo del hub los escucha hoy.
Si falla: como el resto de avisos del hub: si la orden falla no queda ni el cambio ni el aviso; si la orden no cambia filas, el aviso sale igual.
Implicados: FLOWS-F13
QA: ninguno

## Cobertura contra la referencia

| Elemento | Estado | Flujo |
|---|---|---|
| Carrito con código de sesión (invitado) | hecho | CART_CHECKOUT-F01 |
| Líneas del carrito y totales | parcial — solo asistente o API | CART_CHECKOUT-F02, CART_CHECKOUT-F03, CART_CHECKOUT-F04 |
| Caducidad de carritos | parcial — nadie la ejecuta | CART_CHECKOUT-F07 |
| Pedido con número y estados | parcial — se crea solo por asistente o API | CART_CHECKOUT-F08 a F11 |
| Tienda o página pública del negocio | no existe | — |
| Precio recalculado por el servidor desde el catálogo | no existe | — |
| Cobro con pasarela | no existe (Pagos y pasarelas son módulos aparte) | — |
| Pedido que genera venta, factura y registro fiscal | no existe | — |
| Stock reservado o descontado | no existe | — |
| Impuestos, envío, descuentos | no existe | — |
| Avisos de carrito abandonado | no existe | — |

## Datos: de quién es cada dato

Son de este módulo las tablas de carritos, líneas, pedidos y el contador diario de pedidos. No lee
nada de otro módulo: producto, nombre, SKU y precio son texto y números libres, sin vínculo con el
catálogo, y el cliente es un email y un nombre sin vínculo con Clientes. Importes en céntimos,
cantidades con escala 10⁶, fechas en texto ISO.

Datos personales (para el borrado RGPD): `customer_email` y `customer_name` del carrito;
`customer_email` del pedido; direcciones de envío y facturación del pedido (JSON libre); notas de
carrito y pedido y el motivo de abandono o fallo (texto libre); el código de sesión si identifica a
alguien; `created_by` y `updated_by` (identificador de la persona del equipo). Los avisos llevan datos: `checkout.initiated` el email; los de línea el código de sesión, la referencia y los importes. Las líneas con borrado lógico (también las de un carrito
borrado) siguen en la base. El módulo no tiene orden de borrado de datos personales.

## Reglas que no se rompen

- Todo se filtra por el negocio (`hub_id`) en cada consulta y orden; el código de sesión y el número
  de pedido son únicos por negocio.
- Todos los accesos exigen sesión y permiso: ver para consultar, gestionar para carritos y líneas,
  cobrar para pedidos. El módulo no declara ninguna página pública ni ninguna orden sin sesión.
- Dinero siempre en céntimos y cantidades en escala 10⁶; el total de una línea lo calcula el
  manejador con el SDK, y el de un cambio de cantidad usa el precio guardado en la fila.
- El total de un pedido es una copia del carrito en el momento de iniciarlo.
- Un pedido solo se completa desde «Pagado» y solo se marca pagado desde «Iniciado».

## Lo que NO hace, a propósito

- No tiene tienda ni página pública: nadie sin sesión puede crear carritos ni pedidos.
- No cobra: «Pagado» es una marca manual; no hay pasarela, medio de pago ni importe cobrado.
- No genera venta, factura, registro VeriFactu, movimiento de caja ni de stock: ninguna venta de
  mostrador depende de él y él no depende de ellas. Nada de lo cobrado aquí llega a la AEAT.
- No valida el precio ni el producto contra Inventario ni calcula impuestos.
- No se enlaza con Clientes ni con Pagos / pasarelas de pago.
- No caduca ni avisa de carritos abandonados por sí solo.

## Dudas abiertas

- Si el módulo se mantiene como libreta interna o se retira: decisión de producto (`market-decision`),
  no del worker.
- Si un pedido cobrado aquí debe producir venta y registro fiscal antes de ofrecerlo a un negocio
  real (regla del proyecto: todo tique con QR llega a la AEAT): hoy no lo hace.
- Con el módulo instalado el asistente gana sus órdenes como herramientas y el módulo se describe como «mark payments» (`module.json` `agent.description`): riesgo, **sin confirmar** (haría falta ejecutar el asistente), de que se elija ante «registra el cobro» en vez de Vender.
- Si la tabla (`ok-data-table`) pide confirmación para «Borrar» y «Fallar»: sin confirmar; el componente lanza la orden directamente.

## Fuentes contrastadas

- `WASM-TODO.md` y `docs/` dicen que borrar un carrito se lleva sus líneas; el SQL solo marca el carrito (`commands/cart_delete.sql`). Manda el código.
- La descripción de la orden de borrar y el documento técnico hablan de borrado permanente; es borrado lógico.
- `docs/screens.md` describe el paso de añadir líneas y de iniciar el pedido como pasos de pantalla; la pantalla no tiene ninguno (solo crear, abandonar, borrar, pagar, completar y fallar).
- `docs/limits.md` dice que nada se completa si no está pagado y que los fallos se registran con motivo; la pantalla manda siempre «Cancelled by operator» en inglés.
- `WASM-TODO.md` anota como mejora futura devolver `invalid_state`, `not_found` y `empty_cart` tipados: hoy esos casos contestan bien sin error.
