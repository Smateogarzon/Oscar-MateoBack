import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import { RecordStatus } from '../../common/enums/record-status.enum.js';
import { CashSessionStatus } from '../cash-session/entities/cash-session-status.enum.js';
import { CashSession } from '../cash-session/entities/cash-session.entity.js';
import { IdempotencyKey } from '../idempotency/entities/idempotency-key.entity.js';
import { fingerprintOf } from '../idempotency/idempotency.js';
import { LocationType } from '../location/entities/location-type.enum.js';
import { Location } from '../location/entities/location.entity.js';
import { CashRegisterService } from './cash-register.service.js';
import { CashRegister } from './entities/cash-register.entity.js';

const COMPANY = 'company-1';
const USER = 'user-1';

// El error de la base de datos por violar un índice único, como lo entrega el driver de Postgres.
const uniqueViolation = () =>
  new QueryFailedError('INSERT', [], Object.assign(new Error('duplicate key'), { code: '23505' }));

// Reclamar la clave de idempotencia (INSERT ... RETURNING) devuelve la fila reclamada: la clave era
// nueva. El UPDATE que la enlaza con lo que se creó no devuelve nada.
const claimKey = (sql: string) =>
  sql.includes('INSERT INTO "idempotency_keys"') ? [{ id: 'claim-1' }] : [];

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
    // Los códigos que la tienda ya usa (por defecto, ninguno: la caja nueva será la C1).
    find: vi.fn().mockResolvedValue([]),
    findOne: vi.fn(),
    // Lo que devuelve un reintento con la misma clave de idempotencia: la caja que ya se creó.
    findOneByOrFail: vi.fn(),
    create: vi.fn((value: unknown) => value),
    save: vi.fn(async (value: object) => ({ id: 'register-1', ...value })),
  };
  const txLocationRepo = {
    findOne: vi.fn().mockResolvedValue({ id: 'store-1', name: 'Tienda centro', status: RecordStatus.ACTIVE }),
  };
  const txSessionRepo = { existsBy: vi.fn().mockResolvedValue(false) };
  // Las claves de idempotencia ya reclamadas: por defecto, ninguna (la petición es nueva).
  const idempotencyRepo = { findOneBy: vi.fn().mockResolvedValue(null) };
  const manager = {
    getRepository: (entity: unknown) =>
      entity === Location
        ? txLocationRepo
        : entity === CashSession
          ? txSessionRepo
          : entity === CashRegister
            ? txRegisterRepo
            : entity === IdempotencyKey
              ? idempotencyRepo
              : undefined,
    // Solo lo usa la idempotencia (reclamar la clave y enlazarla con lo creado).
    query: vi.fn(async (sql: string) => claimKey(sql)),
  };
  const dataSource = {
    transaction: vi.fn(async (fn: (manager: unknown) => unknown) => fn(manager)),
  };

  const service = new CashRegisterService(registerRepo as never, dataSource as never);
  return {
    service,
    registerRepo,
    txRegisterRepo,
    txLocationRepo,
    txSessionRepo,
    idempotencyRepo,
    dataSource,
    manager,
  };
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
    it('creates the register in an active store of the company, with the name trimmed', async () => {
      const { service, txLocationRepo, txRegisterRepo } = createService();

      const register = await service.create(COMPANY, USER, { storeId: 'store-1', name: '  Caja 1 ' });

      // Sin filtrar por estado: hace falta encontrar la tienda para poder distinguir "no existe"
      // de "está desactivada". El filtro por empresa sí se mantiene. Y la fila se bloquea: así dos
      // cajas creadas a la vez en la tienda no toman el mismo código.
      expect(txLocationRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'store-1', companyId: COMPANY, type: LocationType.STORE },
        lock: { mode: 'pessimistic_write' },
      });
      expect(txRegisterRepo.create).toHaveBeenCalledWith({
        storeId: 'store-1',
        name: 'Caja 1',
        code: 'C1',
      });
      expect(register.id).toBe('register-1');
    });

    it('gives the register the next consecutive code of the store: the client never picks it', async () => {
      const { service, txRegisterRepo } = createService();
      txRegisterRepo.find.mockResolvedValue([{ code: 'C1' }, { code: 'C2' }]);

      await service.create(COMPANY, USER, { storeId: 'store-1', name: 'Caja del fondo' });

      expect(txRegisterRepo.find).toHaveBeenCalledWith({
        where: { storeId: 'store-1' },
        select: { code: true },
      });
      expect(txRegisterRepo.create).toHaveBeenCalledWith({
        storeId: 'store-1',
        name: 'Caja del fondo',
        code: 'C3',
      });
    });

    it('never reuses the code of a register that is out of service: it still owns it', async () => {
      const { service, txRegisterRepo } = createService();
      // La C2 está desactivada, pero la lista trae todas las cajas de la tienda, activas o no.
      txRegisterRepo.find.mockResolvedValue([{ code: 'C1' }, { code: 'C2' }]);

      await service.create(COMPANY, USER, { storeId: 'store-1', name: 'Otra' });

      expect(txRegisterRepo.create.mock.calls[0][0].code).toBe('C3');
    });

    it('does not count the codes that were typed by hand before, only the ones shaped C<number>', async () => {
      const { service, txRegisterRepo } = createService();
      txRegisterRepo.find.mockResolvedValue([{ code: 'PRINCIPAL' }, { code: 'C1' }]);

      await service.create(COMPANY, USER, { storeId: 'store-1', name: 'Otra' });

      expect(txRegisterRepo.create.mock.calls[0][0].code).toBe('C2');
    });

    it('only puts registers in stores: not in warehouses, not in other companies', async () => {
      const { service, txLocationRepo, txRegisterRepo } = createService();
      txLocationRepo.findOne.mockResolvedValue(null);

      await expect(
        service.create(COMPANY, USER, { storeId: 'warehouse-1', name: 'Caja' }),
      ).rejects.toThrow(NotFoundException);
      expect(txRegisterRepo.save).not.toHaveBeenCalled();
    });

    it('says a deactivated store is deactivated, instead of pretending it does not exist', async () => {
      const { service, txLocationRepo, txRegisterRepo } = createService();
      txLocationRepo.findOne.mockResolvedValue({
        id: 'store-1',
        name: 'Tienda centro',
        status: RecordStatus.INACTIVE,
      });

      await expect(
        service.create(COMPANY, USER, { storeId: 'store-1', name: 'Caja' }),
      ).rejects.toThrow('La tienda Tienda centro está desactivada: no se pueden crear cajas en ella');
      expect(txRegisterRepo.save).not.toHaveBeenCalled();
    });

    it('rejects a blank name, before touching the database', async () => {
      const { service, dataSource } = createService();

      await expect(
        service.create(COMPANY, USER, { storeId: 'store-1', name: '  ' }),
      ).rejects.toThrow(BadRequestException);
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('turns the unique index error, if it ever happens, into a conflict instead of a raw database error', async () => {
      const { service, txRegisterRepo } = createService();
      txRegisterRepo.save.mockRejectedValue(uniqueViolation());

      await expect(
        service.create(COMPANY, USER, { storeId: 'store-1', name: 'Caja' }),
      ).rejects.toThrow(ConflictException);
    });

    describe('with an idempotency key', () => {
      const input = { storeId: 'store-1', name: 'Caja 2' };

      it('claims the key in the same transaction as the creation, before locking the store, and links it to the new register', async () => {
        const { service, manager, dataSource, txLocationRepo } = createService();

        const register = await service.create(COMPANY, USER, input, 'key-1');

        expect(dataSource.transaction).toHaveBeenCalledTimes(1);
        expect(manager.query).toHaveBeenNthCalledWith(
          1,
          expect.stringContaining('INSERT INTO "idempotency_keys"'),
          [COMPANY, USER, 'createCashRegister', 'key-1', fingerprintOf(input)],
        );
        expect(manager.query).toHaveBeenNthCalledWith(
          2,
          expect.stringContaining('UPDATE "idempotency_keys"'),
          ['claim-1', 'cash_register', 'register-1'],
        );
        expect(manager.query.mock.invocationCallOrder[0]).toBeLessThan(
          txLocationRepo.findOne.mock.invocationCallOrder[0],
        );
        expect(register.id).toBe('register-1');
      });

      it('claims nothing without a key: it works as before', async () => {
        const { service, manager, idempotencyRepo, txRegisterRepo } = createService();

        await service.create(COMPANY, USER, input);

        expect(manager.query).not.toHaveBeenCalled();
        expect(idempotencyRepo.findOneBy).not.toHaveBeenCalled();
        expect(txRegisterRepo.save).toHaveBeenCalledTimes(1);
      });

      it('a repeated request (double click on "Create register") gets back the same register and creates no second one', async () => {
        const { service, manager, idempotencyRepo, txRegisterRepo, txLocationRepo } = createService();
        // La clave ya estaba reclamada por la primera petición, que creó 'register-1'
        manager.query.mockResolvedValue([]);
        idempotencyRepo.findOneBy.mockResolvedValue({
          fingerprint: fingerprintOf(input),
          resourceId: 'register-1',
        });
        const first = stored({ name: 'Caja 2', code: 'C2' });
        txRegisterRepo.findOneByOrFail.mockResolvedValue(first);

        const register = await service.create(COMPANY, USER, input, 'key-1');

        expect(idempotencyRepo.findOneBy).toHaveBeenCalledWith({
          companyId: COMPANY,
          userId: USER,
          operation: 'createCashRegister',
          key: 'key-1',
        });
        expect(txRegisterRepo.findOneByOrFail).toHaveBeenCalledWith({ id: 'register-1' });
        expect(register).toBe(first);
        // Ni se bloquea la tienda ni se calcula otro código ni se guarda otra caja (la C3)
        expect(txLocationRepo.findOne).not.toHaveBeenCalled();
        expect(txRegisterRepo.find).not.toHaveBeenCalled();
        expect(txRegisterRepo.save).not.toHaveBeenCalled();
      });

      it('the same key with other data is not a retry: it is refused and nothing is created', async () => {
        const { service, manager, idempotencyRepo, txRegisterRepo } = createService();
        manager.query.mockResolvedValue([]);
        idempotencyRepo.findOneBy.mockResolvedValue({
          fingerprint: fingerprintOf({ ...input, name: 'Otra caja' }),
          resourceId: 'register-1',
        });

        await expect(service.create(COMPANY, USER, input, 'key-1')).rejects.toThrow(
          ConflictException,
        );
        expect(txRegisterRepo.findOneByOrFail).not.toHaveBeenCalled();
        expect(txRegisterRepo.save).not.toHaveBeenCalled();
      });

      it('a creation that fails does not link the key to anything', async () => {
        const { service, manager, txLocationRepo } = createService();
        txLocationRepo.findOne.mockResolvedValue(null);

        await expect(service.create(COMPANY, USER, input, 'key-1')).rejects.toThrow(
          NotFoundException,
        );

        // Solo el INSERT que reclama (que se deshace con la transacción); nunca el UPDATE que la enlaza
        expect(manager.query).toHaveBeenCalledTimes(1);
      });

      it('still turns the unique index error into a conflict with a key', async () => {
        const { service, txRegisterRepo } = createService();
        txRegisterRepo.save.mockRejectedValue(uniqueViolation());

        await expect(service.create(COMPANY, USER, input, 'key-1')).rejects.toThrow(
          'Ya hay una caja con ese código en la tienda',
        );
      });

      it('rejects a blank name before claiming the key', async () => {
        const { service, manager, dataSource } = createService();

        await expect(
          service.create(COMPANY, USER, { ...input, name: '   ' }, 'key-1'),
        ).rejects.toThrow(BadRequestException);
        expect(dataSource.transaction).not.toHaveBeenCalled();
        expect(manager.query).not.toHaveBeenCalled();
      });
    });
  });

  describe('update', () => {
    it('changes only the name: the store and the code are fixed', async () => {
      const { service, txRegisterRepo } = createService();
      txRegisterRepo.findOne.mockResolvedValue(stored());

      const register = await service.update(COMPANY, 'register-1', { name: ' Caja del fondo ' });

      expect(txRegisterRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'register-1', store: { companyId: COMPANY } },
      });
      expect(register).toMatchObject({ name: 'Caja del fondo', code: 'C1', storeId: 'store-1' });
    });

    it('locks the register before changing it, and changes the one it reads under the lock', async () => {
      const { service, txRegisterRepo } = createService();
      // Lo que se leyó al comprobar la empresa, y lo que hay cuando la caja ya está bloqueada:
      // mientras tanto otro administrador la desactivó.
      txRegisterRepo.findOne
        .mockResolvedValueOnce(stored())
        .mockResolvedValueOnce(stored({ status: RecordStatus.INACTIVE }));

      const register = await service.update(COMPANY, 'register-1', { name: 'Caja del fondo' });

      expect(txRegisterRepo.findOne).toHaveBeenLastCalledWith({
        where: { id: 'register-1' },
        lock: { mode: 'pessimistic_write' },
      });
      // Cambia el nombre y no la vuelve a activar
      expect(register).toMatchObject({ name: 'Caja del fondo', status: RecordStatus.INACTIVE });
    });

    it('never looks at the codes of the store: there is nothing to check, it cannot be changed', async () => {
      const { service, txRegisterRepo } = createService();
      txRegisterRepo.findOne.mockResolvedValue(stored());

      await service.update(COMPANY, 'register-1', { name: 'Otro nombre' });

      expect(txRegisterRepo.existsBy).not.toHaveBeenCalled();
      expect(txRegisterRepo.find).not.toHaveBeenCalled();
    });

    it('leaves the register as it was when no name is sent', async () => {
      const { service, txRegisterRepo } = createService();
      txRegisterRepo.findOne.mockResolvedValue(stored());

      const register = await service.update(COMPANY, 'register-1', {});

      expect(register).toMatchObject({ name: 'Caja principal', code: 'C1' });
    });

    it('rejects a blank name, before touching the database', async () => {
      const { service, dataSource } = createService();

      await expect(service.update(COMPANY, 'register-1', { name: ' ' })).rejects.toThrow(
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
      expect(txRegisterRepo.findOne).toHaveBeenLastCalledWith({
        where: { id: 'register-1' },
        lock: { mode: 'pessimistic_write' },
      });
    });

    it('cannot reach a register of another company', async () => {
      const { service, txRegisterRepo } = createService();
      txRegisterRepo.findOne.mockResolvedValue(null);

      await expect(service.activate(COMPANY, 'register-9')).rejects.toThrow(NotFoundException);
      expect(txRegisterRepo.save).not.toHaveBeenCalled();
    });
  });
});
