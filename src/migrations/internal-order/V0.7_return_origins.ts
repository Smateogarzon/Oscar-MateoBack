import { MigrationInterface, QueryRunner } from 'typeorm';

// De qué documentos viene lo que lleva una devolución (RE). Ya se sabía al crearla, pero se escribía
// dentro de `notes` ("Cajón de devoluciones de Tienda centro · #SO-000001, #SO-000002"): una frase,
// no un dato. Para poder mostrarlo —y poder mostrar VARIOS, que es lo normal en una RE armada desde
// el cajón— se guarda aparte, como lista.
//
// Es una columna de texto con los números separados por comas (`simple-array` de TypeORM): lo que se
// guarda son los consecutivos que ya veía el usuario, no ids, porque lo que llega al cajón puede
// venir de un pedido, de una venta o de la devolución de una venta.
export class ReturnOrigins1791900000009 implements MigrationInterface {
  name = 'ReturnOrigins1791900000009';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "internal_orders" ADD "originNumbers" text`);

    // Las devoluciones que ya existen: la de un cambio sabe su origen por `relatedOrderId`.
    await queryRunner.query(`
      UPDATE "internal_orders" re
      SET "originNumbers" = origen."orderNumber"
      FROM "internal_orders" origen
      WHERE re."type" = 'RE'
        AND re."relatedOrderId" = origen."id"
        AND re."originNumbers" IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "internal_orders" DROP COLUMN "originNumbers"`);
  }
}
