import { In, type DataSource } from 'typeorm';
import { CompanyStatus } from '../../graphql/company/entities/company-status.enum.js';
import { Company } from '../../graphql/company/entities/company.entity.js';
import { RolePermission } from '../../graphql/role-permission/entities/role-permission.entity.js';
import { UserCompanyRole } from '../../graphql/user-company-role/entities/user-company-role.entity.js';
import { RecordStatus } from '../enums/record-status.enum.js';
import { isPlatformRole } from './platform-role.js';

// Lo que un usuario puede hacer dentro de UNA empresa.
export interface CompanyAccess {
  companyId: string;
  roleCodes: string[];
  permissionCodes: string[];
}

// Los roles son los mismos en todas las empresas, pero cada empresa decide qué permisos
// tiene cada uno (role_permissions.companyId): que una le dé de más a un rol no afecta a
// las demás. Devuelve null si el usuario no es miembro activo de la empresa.
// Se consulta en cada petición, así un cambio de roles o permisos aplica de inmediato.
export async function loadCompanyAccess(
  dataSource: DataSource,
  userId: string,
  companyId: string,
): Promise<CompanyAccess | null> {
  const memberships = await dataSource.getRepository(UserCompanyRole).find({
    where: { userId, companyId, status: RecordStatus.ACTIVE },
    relations: { role: true },
  });
  if (memberships.length === 0) return null;

  // Una empresa suspendida o inactiva no opera: sin esto, "suspender" una empresa solo la ocultaba del
  // selector y quienes ya tenían sesión (o mandaban la cabecera x-company-id) seguían vendiendo. El rol
  // de plataforma sí pasa: es quien la administra.
  const isPlatformMember = memberships.some((membership) => isPlatformRole(membership.role));
  if (!isPlatformMember) {
    const companyActive = await dataSource
      .getRepository(Company)
      .existsBy({ id: companyId, status: CompanyStatus.ACTIVE });
    if (!companyActive) return null;
  }

  const roles = memberships
    .map((membership) => membership.role)
    .filter((role) => role.status === RecordStatus.ACTIVE);

  const rolePermissions =
    roles.length === 0
      ? []
      : await dataSource.getRepository(RolePermission).find({
          where: { companyId, roleId: In(roles.map((role) => role.id)) },
          relations: { permission: true },
        });

  const permissionCodes = new Set(
    rolePermissions
      .filter((rolePermission) => rolePermission.permission.status === RecordStatus.ACTIVE)
      .map((rolePermission) => rolePermission.permission.code),
  );

  return {
    companyId,
    roleCodes: roles.map((role) => role.code),
    permissionCodes: [...permissionCodes],
  };
}
