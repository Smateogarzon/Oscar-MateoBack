import { Plugin } from '@nestjs/apollo';
import type {
  ApolloServerPlugin,
  BaseContext,
  GraphQLRequestListener,
} from '@apollo/server';
import { PinoLogger } from 'nestjs-pino';

@Plugin()
export class GraphqlLoggingPlugin implements ApolloServerPlugin<BaseContext> {
  constructor(private readonly logger: PinoLogger) {
    this.logger.setContext('GraphQL');
  }

  async requestDidStart(): Promise<GraphQLRequestListener<BaseContext>> {
    const startedAt = Date.now();

    return {
      willSendResponse: async (requestContext) => {
        const operationType =
          requestContext.operation?.operation ?? 'operation';
        const operationName = requestContext.operationName ?? 'anonymous';
        const durationMs = Date.now() - startedAt;
        const failed = Boolean(requestContext.errors?.length);

        const message = `${operationType} ${operationName} ${failed ? 'failed' : 'ok'} ${durationMs}ms`;

        if (failed) {
          this.logger.warn({ errors: requestContext.errors }, message);
        } else {
          this.logger.info(message);
        }
      },
    };
  }
}
