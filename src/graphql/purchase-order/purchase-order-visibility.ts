import { ForbiddenException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import type { CompanyAccess } from '../../common/access/company-access.js';
import { visibleLocationIds } from '../../common/access/location-scope.js';
import { hasStoreAccess } from '../../common/access/store-access.js';
import { PermissionCode } from '../../common/enums/permission-code.enum.js';
import { RoleCode } from '../../common/enums/role-code.enum.js';

/**
 * Qué órdenes de compra ve cada quien. El permiso dice QUÉ puede mirar; esto dice DE DÓNDE, igual
 * que en el inventario (`location-scope.ts`) y en los pedidos internos.
 *
 * El bodeguero ve lo que entra a SUS bodegas (Configuración → Personal por ubicación). Antes veía
 * —y podía recibir— las de toda la empresa: una orden que llega a otra bodega no es asunto suyo, y
 * firmar su llegada le metía existencia a una bodega que no opera.
 *
 * `null` significa "todas, sin filtro":
 *   · el proveedor, que ya queda acotado a las suyas por `supplierId` (él despacha, no recibe: a qué
 *     bodega entran no cambia cuáles son suyas);
 *   · quien gestiona las compras de la empresa (y el super admin, que tiene el catálogo entero), que
 *     es quien las arma y tiene que poder seguirlas hasta que lleguen.
 * Un arreglo vacío es lo contrario —no ve ninguna—, y por eso se distingue del `null`.
 */
export async function purchaseOrderLocationScope(
  manager: EntityManager,
  companyId: string,
  userId: string,
  access: CompanyAccess,
): Promise<string[] | null> {
  if (access.roleCodes.includes(RoleCode.SUPPLIER)) return null;
  if (access.permissionCodes.includes(PermissionCode.SUPPLIERS_MANAGE_PURCHASE_ORDERS)) return null;
  return visibleLocationIds(manager, companyId, userId, access);
}

/**
 * Rechaza si esa bodega no es una de las suyas. Para recibir: es el paso que mete la existencia al
 * inventario, y se pide por id sin pasar por ningún listado filtrado, así que la lectura acotada no
 * alcanza (ver `purchaseOrderLocationScope`).
 *
 * Va aparte de la lectura a propósito: el super admin entra a todas las bodegas (`hasStoreAccess`),
 * pero el administrador de la empresa no recibe en una bodega que no tiene asignada, igual que no
 * cobra en una tienda que no es suya (ver `store-access.ts`).
 */
export async function assertCanReceiveAt(
  manager: EntityManager,
  userId: string,
  destinationLocationId: string,
): Promise<void> {
  if (!(await hasStoreAccess(manager, userId, destinationLocationId))) {
    throw new ForbiddenException('Esta orden entra a una bodega que no tienes asignada');
  }
}
