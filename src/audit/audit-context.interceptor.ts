import {
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import { firstValueFrom, from, type Observable } from 'rxjs';
import { getRequestFromContext } from '../common/utils/request-from-context.util.js';
import { auditContextStorage, type AuditActor } from './audit-context.js';

// Una suscripción (notificationEvents) solo entrega eventos que YA generó otra petición: nunca
// escribe nada ella misma. Envolverla aquí no aportaría nada y arriesga su ciclo de vida, que es
// distinto al de una query/mutation (no termina en un solo valor).
function isGraphQLSubscription(context: ExecutionContext): boolean {
  if (context.getType<'http' | 'graphql'>() !== 'graphql') return false;
  const info = GqlExecutionContext.create(context).getInfo<{
    operation?: { operation?: string };
  }>();
  return info?.operation?.operation === 'subscription';
}

// Global (ver AppModule): deja quién hace la petición y en qué empresa disponible para todo lo
// que corra durante ella, incluido AuditLogSubscriber (que no recibe el request). Va después de
// los guards (JwtAuthGuard/PermissionsGuard ya resolvieron req.user/req.companyAccess cuando
// corre un interceptor), así que solo lee lo que ya quedó puesto ahí, no lo calcula de nuevo.
//
// El manejo de la petición debe arrancar DENTRO de auditContextStorage.run(...) para que el
// contexto llegue por async a todo lo que se dispare después (incluidas las consultas a la base
// de datos y el subscriber de TypeORM); por eso se suscribe aquí mismo con firstValueFrom en vez
// de solo envolver la construcción del Observable.
@Injectable()
export class AuditContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (isGraphQLSubscription(context)) return next.handle();

    const req = getRequestFromContext(context);
    const actor: AuditActor = {
      userId: req?.user?.sub,
      companyId: req?.companyAccess?.companyId,
    };
    return from(auditContextStorage.run(actor, () => firstValueFrom(next.handle())));
  }
}
