import type { EntityManager } from 'typeorm';
import { PermissionCode } from '../../common/enums/permission-code.enum.js';
import { NotificationChannel } from '../notification/entities/notification-channel.enum.js';
import { NotificationEntityType } from '../notification/entities/notification-entity-type.enum.js';
import type { NotificationService } from '../notification/notification.service.js';
import { RoleScope } from '../role/entities/role-scope.enum.js';
import type { PurchaseOrder } from './entities/purchase-order.entity.js';

// Una orden de compra pasa por tres manos: la arma el administrador, la cuenta y la despacha el
// proveedor, y la recibe contándola el bodeguero (cualquiera de los dos primeros la cancela). Cada
// paso tiene que verse en la pantalla de los otros sin recargar, así que al cambiar se manda una
// señal en vivo (canal PURCHASING, sin crear ningún aviso: igual que los turnos de caja). Como todo
// lo que va en vivo, solo sale si la transacción se confirma, y no lleva datos: quien la recibe
// vuelve a consultar y el servidor le devuelve lo que le corresponda ver.
export async function signalPurchaseOrderChange(
  manager: EntityManager,
  notifications: NotificationService,
  companyId: string,
  purchaseOrder: PurchaseOrder,
  actorId: string,
): Promise<void> {
  // Solo los roles de EMPRESA (y el super admin, que findUserIdsWithPermission incluye siempre): el
  // proveedor tiene el mismo permiso de compras (arma las suyas) y la orden de otro proveedor para él
  // no existe (ver PurchaseOrderResolver).
  const purchasingIds = await notifications.findUserIdsWithPermission(
    manager,
    companyId,
    PermissionCode.SUPPLIERS_MANAGE_PURCHASE_ORDERS,
    { scope: RoleScope.COMPANY },
  );

  // Bodega también la sigue: es quien la cuenta y la acepta cuando el proveedor la despacha.
  const warehouseIds = await notifications.findUserIdsWithPermission(
    manager,
    companyId,
    PermissionCode.WAREHOUSE_FULFILL_ORDERS,
    { scope: RoleScope.COMPANY },
  );

  notifications.signalChange(manager, {
    companyId,
    channel: NotificationChannel.PURCHASING,
    entityType: NotificationEntityType.PURCHASE_ORDER,
    entityId: purchaseOrder.id,
    recipientIds: [
      // El proveedor al que va la orden y quien la armó la siguen siempre, tengan el permiso que
      // tengan hoy: es la suya.
      purchaseOrder.supplierId,
      purchaseOrder.createdBy,
      ...purchasingIds,
      ...warehouseIds,
    ],
    exceptUserId: actorId,
  });
}
