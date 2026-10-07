import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import type { EntityManager } from 'typeorm';
import type { PurchaseOrderItemCountInput } from './dto/purchase-order-item-count.input.js';
import { PurchaseOrderItem } from './entities/purchase-order-item.entity.js';

// Las líneas de una orden, en el orden en que se armaron (es el orden de la pantalla). Lo usan la
// consulta de líneas, el despacho, la recepción y el sobrante: una sola forma de leerlas.
export function loadPurchaseOrderItems(
  manager: EntityManager,
  purchaseOrderId: string,
): Promise<PurchaseOrderItem[]> {
  return manager
    .getRepository(PurchaseOrderItem)
    .find({ where: { purchaseOrderId }, order: { createdAt: 'ASC' } });
}

// Los rechazos de un conteo, con las palabras de cada paso (despacho o recepción).
export interface CountMessages {
  unknownItem: (itemId: string) => string;
  repeated: string;
  missing: string;
}

// Lo contado de cada línea esperada (`items`), exigiendo que vengan todas y una sola vez: contar una
// orden es haberla contado entera, y un conteo al que le falta una referencia está a medias. Es la
// misma regla para el despacho del proveedor y para la recepción del bodeguero.
export function countedByItem(
  items: readonly PurchaseOrderItem[],
  counted: readonly PurchaseOrderItemCountInput[],
  messages: CountMessages,
): Map<string, Decimal> {
  const expected = new Set(items.map((item) => item.id));
  const quantities = new Map<string, Decimal>();

  for (const line of counted) {
    if (!expected.has(line.itemId)) throw new NotFoundException(messages.unknownItem(line.itemId));
    if (quantities.has(line.itemId)) throw new BadRequestException(messages.repeated);
    quantities.set(line.itemId, new Decimal(line.quantity));
  }

  if (quantities.size !== items.length) throw new BadRequestException(messages.missing);
  return quantities;
}
