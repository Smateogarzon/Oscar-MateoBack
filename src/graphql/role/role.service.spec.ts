import { NotFoundException } from '@nestjs/common';
import { RoleService } from './role.service.js';

function createService() {
  const repo = { find: vi.fn(), findOneBy: vi.fn() };
  const service = new RoleService(repo as never);
  return { service, repo };
}

describe('RoleService', () => {
  it('returns all roles', async () => {
    const { service, repo } = createService();
    repo.find.mockResolvedValue([{ id: '1', code: 'ADMIN' }]);

    await expect(service.findAll()).resolves.toEqual([{ id: '1', code: 'ADMIN' }]);
  });

  it('finds a role by id', async () => {
    const { service, repo } = createService();
    repo.findOneBy.mockResolvedValue({ id: '1', code: 'ADMIN' });

    await expect(service.findOne('1')).resolves.toEqual({ id: '1', code: 'ADMIN' });
  });

  it('throws when the role does not exist', async () => {
    const { service, repo } = createService();
    repo.findOneBy.mockResolvedValue(null);

    await expect(service.findOne('missing')).rejects.toThrow(NotFoundException);
  });
});
