import type { ExecutionContext } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import type { Request } from 'express';

// Los guards de auth/CSRF se reutilizan en resolvers GraphQL y en el controller
// REST de subida de archivos: cada tipo de contexto guarda el Request en un lugar
// distinto, así que hay que resolverlo según de dónde viene la petición.
export function getRequestFromContext(context: ExecutionContext): Request {
  if (context.getType<'http' | 'graphql'>() === 'graphql') {
    return GqlExecutionContext.create(context).getContext().req;
  }
  return context.switchToHttp().getRequest();
}
