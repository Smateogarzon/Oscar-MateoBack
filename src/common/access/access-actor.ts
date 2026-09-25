import type { CompanyAccess } from './company-access.js';

// Quién hace un cambio a usuarios, roles o permisos y qué puede hacer en la empresa activa. Los
// servicios lo usan para no dejar que alguien se dé a sí mismo (o a otro) más de lo que él tiene y para
// que nadie se quite el acceso a sí mismo por accidente.
export interface AccessActor {
  userId: string;
  permissionCodes: string[];
}

export function accessActor(userId: string, access: CompanyAccess): AccessActor {
  return { userId, permissionCodes: access.permissionCodes };
}
