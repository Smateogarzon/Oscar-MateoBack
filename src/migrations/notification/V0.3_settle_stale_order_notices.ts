import { MigrationInterface, QueryRunner } from 'typeorm';

const list = (...statuses: string[]): string => statuses.map((status) => `'${status}'`).join(', ');

// La mercancía ya salió del origen (PICKED_UP_STATUSES), más la orden anulada: de ahí en adelante no
// hay nada que apurar ni que preguntarle a bodega.
const PICKED_UP_OR_CANCELLED = list(
  'IN_TRANSIT',
  'DELIVERED_TO_STORE',
  'RECEIVED_BY_SELLER',
  'PENDING_PAYMENT',
  'PAID',
  'RETURN_REQUESTED',
  'ITEM_CHANGE_REQUESTED',
  'MERGED_INTO_PARENT',
  'CLOSED_BY_CHANGE',
  'IN_TRANSIT_TO_WAREHOUSE',
  'DELIVERED_TO_WAREHOUSE',
  'RECEIVED_BY_WAREHOUSE',
  'RETURNED',
  'DELIVERED_TO_DESTINATION',
  'RECEIVED_BY_DESTINATION',
  'TRANSFERRED',
  'RECEIVED_BY_STORE',
  'RESTOCKED',
  'CANCELLED',
);

// El corredor todavía responde por la orden: la tomó, la lleva, o la entregó y espera la
// confirmación del receptor (RUNNER_ENGAGED_STATUSES).
const RUNNER_ENGAGED = list(
  'READY_FOR_RUNNER',
  'WAITING_FOR_RUNNER',
  'IN_TRANSIT',
  'IN_TRANSIT_TO_WAREHOUSE',
  'DELIVERED_TO_STORE',
  'DELIVERED_TO_WAREHOUSE',
  'DELIVERED_TO_DESTINATION',
);

// Corrige datos: hasta ahora nada liquidaba los avisos de los pedidos internos ni los del cajón de
// devoluciones. Como cada aviso va a TODOS los que pueden dar el paso (toda la bodega, todos los
// corredores, toda la caja de la tienda) y solo salía de "Pendientes" para quien lo abría, a los
// demás les quedó ahí para siempre: pedidos ya alistados, cobrados, anulados o cerrados seguían
// pidiendo en la bandeja algo que nadie tenía que hacer.
//
// `settleInternalOrderNotices` ya los liquida de aquí en adelante, pero solo al cambiar el estado de
// la orden: los que quedaron colgados de órdenes YA cerradas no van a cambiar de estado nunca más y
// nada los tocaría. Esta migración los pone al día una vez, con las mismas reglas
// (ver internal-order-watchers.ts: NOTICE_ALIVE_WHILE).
//
// Solo toca los que nadie abrió (`readAt IS NULL`): los que sí se abrieron conservan su fecha.
// No toca ORDER_CANCELLED (nace con la orden ya anulada y pide lo único que queda por hacer:
// devolver a su sitio lo que bodega había separado).
export class SettleStaleOrderNotices1791900000060 implements MigrationInterface {
  name = 'SettleStaleOrderNotices1791900000060';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Los avisos de una orden que todavía existe: cada tipo, hasta el estado en que deja de pedir algo.
    await queryRunner.query(`
      UPDATE "user_notifications" un
      SET "readAt" = now()
      FROM "notifications" n
      JOIN "internal_orders" o ON o."id" = n."entityId"
      WHERE un."notificationId" = n."id"
        AND un."readAt" IS NULL
        AND n."entityType" = 'INTERNAL_ORDER'
        AND CASE n."type"
          -- bodega: llegó una orden nueva · hasta que bodega la toma
          WHEN 'ORDER_REQUESTED' THEN o."status" NOT IN
            ('NEW', 'ACCEPTED_BY_WAREHOUSE', 'TRANSFER_REQUESTED', 'RESTOCK_REQUESTED', 'RETURN_CREATED')
          -- corredores: hay una lista para recoger · hasta que un corredor la recoge
          WHEN 'ORDER_READY_FOR_RUNNER' THEN o."status" NOT IN ('READY_FOR_RUNNER', 'WAITING_FOR_RUNNER')
          -- quien la pidió: el corredor la entregó · hasta que confirma el recibo
          WHEN 'ORDER_DELIVERED' THEN o."status" NOT IN
            ('DELIVERED_TO_STORE', 'DELIVERED_TO_WAREHOUSE', 'DELIVERED_TO_DESTINATION')
          -- caja de la tienda: hay que cobrarla · hasta que se cobra o vuelve al vendedor
          WHEN 'ORDER_PENDING_PAYMENT' THEN o."status" <> 'PENDING_PAYMENT'
          -- bodega: el vendedor apura o pregunta · hasta que la mercancía sale del origen
          WHEN 'ORDER_HURRY' THEN o."status" IN (${PICKED_UP_OR_CANCELLED})
          WHEN 'ORDER_STOCK_QUESTION' THEN o."status" IN (${PICKED_UP_OR_CANCELLED})
          -- el corredor y quien la pidió · mientras el corredor responda por la orden
          WHEN 'ORDER_RUNNER_CALLED' THEN o."status" NOT IN (${RUNNER_ENGAGED})
          WHEN 'ORDER_RUNNER_REPLIED' THEN o."status" NOT IN (${RUNNER_ENGAGED})
          ELSE false
        END
    `);

