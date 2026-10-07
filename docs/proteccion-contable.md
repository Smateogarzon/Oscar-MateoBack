# Protección del histórico de caja

Qué se puede borrar de la base de datos y qué no, por qué, y qué hacer cuando de verdad hay que
corregir algo. Lo implementa la migración `src/migrations/common/V0.4_protect_ledger.ts` con
triggers de Postgres: valen para la aplicación, para una consola de `psql` y para cualquier cliente
de SQL, porque están por debajo de todos.

## El problema que resuelve

Antes de esta migración, un `DELETE FROM cash_movements WHERE ...` desde una consola salía sin una
sola queja: ninguna llave foránea apunta a los movimientos, a los pagos ni a los reembolsos (son
hojas del esquema), y la app se conecta con el mismo usuario que es dueño de las tablas. Borrando de
hijos a padres se podía borrar "el día" completo: movimientos, pagos, reembolsos, ventas y turno.

Y eso descuadra la contabilidad de verdad. El efectivo esperado de un turno sale de

```
esperado = apertura + ventas en efectivo + ingresos − egresos − reembolsos en efectivo
```

y al cerrar el turno esa cifra **se congela** en `cash_sessions.expectedAmount`. Si después
desaparece un movimiento, la cifra guardada ya no se puede reproducir con los datos que quedan. Si
desaparece un reembolso, la devolución sigue diciendo que se le entregó al cliente un dinero que la
caja nunca vio.

## Qué está protegido

| Tabla | DELETE | UPDATE |
|---|---|---|
| `cash_movements` | nunca | nunca |
| `sale_payments` | nunca | nunca |
| `refund_payments` | nunca | nunca |
| `cash_sessions` | nunca | solo mientras el turno está abierto |
| `sales` | solo en borrador | solo en borrador |
| `sale_items` | solo si su venta es borrador | solo si su venta es borrador |
| `discount_requests` | solo si su venta es borrador | solo si su venta es borrador |
| `discount_request_items` | solo si su venta es borrador | solo si su venta es borrador |
| `sale_returns` | nunca (se cancela) | no si ya está terminada, rechazada o cancelada |
| `sale_return_items` | solo si su devolución está pendiente | solo si su devolución está pendiente |
| `document_sequences` | nunca | sí (es el consecutivo, tiene que avanzar) |
| `idempotency_keys` | solo claves de más de 7 días | sí |

`TRUNCATE` está bloqueado en las doce (no dispara los triggers de fila, por eso lleva el suyo), y
todos los triggers están en modo `ENABLE ALWAYS`: siguen disparándose aunque alguien ponga
`session_replication_role = 'replica'`, que es la receta más repetida para "desactivar triggers".

Un intento rechazado falla con el código `23001` y un mensaje que empieza por `[contable]`.

## Cómo se corrige un error entonces

Igual que en cualquier libro contable: **con otro documento que lo compense**, no borrando el
original.

- Un movimiento de caja mal registrado → otro movimiento en sentido contrario, con la descripción
  diciendo qué corrige.
- Una venta cobrada mal → una devolución (`DEV-…`).
- Un descuadre que aparece después de cerrar el turno → un movimiento de ajuste en el turno
  siguiente.
- Un borrador que no llegó a nada → se cancela, o se descarta solo al cerrar el turno.

Así el error y la corrección quedan los dos, con fecha y con autor. Es lo que le permite al contador
entender qué pasó.

## La llave explícita

Si algún día hay que tocar una fila de verdad (un dato corrupto, una corrección acordada), **no se
bajan los triggers**: se pide permiso para esa transacción.

```sql
BEGIN;
SET LOCAL app.ledger_override = 'ON';
-- el arreglo, siempre acotado con WHERE
COMMIT;
```

Cada operación permitida así deja un `WARNING` en el log de Postgres con la tabla, la operación y la
fila. Existe por una razón: sin ella, la tentación ante un problema sería `DROP TRIGGER`, que es
silencioso y deja la base desprotegida para siempre.

No es una puerta blindada: quien tiene acceso al SQL siempre va a poder. Lo que cambia es que ya no
se puede por accidente, ni de una sola línea, ni sin dejar rastro.

## Lo que falta para cerrar del todo

Los triggers frenan el borrado accidental y el de una consola. Contra alguien con las credenciales
de la app en la mano, el candado que falta es no conectarse con el dueño de las tablas: un rol de
aplicación con `SELECT, INSERT, UPDATE` y **sin** `DELETE` sobre estas tablas, y el dueño reservado
para las migraciones. Está anotado como el punto 23 de `pendientes-despliegue.md`.

## Cómo verificarlo

Contra el Postgres local:

```bash
npx vitest run src/common/ledger-guards.integration.spec.ts
```

El test comprueba que los triggers están puestos y en modo `ALWAYS`, que lo prohibido falla (borrar
un movimiento, un turno, una venta cobrada; vaciar la tabla) y que lo que hace la aplicación sigue
pasando (descartar borradores, purgar claves vencidas, registrar el movimiento que compensa). Todo
dentro de una transacción que termina en `ROLLBACK`: no deja una sola fila.

Y a mano, sobre cualquier base:

```sql
SELECT c.relname, t.tgname, t.tgenabled
  FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
 WHERE NOT t.tgisinternal AND t.tgname LIKE 'trg_%_ledger'
 ORDER BY 1;
```
