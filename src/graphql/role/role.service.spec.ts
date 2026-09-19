import { NotFoundException } from '@nestjs/common';
import { Not } from 'typeorm';
import { RoleScope } from './entities/role-scope.enum.js';
import { RoleService } from './role.service.js';

function createService() {
  const repo = { find: vi.fn(), findOneBy: vi.fn() };
  const service = new RoleService(repo as never);
  return { service, repo };
}

describe('RoleService', () => {
  it('returns the roles a company can see', async () => {
    const { service, repo } = createService();
    repo.find.mockResolvedValue([{ id: '1', code: 'ADMIN' }]);

    await expect(service.findAll()).resolves.toEqual([{ id: '1', code: 'ADMIN' }]);
  });

  it('never offers platform roles (the super admin) to a company', async () => {
    const { service, repo } = createService();
    repo.find.mockResolvedValue([]);

    await service.findAll();

    expect(repo.find).toHaveBeenCalledWith({ where: { scope: Not(RoleScope.GLOBAL) } });
  });

  it('finds a role by id', async () => {
    const { service, repo } = createService();
    repo.findOneBy.mockResolvedValue({ id: '1', code: 'ADMIN' });

    await expect(service.findOne('1')).resolves.toEqual({ id: '1', code: 'ADMIN' });
  });

  it('answers a platform role as if it did not exist', async () => {
    const { service, repo } = createService();
    repo.findOneBy.mockResolvedValue(null);

    await expect(service.findOne('super-admin-id')).rejects.toThrow(NotFoundException);
    expect(repo.findOneBy).toHaveBeenCalledWith({
      id: 'super-admin-id',
      scope: Not(RoleScope.GLOBAL),
    });
  });

  it('throws when the role does not exist', async () => {
    const { service, repo } = createService();
    repo.findOneBy.mockResolvedValue(null);

    await expect(service.findOne('missing')).rejects.toThrow(NotFoundException);
  });
});
