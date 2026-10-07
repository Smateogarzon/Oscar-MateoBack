import { AsyncLocalStorage } from 'node:async_hooks';

export interface AuditActor {
  userId?: string;
  companyId?: string;
}

// Nada en el proyecto propaga todavía quién hace una petición más allá de sus parámetros
// explícitos (@CurrentUser()/@CurrentCompanyId()). AuditContextInterceptor llena esto una vez por
// petición; AuditLogSubscriber lo lee para saber quién disparó un cambio que no pasó por un
// resolver que reciba el actor como argumento.
export const auditContextStorage = new AsyncLocalStorage<AuditActor>();

export function currentAuditActor(): AuditActor {
  return auditContextStorage.getStore() ?? {};
}
