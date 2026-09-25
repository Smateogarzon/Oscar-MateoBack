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

export const AUTH_ONLY_KEY = 'auth-only';

// La operación solo necesita una sesión válida, sin empresa ni permisos (por ejemplo `me`): se marca a
// propósito. PermissionsGuard es "cerrado por defecto": una operación con PermissionsGuard que no lleva
// ninguna regla NI esta marca se rechaza, así una operación nueva a la que se le olvide la regla no queda
// abierta a cualquier usuario con sesión.
export const AuthOnly = () => SetMetadata(AUTH_ONLY_KEY, true);

// No pide ningún permiso, pero sí ser miembro activo de la empresa con la que se trabaja: así
// una lectura queda acotada a esa empresa en vez de quedar abierta a cualquier sesión.
export const RequireCompanyMembership = () =>
  SetMetadata<string, AccessRule>(ACCESS_RULE_KEY, { mode: 'all', permissions: [] });
