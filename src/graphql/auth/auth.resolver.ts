import { UseGuards } from '@nestjs/common';
import { Args, Context, Mutation, Query, Resolver } from '@nestjs/graphql';
import { seconds, Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import type { CompanyAccess } from '../../common/access/company-access.js';
import { CurrentCompanyAccess } from '../../common/decorators/current-company.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { RequireCompanyMembership } from '../../common/decorators/permissions.decorator.js';
import { SkipMustChangePassword } from '../../common/decorators/skip-must-change-password.decorator.js';
import { CsrfGuard } from '../../common/guards/csrf.guard.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../common/guards/permissions.guard.js';
import { ChangePasswordInput } from '../user/dto/change-password.input.js';
import { UserObjectType } from '../user/dto/user.object-type.js';
import { UserService } from '../user/user.service.js';
import { AuthService } from './auth.service.js';
import { AuthPayload } from './dto/auth-payload.object-type.js';
import { CompanyAccessObjectType } from './dto/company-access.object-type.js';
import { LoginInput } from './dto/login.input.js';
import type { JwtPayload } from './interface/jwt-payload.interface.js';
import { clearSessionCookies, setSessionCookies } from './session-cookies.js';

interface GqlContext {
  req: Request;
  res: Response;
}

@Resolver()
export class AuthResolver {
  constructor(
    private readonly authService: AuthService,
    private readonly userService: UserService,
  ) {}

  // Límite propio del inicio de sesión: 20 por minuto desde una misma IP (las terminales de una tienda
  // comparten IP y todos entran a la hora de abrir), aparte del bloqueo por correo de AuthService.
  @Throttle({ default: { limit: 20, ttl: seconds(60) } })
  @Mutation(() => AuthPayload)
  async login(
    @Args('input') input: LoginInput,
    @Context() context: GqlContext,
  ): Promise<AuthPayload> {
    const { accessToken, user, isAdmin } = await this.authService.login(input, context.req?.ip);
    setSessionCookies(context.res, accessToken, isAdmin);
    return { user };
  }

  // Roles y permisos del usuario en la empresa con la que trabaja (x-company-id), leídos de
  // la base en el momento: reflejan los cambios de la configuración sin volver a entrar.
  @Query(() => CompanyAccessObjectType)
  @UseGuards(JwtAuthGuard, PermissionsGuard, CsrfGuard)
  @RequireCompanyMembership()
  myAccess(@CurrentCompanyAccess() access: CompanyAccess): CompanyAccessObjectType {
    return access;
  }

  // El usuario cambia su propia contraseña. Las demás sesiones de la cuenta dejan de valer (el servicio
  // anota `passwordChangedAt`), pero la de quien la cambia se renueva aquí mismo con un token nuevo: si no,
  // acabaría de cambiar la clave y la siguiente petición lo sacaría al login.
  @Mutation(() => UserObjectType)
  @UseGuards(JwtAuthGuard, CsrfGuard)
  @SkipMustChangePassword()
  async changePassword(
    @CurrentUser() currentUser: JwtPayload,
    @Args('input') input: ChangePasswordInput,
    @Context() context: GqlContext,
  ) {
    const user = await this.userService.changePassword(currentUser.sub, input);
    const { accessToken, isAdmin } = await this.authService.issueSession(user);
    setSessionCookies(context.res, accessToken, isAdmin);
    return user;
  }

  @Mutation(() => Boolean)
  @UseGuards(JwtAuthGuard, CsrfGuard)
  @SkipMustChangePassword()
  logout(@Context() context: GqlContext) {
    clearSessionCookies(context.res);
    return this.authService.logout();
  }
}
