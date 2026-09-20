import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { RecordStatus } from '../../common/enums/record-status.enum.js';
import { CashRegister } from '../cash-register/entities/cash-register.entity.js';
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
  const cashRegisterRepo = {
    create: vi.fn((data: object) => data),
    save: vi.fn(async (register: object) => ({ id: 'register-1', ...register })),
  };
  const dataSource = {
    transaction: vi.fn(async (fn: (manager: unknown) => unknown) =>
      fn({
        getRepository: (entity: unknown) =>
          entity === CashRegister ? cashRegisterRepo : transactionRepo,
      }),
    ),
  };
  const service = new LocationService(repo as never, dataSource as never);
  return { service, repo, transactionRepo, cashRegisterRepo, dataSource };
}

const COMPANY = 'company-1';

const input = {
  companyId: COMPANY,
  name: 'Sede principal',
  type: LocationType.STORE,
};

describe('LocationService', () => {
  describe('findAll', () => {
    it('only lists the locations of the company', async () => {
      const { service, repo } = createService();
      repo.find.mockResolvedValue([]);

      await service.findAll(COMPANY);

      expect(repo.find).toHaveBeenCalledWith({ where: { companyId: COMPANY } });
    });

    it('can narrow the list down by status', async () => {
      const { service, repo } = createService();
      repo.find.mockResolvedValue([]);

      await service.findAll(COMPANY, RecordStatus.ACTIVE);

      expect(repo.find).toHaveBeenCalledWith({
        where: { companyId: COMPANY, status: RecordStatus.ACTIVE },
      });
    });
  });

  describe('create', () => {
    it('creates a location inside a transaction', async () => {
      const { service, dataSource } = createService();

      const location = await service.create(COMPANY, input);

      expect(dataSource.transaction).toHaveBeenCalled();
      expect(location).toMatchObject(input);
    });

    it('gives a new store its cash register, named after the store, in the same transaction', async () => {
      const { service, cashRegisterRepo, dataSource } = createService();

      await service.create(COMPANY, input);

      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
      expect(cashRegisterRepo.create).toHaveBeenCalledWith({
        storeId: '1',
        name: 'Sede principal',
        code: 'C1',
      });
      expect(cashRegisterRepo.save).toHaveBeenCalledTimes(1);
    });

    it('cuts the store name to what a cash register name admits', async () => {
      const { service, cashRegisterRepo } = createService();

      await service.create(COMPANY, { ...input, name: 'A'.repeat(120) });

      expect(cashRegisterRepo.create.mock.calls[0][0].name).toHaveLength(80);
    });

    it('does not give a warehouse a cash register', async () => {
      const { service, cashRegisterRepo } = createService();

      const location = await service.create(COMPANY, { ...input, type: LocationType.WAREHOUSE });

      expect(location.type).toBe(LocationType.WAREHOUSE);
      expect(cashRegisterRepo.save).not.toHaveBeenCalled();
    });

    it('fails as a whole when the cash register cannot be saved, so the store is not left without one', async () => {
      const { service, cashRegisterRepo } = createService();
      cashRegisterRepo.save.mockRejectedValue(new Error('boom'));

      await expect(service.create(COMPANY, input)).rejects.toThrow('boom');
    });

    it('rejects an input that points at another company, before touching the database', async () => {
      const { service, dataSource } = createService();

      await expect(service.create(COMPANY, { ...input, companyId: 'company-2' })).rejects.toThrow(
        ForbiddenException,
      );
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('updates a location inside a transaction', async () => {
      const { service, repo, dataSource } = createService();
      repo.findOneBy.mockResolvedValue({ id: '1', ...input, status: RecordStatus.ACTIVE });

      const result = await service.update(COMPANY, '1', { name: 'Sede norte' });

      expect(dataSource.transaction).toHaveBeenCalled();
      expect(result.name).toBe('Sede norte');
    });

    it('cannot reach a location of another company by id', async () => {
      const { service, repo, dataSource } = createService();
      repo.findOneBy.mockResolvedValue(null);

      await expect(service.update(COMPANY, '9', { name: 'X' })).rejects.toThrow(NotFoundException);
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });
  });

  describe('deactivate', () => {
    it('deactivates a location inside a transaction', async () => {
      const { service, repo, dataSource } = createService();
      repo.findOneBy.mockResolvedValue({ id: '1', ...input, status: RecordStatus.ACTIVE });

      const result = await service.deactivate(COMPANY, '1');

      expect(dataSource.transaction).toHaveBeenCalled();
      expect(result.status).toBe(RecordStatus.INACTIVE);
    });

    it('cannot reach a location of another company by id', async () => {
      const { service, repo, dataSource } = createService();
      repo.findOneBy.mockResolvedValue(null);

      await expect(service.deactivate(COMPANY, '9')).rejects.toThrow(NotFoundException);
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });
  });

  describe('findOne', () => {
    it('looks the location up inside the company', async () => {
      const { service, repo } = createService();
      repo.findOneBy.mockResolvedValue(null);

      await expect(service.findOne(COMPANY, 'missing')).rejects.toThrow(NotFoundException);
      expect(repo.findOneBy).toHaveBeenCalledWith({ id: 'missing', companyId: COMPANY });
    });
  });
});
