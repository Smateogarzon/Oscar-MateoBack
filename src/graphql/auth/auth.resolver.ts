import { UseGuards } from '@nestjs/common';
import { Args, Mutation, Resolver } from '@nestjs/graphql';
import { SkipMustChangePassword } from '../../common/decorators/skip-must-change-password.decorator.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { AuthService } from './auth.service.js';
import { AuthPayload } from './dto/auth-payload.object-type.js';
import { LoginInput } from './dto/login.input.js';

@Resolver()
export class AuthResolver {
  constructor(private readonly authService: AuthService) {}

  @Mutation(() => AuthPayload)
  login(@Args('input') input: LoginInput) {
    return this.authService.login(input);
  }

  @Mutation(() => Boolean)
  @UseGuards(JwtAuthGuard)
  @SkipMustChangePassword()
  logout() {
    return this.authService.logout();
  }
}
