import { ArgumentsHost, Catch, HttpException, Logger } from '@nestjs/common';
import type { GqlExceptionFilter } from '@nestjs/graphql';
import type { Response } from 'express';
import { GraphQLError } from 'graphql';
import { QueryFailedError } from 'typeorm';

// Postgres "invalid_text_representation": lo que pasa cuando un id que no es un uuid llega a una
// consulta. Es un error del cliente, no del servidor.
const INVALID_TEXT_REPRESENTATION = '22P02';

// Único filtro de excepciones de la app. Atiende dos tipos de petición:
//  - GraphQL: devuelve un GraphQLError (nada se escribe en la respuesta: lo hace Apollo);
//  - HTTP (subida de imágenes, firma de QZ, rutas que no existen): tiene que ESCRIBIR la respuesta.
//    Un filtro personalizado reemplaza al de Nest, que era el que respondía: si aquí solo se
//    devolviera un GraphQLError, la petición se quedaría abierta para siempre (el front esperando y
//    los escáneres de internet colgados en el servidor).
@Catch()
export class GqlAllExceptionsFilter implements GqlExceptionFilter {
  private readonly logger = new Logger(GqlAllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    if (host.getType() === 'http') {
      this.replyHttp(exception, host);
      return;
    }
    return this.toGraphQLError(exception);
  }

  private replyHttp(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    // Si la respuesta ya empezó a enviarse no hay nada más que decir.
    if (response.headersSent) return;

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      response.status(status).json(typeof body === 'string' ? { statusCode: status, message: body } : body);
      return;
    }

    this.logger.error(exception instanceof Error ? exception.stack : exception);
    response.status(500).json({
      statusCode: 500,
      message: this.isProduction() ? 'Internal server error' : ((exception as Error)?.message ?? 'Unknown error'),
    });
  }

  private toGraphQLError(exception: unknown): GraphQLError {
    if (exception instanceof GraphQLError) {
      return exception;
    }

    if (exception instanceof HttpException) {
      const response = exception.getResponse();
      const responseMessage =
        typeof response === 'string' ? response : (response as { message?: string | string[] }).message;
      const message = Array.isArray(responseMessage)
        ? responseMessage.join(', ')
        : (responseMessage ?? exception.message);

      return new GraphQLError(message, {
        extensions: {
          code: exception.constructor.name,
          status: exception.getStatus(),
        },
      });
    }

    // Un id o un valor con formato inválido (p. ej. un uuid mal escrito) es culpa de quien lo mandó:
    // se responde como tal, sin volcar un stack a los logs en cada intento.
    if (
      exception instanceof QueryFailedError &&
      (exception.driverError as { code?: string } | undefined)?.code === INVALID_TEXT_REPRESENTATION
    ) {
      this.logger.warn(`Valor con formato inválido en una consulta: ${exception.message}`);
      return new GraphQLError('El identificador o el valor enviado no tiene un formato válido', {
        extensions: { code: 'BAD_USER_INPUT', status: 400 },
      });
    }

    this.logger.error(exception instanceof Error ? exception.stack : exception);

    return new GraphQLError(
      this.isProduction() ? 'Internal server error' : ((exception as Error)?.message ?? 'Unknown error'),
      { extensions: { code: 'INTERNAL_SERVER_ERROR' } },
    );
  }

  private isProduction(): boolean {
    return process.env.NODE_ENV === 'production';
  }
}
