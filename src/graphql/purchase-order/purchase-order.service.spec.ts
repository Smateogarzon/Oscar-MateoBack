import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import { IdempotencyKey } from '../idempotency/entities/idempotency-key.entity.js';
import { fingerprintOf } from '../idempotency/idempotency.js';
import { Location } from '../location/entities/location.entity.js';
import { LocationType } from '../location/entities/location-type.enum.js';
import { ProductVariant } from '../product-variant/entities/product-variant.entity.js';
import { User } from '../user/entities/user.entity.js';
import { Incident } from '../incident/entities/incident.entity.js';
import { PurchaseOrderItem } from './entities/purchase-order-item.entity.js';
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
    find: vi.fn().mockResolvedValue([]),
    findOne: vi.fn(),
    findOneByOrFail: vi.fn(),
  };
  const locationRepo = {
    findOneBy: vi.fn().mockResolvedValue({ id: 'warehouse-1', type: LocationType.WAREHOUSE }),
  };
  // `find` son los miembros de plataforma (el super admin) a los que también les llega la señal.
  const membershipRepo = { existsBy: vi.fn().mockResolvedValue(true), find: vi.fn().mockResolvedValue([]) };
  const userRepo = { existsBy: vi.fn().mockResolvedValue(true) };
  const idempotencyRepo = { findOneBy: vi.fn().mockResolvedValue(null) };
  const variantRepo = {
    find: vi.fn().mockResolvedValue([{ id: VARIANT, cost: new Decimal('1000') }]),
  };
  // Las líneas de la orden que se despacha o se recibe (ver `line`), y las novedades que nacen
  // cuando una cifra contada no cuadra con la anterior.
  const itemRepo = {
    create: vi.fn((value: unknown) => value),
    find: vi.fn().mockResolvedValue([]),
    save: vi.fn(async (value: object) => value),
  };
  const incidentRepo = {
    create: vi.fn((value: unknown) => value),
    save: vi.fn(async (value: object) => ({ id: 'incident-1', ...value })),
  };
  const manager = {
    getRepository: (entity: unknown) =>
      entity === Location
        ? locationRepo
        : entity === UserCompanyRole
          ? membershipRepo
          : entity === User
            ? userRepo
            : entity === ProductVariant
              ? variantRepo
              : entity === IdempotencyKey
                ? idempotencyRepo
                : entity === PurchaseOrderItem
                  ? itemRepo
                  : entity === Incident
                    ? incidentRepo
                    : txPurchaseOrderRepo,
    query: vi.fn(async (sql: string) => claimKey(sql)),
  };
  const dataSource = {
    transaction: vi.fn(async (fn: (manager: unknown) => unknown) => fn(manager)),
  };
  const sequences = { next: vi.fn().mockResolvedValue(1) };
  const receiving = { receive: vi.fn().mockResolvedValue(undefined) };
  // Compras y bodega siguen la orden por permisos distintos: cada uno trae a los suyos.
  const notifications = {
    signalChange: vi.fn(),
    findUserIdsWithPermission: vi.fn(async (_manager: unknown, _companyId: string, code: string) =>
      code === 'warehouse.fulfill_orders' ? ['warehouse-1'] : ['purchasing-1'],
    ),
  };
  const service = new PurchaseOrderService(
    repo as never,
    dataSource as never,
    sequences as never,
    receiving as never,
    notifications as never,
  );
  return {
    service,
    repo,
    txPurchaseOrderRepo,
    locationRepo,
    membershipRepo,
    userRepo,
    idempotencyRepo,
    variantRepo,
    itemRepo,
    incidentRepo,
    sequences,
    receiving,
    notifications,
    manager,
    dataSource,
  };
}

const COMPANY = 'company-1';
const USER = 'user-1';
const SUPPLIER = 'supplier-1';
const WAREHOUSE = 'warehouse-keeper-1';
const VARIANT = 'variant-1';
const input = {
  supplierId: SUPPLIER,
  destinationLocationId: 'warehouse-1',
  items: [{ productVariantId: VARIANT, quantity: '2' }],
};

