import { AuditLogService } from './audit-log.service.js';
import { AuditAction } from './entities/audit-action.enum.js';
import { AuditLog } from './entities/audit-log.entity.js';

describe('AuditLogService', () => {
  it('inserts through the given manager, so the row lands in the caller\'s own transaction', async () => {
    const insert = vi.fn().mockResolvedValue(undefined);
    const repository = { insert };
    const manager = { getRepository: vi.fn(() => repository) };
    const service = new AuditLogService();

    const input = {
      companyId: 'company-1',
      userId: 'user-1',
      action: AuditAction.CREATE,
      entityType: 'Brand',
      entityId: 'brand-1',
      oldValues: null,
      newValues: { name: 'Nike' },
      description: 'Se creó Brand',
    };

    await service.record(manager as never, input);

    expect(manager.getRepository).toHaveBeenCalledWith(AuditLog);
    expect(insert).toHaveBeenCalledWith(input);
  });
});
