import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import { ACCESS_TOKEN_COOKIE } from '../../graphql/auth/auth-cookie.constants.js';
import { User } from '../../graphql/user/entities/user.entity.js';
import { RecordStatus } from '../enums/record-status.enum.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';

const basePayload = { sub: 'user-1', email: 'ana@example.com' };

function createGuard(
  storedUser: unknown,
  skipsPasswordCheck = false,
  payload: Record<string, unknown> = basePayload,
) {
  const jwtService = { verify: vi.fn(() => payload) };
  const reflector = { getAllAndOverride: vi.fn(() => skipsPasswordCheck) };
  const findOneBy = vi.fn(async () => storedUser);
  const dataSource = { getRepository: vi.fn(() => ({ findOneBy })) };

  return {
    guard: new JwtAuthGuard(jwtService as never, reflector as never, dataSource as never),
    jwtService,
    dataSource,
    findOneBy,
  };
}

// El guard los pasa al Reflector para leer @SkipMustChangePassword(); el Reflector está
// mockeado, así que basta con que existan.
const handlerAndClass = { getHandler: () => undefined, getClass: () => undefined };

function contextWith(authorization?: string, cookies?: Record<string, string>) {
  const req = { headers: { authorization }, cookies, user: undefined };
  vi.spyOn(GqlExecutionContext, 'create').mockReturnValue({
    getContext: () => ({ req }),
  } as unknown as GqlExecutionContext);
  return { req, context: { getType: () => 'graphql', ...handlerAndClass } as never };
}

function httpContextWith(authorization?: string) {
  const req = { headers: { authorization }, user: undefined };
  const context = {
    getType: () => 'http',
    switchToHttp: () => ({ getRequest: () => req }),
    ...handlerAndClass,
  };
  return { req, context: context as never };
}

const activeUser = {
  id: 'user-1',
  status: RecordStatus.ACTIVE,
  mustChangePassword: false,
};

// Una fecha en segundos desde 1970, como la que trae el token en `iat`
const at = (seconds: number) => new Date(seconds * 1000);

