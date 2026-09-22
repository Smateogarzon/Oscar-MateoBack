import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import { EntityManager, In } from 'typeorm';
import { RecordStatus } from '../../common/enums/record-status.enum.js';
import { PaymentMethod } from './entities/payment-method.entity.js';

export interface PaymentToValidate {
  paymentMethodId: string;
  amount: Decimal;
  reference?: string | null;
}

// Comprueba que cada medio de pago de `payments` exista, esté activo y sea de la empresa, y que
// traiga referencia si el medio la exige. La usan SalePaymentService.complete (al cobrar una venta)
// y SaleReturnService.completeRefund (al entregar un reembolso) antes de guardar los pagos; cada
// una sigue con su propia comprobación de que los montos sumen lo que corresponde. Devuelve el mapa
// id → PaymentMethod para que quien llama lo reutilice (p. ej. para saber si algún pago fue en
// efectivo, o si la tienda acepta ese medio).
export async function validatePaymentMethods(
  manager: EntityManager,
  companyId: string,
  payments: PaymentToValidate[],
): Promise<Map<string, PaymentMethod>> {
  const methodIds = [...new Set(payments.map((payment) => payment.paymentMethodId))];
  const methods =
    methodIds.length === 0
      ? []
      : await manager.getRepository(PaymentMethod).find({
          where: { id: In(methodIds), companyId, status: RecordStatus.ACTIVE },
        });
  const methodsById = new Map(methods.map((method) => [method.id, method]));

  for (const payment of payments) {
    const method = methodsById.get(payment.paymentMethodId);
    if (!method) {
      throw new NotFoundException(`Medio de pago ${payment.paymentMethodId} no encontrado`);
    }
    if (method.requiresReference && !payment.reference) {
      throw new BadRequestException(`El medio de pago ${method.name} exige una referencia`);
    }
  }

  return methodsById;
}
