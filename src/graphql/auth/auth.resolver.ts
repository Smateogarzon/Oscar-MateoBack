import { randomBytes } from 'node:crypto';
import { UseGuards } from '@nestjs/common';
import { Args, Context, Mutation, Resolver } from '@nestjs/graphql';
import type { CookieOptions, Response } from 'express';
import { SkipMustChangePassword } from '../../common/decorators/skip-must-change-password.decorator.js';
import { CsrfGuard } from '../../common/guards/csrf.guard.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import {
  ACCESS_TOKEN_COOKIE,
  ADMIN_TOKEN_TTL_MS,
  CSRF_COOKIE,
  DEFAULT_TOKEN_TTL_MS,
} from './auth-cookie.constants.js';
import { AuthService } from './auth.service.js';
import { AuthPayload } from './dto/auth-payload.object-type.js';
import { LoginInput } from './dto/login.input.js';

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

    const baseCookieOptions: CookieOptions = {
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
      maxAge: isAdmin ? ADMIN_TOKEN_TTL_MS : DEFAULT_TOKEN_TTL_MS,
      path: '/',
    };

    context.res.cookie(ACCESS_TOKEN_COOKIE, accessToken, {
      ...baseCookieOptions,
      httpOnly: true,
    });

    context.res.cookie(CSRF_COOKIE, randomBytes(32).toString('hex'), {
      ...baseCookieOptions,
      httpOnly: false,
    });

    return { user };
  }

  @Mutation(() => Boolean)
  @UseGuards(JwtAuthGuard, CsrfGuard)
  @SkipMustChangePassword()
  logout(@Context() context: GqlContext) {
    context.res.clearCookie(ACCESS_TOKEN_COOKIE, { path: '/' });
    context.res.clearCookie(CSRF_COOKIE, { path: '/' });
    return this.authService.logout();
  }
}
