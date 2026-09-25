import type { ExecutionContext } from '@nestjs/common';
import { GqlThrottlerGuard } from './gql-throttler.guard.js';

// Un contexto de GraphQL con la operación indicada: root, args, context e info, en ese orden.
const graphqlContext = (operation: string) =>
  ({
    getType: () => 'graphql',
    getArgs: () => [{}, {}, {}, { operation: { operation } }],
    getClass: () => GqlThrottlerGuard,
    getHandler: () => () => undefined,
  }) as unknown as ExecutionContext;

// El guard se crea sin su constructor: shouldSkip no usa nada de lo que ese recibe.
const shouldSkip = (context: ExecutionContext): Promise<boolean> => {
  const guard = Object.create(GqlThrottlerGuard.prototype) as {
    shouldSkip(context: ExecutionContext): Promise<boolean>;
  };
  return guard.shouldSkip(context);
};

describe('GqlThrottlerGuard.shouldSkip', () => {
  it('does not count a subscription: it opens a connection that stays open, and it has no HTTP response to write to', async () => {
    expect(await shouldSkip(graphqlContext('subscription'))).toBe(true);
  });

  it.each(['query', 'mutation'])('still counts a %s', async (operation) => {
    expect(await shouldSkip(graphqlContext(operation))).toBe(false);
  });

  it('still counts what is not GraphQL, like the upload endpoint', async () => {
    const http = { getType: () => 'http' } as unknown as ExecutionContext;

    expect(await shouldSkip(http)).toBe(false);
  });
});
