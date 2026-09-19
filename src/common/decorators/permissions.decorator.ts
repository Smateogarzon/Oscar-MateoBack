import { SetMetadata } from '@nestjs/common';
import type { PermissionCode } from '../enums/permission-code.enum.js';

export const ACCESS_RULE_KEY = 'access-rule';

// Qué exige una operación para dejar pasar al usuario, dentro de la empresa con la que
// trabaja (encabezado x-company-id). Lo verifica PermissionsGuard, que debe ir después de
// JwtAuthGuard.
export interface AccessRule {
  mode: 'all' | 'any';
  permissions: PermissionCode[];
}

// Exige TODOS estos permisos.
export const RequirePermissions = (...permissions: PermissionCode[]) =>
  SetMetadata<string, AccessRule>(ACCESS_RULE_KEY, { mode: 'all', permissions });

// Basta con UNO de estos permisos: para lecturas que comparten varias pantallas (el catálogo
// de permisos lo usan Usuarios y Configuración).
export const RequireAnyPermission = (...permissions: PermissionCode[]) =>
  SetMetadata<string, AccessRule>(ACCESS_RULE_KEY, { mode: 'any', permissions });

// No pide ningún permiso, pero sí ser miembro activo de la empresa con la que se trabaja: así
// una lectura queda acotada a esa empresa en vez de quedar abierta a cualquier sesión.
export const RequireCompanyMembership = () =>
  SetMetadata<string, AccessRule>(ACCESS_RULE_KEY, { mode: 'all', permissions: [] });
