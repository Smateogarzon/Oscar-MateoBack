import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  DataSource,
  EntityManager,
  In,
  IsNull,
  Repository,
} from 'typeorm';
import { COMPANY_VISIBLE_ROLE, PLATFORM_ROLE } from '../../common/access/platform-role.js';
import { PermissionCode } from '../../common/enums/permission-code.enum.js';
import { RecordStatus } from '../../common/enums/record-status.enum.js';
import { fullName } from '../../common/utils/text.js';
import { RealtimeEventKind } from '../../realtime/realtime-event.js';
import { RealtimeService } from '../../realtime/realtime.service.js';
import { Permission } from '../permission/entities/permission.entity.js';
import type { RoleScope } from '../role/entities/role-scope.enum.js';
import { RolePermission } from '../role-permission/entities/role-permission.entity.js';
import { UserCompanyRole } from '../user-company-role/entities/user-company-role.entity.js';
import { User } from '../user/entities/user.entity.js';
import { NotificationChannel } from './entities/notification-channel.enum.js';
import { NotificationEntityType } from './entities/notification-entity-type.enum.js';
import {
  CHANNEL_OF_TYPE,
  NotificationType,
} from './entities/notification-type.enum.js';
import { Notification } from './entities/notification.entity.js';
import { UserNotification } from './entities/user-notification.entity.js';
import { buildNotificationText } from './notification-text.js';
import { notificationUrl } from './notification-url.js';

const DEFAULT_PAGE_SIZE = 30;
const MAX_PAGE_SIZE = 100;
const UNKNOWN_ACTOR_NAME = 'Alguien';

export interface NotifyInput {
  companyId: string;
  type: NotificationType;
  recipientIds: string[];
  actorId: string;
  entityType: NotificationEntityType;
  entityId: string;
  locationId: string | null;
  // El número de la venta, de la devolución o de la orden de compra; null si es una venta en borrador
  // (sin número todavía)
  reference: string | null;
  notes?: string | null;
  // Solo para INVENTORY_LOW_STOCK (ver NotificationTextParams).
  quantity?: string;
  minStock?: string;
  locationName?: string | null;
  outOfStock?: boolean;
}

// Los avisos se guardan seis meses: después no le sirven a nadie y la tabla crecería sin fin.
const NOTIFICATION_RETENTION_DAYS = 180;
// Probabilidad de aprovechar un aviso nuevo para borrar los viejos (no hay tarea programada).
const PURGE_PROBABILITY = 0.01;

export interface NotifyResult {
  notification: Notification;
  recipientIds: string[];
}

export interface SignalChangeInput {
  companyId: string;
  channel: NotificationChannel;
  entityType: NotificationEntityType;
  entityId: string;
  // A quiénes se les avisa
  recipientIds: string[];
  // Quien hizo el cambio: su pantalla ya se refresca sola con su propia operación, así que no se le
  // manda la señal
  exceptUserId?: string;
}

export interface NotificationView {
  id: string;
  notificationId: string;
  channel: NotificationChannel;
  type: NotificationType;
  title: string;
  message: string | null;
  entityType: NotificationEntityType | null;
  entityId: string | null;
  locationId: string | null;
  actorId: string | null;
  readAt: Date | null;
  createdAt: Date;
}

export interface MineFilters {
  channel?: NotificationChannel;
  unreadOnly?: boolean;
  limit?: number;
  offset?: number;
}

@Injectable()
export class NotificationService {
  constructor(
    @InjectRepository(UserNotification)
    private readonly userNotificationRepository: Repository<UserNotification>,
    private readonly dataSource: DataSource,
    private readonly realtime: RealtimeService,
  ) {}

