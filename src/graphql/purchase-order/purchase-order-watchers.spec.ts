import { NotificationEntityType } from '../notification/entities/notification-entity-type.enum.js';
import { NotificationType as T } from '../notification/entities/notification-type.enum.js';
import { PurchaseOrderStatus as POS } from './entities/purchase-order-status.enum.js';
import type { PurchaseOrder } from './entities/purchase-order.entity.js';
import { settlePurchaseOrderNotices } from './purchase-order-watchers.js';

const PO_ID = '22222222-2222-2222-2222-222222222222';

const manager = {} as never;

// Lo que liquidó una orden de compra en ese estado.
async function settledAt(status: POS): Promise<T[]> {
  const notifications = { markEntityRead: vi.fn().mockResolvedValue(0) };
  await settlePurchaseOrderNotices(manager, notifications as never, { id: PO_ID, status } as PurchaseOrder);
  const call = notifications.markEntityRead.mock.calls[0];
  if (!call) return [];
  expect(call[1]).toBe(NotificationEntityType.PURCHASE_ORDER);
  expect(call[2]).toBe(PO_ID);
  return call[3] as T[];
}

describe('settlePurchaseOrderNotices', () => {
  // El caso que se vio en la bandeja: "Orden despachada" seguía pendiente para bodega en órdenes
  // que bodega ya había recibido.
  it('settles "shipped" once the warehouse receives the order', async () => {
    expect(await settledAt(POS.SHIPPED)).not.toContain(T.PURCHASE_ORDER_SHIPPED);
    expect(await settledAt(POS.RECEIVED)).toContain(T.PURCHASE_ORDER_SHIPPED);
    expect(await settledAt(POS.CANCELLED)).toContain(T.PURCHASE_ORDER_SHIPPED);
  });

  // El proveedor la sigue debiendo mientras no la despache: rechazarle el sobrante la devuelve a SENT
  // y vuelve a tocarle a él.
  it('settles "sent" only once the supplier ships it', async () => {
    expect(await settledAt(POS.SENT)).not.toContain(T.PURCHASE_ORDER_SENT);
    expect(await settledAt(POS.PENDING_APPROVAL)).not.toContain(T.PURCHASE_ORDER_SENT);
    expect(await settledAt(POS.SHIPPED)).toContain(T.PURCHASE_ORDER_SENT);
    expect(await settledAt(POS.RECEIVED)).toContain(T.PURCHASE_ORDER_SENT);
  });

  it('settles the overage request once it is resolved', async () => {
    expect(await settledAt(POS.PENDING_APPROVAL)).not.toContain(T.PURCHASE_ORDER_OVERAGE_PENDING);
    expect(await settledAt(POS.SHIPPED)).toContain(T.PURCHASE_ORDER_OVERAGE_PENDING);
    expect(await settledAt(POS.SENT)).toContain(T.PURCHASE_ORDER_OVERAGE_PENDING);
  });

  // Lo último que le pasó a la orden no tiene un después que lo invalide: espera a que se abra. La
  // incidencia tiene su propia regla (sigue pendiente mientras le quede una novedad abierta).
  it('never settles the terminal notices or the incident one', async () => {
    for (const status of Object.values(POS)) {
      const settled = await settledAt(status);
      expect(settled).not.toContain(T.PURCHASE_ORDER_RECEIVED);
      expect(settled).not.toContain(T.PURCHASE_ORDER_CANCELLED);
      expect(settled).not.toContain(T.PURCHASE_ORDER_INCIDENT);
    }
  });
});