describe('JwtAuthGuard', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects a request without a Bearer token', async () => {
    const { guard } = createGuard(activeUser);
    const { context } = contextWith(undefined);

    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
  });

  it('rejects a valid token whose user was deactivated', async () => {
    const { guard } = createGuard({ ...activeUser, status: RecordStatus.INACTIVE });
    const { context } = contextWith('Bearer token');

    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
  });

  it('blocks a user with a pending password change', async () => {
    const { guard } = createGuard({ ...activeUser, mustChangePassword: true });
    const { context } = contextWith('Bearer token');

    await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
  });

  it('lets a pending password change through on exempt operations', async () => {
    const { guard } = createGuard({ ...activeUser, mustChangePassword: true }, true);
    const { context } = contextWith('Bearer token');

    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('attaches the payload to the request for an active user', async () => {
    const { guard } = createGuard(activeUser);
    const { req, context } = contextWith('Bearer token');

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(req.user).toEqual({ sub: 'user-1', email: 'ana@example.com' });
  });

  it('also authenticates REST requests, like the upload endpoint', async () => {
    const { guard } = createGuard(activeUser);
    const { req, context } = httpContextWith('Bearer token');

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(req.user).toEqual({ sub: 'user-1', email: 'ana@example.com' });
  });

  describe('token', () => {
    it('reads the token from the session cookie', async () => {
      const { guard, jwtService } = createGuard(activeUser);
      const { context } = contextWith(undefined, { [ACCESS_TOKEN_COOKIE]: 'cookie-token' });

      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(jwtService.verify).toHaveBeenCalledWith('cookie-token');
    });

    it('prefers the cookie over the Authorization header', async () => {
      const { guard, jwtService } = createGuard(activeUser);
      const { context } = contextWith('Bearer header-token', {
        [ACCESS_TOKEN_COOKIE]: 'cookie-token',
      });

      await guard.canActivate(context);

      expect(jwtService.verify).toHaveBeenCalledWith('cookie-token');
    });

    it('reads the token from the Bearer header when there is no cookie', async () => {
      const { guard, jwtService } = createGuard(activeUser);
      const { context } = contextWith('Bearer header-token');

      await guard.canActivate(context);

      expect(jwtService.verify).toHaveBeenCalledWith('header-token');
    });

    it('rejects an invalid or expired token, without looking the user up', async () => {
      const { guard, jwtService, dataSource } = createGuard(activeUser);
      jwtService.verify.mockImplementation(() => {
        throw new Error('jwt expired');
      });
      const { context } = contextWith('Bearer token');

      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
      expect(dataSource.getRepository).not.toHaveBeenCalled();
    });

    it('looks up the user the token was issued to', async () => {
      const { guard, dataSource, findOneBy } = createGuard(activeUser);
      const { context } = contextWith('Bearer token');

      await guard.canActivate(context);

      expect(dataSource.getRepository).toHaveBeenCalledWith(User);
      expect(findOneBy).toHaveBeenCalledWith({ id: 'user-1' });
    });

    it('rejects a token whose user no longer exists', async () => {
      const { guard } = createGuard(null);
      const { context } = contextWith('Bearer token');

      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('password change', () => {
    it('rejects a session opened before the last password change', async () => {
      const { guard } = createGuard(
        { ...activeUser, passwordChangedAt: at(2000) },
        false,
        { ...basePayload, iat: 1999 },
      );
      const { req, context } = contextWith('Bearer token');

      const error = await guard.canActivate(context).catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(UnauthorizedException);
      expect((error as UnauthorizedException).message).toContain('Tu contraseña cambió');
      expect(req.user).toBeUndefined();
    });

    it('lets through a session opened after the last password change', async () => {
      const { guard } = createGuard(
        { ...activeUser, passwordChangedAt: at(2000) },
        false,
        { ...basePayload, iat: 2001 },
      );
      const { req, context } = contextWith('Bearer token');

      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(req.user).toEqual({ ...basePayload, iat: 2001 });
    });

    it('lets through a session opened in the same second as the password change: it is the one renewed when the password is changed', async () => {
      const { guard } = createGuard(
        // La clave cambió a los 2000,5 segundos y el token se emitió en el segundo 2000
        { ...activeUser, passwordChangedAt: new Date(2_000_500) },
        false,
        { ...basePayload, iat: 2000 },
      );
      const { context } = contextWith('Bearer token');

      await expect(guard.canActivate(context)).resolves.toBe(true);
    });

    it('compares in whole seconds: a token from the second before the change is still rejected', async () => {
      const { guard } = createGuard(
        { ...activeUser, passwordChangedAt: new Date(2_000_500) },
        false,
        { ...basePayload, iat: 1999 },
      );
      const { context } = contextWith('Bearer token');

      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    });

    it('does not invalidate any session when the password never changed', async () => {
      const { guard } = createGuard(
        { ...activeUser, passwordChangedAt: null },
        false,
        { ...basePayload, iat: 1 },
      );
      const { context } = contextWith('Bearer token');

      await expect(guard.canActivate(context)).resolves.toBe(true);
    });

    it('rejects a token without a date of issue once the password has changed', async () => {
      const { guard } = createGuard({ ...activeUser, passwordChangedAt: at(2000) });
      const { context } = contextWith('Bearer token');

      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    });

    it('answers "sign in again" rather than "change your password" to a session that a reset left behind', async () => {
      // Un administrador restableció la clave: la cuenta debe cambiarla y las sesiones anteriores caducan
      const { guard } = createGuard(
        { ...activeUser, mustChangePassword: true, passwordChangedAt: at(2000) },
        false,
        { ...basePayload, iat: 1000 },
      );
      const { context } = contextWith('Bearer token');

      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    });

    it('rejects an old session even on the operations exempt from the pending password change', async () => {
      const { guard } = createGuard(
        { ...activeUser, mustChangePassword: true, passwordChangedAt: at(2000) },
        true,
        { ...basePayload, iat: 1000 },
      );
      const { context } = contextWith('Bearer token');

      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    });

    it('lets the renewed session change a pending password: it was issued after the reset', async () => {
      const { guard } = createGuard(
        { ...activeUser, mustChangePassword: true, passwordChangedAt: at(2000) },
        true,
        { ...basePayload, iat: 2005 },
      );
      const { context } = contextWith('Bearer token');

      await expect(guard.canActivate(context)).resolves.toBe(true);
    });

    it('still blocks a recent session with a pending password change on the other operations', async () => {
      const { guard } = createGuard(
        { ...activeUser, mustChangePassword: true, passwordChangedAt: at(2000) },
        false,
        { ...basePayload, iat: 2005 },
      );
      const { context } = contextWith('Bearer token');

      await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
    });
  });
});
