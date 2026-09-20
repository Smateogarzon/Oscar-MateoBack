import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import { RecordStatus } from '../../common/enums/record-status.enum.js';
import { PaymentMethodType } from './entities/payment-method-type.enum.js';
import { PaymentMethodService } from './payment-method.service.js';

const COMPANY = 'company-1';

// El error de la base de datos por violar un índice único, como lo entrega el driver de Postgres.
const uniqueViolation = () =>
  new QueryFailedError('INSERT', [], Object.assign(new Error('duplicate key'), { code: '23505' }));

// Un medio de pago tal como lo entrega la base de datos.
const stored = (overrides: Record<string, unknown> = {}) => ({
  id: 'method-1',
  companyId: COMPANY,
  name: 'Efectivo',
  type: PaymentMethodType.CASH,
  requiresReference: false,
  status: RecordStatus.ACTIVE,
  ...overrides,
});

function createService() {
  const methodRepo = { find: vi.fn().mockResolvedValue([]), findOneBy: vi.fn() };
  const txMethodRepo = {
    existsBy: vi.fn().mockResolvedValue(false),
    findOneBy: vi.fn(),
    create: vi.fn((value: unknown) => value),
    save: vi.fn(async (value: object) => ({ id: 'method-1', ...value })),
  };
  const dataSource = {
    transaction: vi.fn(async (fn: (manager: unknown) => unknown) =>
      fn({ getRepository: () => txMethodRepo }),
    ),
  };

  const service = new PaymentMethodService(methodRepo as never, dataSource as never);
  return { service, methodRepo, txMethodRepo, dataSource };
}

