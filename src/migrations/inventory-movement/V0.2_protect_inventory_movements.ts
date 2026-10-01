import { MigrationInterface, QueryRunner } from 'typeorm';

// El kárdex (ver inventory-movement.entity.ts) nunca se edita ni se borra: hasta ahora esa garantía
// dependía solo de que InventoryMovementService no expusiera un update ni un delete, exactamente
// como pasaba con la caja y las ventas antes de V0.4_protect_ledger (common). Un movimiento borrado
// o editado a mano por SQL descuadra la existencia sin dejar rastro de por qué. Reusa el mismo
// candado que esa migración ya dejó instalado (ledger_frozen_row/ledger_no_truncate, con la misma
// llave de escape app.ledger_override para una corrección real): no hace falta uno nuevo, un
// movimiento de inventario es un asiento igual que un pago o un reembolso.
//
// inventory_balances NO entra aquí a propósito, aunque es el otro lado del mismo módulo: no es un
// asiento, es la existencia actual, y se actualiza en cada movimiento
// (InventoryMovementService.adjustBalance) y se borra de verdad en el único borrado físico del
// backend (ProductService.deleteReferenceWithin, al eliminar en frío una referencia que nunca tuvo
// actividad). Bloquearla rompería ambos flujos.
export class ProtectInventoryMovements1791100000000 implements MigrationInterface {
  name = 'ProtectInventoryMovements1791100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TRIGGER trg_inventory_movements_ledger BEFORE UPDATE OR DELETE ON "inventory_movements"
        FOR EACH ROW EXECUTE FUNCTION ledger_frozen_row()
    `);
    await queryRunner.query(`
      CREATE TRIGGER trg_inventory_movements_no_truncate BEFORE TRUNCATE ON "inventory_movements"
        FOR EACH STATEMENT EXECUTE FUNCTION ledger_no_truncate()
    `);
    await queryRunner.query(`ALTER TABLE "inventory_movements" ENABLE ALWAYS TRIGGER "trg_inventory_movements_ledger"`);
    await queryRunner.query(`ALTER TABLE "inventory_movements" ENABLE ALWAYS TRIGGER "trg_inventory_movements_no_truncate"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TRIGGER IF EXISTS "trg_inventory_movements_no_truncate" ON "inventory_movements"`);
    await queryRunner.query(`DROP TRIGGER IF EXISTS "trg_inventory_movements_ledger" ON "inventory_movements"`);
  }
}
