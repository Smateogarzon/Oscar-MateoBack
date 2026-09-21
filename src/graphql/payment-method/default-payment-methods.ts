import type { EntityManager } from 'typeorm';
import { RecordStatus } from '../../common/enums/record-status.enum.js';
import { StorePaymentMethod } from '../store-payment-method/entities/store-payment-method.entity.js';
import { PaymentMethodType } from './entities/payment-method-type.enum.js';
import { PaymentMethod } from './entities/payment-method.entity.js';

/**
 * Los medios de pago no se crean a mano: toda empresa nace con estos tres, uno por tipo. Lo que sí
 * se configura es cuáles acepta cada tienda (StorePaymentMethod). La tarjeta y la transferencia
 * exigen referencia (el voucher, el número de la transferencia); el efectivo no.
 */
export const DEFAULT_PAYMENT_METHODS: ReadonlyArray<{
  name: string;
  type: PaymentMethodType;
  requiresReference: boolean;
}> = [
  { name: 'Efectivo', type: PaymentMethodType.CASH, requiresReference: false },
  { name: 'Tarjeta', type: PaymentMethodType.CARD, requiresReference: true },
  { name: 'Transferencia', type: PaymentMethodType.TRANSFER, requiresReference: true },
];

/** Da a la empresa los medios por defecto que le falten (por tipo). Idempotente: una empresa que ya
 * tiene un medio de un tipo lo conserva tal cual. Es lo que llamará `createCompany` cuando exista;
 * para las empresas que ya existían lo hizo la migración de semilla. */
export async function seedDefaultPaymentMethods(
  manager: EntityManager,
  companyId: string,
): Promise<PaymentMethod[]> {
  const repo = manager.getRepository(PaymentMethod);
  const existing = await repo.find({ where: { companyId } });
  const presentTypes = new Set(existing.map((method) => method.type));

  const missing = DEFAULT_PAYMENT_METHODS.filter((method) => !presentTypes.has(method.type));
  if (missing.length === 0) return existing;

  const created = await repo.save(missing.map((method) => repo.create({ companyId, ...method })));
  return [...existing, ...created];
}

/** Una tienda nueva acepta todos los medios activos de su empresa: el administrador quita los que
 * no quiera. Idempotente: no duplica los que ya tenga. */
export async function allowAllPaymentMethods(
  manager: EntityManager,
  companyId: string,
  storeId: string,
): Promise<void> {
  const methods = await manager
    .getRepository(PaymentMethod)
    .find({ where: { companyId, status: RecordStatus.ACTIVE } });
  if (methods.length === 0) return;

  const repo = manager.getRepository(StorePaymentMethod);
  const already = await repo.find({ where: { storeId } });
  const allowed = new Set(already.map((row) => row.paymentMethodId));

  const rows = methods
    .filter((method) => !allowed.has(method.id))
    .map((method) => repo.create({ storeId, paymentMethodId: method.id }));
  if (rows.length > 0) await repo.save(rows);
}