  async notify(
    manager: EntityManager,
    input: NotifyInput,
  ): Promise<NotifyResult | null> {
    const recipientIds = [...new Set(input.recipientIds)].filter(
      (id) => id !== input.actorId,
    );
    if (recipientIds.length === 0) return null;

    const actor = await manager
      .getRepository(User)
      .findOneBy({ id: input.actorId });
    const actorName = actor
      ? fullName(actor)
      : UNKNOWN_ACTOR_NAME;
    const { title, message } = buildNotificationText(input.type, {
      actorName,
      reference: input.reference,
      notes: input.notes,
      quantity: input.quantity,
      minStock: input.minStock,
      locationName: input.locationName,
      outOfStock: input.outOfStock,
    });

    const notificationRepo = manager.getRepository(Notification);
    const notification = await notificationRepo.save(
      notificationRepo.create({
        companyId: input.companyId,
        channel: CHANNEL_OF_TYPE[input.type],
        type: input.type,
        title,
        message,
        entityType: input.entityType,
        entityId: input.entityId,
        locationId: input.locationId,
        actorId: input.actorId,
      }),
    );

    const userNotificationRepo = manager.getRepository(UserNotification);
    await userNotificationRepo.save(
      recipientIds.map((userId) =>
        userNotificationRepo.create({
          notificationId: notification.id,
          userId,
        }),
      ),
    );

    // A cada destinatario le llega en vivo una señal de que tiene un aviso nuevo, pero solo cuando la
    // transacción se confirme (ver RealtimeService.publishAfterCommit).
    // El mismo aviso también sale al sistema del dispositivo (web push), con el mismo texto y agrupado
    // por la entidad a la que se refiere (una misma orden no apila avisos en el celular).
    const push = {
      title,
      body: message,
      url: notificationUrl(input.entityType, input.entityId, input.companyId),
      tag: `${input.entityType}:${input.entityId}`,
    };
    const at = new Date();
    this.realtime.publishAfterCommit(
      manager,
      recipientIds.map((userId) => ({
        companyId: input.companyId,
        userId,
        kind: RealtimeEventKind.NOTIFICATION_CREATED,
        channel: notification.channel,
        type: input.type,
        entityType: input.entityType,
        entityId: input.entityId,
        at,
        push,
      })),
    );

    this.purgeOldSometimes(manager);
    return { notification, recipientIds };
  }

  // Borra los avisos de más de seis meses, de vez en cuando y sin esperar: va por otra conexión del
  // pool (la transacción de quien avisa no se entera) y si falla no pasa nada, la próxima lo intenta.
  // Primero las filas de destinatarios y después los avisos que ya no tienen ninguna.
  private purgeOldSometimes(manager: EntityManager): void {
    if (Math.random() >= PURGE_PROBABILITY) return;
    const connection = manager.connection as
      | { query?: (sql: string) => Promise<unknown> }
      | undefined;
    if (!connection?.query) return;

    const interval = `interval '${NOTIFICATION_RETENTION_DAYS} days'`;
    void connection
      .query(
        `DELETE FROM "user_notifications" WHERE "id" IN (
           SELECT "id" FROM "user_notifications" WHERE "createdAt" < now() - ${interval} LIMIT 1000
         )`,
      )
      .then(() =>
        connection.query?.(
          `DELETE FROM "notifications" n
           WHERE n."createdAt" < now() - ${interval}
             AND NOT EXISTS (SELECT 1 FROM "user_notifications" u WHERE u."notificationId" = n."id")`,
        ),
      )
      .catch(() => undefined);
  }

  // Avisa en vivo que algo cambió, sin crear ningún aviso: para quienes lo estaban viendo (por
  // ejemplo, los demás administradores, cuando uno resuelve una solicitud pendiente) y así su pantalla
  // se ponga al día sola. Como todo lo demás en vivo, solo llega si la transacción se confirma.
  signalChange(manager: EntityManager, input: SignalChangeInput): void {
    const recipientIds = [...new Set(input.recipientIds)].filter(
      (id) => id !== input.exceptUserId,
    );

    const at = new Date();
    this.realtime.publishAfterCommit(
      manager,
      recipientIds.map((userId) => ({
        companyId: input.companyId,
        userId,
        kind: RealtimeEventKind.ENTITY_CHANGED,
        channel: input.channel,
        type: null,
        entityType: input.entityType,
        entityId: input.entityId,
        at,
      })),
    );
  }

  // Los usuarios de la empresa que tienen un permiso: miembros activos, con la cuenta activa, en un
  // rol activo que la empresa dejó con ese permiso; y además los miembros de plataforma (el super
  // admin), que tienen todo el catálogo sin pasar por role_permissions (ver loadCompanyAccess): si
  // no, nunca recibían un aviso ni una señal en vivo.
  // `scope` acota los roles de la empresa a ESE alcance (los de plataforma entran siempre). Lo usan
  // las compras: el proveedor tiene el mismo permiso que el administrador
  // (suppliers.manage_purchase_orders) y no le toca enterarse de las órdenes de otro proveedor.
  async findUserIdsWithPermission(
    manager: EntityManager,
    companyId: string,
    permission: PermissionCode,
    options: { scope?: RoleScope } = {},
  ): Promise<string[]> {
    const permissionActive = await manager
      .getRepository(Permission)
      .existsBy({ code: permission, status: RecordStatus.ACTIVE });
    if (!permissionActive) return [];

    const grants = await manager.getRepository(RolePermission).find({
      where: {
        companyId,
        permission: { code: permission },
        role: { status: RecordStatus.ACTIVE, ...(options.scope ? { scope: options.scope } : COMPANY_VISIBLE_ROLE) },
      },
    });
    const roleIds = [...new Set(grants.map((grant) => grant.roleId))];

    const activeMember = { companyId, status: RecordStatus.ACTIVE, user: { status: RecordStatus.ACTIVE } };
    const memberships = await manager.getRepository(UserCompanyRole).find({
      where: [
        { ...activeMember, role: { ...PLATFORM_ROLE, status: RecordStatus.ACTIVE } },
        ...(roleIds.length > 0 ? [{ ...activeMember, roleId: In(roleIds) }] : []),
      ],
    });
    return [...new Set(memberships.map((membership) => membership.userId))];
  }

