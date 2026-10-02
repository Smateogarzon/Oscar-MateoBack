import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { IdempotencyKey } from '../idempotency/entities/idempotency-key.entity.js';
import { fingerprintOf } from '../idempotency/idempotency.js';
import { Location } from '../location/entities/location.entity.js';
import { User } from '../user/entities/user.entity.js';
import { UserCompanyRole } from '../user-company-role/entities/user-company-role.entity.js';
import { PurchaseOrderStatus } from './entities/purchase-order-status.enum.js';
import { PurchaseOrderService } from './purchase-order.service.js';

const claimKey = (sql: string) =>
  sql.includes('INSERT INTO "idempotency_keys"') ? [{ id: 'claim-1' }] : [];

function createService() {
  const repo = { find: vi.fn().mockResolvedValue([]), findOneBy: vi.fn() };
  const txPurchaseOrderRepo = {
    create: vi.fn((value: unknown) => value),
    save: vi.fn(async (value: object) => ({ id: 'po-1', ...value })),
    findOne: vi.fn(),
    findOneByOrFail: vi.fn(),
  };
  const locationRepo = { existsBy: vi.fn().mockResolvedValue(true) };
  const membershipRepo = { existsBy: vi.fn().mockResolvedValue(true) };
  const userRepo = { existsBy: vi.fn().mockResolvedValue(true) };
  const idempotencyRepo = { findOneBy: vi.fn().mockResolvedValue(null) };
  const manager = {
    getRepository: (entity: unknown) =>
      entity === Location
        ? locationRepo
        : entity === UserCompanyRole
          ? membershipRepo
          : entity === User
            ? userRepo
            : entity === IdempotencyKey
              ? idempotencyRepo
              : txPurchaseOrderRepo,
    query: vi.fn(async (sql: string) => claimKey(sql)),
  };
  const dataSource = {
    transaction: vi.fn(async (fn: (manager: unknown) => unknown) => fn(manager)),
  };
  const sequences = { next: vi.fn().mockResolvedValue(1) };
  const service = new PurchaseOrderService(repo as never, dataSource as never, sequences as never);
  return {
    service,
    repo,
    txPurchaseOrderRepo,
    locationRepo,
    membershipRepo,
    userRepo,
    idempotencyRepo,
    sequences,
    manager,
    dataSource,
  };
}

const COMPANY = 'company-1';
const USER = 'user-1';
const SUPPLIER = 'supplier-1';
const input = { supplierId: SUPPLIER, destinationLocationId: 'warehouse-1' };