describe('PaymentMethodService', () => {
  describe('findAll', () => {
    it('only lists the methods of the company, by name', async () => {
      const { service, methodRepo } = createService();

      await service.findAll(COMPANY);

      expect(methodRepo.find).toHaveBeenCalledWith({
        where: { companyId: COMPANY },
        order: { name: 'ASC' },
      });
    });

    it('can narrow the list down by status', async () => {
      const { service, methodRepo } = createService();

      await service.findAll(COMPANY, RecordStatus.ACTIVE);

      expect(methodRepo.find).toHaveBeenCalledWith({
        where: { companyId: COMPANY, status: RecordStatus.ACTIVE },
        order: { name: 'ASC' },
      });
    });
  });

  describe('findOne', () => {
    it('looks the method up inside the company, so one of another company does not exist', async () => {
      const { service, methodRepo } = createService();
      methodRepo.findOneBy.mockResolvedValue(null);

      await expect(service.findOne(COMPANY, 'method-9')).rejects.toThrow(NotFoundException);
      expect(methodRepo.findOneBy).toHaveBeenCalledWith({ id: 'method-9', companyId: COMPANY });
    });
  });

  describe('create', () => {
    it('creates the method for the company with the name trimmed and no reference required', async () => {
      const { service, txMethodRepo } = createService();

      const method = await service.create(COMPANY, {
        name: '  Nequi ',
        type: PaymentMethodType.TRANSFER,
      });

      expect(txMethodRepo.existsBy).toHaveBeenCalledWith({ companyId: COMPANY, name: 'Nequi' });
      expect(txMethodRepo.create).toHaveBeenCalledWith({
        companyId: COMPANY,
        name: 'Nequi',
        type: PaymentMethodType.TRANSFER,
        requiresReference: false,
      });
      expect(method.id).toBe('method-1');
    });

    it('can ask for a reference when charging with it', async () => {
      const { service, txMethodRepo } = createService();

      await service.create(COMPANY, {
        name: 'Tarjeta',
        type: PaymentMethodType.CARD,
        requiresReference: true,
      });

      expect(txMethodRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ requiresReference: true }),
      );
    });

    it('rejects a name the company already uses', async () => {
      const { service, txMethodRepo } = createService();
      txMethodRepo.existsBy.mockResolvedValue(true);

      await expect(
        service.create(COMPANY, { name: 'Efectivo', type: PaymentMethodType.CASH }),
      ).rejects.toThrow(ConflictException);
      expect(txMethodRepo.save).not.toHaveBeenCalled();
    });

    it('rejects a blank name, before touching the database', async () => {
      const { service, dataSource } = createService();

      await expect(
        service.create(COMPANY, { name: '   ', type: PaymentMethodType.CASH }),
      ).rejects.toThrow(BadRequestException);
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('turns the unique index error of two creations at once into the same conflict', async () => {
      const { service, txMethodRepo } = createService();
      txMethodRepo.save.mockRejectedValue(uniqueViolation());

      await expect(
        service.create(COMPANY, { name: 'Efectivo', type: PaymentMethodType.CASH }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('update', () => {
    it('changes the name and whether it asks for a reference, and never the type', async () => {
      const { service, txMethodRepo } = createService();
      txMethodRepo.findOneBy.mockResolvedValue(stored());

      const method = await service.update(COMPANY, 'method-1', {
        name: ' Efectivo COP ',
        requiresReference: true,
      });

      expect(txMethodRepo.findOneBy).toHaveBeenCalledWith({ id: 'method-1', companyId: COMPANY });
      expect(txMethodRepo.existsBy).toHaveBeenCalledWith({
        companyId: COMPANY,
        name: 'Efectivo COP',
      });
      expect(method).toMatchObject({
        name: 'Efectivo COP',
        requiresReference: true,
        type: PaymentMethodType.CASH,
      });
    });

    it('does not look for duplicates when the name stays the same', async () => {
      const { service, txMethodRepo } = createService();
      txMethodRepo.findOneBy.mockResolvedValue(stored());

      await service.update(COMPANY, 'method-1', { name: ' Efectivo ', requiresReference: true });

      expect(txMethodRepo.existsBy).not.toHaveBeenCalled();
    });

    it('leaves what is not sent as it was', async () => {
      const { service, txMethodRepo } = createService();
      txMethodRepo.findOneBy.mockResolvedValue(stored({ requiresReference: true }));

      const method = await service.update(COMPANY, 'method-1', {});

      expect(method).toMatchObject({ name: 'Efectivo', requiresReference: true });
    });

    it('rejects a new name that another method of the company has', async () => {
      const { service, txMethodRepo } = createService();
      txMethodRepo.findOneBy.mockResolvedValue(stored());
      txMethodRepo.existsBy.mockResolvedValue(true);

      await expect(service.update(COMPANY, 'method-1', { name: 'Tarjeta' })).rejects.toThrow(
        ConflictException,
      );
      expect(txMethodRepo.save).not.toHaveBeenCalled();
    });

    it('rejects a blank name, before touching the database', async () => {
      const { service, dataSource } = createService();

      await expect(service.update(COMPANY, 'method-1', { name: '  ' })).rejects.toThrow(
        BadRequestException,
      );
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('cannot reach a method of another company', async () => {
      const { service, txMethodRepo } = createService();
      txMethodRepo.findOneBy.mockResolvedValue(null);

      await expect(service.update(COMPANY, 'method-9', { name: 'X' })).rejects.toThrow(
        NotFoundException,
      );
      expect(txMethodRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('deactivate and activate', () => {
    it('deactivates a method of the company and keeps the rest', async () => {
      const { service, txMethodRepo } = createService();
      txMethodRepo.findOneBy.mockResolvedValue(stored());

      const method = await service.deactivate(COMPANY, 'method-1');

      expect(txMethodRepo.findOneBy).toHaveBeenCalledWith({ id: 'method-1', companyId: COMPANY });
      expect(method).toMatchObject({ status: RecordStatus.INACTIVE, name: 'Efectivo' });
    });

    it('brings a deactivated method back, since its name cannot be reused', async () => {
      const { service, txMethodRepo } = createService();
      txMethodRepo.findOneBy.mockResolvedValue(stored({ status: RecordStatus.INACTIVE }));

      const method = await service.activate(COMPANY, 'method-1');

      expect(method.status).toBe(RecordStatus.ACTIVE);
    });

    it('cannot reach a method of another company', async () => {
      const { service, txMethodRepo } = createService();
      txMethodRepo.findOneBy.mockResolvedValue(null);

      await expect(service.deactivate(COMPANY, 'method-9')).rejects.toThrow(NotFoundException);
      await expect(service.activate(COMPANY, 'method-9')).rejects.toThrow(NotFoundException);
      expect(txMethodRepo.save).not.toHaveBeenCalled();
    });
  });
});
