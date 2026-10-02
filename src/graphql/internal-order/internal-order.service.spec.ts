import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import { Incident } from '../incident/entities/incident.entity.js';
import { IdempotencyKey } from '../idempotency/entities/idempotency-key.entity.js';
import { fingerprintOf } from '../idempotency/idempotency.js';
import { InventoryMovementType } from '../inventory-movement/entities/inventory-movement-type.enum.js';
import { Location } from '../location/entities/location.entity.js';
import { ProductVariant } from '../product-variant/entities/product-variant.entity.js';
import { InternalOrderItem } from './entities/internal-order-item.entity.js';
import { InternalOrderOrigin } from './entities/internal-order-origin.enum.js';
import { InternalOrderStatus } from './entities/internal-order-status.enum.js';
import { InternalOrderType } from './entities/internal-order-type.enum.js';
import { InternalOrder } from './entities/internal-order.entity.js';
import { InternalOrderService } from './internal-order.service.js';

const claimKey = (sql: string) =>
  sql.includes('INSERT INTO "idempotency_keys"') ? [{ id: 'claim-1' }] : [];

function createService() {
  const repo = { find: vi.fn().mockResolvedValue([]), findOneBy: vi.fn() };
  const txOrderRepo = {
    create: vi.fn((value: unknown) => value),
    save: vi.fn(async (value: object) => ({ id: 'order-1', ...value })),
    findOne: vi.fn(),
    findOneByOrFail: vi.fn(),
  };
  const txItemRepo = {
    create: vi.fn((value: unknown) => value),
    save: vi.fn(async (value: unknown) => value),
    find: vi.fn().mockResolvedValue([]),
    delete: vi.fn().mockResolvedValue(undefined),
  };
  const locationRepo = { existsBy: vi.fn().mockResolvedValue(true) };
  const variantRepo = { existsBy: vi.fn().mockResolvedValue(true) };
  const incidentRepo = {
    create: vi.fn((value: unknown) => value),
    save: vi.fn(async (value: object) => ({ id: 'incident-1', ...value })),
  };
  const idempotencyRepo = { findOneBy: vi.fn().mockResolvedValue(null) };
  const manager = {
    getRepository: (entity: unknown) =>
      entity === Location
        ? locationRepo
        : entity === ProductVariant
          ? variantRepo
          : entity === Incident
            ? incidentRepo
            : entity === InternalOrderItem
              ? txItemRepo
              : entity === IdempotencyKey
                ? idempotencyRepo
                : txOrderRepo,
    query: vi.fn(async (sql: string) => claimKey(sql)),
  };
  const dataSource = {
    transaction: vi.fn(async (fn: (manager: unknown) => unknown) => fn(manager)),
    manager: { find: vi.fn().mockResolvedValue([]) },
  };
  const sequences = { next: vi.fn().mockResolvedValue(1) };
  const inventoryMovements = { recordInTransaction: vi.fn().mockResolvedValue({ id: 'movement-1' }) };
  const inventoryLocations = {
    findStockLocation: vi.fn().mockResolvedValue({ id: 'inv-loc-stock-1' }),
    findOrCreateRunnerLocation: vi.fn().mockResolvedValue({ id: 'inv-loc-runner-1' }),
  };
  const service = new InternalOrderService(
    repo as never,
    dataSource as never,
    sequences as never,
    inventoryMovements as never,
    inventoryLocations as never,
  );
  return {
    service,
    repo,
    txOrderRepo,
    txItemRepo,
    locationRepo,
    variantRepo,
    incidentRepo,
    idempotencyRepo,
    sequences,
    inventoryMovements,
    inventoryLocations,
    manager,
    dataSource,
  };
}

const COMPANY = 'company-1';
const REQUESTER = 'requester-1';
const OPERATOR = 'operator-1';
const RUNNER = 'runner-1';

const requestInput = {
  type: InternalOrderType.REPLENISHMENT,
  origin: InternalOrderOrigin.SELLER,
  sourceLocationId: 'warehouse-1',
  destinationLocationId: 'store-1',
  items: [{ productVariantId: 'variant-1', quantity: '3' }],
};

