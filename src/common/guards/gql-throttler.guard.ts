import { Injectable, type ExecutionContext } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import { ThrottlerGuard } from '@nestjs/throttler';
import { getRequestFromContext, getResponseFromContext } from '../utils/request-from-context.util.js';

@Injectable()
export class GqlThrottlerGuard extends ThrottlerGuard {
  protected override getRequestResponse(context: ExecutionContext) {
    return { req: getRequestFromContext(context), res: getResponseFromContext(context) };
  }

  // El límite cuenta peticiones HTTP y escribe sus encabezados en la respuesta. Una suscripción no es
  // una petición que se repita: abre una conexión y la deja abierta, y no tiene respuesta HTTP donde
  // escribir. Su tope es otro: cuántas conexiones abiertas puede tener una persona (ver
  // MAX_STREAMS_PER_USER).
  protected override async shouldSkip(context: ExecutionContext): Promise<boolean> {
    if (context.getType<'http' | 'graphql'>() === 'graphql') {
      const info = GqlExecutionContext.create(context).getInfo();
      if (info?.operation?.operation === 'subscription') return true;
    }
    return super.shouldSkip(context);
  }
}
