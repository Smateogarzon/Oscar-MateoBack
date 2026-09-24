import type { EntityManager } from 'typeorm';
import { CashRegister } from './entities/cash-register.entity.js';

// Bloquea todas las cajas de una tienda hasta que termine la transacción y las devuelve tal como
// están AHORA. Es el mismo bloqueo que toma abrir un turno (CashSessionService.open) y desactivar una
// caja (CashRegisterService.deactivate): quien cambie algo que afecte a los turnos de la tienda
// (desactivarla, quitarle el acceso a un cajero) pasa por aquí y espera a las aperturas en curso; y
// una apertura que llegue después ve ya lo que se decidió. Se piden siempre en el mismo orden (por
// id) para que dos operaciones que bloqueen varias cajas no se crucen.
export function lockStoreRegisters(manager: EntityManager, storeId: string): Promise<CashRegister[]> {
  return manager.getRepository(CashRegister).find({
    where: { storeId },
    order: { id: 'ASC' },
    lock: { mode: 'pessimistic_write' },
  });
}
