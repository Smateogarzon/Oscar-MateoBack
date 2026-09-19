import { NotFoundException } from '@nestjs/common';
import { RolePermissionService } from './role-permission.service.js';

function createService() {
  const repository = { find: vi.fn().mockResolvedValue([]), findOneBy: vi.fn() };
  const transactionRepository = {
    create: vi.fn((value: unknown) => value),
    save: vi.fn(async (value: object) => ({ id: 'rp-1', ...value })),
    delete: vi.fn().mockResolvedValue(undefined),
  };
  const dataSource = {
    transaction: vi.fn(async (fn: (manager: unknown) => unknown) =>
      fn({ getRepository: () => transactionRepository }),
    ),
  };

  const service = new RolePermissionService(repository as never, dataSource as never);
  return { service, repository, transactionRepository };
}

describe('RolePermissionService', () => {
  describe('findAll', () => {
    it('only lists the assignments of the given company', async () => {
      const { service, repository } = createService();

      await service.findAll('company-1');

      expect(repository.find).toHaveBeenCalledWith({ where: { companyId: 'company-1' } });
    });

    it('can narrow the list down to one role', async () => {
      const { service, repository } = createService();

      await service.findAll('company-1', 'role-1');

      expect(repository.find).toHaveBeenCalledWith({
        where: { companyId: 'company-1', roleId: 'role-1' },
      });
    });
  });

  describe('create', () => {
    it('saves the assignment under the given company', async () => {
      const { service, transactionRepository } = createService();

      await service.create('company-1', { roleId: 'role-1', permissionId: 'permission-1' });

      expect(transactionRepository.create).toHaveBeenCalledWith({
        roleId: 'role-1',
        permissionId: 'permission-1',
        companyId: 'company-1',
      });
    });
  });

  describe('remove', () => {
    it('looks the assignment up inside the company, so another company cannot delete it by id', async () => {
      const { service, repository, transactionRepository } = createService();
      repository.findOneBy.mockResolvedValue(null);

      await expect(service.remove('company-1', 'rp-9')).rejects.toThrow(NotFoundException);
      expect(repository.findOneBy).toHaveBeenCalledWith({ id: 'rp-9', companyId: 'company-1' });
      expect(transactionRepository.delete).not.toHaveBeenCalled();
    });

    it('deletes an assignment of the company', async () => {
      const { service, repository, transactionRepository } = createService();
      repository.findOneBy.mockResolvedValue({ id: 'rp-1', companyId: 'company-1' });

      await expect(service.remove('company-1', 'rp-1')).resolves.toBe(true);
      expect(transactionRepository.delete).toHaveBeenCalledWith('rp-1');
    });
  });
});
