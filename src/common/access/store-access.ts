import { ForbiddenException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { UserLocationAccess } from '../../graphql/user-location-access/entities/user-location-access.entity.js';
import { RecordStatus } from '../enums/record-status.enum.js';

/**
 * El permiso dice QUÉ puede hacer alguien; esto dice DÓNDE. Un cajero con permiso para cobrar solo
 * opera en las tiendas que tiene asignadas (Configuración → Personal por ubicación).
 *
 * Se comprueba en cada operación, no solo al empezar: si a alguien le quitan el acceso a una tienda
 * mientras tiene una venta a medias, deja de poder tocarla en ese momento. Consultarlo cada vez es
 * barato (un índice por usuario y ubicación) y es lo que hace que quitar el acceso surta efecto de
 * inmediato, que es justo para lo que sirve.
 */
export async function hasStoreAccess(
  manager: EntityManager,
  userId: string,
  storeId: string,
): Promise<boolean> {
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
 * Nadie está exento: ni el administrador que abre y cierra turnos opera una tienda que no tiene
 * asignada. Si tiene que cobrar, se asigna como cajero de esa tienda como cualquier otro.
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
