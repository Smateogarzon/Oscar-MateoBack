import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Decimal } from 'decimal.js';
import { PermissionCode } from '../../common/enums/permission-code.enum.js';
import { RecordStatus } from '../../common/enums/record-status.enum.js';
import { IdempotencyKey } from '../idempotency/entities/idempotency-key.entity.js';
import { Incident } from '../incident/entities/incident.entity.js';
import { LocationType } from '../location/entities/location-type.enum.js';
import { Location } from '../location/entities/location.entity.js';
import { NotificationType } from '../notification/entities/notification-type.enum.js';
import { ProductVariant } from '../product-variant/entities/product-variant.entity.js';
import { Sale } from '../sale/entities/sale.entity.js';
import { UserCompanyRole } from '../user-company-role/entities/user-company-role.entity.js';
import { UserLocationAccess } from '../user-location-access/entities/user-location-access.entity.js';
import { User } from '../user/entities/user.entity.js';
import { InternalOrderEvent } from './entities/internal-order-event.entity.js';
import { InternalOrderItem } from './entities/internal-order-item.entity.js';
import { InternalOrderOrigin } from './entities/internal-order-origin.enum.js';
import { InternalOrderStatus as S } from './entities/internal-order-status.enum.js';
import { InternalOrderType } from './entities/internal-order-type.enum.js';
import { InternalOrderVersion } from './entities/internal-order-version.entity.js';
import { InternalOrder } from './entities/internal-order.entity.js';
import {
  InternalOrderService,
  type OrderActor,
} from './internal-order.service.js';

const COMPANY = 'company-1';
const ORDER_ID = 'order-1';
const SOURCE = 'warehouse-1';
const DESTINATION = 'store-1';

const P = PermissionCode;

const actor = (overrides: Partial<OrderActor> = {}): OrderActor => ({
  userId: 'user-1',
  permissionCodes: [],
  isSuperAdmin: false,
  isAdmin: false,
  ...overrides,
});

const SELLER = actor({
  userId: 'seller-1',
  permissionCodes: [P.ORDERS_REQUEST_FROM_WAREHOUSE, P.ORDERS_CONFIRM_RECEIPT],
});
const KEEPER = actor({
  userId: 'keeper-1',
  permissionCodes: [P.WAREHOUSE_FULFILL_ORDERS],
});
const RUNNER = actor({
  userId: 'runner-1',
  permissionCodes: [P.RUNNER_PICKUP_ORDERS, P.RUNNER_CONFIRM_DELIVERY],
});
const ADMIN = actor({ userId: 'admin-1', isAdmin: true });
const MOVER = actor({
  userId: 'mover-1',
  permissionCodes: [P.INVENTORY_TRANSFER],
});

const claimKey = (sql: string) =>
  sql.includes('INSERT INTO "idempotency_keys"') ? [{ id: 'claim-1' }] : [];

const order = (overrides: Partial<InternalOrder> = {}): InternalOrder =>
  ({
    id: ORDER_ID,
    companyId: COMPANY,
    orderNumber: 'SO-000001',
    versionNumber: 1,
    type: InternalOrderType.SO,
    status: S.NEW,
    sourceLocationId: SOURCE,
    destinationLocationId: DESTINATION,
    requestedBy: SELLER.userId,
    warehouseOperatorId: null,
    runnerId: null,
    receivedBy: null,
    parentOrderId: null,
    relatedOrderId: null,
    saleId: null,
    cancelledAt: null,
    cancelledBy: null,
    cancellationReason: null,
    ...overrides,
  }) as unknown as InternalOrder;

const line = (overrides: Partial<InternalOrderItem> = {}): InternalOrderItem =>
  ({
    id: 'item-1',
    internalOrderId: ORDER_ID,
    versionNumber: 1,
    productVariantId: 'variant-1',
    quantity: new Decimal(3),
    foundQuantity: null,
    unitPrice: new Decimal(100000),
    discountAmount: new Decimal(0),
    incidentId: null,
    ...overrides,
  }) as unknown as InternalOrderItem;