    // El retorno por error ya cerrado: su aviso no le pide nada ni a bodega ni a los corredores.
    await queryRunner.query(`
      UPDATE "user_notifications" un
      SET "readAt" = now()
      FROM "notifications" n
      WHERE un."notificationId" = n."id"
        AND un."readAt" IS NULL
        AND n."entityType" = 'INTERNAL_ORDER'
        AND n."type" = 'ORDER_CORRECTION'
        AND NOT EXISTS (
          SELECT 1 FROM "internal_order_corrections" c
          WHERE c."internalOrderId" = n."entityId" AND c."closedAt" IS NULL
        )
    `);

    // Un aviso de un pedido que ya no está: no hay nada que abrir ni nada que hacer.
    await queryRunner.query(`
      UPDATE "user_notifications" un
      SET "readAt" = now()
      FROM "notifications" n
      WHERE un."notificationId" = n."id"
        AND un."readAt" IS NULL
        AND n."entityType" = 'INTERNAL_ORDER'
        AND n."type" <> 'ORDER_CANCELLED'
        AND (n."entityId" IS NULL OR NOT EXISTS (SELECT 1 FROM "internal_orders" o WHERE o."id" = n."entityId"))
    `);

    // Las órdenes de compra, con la misma regla: solo los avisos que un estado posterior dejó sin
    // sentido (ver purchase-order-watchers.ts: PO_NOTICE_ALIVE_WHILE). Los que anuncian lo último que
    // pasó (recibida, anulada) y las incidencias siguen pendientes hasta que se abran.
    await queryRunner.query(`
      UPDATE "user_notifications" un
      SET "readAt" = now()
      FROM "notifications" n
      JOIN "purchase_orders" po ON po."id" = n."entityId"
      WHERE un."notificationId" = n."id"
        AND un."readAt" IS NULL
        AND n."entityType" = 'PURCHASE_ORDER'
        AND CASE n."type"
          -- el proveedor: despáchala · hasta que la despacha (o se anula)
          WHEN 'PURCHASE_ORDER_SENT' THEN po."status" NOT IN ('DRAFT', 'SENT', 'PENDING_APPROVAL')
          -- compras: autoriza el sobrante · hasta que lo resuelve
          WHEN 'PURCHASE_ORDER_OVERAGE_PENDING' THEN po."status" <> 'PENDING_APPROVAL'
          -- bodega: va en camino, recíbela · hasta que la recibe (o se anula)
          WHEN 'PURCHASE_ORDER_SHIPPED' THEN po."status" <> 'SHIPPED'
          ELSE false
        END
    `);

    // El cajón de devoluciones de una tienda que ya quedó vacío: lo que avisó que algo llegó ahí ya
    // no le pide nada al administrador. Si todavía queda algo, el aviso sigue pendiente: eso es justo
    // lo que falta por hacer.
    await queryRunner.query(`
      UPDATE "user_notifications" un
      SET "readAt" = now()
      FROM "notifications" n
      WHERE un."notificationId" = n."id"
        AND un."readAt" IS NULL
        AND n."entityType" = 'RETURNS_BIN'
        AND n."type" = 'RETURNS_BIN_ADDED'
        AND NOT EXISTS (
          SELECT 1
          FROM "inventory_reservations" r
          JOIN "inventory_locations" il ON il."id" = r."inventoryLocationId"
          WHERE r."sourceType" = 'RETURNS_BIN'
            AND il."type" = 'STOCK'
            AND il."locationId" = n."entityId"
        )
    `);
  }

  // Una corrección de datos no se deshace: volver a dejarlos sin leer sería inventar una decisión.
  public async down(): Promise<void> {}
}
