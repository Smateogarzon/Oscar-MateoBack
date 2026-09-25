import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { isUUID } from 'class-validator';
import { DataSource } from 'typeorm';
import { COMPANY_HEADER } from '../../graphql/auth/auth-cookie.constants.js';
import { loadCompanyAccess } from '../access/company-access.js';
import {
  ACCESS_RULE_KEY,
  AUTH_ONLY_KEY,
  type AccessRule,
} from '../decorators/permissions.decorator.js';
import { getRequestFromContext } from '../utils/request-from-context.util.js';

// Deja pasar solo si el usuario cumple la regla de acceso de la operación (ver
// permissions.decorator.ts) en la empresa indicada en el encabezado x-company-id. La empresa
// se valida contra la base, no se confía en el encabezado: si el usuario no es miembro de
// ella, se rechaza. Debe ir después de JwtAuthGuard, que es quien identifica al usuario.
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly dataSource: DataSource,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    const rule = this.reflector.getAllAndOverride<AccessRule | undefined>(ACCESS_RULE_KEY, targets);
    if (!rule) {
      // Cerrado por defecto: sin regla, solo pasa lo que se marcó a propósito como "solo sesión".
      if (this.reflector.getAllAndOverride<boolean | undefined>(AUTH_ONLY_KEY, targets)) return true;
      throw new ForbiddenException('Esta operación no tiene una regla de acceso definida');
    }

    const req = getRequestFromContext(context);
    const user = req.user;
    if (!user) throw new UnauthorizedException();

    const companyId = req.headers[COMPANY_HEADER];
    if (typeof companyId !== 'string' || !isUUID(companyId)) {
      throw new BadRequestException('Falta indicar la empresa con la que estás trabajando');
    }

    const access = await loadCompanyAccess(this.dataSource, user.sub, companyId);
    if (!access) {
      throw new ForbiddenException('No perteneces a esta empresa');
    }

    const has = (permission: string) => access.permissionCodes.includes(permission);
    const granted = rule.mode === 'all' ? rule.permissions.every(has) : rule.permissions.some(has);
    if (!granted) {
      throw new ForbiddenException('No tienes los permisos requeridos para esta operación');
    }

    req.companyAccess = access;
    return true;
  }
}
