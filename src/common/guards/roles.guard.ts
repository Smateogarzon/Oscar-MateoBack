import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { GqlExecutionContext } from '@nestjs/graphql';
import type { JwtPayload } from '../../graphql/auth/interface/jwt-payload.interface.js';
import { ROLES_KEY } from '../decorators/roles.decorator.js';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredRoles || requiredRoles.length === 0) return true;

    const req = GqlExecutionContext.create(context).getContext().req;
    const user: JwtPayload | undefined = req.user;
    if (!user) throw new UnauthorizedException();

    const hasRole = requiredRoles.some((role) => user.roleCodes.includes(role));
    if (!hasRole) {
      throw new ForbiddenException('No tienes el rol requerido para esta operación');
    }

    return true;
  }
}
