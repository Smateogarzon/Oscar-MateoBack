import { Injectable, type ExecutionContext } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import { ThrottlerGuard } from '@nestjs/throttler';

@Injectable()
export class GqlThrottlerGuard extends ThrottlerGuard {
  protected override getRequestResponse(context: ExecutionContext) {
    const gqlCtx = GqlExecutionContext.create(context).getContext();
    return { req: gqlCtx.req, res: gqlCtx.res };
  }
}
