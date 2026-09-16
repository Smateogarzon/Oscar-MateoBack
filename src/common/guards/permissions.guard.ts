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
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator.js';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredPermissions = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredPermissions || requiredPermissions.length === 0) return true;

    const req = GqlExecutionContext.create(context).getContext().req;
    const user: JwtPayload | undefined = req.user;
    if (!user) throw new UnauthorizedException();

    const hasAllPermissions = requiredPermissions.every((permission) =>
      user.permissionCodes.includes(permission),
    );
    if (!hasAllPermissions) {
      throw new ForbiddenException('No tienes los permisos requeridos para esta operación');
    }

    return true;
  }
}
