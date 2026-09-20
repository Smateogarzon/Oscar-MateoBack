import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import { RecordStatus } from '../../common/enums/record-status.enum.js';
import { CashSessionStatus } from '../cash-session/entities/cash-session-status.enum.js';
import { CashSession } from '../cash-session/entities/cash-session.entity.js';
import { LocationType } from '../location/entities/location-type.enum.js';
import { Location } from '../location/entities/location.entity.js';
import { CashRegisterService } from './cash-register.service.js';
import { CashRegister } from './entities/cash-register.entity.js';

const COMPANY = 'company-1';

// El error de la base de datos por violar un índice único, como lo entrega el driver de Postgres.
const uniqueViolation = () =>
  new QueryFailedError('INSERT', [], Object.assign(new Error('duplicate key'), { code: '23505' }));

// Una caja tal como la entrega la base de datos.
const stored = (overrides: Record<string, unknown> = {}) => ({
  id: 'register-1',
  storeId: 'store-1',
  name: 'Caja principal',
  code: 'C1',
  status: RecordStatus.ACTIVE,
  ...overrides,
});

function createService() {
  const registerRepo = { find: vi.fn().mockResolvedValue([]), findOne: vi.fn() };
  const txRegisterRepo = {
    existsBy: vi.fn().mockResolvedValue(false),
    findOne: vi.fn(),
    create: vi.fn((value: unknown) => value),
    save: vi.fn(async (value: object) => ({ id: 'register-1', ...value })),
  };
  const txLocationRepo = { findOneBy: vi.fn().mockResolvedValue({ id: 'store-1' }) };
  const txSessionRepo = { existsBy: vi.fn().mockResolvedValue(false) };
  const dataSource = {
    transaction: vi.fn(async (fn: (manager: unknown) => unknown) =>
      fn({
        getRepository: (entity: unknown) =>
          entity === Location
            ? txLocationRepo
            : entity === CashSession
              ? txSessionRepo
              : entity === CashRegister
                ? txRegisterRepo
                : undefined,
      }),
    ),
  };

  const service = new CashRegisterService(registerRepo as never, dataSource as never);
  return { service, registerRepo, txRegisterRepo, txLocationRepo, txSessionRepo, dataSource };
}

