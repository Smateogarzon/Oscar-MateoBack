import { Brand } from '../graphql/brand/entities/brand.entity.js';
import { Notification } from '../graphql/notification/entities/notification.entity.js';
import { auditContextStorage } from './audit-context.js';
import { AuditLogSubscriber } from './audit-log.subscriber.js';
import { AuditAction } from './entities/audit-action.enum.js';

function createSubscriber() {
  const dataSource = { subscribers: [] as unknown[] };
  const auditLogService = { record: vi.fn().mockResolvedValue(undefined) };
  const subscriber = new AuditLogSubscriber(dataSource as never, auditLogService as never);
  return { subscriber, dataSource, auditLogService };
}

function metadataFor(target: Function, columnNames: string[]) {
  return {
    target,
    name: target.name,
    columns: columnNames.map((propertyName) => ({ propertyName })),
  } as never;
}

describe('AuditLogSubscriber', () => {
  it('registers itself with the DataSource on construction, like RealtimeOutboxSubscriber', () => {
    const { subscriber, dataSource } = createSubscriber();
    expect(dataSource.subscribers).toContain(subscriber);
  });

  describe('afterInsert', () => {
    it('ignores an entity that is not in AUDITABLE_ENTITIES', async () => {
      const { subscriber, auditLogService } = createSubscriber();

      await subscriber.afterInsert({
        metadata: metadataFor(Notification, ['id']),
        entity: { id: 'n-1' },
        manager: {},
      } as never);

      expect(auditLogService.record).not.toHaveBeenCalled();
    });

    it('records a CREATE for an allowlisted entity, stamping the actor from the ambient context', async () => {
      const { subscriber, auditLogService } = createSubscriber();
      const manager = {} as never;

      await auditContextStorage.run({ userId: 'user-1', companyId: 'company-1' }, () =>
        subscriber.afterInsert({
          metadata: metadataFor(Brand, ['id', 'name']),
          entity: { id: 'brand-1', name: 'Nike' },
          manager,
        } as never),
      );

      expect(auditLogService.record).toHaveBeenCalledWith(manager, {
        companyId: 'company-1',
        userId: 'user-1',
        action: AuditAction.CREATE,
        entityType: 'Brand',
        entityId: 'brand-1',
        oldValues: null,
        newValues: { id: 'brand-1', name: 'Nike' },
        description: 'Se creó Brand',
      });
    });

    it('stamps a null actor when nothing populated the context (e.g. a seed script)', async () => {
      const { subscriber, auditLogService } = createSubscriber();

      await subscriber.afterInsert({
        metadata: metadataFor(Brand, ['id']),
        entity: { id: 'brand-1' },
        manager: {},
      } as never);

      expect(auditLogService.record).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ companyId: null, userId: null }),
      );
    });
  });

  describe('afterUpdate', () => {
    it('ignores an entity that is not in AUDITABLE_ENTITIES', async () => {
      const { subscriber, auditLogService } = createSubscriber();

      await subscriber.afterUpdate({
        metadata: metadataFor(Notification, ['id']),
        entity: { id: 'n-1' },
        databaseEntity: { id: 'n-1' },
        updatedColumns: [{ propertyName: 'id' }],
        manager: {},
      } as never);

      expect(auditLogService.record).not.toHaveBeenCalled();
    });

    it('diffs only the updated columns and infers APPROVE from the new status', async () => {
      const { subscriber, auditLogService } = createSubscriber();
      const manager = {} as never;

      await subscriber.afterUpdate({
        metadata: metadataFor(Brand, ['status', 'resolvedBy']),
        entity: { id: 'brand-1', status: 'APPROVED', resolvedBy: 'user-2' },
        databaseEntity: { id: 'brand-1', status: 'PENDING', resolvedBy: null },
        updatedColumns: [{ propertyName: 'status' }, { propertyName: 'resolvedBy' }],
        manager,
      } as never);

      expect(auditLogService.record).toHaveBeenCalledWith(
        manager,
        expect.objectContaining({
          action: AuditAction.APPROVE,
          entityId: 'brand-1',
          oldValues: { status: 'PENDING', resolvedBy: null },
          newValues: { status: 'APPROVED', resolvedBy: 'user-2' },
        }),
      );
    });

    it('falls back to a full snapshot when there is no previous row to diff against', async () => {
      const { subscriber, auditLogService } = createSubscriber();

      await subscriber.afterUpdate({
        metadata: metadataFor(Brand, ['id', 'name']),
        entity: { id: 'brand-1', name: 'Puma' },
        databaseEntity: undefined,
        updatedColumns: [],
        manager: {},
      } as never);

      expect(auditLogService.record).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          action: AuditAction.UPDATE,
          oldValues: null,
          newValues: { id: 'brand-1', name: 'Puma' },
        }),
      );
    });

    it('does nothing when there is no entity at all (a bare query-builder update)', async () => {
      const { subscriber, auditLogService } = createSubscriber();

      await subscriber.afterUpdate({
        metadata: metadataFor(Brand, ['id']),
        entity: undefined,
        databaseEntity: { id: 'brand-1' },
        updatedColumns: [{ propertyName: 'id' }],
        manager: {},
      } as never);

      expect(auditLogService.record).not.toHaveBeenCalled();
    });
  });

  describe('afterRemove', () => {
    it('ignores an entity that is not in AUDITABLE_ENTITIES', async () => {
      const { subscriber, auditLogService } = createSubscriber();

      await subscriber.afterRemove({
        metadata: metadataFor(Notification, ['id']),
        databaseEntity: { id: 'n-1' },
        manager: {},
      } as never);

      expect(auditLogService.record).not.toHaveBeenCalled();
    });

    it('records a DELETE with a full snapshot of the removed row', async () => {
      const { subscriber, auditLogService } = createSubscriber();

      await subscriber.afterRemove({
        metadata: metadataFor(Brand, ['id', 'name']),
        databaseEntity: { id: 'brand-1', name: 'Reebok' },
        manager: {},
      } as never);

      expect(auditLogService.record).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          action: AuditAction.DELETE,
          entityId: 'brand-1',
          oldValues: { id: 'brand-1', name: 'Reebok' },
          newValues: null,
          description: 'Se eliminó Brand',
        }),
      );
    });
  });
});