// Una línea de la orden, como la trae la base de datos: `shipped` es lo que el proveedor ya
// despachó (null mientras no lo haya hecho).
const line = (quantity: string, shipped?: string) => ({
  id: 'item-1',
  purchaseOrderId: 'po-1',
  productVariantId: VARIANT,
  quantity: new Decimal(quantity),
  shippedQuantity: shipped === undefined ? null : new Decimal(shipped),
  receivedQuantity: null,
  shipmentIncidentId: null,
  receptionIncidentId: null,
});

// Una orden ya guardada, como la devuelve la base de datos al bloquearla.
const stored = (status: PurchaseOrderStatus) => ({
  id: 'po-1',
  supplierId: SUPPLIER,
  createdBy: USER,
  status,
});

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
      locationRepo.findOneBy.mockResolvedValue(null);

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

      const purchaseOrder = await service.send(COMPANY, USER, 'po-1');

      expect(purchaseOrder.status).toBe(PurchaseOrderStatus.SENT);
    });

    it('does not send one that is not a draft', async () => {
      const { service, repo, txPurchaseOrderRepo } = createService();
      repo.findOneBy.mockResolvedValue({ id: 'po-1', status: PurchaseOrderStatus.SENT });
      txPurchaseOrderRepo.findOne.mockResolvedValue({ id: 'po-1', status: PurchaseOrderStatus.SENT });

      await expect(service.send(COMPANY, USER, 'po-1')).rejects.toThrow(ConflictException);
      expect(txPurchaseOrderRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('ship', () => {
    it('lets the supplier count every line and dispatch a sent order', async () => {
      const { service, repo, txPurchaseOrderRepo, itemRepo } = createService();
      repo.findOneBy.mockResolvedValue(stored(PurchaseOrderStatus.SENT));
      txPurchaseOrderRepo.findOne.mockResolvedValue(stored(PurchaseOrderStatus.SENT));
      itemRepo.find.mockResolvedValue([line('2')]);

      const purchaseOrder = await service.ship(COMPANY, SUPPLIER, 'po-1', [{ itemId: 'item-1', quantity: '2' }]);

      expect(purchaseOrder.status).toBe(PurchaseOrderStatus.SHIPPED);
      expect(purchaseOrder.shippedAt).toBeInstanceOf(Date);
      expect(itemRepo.save).toHaveBeenCalledWith([
        expect.objectContaining({ id: 'item-1', shippedQuantity: new Decimal('2'), shipmentIncidentId: null }),
      ]);
    });

    it('opens an incident on the line when the supplier ships less than was ordered', async () => {
      const { service, repo, txPurchaseOrderRepo, itemRepo, incidentRepo } = createService();
      repo.findOneBy.mockResolvedValue(stored(PurchaseOrderStatus.SENT));
      txPurchaseOrderRepo.findOne.mockResolvedValue(stored(PurchaseOrderStatus.SENT));
      itemRepo.find.mockResolvedValue([line('2')]);

      await service.ship(COMPANY, SUPPLIER, 'po-1', [{ itemId: 'item-1', quantity: '1' }]);

      expect(incidentRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'SUPPLIER_ISSUE',
          status: 'OPEN',
          entityType: 'PURCHASE_ORDER_ITEM',
          entityId: 'item-1',
          reportedBy: SUPPLIER,
        }),
      );
      expect(itemRepo.save).toHaveBeenCalledWith([
        expect.objectContaining({ shippedQuantity: new Decimal('1'), shipmentIncidentId: 'incident-1' }),
      ]);
    });

    it('does not dispatch with a line left uncounted', async () => {
      const { service, repo, txPurchaseOrderRepo, itemRepo } = createService();
      repo.findOneBy.mockResolvedValue(stored(PurchaseOrderStatus.SENT));
      txPurchaseOrderRepo.findOne.mockResolvedValue(stored(PurchaseOrderStatus.SENT));
      itemRepo.find.mockResolvedValue([line('2'), { ...line('3'), id: 'item-2' }]);

      await expect(service.ship(COMPANY, SUPPLIER, 'po-1', [{ itemId: 'item-1', quantity: '2' }])).rejects.toThrow(
        BadRequestException,
      );
      expect(txPurchaseOrderRepo.save).not.toHaveBeenCalled();
    });

    it('leaves it waiting for the admin when the supplier ships more than was ordered', async () => {
      const { service, repo, txPurchaseOrderRepo, itemRepo } = createService();
      repo.findOneBy.mockResolvedValue(stored(PurchaseOrderStatus.SENT));
      txPurchaseOrderRepo.findOne.mockResolvedValue(stored(PurchaseOrderStatus.SENT));
      itemRepo.find.mockResolvedValue([line('2')]);

      const purchaseOrder = await service.ship(COMPANY, SUPPLIER, 'po-1', [{ itemId: 'item-1', quantity: '3' }]);

      expect(purchaseOrder.status).toBe(PurchaseOrderStatus.PENDING_APPROVAL);
      expect(purchaseOrder.hasIncidents).toBe(true);
    });

    it('rejects anyone other than the order own supplier', async () => {
      const { service, repo, txPurchaseOrderRepo, itemRepo } = createService();
      repo.findOneBy.mockResolvedValue(stored(PurchaseOrderStatus.SENT));
      txPurchaseOrderRepo.findOne.mockResolvedValue(stored(PurchaseOrderStatus.SENT));
      itemRepo.find.mockResolvedValue([line('2')]);

      await expect(
        service.ship(COMPANY, 'someone-else', 'po-1', [{ itemId: 'item-1', quantity: '2' }]),
      ).rejects.toThrow(ForbiddenException);
      expect(txPurchaseOrderRepo.save).not.toHaveBeenCalled();
    });

    it('does not dispatch one that has not been sent', async () => {
      const { service, repo, txPurchaseOrderRepo } = createService();
      repo.findOneBy.mockResolvedValue(stored(PurchaseOrderStatus.DRAFT));
      txPurchaseOrderRepo.findOne.mockResolvedValue(stored(PurchaseOrderStatus.DRAFT));

      await expect(service.ship(COMPANY, SUPPLIER, 'po-1', [{ itemId: 'item-1', quantity: '2' }])).rejects.toThrow(
        ConflictException,
      );
      expect(txPurchaseOrderRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('receive', () => {
    const counted = [{ itemId: 'item-1', quantity: '2' }];

    it('lets the warehouse keeper accept a dispatched order, and records who counted it', async () => {
      const { service, repo, txPurchaseOrderRepo, receiving } = createService();
      repo.findOneBy.mockResolvedValue(stored(PurchaseOrderStatus.SHIPPED));
      txPurchaseOrderRepo.findOne.mockResolvedValue(stored(PurchaseOrderStatus.SHIPPED));

      const purchaseOrder = await service.receive(COMPANY, WAREHOUSE, 'po-1', counted);

      expect(receiving.receive).toHaveBeenCalledWith(
        expect.anything(),
        COMPANY,
        WAREHOUSE,
        expect.objectContaining({ id: 'po-1' }),
        counted,
      );
      expect(purchaseOrder.status).toBe(PurchaseOrderStatus.RECEIVED);
      expect(purchaseOrder.receivedBy).toBe(WAREHOUSE);
      expect(purchaseOrder.receivedAt).toBeInstanceOf(Date);
    });

    it('does not let the supplier of the order sign for its own arrival', async () => {
      const { service, repo, txPurchaseOrderRepo, receiving } = createService();
      repo.findOneBy.mockResolvedValue(stored(PurchaseOrderStatus.SHIPPED));
      txPurchaseOrderRepo.findOne.mockResolvedValue(stored(PurchaseOrderStatus.SHIPPED));

      await expect(service.receive(COMPANY, SUPPLIER, 'po-1', counted)).rejects.toThrow(ForbiddenException);
      expect(receiving.receive).not.toHaveBeenCalled();
    });

    it('does not receive one the supplier has not dispatched yet', async () => {
      const { service, repo, txPurchaseOrderRepo, receiving } = createService();
      repo.findOneBy.mockResolvedValue(stored(PurchaseOrderStatus.SENT));
      txPurchaseOrderRepo.findOne.mockResolvedValue(stored(PurchaseOrderStatus.SENT));

      await expect(service.receive(COMPANY, WAREHOUSE, 'po-1', counted)).rejects.toThrow(ConflictException);
      expect(receiving.receive).not.toHaveBeenCalled();
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

  // Lo que hace que la orden se vea en vivo: cada paso manda una señal (canal PURCHASING, sin crear
  // avisos) a quienes la siguen. Sale sola al confirmarse la transacción (ver RealtimeService).
  describe('the live signal', () => {
    it('signals the supplier, purchasing, the warehouse and the super admin when the order is created', async () => {
      const { service, notifications } = createService();
      // findUserIdsWithPermission trae siempre a los miembros de plataforma (el super admin): no hace
      // falta buscarlo aparte.
      notifications.findUserIdsWithPermission.mockImplementation(async (_manager: unknown, _companyId: string, code: string) =>
        code === 'warehouse.fulfill_orders' ? ['warehouse-1', 'super-1'] : ['purchasing-1', 'super-1'],
      );

      await service.create(COMPANY, USER, input);

      expect(notifications.signalChange).toHaveBeenCalledWith(expect.anything(), {
        companyId: COMPANY,
        channel: 'PURCHASING',
        entityType: 'PURCHASE_ORDER',
        entityId: 'po-1',
        recipientIds: [SUPPLIER, USER, 'purchasing-1', 'super-1', 'warehouse-1', 'super-1'],
        exceptUserId: USER,
      });
    });

    it('only asks for the company roles with each permission, never another supplier', async () => {
      const { service, notifications } = createService();

      await service.create(COMPANY, USER, input);

      expect(notifications.findUserIdsWithPermission).toHaveBeenCalledWith(
        expect.anything(),
        COMPANY,
        'suppliers.manage_purchase_orders',
        { scope: 'COMPANY' },
      );
      expect(notifications.findUserIdsWithPermission).toHaveBeenCalledWith(
        expect.anything(),
        COMPANY,
        'warehouse.fulfill_orders',
        { scope: 'COMPANY' },
      );
    });

    it.each([
      ['send', (service: PurchaseOrderService) => service.send(COMPANY, USER, 'po-1'), PurchaseOrderStatus.DRAFT, USER],
      [
        'ship',
        (service: PurchaseOrderService) => service.ship(COMPANY, SUPPLIER, 'po-1', [{ itemId: 'item-1', quantity: '2' }]),
        PurchaseOrderStatus.SENT,
        SUPPLIER,
      ],
      [
        'receive',
        (service: PurchaseOrderService) => service.receive(COMPANY, WAREHOUSE, 'po-1', [{ itemId: 'item-1', quantity: '2' }]),
        PurchaseOrderStatus.SHIPPED,
        WAREHOUSE,
      ],
      [
        'cancel',
        (service: PurchaseOrderService) => service.cancel(COMPANY, { userId: USER, canManagePurchasing: true }, 'po-1'),
        PurchaseOrderStatus.SENT,
        USER,
      ],
    ])('signals the change on %s, leaving out whoever did it', async (_name, act, status, actorId) => {
      const { service, repo, txPurchaseOrderRepo, itemRepo, notifications } = createService();
      repo.findOneBy.mockResolvedValue(stored(status));
      txPurchaseOrderRepo.findOne.mockResolvedValue(stored(status));
      itemRepo.find.mockResolvedValue([line('2')]);

      await act(service);

      expect(notifications.signalChange).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          channel: 'PURCHASING',
          entityType: 'PURCHASE_ORDER',
          entityId: 'po-1',
          exceptUserId: actorId,
        }),
      );
    });

    it('does not signal anything when the step is rejected', async () => {
      const { service, repo, txPurchaseOrderRepo, notifications } = createService();
      repo.findOneBy.mockResolvedValue(stored(PurchaseOrderStatus.SENT));
      txPurchaseOrderRepo.findOne.mockResolvedValue(stored(PurchaseOrderStatus.SENT));

      await expect(service.send(COMPANY, USER, 'po-1')).rejects.toThrow(ConflictException);
      expect(notifications.signalChange).not.toHaveBeenCalled();
    });
  });
});