describe('PurchaseOrderService', () => {
  describe('findAll', () => {
    it('only lists the purchase orders of the company', async () => {
      const { service, repo } = createService();

      await service.findAll(COMPANY);

      expect(repo.find).toHaveBeenCalledWith({ where: { companyId: COMPANY }, order: { createdAt: 'DESC' } });
    });
  });

  describe('create', () => {
    it('creates a draft order, numbered by company', async () => {
      const { service, txPurchaseOrderRepo, membershipRepo, sequences } = createService();

      const purchaseOrder = await service.create(COMPANY, USER, input);

      expect(membershipRepo.existsBy).toHaveBeenCalledWith({
        userId: SUPPLIER,
        companyId: COMPANY,
        status: 'ACTIVE',
        role: { code: 'SUPPLIER', status: 'ACTIVE' },
      });
      expect(sequences.next).toHaveBeenCalledWith(expect.anything(), COMPANY, 'PURCHASE_ORDER');
      expect(txPurchaseOrderRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ companyId: COMPANY, orderNumber: 'OC-00001', createdBy: USER }),
      );
      expect(purchaseOrder.id).toBe('po-1');
    });

    it('rejects a supplier who does not hold the Proveedor role in this company', async () => {
      const { service, membershipRepo, txPurchaseOrderRepo } = createService();
      membershipRepo.existsBy.mockResolvedValue(false);

      await expect(service.create(COMPANY, USER, input)).rejects.toThrow(NotFoundException);
      expect(txPurchaseOrderRepo.save).not.toHaveBeenCalled();
    });

    it('rejects a destination of another company', async () => {
      const { service, locationRepo, txPurchaseOrderRepo } = createService();
      locationRepo.existsBy.mockResolvedValue(false);

      await expect(service.create(COMPANY, USER, input)).rejects.toThrow(NotFoundException);
      expect(txPurchaseOrderRepo.save).not.toHaveBeenCalled();
    });

    describe('with an idempotency key', () => {
      it('claims the key before saving anything', async () => {
        const { service, manager, dataSource, txPurchaseOrderRepo } = createService();

        await service.create(COMPANY, USER, input, 'key-1');

        expect(dataSource.transaction).toHaveBeenCalledTimes(1);
        expect(manager.query).toHaveBeenNthCalledWith(
          1,
          expect.stringContaining('INSERT INTO "idempotency_keys"'),
          [COMPANY, USER, 'createPurchaseOrder', 'key-1', fingerprintOf(input)],
        );
        expect(manager.query.mock.invocationCallOrder[0]).toBeLessThan(
          txPurchaseOrderRepo.save.mock.invocationCallOrder[0],
        );
      });
    });
  });

  describe('send', () => {
    it('sends a draft order', async () => {
      const { service, repo, txPurchaseOrderRepo } = createService();
      repo.findOneBy.mockResolvedValue({ id: 'po-1', status: PurchaseOrderStatus.DRAFT });
      txPurchaseOrderRepo.findOne.mockResolvedValue({ id: 'po-1', status: PurchaseOrderStatus.DRAFT });

      const purchaseOrder = await service.send(COMPANY, 'po-1');

      expect(purchaseOrder.status).toBe(PurchaseOrderStatus.SENT);
    });

    it('does not send one that is not a draft', async () => {
      const { service, repo, txPurchaseOrderRepo } = createService();
      repo.findOneBy.mockResolvedValue({ id: 'po-1', status: PurchaseOrderStatus.SENT });
      txPurchaseOrderRepo.findOne.mockResolvedValue({ id: 'po-1', status: PurchaseOrderStatus.SENT });

      await expect(service.send(COMPANY, 'po-1')).rejects.toThrow(ConflictException);
      expect(txPurchaseOrderRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('confirm', () => {
    it('lets the supplier of the order confirm it once sent', async () => {
      const { service, repo, txPurchaseOrderRepo } = createService();
      repo.findOneBy.mockResolvedValue({ id: 'po-1', supplierId: SUPPLIER, status: PurchaseOrderStatus.SENT });
      txPurchaseOrderRepo.findOne.mockResolvedValue({
        id: 'po-1',
        supplierId: SUPPLIER,
        status: PurchaseOrderStatus.SENT,
      });

      const purchaseOrder = await service.confirm(COMPANY, SUPPLIER, 'po-1');

      expect(purchaseOrder.status).toBe(PurchaseOrderStatus.CONFIRMED);
      expect(purchaseOrder.confirmedAt).toBeInstanceOf(Date);
    });

    it('rejects anyone other than the order’s own supplier', async () => {
      const { service, repo, txPurchaseOrderRepo } = createService();
      repo.findOneBy.mockResolvedValue({ id: 'po-1', supplierId: SUPPLIER, status: PurchaseOrderStatus.SENT });
      txPurchaseOrderRepo.findOne.mockResolvedValue({
        id: 'po-1',
        supplierId: SUPPLIER,
        status: PurchaseOrderStatus.SENT,
      });

      await expect(service.confirm(COMPANY, 'someone-else', 'po-1')).rejects.toThrow(ForbiddenException);
      expect(txPurchaseOrderRepo.save).not.toHaveBeenCalled();
    });

    it('does not confirm one that has not been sent', async () => {
      const { service, repo, txPurchaseOrderRepo } = createService();
      repo.findOneBy.mockResolvedValue({ id: 'po-1', supplierId: SUPPLIER, status: PurchaseOrderStatus.DRAFT });
      txPurchaseOrderRepo.findOne.mockResolvedValue({
        id: 'po-1',
        supplierId: SUPPLIER,
        status: PurchaseOrderStatus.DRAFT,
      });

      await expect(service.confirm(COMPANY, SUPPLIER, 'po-1')).rejects.toThrow(ConflictException);
      expect(txPurchaseOrderRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('registerDelivery', () => {
    it('leaves it PARTIALLY_RECEIVED when marked partial', async () => {
      const { service, repo, txPurchaseOrderRepo } = createService();
      repo.findOneBy.mockResolvedValue({ id: 'po-1', supplierId: SUPPLIER, status: PurchaseOrderStatus.CONFIRMED });
      txPurchaseOrderRepo.findOne.mockResolvedValue({
        id: 'po-1',
        supplierId: SUPPLIER,
        status: PurchaseOrderStatus.CONFIRMED,
      });

      const purchaseOrder = await service.registerDelivery(COMPANY, SUPPLIER, 'po-1', true);

      expect(purchaseOrder.status).toBe(PurchaseOrderStatus.PARTIALLY_RECEIVED);
    });

    it('leaves it RECEIVED when not partial, even from a prior PARTIALLY_RECEIVED', async () => {
      const { service, repo, txPurchaseOrderRepo } = createService();
      repo.findOneBy.mockResolvedValue({
        id: 'po-1',
        supplierId: SUPPLIER,
        status: PurchaseOrderStatus.PARTIALLY_RECEIVED,
      });
      txPurchaseOrderRepo.findOne.mockResolvedValue({
        id: 'po-1',
        supplierId: SUPPLIER,
        status: PurchaseOrderStatus.PARTIALLY_RECEIVED,
      });

      const purchaseOrder = await service.registerDelivery(COMPANY, SUPPLIER, 'po-1', false);

      expect(purchaseOrder.status).toBe(PurchaseOrderStatus.RECEIVED);
    });

    it('rejects anyone other than the supplier', async () => {
      const { service, repo, txPurchaseOrderRepo } = createService();
      repo.findOneBy.mockResolvedValue({ id: 'po-1', supplierId: SUPPLIER, status: PurchaseOrderStatus.CONFIRMED });
      txPurchaseOrderRepo.findOne.mockResolvedValue({
        id: 'po-1',
        supplierId: SUPPLIER,
        status: PurchaseOrderStatus.CONFIRMED,
      });

      await expect(service.registerDelivery(COMPANY, 'someone-else', 'po-1', false)).rejects.toThrow(
        ForbiddenException,
      );
      expect(txPurchaseOrderRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('cancel', () => {
    it('lets whoever manages purchasing cancel someone else’s order', async () => {
      const { service, repo, txPurchaseOrderRepo } = createService();
      repo.findOneBy.mockResolvedValue({ id: 'po-1', supplierId: SUPPLIER, status: PurchaseOrderStatus.DRAFT });
      txPurchaseOrderRepo.findOne.mockResolvedValue({
        id: 'po-1',
        supplierId: SUPPLIER,
        status: PurchaseOrderStatus.DRAFT,
      });

      const purchaseOrder = await service.cancel(
        COMPANY,
        { userId: USER, canManagePurchasing: true },
        'po-1',
        'Ya no se necesita',
      );

      expect(purchaseOrder.status).toBe(PurchaseOrderStatus.CANCELLED);
      expect(purchaseOrder.cancelledBy).toBe(USER);
      expect(purchaseOrder.cancellationReason).toBe('Ya no se necesita');
    });

    it('lets the supplier cancel their own order without the purchasing permission', async () => {
      const { service, repo, txPurchaseOrderRepo } = createService();
      repo.findOneBy.mockResolvedValue({ id: 'po-1', supplierId: SUPPLIER, status: PurchaseOrderStatus.SENT });
      txPurchaseOrderRepo.findOne.mockResolvedValue({
        id: 'po-1',
        supplierId: SUPPLIER,
        status: PurchaseOrderStatus.SENT,
      });

      const purchaseOrder = await service.cancel(COMPANY, { userId: SUPPLIER, canManagePurchasing: false }, 'po-1');

      expect(purchaseOrder.status).toBe(PurchaseOrderStatus.CANCELLED);
    });

    it('rejects someone who is neither the supplier nor manages purchasing', async () => {
      const { service, repo, txPurchaseOrderRepo } = createService();
      repo.findOneBy.mockResolvedValue({ id: 'po-1', supplierId: SUPPLIER, status: PurchaseOrderStatus.DRAFT });
      txPurchaseOrderRepo.findOne.mockResolvedValue({
        id: 'po-1',
        supplierId: SUPPLIER,
        status: PurchaseOrderStatus.DRAFT,
      });

      await expect(
        service.cancel(COMPANY, { userId: USER, canManagePurchasing: false }, 'po-1'),
      ).rejects.toThrow(ForbiddenException);
      expect(txPurchaseOrderRepo.save).not.toHaveBeenCalled();
    });

    it('does not cancel one already received', async () => {
      const { service, repo, txPurchaseOrderRepo } = createService();
      repo.findOneBy.mockResolvedValue({ id: 'po-1', supplierId: SUPPLIER, status: PurchaseOrderStatus.RECEIVED });
      txPurchaseOrderRepo.findOne.mockResolvedValue({
        id: 'po-1',
        supplierId: SUPPLIER,
        status: PurchaseOrderStatus.RECEIVED,
      });

      await expect(
        service.cancel(COMPANY, { userId: USER, canManagePurchasing: true }, 'po-1'),
      ).rejects.toThrow(ConflictException);
      expect(txPurchaseOrderRepo.save).not.toHaveBeenCalled();
    });
  });
});
