import { In } from 'typeorm';
import { NotificationChannel } from '../notification/entities/notification-channel.enum.js';
import { NotificationEntityType } from '../notification/entities/notification-entity-type.enum.js';
import { NotificationType } from '../notification/entities/notification-type.enum.js';
import {
  clearDiscountRequestNotices,
  findDiscountRequestsOfSales,
  withdrawDiscountRequests,
} from './discount-request-cleanup.js';
import { DiscountRequestStatus } from './entities/discount-request-status.enum.js';
import { DiscountRequest } from './entities/discount-request.entity.js';

const COMPANY = 'company-1';
const ACTIVE = [DiscountRequestStatus.PENDING, DiscountRequestStatus.APPROVED];

// Lo único que estas funciones leen de una solicitud: su id, su venta y su estado
const request = (id: string, status: DiscountRequestStatus, saleId = 'sale-1') =>
  ({ id, saleId, status }) as DiscountRequest;

function createMocks() {
  const requestRepo = {
    find: vi.fn().mockResolvedValue([]),
    update: vi.fn().mockResolvedValue(undefined),
  };
  const manager = {
    getRepository: vi.fn((entity: unknown) => (entity === DiscountRequest ? requestRepo : undefined)),
  };
  // Los administradores que aprueban descuentos
  const notifications = {
    findUserIdsWithPermission: vi.fn().mockResolvedValue(['admin-1', 'admin-2']),
    markEntityRead: vi.fn().mockResolvedValue(0),
    signalChange: vi.fn(),
  };
  return { requestRepo, manager, notifications };
}

// La señal en vivo que se espera por una solicitud
const changed = (entityId: string, exceptUserId: string) => ({
  companyId: COMPANY,
  channel: NotificationChannel.DISCOUNTS,
  entityType: NotificationEntityType.DISCOUNT_REQUEST,
  entityId,
  recipientIds: ['admin-1', 'admin-2'],
  exceptUserId,
});

describe('findDiscountRequestsOfSales', () => {
  it('asks for the requests of those sales that are in one of those statuses', async () => {
    const { requestRepo, manager } = createMocks();
    const found = [request('req-1', DiscountRequestStatus.PENDING)];
    requestRepo.find.mockResolvedValue(found);

    const result = await findDiscountRequestsOfSales(manager as never, ['sale-1', 'sale-2'], ACTIVE);

    expect(requestRepo.find).toHaveBeenCalledWith({
      where: { saleId: In(['sale-1', 'sale-2']), status: In(ACTIVE) },
    });
    expect(result).toBe(found);
  });

  it('does not ask the database anything when there are no sales', async () => {
    const { requestRepo, manager } = createMocks();

    const result = await findDiscountRequestsOfSales(manager as never, [], ACTIVE);

    expect(result).toEqual([]);
    expect(manager.getRepository).not.toHaveBeenCalled();
    expect(requestRepo.find).not.toHaveBeenCalled();
  });
});

describe('clearDiscountRequestNotices', () => {
  it('does nothing when there are no requests: it does not even look for the approvers', async () => {
    const { manager, notifications } = createMocks();

    await clearDiscountRequestNotices(manager as never, notifications as never, COMPANY, [], 'cashier-1');

    expect(notifications.findUserIdsWithPermission).not.toHaveBeenCalled();
    expect(notifications.markEntityRead).not.toHaveBeenCalled();
    expect(notifications.signalChange).not.toHaveBeenCalled();
  });

  it('marks the "new request" notices of the pending ones as read and signals the approvers, except whoever made the change', async () => {
    const { manager, notifications } = createMocks();

    await clearDiscountRequestNotices(
      manager as never,
      notifications as never,
      COMPANY,
      [request('req-1', DiscountRequestStatus.PENDING), request('req-2', DiscountRequestStatus.PENDING)],
      'admin-1',
    );

    expect(notifications.markEntityRead).toHaveBeenCalledTimes(2);
    expect(notifications.markEntityRead).toHaveBeenCalledWith(
      manager,
      NotificationEntityType.DISCOUNT_REQUEST,
      'req-1',
      [NotificationType.DISCOUNT_REQUESTED],
    );
    expect(notifications.markEntityRead).toHaveBeenCalledWith(
      manager,
      NotificationEntityType.DISCOUNT_REQUEST,
      'req-2',
      [NotificationType.DISCOUNT_REQUESTED],
    );
    expect(notifications.signalChange).toHaveBeenCalledTimes(2);
    expect(notifications.signalChange).toHaveBeenCalledWith(manager, changed('req-1', 'admin-1'));
    expect(notifications.signalChange).toHaveBeenCalledWith(manager, changed('req-2', 'admin-1'));
  });

  it('looks for the approvers of the company once, however many requests there are', async () => {
    const { manager, notifications } = createMocks();

    await clearDiscountRequestNotices(
      manager as never,
      notifications as never,
      COMPANY,
      [
        request('req-1', DiscountRequestStatus.PENDING),
        request('req-2', DiscountRequestStatus.PENDING),
        request('req-3', DiscountRequestStatus.APPROVED),
      ],
      'cashier-1',
    );

    expect(notifications.findUserIdsWithPermission).toHaveBeenCalledTimes(1);
    expect(notifications.findUserIdsWithPermission).toHaveBeenCalledWith(
      manager,
      COMPANY,
      'sales.approve_discount',
    );
  });

  it('only signals an approved request: its "new request" notice was already read when it was approved', async () => {
    const { manager, notifications } = createMocks();

    await clearDiscountRequestNotices(
      manager as never,
      notifications as never,
      COMPANY,
      [request('req-1', DiscountRequestStatus.APPROVED)],
      'cashier-1',
    );

    expect(notifications.markEntityRead).not.toHaveBeenCalled();
    expect(notifications.signalChange).toHaveBeenCalledTimes(1);
    expect(notifications.signalChange).toHaveBeenCalledWith(manager, changed('req-1', 'cashier-1'));
  });

  it('marks the notices of the pending ones and leaves the approved ones alone, when there are both', async () => {
    const { manager, notifications } = createMocks();

    await clearDiscountRequestNotices(
      manager as never,
      notifications as never,
      COMPANY,
      [request('req-1', DiscountRequestStatus.APPROVED), request('req-2', DiscountRequestStatus.PENDING)],
      'cashier-1',
    );

    expect(notifications.markEntityRead).toHaveBeenCalledTimes(1);
    expect(notifications.markEntityRead).toHaveBeenCalledWith(
      manager,
      NotificationEntityType.DISCOUNT_REQUEST,
      'req-2',
      [NotificationType.DISCOUNT_REQUESTED],
    );
    expect(notifications.signalChange).toHaveBeenCalledTimes(2);
  });
});

