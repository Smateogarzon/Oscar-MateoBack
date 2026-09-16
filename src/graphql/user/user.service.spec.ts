import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import bcrypt from 'bcryptjs';
import { RecordStatus } from '../../common/enums/record-status.enum.js';
import { UserService } from './user.service.js';

function createService() {
  const repo = {
    find: vi.fn(),
    findOneBy: vi.fn(),
  };
  const transactionRepo = {
    findOneBy: vi.fn(),
    create: vi.fn((data: object) => data),
    save: vi.fn(async (user: object) => ({ id: 'new-id', ...user })),
  };
  const dataSource = {
    transaction: vi.fn(async (fn: (manager: unknown) => unknown) =>
      fn({ getRepository: () => transactionRepo }),
    ),
  };
  const service = new UserService(repo as never, dataSource as never);
  return { service, repo, transactionRepo, dataSource };
}

const input = {
  firstName: 'Ana',
  lastName: 'Gómez',
  email: 'ana@example.com',
  documentNumber: '123456789',
};

describe('UserService', () => {
  describe('create', () => {
    it('hashes documentNumber as the initial password', async () => {
      const { service, transactionRepo } = createService();
      transactionRepo.findOneBy.mockResolvedValue(null);

      const user = await service.create(input);

      const created = transactionRepo.create.mock.calls[0][0];
      expect(created.mustChangePassword).toBe(true);
      expect(created.passwordHash).not.toBe(input.documentNumber);
      expect(user.id).toBe('new-id');
    });

    it('throws when the email is already registered', async () => {
      const { service, transactionRepo } = createService();
      transactionRepo.findOneBy.mockResolvedValue({ id: 'existing' });

      await expect(service.create(input)).rejects.toThrow(ConflictException);
    });
  });

  describe('update', () => {
    it('applies changes inside a transaction', async () => {
      const { service, repo, dataSource } = createService();
      repo.findOneBy.mockResolvedValue({ id: '1', firstName: 'Ana' });

      const result = await service.update('1', { firstName: 'Ana María' });

      expect(dataSource.transaction).toHaveBeenCalled();
      expect(result.firstName).toBe('Ana María');
    });

    it('throws when the user does not exist', async () => {
      const { service, repo } = createService();
      repo.findOneBy.mockResolvedValue(null);

      await expect(service.update('missing', { firstName: 'X' })).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('deactivate', () => {
    it('sets status to INACTIVE inside a transaction', async () => {
      const { service, repo, dataSource } = createService();
      repo.findOneBy.mockResolvedValue({ id: '1', status: RecordStatus.ACTIVE });

      const result = await service.deactivate('1');

      expect(dataSource.transaction).toHaveBeenCalled();
      expect(result.status).toBe(RecordStatus.INACTIVE);
    });

    it('throws when the user does not exist', async () => {
      const { service, repo } = createService();
      repo.findOneBy.mockResolvedValue(null);

      await expect(service.deactivate('missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('changePassword', () => {
    const currentPassword = 'clave-actual';
    const documentNumber = '123456789';

    async function storedUser() {
      return {
        id: '1',
        documentNumber,
        mustChangePassword: true,
        passwordHash: await bcrypt.hash(currentPassword, 4),
      };
    }

    it('rehashes the password and clears mustChangePassword', async () => {
      const { service, repo } = createService();
      const user = await storedUser();
      repo.findOneBy.mockResolvedValue(user);

      const result = await service.changePassword('1', {
        currentPassword,
        newPassword: 'una-clave-nueva',
      });

      expect(result.mustChangePassword).toBe(false);
      expect(await bcrypt.compare('una-clave-nueva', result.passwordHash)).toBe(true);
    });

    it('rejects a wrong current password', async () => {
      const { service, repo } = createService();
      repo.findOneBy.mockResolvedValue(await storedUser());

      await expect(
        service.changePassword('1', {
          currentPassword: 'equivocada',
          newPassword: 'una-clave-nueva',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects reusing the document number as the new password', async () => {
      const { service, repo } = createService();
      repo.findOneBy.mockResolvedValue(await storedUser());

      await expect(
        service.changePassword('1', { currentPassword, newPassword: documentNumber }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects reusing the current password', async () => {
      const { service, repo } = createService();
      repo.findOneBy.mockResolvedValue(await storedUser());

      await expect(
        service.changePassword('1', { currentPassword, newPassword: currentPassword }),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
