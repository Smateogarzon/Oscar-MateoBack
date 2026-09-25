import { HttpException, HttpStatus, Logger, UnauthorizedException } from '@nestjs/common';
import bcrypt from 'bcryptjs';
import { In } from 'typeorm';
import type { MockInstance } from 'vitest';
import { RecordStatus } from '../../common/enums/record-status.enum.js';
import { RoleScope } from '../role/entities/role-scope.enum.js';
import { AuthService } from './auth.service.js';

function createService() {
  const userService = { findByEmail: vi.fn() };
  const jwtService = { sign: vi.fn(() => 'signed-token') };
  const roleRepository = { findBy: vi.fn().mockResolvedValue([]) };
  const userCompanyRoleRepository = { find: vi.fn().mockResolvedValue([]) };
  const userRepository = { update: vi.fn().mockResolvedValue(undefined) };
  const dataSource = {
    transaction: vi.fn(async (fn: (manager: unknown) => unknown) =>
      fn({ getRepository: () => userRepository }),
    ),
  };

  const service = new AuthService(
    userService as never,
    jwtService as never,
    roleRepository as never,
    userCompanyRoleRepository as never,
    dataSource as never,
  );

  return {
    service,
    userService,
    jwtService,
    roleRepository,
    userCompanyRoleRepository,
    userRepository,
  };
}

const rawPassword = 'my-secret';

async function activeUser(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'user-1',
    email: 'ana@example.com',
    status: RecordStatus.ACTIVE,
    passwordHash: await bcrypt.hash(rawPassword, 4),
    ...overrides,
  };
}

const LOCK_MS = 15 * 60 * 1000;

// El bloqueo por intentos fallidos depende del reloj: se controla `Date.now()` y solo eso, para no frenar a bcrypt.
function controlClock(start = Date.parse('2026-09-25T10:00:00Z')) {
  let now = start;
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  return {
    advance: (ms: number) => {
      now += ms;
    },
  };
}

// Contraseñas equivocadas seguidas para un correo: cada una se responde como "credenciales inválidas".
async function failLogins(service: AuthService, times: number, email = 'ana@example.com') {
  for (let attempt = 0; attempt < times; attempt++) {
    await expect(service.login({ email, password: 'wrong' })).rejects.toThrow(
      UnauthorizedException,
    );
  }
}

// El estado HTTP con que responde un inicio de sesión con la contraseña correcta: 200 si entra, 429 si el
// correo está bloqueado.
async function loginStatus(service: AuthService, email = 'ana@example.com') {
  try {
    await service.login({ email, password: rawPassword });
    return HttpStatus.OK;
  } catch (error) {
    return (error as HttpException).getStatus();
  }
}

