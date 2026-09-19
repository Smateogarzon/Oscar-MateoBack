import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { RecordStatus } from '../../common/enums/record-status.enum.js';
import { UserCompanyRoleService } from './user-company-role.service.js';

function createService() {
  const repo = { find: vi.fn().mockResolvedValue([]), findOneBy: vi.fn() };
  const transactionRepo = {
    existsBy: vi.fn(),
    create: vi.fn((data: object) => data),
    save: vi.fn(async (membership: object) => ({ id: 'ucr-1', ...membership })),
  };
  const dataSource = {
    transaction: vi.fn(async (fn: (manager: unknown) => unknown) =>
      fn({ getRepository: () => transactionRepo }),
    ),
  };
  const service = new UserCompanyRoleService(repo as never, dataSource as never);
  return { service, repo, transactionRepo, dataSource };
}

const COMPANY = 'company-1';
const input = { userId: 'user-1', companyId: COMPANY, roleId: 'role-1' };

describe('UserCompanyRoleService', () => {
  describe('findAll', () => {
    it('only lists the memberships of the company', async () => {
      const { service, repo } = createService();

      await service.findAll(COMPANY);

      expect(repo.find).toHaveBeenCalledWith({ where: { companyId: COMPANY } });
    });

    it('can narrow the list down by user and status', async () => {
      const { service, repo } = createService();

      await service.findAll(COMPANY, 'user-1', RecordStatus.ACTIVE);

      expect(repo.find).toHaveBeenCalledWith({
        where: { companyId: COMPANY, userId: 'user-1', status: RecordStatus.ACTIVE },
      });
    });
  });

  describe('findOne', () => {
    it('looks the membership up inside the company', async () => {
      const { service, repo } = createService();
      repo.findOneBy.mockResolvedValue(null);

      await expect(service.findOne(COMPANY, 'ucr-9')).rejects.toThrow(NotFoundException);
      expect(repo.findOneBy).toHaveBeenCalledWith({ id: 'ucr-9', companyId: COMPANY });
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

    it('does not add a role to someone who is not part of the company', async () => {
      const { service, transactionRepo } = createService();
      transactionRepo.existsBy.mockResolvedValue(false);

      await expect(service.create(COMPANY, input)).rejects.toThrow(NotFoundException);
      expect(transactionRepo.existsBy).toHaveBeenCalledWith({ userId: 'user-1', companyId: COMPANY });
      expect(transactionRepo.save).not.toHaveBeenCalled();
    });

    it('adds a role to a member of the company, inside a transaction', async () => {
      const { service, transactionRepo, dataSource } = createService();
      transactionRepo.existsBy.mockResolvedValue(true);

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

    it('cannot reach a membership of another company by id', async () => {
      const { service, repo, dataSource } = createService();
      repo.findOneBy.mockResolvedValue(null);

      await expect(service.deactivate(COMPANY, 'ucr-9')).rejects.toThrow(NotFoundException);
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });
  });
});
