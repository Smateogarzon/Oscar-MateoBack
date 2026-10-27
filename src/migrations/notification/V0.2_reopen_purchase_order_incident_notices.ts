import { MigrationInterface, QueryRunner } from 'typeorm';

// Corrige datos: al abrir una orden desde su aviso, la versión anterior lo marcaba como leído y lo
// sacaba de pendientes aunque la orden siguiera con novedades abiertas. Un aviso de orden con
// incidencia solo se da por resuelto cuando ya no le queda ninguna (ver settlePurchaseOrderIncidentNotices),
// así que aquí se reabren los que quedaron leídos con novedades todavía abiertas.
export class ReopenPurchaseOrderIncidentNotices1791900000007 implements MigrationInterface {
  name = 'ReopenPurchaseOrderIncidentNotices1791900000007';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "user_notifications" un
      SET "readAt" = NULL
      FROM "notifications" n
      WHERE un."notificationId" = n."id"
        AND n."type" = 'PURCHASE_ORDER_INCIDENT'
        AND un."readAt" IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM "purchase_order_items" i
          JOIN "incidents" inc ON inc."entityType" = 'PURCHASE_ORDER_ITEM' AND inc."entityId" = i."id"
          WHERE i."purchaseOrderId" = n."entityId"
            AND inc."status" IN ('OPEN', 'IN_REVIEW')
        )
    `);
  }

  // Una corrección de datos no se deshace: volver a marcarlos leídos sería inventar una decisión.
  public async down(): Promise<void> {}
}