function createService() {
  // Lo que `manager.find` devuelve de cada entidad: cada prueba lo acomoda antes de llamar.
  const rows = {
    items: [] as InternalOrderItem[],
    variants: [
      {
        id: 'variant-1',
        companyId: COMPANY,
        sku: 'AF1-40',
        price: new Decimal(100000),
      },
      {
        id: 'variant-2',
        companyId: COMPANY,
        sku: 'AF1-41',
        price: new Decimal(100000),
      },
    ] as unknown[],
  };

  const orderRepo = {
    create: vi.fn((value: unknown) => value),
    save: vi.fn(async (value: object) => ({ id: ORDER_ID, ...value })),
    find: vi.fn().mockResolvedValue([]),
    findOne: vi.fn(),
    findOneBy: vi.fn(),
    findOneByOrFail: vi.fn(),
  };
  const itemRepo = {
    create: vi.fn((value: unknown) => value),
    save: vi.fn(async (value: unknown) => value),
    find: vi.fn().mockResolvedValue([]),
    delete: vi.fn().mockResolvedValue(undefined),
  };
  const versionRepo = {
    create: vi.fn((value: unknown) => value),
    save: vi.fn(async (value: unknown) => value),
  };
  const eventRepo = {
    create: vi.fn((value: unknown) => value),
    save: vi.fn(async (value: unknown) => value),
  };
  const incidentRepo = {
    create: vi.fn((value: unknown) => value),
    save: vi.fn(async (value: object) => ({ id: 'incident-1', ...value })),
  };
  type LocationRow = {
    id: string;
    companyId: string;
    name: string;
    type: LocationType;
    status: RecordStatus;
  };
  const locationRepo = {
    findOneBy: vi.fn(
      async ({ id }: { id: string }): Promise<LocationRow | null> => ({
        id,
        companyId: COMPANY,
        name: id === DESTINATION ? 'Tienda Centro' : 'Bodega Central',
        type: id === DESTINATION ? LocationType.STORE : LocationType.WAREHOUSE,
        status: RecordStatus.ACTIVE,
      }),
    ),
  };
  const userRepo = {
    findOneBy: vi
      .fn()
      .mockResolvedValue({ firstName: 'Camila', lastName: 'Rojas' }),
  };
  // Quien hace el paso trabaja en las dos sedes de la orden: así la ve (internal-order-visibility.ts)
  // y tiene asignada la bodega (hasStoreAccess). Lo que se prueba aquí es el flujo, no el alcance.
  const accessRepo = {
    find: vi
      .fn()
      .mockResolvedValue([{ locationId: SOURCE }, { locationId: DESTINATION }]),
    existsBy: vi.fn().mockResolvedValue(true),
  };
  const membershipRepo = { existsBy: vi.fn().mockResolvedValue(false) };
  const saleRepo = { existsBy: vi.fn().mockResolvedValue(false) };
  const idempotencyRepo = { findOneBy: vi.fn().mockResolvedValue(null) };

  const byEntity = new Map<unknown, unknown>([
    [InternalOrder, orderRepo],
    [InternalOrderItem, itemRepo],
    [InternalOrderVersion, versionRepo],
    [InternalOrderEvent, eventRepo],
    [Incident, incidentRepo],
    [Location, locationRepo],
    [User, userRepo],
    [UserLocationAccess, accessRepo],
    [UserCompanyRole, membershipRepo],
    [Sale, saleRepo],
    [IdempotencyKey, idempotencyRepo],
  ]);
  const fallbackRepo = {
    find: vi.fn().mockResolvedValue([]),
    findOne: vi.fn().mockResolvedValue(null),
    findOneBy: vi.fn().mockResolvedValue(null),
    existsBy: vi.fn().mockResolvedValue(false),
    save: vi.fn(async (value: unknown) => value),
    create: vi.fn((value: unknown) => value),
  };

  const manager = {
    getRepository: (entity: unknown) => byEntity.get(entity) ?? fallbackRepo,
    find: vi.fn(async (entity: unknown) =>
      entity === InternalOrderItem
        ? rows.items
        : entity === ProductVariant
          ? rows.variants
          : [],
    ),
    query: vi.fn(async (sql: string) => claimKey(sql)),
  };
  const dataSource = {
    transaction: vi.fn(async (fn: (manager: unknown) => unknown) =>
      fn(manager),
    ),
    manager,
  };

  const sequences = { next: vi.fn().mockResolvedValue(1) };
  const stock = {
    reserveAt: vi.fn(),
    release: vi.fn(),
    toRunner: vi.fn(),
    leftRunner: vi.fn().mockResolvedValue(false),
    fromRunner: vi.fn(),
    returnsToStock: vi.fn(),
  };
  const notifications = {
    findUserIdsWithPermission: vi.fn().mockResolvedValue([]),
    signalChange: vi.fn(),
    notify: vi.fn(),
    markEntityRead: vi.fn(),
  };
  const returnsBin = { hold: vi.fn() };
  const storeModelMinimums = { applyFromVariants: vi.fn() };
  const balances = { availableInStore: vi.fn().mockResolvedValue(new Map()) };

  const service = new InternalOrderService(
    orderRepo as never,
    dataSource as never,
    sequences as never,
    stock as never,
    notifications as never,
    returnsBin as never,
    storeModelMinimums as never,
    balances as never,
  );

  return {
    service,
    rows,
    orderRepo,
    itemRepo,
    versionRepo,
    incidentRepo,
    locationRepo,
    accessRepo,
    saleRepo,
    manager,
    dataSource,
    sequences,
    stock,
    notifications,
  };
}

