import { NotFoundException } from '@nestjs/common';
import { RecordStatus } from '../../common/enums/record-status.enum.js';
import { StorePaymentMethodService } from './store-payment-method.service.js';

const COMPANY = 'company-1';

// Una fila tal como la entrega la base de datos.
const stored = (overrides: Record<string, unknown> = {}) => ({
  id: 'row-1',
  storeId: 'store-1',
  paymentMethodId: 'method-1',
  status: RecordStatus.ACTIVE,
  ...overrides,
});

function createService() {
  const repo = { find: vi.fn().mockResolvedValue([]), findOneBy: vi.fn() };
  // La fila que se vuelve a leer YA bloqueada, dentro de la transacción.
  const txRepo = {
    findOne: vi.fn(),
    save: vi.fn(async (row: object) => row),
  };
  const dataSource = {
    transaction: vi.fn(async (fn: (manager: unknown) => unknown) =>
      fn({ getRepository: () => txRepo }),
    ),
  };

  const service = new StorePaymentMethodService(repo as never, dataSource as never);
  return { service, repo, txRepo, dataSource };
}

describe('StorePaymentMethodService', () => {
  describe('findOne', () => {
    it('looks the row up through its store, so one of another company does not exist', async () => {
      const { service, repo } = createService();
      repo.findOneBy.mockResolvedValue(null);

      await expect(service.findOne(COMPANY, 'row-9')).rejects.toThrow(NotFoundException);
      expect(repo.findOneBy).toHaveBeenCalledWith({ id: 'row-9', store: { companyId: COMPANY } });
    });
  });

  describe('deactivate', () => {
    it('checks the company through the store, then locks the row and switches it off', async () => {
      const { service, repo, txRepo } = createService();
      repo.findOneBy.mockResolvedValue(stored());
      txRepo.findOne.mockResolvedValue(stored());

      const row = await service.deactivate(COMPANY, 'row-1');

      expect(repo.findOneBy).toHaveBeenCalledWith({ id: 'row-1', store: { companyId: COMPANY } });
      expect(txRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'row-1' },
        lock: { mode: 'pessimistic_write' },
      });
      expect(row.status).toBe(RecordStatus.INACTIVE);
      expect(txRepo.save).toHaveBeenCalledWith(expect.objectContaining({ status: RecordStatus.INACTIVE }));
    });

    it('locks the row inside the transaction, after checking the company and before saving', async () => {
      const { service, repo, txRepo, dataSource } = createService();
      repo.findOneBy.mockResolvedValue(stored());
      txRepo.findOne.mockResolvedValue(stored());

      await service.deactivate(COMPANY, 'row-1');

      const order = (mock: { mock: { invocationCallOrder: number[] } }) => mock.mock.invocationCallOrder[0];
      expect(order(repo.findOneBy)).toBeLessThan(order(dataSource.transaction));
      expect(order(dataSource.transaction)).toBeLessThan(order(txRepo.findOne));
      expect(order(txRepo.findOne)).toBeLessThan(order(txRepo.save));
    });

    it('changes the row it reads under the lock, not the copy read before: two changes at once do not overwrite each other', async () => {
      const { service, repo, txRepo } = createService();
      // Lo que se leyó al comprobar la empresa, y lo que hay cuando la fila ya está bloqueada:
      // mientras tanto otro administrador la cambió.
      const readBefore = stored({ status: RecordStatus.ACTIVE });
      const readLocked = stored({ status: RecordStatus.INACTIVE, paymentMethodId: 'method-2' });
      repo.findOneBy.mockResolvedValue(readBefore);
      txRepo.findOne.mockResolvedValue(readLocked);

      const row = await service.activate(COMPANY, 'row-1');

      // Se guarda la fila leída con el bloqueo, con el estado nuevo; la copia de antes ni se toca
      expect(txRepo.save).toHaveBeenCalledTimes(1);
      expect(txRepo.save.mock.calls[0][0]).toBe(readLocked);
      expect(row).toBe(readLocked);
      expect(row).toMatchObject({ status: RecordStatus.ACTIVE, paymentMethodId: 'method-2' });
      expect(readBefore.status).toBe(RecordStatus.ACTIVE);
    });

    it('cannot reach a row of another company, and does not even open a transaction', async () => {
      const { service, repo, txRepo, dataSource } = createService();
      repo.findOneBy.mockResolvedValue(null);

      await expect(service.deactivate(COMPANY, 'row-9')).rejects.toThrow(NotFoundException);
      expect(dataSource.transaction).not.toHaveBeenCalled();
      expect(txRepo.save).not.toHaveBeenCalled();
    });

    it('answers "not found" when the row disappears before it can be locked', async () => {
      const { service, repo, txRepo } = createService();
      repo.findOneBy.mockResolvedValue(stored());
      txRepo.findOne.mockResolvedValue(null);

      await expect(service.deactivate(COMPANY, 'row-1')).rejects.toThrow(NotFoundException);
      expect(txRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('activate', () => {
    it('switches a deactivated row back on, locking it first, instead of creating another one', async () => {
      const { service, repo, txRepo } = createService();
      repo.findOneBy.mockResolvedValue(stored({ status: RecordStatus.INACTIVE }));
      txRepo.findOne.mockResolvedValue(stored({ status: RecordStatus.INACTIVE }));

      const row = await service.activate(COMPANY, 'row-1');

      expect(txRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'row-1' },
        lock: { mode: 'pessimistic_write' },
      });
      expect(row.status).toBe(RecordStatus.ACTIVE);
    });

    it('cannot reach a row of another company', async () => {
      const { service, repo, txRepo } = createService();
      repo.findOneBy.mockResolvedValue(null);

      await expect(service.activate(COMPANY, 'row-9')).rejects.toThrow(NotFoundException);
      expect(txRepo.findOne).not.toHaveBeenCalled();
      expect(txRepo.save).not.toHaveBeenCalled();
    });
  });
});
