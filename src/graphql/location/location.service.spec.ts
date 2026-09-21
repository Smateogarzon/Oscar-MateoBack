import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { In } from 'typeorm';
import { RecordStatus } from '../../common/enums/record-status.enum.js';
import { CashRegister } from '../cash-register/entities/cash-register.entity.js';
import { CashSessionStatus } from '../cash-session/entities/cash-session-status.enum.js';
import { CashSession } from '../cash-session/entities/cash-session.entity.js';
import { PaymentMethod } from '../payment-method/entities/payment-method.entity.js';
import { StorePaymentMethod } from '../store-payment-method/entities/store-payment-method.entity.js';
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
    // Por defecto la tienda no tiene cajas: cada prueba pone las que necesita.
    find: vi.fn().mockResolvedValue([]),
    findOneBy: vi.fn().mockResolvedValue(null),
  };
  const cashSessionRepo = { existsBy: vi.fn().mockResolvedValue(false) };
  // Los medios de pago de la empresa y lo que acepta la tienda nueva (ver allowAllPaymentMethods).
  const paymentMethodRepo = { find: vi.fn().mockResolvedValue([{ id: 'cash' }, { id: 'card' }]) };
  const storePaymentMethodRepo = {
    find: vi.fn().mockResolvedValue([]),
    create: vi.fn((data: object) => data),
    save: vi.fn(async (rows: object[]) => rows),
  };
  const dataSource = {
    transaction: vi.fn(async (fn: (manager: unknown) => unknown) =>
      fn({
        getRepository: (entity: unknown) =>
          entity === CashRegister
            ? cashRegisterRepo
            : entity === CashSession
              ? cashSessionRepo
              : entity === PaymentMethod
                ? paymentMethodRepo
                : entity === StorePaymentMethod
                  ? storePaymentMethodRepo
                  : transactionRepo,
      }),
    ),
  };
  const service = new LocationService(repo as never, dataSource as never);
  return {
    service,
    repo,
    transactionRepo,
    cashRegisterRepo,
    cashSessionRepo,
    storePaymentMethodRepo,
    dataSource,
  };
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

    it('lets a new store accept every payment method of the company', async () => {
      const { service, storePaymentMethodRepo } = createService();

      await service.create(COMPANY, input);

      expect(storePaymentMethodRepo.save).toHaveBeenCalledWith([
        { storeId: '1', paymentMethodId: 'cash' },
        { storeId: '1', paymentMethodId: 'card' },
      ]);
    });

    it('a warehouse accepts nothing: it does not sell', async () => {
      const { service, storePaymentMethodRepo } = createService();

      await service.create(COMPANY, { ...input, type: LocationType.WAREHOUSE });

      expect(storePaymentMethodRepo.save).not.toHaveBeenCalled();
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

    it('renames the cash register that was born with the store, so both keep the same name', async () => {
      const { service, repo, cashRegisterRepo } = createService();
      repo.findOneBy.mockResolvedValue({ id: '1', ...input, status: RecordStatus.ACTIVE });
      cashRegisterRepo.findOneBy.mockResolvedValue({ id: 'register-1', name: 'Sede principal', code: 'C1' });

      await service.update(COMPANY, '1', { name: 'Sede norte' });

      expect(cashRegisterRepo.findOneBy).toHaveBeenCalledWith({ storeId: '1', code: 'C1' });
      expect(cashRegisterRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'register-1', name: 'Sede norte' }),
      );
    });

    it('does not touch a register someone renamed by hand', async () => {
      const { service, repo, cashRegisterRepo } = createService();
      repo.findOneBy.mockResolvedValue({ id: '1', ...input, status: RecordStatus.ACTIVE });
      cashRegisterRepo.findOneBy.mockResolvedValue({ id: 'register-1', name: 'Caja de la entrada', code: 'C1' });

      await service.update(COMPANY, '1', { name: 'Sede norte' });

      expect(cashRegisterRepo.save).not.toHaveBeenCalled();
    });

    it('does not look for a register when the name did not change, nor for a warehouse', async () => {
      const { service, repo, cashRegisterRepo } = createService();
      repo.findOneBy.mockResolvedValue({ id: '1', ...input, status: RecordStatus.ACTIVE });

      await service.update(COMPANY, '1', { city: 'Bogotá' });
      expect(cashRegisterRepo.findOneBy).not.toHaveBeenCalled();

      repo.findOneBy.mockResolvedValue({
        id: '1',
        ...input,
        type: LocationType.WAREHOUSE,
        status: RecordStatus.ACTIVE,
      });
      await service.update(COMPANY, '1', { name: 'Bodega norte' });
      expect(cashRegisterRepo.findOneBy).not.toHaveBeenCalled();
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

    it('refuses while one of its registers has an open shift: it has to be closed with its count first', async () => {
      const { service, repo, cashRegisterRepo, cashSessionRepo, transactionRepo } = createService();
      repo.findOneBy.mockResolvedValue({ id: '1', ...input, status: RecordStatus.ACTIVE });
      cashRegisterRepo.find.mockResolvedValue([{ id: 'register-1' }, { id: 'register-2' }]);
      cashSessionRepo.existsBy.mockResolvedValue(true);

      await expect(service.deactivate(COMPANY, '1')).rejects.toThrow(ConflictException);
      expect(cashSessionRepo.existsBy).toHaveBeenCalledWith({
        cashRegisterId: In(['register-1', 'register-2']),
        status: CashSessionStatus.OPEN,
      });
      // La tienda se queda como estaba.
      expect(transactionRepo.save).not.toHaveBeenCalled();
    });

    it('goes through when its registers have no open shift', async () => {
      const { service, repo, cashRegisterRepo } = createService();
      repo.findOneBy.mockResolvedValue({ id: '1', ...input, status: RecordStatus.ACTIVE });
      cashRegisterRepo.find.mockResolvedValue([{ id: 'register-1' }]);

      const result = await service.deactivate(COMPANY, '1');

      expect(result.status).toBe(RecordStatus.INACTIVE);
    });

    it('does not ask about shifts when the location has no registers (a warehouse)', async () => {
      const { service, repo, cashSessionRepo } = createService();
      repo.findOneBy.mockResolvedValue({ id: '1', ...input, status: RecordStatus.ACTIVE });

      await service.deactivate(COMPANY, '1');

      expect(cashSessionRepo.existsBy).not.toHaveBeenCalled();
    });
  });

  describe('activate', () => {
    it('puts a location back in service inside a transaction', async () => {
      const { service, repo, dataSource } = createService();
      repo.findOneBy.mockResolvedValue({ id: '1', ...input, status: RecordStatus.INACTIVE });

      const result = await service.activate(COMPANY, '1');

      expect(dataSource.transaction).toHaveBeenCalled();
      expect(result.status).toBe(RecordStatus.ACTIVE);
    });

    it('does not create another cash register: the store keeps the ones it had', async () => {
      const { service, repo, cashRegisterRepo } = createService();
      repo.findOneBy.mockResolvedValue({ id: '1', ...input, status: RecordStatus.INACTIVE });

      await service.activate(COMPANY, '1');

      expect(cashRegisterRepo.save).not.toHaveBeenCalled();
    });

    it('cannot reach a location of another company by id', async () => {
      const { service, repo, dataSource } = createService();
      repo.findOneBy.mockResolvedValue(null);

      await expect(service.activate(COMPANY, '9')).rejects.toThrow(NotFoundException);
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
