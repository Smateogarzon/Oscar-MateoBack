import { BadRequestException, NotFoundException } from '@nestjs/common';
import { COMPANY_VISIBLE_ROLE } from '../../common/access/platform-role.js';
import { RoleScope } from '../role/entities/role-scope.enum.js';
import { Role } from '../role/entities/role.entity.js';
import { RolePermissionService } from './role-permission.service.js';

function createService() {
  const repository = { find: vi.fn().mockResolvedValue([]), findOneBy: vi.fn() };
  const transactionRepository = {
    create: vi.fn((value: unknown) => value),
    save: vi.fn(async (value: object) => ({ id: 'rp-1', ...value })),
    delete: vi.fn().mockResolvedValue(undefined),
  };
  // El rol al que se le asigna el permiso: por defecto, uno de empresa.
  const roleRepository = {
    findOneBy: vi.fn().mockResolvedValue({ id: 'role-1', scope: RoleScope.COMPANY }),
  };
  const dataSource = {
    transaction: vi.fn(async (fn: (manager: unknown) => unknown) =>
      fn({
        getRepository: (entity: unknown) =>
          entity === Role ? roleRepository : transactionRepository,
      }),
    ),
  };

  const service = new RolePermissionService(repository as never, dataSource as never);
  return { service, repository, transactionRepository, roleRepository };
}

describe('RolePermissionService', () => {
  describe('findAll', () => {
    it('only lists the assignments of the given company, without those of platform roles', async () => {
      const { service, repository } = createService();

      await service.findAll('company-1');

      expect(repository.find).toHaveBeenCalledWith({
        where: { companyId: 'company-1', role: COMPANY_VISIBLE_ROLE },
      });
    });

    it('can narrow the list down to one role', async () => {
      const { service, repository } = createService();

      await service.findAll('company-1', 'role-1');

      expect(repository.find).toHaveBeenCalledWith({
        where: { companyId: 'company-1', role: COMPANY_VISIBLE_ROLE, roleId: 'role-1' },
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

    it('does not change the permissions of a platform role, even knowing its id', async () => {
      const { service, roleRepository, transactionRepository } = createService();
      roleRepository.findOneBy.mockResolvedValue({ id: 'role-1', scope: RoleScope.GLOBAL });

      await expect(
        service.create('company-1', { roleId: 'role-1', permissionId: 'permission-1' }),
      ).rejects.toThrow(BadRequestException);
      expect(transactionRepository.save).not.toHaveBeenCalled();
    });

    it('rejects a role that does not exist', async () => {
      const { service, roleRepository, transactionRepository } = createService();
      roleRepository.findOneBy.mockResolvedValue(null);

      await expect(
        service.create('company-1', { roleId: 'role-1', permissionId: 'permission-1' }),
      ).rejects.toThrow(BadRequestException);
      expect(transactionRepository.save).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('looks the assignment up inside the company and outside platform roles', async () => {
      const { service, repository, transactionRepository } = createService();
      repository.findOneBy.mockResolvedValue(null);

      await expect(service.remove('company-1', 'rp-9')).rejects.toThrow(NotFoundException);
      expect(repository.findOneBy).toHaveBeenCalledWith({
        id: 'rp-9',
        companyId: 'company-1',
        role: COMPANY_VISIBLE_ROLE,
      });
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
