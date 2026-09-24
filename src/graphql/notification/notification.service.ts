import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  DataSource,
  EntityManager,
  In,
  IsNull,
  Not,
  Repository,
} from 'typeorm';
import { PermissionCode } from '../../common/enums/permission-code.enum.js';
import { RecordStatus } from '../../common/enums/record-status.enum.js';
import { RealtimeEventKind } from '../../realtime/realtime-event.js';
import { RealtimeService } from '../../realtime/realtime.service.js';
import { RoleScope } from '../role/entities/role-scope.enum.js';
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
  reference: string;
  notes?: string | null;
}

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
      ? `${actor.firstName} ${actor.lastName}`.trim()
      : UNKNOWN_ACTOR_NAME;
    const { title, message } = buildNotificationText(input.type, {
      actorName,
      reference: input.reference,
      notes: input.notes,
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
      })),
    );

    return { notification, recipientIds };
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
  // rol activo que la empresa dejó con ese permiso. Los usuarios de plataforma (rol global) no
  // cuentan: las empresas no los ven.
  async findUserIdsWithPermission(
    manager: EntityManager,
    companyId: string,
    permission: PermissionCode,
  ): Promise<string[]> {
    const grants = await manager.getRepository(RolePermission).find({
      where: {
        companyId,
        permission: { code: permission, status: RecordStatus.ACTIVE },
        role: { status: RecordStatus.ACTIVE, scope: Not(RoleScope.GLOBAL) },
      },
    });
    const roleIds = [...new Set(grants.map((grant) => grant.roleId))];
    if (roleIds.length === 0) return [];

    const memberships = await manager.getRepository(UserCompanyRole).find({
      where: {
        companyId,
        roleId: In(roleIds),
        status: RecordStatus.ACTIVE,
        user: { status: RecordStatus.ACTIVE },
      },
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
  // Devuelve cuántos marcó.
  async markAllRead(
    companyId: string,
    userId: string,
    channel?: NotificationChannel,
  ): Promise<number> {
    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(UserNotification);
      const unread = await repo.find({
        where: this.mineWhere(companyId, userId, { channel, unreadOnly: true }),
      });
      if (unread.length === 0) return 0;

      const now = new Date();
      for (const row of unread) row.readAt = now;
      await repo.save(unread);
      return unread.length;
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