describe('CashRegisterService', () => {
  describe('findAll', () => {
    it('only lists the registers of the stores of the company, by name', async () => {
      const { service, registerRepo } = createService();

      await service.findAll(COMPANY);

      expect(registerRepo.find).toHaveBeenCalledWith({
        where: { store: { companyId: COMPANY } },
        order: { name: 'ASC' },
      });
    });

    it('can narrow the list down by store and status', async () => {
      const { service, registerRepo } = createService();

      await service.findAll(COMPANY, { storeId: 'store-1', status: RecordStatus.ACTIVE });

      expect(registerRepo.find).toHaveBeenCalledWith({
        where: { store: { companyId: COMPANY }, storeId: 'store-1', status: RecordStatus.ACTIVE },
        order: { name: 'ASC' },
      });
    });
  });

  describe('findOne', () => {
    it('looks the register up through its store, so one of another company does not exist', async () => {
      const { service, registerRepo } = createService();
      registerRepo.findOne.mockResolvedValue(null);

      await expect(service.findOne(COMPANY, 'register-9')).rejects.toThrow(NotFoundException);
      expect(registerRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'register-9', store: { companyId: COMPANY } },
      });
    });
  });

  describe('create', () => {
    it('creates the register in an active store of the company, with name and code trimmed', async () => {
      const { service, txLocationRepo, txRegisterRepo } = createService();

      const register = await service.create(COMPANY, {
        storeId: 'store-1',
        name: '  Caja 1 ',
        code: ' C1 ',
      });

      expect(txLocationRepo.findOneBy).toHaveBeenCalledWith({
        id: 'store-1',
        companyId: COMPANY,
        type: LocationType.STORE,
        status: RecordStatus.ACTIVE,
      });
      expect(txRegisterRepo.existsBy).toHaveBeenCalledWith({ storeId: 'store-1', code: 'C1' });
      expect(txRegisterRepo.create).toHaveBeenCalledWith({
        storeId: 'store-1',
        name: 'Caja 1',
        code: 'C1',
      });
      expect(register.id).toBe('register-1');
    });

    it('only puts registers in stores: not in warehouses, not in other companies', async () => {
      const { service, txLocationRepo, txRegisterRepo } = createService();
      txLocationRepo.findOneBy.mockResolvedValue(null);

      await expect(
        service.create(COMPANY, { storeId: 'warehouse-1', name: 'Caja', code: 'C1' }),
      ).rejects.toThrow(NotFoundException);
      expect(txRegisterRepo.save).not.toHaveBeenCalled();
    });

    it('rejects a code the store already uses', async () => {
      const { service, txRegisterRepo } = createService();
      txRegisterRepo.existsBy.mockResolvedValue(true);

      await expect(
        service.create(COMPANY, { storeId: 'store-1', name: 'Caja', code: 'C1' }),
      ).rejects.toThrow(ConflictException);
      expect(txRegisterRepo.save).not.toHaveBeenCalled();
    });

    it('rejects a blank name or code, before touching the database', async () => {
      const { service, dataSource } = createService();

      await expect(
        service.create(COMPANY, { storeId: 'store-1', name: '  ', code: 'C1' }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.create(COMPANY, { storeId: 'store-1', name: 'Caja', code: '  ' }),
      ).rejects.toThrow(BadRequestException);
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('turns the unique index error of two creations at once into the same conflict', async () => {
      const { service, txRegisterRepo } = createService();
      txRegisterRepo.save.mockRejectedValue(uniqueViolation());

      await expect(
        service.create(COMPANY, { storeId: 'store-1', name: 'Caja', code: 'C1' }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('update', () => {
    it('changes the name and the code, and never the store', async () => {
      const { service, txRegisterRepo } = createService();
      txRegisterRepo.findOne.mockResolvedValue(stored());

      const register = await service.update(COMPANY, 'register-1', {
        name: ' Caja del fondo ',
        code: ' C2 ',
      });

      expect(txRegisterRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'register-1', store: { companyId: COMPANY } },
      });
      expect(txRegisterRepo.existsBy).toHaveBeenCalledWith({ storeId: 'store-1', code: 'C2' });
      expect(register).toMatchObject({ name: 'Caja del fondo', code: 'C2', storeId: 'store-1' });
    });

    it('does not look for duplicates when the code stays the same', async () => {
      const { service, txRegisterRepo } = createService();
      txRegisterRepo.findOne.mockResolvedValue(stored());

      await service.update(COMPANY, 'register-1', { name: 'Otro nombre', code: 'C1' });

      expect(txRegisterRepo.existsBy).not.toHaveBeenCalled();
    });

    it('rejects a code that another register of the store has', async () => {
      const { service, txRegisterRepo } = createService();
      txRegisterRepo.findOne.mockResolvedValue(stored());
      txRegisterRepo.existsBy.mockResolvedValue(true);

      await expect(service.update(COMPANY, 'register-1', { code: 'C2' })).rejects.toThrow(
        ConflictException,
      );
      expect(txRegisterRepo.save).not.toHaveBeenCalled();
    });

    it('rejects a blank name or code, before touching the database', async () => {
      const { service, dataSource } = createService();

      await expect(service.update(COMPANY, 'register-1', { name: ' ' })).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.update(COMPANY, 'register-1', { code: ' ' })).rejects.toThrow(
        BadRequestException,
      );
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('cannot reach a register of another company', async () => {
      const { service, txRegisterRepo } = createService();
      txRegisterRepo.findOne.mockResolvedValue(null);

      await expect(service.update(COMPANY, 'register-9', { name: 'X' })).rejects.toThrow(
        NotFoundException,
      );
      expect(txRegisterRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('deactivate', () => {
    it('deactivates a register with no open shift, locking it first', async () => {
      const { service, txRegisterRepo, txSessionRepo } = createService();
      txRegisterRepo.findOne.mockResolvedValue(stored());

      const register = await service.deactivate(COMPANY, 'register-1');

      expect(txRegisterRepo.findOne).toHaveBeenLastCalledWith({
        where: { id: 'register-1' },
        lock: { mode: 'pessimistic_write' },
      });
      expect(txSessionRepo.existsBy).toHaveBeenCalledWith({
        cashRegisterId: 'register-1',
        status: CashSessionStatus.OPEN,
      });
      expect(register.status).toBe(RecordStatus.INACTIVE);
    });

    it('does not deactivate a register while its shift is open', async () => {
      const { service, txRegisterRepo, txSessionRepo } = createService();
      txRegisterRepo.findOne.mockResolvedValue(stored());
      txSessionRepo.existsBy.mockResolvedValue(true);

      await expect(service.deactivate(COMPANY, 'register-1')).rejects.toThrow(ConflictException);
      expect(txRegisterRepo.save).not.toHaveBeenCalled();
    });

    it('cannot reach a register of another company', async () => {
      const { service, txRegisterRepo } = createService();
      txRegisterRepo.findOne.mockResolvedValue(null);

      await expect(service.deactivate(COMPANY, 'register-9')).rejects.toThrow(NotFoundException);
      expect(txRegisterRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('activate', () => {
    it('brings a deactivated register back', async () => {
      const { service, txRegisterRepo } = createService();
      txRegisterRepo.findOne.mockResolvedValue(stored({ status: RecordStatus.INACTIVE }));

      const register = await service.activate(COMPANY, 'register-1');

      expect(register.status).toBe(RecordStatus.ACTIVE);
    });

    it('cannot reach a register of another company', async () => {
      const { service, txRegisterRepo } = createService();
      txRegisterRepo.findOne.mockResolvedValue(null);

      await expect(service.activate(COMPANY, 'register-9')).rejects.toThrow(NotFoundException);
      expect(txRegisterRepo.save).not.toHaveBeenCalled();
    });
  });
});
