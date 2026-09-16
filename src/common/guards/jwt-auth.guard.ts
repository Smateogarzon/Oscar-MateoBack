import { Injectable, UnauthorizedException, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import { JwtService } from '@nestjs/jwt';
import type { JwtPayload } from '../../graphql/auth/interface/jwt-payload.interface.js';

const BEARER_PREFIX = 'Bearer ';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = GqlExecutionContext.create(context).getContext().req;
    const authHeader: string | undefined = req.headers.authorization;

    if (!authHeader?.startsWith(BEARER_PREFIX)) {
      throw new UnauthorizedException('Falta el header Authorization con el token');
    }

    const token = authHeader.slice(BEARER_PREFIX.length);

    try {
      req.user = this.jwtService.verify<JwtPayload>(token);
    } catch {
      throw new UnauthorizedException('Token inválido o expirado');
    }

    return true;
  }
}