  // Marca como leídos los avisos sin leer de una cosa (por ejemplo, la solicitud de descuento que
  // ya se resolvió), para todos los que los tenían pendientes. Devuelve cuántos marcó.
  async markEntityRead(
    manager: EntityManager,
    entityType: NotificationEntityType,
    entityId: string,
    types: NotificationType[],
  ): Promise<number> {
    const repo = manager.getRepository(UserNotification);
    const unread = await repo.find({
      where: {
        readAt: IsNull(),
        notification: { entityType, entityId, type: In(types) },
      },
    });
    if (unread.length === 0) return 0;

    const now = new Date();
    for (const row of unread) row.readAt = now;
    await repo.save(unread);
    return unread.length;
  }

  // Los avisos de quien pregunta en la empresa activa, los más recientes primero.
  async findMine(
    companyId: string,
    userId: string,
    filters: MineFilters = {},
  ): Promise<NotificationView[]> {
    const limit = Math.min(
      Math.max(filters.limit ?? DEFAULT_PAGE_SIZE, 1),
      MAX_PAGE_SIZE,
    );
    const offset = Math.max(filters.offset ?? 0, 0);

    const rows = await this.userNotificationRepository.find({
      where: this.mineWhere(companyId, userId, filters),
      relations: { notification: true },
      order: { createdAt: 'DESC', id: 'DESC' },
      take: limit,
      skip: offset,
    });
    return rows.map((row) => this.toView(row));
  }

  countUnread(
    companyId: string,
    userId: string,
    channel?: NotificationChannel,
  ): Promise<number> {
    return this.userNotificationRepository.count({
      where: this.mineWhere(companyId, userId, { channel, unreadOnly: true }),
    });
  }

  // Marcar un aviso ya leído no cambia nada: se queda con la fecha en que se leyó por primera vez.
  async markRead(
    companyId: string,
    userId: string,
    id: string,
  ): Promise<NotificationView> {
    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(UserNotification);
      const row = await repo.findOne({
        where: { id, userId, notification: { companyId } },
        relations: { notification: true },
      });
      if (!row) throw new NotFoundException(`Notificación ${id} no encontrada`);

      if (row.readAt === null) {
        row.readAt = new Date();
        await repo.save(row);
      }
      return this.toView(row);
    });
  }

  // Marca como leídos todos los avisos sin leer de quien pregunta (de un canal, o de todos).
  // Devuelve cuántos marcó. Es UN solo UPDATE (no una fila por fila): con meses de avisos sin leer,
  // una transacción con miles de escrituras retendría filas y una conexión del pool durante segundos.
  async markAllRead(
    companyId: string,
    userId: string,
    channel?: NotificationChannel,
  ): Promise<number> {
    return this.dataSource.transaction(async (manager) => {
      const result = await manager
        .createQueryBuilder()
        .update(UserNotification)
        .set({ readAt: () => 'now()' })
        .where('"userId" = :userId', { userId })
        .andWhere('"readAt" IS NULL')
        .andWhere(
          `"notificationId" IN (
             SELECT n."id" FROM "notifications" n
             WHERE n."companyId" = :companyId${channel ? ' AND n."channel" = :channel' : ''}
           )`,
          channel ? { companyId, channel } : { companyId },
        )
        .execute();
      return result.affected ?? 0;
    });
  }

  private mineWhere(companyId: string, userId: string, filters: MineFilters) {
    return {
      userId,
      ...(filters.unreadOnly && { readAt: IsNull() }),
      notification: {
        companyId,
        ...(filters.channel && { channel: filters.channel }),
      },
    };
  }

  private toView(row: UserNotification): NotificationView {
    const { notification } = row;
    return {
      id: row.id,
      notificationId: notification.id,
      channel: notification.channel,
      type: notification.type,
      title: notification.title,
      message: notification.message,
      entityType: notification.entityType,
      entityId: notification.entityId,
      locationId: notification.locationId,
      actorId: notification.actorId,
      readAt: row.readAt,
      createdAt: row.createdAt,
    };
  }
}
