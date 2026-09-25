import { NotFoundException } from '@nestjs/common';
import { In, IsNull, Not } from 'typeorm';
import { RecordStatus } from '../../common/enums/record-status.enum.js';
import { RealtimeEventKind } from '../../realtime/realtime-event.js';
import { RolePermission } from '../role-permission/entities/role-permission.entity.js';
import { RoleScope } from '../role/entities/role-scope.enum.js';
import { UserCompanyRole } from '../user-company-role/entities/user-company-role.entity.js';
import { User } from '../user/entities/user.entity.js';
import { NotificationChannel } from './entities/notification-channel.enum.js';
import { NotificationEntityType } from './entities/notification-entity-type.enum.js';
import { NotificationType } from './entities/notification-type.enum.js';
import { Notification } from './entities/notification.entity.js';
import { UserNotification } from './entities/user-notification.entity.js';
import { NotificationService, type NotifyInput } from './notification.service.js';

const COMPANY = 'company-1';

// Una notificación tal como la deja la base de datos, con su aviso cargado
const userNotification = (overrides: Record<string, unknown> = {}) => ({
  id: 'un-1',
  userId: 'user-1',
  readAt: null,
  createdAt: new Date('2026-09-23T10:00:00Z'),
  notification: {
    id: 'notification-1',
    companyId: COMPANY,
    channel: NotificationChannel.DISCOUNTS,
    type: NotificationType.DISCOUNT_REQUESTED,
    title: 'Solicitud de descuento',
    message: 'Camila Rojas pidió un descuento en la venta VTA-000125.',
    entityType: NotificationEntityType.DISCOUNT_REQUEST,
    entityId: 'req-1',
    locationId: 'store-1',
    actorId: 'cashier-1',
  },
  ...overrides,
});

const notifyInput = (overrides: Partial<NotifyInput> = {}): NotifyInput => ({
  companyId: COMPANY,
  type: NotificationType.DISCOUNT_REQUESTED,
  recipientIds: ['admin-1', 'admin-2'],
  actorId: 'cashier-1',
  entityType: NotificationEntityType.DISCOUNT_REQUEST,
  entityId: 'req-1',
  locationId: 'store-1',
  reference: 'VTA-000125',
  ...overrides,
});

function createService() {
  const userNotificationRepo = {
    find: vi.fn().mockResolvedValue([]),
    count: vi.fn().mockResolvedValue(0),
  };
  const txUserNotificationRepo = {
    find: vi.fn().mockResolvedValue([]),
    findOne: vi.fn(),
    create: vi.fn((value: unknown) => value),
    save: vi.fn(async (value: unknown) => value),
  };
  const txNotificationRepo = {
    create: vi.fn((value: unknown) => value),
    save: vi.fn(async (value: object) => ({ id: 'notification-1', ...value })),
  };
  const txUserRepo = {
    findOneBy: vi.fn().mockResolvedValue({ id: 'cashier-1', firstName: 'Camila', lastName: 'Rojas' }),
  };
  const txRolePermissionRepo = { find: vi.fn().mockResolvedValue([]) };
  const txMembershipRepo = { find: vi.fn().mockResolvedValue([]) };
  // El UPDATE de "marcar todo como leído" es un solo query builder, no fila por fila
  const updateBuilder = {
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    andWhere: vi.fn().mockReturnThis(),
    execute: vi.fn().mockResolvedValue({ affected: 0 }),
  };

  const manager = {
    createQueryBuilder: () => updateBuilder,
    getRepository: (entity: unknown) =>
      entity === UserNotification
        ? txUserNotificationRepo
        : entity === Notification
          ? txNotificationRepo
          : entity === User
            ? txUserRepo
            : entity === RolePermission
              ? txRolePermissionRepo
              : entity === UserCompanyRole
                ? txMembershipRepo
                : undefined,
  };
  const dataSource = {
    transaction: vi.fn(async (fn: (manager: unknown) => unknown) => fn(manager)),
  };

  const realtime = { publishAfterCommit: vi.fn() };

  const service = new NotificationService(
    userNotificationRepo as never,
    dataSource as never,
    realtime as never,
  );
  return {
    service,
    realtime,
    userNotificationRepo,
    txUserNotificationRepo,
    txNotificationRepo,
    txUserRepo,
    txRolePermissionRepo,
    txMembershipRepo,
    updateBuilder,
    manager,
    dataSource,
  };
}

