import { MigrationInterface, QueryRunner } from 'typeorm';

// Una caja para cada tienda que ya existe y todavía no tiene ninguna, con el nombre de la tienda y
// el código C1, igual que la que nace hoy con cada tienda nueva (LocationService.create). Las
// bodegas no llevan caja. La caja queda con el mismo estado que su tienda.
// Timestamp +1 día: debe correr después de la migración de esquema de "cash-register" (V0.1).
// Cada caja lleva un id calculado a partir de su tienda: así el `down` borra exactamente las que
// creó este seed y nunca una que la app o el administrador haya creado.
export class SeedCashRegister1790011471074 implements MigrationInterface {
  name = 'SeedCashRegister1790011471074';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // El nombre de una caja admite 80 caracteres (el de una sede, 120): mismo recorte que
    // defaultCashRegisterName.
    await queryRunner.query(`
      INSERT INTO "cash_registers" ("id", "storeId", "name", "code", "status")
      SELECT md5('default-cash-register:' || l."id")::uuid,
             l."id",
             COALESCE(NULLIF(BTRIM(LEFT(BTRIM(l."name"), 80)), ''), 'Caja principal'),
             'C1',
             l."status"
      FROM "locations" l
      WHERE l."type" = 'STORE'
        AND NOT EXISTS (SELECT 1 FROM "cash_registers" r WHERE r."storeId" = l."id")
    `);
  }

  // Borra las cajas que creó este seed, salvo las que ya tuvieron algún turno.
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM "cash_registers" r
      WHERE r."id" IN (SELECT md5('default-cash-register:' || l."id")::uuid FROM "locations" l)
        AND NOT EXISTS (SELECT 1 FROM "cash_sessions" s WHERE s."cashRegisterId" = r."id")
    `);
  }
}
