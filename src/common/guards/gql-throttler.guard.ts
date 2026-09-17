import { Injectable, type ExecutionContext } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { getRequestFromContext, getResponseFromContext } from '../utils/request-from-context.util.js';

@Injectable()
export class GqlThrottlerGuard extends ThrottlerGuard {
  protected override getRequestResponse(context: ExecutionContext) {
    return { req: getRequestFromContext(context), res: getResponseFromContext(context) };
  }
}
