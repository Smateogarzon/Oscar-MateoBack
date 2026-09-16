import { UnauthorizedException } from '@nestjs/common';
import bcrypt from 'bcryptjs';
import { RecordStatus } from '../../common/enums/record-status.enum.js';
import { AuthService } from './auth.service.js';

function createService() {
  const userService = { findByEmail: vi.fn() };
  const jwtService = { sign: vi.fn(() => 'signed-token') };
  const roleRepository = { findBy: vi.fn().mockResolvedValue([]) };
  const permissionRepository = { findBy: vi.fn().mockResolvedValue([]) };
  const rolePermissionRepository = { find: vi.fn().mockResolvedValue([]) };
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
    permissionRepository as never,
    rolePermissionRepository as never,
    userCompanyRoleRepository as never,
    dataSource as never,
  );

  return {
    service,
    userService,
    jwtService,
    roleRepository,
    permissionRepository,
    rolePermissionRepository,
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

describe('AuthService', () => {
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
        expect.objectContaining({ isAdmin: false }),
        { expiresIn: '24h' },
      );
      expect(result.accessToken).toBe('signed-token');
    });

    it('signs a 1h token for a user with the ADMIN role', async () => {
      const { service, userService, jwtService, userCompanyRoleRepository, roleRepository } =
        createService();
      userService.findByEmail.mockResolvedValue(await activeUser());
      userCompanyRoleRepository.find.mockResolvedValue([
        { roleId: 'role-1', status: RecordStatus.ACTIVE },
      ]);
      roleRepository.findBy.mockResolvedValue([{ id: 'role-1', code: 'ADMIN' }]);

      await service.login({ email: 'ana@example.com', password: rawPassword });

      expect(jwtService.sign).toHaveBeenCalledWith(
        expect.objectContaining({ isAdmin: true, roleCodes: ['ADMIN'] }),
        { expiresIn: '1h' },
      );
    });
  });

  describe('logout', () => {
    it('returns true', () => {
      const { service } = createService();
      expect(service.logout()).toBe(true);
    });
  });
});