describe('AuthService', () => {
  let warn: MockInstance;
  let log: MockInstance;

  beforeEach(() => {
    // El servicio deja rastro de los inicios de sesión: se intercepta para no llenar la salida y para revisarlo
    warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('login', () => {
    it('rejects when the user does not exist', async () => {
      const { service, userService } = createService();
      userService.findByEmail.mockResolvedValue(null);

      await expect(
        service.login({ email: 'missing@example.com', password: rawPassword }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects when the user is inactive', async () => {
      const { service, userService } = createService();
      userService.findByEmail.mockResolvedValue(
        await activeUser({ status: RecordStatus.INACTIVE }),
      );

      await expect(
        service.login({ email: 'ana@example.com', password: rawPassword }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects a wrong password without recording a login', async () => {
      const { service, userService, userRepository } = createService();
      userService.findByEmail.mockResolvedValue(await activeUser());

      await expect(
        service.login({ email: 'ana@example.com', password: 'wrong' }),
      ).rejects.toThrow(UnauthorizedException);
      expect(userRepository.update).not.toHaveBeenCalled();
    });

    it('records the new login time but returns the previous one', async () => {
      const previousLoginAt = new Date('2026-09-15T15:40:00Z');
      const { service, userService, userRepository } = createService();
      userService.findByEmail.mockResolvedValue(
        await activeUser({ lastLoginAt: previousLoginAt }),
      );

      const result = await service.login({ email: 'ana@example.com', password: rawPassword });

      expect(userRepository.update).toHaveBeenCalledWith('user-1', {
        lastLoginAt: expect.any(Date),
      });
      expect(result.user.lastLoginAt).toBe(previousLoginAt);
    });

    it('signs a 24h token for a user without the ADMIN role', async () => {
      const { service, userService, jwtService, userCompanyRoleRepository } = createService();
      userService.findByEmail.mockResolvedValue(await activeUser());
      userCompanyRoleRepository.find.mockResolvedValue([]);

      const result = await service.login({ email: 'ana@example.com', password: rawPassword });

      expect(jwtService.sign).toHaveBeenCalledWith(
        { sub: 'user-1', email: 'ana@example.com' },
        { expiresIn: '24h' },
      );
      expect(result.accessToken).toBe('signed-token');
      expect(result.isAdmin).toBe(false);
    });

    it('signs a 1h token for a user with the ADMIN role', async () => {
      const { service, userService, jwtService, userCompanyRoleRepository, roleRepository } =
        createService();
      userService.findByEmail.mockResolvedValue(await activeUser());
      userCompanyRoleRepository.find.mockResolvedValue([
        { roleId: 'role-1', status: RecordStatus.ACTIVE },
      ]);
      roleRepository.findBy.mockResolvedValue([{ id: 'role-1', code: 'ADMIN' }]);

      const result = await service.login({ email: 'ana@example.com', password: rawPassword });

      expect(jwtService.sign).toHaveBeenCalledWith(
        { sub: 'user-1', email: 'ana@example.com' },
        { expiresIn: '1h' },
      );
      expect(result.isAdmin).toBe(true);
    });

    it('signs a 1h token for a super admin (a platform role)', async () => {
      const { service, userService, jwtService, userCompanyRoleRepository, roleRepository } =
        createService();
      userService.findByEmail.mockResolvedValue(await activeUser());
      userCompanyRoleRepository.find.mockResolvedValue([
        { roleId: 'role-1', status: RecordStatus.ACTIVE },
      ]);
      roleRepository.findBy.mockResolvedValue([
        { id: 'role-1', code: 'SUPER_ADMIN', scope: RoleScope.GLOBAL },
      ]);

      const result = await service.login({ email: 'ana@example.com', password: rawPassword });

      expect(jwtService.sign).toHaveBeenCalledWith(
        { sub: 'user-1', email: 'ana@example.com' },
        { expiresIn: '1h' },
      );
      expect(result.isAdmin).toBe(true);
    });

    it('keeps roles and permissions out of the token, they are checked per company on each request', async () => {
      const { service, userService, jwtService, userCompanyRoleRepository, roleRepository } =
        createService();
      userService.findByEmail.mockResolvedValue(await activeUser());
      userCompanyRoleRepository.find.mockResolvedValue([
        { roleId: 'role-1', status: RecordStatus.ACTIVE },
      ]);
      roleRepository.findBy.mockResolvedValue([{ id: 'role-1', code: 'ADMIN' }]);

      await service.login({ email: 'ana@example.com', password: rawPassword });

      const [payload] = jwtService.sign.mock.calls[0] as unknown as [Record<string, unknown>];
      expect(Object.keys(payload).sort()).toEqual(['email', 'sub']);
    });

    it('looks the user up by the email in lowercase and without spaces', async () => {
      const { service, userService } = createService();
      userService.findByEmail.mockResolvedValue(await activeUser());

      await service.login({ email: '  Ana@Example.COM ', password: rawPassword });

      expect(userService.findByEmail).toHaveBeenCalledWith('ana@example.com');
    });

    it('gives the same answer for an unknown email, a wrong password and an inactive account', async () => {
      const { service, userService } = createService();
      const answers: unknown[] = [];

      userService.findByEmail.mockResolvedValue(null);
      answers.push(
        await service
          .login({ email: 'missing@example.com', password: rawPassword })
          .catch((caught: unknown) => caught),
      );
      userService.findByEmail.mockResolvedValue(await activeUser());
      answers.push(
        await service
          .login({ email: 'ana@example.com', password: 'wrong' })
          .catch((caught: unknown) => caught),
      );
      userService.findByEmail.mockResolvedValue(
        await activeUser({ status: RecordStatus.INACTIVE }),
      );
      answers.push(
        await service
          .login({ email: 'ana@example.com', password: rawPassword })
          .catch((caught: unknown) => caught),
      );

      for (const answer of answers) {
        expect(answer).toBeInstanceOf(UnauthorizedException);
        expect((answer as UnauthorizedException).message).toBe('Credenciales inválidas');
      }
    });

    describe('timing of the answer', () => {
      it('compares the password against a fake hash when the email does not exist, so it takes as long as with a real account', async () => {
        const { service, userService } = createService();
        userService.findByEmail.mockResolvedValue(null);
        const compare = vi.spyOn(bcrypt, 'compare');

        await expect(
          service.login({ email: 'missing@example.com', password: rawPassword }),
        ).rejects.toThrow(UnauthorizedException);

        expect(compare).toHaveBeenCalledTimes(1);
        expect(compare).toHaveBeenCalledWith(rawPassword, expect.stringMatching(/^\$2[aby]\$\d{2}\$/));
      });

      it('does the same for an inactive account, and never against its real hash', async () => {
        const { service, userService } = createService();
        const user = await activeUser({ status: RecordStatus.INACTIVE });
        userService.findByEmail.mockResolvedValue(user);
        const compare = vi.spyOn(bcrypt, 'compare');

        // Con la contraseña correcta: una cuenta inactiva no entra, y la comparación no usa su hash
        await expect(
          service.login({ email: 'ana@example.com', password: rawPassword }),
        ).rejects.toThrow(UnauthorizedException);

        expect(compare).toHaveBeenCalledTimes(1);
        expect(compare.mock.calls[0][1]).not.toBe(user.passwordHash);
        expect(compare.mock.calls[0][1]).toMatch(/^\$2[aby]\$\d{2}\$/);
      });

      it('compares against the real hash of an active account', async () => {
        const { service, userService } = createService();
        const user = await activeUser();
        userService.findByEmail.mockResolvedValue(user);
        const compare = vi.spyOn(bcrypt, 'compare');

        await service.login({ email: 'ana@example.com', password: rawPassword });

        expect(compare).toHaveBeenCalledTimes(1);
        expect(compare).toHaveBeenCalledWith(rawPassword, user.passwordHash);
      });
    });

    describe('logging', () => {
      it('leaves a trace of a failed attempt with the email and the ip, never the password', async () => {
        const { service, userService } = createService();
        userService.findByEmail.mockResolvedValue(await activeUser());

        await expect(
          service.login({ email: 'ana@example.com', password: 'contraseña-equivocada' }, '10.0.0.7'),
        ).rejects.toThrow(UnauthorizedException);

        expect(warn).toHaveBeenCalledTimes(1);
        const [message] = warn.mock.calls[0] as [string];
        expect(message).toContain('ana@example.com');
        expect(message).toContain('10.0.0.7');
        expect(message).not.toContain('contraseña-equivocada');
      });

      it('says the ip is unknown when the request does not tell it', async () => {
        const { service, userService } = createService();
        userService.findByEmail.mockResolvedValue(null);

        await expect(
          service.login({ email: 'missing@example.com', password: rawPassword }),
        ).rejects.toThrow(UnauthorizedException);

        expect((warn.mock.calls[0] as [string])[0]).toContain('desconocida');
      });

      it('leaves a trace of a successful login with the user and the ip, and no warning', async () => {
        const { service, userService } = createService();
        userService.findByEmail.mockResolvedValue(await activeUser());

        await service.login({ email: 'ana@example.com', password: rawPassword }, '10.0.0.7');

        expect(log).toHaveBeenCalledTimes(1);
        const [message] = log.mock.calls[0] as [string];
        expect(message).toContain('user-1');
        expect(message).toContain('10.0.0.7');
        expect(message).not.toContain(rawPassword);
        expect(warn).not.toHaveBeenCalled();
      });
    });

    describe('lock after failed attempts', () => {
      it('does not block before the fifth wrong password in a row', async () => {
        controlClock();
        const { service, userService } = createService();
        userService.findByEmail.mockResolvedValue(await activeUser());

        await failLogins(service, 4);

        await expect(
          service.login({ email: 'ana@example.com', password: rawPassword }),
        ).resolves.toMatchObject({ accessToken: 'signed-token' });
      });

      it('blocks the email after five wrong passwords in a row, even for the right password', async () => {
        controlClock();
        const { service, userService, userRepository } = createService();
        userService.findByEmail.mockResolvedValue(await activeUser());
        await failLogins(service, 5);

        const error = await service
          .login({ email: 'ana@example.com', password: rawPassword })
          .catch((caught: unknown) => caught);

        expect(error).toBeInstanceOf(HttpException);
        expect(error).not.toBeInstanceOf(UnauthorizedException);
        expect((error as HttpException).getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
        expect((error as HttpException).message).toContain('Demasiados intentos fallidos');
        // Ni siquiera se busca al usuario ni se compara la contraseña
        expect(userService.findByEmail).toHaveBeenCalledTimes(5);
        expect(userRepository.update).not.toHaveBeenCalled();
      });

      it('keeps the lock for fifteen minutes and then lets the email try again', async () => {
        const clock = controlClock();
        const { service, userService } = createService();
        userService.findByEmail.mockResolvedValue(await activeUser());
        await failLogins(service, 5);

        clock.advance(LOCK_MS - 1000);
        expect(await loginStatus(service)).toBe(HttpStatus.TOO_MANY_REQUESTS);

        clock.advance(2000);
        expect(await loginStatus(service)).toBe(HttpStatus.OK);
      });

      it('needs five more failures to block it again after the lock ends', async () => {
        const clock = controlClock();
        const { service, userService } = createService();
        userService.findByEmail.mockResolvedValue(await activeUser());
        await failLogins(service, 5);
        clock.advance(LOCK_MS + 1000);

        await failLogins(service, 4);

        await expect(
          service.login({ email: 'ana@example.com', password: rawPassword }),
        ).resolves.toMatchObject({ accessToken: 'signed-token' });
      });

      it('counts per email: blocking one does not block the others', async () => {
        controlClock();
        const { service, userService } = createService();
        const luis = await activeUser({ id: 'user-2', email: 'luis@example.com' });
        userService.findByEmail.mockImplementation(async (email: string) =>
          email === 'luis@example.com' ? luis : activeUser(),
        );
        await failLogins(service, 5, 'ana@example.com');

        await expect(
          service.login({ email: 'luis@example.com', password: rawPassword }),
        ).resolves.toMatchObject({ user: { id: 'user-2' } });
      });

      it('counts an email that does not exist the same way, so the lock does not reveal which emails belong to the app', async () => {
        controlClock();
        const { service, userService } = createService();
        userService.findByEmail.mockResolvedValue(null);
        await failLogins(service, 5, 'missing@example.com');

        expect(await loginStatus(service, 'missing@example.com')).toBe(
          HttpStatus.TOO_MANY_REQUESTS,
        );
      });

      it('counts an email as the same however it is written', async () => {
        controlClock();
        const { service, userService } = createService();
        userService.findByEmail.mockResolvedValue(await activeUser());
        await failLogins(service, 3, 'ANA@example.com');
        await failLogins(service, 2, '  ana@Example.com ');

        expect(await loginStatus(service, 'Ana@EXAMPLE.com')).toBe(HttpStatus.TOO_MANY_REQUESTS);
      });

      it('forgets the failures after a successful login', async () => {
        controlClock();
        const { service, userService } = createService();
        userService.findByEmail.mockResolvedValue(await activeUser());

        await failLogins(service, 4);
        await service.login({ email: 'ana@example.com', password: rawPassword });
        // Otros cuatro seguidos ya no suman con los de antes: siguen sin bloquear
        await failLogins(service, 4);

        await expect(
          service.login({ email: 'ana@example.com', password: rawPassword }),
        ).resolves.toMatchObject({ accessToken: 'signed-token' });
      });

      it('does not add up failures that are more than fifteen minutes apart', async () => {
        const clock = controlClock();
        const { service, userService } = createService();
        userService.findByEmail.mockResolvedValue(await activeUser());

        await failLogins(service, 4);
        clock.advance(LOCK_MS + 1000);
        await failLogins(service, 4);

        await expect(
          service.login({ email: 'ana@example.com', password: rawPassword }),
        ).resolves.toMatchObject({ accessToken: 'signed-token' });
      });

      it('does not keep every email it has ever seen: stale records are dropped once there are too many', async () => {
        const clock = controlClock();
        const { service, userService } = createService();
        userService.findByEmail.mockResolvedValue(null);
        // Con bcrypt de verdad serían miles de comparaciones lentas
        vi.spyOn(bcrypt, 'compare').mockResolvedValue(false as never);
        const tracked = () =>
          (service as unknown as { failures: Map<string, unknown> }).failures.size;

        for (let index = 0; index <= 5000; index++) {
          await expect(
            service.login({ email: `persona${index}@example.com`, password: 'wrong' }),
          ).rejects.toThrow(UnauthorizedException);
        }
        expect(tracked()).toBe(5001);

        clock.advance(LOCK_MS + 1000);
        await expect(
          service.login({ email: 'otra@example.com', password: 'wrong' }),
        ).rejects.toThrow(UnauthorizedException);

        expect(tracked()).toBe(1);
      });
    });
  });

  describe('issueSession', () => {
    const user = { id: 'user-1', email: 'ana@example.com' };

    it('signs a 24h token for a user without the ADMIN role', async () => {
      const { service, jwtService } = createService();

      await expect(service.issueSession(user)).resolves.toEqual({
        accessToken: 'signed-token',
        isAdmin: false,
      });
      expect(jwtService.sign).toHaveBeenCalledWith(
        { sub: 'user-1', email: 'ana@example.com' },
        { expiresIn: '24h' },
      );
    });

    it('signs a 1h token for an administrator', async () => {
      const { service, jwtService, userCompanyRoleRepository, roleRepository } = createService();
      userCompanyRoleRepository.find.mockResolvedValue([
        { roleId: 'role-1', status: RecordStatus.ACTIVE },
      ]);
      roleRepository.findBy.mockResolvedValue([{ id: 'role-1', code: 'ADMIN' }]);

      await expect(service.issueSession(user)).resolves.toEqual({
        accessToken: 'signed-token',
        isAdmin: true,
      });
      expect(jwtService.sign).toHaveBeenCalledWith(
        { sub: 'user-1', email: 'ana@example.com' },
        { expiresIn: '1h' },
      );
    });

    it('only looks at the active assignments of the user', async () => {
      const { service, userCompanyRoleRepository } = createService();

      await service.issueSession(user);

      expect(userCompanyRoleRepository.find).toHaveBeenCalledWith({
        where: { userId: 'user-1', status: RecordStatus.ACTIVE },
      });
    });

    it('does not look for roles when the user has no active assignment', async () => {
      const { service, roleRepository } = createService();

      await service.issueSession(user);

      expect(roleRepository.findBy).not.toHaveBeenCalled();
    });

    it('looks each role up once, even when several assignments share it', async () => {
      const { service, userCompanyRoleRepository, roleRepository } = createService();
      userCompanyRoleRepository.find.mockResolvedValue([
        { roleId: 'role-1' },
        { roleId: 'role-1' },
        { roleId: 'role-2' },
      ]);

      await service.issueSession(user);

      expect(roleRepository.findBy).toHaveBeenCalledWith({ id: In(['role-1', 'role-2']) });
    });

    it('only signs: it neither checks credentials nor records a login', async () => {
      const { service, userService, userRepository } = createService();

      await service.issueSession(user);

      expect(userService.findByEmail).not.toHaveBeenCalled();
      expect(userRepository.update).not.toHaveBeenCalled();
    });
  });

  describe('logout', () => {
    it('returns true', () => {
      const { service } = createService();
      expect(service.logout()).toBe(true);
    });
  });
});
