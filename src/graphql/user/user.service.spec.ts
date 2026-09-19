import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import bcrypt from 'bcryptjs';
import { In, QueryFailedError } from 'typeorm';
import { RecordStatus } from '../../common/enums/record-status.enum.js';
import { UserCompanyRole } from '../user-company-role/entities/user-company-role.entity.js';
import { UserService } from './user.service.js';

function createService() {
  const repo = {
    find: vi.fn(),
    findOneBy: vi.fn(),
  };
  // Membresías consultadas fuera de una transacción (¿es de esta empresa? ¿trabaja en otra?)
  const membershipRepo = {
    find: vi.fn(),
    existsBy: vi.fn(),
  };
  const transactionRepo = {
    findOneBy: vi.fn(),
    create: vi.fn((data: object) => data),
    save: vi.fn(async (user: object) => ({ id: 'new-id', ...user })),
  };
  const transactionMembershipRepo = {
    create: vi.fn((data: object) => data),
    save: vi.fn(async (membership: object) => membership),
  };
  const dataSource = {
    getRepository: vi.fn((entity: unknown) =>
      entity === UserCompanyRole ? membershipRepo : undefined,
    ),
    transaction: vi.fn(async (fn: (manager: unknown) => unknown) =>
      fn({
        getRepository: (entity: unknown) =>
          entity === UserCompanyRole ? transactionMembershipRepo : transactionRepo,
      }),
    ),
  };
  const service = new UserService(repo as never, dataSource as never);
  return { service, repo, membershipRepo, transactionRepo, transactionMembershipRepo, dataSource };
}

const COMPANY = 'company-1';

const input = {
  firstName: 'Ana',
  lastName: 'Gómez',
  email: 'ana@example.com',
  documentNumber: '123456789',
  roleId: 'role-1',
};

// El usuario es de esta empresa y solo trabaja en ella.
function isOnlyMemberHere(membershipRepo: { existsBy: ReturnType<typeof vi.fn> }) {
  membershipRepo.existsBy.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
}

// El usuario es de esta empresa y además trabaja en otra.
function alsoWorksElsewhere(membershipRepo: { existsBy: ReturnType<typeof vi.fn> }) {
  membershipRepo.existsBy.mockResolvedValueOnce(true).mockResolvedValueOnce(true);
}

