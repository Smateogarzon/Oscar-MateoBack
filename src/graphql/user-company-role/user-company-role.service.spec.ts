import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { COMPANY_VISIBLE_ROLE } from '../../common/access/platform-role.js';
import { RecordStatus } from '../../common/enums/record-status.enum.js';
import { RoleScope } from '../role/entities/role-scope.enum.js';
import { Role } from '../role/entities/role.entity.js';
import { UserCompanyRoleService } from './user-company-role.service.js';

function createService() {
  const repo = { find: vi.fn().mockResolvedValue([]), findOneBy: vi.fn() };
  const transactionRepo = {
    existsBy: vi.fn(),
    create: vi.fn((data: object) => data),
    save: vi.fn(async (membership: object) => ({ id: 'ucr-1', ...membership })),
  };
  // El rol que se asigna: por defecto, uno de empresa.
  const roleRepo = {
    findOneBy: vi.fn().mockResolvedValue({ id: 'role-1', scope: RoleScope.COMPANY }),
  };
  const dataSource = {
    transaction: vi.fn(async (fn: (manager: unknown) => unknown) =>
      fn({ getRepository: (entity: unknown) => (entity === Role ? roleRepo : transactionRepo) }),
    ),
  };
  const service = new UserCompanyRoleService(repo as never, dataSource as never);
  return { service, repo, transactionRepo, roleRepo, dataSource };
}

// Qué responde la base a las consultas de membresía del usuario al que se le agrega el rol.
function targetUser(
  transactionRepo: { existsBy: ReturnType<typeof vi.fn> },
  { member = true, platform = false } = {},
) {
  transactionRepo.existsBy.mockImplementation(async (where: Record<string, unknown>) =>
    where.role ? platform : member,
  );
}

const COMPANY = 'company-1';
const input = { userId: 'user-1', companyId: COMPANY, roleId: 'role-1' };

describe('UserCompanyRoleService', () => {
  describe('findAll', () => {
    it('only lists the memberships of the company, without those of platform roles', async () => {
      const { service, repo } = createService();

      await service.findAll(COMPANY);

      expect(repo.find).toHaveBeenCalledWith({
        where: { companyId: COMPANY, role: COMPANY_VISIBLE_ROLE },
      });
    });

    it('can narrow the list down by user and status', async () => {
      const { service, repo } = createService();

      await service.findAll(COMPANY, 'user-1', RecordStatus.ACTIVE);

      expect(repo.find).toHaveBeenCalledWith({
        where: {
          companyId: COMPANY,
          role: COMPANY_VISIBLE_ROLE,
          userId: 'user-1',
          status: RecordStatus.ACTIVE,
        },
      });
    });
  });

  describe('findOne', () => {
    it('looks the membership up inside the company, ignoring platform roles', async () => {
      const { service, repo } = createService();
      repo.findOneBy.mockResolvedValue(null);

      await expect(service.findOne(COMPANY, 'ucr-9')).rejects.toThrow(NotFoundException);
      expect(repo.findOneBy).toHaveBeenCalledWith({
        id: 'ucr-9',
        companyId: COMPANY,
        role: COMPANY_VISIBLE_ROLE,
      });
    });
  });

  describe('create', () => {
    it('rejects an input that points at another company, before touching the database', async () => {
      const { service, dataSource } = createService();

      await expect(
        service.create(COMPANY, { ...input, companyId: 'company-2' }),
      ).rejects.toThrow(ForbiddenException);
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('does not assign a platform role, even knowing its id', async () => {
      const { service, roleRepo, transactionRepo } = createService();
      roleRepo.findOneBy.mockResolvedValue({ id: 'role-1', scope: RoleScope.GLOBAL });
      targetUser(transactionRepo);

      await expect(service.create(COMPANY, input)).rejects.toThrow(NotFoundException);
      expect(transactionRepo.save).not.toHaveBeenCalled();
    });

    it('does not assign a role that does not exist', async () => {
      const { service, roleRepo, transactionRepo } = createService();
      roleRepo.findOneBy.mockResolvedValue(null);
      targetUser(transactionRepo);

      await expect(service.create(COMPANY, input)).rejects.toThrow(NotFoundException);
      expect(transactionRepo.save).not.toHaveBeenCalled();
    });

    it('does not add a role to someone who is not part of the company', async () => {
      const { service, transactionRepo } = createService();
      targetUser(transactionRepo, { member: false });

      await expect(service.create(COMPANY, input)).rejects.toThrow(NotFoundException);
      expect(transactionRepo.existsBy).toHaveBeenCalledWith({ userId: 'user-1', companyId: COMPANY });
      expect(transactionRepo.save).not.toHaveBeenCalled();
    });

    it('does not add a role to a platform user (the super admin)', async () => {
      const { service, transactionRepo } = createService();
      targetUser(transactionRepo, { platform: true });

      await expect(service.create(COMPANY, input)).rejects.toThrow(NotFoundException);
      expect(transactionRepo.save).not.toHaveBeenCalled();
    });

    it('adds a role to a member of the company, inside a transaction', async () => {
      const { service, transactionRepo, dataSource } = createService();
      targetUser(transactionRepo);

      const membership = await service.create(COMPANY, input);

      expect(dataSource.transaction).toHaveBeenCalled();
      expect(transactionRepo.create).toHaveBeenCalledWith(input);
      expect(membership).toMatchObject(input);
    });
  });

  describe('deactivate', () => {
    it('deactivates a membership of the company', async () => {
      const { service, repo, dataSource } = createService();
      repo.findOneBy.mockResolvedValue({ id: 'ucr-1', companyId: COMPANY, status: RecordStatus.ACTIVE });

      const result = await service.deactivate(COMPANY, 'ucr-1');

      expect(dataSource.transaction).toHaveBeenCalled();
      expect(result.status).toBe(RecordStatus.INACTIVE);
    });

    it('cannot reach a membership of another company, or a platform one, by id', async () => {
      const { service, repo, dataSource } = createService();
      repo.findOneBy.mockResolvedValue(null);

      await expect(service.deactivate(COMPANY, 'ucr-9')).rejects.toThrow(NotFoundException);
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });
  });
});
