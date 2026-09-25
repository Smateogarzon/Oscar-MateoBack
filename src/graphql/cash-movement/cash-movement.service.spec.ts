import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Decimal } from 'decimal.js';
import { RecordStatus } from '../../common/enums/record-status.enum.js';
import type { CashActor } from '../cash-session/cash-actor.js';
import { CashCodeVerdict } from '../cash-session/cash-code.js';
import { IdempotencyKey } from '../idempotency/entities/idempotency-key.entity.js';
import { fingerprintOf } from '../idempotency/idempotency.js';
import { CashMovementService } from './cash-movement.service.js';
import { CashMovementReason } from './entities/cash-movement-reason.enum.js';
import { CashMovementType } from './entities/cash-movement-type.enum.js';

const COMPANY = 'company-1';
const cashier: CashActor = { userId: 'cashier-1', canViewAll: false, canManageShifts: false };

// El turno tal como lo entrega CashSessionService.lockOpen
const lockedSession = {
  id: 'session-1',
  cashRegisterId: 'register-1',
  cashRegister: { storeId: 'store-1' },
};

// Reclamar la clave de idempotencia (INSERT ... RETURNING) devuelve la fila reclamada: la clave era
// nueva. El UPDATE que la enlaza con lo que se creó no devuelve nada.
const claimKey = (sql: string) =>
  sql.includes('INSERT INTO "idempotency_keys"') ? [{ id: 'claim-1' }] : [];

function createService() {
  const movementRepo = { find: vi.fn().mockResolvedValue([]) };
  const txMovementRepo = {
    create: vi.fn((value: unknown) => value),
    save: vi.fn(async (value: object) => ({ id: 'movement-1', ...value })),
    // Lo que devuelve un reintento con la misma clave de idempotencia: el movimiento ya registrado.
    findOneByOrFail: vi.fn(),
    // El mock de manager.getRepository no distingue de qué entidad se pide (salvo la de las claves de
    // idempotencia): este mismo objeto sirve también para el existsBy de assertStoreAccess (acceso a
    // la tienda del cajero).
    existsBy: vi.fn().mockResolvedValue(true),
  };
  // Las claves de idempotencia ya reclamadas: por defecto, ninguna (la petición es nueva).
  const idempotencyRepo = { findOneBy: vi.fn().mockResolvedValue(null) };
  const cashSessions = {
    findOne: vi.fn().mockResolvedValue({ id: 'session-1' }),
    lockOpen: vi.fn().mockResolvedValue(lockedSession),
    // Efectivo esperado de sobra por defecto: los tests que no prueban el tope no chocan con él.
    expectedCashOf: vi.fn().mockResolvedValue(new Decimal(1_000_000)),
    // El código del día: por defecto, el que escribió el cajero es el correcto.
    verifyMovementCode: vi.fn().mockResolvedValue(CashCodeVerdict.OK),
  };
  const manager = {
    getRepository: (entity: unknown) =>
      entity === IdempotencyKey ? idempotencyRepo : txMovementRepo,
    // Solo lo usa la idempotencia (reclamar la clave y enlazarla con lo creado).
    query: vi.fn(async (sql: string) => claimKey(sql)),
  };
  const dataSource = {
    transaction: vi.fn(async (fn: (manager: unknown) => unknown) => fn(manager)),
  };

  const service = new CashMovementService(
    movementRepo as never,
    dataSource as never,
    cashSessions as never,
  );
  return { service, movementRepo, txMovementRepo, idempotencyRepo, cashSessions, dataSource, manager };
}

const expense = {
  cashSessionId: 'session-1',
  code: '123456',
  type: CashMovementType.CASH_OUT,
  reason: CashMovementReason.EXPENSE,
  amount: '15000',
  description: 'Compra de bolsas',
};

// La huella de una petición no incluye el código del día (ver CashMovementService.register): así un
// reintento con el código nuevo sigue siendo el mismo movimiento.
const fingerprintOfRequest = (input: typeof expense) => fingerprintOf({ ...input, code: undefined });

