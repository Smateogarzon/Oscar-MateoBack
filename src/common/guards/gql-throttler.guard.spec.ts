import type { ExecutionContext } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import { GqlThrottlerGuard } from './gql-throttler.guard.js';

describe('GqlThrottlerGuard', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('extracts req and res from the GraphQL execution context instead of the HTTP one', () => {
    const req = { ip: '127.0.0.1' };
    const res = { header: vi.fn() };

    vi.spyOn(GqlExecutionContext, 'create').mockReturnValue({
      getContext: () => ({ req, res }),
    } as unknown as GqlExecutionContext);

    const guard = new GqlThrottlerGuard({} as never, {} as never, {} as never);

    // getRequestResponse is protected; we access it directly to unit-test it in isolation.
    const result = (guard as any).getRequestResponse({} as ExecutionContext);

    expect(result).toEqual({ req, res });
  });
});
