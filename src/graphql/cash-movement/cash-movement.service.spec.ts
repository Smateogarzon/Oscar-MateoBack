import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Decimal } from 'decimal.js';
import type { CashActor } from '../cash-session/cash-actor.js';
import { CashCodeVerdict } from '../cash-session/cash-code.js';
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

function createService() {
  const movementRepo = { find: vi.fn().mockResolvedValue([]) };
  const txMovementRepo = {
    create: vi.fn((value: unknown) => value),
    save: vi.fn(async (value: object) => ({ id: 'movement-1', ...value })),
    // El mock de manager.getRepository no distingue de qué entidad se pide: este mismo objeto
    // sirve también para el existsBy de assertStoreAccess (acceso a la tienda del cajero).
    existsBy: vi.fn().mockResolvedValue(true),
  };
  const cashSessions = {
    findOne: vi.fn().mockResolvedValue({ id: 'session-1' }),
    lockOpen: vi.fn().mockResolvedValue(lockedSession),
    // Efectivo esperado de sobra por defecto: los tests que no prueban el tope no chocan con él.
    expectedCashOf: vi.fn().mockResolvedValue(new Decimal(1_000_000)),
    // El código del día: por defecto, el que escribió el cajero es el correcto.
    verifyMovementCode: vi.fn().mockResolvedValue(CashCodeVerdict.OK),
  };
  const dataSource = {
    transaction: vi.fn(async (fn: (manager: unknown) => unknown) =>
      fn({ getRepository: () => txMovementRepo }),
    ),
  };

  const service = new CashMovementService(
    movementRepo as never,
    dataSource as never,
    cashSessions as never,
  );
  return { service, movementRepo, txMovementRepo, cashSessions, dataSource };
}

const expense = {
  cashSessionId: 'session-1',
  code: '123456',
  type: CashMovementType.CASH_OUT,
  reason: CashMovementReason.EXPENSE,
  amount: '15000',
  description: 'Compra de bolsas',
};

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

    it('turns blank texts into nothing', async () => {
      const { service, txMovementRepo } = createService();

      await service.register(COMPANY, cashier, { ...expense, description: '  ', referenceNumber: '' });

      expect(txMovementRepo.create.mock.calls[0][0]).toMatchObject({
        description: null,
        referenceNumber: null,
      });
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
  });
});
