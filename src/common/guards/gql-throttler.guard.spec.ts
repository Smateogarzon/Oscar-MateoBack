import type { ExecutionContext } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import { GqlThrottlerGuard } from './gql-throttler.guard.js';

function createGuard() {
  return new GqlThrottlerGuard({} as never, {} as never, {} as never);
}

describe('GqlThrottlerGuard', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('extracts req and res from the GraphQL context for GraphQL requests', () => {
    const req = { ip: '127.0.0.1' };
    const res = { header: vi.fn() };

    vi.spyOn(GqlExecutionContext, 'create').mockReturnValue({
      getContext: () => ({ req, res }),
    } as unknown as GqlExecutionContext);

    const context = { getType: () => 'graphql' } as unknown as ExecutionContext;

    // getRequestResponse es protected; se accede directo para probarlo aislado.
    const result = (createGuard() as any).getRequestResponse(context);

    expect(result).toEqual({ req, res });
  });

  it('extracts req and res from the HTTP context for REST requests', () => {
    const req = { ip: '127.0.0.1' };
    const res = { header: vi.fn() };

    const context = {
      getType: () => 'http',
      switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
    } as unknown as ExecutionContext;

    const result = (createGuard() as any).getRequestResponse(context);

    expect(result).toEqual({ req, res });
  });
});
