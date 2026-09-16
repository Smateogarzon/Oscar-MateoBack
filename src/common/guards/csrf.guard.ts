import { Injectable, UnauthorizedException, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { CSRF_COOKIE, CSRF_HEADER } from '../../graphql/auth/auth-cookie.constants.js';
import { getRequestFromContext } from '../utils/request-from-context.util.js';

@Injectable()
export class CsrfGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = getRequestFromContext(context);
    const cookieToken: string | undefined = req.cookies?.[CSRF_COOKIE];
    const headerValue = req.headers[CSRF_HEADER];
    const headerToken = Array.isArray(headerValue) ? headerValue[0] : headerValue;

    if (!cookieToken || !headerToken || cookieToken !== headerToken) {
      throw new UnauthorizedException('Token CSRF inválido o ausente');
    }

    return true;
  }
}