describe('withdrawDiscountRequests', () => {
  const params = {
    companyId: COMPANY,
    saleIds: ['sale-1', 'sale-2'],
    statuses: ACTIVE,
    actorId: 'cashier-1',
    note: 'La venta se canceló',
  };

  it('cancels the requests of those sales, leaving who did it, when and the note', async () => {
    const { requestRepo, manager, notifications } = createMocks();
    requestRepo.find.mockResolvedValue([
      request('req-1', DiscountRequestStatus.PENDING),
      request('req-2', DiscountRequestStatus.APPROVED, 'sale-2'),
    ]);

    await withdrawDiscountRequests(manager as never, notifications as never, params);

    expect(requestRepo.find).toHaveBeenCalledWith({
      where: { saleId: In(['sale-1', 'sale-2']), status: In(ACTIVE) },
    });
    expect(requestRepo.update).toHaveBeenCalledTimes(1);
    expect(requestRepo.update).toHaveBeenCalledWith(
      { id: In(['req-1', 'req-2']) },
      {
        status: DiscountRequestStatus.CANCELLED,
        resolvedBy: 'cashier-1',
        resolvedAt: expect.any(Date),
        resolutionNotes: 'La venta se canceló',
      },
    );
  });

  it('then clears the notices of what it cancelled, as whoever made the change', async () => {
    const { requestRepo, manager, notifications } = createMocks();
    requestRepo.find.mockResolvedValue([
      request('req-1', DiscountRequestStatus.PENDING),
      request('req-2', DiscountRequestStatus.APPROVED, 'sale-2'),
    ]);

    await withdrawDiscountRequests(manager as never, notifications as never, params);

    // Solo la pendiente tenía un aviso de "solicitud nueva" que apagar
    expect(notifications.markEntityRead).toHaveBeenCalledTimes(1);
    expect(notifications.markEntityRead).toHaveBeenCalledWith(
      manager,
      NotificationEntityType.DISCOUNT_REQUEST,
      'req-1',
      [NotificationType.DISCOUNT_REQUESTED],
    );
    expect(notifications.signalChange).toHaveBeenCalledTimes(2);
    expect(notifications.signalChange).toHaveBeenCalledWith(manager, changed('req-1', 'cashier-1'));
    expect(notifications.signalChange).toHaveBeenCalledWith(manager, changed('req-2', 'cashier-1'));
    expect(notifications.findUserIdsWithPermission).toHaveBeenCalledWith(
      manager,
      COMPANY,
      'sales.approve_discount',
    );
  });

  it('cancels first and only then tells anyone', async () => {
    const { requestRepo, manager, notifications } = createMocks();
    requestRepo.find.mockResolvedValue([request('req-1', DiscountRequestStatus.PENDING)]);

    await withdrawDiscountRequests(manager as never, notifications as never, params);

    expect(requestRepo.update.mock.invocationCallOrder[0]).toBeLessThan(
      notifications.markEntityRead.mock.invocationCallOrder[0],
    );
    expect(requestRepo.update.mock.invocationCallOrder[0]).toBeLessThan(
      notifications.signalChange.mock.invocationCallOrder[0],
    );
  });

  it('only looks in the statuses it was asked for', async () => {
    const { requestRepo, manager, notifications } = createMocks();

    await withdrawDiscountRequests(manager as never, notifications as never, {
      ...params,
      statuses: [DiscountRequestStatus.PENDING],
    });

    expect(requestRepo.find).toHaveBeenCalledWith({
      where: { saleId: In(['sale-1', 'sale-2']), status: In([DiscountRequestStatus.PENDING]) },
    });
  });

  it('does nothing when the sales have no such request: no update and nobody is told', async () => {
    const { requestRepo, manager, notifications } = createMocks();
    requestRepo.find.mockResolvedValue([]);

    await withdrawDiscountRequests(manager as never, notifications as never, params);

    expect(requestRepo.update).not.toHaveBeenCalled();
    expect(notifications.findUserIdsWithPermission).not.toHaveBeenCalled();
    expect(notifications.markEntityRead).not.toHaveBeenCalled();
    expect(notifications.signalChange).not.toHaveBeenCalled();
  });

  it('does not ask the database anything when there are no sales', async () => {
    const { requestRepo, manager, notifications } = createMocks();

    await withdrawDiscountRequests(manager as never, notifications as never, { ...params, saleIds: [] });

    expect(manager.getRepository).not.toHaveBeenCalled();
    expect(requestRepo.update).not.toHaveBeenCalled();
    expect(notifications.signalChange).not.toHaveBeenCalled();
  });
});
