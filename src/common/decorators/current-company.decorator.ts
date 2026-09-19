import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { CompanyAccess } from '../access/company-access.js';
import { getRequestFromContext } from '../utils/request-from-context.util.js';

// Solo existe en operaciones marcadas con @RequirePermissions(), @RequireAnyPermission() o
// @RequireCompanyMembership(): sin una de ellas no hay quien valide la empresa.
function companyAccessFrom(context: ExecutionContext): CompanyAccess {
  const access = getRequestFromContext(context).companyAccess;
  if (!access) {
    throw new Error(
      'La empresa activa solo está disponible en operaciones con una regla de acceso (@RequirePermissions, @RequireAnyPermission o @RequireCompanyMembership)',
    );
  }
  return access;
}

// Empresa con la que el usuario está trabajando, ya validada por PermissionsGuard.
export const CurrentCompanyId = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string => companyAccessFrom(context).companyId,
);

// Lo que el usuario puede hacer en esa empresa (roles y permisos), ya validado.
export const CurrentCompanyAccess = createParamDecorator(
  (_data: unknown, context: ExecutionContext): CompanyAccess => companyAccessFrom(context),
);