const transferInput = {
  type: InternalOrderType.TR,
  origin: InternalOrderOrigin.SELLER,
  sourceLocationId: SOURCE,
  destinationLocationId: 'warehouse-2',
  items: [{ productVariantId: 'variant-1', quantity: '3' }],
};

describe('InternalOrderService', () => {
  describe('request', () => {
    it('no deja pedir un tipo de orden para el que no se tiene permiso', async () => {
      const { service, dataSource } = createService();

      await expect(
        service.request(COMPANY, SELLER, transferInput as never),
      ).rejects.toThrow(ForbiddenException);
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    // Una SO sí puede venir sin origen: lo decide el servidor según lo que tenga cada bodega.
    it('un traslado sin sede de origen se rechaza antes de tocar la base', async () => {
      const { service, dataSource } = createService();

      await expect(
        service.request(COMPANY, MOVER, {
          ...transferInput,
          sourceLocationId: undefined,
        } as never),
      ).rejects.toThrow(BadRequestException);
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('tampoco deja mover algo de una sede a ella misma', async () => {
      const { service } = createService();

      await expect(
        service.request(COMPANY, MOVER, {
          ...transferInput,
          destinationLocationId: SOURCE,
        } as never),
      ).rejects.toThrow(BadRequestException);
    });

    it('crea la orden en versión 1, con el consecutivo de su tipo', async () => {
      const { service, orderRepo, versionRepo, sequences, stock, manager } =
        createService();

      const [created] = await service.request(
        COMPANY,
        MOVER,
        transferInput as never,
      );

      expect(sequences.next).toHaveBeenCalledWith(
        manager,
        COMPANY,
        'TRANSFER_ORDER',
      );
      expect(orderRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          companyId: COMPANY,
          type: InternalOrderType.TR,
          status: S.TRANSFER_REQUESTED,
          versionNumber: 1,
          sourceLocationId: SOURCE,
          destinationLocationId: 'warehouse-2',
          orderNumber: 'TR-000001',
        }),
      );
      expect(versionRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          versionNumber: 1,
          internalOrderId: ORDER_ID,
        }),
      );
      // Lo pedido queda apartado en la bodega de origen desde que se pide, no cuando se alista.
      expect(stock.reserveAt).toHaveBeenCalledWith(
        manager,
        COMPANY,
        created,
        SOURCE,
        new Map([['variant-1', new Decimal(3)]]),
        MOVER.userId,
      );
    });

    it('no llega a crear nada si la sede no es de la empresa', async () => {
      const { service, orderRepo, locationRepo } = createService();
      locationRepo.findOneBy.mockResolvedValue(null);

      await expect(
        service.request(COMPANY, MOVER, transferInput as never),
      ).rejects.toThrow(NotFoundException);
      expect(orderRepo.save).not.toHaveBeenCalled();
    });

    it('con clave de idempotencia la reclama antes de guardar nada', async () => {
      const { service, orderRepo, manager } = createService();

      await service.request(COMPANY, MOVER, transferInput as never, 'key-1');

      expect(manager.query.mock.invocationCallOrder[0]).toBeLessThan(
        orderRepo.save.mock.invocationCallOrder[0],
      );
    });
  });

  describe('transition: el flujo de una venta, paso a paso', () => {
    it('no inventa pasos: lo que la tabla del tipo no permite no se puede', async () => {
      const { service, orderRepo } = createService();
      orderRepo.findOne.mockResolvedValue(order());

      await expect(
        service.transition(COMPANY, KEEPER, {
          id: ORDER_ID,
          to: S.IN_TRANSIT,
        } as never),
      ).rejects.toThrow(ConflictException);
      expect(orderRepo.save).not.toHaveBeenCalled();
    });

    it('PACK: bodega la toma y queda como responsable del alistamiento', async () => {
      const { service, orderRepo } = createService();
      orderRepo.findOne.mockResolvedValue(order());

      const moved = await service.transition(COMPANY, KEEPER, {
        id: ORDER_ID,
        to: S.PACKING,
      } as never);

      expect(moved.status).toBe(S.PACKING);
      expect(moved.warehouseOperatorId).toBe(KEEPER.userId);
    });

    it('PACK: sin el permiso de bodega no se toma', async () => {
      const { service, orderRepo } = createService();
      orderRepo.findOne.mockResolvedValue(order());

      await expect(
        service.transition(COMPANY, SELLER, {
          id: ORDER_ID,
          to: S.PACKING,
        } as never),
      ).rejects.toThrow(ForbiddenException);
    });

    // El permiso dice QUÉ puede hacer; la asignación de la sede dice DÓNDE.
    it('PACK: con el permiso pero sin la bodega asignada, tampoco', async () => {
      const { service, orderRepo, accessRepo } = createService();
      orderRepo.findOne.mockResolvedValue(order());
      accessRepo.existsBy.mockResolvedValue(false);

      await expect(
        service.transition(COMPANY, KEEPER, {
          id: ORDER_ID,
          to: S.PACKING,
        } as never),
      ).rejects.toThrow(ForbiddenException);
    });

    describe('READY: bodega dice cuánto encontró', () => {
      it('sin faltantes aparta lo encontrado y no abre novedad', async () => {
        const { service, orderRepo, incidentRepo, stock, manager, rows } =
          createService();
        orderRepo.findOne.mockResolvedValue(order({ status: S.PACKING }));
        rows.items = [line()];

        const moved = await service.transition(COMPANY, KEEPER, {
          id: ORDER_ID,
          to: S.READY_FOR_RUNNER,
          lines: [{ itemId: 'item-1', quantity: '3' }],
        } as never);

        expect(moved.status).toBe(S.READY_FOR_RUNNER);
        expect(incidentRepo.save).not.toHaveBeenCalled();
        expect(stock.reserveAt).toHaveBeenCalledWith(
          manager,
          COMPANY,
          moved,
          SOURCE,
          new Map([['variant-1', new Decimal(3)]]),
          KEEPER.userId,
        );
      });

      it('lo que falta abre una novedad colgada de su línea', async () => {
        const { service, orderRepo, incidentRepo, itemRepo, rows } =
          createService();
        orderRepo.findOne.mockResolvedValue(order({ status: S.PACKING }));
        rows.items = [line()];

        await service.transition(COMPANY, KEEPER, {
          id: ORDER_ID,
          to: S.READY_FOR_RUNNER,
          lines: [{ itemId: 'item-1', quantity: '1' }],
        } as never);

        expect(incidentRepo.save).toHaveBeenCalledTimes(1);
        expect(incidentRepo.create).toHaveBeenCalledWith(
          expect.objectContaining({
            entityId: 'item-1',
            productVariantId: 'variant-1',
          }),
        );
        expect(itemRepo.save).toHaveBeenCalledWith(
          expect.objectContaining({ id: 'item-1', incidentId: 'incident-1' }),
        );
      });

      it('no se puede registrar más de lo que pide la línea', async () => {
        const { service, orderRepo, rows } = createService();
        orderRepo.findOne.mockResolvedValue(order({ status: S.PACKING }));
        rows.items = [line()];

        await expect(
          service.transition(COMPANY, KEEPER, {
            id: ORDER_ID,
            to: S.READY_FOR_RUNNER,
            lines: [{ itemId: 'item-1', quantity: '9' }],
          } as never),
        ).rejects.toThrow(BadRequestException);
      });

      it('una línea que no es de la versión vigente no existe', async () => {
        const { service, orderRepo, rows } = createService();
        orderRepo.findOne.mockResolvedValue(order({ status: S.PACKING }));
        rows.items = [line()];

        await expect(
          service.transition(COMPANY, KEEPER, {
            id: ORDER_ID,
            to: S.READY_FOR_RUNNER,
            lines: [{ itemId: 'otra', quantity: '1' }],
          } as never),
        ).rejects.toThrow(NotFoundException);
      });
    });

    it('PICK_UP: lo apartado en bodega pasa a la bolsa del corredor que la tomó', async () => {
      const { service, orderRepo, stock, manager, rows } = createService();
      const taken = order({
        status: S.READY_FOR_RUNNER,
        runnerId: RUNNER.userId,
      });
      orderRepo.findOne.mockResolvedValue(taken);
      rows.items = [line({ foundQuantity: new Decimal(2) })];

      const moved = await service.transition(COMPANY, RUNNER, {
        id: ORDER_ID,
        to: S.IN_TRANSIT,
      } as never);

      expect(moved.status).toBe(S.IN_TRANSIT);
      expect(stock.release).toHaveBeenCalledWith(manager, ORDER_ID);
      // Lleva lo que bodega encontró, no lo que se pidió.
      expect(stock.toRunner).toHaveBeenCalledWith(
        manager,
        COMPANY,
        taken,
        RUNNER.userId,
        new Map([['variant-1', new Decimal(2)]]),
        RUNNER.userId,
      );
    });

    it('PICK_UP: hay que tomar la orden antes de recogerla', async () => {
      const { service, orderRepo, stock, rows } = createService();
      orderRepo.findOne.mockResolvedValue(
        order({ status: S.READY_FOR_RUNNER }),
      );
      rows.items = [line()];

      await expect(
        service.transition(COMPANY, RUNNER, {
          id: ORDER_ID,
          to: S.IN_TRANSIT,
        } as never),
      ).rejects.toThrow(ForbiddenException);
      expect(stock.toRunner).not.toHaveBeenCalled();
    });

    // La que lleva otro corredor ni siquiera la ve: para él no existe (ver `assertCanSee`).
    it('PICK_UP: la orden que ya tomó un corredor no es de nadie más', async () => {
      const { service, orderRepo, stock, rows } = createService();
      orderRepo.findOne.mockResolvedValue(
        order({ status: S.READY_FOR_RUNNER, runnerId: 'otro-corredor' }),
      );
      rows.items = [line()];

      await expect(
        service.transition(
          COMPANY,
          actor({
            userId: 'runner-2',
            permissionCodes: [P.RUNNER_PICKUP_ORDERS],
          }),
          {
            id: ORDER_ID,
            to: S.IN_TRANSIT,
          } as never,
        ),
      ).rejects.toThrow(NotFoundException);
      expect(stock.toRunner).not.toHaveBeenCalled();
    });

    it('DELIVER: entregar no termina la custodia, solo avisa a quien la pidió', async () => {
      const { service, orderRepo, stock, notifications, rows } =
        createService();
      orderRepo.findOne.mockResolvedValue(
        order({ status: S.IN_TRANSIT, runnerId: RUNNER.userId }),
      );
      rows.items = [line()];

      const moved = await service.transition(COMPANY, RUNNER, {
        id: ORDER_ID,
        to: S.DELIVERED_TO_STORE,
      } as never);

      expect(moved.status).toBe(S.DELIVERED_TO_STORE);
      expect(stock.fromRunner).not.toHaveBeenCalled();
      expect(notifications.notify).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          type: NotificationType.ORDER_DELIVERED,
          recipientIds: [SELLER.userId],
        }),
      );
    });

    it('RECEIVE: el vendedor confirma, sale de la bolsa del corredor y queda apartado para su cliente', async () => {
      const { service, orderRepo, stock, manager, rows } = createService();
      const arriving = order({
        status: S.DELIVERED_TO_STORE,
        runnerId: RUNNER.userId,
      });
      orderRepo.findOne.mockResolvedValue(arriving);
      rows.items = [line()];

      const moved = await service.transition(COMPANY, SELLER, {
        id: ORDER_ID,
        to: S.RECEIVED_BY_SELLER,
      } as never);

      expect(moved.status).toBe(S.RECEIVED_BY_SELLER);
      expect(moved.receivedBy).toBe(SELLER.userId);
      expect(stock.fromRunner).toHaveBeenCalledWith(
        manager,
        COMPANY,
        arriving,
        RUNNER.userId,
        new Map([['variant-1', new Decimal(3)]]),
        'STOCK',
        SELLER.userId,
        new Map(),
      );
      expect(stock.reserveAt).toHaveBeenCalledWith(
        manager,
        COMPANY,
        arriving,
        DESTINATION,
        new Map([['variant-1', new Decimal(3)]]),
        SELLER.userId,
      );
    });

    it('TO_PAYMENT: el cliente compra y la orden pasa a la cola de la caja', async () => {
      const { service, orderRepo, rows } = createService();
      orderRepo.findOne.mockResolvedValue(
        order({
          status: S.RECEIVED_BY_SELLER,
          runnerId: RUNNER.userId,
          receivedBy: SELLER.userId,
        }),
      );
      rows.items = [line()];

      const moved = await service.transition(COMPANY, SELLER, {
        id: ORDER_ID,
        to: S.PENDING_PAYMENT,
      } as never);

      expect(moved.status).toBe(S.PENDING_PAYMENT);
    });

    it('BACK_TO_SELLER: no vuelve al vendedor mientras la caja tenga el cobro abierto', async () => {
      const { service, orderRepo, saleRepo } = createService();
      orderRepo.findOne.mockResolvedValue(
        order({ status: S.PENDING_PAYMENT, runnerId: RUNNER.userId }),
      );
      saleRepo.existsBy.mockResolvedValue(true);

      await expect(
        service.transition(COMPANY, SELLER, {
          id: ORDER_ID,
          to: S.RECEIVED_BY_SELLER,
        } as never),
      ).rejects.toThrow(ConflictException);
    });

    it('CLOSE: un traslado recibido se cierra', async () => {
      const { service, orderRepo } = createService();
      orderRepo.findOne.mockResolvedValue(
        order({
          type: InternalOrderType.TR,
          orderNumber: 'TR-000001',
          status: S.RECEIVED_BY_DESTINATION,
          runnerId: RUNNER.userId,
        }),
      );

      const moved = await service.transition(COMPANY, SELLER, {
        id: ORDER_ID,
        to: S.TRANSFERRED,
      } as never);

      expect(moved.status).toBe(S.TRANSFERRED);
    });
  });

  describe('transition: anular una venta', () => {
    it('quien la pidió la anula mientras ningún corredor la haya tomado, y suelta lo apartado', async () => {
      const { service, orderRepo, stock, manager } = createService();
      orderRepo.findOne.mockResolvedValue(order());

      const moved = await service.transition(COMPANY, SELLER, {
        id: ORDER_ID,
        to: S.CANCELLED,
        reason: 'El cliente se fue',
      } as never);

      expect(moved.status).toBe(S.CANCELLED);
      expect(moved.cancelledBy).toBe(SELLER.userId);
      expect(moved.cancellationReason).toBe('El cliente se fue');
      expect(stock.release).toHaveBeenCalledWith(manager, ORDER_ID);
    });

    it('el administrador anula la de otro, y si bodega ya la tenía se le avisa que pare', async () => {
      const { service, orderRepo, notifications } = createService();
      orderRepo.findOne.mockResolvedValue(
        order({ status: S.PACKING, warehouseOperatorId: KEEPER.userId }),
      );
      notifications.findUserIdsWithPermission.mockResolvedValue([
        KEEPER.userId,
      ]);

      const moved = await service.transition(COMPANY, ADMIN, {
        id: ORDER_ID,
        to: S.CANCELLED,
      } as never);

      expect(moved.status).toBe(S.CANCELLED);
      expect(notifications.notify).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          type: NotificationType.ORDER_CANCELLED,
          recipientIds: [KEEPER.userId],
        }),
      );
    });

    it('la que nadie había tocado se anula sin molestar a bodega', async () => {
      const { service, orderRepo, notifications } = createService();
      orderRepo.findOne.mockResolvedValue(order());
      notifications.findUserIdsWithPermission.mockResolvedValue([
        KEEPER.userId,
      ]);

      await service.transition(COMPANY, SELLER, {
        id: ORDER_ID,
        to: S.CANCELLED,
      } as never);

      expect(notifications.notify).not.toHaveBeenCalled();
    });

    it('otro vendedor no anula lo que no pidió', async () => {
      const { service, orderRepo } = createService();
      orderRepo.findOne.mockResolvedValue(order());

      await expect(
        service.transition(
          COMPANY,
          actor({
            userId: 'seller-2',
            permissionCodes: [P.ORDERS_REQUEST_FROM_WAREHOUSE],
          }),
          {
            id: ORDER_ID,
            to: S.CANCELLED,
          } as never,
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(orderRepo.save).not.toHaveBeenCalled();
    });

    // Desde que un corredor la toma hay alguien yendo por ella: de ahí en adelante la anula el administrador.
    it('con un corredor en camino el vendedor ya no la anula', async () => {
      const { service, orderRepo } = createService();
      orderRepo.findOne.mockResolvedValue(
        order({ status: S.READY_FOR_RUNNER, runnerId: RUNNER.userId }),
      );

      await expect(
        service.transition(COMPANY, SELLER, {
          id: ORDER_ID,
          to: S.CANCELLED,
        } as never),
      ).rejects.toThrow(ConflictException);
    });

    it('una orden ya cerrada no se anula', async () => {
      const { service, orderRepo } = createService();
      orderRepo.findOne.mockResolvedValue(order({ status: S.PAID }));

      await expect(
        service.transition(COMPANY, ADMIN, {
          id: ORDER_ID,
          to: S.CANCELLED,
        } as never),
      ).rejects.toThrow(ConflictException);
      expect(orderRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('editOrder', () => {
    it('sube de versión con lo que queda y lo nuevo, y lo alistado vuelve a alistarse', async () => {
      const { service, orderRepo, versionRepo, stock, rows } = createService();
      orderRepo.findOne.mockResolvedValue(
        order({
          status: S.READY_FOR_RUNNER,
          warehouseOperatorId: KEEPER.userId,
        }),
      );
      rows.items = [
        line(),
        line({ id: 'item-2', productVariantId: 'variant-2' }),
      ];

      const edited = await service.editOrder(COMPANY, SELLER, {
        orderId: ORDER_ID,
        removeItemIds: ['item-2'],
        addLines: [{ productVariantId: 'variant-1', quantity: '1' }],
      } as never);

      expect(edited.versionNumber).toBe(2);
      expect(versionRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ versionNumber: 2 }),
      );
      expect(stock.reserveAt).toHaveBeenCalled();
      // Lo que ya estaba alistado dejó de valer: ningún corredor se la lleva hasta que vuelva a estar lista.
      expect(edited.status).toBe(S.PACKING);
    });

    it('no edita una orden cerrada', async () => {
      const { service, orderRepo } = createService();
      orderRepo.findOne.mockResolvedValue(order({ status: S.PAID }));

      await expect(
        service.editOrder(COMPANY, SELLER, {
          orderId: ORDER_ID,
          addLines: [{ productVariantId: 'variant-1', quantity: '1' }],
        } as never),
      ).rejects.toThrow(ConflictException);
    });

    it('solo se edita una orden de venta', async () => {
      const { service, orderRepo } = createService();
      orderRepo.findOne.mockResolvedValue(
        order({ type: InternalOrderType.TR, status: S.TRANSFER_REQUESTED }),
      );

      await expect(
        service.editOrder(COMPANY, SELLER, {
          orderId: ORDER_ID,
          addLines: [{ productVariantId: 'variant-1', quantity: '1' }],
        } as never),
      ).rejects.toThrow(ConflictException);
    });

    it('sin permiso de pedidos no se edita', async () => {
      const { service, dataSource } = createService();

      await expect(
        service.editOrder(COMPANY, KEEPER, {
          orderId: ORDER_ID,
          addLines: [{ productVariantId: 'variant-1', quantity: '1' }],
        } as never),
      ).rejects.toThrow(ForbiddenException);
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });
  });
});