describe('NotificationService', () => {
  describe('notify', () => {
    it('creates the notice once, in its channel, and hands it to each recipient', async () => {
      const { service, txNotificationRepo, txUserNotificationRepo, manager } = createService();

      const result = await service.notify(manager as never, notifyInput());

      expect(txNotificationRepo.create).toHaveBeenCalledTimes(1);
      expect(txNotificationRepo.create).toHaveBeenCalledWith({
        companyId: COMPANY,
        channel: NotificationChannel.DISCOUNTS,
        type: NotificationType.DISCOUNT_REQUESTED,
        title: 'Solicitud de descuento',
        message: 'Camila Rojas pidió un descuento en la venta VTA-000125.',
        entityType: NotificationEntityType.DISCOUNT_REQUEST,
        entityId: 'req-1',
        locationId: 'store-1',
        actorId: 'cashier-1',
      });
      expect(txUserNotificationRepo.save).toHaveBeenCalledWith([
        { notificationId: 'notification-1', userId: 'admin-1' },
        { notificationId: 'notification-1', userId: 'admin-2' },
      ]);
      expect(result?.notification.id).toBe('notification-1');
      expect(result?.recipientIds).toEqual(['admin-1', 'admin-2']);
    });

    it('takes the channel from the type, not from whoever notifies', async () => {
      const { service, txNotificationRepo, manager } = createService();

      await service.notify(
        manager as never,
        notifyInput({
          type: NotificationType.RETURN_REQUESTED,
          entityType: NotificationEntityType.SALE_RETURN,
          reference: 'DEV-00018',
        }),
      );

      expect(txNotificationRepo.create.mock.calls[0][0]).toMatchObject({
        channel: NotificationChannel.RETURNS,
        type: NotificationType.RETURN_REQUESTED,
        title: 'Solicitud de devolución',
      });
    });

    it('never tells someone about what they did themselves', async () => {
      const { service, txUserNotificationRepo, manager } = createService();

      const result = await service.notify(
        manager as never,
        notifyInput({ recipientIds: ['admin-1', 'cashier-1'] }),
      );

      expect(result?.recipientIds).toEqual(['admin-1']);
      expect(txUserNotificationRepo.save).toHaveBeenCalledWith([
        { notificationId: 'notification-1', userId: 'admin-1' },
      ]);
    });

    it('does not repeat a recipient', async () => {
      const { service, txUserNotificationRepo, manager } = createService();

      await service.notify(manager as never, notifyInput({ recipientIds: ['admin-1', 'admin-1'] }));

      expect(txUserNotificationRepo.save).toHaveBeenCalledWith([
        { notificationId: 'notification-1', userId: 'admin-1' },
      ]);
    });

    it.each([[[]], [['cashier-1']]])(
      'creates nothing when there is nobody to tell (recipients: %j)',
      async (recipientIds) => {
        const { service, txNotificationRepo, txUserNotificationRepo, txUserRepo, manager } =
          createService();

        const result = await service.notify(manager as never, notifyInput({ recipientIds }));

        expect(result).toBeNull();
        expect(txUserRepo.findOneBy).not.toHaveBeenCalled();
        expect(txNotificationRepo.save).not.toHaveBeenCalled();
        expect(txUserNotificationRepo.save).not.toHaveBeenCalled();
      },
    );

    it('names the actor in the text, and falls back when the user cannot be found', async () => {
      const { service, txNotificationRepo, txUserRepo, manager } = createService();
      txUserRepo.findOneBy.mockResolvedValue(null);

      await service.notify(manager as never, notifyInput());

      expect(txNotificationRepo.create.mock.calls[0][0].message).toBe(
        'Alguien pidió un descuento en la venta VTA-000125.',
      );
    });

    it('tells each recipient live that they have a new notice, once the transaction commits', async () => {
      const { service, realtime, manager } = createService();

      await service.notify(manager as never, notifyInput());

      expect(realtime.publishAfterCommit).toHaveBeenCalledTimes(1);
      const [publishedManager, events] = realtime.publishAfterCommit.mock.calls[0];
      expect(publishedManager).toBe(manager);
      expect(events).toEqual([
        {
          companyId: COMPANY,
          userId: 'admin-1',
          kind: RealtimeEventKind.NOTIFICATION_CREATED,
          channel: NotificationChannel.DISCOUNTS,
          type: NotificationType.DISCOUNT_REQUESTED,
          entityType: NotificationEntityType.DISCOUNT_REQUEST,
          entityId: 'req-1',
          at: expect.any(Date),
        },
        expect.objectContaining({ userId: 'admin-2', kind: RealtimeEventKind.NOTIFICATION_CREATED }),
      ]);
    });

    it('does not send a live signal to whoever did the action, nor when there is nobody to tell', async () => {
      const { service, realtime, manager } = createService();

      await service.notify(manager as never, notifyInput({ recipientIds: ['admin-1', 'cashier-1'] }));
      await service.notify(manager as never, notifyInput({ recipientIds: ['cashier-1'] }));

      expect(realtime.publishAfterCommit).toHaveBeenCalledTimes(1);
      expect(realtime.publishAfterCommit.mock.calls[0][1]).toHaveLength(1);
      expect(realtime.publishAfterCommit.mock.calls[0][1][0].userId).toBe('admin-1');
    });

    it('adds the note of a rejection to the text', async () => {
      const { service, txNotificationRepo, manager } = createService();

      await service.notify(
        manager as never,
        notifyInput({
          type: NotificationType.DISCOUNT_REJECTED,
          recipientIds: ['cashier-1'],
          actorId: 'admin-1',
          notes: 'Muy alto',
        }),
      );

      expect(txNotificationRepo.create.mock.calls[0][0].message).toContain('Nota: Muy alto');
    });

    it('talks about "una venta en curso" when the sale is a draft and has no number yet', async () => {
      const { service, txNotificationRepo, manager } = createService();

      await service.notify(manager as never, notifyInput({ reference: null }));

      expect(txNotificationRepo.create.mock.calls[0][0].message).toBe(
        'Camila Rojas pidió un descuento en una venta en curso.',
      );
    });
  });

  // De vez en cuando se aprovecha un aviso nuevo para borrar los de más de 180 días, sin esperar y por
  // otra conexión del pool (la de la transacción no se entera).
  describe('purge of old notices', () => {
    // Deja correr el borrado, que nadie espera
    const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

    it('deletes the notices of more than 180 days, the recipients first and then the notices left without any', async () => {
      const { service, manager } = createService();
      const query = vi.fn().mockResolvedValue(undefined);
      const random = vi.spyOn(Math, 'random').mockReturnValue(0);

      try {
        await service.notify({ ...manager, connection: { query } } as never, notifyInput());
        await flush();
      } finally {
        random.mockRestore();
      }

      expect(query).toHaveBeenCalledTimes(2);
      expect(query.mock.calls[0][0]).toContain('DELETE FROM "user_notifications"');
      expect(query.mock.calls[0][0]).toContain("interval '180 days'");
      expect(query.mock.calls[1][0]).toContain('DELETE FROM "notifications"');
      expect(query.mock.calls[1][0]).toContain("interval '180 days'");
    });

    it('does not purge on most notices', async () => {
      const { service, manager } = createService();
      const query = vi.fn().mockResolvedValue(undefined);
      const random = vi.spyOn(Math, 'random').mockReturnValue(0.5);

      try {
        await service.notify({ ...manager, connection: { query } } as never, notifyInput());
        await flush();
      } finally {
        random.mockRestore();
      }

      expect(query).not.toHaveBeenCalled();
    });

    it('does not fail the notice when the purge fails: the next one tries again', async () => {
      const { service, manager } = createService();
      const query = vi.fn().mockRejectedValue(new Error('conexión perdida'));
      const random = vi.spyOn(Math, 'random').mockReturnValue(0);

      try {
        const result = await service.notify({ ...manager, connection: { query } } as never, notifyInput());
        await flush();
        expect(result?.notification.id).toBe('notification-1');
      } finally {
        random.mockRestore();
      }
    });
  });

  describe('signalChange', () => {
    const signal = {
      companyId: COMPANY,
      channel: NotificationChannel.DISCOUNTS,
      entityType: NotificationEntityType.DISCOUNT_REQUEST,
      entityId: 'req-1',
    };

    it('tells the recipients live that something changed, without creating any notice', async () => {
      const { service, realtime, manager, txNotificationRepo, txUserNotificationRepo } =
        createService();

      service.signalChange(manager as never, { ...signal, recipientIds: ['admin-1', 'admin-2'] });

      expect(realtime.publishAfterCommit).toHaveBeenCalledWith(manager, [
        {
          companyId: COMPANY,
          userId: 'admin-1',
          kind: RealtimeEventKind.ENTITY_CHANGED,
          channel: NotificationChannel.DISCOUNTS,
          type: null,
          entityType: NotificationEntityType.DISCOUNT_REQUEST,
          entityId: 'req-1',
          at: expect.any(Date),
        },
        expect.objectContaining({ userId: 'admin-2', kind: RealtimeEventKind.ENTITY_CHANGED }),
      ]);
      expect(txNotificationRepo.save).not.toHaveBeenCalled();
      expect(txUserNotificationRepo.save).not.toHaveBeenCalled();
    });

    it('leaves out whoever made the change, and does not repeat a recipient', async () => {
      const { service, realtime, manager } = createService();

      service.signalChange(manager as never, {
        ...signal,
        recipientIds: ['admin-1', 'admin-2', 'admin-2'],
        exceptUserId: 'admin-1',
      });

      const events = realtime.publishAfterCommit.mock.calls[0][1];
      expect(events.map((event: { userId: string }) => event.userId)).toEqual(['admin-2']);
    });
  });

  describe('findUserIdsWithPermission', () => {
    it('finds the active members of the company whose active, non-platform role has the permission', async () => {
      const { service, txRolePermissionRepo, txMembershipRepo, manager } = createService();
      txRolePermissionRepo.find.mockResolvedValue([{ roleId: 'role-1' }, { roleId: 'role-2' }]);
      txMembershipRepo.find.mockResolvedValue([
        { userId: 'admin-1' },
        { userId: 'admin-2' },
        { userId: 'admin-1' },
      ]);

      const userIds = await service.findUserIdsWithPermission(
        manager as never,
        COMPANY,
        'sales.approve_discount' as never,
      );

      expect(txRolePermissionRepo.find).toHaveBeenCalledWith({
        where: {
          companyId: COMPANY,
          permission: { code: 'sales.approve_discount', status: RecordStatus.ACTIVE },
          role: { status: RecordStatus.ACTIVE, scope: Not(RoleScope.GLOBAL) },
        },
      });
      expect(txMembershipRepo.find).toHaveBeenCalledWith({
        where: {
          companyId: COMPANY,
          roleId: In(['role-1', 'role-2']),
          status: RecordStatus.ACTIVE,
          user: { status: RecordStatus.ACTIVE },
        },
      });
      expect(userIds).toEqual(['admin-1', 'admin-2']);
    });

    it('is empty, without looking for members, when no role has the permission', async () => {
      const { service, txMembershipRepo, manager } = createService();

      const userIds = await service.findUserIdsWithPermission(
        manager as never,
        COMPANY,
        'sales.approve_return' as never,
      );

      expect(userIds).toEqual([]);
      expect(txMembershipRepo.find).not.toHaveBeenCalled();
    });
  });

  describe('markEntityRead', () => {
    it('marks as read the unread notices of a thing, for everyone who had them pending', async () => {
      const { service, txUserNotificationRepo, manager } = createService();
      const rows = [userNotification({ id: 'un-1' }), userNotification({ id: 'un-2', userId: 'admin-2' })];
      txUserNotificationRepo.find.mockResolvedValue(rows);

      const marked = await service.markEntityRead(
        manager as never,
        NotificationEntityType.DISCOUNT_REQUEST,
        'req-1',
        [NotificationType.DISCOUNT_REQUESTED],
      );

      expect(txUserNotificationRepo.find).toHaveBeenCalledWith({
        where: {
          readAt: IsNull(),
          notification: {
            entityType: NotificationEntityType.DISCOUNT_REQUEST,
            entityId: 'req-1',
            type: In([NotificationType.DISCOUNT_REQUESTED]),
          },
        },
      });
      expect(rows[0].readAt).toBeInstanceOf(Date);
      expect(rows[1].readAt).toBeInstanceOf(Date);
      expect(txUserNotificationRepo.save).toHaveBeenCalledWith(rows);
      expect(marked).toBe(2);
    });

    it('does nothing when there is nothing unread', async () => {
      const { service, txUserNotificationRepo, manager } = createService();

      const marked = await service.markEntityRead(
        manager as never,
        NotificationEntityType.SALE_RETURN,
        'return-1',
        [NotificationType.RETURN_REQUESTED],
      );

      expect(marked).toBe(0);
      expect(txUserNotificationRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('findMine', () => {
    it('lists the notices of who asks, in the active company, the most recent first', async () => {
      const { service, userNotificationRepo } = createService();
      userNotificationRepo.find.mockResolvedValue([userNotification()]);

      const notices = await service.findMine(COMPANY, 'user-1');

      expect(userNotificationRepo.find).toHaveBeenCalledWith({
        where: { userId: 'user-1', notification: { companyId: COMPANY } },
        relations: { notification: true },
        order: { createdAt: 'DESC', id: 'DESC' },
        take: 30,
        skip: 0,
      });
      expect(notices).toEqual([
        {
          id: 'un-1',
          notificationId: 'notification-1',
          channel: NotificationChannel.DISCOUNTS,
          type: NotificationType.DISCOUNT_REQUESTED,
          title: 'Solicitud de descuento',
          message: 'Camila Rojas pidió un descuento en la venta VTA-000125.',
          entityType: NotificationEntityType.DISCOUNT_REQUEST,
          entityId: 'req-1',
          locationId: 'store-1',
          actorId: 'cashier-1',
          readAt: null,
          createdAt: new Date('2026-09-23T10:00:00Z'),
        },
      ]);
    });

    it('can narrow the list down to one channel and to what is still unread', async () => {
      const { service, userNotificationRepo } = createService();

      await service.findMine(COMPANY, 'user-1', {
        channel: NotificationChannel.RETURNS,
        unreadOnly: true,
      });

      expect(userNotificationRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            userId: 'user-1',
            readAt: IsNull(),
            notification: { companyId: COMPANY, channel: NotificationChannel.RETURNS },
          },
        }),
      );
    });

    it('pages the list, with the page size between 1 and 100', async () => {
      const { service, userNotificationRepo } = createService();

      await service.findMine(COMPANY, 'user-1', { limit: 10, offset: 20 });
      await service.findMine(COMPANY, 'user-1', { limit: 5000, offset: -3 });
      await service.findMine(COMPANY, 'user-1', { limit: 0 });

      const [first, second, third] = userNotificationRepo.find.mock.calls.map(([options]) => options);
      expect([first.take, first.skip]).toEqual([10, 20]);
      expect([second.take, second.skip]).toEqual([100, 0]);
      expect(third.take).toBe(1);
    });
  });

  describe('countUnread', () => {
    it('counts what who asks has not read, in the active company', async () => {
      const { service, userNotificationRepo } = createService();
      userNotificationRepo.count.mockResolvedValue(4);

      const count = await service.countUnread(COMPANY, 'user-1');

      expect(count).toBe(4);
      expect(userNotificationRepo.count).toHaveBeenCalledWith({
        where: { userId: 'user-1', readAt: IsNull(), notification: { companyId: COMPANY } },
      });
    });

    it('can count only one channel', async () => {
      const { service, userNotificationRepo } = createService();

      await service.countUnread(COMPANY, 'user-1', NotificationChannel.DISCOUNTS);

      expect(userNotificationRepo.count).toHaveBeenCalledWith({
        where: {
          userId: 'user-1',
          readAt: IsNull(),
          notification: { companyId: COMPANY, channel: NotificationChannel.DISCOUNTS },
        },
      });
    });
  });

  describe('markRead', () => {
    it('marks one of my notices as read', async () => {
      const { service, txUserNotificationRepo } = createService();
      const row = userNotification();
      txUserNotificationRepo.findOne.mockResolvedValue(row);

      const view = await service.markRead(COMPANY, 'user-1', 'un-1');

      expect(txUserNotificationRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'un-1', userId: 'user-1', notification: { companyId: COMPANY } },
        relations: { notification: true },
      });
      expect(row.readAt).toBeInstanceOf(Date);
      expect(txUserNotificationRepo.save).toHaveBeenCalledWith(row);
      expect(view.readAt).toBeInstanceOf(Date);
    });

    it('leaves a notice that was already read with the date it was first read', async () => {
      const { service, txUserNotificationRepo } = createService();
      const readAt = new Date('2026-09-22T08:00:00Z');
      txUserNotificationRepo.findOne.mockResolvedValue(userNotification({ readAt }));

      const view = await service.markRead(COMPANY, 'user-1', 'un-1');

      expect(view.readAt).toBe(readAt);
      expect(txUserNotificationRepo.save).not.toHaveBeenCalled();
    });

    it('answers "not found" for a notice that is not mine or is from another company', async () => {
      const { service, txUserNotificationRepo } = createService();
      txUserNotificationRepo.findOne.mockResolvedValue(null);

      await expect(service.markRead(COMPANY, 'user-1', 'un-9')).rejects.toThrow(NotFoundException);
      expect(txUserNotificationRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('markAllRead', () => {
    it('marks all my unread notices as read with ONE update and says how many', async () => {
      const { service, updateBuilder, txUserNotificationRepo } = createService();
      updateBuilder.execute.mockResolvedValue({ affected: 2 });

      const marked = await service.markAllRead(COMPANY, 'user-1');

      expect(updateBuilder.update).toHaveBeenCalledWith(UserNotification);
      // La fecha de lectura la pone la base de datos, en el mismo UPDATE
      const [{ readAt }] = updateBuilder.set.mock.calls[0];
      expect(readAt()).toBe('now()');
      expect(updateBuilder.where).toHaveBeenCalledWith('"userId" = :userId', { userId: 'user-1' });
      expect(updateBuilder.andWhere).toHaveBeenCalledWith('"readAt" IS NULL');
      expect(updateBuilder.andWhere).toHaveBeenCalledWith(
        expect.stringContaining('n."companyId" = :companyId'),
        { companyId: COMPANY },
      );
      // Ya no se cargan ni se guardan las filas una por una
      expect(txUserNotificationRepo.find).not.toHaveBeenCalled();
      expect(txUserNotificationRepo.save).not.toHaveBeenCalled();
      expect(marked).toBe(2);
    });

    it('can mark only one channel', async () => {
      const { service, updateBuilder } = createService();

      await service.markAllRead(COMPANY, 'user-1', NotificationChannel.RETURNS);

      expect(updateBuilder.andWhere).toHaveBeenCalledWith(
        expect.stringContaining('n."channel" = :channel'),
        { companyId: COMPANY, channel: NotificationChannel.RETURNS },
      );
    });

    it('does nothing when there is nothing unread', async () => {
      const { service } = createService();

      const marked = await service.markAllRead(COMPANY, 'user-1');

      expect(marked).toBe(0);
    });
  });
});
