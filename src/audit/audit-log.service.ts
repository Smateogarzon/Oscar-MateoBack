import { Injectable } from '@nestjs/common';
import type { EntityManager, QueryDeepPartialEntity } from 'typeorm';
import { AuditAction } from './entities/audit-action.enum.js';
import { AuditLog } from './entities/audit-log.entity.js';

export interface RecordAuditLogInput {
  companyId: string | null;
  userId: string | null;
  action: AuditAction;
  entityType: string;
  entityId: string | null;
  oldValues: Record<string, unknown> | null;
  newValues: Record<string, unknown> | null;
  description: string | null;
}

// Inserción simple, sin lógica propia: quien llama (AuditLogSubscriber, o AuthService para
// LOGIN/LOGOUT) ya resolvió todos los datos. Recibe el EntityManager de quien llama para que la
// fila quede en la MISMA transacción que el cambio que audita.
@Injectable()
export class AuditLogService {
  async record(manager: EntityManager, input: RecordAuditLogInput): Promise<void> {
    // insert() tipa sus valores como QueryDeepPartialEntity, que no admite Record<string, unknown>
    // (columnas jsonb). El cast es seguro: oldValues/newValues son JSON plano que TypeORM serializa tal cual.
    await manager.getRepository(AuditLog).insert(input as QueryDeepPartialEntity<AuditLog>);
  }
}
