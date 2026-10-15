import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { firstValueFrom, Observable } from 'rxjs';
import { currentAuditActor } from './audit-context.js';
import { AuditContextInterceptor } from './audit-context.interceptor.js';

function httpContext(req: Record<string, unknown>): ExecutionContext {
  return {
    getType: () => 'http',
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => ({}) }),
  } as never;
}

function graphqlContext(req: Record<string, unknown>, operation = 'mutation'): ExecutionContext {
  const gqlContext = { req };
  const info = { operation: { operation } };
  return {
    getType: () => 'graphql',
    getArgs: () => [undefined, undefined, gqlContext, info],
    getClass: () => class Dummy {},
    getHandler: () => function dummyHandler() {},
  } as never;
}

// Observable que solo entrega su valor tras un macrotask real (setTimeout), para probar que el
// contexto sigue visible más allá de la llamada síncrona que arranca la petición — que es
// exactamente lo que se rompería si el interceptor solo envolviera la CONSTRUCCIÓN del Observable
// en vez de su suscripción (ver el comentario en audit-context.interceptor.ts).
function asyncHandlerReading(capture: { actor?: unknown }): CallHandler {
  return {
    handle: () =>
      new Observable((subscriber) => {
        setTimeout(() => {
          capture.actor = currentAuditActor();
          subscriber.next('ok');
          subscriber.complete();
        }, 0);
      }),
  };
}

describe('AuditContextInterceptor', () => {
  it('makes req.user/req.companyAccess visible, by async boundaries, to code that runs during the request', async () => {
    const interceptor = new AuditContextInterceptor();
    const req = { user: { sub: 'user-1' }, companyAccess: { companyId: 'company-1' } };
    const capture: { actor?: unknown } = {};

    const result = await firstValueFrom(
      interceptor.intercept(httpContext(req), asyncHandlerReading(capture)),
    );

    expect(result).toBe('ok');
    expect(capture.actor).toEqual({ userId: 'user-1', companyId: 'company-1' });
  });

  it('stamps an empty actor when the request never authenticated (e.g. login itself)', async () => {
    const interceptor = new AuditContextInterceptor();
    const capture: { actor?: unknown } = {};

    await firstValueFrom(interceptor.intercept(httpContext({}), asyncHandlerReading(capture)));

    expect(capture.actor).toEqual({ userId: undefined, companyId: undefined });
  });

  it('reads the actor the same way for a GraphQL mutation', async () => {
    const interceptor = new AuditContextInterceptor();
    const req = { user: { sub: 'user-2' }, companyAccess: { companyId: 'company-2' } };
    const capture: { actor?: unknown } = {};

    await firstValueFrom(
      interceptor.intercept(graphqlContext(req, 'mutation'), asyncHandlerReading(capture)),
    );

    expect(capture.actor).toEqual({ userId: 'user-2', companyId: 'company-2' });
  });

  it('passes a GraphQL subscription straight through, without touching the audit context', async () => {
    const interceptor = new AuditContextInterceptor();
    const req = { user: { sub: 'user-3' }, companyAccess: { companyId: 'company-3' } };
    const capture: { actor?: unknown } = {};
    let handleCalls = 0;
    const next: CallHandler = {
      handle: () => {
        handleCalls += 1;
        capture.actor = currentAuditActor();
        return new Observable((subscriber) => {
          subscriber.next('event-1');
          subscriber.complete();
        });
      },
    };

    const result = await firstValueFrom(
      interceptor.intercept(graphqlContext(req, 'subscription'), next),
    );

    expect(result).toBe('event-1');
    expect(handleCalls).toBe(1);
    // Nunca se envolvió en auditContextStorage.run(...): fuera de una petición normal no hay actor.
    expect(capture.actor).toEqual({});
  });
});
