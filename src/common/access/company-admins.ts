import { ConflictException, ForbiddenException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { PermissionCode } from '../enums/permission-code.enum.js';

// Quién administra una empresa: la cuenta está activa, su membresía está activa y su rol (activo y de
// la empresa, no de plataforma) tiene los dos permisos que gobiernan a la empresa: administrar usuarios
// (users.manage) y administrar la configuración (settings.manage). Una empresa sin nadie así no la puede
// arreglar nadie desde adentro (quedaría a merced de un super administrador o de SQL), así que ninguna
// operación puede dejarla en cero.
export const LAST_ADMIN_MESSAGE = 'La empresa tiene que conservar al menos un administrador activo';

// Bloquea la fila de la empresa hasta que termine la transacción: dos operaciones que cambian quién
// administra (dos administradores que se quitan el acceso a la vez) se ponen en fila en vez de pasar
// las dos contra la misma foto. Va PRIMERO, antes de bloquear un usuario o una membresía.
export async function lockCompany(manager: EntityManager, companyId: string): Promise<void> {
  await manager.query('SELECT "id" FROM "companies" WHERE "id" = $1 FOR UPDATE', [companyId]);
}

// Cuántas personas administran la empresa ahora mismo (dentro de la transacción de quien llama, así ve
// sus propios cambios sin confirmar).
export async function countCompanyAdmins(manager: EntityManager, companyId: string): Promise<number> {
  const rows: { count: number | string }[] = await manager.query(
    `SELECT COUNT(DISTINCT ucr."userId")::int AS "count"
     FROM "user_company_roles" ucr
     JOIN "users" u ON u."id" = ucr."userId" AND u."status" = 'ACTIVE'
     JOIN "roles" r ON r."id" = ucr."roleId" AND r."status" = 'ACTIVE' AND r."scope" <> 'GLOBAL'
     WHERE ucr."companyId" = $1 AND ucr."status" = 'ACTIVE'
       AND EXISTS (
         SELECT 1 FROM "role_permissions" rp
         JOIN "permissions" p ON p."id" = rp."permissionId"
         WHERE rp."companyId" = $1 AND rp."roleId" = r."id" AND p."status" = 'ACTIVE' AND p."code" = $2
       )
       AND EXISTS (
         SELECT 1 FROM "role_permissions" rp
         JOIN "permissions" p ON p."id" = rp."permissionId"
         WHERE rp."companyId" = $1 AND rp."roleId" = r."id" AND p."status" = 'ACTIVE' AND p."code" = $3
       )`,
    [companyId, PermissionCode.USERS_MANAGE, PermissionCode.SETTINGS_MANAGE],
  );
  return Number(rows[0]?.count ?? 0);
}

// Se llama DESPUÉS de aplicar el cambio (dentro de la misma transacción) con lo que había ANTES: si la
// empresa tenía administradores y el cambio la dejó sin ninguno, lanza y la transacción entera se
// deshace. Si ya no tenía ninguno de antes, no estorba: el cambio no fue lo que la dejó así.
export async function assertStillHasAdmin(
  manager: EntityManager,
  companyId: string,
  before: number,
): Promise<void> {
  if (before > 0 && (await countCompanyAdmins(manager, companyId)) === 0) {
    throw new ConflictException(LAST_ADMIN_MESSAGE);
  }
}

// Los permisos (códigos) que tiene un rol en la empresa: los que la empresa le dejó asignados.
export async function permissionCodesOfRole(
  manager: EntityManager,
  companyId: string,
  roleId: string,
): Promise<string[]> {
  const rows: { code: string }[] = await manager.query(
    `SELECT p."code" FROM "role_permissions" rp
     JOIN "permissions" p ON p."id" = rp."permissionId" AND p."status" = 'ACTIVE'
     WHERE rp."companyId" = $1 AND rp."roleId" = $2`,
    [companyId, roleId],
  );
  return rows.map((row) => row.code);
}

// Los permisos (códigos) que tiene un usuario en la empresa: los de todos sus roles activos. Vacío si no
// tiene ninguna membresía activa.
export async function permissionCodesOfUser(
  manager: EntityManager,
  companyId: string,
  userId: string,
): Promise<string[]> {
  const rows: { code: string }[] = await manager.query(
    `SELECT DISTINCT p."code" FROM "user_company_roles" ucr
     JOIN "roles" r ON r."id" = ucr."roleId" AND r."status" = 'ACTIVE'
     JOIN "role_permissions" rp ON rp."roleId" = r."id" AND rp."companyId" = ucr."companyId"
     JOIN "permissions" p ON p."id" = rp."permissionId" AND p."status" = 'ACTIVE'
     WHERE ucr."companyId" = $1 AND ucr."userId" = $2 AND ucr."status" = 'ACTIVE'`,
    [companyId, userId],
  );
  return rows.map((row) => row.code);
}

// "Solo das lo que tienes": quien administra usuarios o la configuración no puede dar (ni tocar a quien
// tiene) permisos que él mismo no tiene. Sin esto, un rol delegado con users.manage podía darse el rol
// de administrador o restablecer la contraseña de uno y entrar como él.
export function assertHoldsPermissions(
  actorPermissionCodes: string[],
  permissionCodes: string[],
  message: string,
): void {
  const held = new Set(actorPermissionCodes);
  if (permissionCodes.some((code) => !held.has(code))) {
    throw new ForbiddenException(message);
  }
}