describe('CashMovementService', () => {
  describe('findAll', () => {
    it('lists the movements of a shift the user can see, in the order they were made', async () => {
      const { service, movementRepo, cashSessions } = createService();

      await service.findAll(COMPANY, cashier, 'session-1');

      expect(cashSessions.findOne).toHaveBeenCalledWith(COMPANY, cashier, 'session-1');
      expect(movementRepo.find).toHaveBeenCalledWith({
        where: { cashSessionId: 'session-1' },
        order: { createdAt: 'ASC' },
      });
    });

    it('does not reveal the movements of a shift the user cannot see', async () => {
      const { service, movementRepo, cashSessions } = createService();
      cashSessions.findOne.mockRejectedValue(new NotFoundException('Turno session-9 no encontrado'));

      await expect(service.findAll(COMPANY, cashier, 'session-9')).rejects.toThrow(NotFoundException);
      expect(movementRepo.find).not.toHaveBeenCalled();
    });
  });

  describe('register', () => {
    it('records the movement in the open shift, with the amount as Decimal and the texts trimmed', async () => {
      const { service, txMovementRepo, cashSessions } = createService();

      const movement = await service.register(COMPANY, cashier, {
        ...expense,
        amount: '15000.50',
        description: '  Bolsas y cinta ',
        referenceNumber: ' REC-88 ',
      });

      expect(cashSessions.lockOpen).toHaveBeenCalledWith(
        expect.anything(),
        COMPANY,
        'session-1',
        cashier,
      );
      const created = txMovementRepo.create.mock.calls[0][0];
      expect(created).toMatchObject({
        cashSessionId: 'session-1',
        type: CashMovementType.CASH_OUT,
        reason: CashMovementReason.EXPENSE,
        description: 'Bolsas y cinta',
        referenceNumber: 'REC-88',
        createdBy: 'cashier-1',
      });
      expect(created.amount.toFixed(2)).toBe('15000.50');
      expect(movement.id).toBe('movement-1');
    });

    it('turns a blank reference number into nothing: it is optional', async () => {
      const { service, txMovementRepo } = createService();

      await service.register(COMPANY, cashier, { ...expense, referenceNumber: '  ' });
      await service.register(COMPANY, cashier, { ...expense, referenceNumber: '' });

      expect(txMovementRepo.create.mock.calls[0][0]).toMatchObject({ referenceNumber: null });
      expect(txMovementRepo.create.mock.calls[1][0]).toMatchObject({ referenceNumber: null });
    });

    it.each(['', '   ', '\t \n'])(
      'rejects a description that says nothing (%j), before touching the database: the explanation is mandatory',
      async (description) => {
        const { service, dataSource } = createService();

        const attempt = service.register(COMPANY, cashier, { ...expense, description });

        await expect(attempt).rejects.toThrow(BadRequestException);
        await expect(attempt).rejects.toThrow('Explica por qué se mueve el efectivo');
        expect(dataSource.transaction).not.toHaveBeenCalled();
      },
    );

    it('rejects a description of only spaces even when the request carries an idempotency key, without claiming it', async () => {
      const { service, manager } = createService();

      await expect(
        service.register(COMPANY, cashier, { ...expense, description: '   ' }, 'key-1'),
      ).rejects.toThrow(BadRequestException);
      expect(manager.query).not.toHaveBeenCalled();
    });

    it('needs access to the store of the shift, checked before the code so no attempt is burned', async () => {
      const { service, txMovementRepo, cashSessions } = createService();
      txMovementRepo.existsBy.mockResolvedValue(false);

      await expect(service.register(COMPANY, cashier, expense)).rejects.toThrow(ForbiddenException);
      expect(txMovementRepo.existsBy).toHaveBeenCalledWith({
        userId: 'cashier-1',
        locationId: 'store-1',
        status: RecordStatus.ACTIVE,
      });
      expect(cashSessions.verifyMovementCode).not.toHaveBeenCalled();
      expect(txMovementRepo.save).not.toHaveBeenCalled();
    });

    it('exempts nobody from the store access, not even whoever opens and closes shifts', async () => {
      const { service, txMovementRepo } = createService();
      const admin: CashActor = { userId: 'admin-1', canViewAll: true, canManageShifts: true };
      txMovementRepo.existsBy.mockResolvedValue(false);

      await expect(service.register(COMPANY, admin, expense)).rejects.toThrow(ForbiddenException);
      expect(txMovementRepo.existsBy).toHaveBeenCalledWith({
        userId: 'admin-1',
        locationId: 'store-1',
        status: RecordStatus.ACTIVE,
      });
      expect(txMovementRepo.save).not.toHaveBeenCalled();
    });

    it('rejects an amount of zero, before touching the database', async () => {
      const { service, dataSource } = createService();

      await expect(service.register(COMPANY, cashier, { ...expense, amount: '0.00' })).rejects.toThrow(
        BadRequestException,
      );
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it.each([CashMovementReason.EXPENSE, CashMovementReason.WITHDRAWAL, CashMovementReason.REFUND])(
      'does not put cash in for %s, which only takes it out',
      async (reason) => {
        const { service, dataSource } = createService();

        await expect(
          service.register(COMPANY, cashier, { ...expense, type: CashMovementType.CASH_IN, reason }),
        ).rejects.toThrow(BadRequestException);
        expect(dataSource.transaction).not.toHaveBeenCalled();
      },
    );

    it('accepts a deposit as cash in', async () => {
      const { service, txMovementRepo } = createService();

      await service.register(COMPANY, cashier, {
        ...expense,
        reason: CashMovementReason.DEPOSIT,
        type: CashMovementType.CASH_IN,
      });

      expect(txMovementRepo.save).toHaveBeenCalledTimes(1);
    });

    it('does not let a deposit take cash out: it only ever puts it in', async () => {
      const { service, dataSource } = createService();

      await expect(
        service.register(COMPANY, cashier, {
          ...expense,
          reason: CashMovementReason.DEPOSIT,
          type: CashMovementType.CASH_OUT,
        }),
      ).rejects.toThrow(BadRequestException);
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('only registers in a shift that is open and assigned to the cashier', async () => {
      const { service, txMovementRepo, cashSessions } = createService();
      cashSessions.lockOpen.mockRejectedValue(new ConflictException('El turno ya está cerrado'));

      await expect(service.register(COMPANY, cashier, expense)).rejects.toThrow(ConflictException);
      expect(txMovementRepo.save).not.toHaveBeenCalled();

      cashSessions.lockOpen.mockRejectedValue(new ForbiddenException('No es tu turno'));
      await expect(service.register(COMPANY, cashier, expense)).rejects.toThrow(ForbiddenException);
      expect(txMovementRepo.save).not.toHaveBeenCalled();
    });

    it('rejects a cash-out movement that exceeds the cash actually expected in the drawer', async () => {
      const { service, cashSessions, dataSource } = createService();
      cashSessions.expectedCashOf.mockResolvedValue(new Decimal('10000'));

      await expect(
        service.register(COMPANY, cashier, { ...expense, amount: '15000' }),
      ).rejects.toThrow(BadRequestException);
      expect(cashSessions.expectedCashOf).toHaveBeenCalledWith(expect.anything(), lockedSession);
      // La transacción se hace y se deshace (no queda pendiente): el rechazo no es "no se intentó".
      await expect(dataSource.transaction.mock.results[0].value).rejects.toThrow(BadRequestException);
    });

    it('accepts a cash-out movement for exactly what is expected in the drawer', async () => {
      const { service, cashSessions, txMovementRepo } = createService();
      cashSessions.expectedCashOf.mockResolvedValue(new Decimal('15000'));

      await service.register(COMPANY, cashier, { ...expense, amount: '15000' });

      expect(txMovementRepo.save).toHaveBeenCalledTimes(1);
    });

    it('does not check the drawer balance for a deposit: it only ever puts cash in', async () => {
      const { service, cashSessions, txMovementRepo } = createService();

      await service.register(COMPANY, cashier, {
        ...expense,
        reason: CashMovementReason.DEPOSIT,
        type: CashMovementType.CASH_IN,
      });

      expect(cashSessions.expectedCashOf).not.toHaveBeenCalled();
      expect(txMovementRepo.save).toHaveBeenCalledTimes(1);
    });

    it('checks the code of the day against the locked shift', async () => {
      const { service, cashSessions } = createService();

      await service.register(COMPANY, cashier, expense);

      expect(cashSessions.verifyMovementCode).toHaveBeenCalledWith(
        expect.anything(),
        lockedSession,
        '123456',
      );
    });

    it.each([CashCodeVerdict.WRONG, CashCodeVerdict.LOCKED])(
      'does not record the movement when the code is %s, and still commits the count of mistakes',
      async (verdict) => {
        const { service, cashSessions, txMovementRepo, dataSource } = createService();
        cashSessions.verifyMovementCode.mockResolvedValue(verdict);

        await expect(service.register(COMPANY, cashier, expense)).rejects.toThrow(
          ForbiddenException,
        );
        expect(txMovementRepo.save).not.toHaveBeenCalled();
        // La transacción termina bien y el error se lanza después: si la deshiciera, el intento
        // equivocado no se contaría.
        await expect(dataSource.transaction.mock.results[0].value).resolves.toEqual({
          kind: 'rejected',
          verdict,
        });
      },
    );

    it('does not check the code of a movement that is not valid anyway', async () => {
      const { service, cashSessions } = createService();

      await expect(service.register(COMPANY, cashier, { ...expense, amount: '0' })).rejects.toThrow(
        BadRequestException,
      );
      expect(cashSessions.verifyMovementCode).not.toHaveBeenCalled();
    });

    it('does not check the code of a withdrawal that exceeds the drawer balance', async () => {
      const { service, cashSessions } = createService();
      cashSessions.expectedCashOf.mockResolvedValue(new Decimal('10000'));

      await expect(
        service.register(COMPANY, cashier, { ...expense, amount: '15000' }),
      ).rejects.toThrow(BadRequestException);
      expect(cashSessions.verifyMovementCode).not.toHaveBeenCalled();
    });

    it('does not check the code when the shift is not the cashier\'s, so nobody burns attempts on someone else\'s shift', async () => {
      const { service, cashSessions } = createService();
      cashSessions.lockOpen.mockRejectedValue(new ForbiddenException('No es tu turno'));

      await expect(service.register(COMPANY, cashier, expense)).rejects.toThrow(ForbiddenException);
      expect(cashSessions.verifyMovementCode).not.toHaveBeenCalled();
    });

    describe('with an idempotency key', () => {
      // El movimiento que la primera petición ya dejó registrado
      const recorded = { id: 'movement-1', cashSessionId: 'session-1' };

      it('claims the key once the code is accepted, in the same transaction, and links it to the movement', async () => {
        const { service, manager, dataSource, cashSessions, txMovementRepo, idempotencyRepo } =
          createService();

        const movement = await service.register(COMPANY, cashier, expense, 'key-1');

        expect(dataSource.transaction).toHaveBeenCalledTimes(1);
        // Primero se mira si la clave ya tiene un movimiento (sin reclamarla)...
        expect(idempotencyRepo.findOneBy).toHaveBeenCalledWith({
          companyId: COMPANY,
          userId: 'cashier-1',
          operation: 'registerCashMovement',
          key: 'key-1',
        });
        // ...y después se reclama y se enlaza con lo que se registró
        expect(manager.query).toHaveBeenNthCalledWith(
          1,
          expect.stringContaining('INSERT INTO "idempotency_keys"'),
          [COMPANY, 'cashier-1', 'registerCashMovement', 'key-1', fingerprintOfRequest(expense)],
        );
        expect(manager.query).toHaveBeenNthCalledWith(
          2,
          expect.stringContaining('UPDATE "idempotency_keys"'),
          ['claim-1', 'cash_movement', 'movement-1'],
        );
        // La clave se reclama con el código ya aceptado y antes de guardar el movimiento
        expect(cashSessions.verifyMovementCode.mock.invocationCallOrder[0]).toBeLessThan(
          manager.query.mock.invocationCallOrder[0],
        );
        expect(manager.query.mock.invocationCallOrder[0]).toBeLessThan(
          txMovementRepo.save.mock.invocationCallOrder[0],
        );
        expect(movement.id).toBe('movement-1');
      });

      it('claims nothing without a key: it works as before', async () => {
        const { service, manager, idempotencyRepo, txMovementRepo } = createService();

        await service.register(COMPANY, cashier, expense);

        expect(idempotencyRepo.findOneBy).not.toHaveBeenCalled();
        expect(manager.query).not.toHaveBeenCalled();
        expect(txMovementRepo.save).toHaveBeenCalledTimes(1);
      });

      it('a retry of a movement already recorded gets it back, even if the shift was closed or the code changed since', async () => {
        const { service, manager, idempotencyRepo, txMovementRepo, cashSessions } = createService();
        idempotencyRepo.findOneBy.mockResolvedValue({
          fingerprint: fingerprintOfRequest(expense),
          resourceId: 'movement-1',
        });
        txMovementRepo.findOneByOrFail.mockResolvedValue(recorded);
        // Entre el intento y el reintento: el turno se cerró y el código dejó de valer
        cashSessions.lockOpen.mockRejectedValue(new ConflictException('El turno ya está cerrado'));
        cashSessions.verifyMovementCode.mockResolvedValue(CashCodeVerdict.WRONG);

        const movement = await service.register(COMPANY, cashier, expense, 'key-1');

        expect(movement).toBe(recorded);
        expect(txMovementRepo.findOneByOrFail).toHaveBeenCalledWith({ id: 'movement-1' });
        // Se contesta antes de tocar el turno o el código: no se gasta ningún intento ni se registra otro
        expect(cashSessions.lockOpen).not.toHaveBeenCalled();
        expect(cashSessions.verifyMovementCode).not.toHaveBeenCalled();
        expect(txMovementRepo.save).not.toHaveBeenCalled();
        expect(manager.query).not.toHaveBeenCalled();
      });

      it('when another request with the same key claims it first, gets what that one recorded and records nothing else', async () => {
        const { service, manager, idempotencyRepo, txMovementRepo } = createService();
        // La otra petición aún no había confirmado en las dos primeras consultas (antes y después de
        // bloquear el turno); al reclamar, la clave ya era suya y el INSERT no devuelve nada
        manager.query.mockResolvedValue([]);
        idempotencyRepo.findOneBy
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({ fingerprint: fingerprintOfRequest(expense), resourceId: 'movement-1' });
        txMovementRepo.findOneByOrFail.mockResolvedValue(recorded);

        const movement = await service.register(COMPANY, cashier, expense, 'key-1');

        expect(movement).toBe(recorded);
        expect(txMovementRepo.save).not.toHaveBeenCalled();
        // Solo el INSERT que no reclamó nada: ningún UPDATE enlaza la clave con otro movimiento
        expect(manager.query).toHaveBeenCalledTimes(1);
      });

      it('a double click: the second request waits for the shift lock and, once the first one committed, gets its movement instead of failing the balance or the code check', async () => {
        const { service, manager, idempotencyRepo, txMovementRepo, cashSessions } = createService();
        // Antes de bloquear el turno la primera petición aún no había confirmado; al obtener el bloqueo sí
        idempotencyRepo.findOneBy
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({ fingerprint: fingerprintOfRequest(expense), resourceId: 'movement-1' });
        txMovementRepo.findOneByOrFail.mockResolvedValue(recorded);
        // Con el saldo ya gastado por el primer movimiento, este no cabría
        cashSessions.expectedCashOf.mockResolvedValue(new Decimal(0));

        const movement = await service.register(COMPANY, cashier, expense, 'key-1');

        expect(movement).toBe(recorded);
        expect(cashSessions.lockOpen).toHaveBeenCalledTimes(1);
        expect(cashSessions.expectedCashOf).not.toHaveBeenCalled();
        expect(cashSessions.verifyMovementCode).not.toHaveBeenCalled();
        expect(txMovementRepo.save).not.toHaveBeenCalled();
        expect(manager.query).not.toHaveBeenCalled();
      });

      it('the same key with other data is not a retry: it is refused with a conflict and nothing is touched', async () => {
        const { service, idempotencyRepo, txMovementRepo, cashSessions, manager } = createService();
        idempotencyRepo.findOneBy.mockResolvedValue({
          fingerprint: fingerprintOfRequest({ ...expense, amount: '99999' }),
          resourceId: 'movement-1',
        });

        await expect(service.register(COMPANY, cashier, expense, 'key-1')).rejects.toThrow(
          ConflictException,
        );
        expect(cashSessions.lockOpen).not.toHaveBeenCalled();
        expect(txMovementRepo.findOneByOrFail).not.toHaveBeenCalled();
        expect(txMovementRepo.save).not.toHaveBeenCalled();
        expect(manager.query).not.toHaveBeenCalled();
      });

      it('does not claim the key when the code is wrong: that rejection is committed to count the attempt, and the retry with the right code must still go through', async () => {
        const { service, manager, cashSessions, txMovementRepo, dataSource } = createService();
        cashSessions.verifyMovementCode.mockResolvedValue(CashCodeVerdict.WRONG);

        await expect(service.register(COMPANY, cashier, expense, 'key-1')).rejects.toThrow(
          ForbiddenException,
        );

        expect(manager.query).not.toHaveBeenCalled();
        expect(txMovementRepo.save).not.toHaveBeenCalled();
        await expect(dataSource.transaction.mock.results[0].value).resolves.toEqual({
          kind: 'rejected',
          verdict: CashCodeVerdict.WRONG,
        });
      });

      it('does not claim the key when the movement is rejected for exceeding the drawer balance', async () => {
        const { service, manager, cashSessions } = createService();
        cashSessions.expectedCashOf.mockResolvedValue(new Decimal('10000'));

        await expect(
          service.register(COMPANY, cashier, { ...expense, amount: '15000' }, 'key-1'),
        ).rejects.toThrow(BadRequestException);
        expect(manager.query).not.toHaveBeenCalled();
      });
    });
  });
});
