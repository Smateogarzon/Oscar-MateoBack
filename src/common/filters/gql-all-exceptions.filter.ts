import { ArgumentsHost, Catch, HttpException, Logger } from '@nestjs/common';
import type { GqlExceptionFilter } from '@nestjs/graphql';
import { GraphQLError } from 'graphql';

@Catch()
export class GqlAllExceptionsFilter implements GqlExceptionFilter {
  private readonly logger = new Logger(GqlAllExceptionsFilter.name);

  catch(exception: unknown, _host: ArgumentsHost) {
    if (exception instanceof GraphQLError) {
      return exception;
    }

    if (exception instanceof HttpException) {
      return new GraphQLError(exception.message, {
        extensions: {
          code: exception.constructor.name,
          status: exception.getStatus(),
        },
      });
    }

    this.logger.error(exception instanceof Error ? exception.stack : exception);

    const isProd = process.env.NODE_ENV === 'production';
    return new GraphQLError(
      isProd
        ? 'Internal server error'
        : ((exception as Error)?.message ?? 'Unknown error'),
      { extensions: { code: 'INTERNAL_SERVER_ERROR' } },
    );
  }
}
