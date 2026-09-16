import { UseGuards } from '@nestjs/common';
import { Args, Context, Mutation, Resolver } from '@nestjs/graphql';
import type { Response } from 'express';
import { SkipMustChangePassword } from '../../common/decorators/skip-must-change-password.decorator.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import {
  ACCESS_TOKEN_COOKIE,
  ADMIN_TOKEN_TTL_MS,
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

    context.res.cookie(ACCESS_TOKEN_COOKIE, accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
      maxAge: isAdmin ? ADMIN_TOKEN_TTL_MS : DEFAULT_TOKEN_TTL_MS,
      path: '/',
    });

    return { user };
  }

  @Mutation(() => Boolean)
  @UseGuards(JwtAuthGuard)
  @SkipMustChangePassword()
  logout(@Context() context: GqlContext) {
    context.res.clearCookie(ACCESS_TOKEN_COOKIE, { path: '/' });
    return this.authService.logout();
  }
}