describe('UserService', () => {
  describe('findAll', () => {
    it('lists only the users that have a membership in the company', async () => {
      const { service, repo, membershipRepo } = createService();
      membershipRepo.find.mockResolvedValue([{ userId: 'u1' }, { userId: 'u1' }, { userId: 'u2' }]);
      repo.find.mockResolvedValue([{ id: 'u1' }, { id: 'u2' }]);

      const users = await service.findAll(COMPANY);

      expect(membershipRepo.find).toHaveBeenCalledWith({ where: { companyId: COMPANY } });
      expect(repo.find).toHaveBeenCalledWith({ where: { id: In(['u1', 'u2']) } });
      expect(users).toHaveLength(2);
    });

    it('can narrow the list down by status', async () => {
      const { service, repo, membershipRepo } = createService();
      membershipRepo.find.mockResolvedValue([{ userId: 'u1' }]);
      repo.find.mockResolvedValue([]);

      await service.findAll(COMPANY, RecordStatus.ACTIVE);

      expect(repo.find).toHaveBeenCalledWith({
        where: { id: In(['u1']), status: RecordStatus.ACTIVE },
      });
    });

    it('returns nothing, without looking up users, when nobody belongs to the company', async () => {
      const { service, repo, membershipRepo } = createService();
      membershipRepo.find.mockResolvedValue([]);

      await expect(service.findAll(COMPANY)).resolves.toEqual([]);
      expect(repo.find).not.toHaveBeenCalled();
    });
  });

  describe('findInCompany', () => {
    it('answers a user of another company as if it did not exist', async () => {
      const { service, repo, membershipRepo } = createService();
      membershipRepo.existsBy.mockResolvedValue(false);

      await expect(service.findInCompany(COMPANY, 'u9')).rejects.toThrow(NotFoundException);
      expect(membershipRepo.existsBy).toHaveBeenCalledWith({ userId: 'u9', companyId: COMPANY });
      expect(repo.findOneBy).not.toHaveBeenCalled();
    });

    it('returns a member of the company', async () => {
      const { service, repo, membershipRepo } = createService();
      membershipRepo.existsBy.mockResolvedValue(true);
      repo.findOneBy.mockResolvedValue({ id: 'u1' });

      await expect(service.findInCompany(COMPANY, 'u1')).resolves.toEqual({ id: 'u1' });
    });
  });

  describe('create', () => {
    it('hashes documentNumber as the initial password', async () => {
      const { service, transactionRepo } = createService();
      transactionRepo.findOneBy.mockResolvedValue(null);

      const user = await service.create(COMPANY, input);

      const created = transactionRepo.create.mock.calls[0][0];
      expect(created.mustChangePassword).toBe(true);
      expect(created.passwordHash).not.toBe(input.documentNumber);
      expect(created).not.toHaveProperty('roleId');
      expect(user.id).toBe('new-id');
    });

    it('adds the new user to the company with the chosen role, in the same transaction', async () => {
      const { service, transactionRepo, transactionMembershipRepo, dataSource } = createService();
      transactionRepo.findOneBy.mockResolvedValue(null);

      await service.create(COMPANY, input);

      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
      expect(transactionMembershipRepo.create).toHaveBeenCalledWith({
        userId: 'new-id',
        companyId: COMPANY,
        roleId: 'role-1',
      });
    });

    it('throws when the email is already registered, without adding anyone to the company', async () => {
      const { service, transactionRepo, transactionMembershipRepo } = createService();
      transactionRepo.findOneBy.mockResolvedValue({ id: 'existing' });

      await expect(service.create(COMPANY, input)).rejects.toThrow(ConflictException);
      expect(transactionMembershipRepo.save).not.toHaveBeenCalled();
    });

    it('reports an unknown role as a bad request', async () => {
      const { service, transactionRepo, transactionMembershipRepo } = createService();
      transactionRepo.findOneBy.mockResolvedValue(null);
      const foreignKeyViolation = Object.assign(new Error('fk'), { code: '23503' });
      transactionMembershipRepo.save.mockRejectedValue(
        new QueryFailedError('INSERT', [], foreignKeyViolation),
      );

      await expect(service.create(COMPANY, input)).rejects.toThrow(BadRequestException);
    });
  });

  describe('update', () => {
    it('applies changes inside a transaction', async () => {
      const { service, repo, membershipRepo, dataSource } = createService();
      isOnlyMemberHere(membershipRepo);
      repo.findOneBy.mockResolvedValue({ id: '1', firstName: 'Ana' });

      const result = await service.update(COMPANY, '1', { firstName: 'Ana María' });

      expect(dataSource.transaction).toHaveBeenCalled();
      expect(result.firstName).toBe('Ana María');
    });

    it('throws when the user is not a member of the company', async () => {
      const { service, membershipRepo, dataSource } = createService();
      membershipRepo.existsBy.mockResolvedValue(false);

      await expect(service.update(COMPANY, 'missing', { firstName: 'X' })).rejects.toThrow(
        NotFoundException,
      );
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('refuses to change a user who also works in another company', async () => {
      const { service, repo, membershipRepo, dataSource } = createService();
      alsoWorksElsewhere(membershipRepo);
      repo.findOneBy.mockResolvedValue({ id: '1', firstName: 'Ana' });

      await expect(service.update(COMPANY, '1', { firstName: 'X' })).rejects.toThrow(
        ForbiddenException,
      );
      expect(dataSource.transaction).not.toHaveBeenCalled();
      // Solo cuentan las membresías activas: una revocada en otra empresa ya no la protege.
      expect(membershipRepo.existsBy).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ userId: '1', status: RecordStatus.ACTIVE }),
      );
    });
  });

  describe('deactivate', () => {
    it('sets status to INACTIVE inside a transaction', async () => {
      const { service, repo, membershipRepo, dataSource } = createService();
      isOnlyMemberHere(membershipRepo);
      repo.findOneBy.mockResolvedValue({ id: '1', status: RecordStatus.ACTIVE });

      const result = await service.deactivate(COMPANY, '1');

      expect(dataSource.transaction).toHaveBeenCalled();
      expect(result.status).toBe(RecordStatus.INACTIVE);
    });

    it('throws when the user is not a member of the company', async () => {
      const { service, membershipRepo } = createService();
      membershipRepo.existsBy.mockResolvedValue(false);

      await expect(service.deactivate(COMPANY, 'missing')).rejects.toThrow(NotFoundException);
    });

    it('refuses to deactivate an account that another company also uses', async () => {
      const { service, repo, membershipRepo, dataSource } = createService();
      alsoWorksElsewhere(membershipRepo);
      repo.findOneBy.mockResolvedValue({ id: '1', status: RecordStatus.ACTIVE });

      await expect(service.deactivate(COMPANY, '1')).rejects.toThrow(ForbiddenException);
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });
  });

  describe('resetPassword', () => {
    it('leaves the document number as the password and forces a change', async () => {
      const { service, repo, membershipRepo } = createService();
      isOnlyMemberHere(membershipRepo);
      repo.findOneBy.mockResolvedValue({ id: '1', documentNumber: '123456789' });

      const result = await service.resetPassword(COMPANY, '1');

      expect(result.mustChangePassword).toBe(true);
      expect(await bcrypt.compare('123456789', result.passwordHash)).toBe(true);
    });

    it('refuses to reset the password of someone who also works in another company', async () => {
      const { service, repo, membershipRepo, dataSource } = createService();
      alsoWorksElsewhere(membershipRepo);
      repo.findOneBy.mockResolvedValue({ id: '1', documentNumber: '123456789' });

      await expect(service.resetPassword(COMPANY, '1')).rejects.toThrow(ForbiddenException);
      expect(dataSource.transaction).not.toHaveBeenCalled();
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
