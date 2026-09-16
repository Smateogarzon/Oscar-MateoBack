import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { GqlExecutionContext } from '@nestjs/graphql';
import { JwtService } from '@nestjs/jwt';
import { DataSource } from 'typeorm';
import type { JwtPayload } from '../../graphql/auth/interface/jwt-payload.interface.js';
import { User } from '../../graphql/user/entities/user.entity.js';
import { SKIP_MUST_CHANGE_PASSWORD_KEY } from '../decorators/skip-must-change-password.decorator.js';
import { RecordStatus } from '../enums/record-status.enum.js';

const BEARER_PREFIX = 'Bearer ';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly reflector: Reflector,
    private readonly dataSource: DataSource,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = GqlExecutionContext.create(context).getContext().req;
    const authHeader: string | undefined = req.headers.authorization;

    if (!authHeader?.startsWith(BEARER_PREFIX)) {
      throw new UnauthorizedException(
        'Falta el header Authorization con el token',
      );
    }

    let payload: JwtPayload;
    try {
      payload = this.jwtService.verify<JwtPayload>(
        authHeader.slice(BEARER_PREFIX.length),
      );
    } catch {
      throw new UnauthorizedException('Token inválido o expirado');
    }

    const user = await this.dataSource
      .getRepository(User)
      .findOneBy({ id: payload.sub });

    if (!user || user.status !== RecordStatus.ACTIVE) {
      throw new UnauthorizedException('La cuenta no está activa');
    }

    const skipsPasswordCheck = this.reflector.getAllAndOverride<boolean>(
      SKIP_MUST_CHANGE_PASSWORD_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (user.mustChangePassword && !skipsPasswordCheck) {
      throw new ForbiddenException(
        'Debes cambiar tu contraseña antes de continuar',
      );
    }

    req.user = payload;
    return true;
  }
}
