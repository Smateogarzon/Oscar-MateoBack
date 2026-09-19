import { randomBytes } from 'node:crypto';
import { UseGuards } from '@nestjs/common';
import { Args, Context, Mutation, Query, Resolver } from '@nestjs/graphql';
import type { CookieOptions, Response } from 'express';
import type { CompanyAccess } from '../../common/access/company-access.js';
import { CurrentCompanyAccess } from '../../common/decorators/current-company.decorator.js';
import { RequireCompanyMembership } from '../../common/decorators/permissions.decorator.js';
import { SkipMustChangePassword } from '../../common/decorators/skip-must-change-password.decorator.js';
import { CsrfGuard } from '../../common/guards/csrf.guard.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../common/guards/permissions.guard.js';
import {
  ACCESS_TOKEN_COOKIE,
  ADMIN_TOKEN_TTL_MS,
  CSRF_COOKIE,
  DEFAULT_TOKEN_TTL_MS,
} from './auth-cookie.constants.js';
import { AuthService } from './auth.service.js';
import { AuthPayload } from './dto/auth-payload.object-type.js';
import { CompanyAccessObjectType } from './dto/company-access.object-type.js';
import { LoginInput } from './dto/login.input.js';

// En local queda sin definir (localhost comparte cookies entre puertos); en producción es
// el dominio principal, para que la cookie CSRF sea visible también desde el front.
const COOKIE_DOMAIN = process.env.COOKIE_DOMAIN || undefined;

interface GqlContext {
  res: Response;
}

@Resolver()
export class AuthResolver {
  constructor(private readonly authService: AuthService) {}

  @Mutation(() => AuthPayload)
  async login(
    @Args('input') input: LoginInput,
    @Context() context: GqlContext,
  ): Promise<AuthPayload> {
    const { accessToken, user, isAdmin } = await this.authService.login(input);

    // Front (tiendadeoscarymateo.com) y API (server.tiendadeoscarymateo.com) son el mismo
    // sitio, así que 'lax' alcanza y además impide que sitios ajenos usen la sesión.
    const baseCookieOptions: CookieOptions = {
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: isAdmin ? ADMIN_TOKEN_TTL_MS : DEFAULT_TOKEN_TTL_MS,
      path: '/',
    };

    context.res.cookie(ACCESS_TOKEN_COOKIE, accessToken, {
      ...baseCookieOptions,
      httpOnly: true,
    });

    // La sesión queda solo en el host de la API, pero el token CSRF lo tiene que leer el
    // JavaScript del front, que vive en otro subdominio: se declara para todo el dominio.
    context.res.cookie(CSRF_COOKIE, randomBytes(32).toString('hex'), {
      ...baseCookieOptions,
      httpOnly: false,
      domain: COOKIE_DOMAIN,
    });

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

  @Mutation(() => Boolean)
  @UseGuards(JwtAuthGuard, CsrfGuard)
  @SkipMustChangePassword()
  logout(@Context() context: GqlContext) {
    context.res.clearCookie(ACCESS_TOKEN_COOKIE, { path: '/' });
    context.res.clearCookie(CSRF_COOKIE, { path: '/', domain: COOKIE_DOMAIN });
    return this.authService.logout();
  }
}
