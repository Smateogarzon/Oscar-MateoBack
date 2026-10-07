import { Injectable } from '@nestjs/common';
import {
  DataSource,
  type EntityManager,
  type EntityMetadata,
  type EntitySubscriberInterface,
  type InsertEvent,
  type ObjectLiteral,
  type RemoveEvent,
  type UpdateEvent,
} from 'typeorm';
import { actionForUpdate, AUDITABLE_ENTITIES, describeAction, diffValues, snapshot } from './auditable-entities.js';
import { currentAuditActor } from './audit-context.js';
import { AuditAction } from './entities/audit-action.enum.js';
import { AuditLogService } from './audit-log.service.js';

// Registro automático de auditoría: escucha los eventos de TypeORM y descarta los de entidades que no
// están en AUDITABLE_ENTITIES. Con .save()/.remove() llega cada fila con su antes y su después. Un
// .update()/.delete() por query builder llega una sola vez por sentencia, sin id ni valores anteriores:
// por eso el código de negocio carga las filas y las guarda o borra una por una. Se registra como
// suscriptor igual que RealtimeOutboxSubscriber (ver realtime/realtime-outbox.subscriber.ts).
//
// Escribe con event.manager, el EntityManager de la MISMA transacción que el cambio que audita:
// si esa transacción se deshace, la fila de auditoría se deshace con ella. Por eso, a propósito,
// nada aquí atrapa errores: si fallara la escritura de auditoría, toda la operación de negocio
// debe fallar también (no puede quedar un cambio sin su rastro).
@Injectable()
export class AuditLogSubscriber implements EntitySubscriberInterface {
  constructor(
    dataSource: DataSource,
    private readonly auditLogService: AuditLogService,
  ) {
    dataSource.subscribers.push(this);
  }

  afterInsert(event: InsertEvent<ObjectLiteral>): Promise<void> | void {
    if (!AUDITABLE_ENTITIES.has(event.metadata.target as Function)) return;
    return this.write(event.manager, event.metadata, AuditAction.CREATE, {
      newValues: snapshot(event.metadata, event.entity),
      entityId: this.idOf(event.entity),
    });
  }

  afterUpdate(event: UpdateEvent<ObjectLiteral>): Promise<void> | void {
    if (!event.entity || !AUDITABLE_ENTITIES.has(event.metadata.target as Function)) return;
    // Solo se puede diferenciar antes/después cuando .save() trajo la fila previa (ver
    // UpdateEvent.databaseEntity): si no, se guarda el estado nuevo completo y nada de "antes".
    if (!event.databaseEntity || event.updatedColumns.length === 0) {
      return this.write(event.manager, event.metadata, AuditAction.UPDATE, {
        newValues: snapshot(event.metadata, event.entity),
        entityId: this.idOf(event.entity),
      });
    }

    const action = actionForUpdate(event.updatedColumns, event.entity);
    const { oldValues, newValues } = diffValues(event.entity, event.databaseEntity, event.updatedColumns);
    return this.write(event.manager, event.metadata, action, {
      oldValues,
      newValues,
      entityId: this.idOf(event.entity),
    });
  }

  afterRemove(event: RemoveEvent<ObjectLiteral>): Promise<void> | void {
    if (!AUDITABLE_ENTITIES.has(event.metadata.target as Function)) return;
    return this.write(event.manager, event.metadata, AuditAction.DELETE, {
      oldValues: snapshot(event.metadata, event.databaseEntity),
      entityId: this.idOf(event.databaseEntity) ?? (event.entityId as string | undefined) ?? null,
    });
  }

  private idOf(entity: ObjectLiteral | undefined): string | null {
    return (entity as { id?: string } | undefined)?.id ?? null;
  }

  private async write(
    manager: EntityManager,
    metadata: EntityMetadata,
    action: AuditAction,
    values: {
      oldValues?: Record<string, unknown> | null;
      newValues?: Record<string, unknown> | null;
      entityId: string | null;
    },
  ): Promise<void> {
    const actor = currentAuditActor();
    await this.auditLogService.record(manager, {
      companyId: actor.companyId ?? null,
      userId: actor.userId ?? null,
      action,
      entityType: metadata.name,
      entityId: values.entityId,
      oldValues: values.oldValues ?? null,
      newValues: values.newValues ?? null,
      description: describeAction(action, metadata.name),
    });
  }
}
