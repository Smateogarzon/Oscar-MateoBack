import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { CashActor } from '../cash-session/cash-actor.js';
import { CashCodeVerdict } from '../cash-session/cash-code.js';
import { CashMovementService } from './cash-movement.service.js';
import { CashMovementReason } from './entities/cash-movement-reason.enum.js';
import { CashMovementType } from './entities/cash-movement-type.enum.js';

const COMPANY = 'company-1';
const cashier: CashActor = { userId: 'cashier-1', canViewAll: false, canManageShifts: false };

// El turno tal como lo entrega CashSessionService.lockOpen
const lockedSession = { id: 'session-1', cashRegisterId: 'register-1' };

function createService() {
  const movementRepo = { find: vi.fn().mockResolvedValue([]) };
  const txMovementRepo = {
    create: vi.fn((value: unknown) => value),
    save: vi.fn(async (value: object) => ({ id: 'movement-1', ...value })),
  };
  const cashSessions = {
    findOne: vi.fn().mockResolvedValue({ id: 'session-1' }),
    lockOpen: vi.fn().mockResolvedValue(lockedSession),
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

    it('does not take a manual income out of the register', async () => {
      const { service, dataSource } = createService();

      await expect(
        service.register(COMPANY, cashier, {
          ...expense,
          type: CashMovementType.CASH_OUT,
          reason: CashMovementReason.MANUAL_INCOME,
        }),
      ).rejects.toThrow(BadRequestException);
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

    it.each([
      [CashMovementReason.MANUAL_INCOME, CashMovementType.CASH_IN],
      [CashMovementReason.DEPOSIT, CashMovementType.CASH_IN],
      [CashMovementReason.DEPOSIT, CashMovementType.CASH_OUT],
      [CashMovementReason.ADJUSTMENT, CashMovementType.CASH_IN],
      [CashMovementReason.ADJUSTMENT, CashMovementType.CASH_OUT],
      [CashMovementReason.OTHER, CashMovementType.CASH_IN],
      [CashMovementReason.OTHER, CashMovementType.CASH_OUT],
    ])('accepts %s as %s', async (reason, type) => {
      const { service, txMovementRepo } = createService();

      await service.register(COMPANY, cashier, { ...expense, reason, type });

      expect(txMovementRepo.save).toHaveBeenCalledTimes(1);
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

    it('does not check the code when the shift is not the cashier\'s, so nobody burns attempts on someone else\'s shift', async () => {
      const { service, cashSessions } = createService();
      cashSessions.lockOpen.mockRejectedValue(new ForbiddenException('No es tu turno'));

      await expect(service.register(COMPANY, cashier, expense)).rejects.toThrow(ForbiddenException);
      expect(cashSessions.verifyMovementCode).not.toHaveBeenCalled();
    });
  });
});
