import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { DataSource } from 'typeorm';
import { ACCESS_TOKEN_COOKIE } from '../../graphql/auth/auth-cookie.constants.js';
import type { JwtPayload } from '../../graphql/auth/interface/jwt-payload.interface.js';
import { User } from '../../graphql/user/entities/user.entity.js';
import { SKIP_MUST_CHANGE_PASSWORD_KEY } from '../decorators/skip-must-change-password.decorator.js';
import { RecordStatus } from '../enums/record-status.enum.js';
import { getRequestFromContext } from '../utils/request-from-context.util.js';

const BEARER_PREFIX = 'Bearer ';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly reflector: Reflector,
    private readonly dataSource: DataSource,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = getRequestFromContext(context);
    const authHeader: string | undefined = req.headers.authorization;
    const token: string | undefined =
      req.cookies?.[ACCESS_TOKEN_COOKIE] ??
      (authHeader?.startsWith(BEARER_PREFIX)
        ? authHeader.slice(BEARER_PREFIX.length)
        : undefined);

    if (!token) {
      throw new UnauthorizedException('No hay sesión activa');
    }

    let payload: JwtPayload;
    try {
      payload = this.jwtService.verify<JwtPayload>(token);
    } catch {
      throw new UnauthorizedException('Token inválido o expirado');
    }

    const user = await this.dataSource
      .getRepository(User)
      .findOneBy({ id: payload.sub });

    if (!user || user.status !== RecordStatus.ACTIVE) {
      throw new UnauthorizedException('La cuenta no está activa');
    }

    // Una sesión abierta antes del último cambio de contraseña ya no vale (el token trae la fecha de
    // emisión en segundos; se compara por segundos para que la sesión que se renueva justo al cambiar la
    // clave, en el mismo segundo, siga valiendo).
    if (
      user.passwordChangedAt &&
      (payload.iat ?? 0) < Math.floor(user.passwordChangedAt.getTime() / 1000)
    ) {
      throw new UnauthorizedException('Tu contraseña cambió: vuelve a iniciar sesión');
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
