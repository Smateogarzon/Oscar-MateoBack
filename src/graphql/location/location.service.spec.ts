import { NotFoundException } from '@nestjs/common';
import { RecordStatus } from '../../common/enums/record-status.enum.js';
import { LocationType } from './entities/location-type.enum.js';
import { LocationService } from './location.service.js';

function createService() {
  const repo = {
    find: vi.fn(),
    findOneBy: vi.fn(),
  };
  const transactionRepo = {
    create: vi.fn((data: object) => data),
    save: vi.fn(async (location: object) => ({ id: '1', ...location })),
  };
  const dataSource = {
    transaction: vi.fn(async (fn: (manager: unknown) => unknown) =>
      fn({ getRepository: () => transactionRepo }),
    ),
  };
  const service = new LocationService(repo as never, dataSource as never);
  return { service, repo, transactionRepo, dataSource };
}

const input = {
  companyId: 'company-1',
  name: 'Sede principal',
  type: LocationType.STORE,
};

describe('LocationService', () => {
  it('creates a location inside a transaction', async () => {
    const { service, dataSource } = createService();

    const location = await service.create(input);

    expect(dataSource.transaction).toHaveBeenCalled();
    expect(location).toMatchObject(input);
  });

  it('updates a location inside a transaction', async () => {
    const { service, repo, dataSource } = createService();
    repo.findOneBy.mockResolvedValue({ id: '1', ...input, status: RecordStatus.ACTIVE });

    const result = await service.update('1', { name: 'Sede norte' });

    expect(dataSource.transaction).toHaveBeenCalled();
    expect(result.name).toBe('Sede norte');
  });

  it('deactivates a location inside a transaction', async () => {
    const { service, repo, dataSource } = createService();
    repo.findOneBy.mockResolvedValue({ id: '1', ...input, status: RecordStatus.ACTIVE });

    const result = await service.deactivate('1');

    expect(dataSource.transaction).toHaveBeenCalled();
    expect(result.status).toBe(RecordStatus.INACTIVE);
  });

  it('throws when the location does not exist', async () => {
    const { service, repo } = createService();
    repo.findOneBy.mockResolvedValue(null);

    await expect(service.findOne('missing')).rejects.toThrow(NotFoundException);
  });
});