describe('InternalOrderService', () => {
  describe('request', () => {
    it('rejects an order with neither source nor destination, before touching the database', async () => {
      const { service, dataSource } = createService();

      await expect(
        service.request(COMPANY, REQUESTER, { ...requestInput, sourceLocationId: undefined, destinationLocationId: undefined }),
      ).rejects.toThrow(BadRequestException);
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('creates the order at version 1, numbered by company', async () => {
      const { service, txOrderRepo, txItemRepo, sequences } = createService();

      const order = await service.request(COMPANY, REQUESTER, requestInput);

      expect(sequences.next).toHaveBeenCalledWith(expect.anything(), COMPANY, 'INTERNAL_ORDER');
      expect(txOrderRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          companyId: COMPANY,
          orderNumber: 'PED-00001',
          versionNumber: 1,
          requestedBy: REQUESTER,
        }),
      );
      expect(txItemRepo.save).toHaveBeenCalledWith([
        expect.objectContaining({ internalOrderId: 'order-1', productVariantId: 'variant-1' }),
      ]);
      expect(order.id).toBe('order-1');
    });

    it('rejects a source or destination of another company', async () => {
      const { service, locationRepo, txOrderRepo } = createService();
      locationRepo.existsBy.mockResolvedValue(false);

      await expect(service.request(COMPANY, REQUESTER, requestInput)).rejects.toThrow(NotFoundException);
      expect(txOrderRepo.save).not.toHaveBeenCalled();
    });

    describe('with an idempotency key', () => {
      it('claims the key before saving anything', async () => {
        const { service, manager, dataSource, txOrderRepo } = createService();

        await service.request(COMPANY, REQUESTER, requestInput, 'key-1');

        expect(manager.query).toHaveBeenNthCalledWith(
          1,
          expect.stringContaining('INSERT INTO "idempotency_keys"'),
          [COMPANY, REQUESTER, 'requestInternalOrder', 'key-1', fingerprintOf(requestInput)],
        );
        expect(manager.query.mock.invocationCallOrder[0]).toBeLessThan(
          txOrderRepo.save.mock.invocationCallOrder[0],
        );
        expect(dataSource.transaction).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe('the happy path, one step at a time', () => {
    const base = (overrides: Record<string, unknown> = {}) => ({
      id: 'order-1',
      companyId: COMPANY,
      orderNumber: 'PED-00001',
      versionNumber: 1,
      requestedBy: REQUESTER,
      sourceLocationId: 'warehouse-1',
      destinationLocationId: 'store-1',
      status: InternalOrderStatus.PENDING,
      ...overrides,
    });

    it('accept: PENDING -> ACCEPTED, with the operator and the timestamp', async () => {
      const { service, repo, txOrderRepo } = createService();
      repo.findOneBy.mockResolvedValue(base());
      txOrderRepo.findOne.mockResolvedValue(base());

      const order = await service.accept(COMPANY, OPERATOR, 'order-1');

      expect(order.status).toBe(InternalOrderStatus.ACCEPTED);
      expect(order.warehouseOperatorId).toBe(OPERATOR);
      expect(order.warehouseAcceptedAt).toBeInstanceOf(Date);
    });

    it('accept: rejects one that is not PENDING', async () => {
      const { service, repo, txOrderRepo } = createService();
      repo.findOneBy.mockResolvedValue(base({ status: InternalOrderStatus.ACCEPTED }));
      txOrderRepo.findOne.mockResolvedValue(base({ status: InternalOrderStatus.ACCEPTED }));

      await expect(service.accept(COMPANY, OPERATOR, 'order-1')).rejects.toThrow(ConflictException);
      expect(txOrderRepo.save).not.toHaveBeenCalled();
    });

    it('startPreparing: ACCEPTED -> PREPARING', async () => {
      const { service, repo, txOrderRepo } = createService();
      repo.findOneBy.mockResolvedValue(base({ status: InternalOrderStatus.ACCEPTED }));
      txOrderRepo.findOne.mockResolvedValue(base({ status: InternalOrderStatus.ACCEPTED }));

      const order = await service.startPreparing(COMPANY, 'order-1');

      expect(order.status).toBe(InternalOrderStatus.PREPARING);
      expect(order.packingStartedAt).toBeInstanceOf(Date);
    });

    describe('markReady: PREPARING -> READY', () => {
      it('records what was found, with no incident when it matches what was asked', async () => {
        const { service, repo, txOrderRepo, txItemRepo, incidentRepo } = createService();
        repo.findOneBy.mockResolvedValue(base({ status: InternalOrderStatus.PREPARING }));
        txOrderRepo.findOne.mockResolvedValue(base({ status: InternalOrderStatus.PREPARING }));
        txItemRepo.find.mockResolvedValue([
          { id: 'item-1', internalOrderId: 'order-1', productVariantId: 'variant-1', quantity: new Decimal('3') },
        ]);

        const order = await service.markReady(COMPANY, OPERATOR, 'order-1', [
          { itemId: 'item-1', foundQuantity: '3' },
        ]);

        expect(order.status).toBe(InternalOrderStatus.READY);
        expect(order.readyAt).toBeInstanceOf(Date);
        expect(txItemRepo.save.mock.calls[0][0].foundQuantity.toFixed(2)).toBe('3.00');
        expect(incidentRepo.save).not.toHaveBeenCalled();
      });

      it('opens an INSUFFICIENT_STOCK incident, linked to the line, when less was found', async () => {
        const { service, repo, txOrderRepo, txItemRepo, incidentRepo } = createService();
        repo.findOneBy.mockResolvedValue(base({ status: InternalOrderStatus.PREPARING }));
        txOrderRepo.findOne.mockResolvedValue(base({ status: InternalOrderStatus.PREPARING }));
        txItemRepo.find.mockResolvedValue([
          { id: 'item-1', internalOrderId: 'order-1', productVariantId: 'variant-1', quantity: new Decimal('3') },
        ]);

        await service.markReady(COMPANY, OPERATOR, 'order-1', [{ itemId: 'item-1', foundQuantity: '1' }]);

        expect(incidentRepo.save).toHaveBeenCalledTimes(1);
        expect(incidentRepo.create.mock.calls[0][0]).toMatchObject({
          companyId: COMPANY,
          entityType: 'INTERNAL_ORDER_ITEM',
          entityId: 'item-1',
          reportedBy: OPERATOR,
        });
        expect(txItemRepo.save.mock.calls[0][0].incidentId).toBe('incident-1');
      });

      it('rejects an item id that does not belong to this order', async () => {
        const { service, repo, txOrderRepo, txItemRepo } = createService();
        repo.findOneBy.mockResolvedValue(base({ status: InternalOrderStatus.PREPARING }));
        txOrderRepo.findOne.mockResolvedValue(base({ status: InternalOrderStatus.PREPARING }));
        txItemRepo.find.mockResolvedValue([]);

        await expect(
          service.markReady(COMPANY, OPERATOR, 'order-1', [{ itemId: 'item-9', foundQuantity: '1' }]),
        ).rejects.toThrow(NotFoundException);
      });
    });

    it('claimAsRunner: READY -> RUNNER_ASSIGNED, self-assigned', async () => {
      const { service, repo, txOrderRepo } = createService();
      repo.findOneBy.mockResolvedValue(base({ status: InternalOrderStatus.READY }));
      txOrderRepo.findOne.mockResolvedValue(base({ status: InternalOrderStatus.READY }));

      const order = await service.claimAsRunner(COMPANY, RUNNER, 'order-1');

      expect(order.status).toBe(InternalOrderStatus.RUNNER_ASSIGNED);
      expect(order.runnerId).toBe(RUNNER);
      expect(order.runnerAcceptedAt).toBeInstanceOf(Date);
    });

    describe('pickUp: RUNNER_ASSIGNED -> IN_TRANSIT', () => {
      it('moves the found quantity from the source STOCK to the runner’s own bag', async () => {
        const { service, repo, txOrderRepo, txItemRepo, inventoryLocations, inventoryMovements } = createService();
        repo.findOneBy.mockResolvedValue(base({ status: InternalOrderStatus.RUNNER_ASSIGNED, runnerId: RUNNER }));
        txOrderRepo.findOne.mockResolvedValue(
          base({ status: InternalOrderStatus.RUNNER_ASSIGNED, runnerId: RUNNER }),
        );
        txItemRepo.find.mockResolvedValue([
          {
            id: 'item-1',
            productVariantId: 'variant-1',
            quantity: new Decimal('3'),
            foundQuantity: new Decimal('2'),
          },
        ]);

        const order = await service.pickUp(COMPANY, RUNNER, 'order-1');

        expect(inventoryLocations.findStockLocation).toHaveBeenCalledWith(expect.anything(), COMPANY, 'warehouse-1');
        expect(inventoryLocations.findOrCreateRunnerLocation).toHaveBeenCalledWith(expect.anything(), COMPANY, RUNNER);
        expect(inventoryMovements.recordInTransaction).toHaveBeenCalledWith(
          expect.anything(),
          COMPANY,
          RUNNER,
          expect.objectContaining({
            productVariantId: 'variant-1',
            fromLocationId: 'inv-loc-stock-1',
            toLocationId: 'inv-loc-runner-1',
            type: InventoryMovementType.RUNNER_PICKUP,
            sourceId: 'order-1',
          }),
        );
        // Usa lo encontrado (2), no lo pedido (3).
        expect(inventoryMovements.recordInTransaction.mock.calls[0][3].quantity.toFixed(2)).toBe('2.00');
        expect(order.status).toBe(InternalOrderStatus.IN_TRANSIT);
      });

      it('rejects anyone other than the assigned runner', async () => {
        const { service, repo, txOrderRepo, inventoryMovements } = createService();
        repo.findOneBy.mockResolvedValue(base({ status: InternalOrderStatus.RUNNER_ASSIGNED, runnerId: RUNNER }));
        txOrderRepo.findOne.mockResolvedValue(
          base({ status: InternalOrderStatus.RUNNER_ASSIGNED, runnerId: RUNNER }),
        );

        await expect(service.pickUp(COMPANY, 'someone-else', 'order-1')).rejects.toThrow(ForbiddenException);
        expect(inventoryMovements.recordInTransaction).not.toHaveBeenCalled();
      });
    });

    describe('deliver: IN_TRANSIT -> DELIVERED', () => {
      it('moves existence from the runner’s bag to the destination STOCK', async () => {
        const { service, repo, txOrderRepo, txItemRepo, inventoryLocations, inventoryMovements } = createService();
        repo.findOneBy.mockResolvedValue(base({ status: InternalOrderStatus.IN_TRANSIT, runnerId: RUNNER }));
        txOrderRepo.findOne.mockResolvedValue(base({ status: InternalOrderStatus.IN_TRANSIT, runnerId: RUNNER }));
        txItemRepo.find.mockResolvedValue([
          { id: 'item-1', productVariantId: 'variant-1', quantity: new Decimal('3'), foundQuantity: null },
        ]);

        const order = await service.deliver(COMPANY, RUNNER, 'order-1');

        expect(inventoryLocations.findStockLocation).toHaveBeenCalledWith(expect.anything(), COMPANY, 'store-1');
        expect(inventoryMovements.recordInTransaction).toHaveBeenCalledWith(
          expect.anything(),
          COMPANY,
          RUNNER,
          expect.objectContaining({
            fromLocationId: 'inv-loc-runner-1',
            toLocationId: 'inv-loc-stock-1',
            type: InventoryMovementType.RUNNER_DELIVERY,
          }),
        );
        expect(order.status).toBe(InternalOrderStatus.DELIVERED);
      });
    });

    it('receive: DELIVERED -> RECEIVED, with who received it', async () => {
      const { service, repo, txOrderRepo } = createService();
      repo.findOneBy.mockResolvedValue(base({ status: InternalOrderStatus.DELIVERED }));
      txOrderRepo.findOne.mockResolvedValue(base({ status: InternalOrderStatus.DELIVERED }));

      const order = await service.receive(COMPANY, 'seller-1', 'order-1');

      expect(order.status).toBe(InternalOrderStatus.RECEIVED);
      expect(order.receivedBy).toBe('seller-1');
    });

    it('complete: RECEIVED -> COMPLETED', async () => {
      const { service, repo, txOrderRepo } = createService();
      repo.findOneBy.mockResolvedValue(base({ status: InternalOrderStatus.RECEIVED }));
      txOrderRepo.findOne.mockResolvedValue(base({ status: InternalOrderStatus.RECEIVED }));

      const order = await service.complete(COMPANY, 'order-1');

      expect(order.status).toBe(InternalOrderStatus.COMPLETED);
    });
  });

  describe('cancel', () => {
    it('lets the requester cancel it without the warehouse permission', async () => {
      const { service, repo, txOrderRepo } = createService();
      repo.findOneBy.mockResolvedValue({ id: 'order-1', requestedBy: REQUESTER, status: InternalOrderStatus.PENDING });
      txOrderRepo.findOne.mockResolvedValue({
        id: 'order-1',
        requestedBy: REQUESTER,
        status: InternalOrderStatus.PENDING,
      });

      const order = await service.cancel(COMPANY, { userId: REQUESTER, canFulfillOrders: false }, 'order-1', 'Ya no hace falta');

      expect(order.status).toBe(InternalOrderStatus.CANCELLED);
      expect(order.cancellationReason).toBe('Ya no hace falta');
    });

    it('lets whoever fulfills orders cancel someone else’s', async () => {
      const { service, repo, txOrderRepo } = createService();
      repo.findOneBy.mockResolvedValue({ id: 'order-1', requestedBy: 'other', status: InternalOrderStatus.ACCEPTED });
      txOrderRepo.findOne.mockResolvedValue({
        id: 'order-1',
        requestedBy: 'other',
        status: InternalOrderStatus.ACCEPTED,
      });

      const order = await service.cancel(COMPANY, { userId: OPERATOR, canFulfillOrders: true }, 'order-1');

      expect(order.status).toBe(InternalOrderStatus.CANCELLED);
    });

    it('rejects anyone else', async () => {
      const { service, repo, txOrderRepo } = createService();
      repo.findOneBy.mockResolvedValue({ id: 'order-1', requestedBy: 'other', status: InternalOrderStatus.PENDING });
      txOrderRepo.findOne.mockResolvedValue({
        id: 'order-1',
        requestedBy: 'other',
        status: InternalOrderStatus.PENDING,
      });

      await expect(
        service.cancel(COMPANY, { userId: REQUESTER, canFulfillOrders: false }, 'order-1'),
      ).rejects.toThrow(ForbiddenException);
      expect(txOrderRepo.save).not.toHaveBeenCalled();
    });

    it('does not cancel one already closed', async () => {
      const { service, repo, txOrderRepo } = createService();
      repo.findOneBy.mockResolvedValue({ id: 'order-1', requestedBy: REQUESTER, status: InternalOrderStatus.COMPLETED });
      txOrderRepo.findOne.mockResolvedValue({
        id: 'order-1',
        requestedBy: REQUESTER,
        status: InternalOrderStatus.COMPLETED,
      });

      await expect(
        service.cancel(COMPANY, { userId: REQUESTER, canFulfillOrders: false }, 'order-1'),
      ).rejects.toThrow(ConflictException);
      expect(txOrderRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('updateItems', () => {
    const newItems = [{ productVariantId: 'variant-2', quantity: '5' }];

    it('edits the items in place while still PENDING, with no new version', async () => {
      const { service, repo, txOrderRepo, txItemRepo } = createService();
      repo.findOneBy.mockResolvedValue({ id: 'order-1', status: InternalOrderStatus.PENDING, versionNumber: 1 });
      txOrderRepo.findOne.mockResolvedValue({ id: 'order-1', status: InternalOrderStatus.PENDING, versionNumber: 1 });

      const order = await service.updateItems(COMPANY, REQUESTER, 'order-1', newItems);

      expect(txItemRepo.delete).toHaveBeenCalledWith({ internalOrderId: 'order-1' });
      expect(txItemRepo.save).toHaveBeenCalledWith([
        expect.objectContaining({ internalOrderId: 'order-1', productVariantId: 'variant-2' }),
      ]);
      expect(order.id).toBe('order-1');
      expect(txOrderRepo.create).not.toHaveBeenCalled();
    });

    it('creates version 2 and cancels version 1, once the order is past PENDING', async () => {
      const { service, repo, txOrderRepo, txItemRepo } = createService();
      const accepted = {
        id: 'order-1',
        orderNumber: 'PED-00001',
        versionNumber: 1,
        status: InternalOrderStatus.ACCEPTED,
        type: InternalOrderType.REPLENISHMENT,
        origin: InternalOrderOrigin.SELLER,
        sourceLocationId: 'warehouse-1',
        destinationLocationId: 'store-1',
        requestedBy: REQUESTER,
        notes: null,
      };
      repo.findOneBy.mockResolvedValue(accepted);
      txOrderRepo.findOne.mockResolvedValue(accepted);

      const revised = await service.updateItems(COMPANY, OPERATOR, 'order-1', newItems);

      // La versión 1 queda cancelada con el motivo, antes de crear la 2.
      expect(txOrderRepo.save).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          id: 'order-1',
          status: InternalOrderStatus.CANCELLED,
          cancellationReason: 'Reemplazada por la versión 2',
        }),
      );
      expect(txOrderRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ orderNumber: 'PED-00001', versionNumber: 2 }),
      );
      expect(txItemRepo.save).toHaveBeenCalledWith([
        expect.objectContaining({ productVariantId: 'variant-2' }),
      ]);
      expect(revised.versionNumber).toBe(2);
      expect(revised.status).toBe(InternalOrderStatus.PENDING);
    });

    it('does not edit a closed order', async () => {
      const { service, repo, txOrderRepo, txItemRepo } = createService();
      repo.findOneBy.mockResolvedValue({ id: 'order-1', status: InternalOrderStatus.CANCELLED });
      txOrderRepo.findOne.mockResolvedValue({ id: 'order-1', status: InternalOrderStatus.CANCELLED });

      await expect(service.updateItems(COMPANY, REQUESTER, 'order-1', newItems)).rejects.toThrow(
        ConflictException,
      );
      expect(txItemRepo.save).not.toHaveBeenCalled();
    });
  });
});
