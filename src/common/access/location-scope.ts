import { ForbiddenException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { UserLocationAccess } from '../../graphql/user-location-access/entities/user-location-access.entity.js';
import { RecordStatus } from '../enums/record-status.enum.js';
import { isCompanyAdmin, type CompanyAccess } from './company-access.js';

/**
 * Qué sedes ve cada quien cuando consulta el inventario. El permiso dice QUÉ puede mirar
 * (inventory.view); esto dice DE DÓNDE: un bodeguero ve lo de las bodegas que tiene asignadas
 * (Configuración → Personal por ubicación), no el inventario de toda la empresa. Es la misma idea
 * que `store-access.ts` para operar una tienda, pero del lado de la lectura.
 *
 * `null` significa "todas, sin filtro": lo devuelven el administrador de la empresa y el super
 * administrador, que para eso administran. Un arreglo vacío es lo contrario —no ve ninguna—, y por
 * eso se distingue del `null` en vez de usar la longitud.
 *
 * Se consulta en cada petición, como el resto de los accesos: quitarle una bodega a alguien surte
 * efecto en la siguiente consulta, no al día siguiente.
 */
export async function visibleLocationIds(
  manager: EntityManager,
  companyId: string,
  userId: string,
  access: CompanyAccess,
): Promise<string[] | null> {
  if (isCompanyAdmin(access)) return null;
  const rows = await manager.getRepository(UserLocationAccess).find({
    where: { userId, status: RecordStatus.ACTIVE, location: { companyId } },
    select: { locationId: true },
  });
  return rows.map((row) => row.locationId);
}

/**
 * Rechaza si esa sede no es una de las suyas. Para las operaciones que se piden por id y no pasan
 * por un listado filtrado (fijar un mínimo, crear el cajón de existencias de una sede).
 */
export async function assertVisibleLocation(
  manager: EntityManager,
  companyId: string,
  userId: string,
  access: CompanyAccess,
  locationId: string | null,
): Promise<void> {
  const visible = await visibleLocationIds(manager, companyId, userId, access);
  if (visible === null) return;
  if (!locationId || !visible.includes(locationId)) {
    throw new ForbiddenException('No tienes acceso al inventario de esta sede');
  }
}
