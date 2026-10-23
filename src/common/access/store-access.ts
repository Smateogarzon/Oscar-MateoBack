import { ForbiddenException } from '@nestjs/common';
import { In, type EntityManager } from 'typeorm';
import { UserCompanyRole } from '../../graphql/user-company-role/entities/user-company-role.entity.js';
import { UserLocationAccess } from '../../graphql/user-location-access/entities/user-location-access.entity.js';
import { RecordStatus } from '../enums/record-status.enum.js';
import { PLATFORM_ROLE } from './platform-role.js';

/**
 * El permiso dice QUÉ puede hacer alguien; esto dice DÓNDE. Un cajero con permiso para cobrar solo
 * opera en las tiendas que tiene asignadas (Configuración → Personal por ubicación).
 *
 * Se comprueba en cada operación, no solo al empezar: si a alguien le quitan el acceso a una tienda
 * mientras tiene una venta a medias, deja de poder tocarla en ese momento. Consultarlo cada vez es
 * barato (un índice por usuario y ubicación) y es lo que hace que quitar el acceso surta efecto de
 * inmediato, que es justo para lo que sirve.
 *
 * Excepción: el super admin (rol de plataforma, scope GLOBAL) tiene acceso a todas las tiendas de
 * todas las empresas sin necesidad de asignación explícita, igual que ya pasa con empresas
 * suspendidas en loadCompanyAccess. Administra toda la plataforma, no haría sentido asignarlo
 * tienda por tienda.
 */
export async function hasStoreAccess(
  manager: EntityManager,
  userId: string,
  storeId: string,
): Promise<boolean> {
  const isPlatformUser = await manager
    .getRepository(UserCompanyRole)
    .existsBy({ userId, status: RecordStatus.ACTIVE, role: PLATFORM_ROLE });
  if (isPlatformUser) return true;

  return manager.getRepository(UserLocationAccess).existsBy({
    userId,
    locationId: storeId,
    status: RecordStatus.ACTIVE,
  });
}

/**
 * Igual, pero rechaza en vez de responder. El mensaje no dice qué tienda es: quien no tiene acceso
 * tampoco tiene por qué enterarse de cuáles existen.
 *
 * Todo el mundo que no sea super admin necesita asignación explícita: ni el administrador de
 * empresa que abre y cierra turnos opera una tienda que no tiene asignada. Si tiene que cobrar, se
 * asigna como cajero de esa tienda como cualquier otro.
 */
export async function assertStoreAccess(
  manager: EntityManager,
  userId: string,
  storeId: string,
): Promise<void> {
  if (!(await hasStoreAccess(manager, userId, storeId))) {
    throw new ForbiddenException('No tienes acceso a esta tienda');
  }
}

/**
 * De `userIds`, los que trabajan en esa sede (Configuración → Personal por ubicación), más los de
 * plataforma, que entran a todas. Es `hasStoreAccess` para una lista: dos consultas en vez de una
 * por persona.
 *
 * Lo usan los avisos, para no molestar a quien no opera esa sede: un bodeguero no tiene por qué
 * enterarse de lo que llega a una bodega que no es suya (y si le llega el aviso, al tocarlo no
 * encuentra nada, porque tampoco la ve).
 */
export async function usersWithStoreAccess(
  manager: EntityManager,
  userIds: readonly string[],
  // Una sede, o varias cuando basta con tener cualquiera de ellas: un corredor entra a una orden que
  // SALE DE o LLEGA A una sede suya, no hace falta que tenga las dos.
  locationId: string | readonly string[],
): Promise<string[]> {
  if (userIds.length === 0) return [];
  const locationIds = typeof locationId === 'string' ? [locationId] : [...new Set(locationId)];
  if (locationIds.length === 0) return [];
  const assigned = await manager.getRepository(UserLocationAccess).find({
    select: { userId: true },
    where: { userId: In([...userIds]), locationId: In(locationIds), status: RecordStatus.ACTIVE },
  });
  const platform = await manager.getRepository(UserCompanyRole).find({
    select: { userId: true },
    where: { userId: In([...userIds]), status: RecordStatus.ACTIVE, role: PLATFORM_ROLE },
  });
  return [...new Set([...assigned.map((row) => row.userId), ...platform.map((row) => row.userId)])];
}
