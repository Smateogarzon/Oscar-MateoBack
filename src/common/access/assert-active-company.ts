import { ForbiddenException } from '@nestjs/common';

// Las operaciones que reciben una empresa (como argumento o dentro del input) solo pueden
// apuntar a la empresa con la que el usuario está trabajando: sus permisos se verificaron en
// esa, no en la que venga escrita en la petición.
export function assertActiveCompany(
  activeCompanyId: string,
  requestedCompanyId?: string | null,
): void {
  if (requestedCompanyId && requestedCompanyId.toLowerCase() !== activeCompanyId.toLowerCase()) {
    throw new ForbiddenException('No puedes operar sobre otra empresa');
  }
}
