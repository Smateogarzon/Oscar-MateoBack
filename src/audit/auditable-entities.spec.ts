import { Decimal } from 'decimal.js';
import { actionForUpdate, describeAction, diffValues, snapshot } from './auditable-entities.js';
import { AuditAction } from './entities/audit-action.enum.js';

function column(propertyName: string) {
  return { propertyName } as never;
}

function metadata(propertyNames: string[]) {
  return { columns: propertyNames.map(column) } as never;
}

describe('actionForUpdate', () => {
  it('is a generic UPDATE when the status column did not change', () => {
    const action = actionForUpdate([column('name')], { name: 'Nuevo nombre', status: 'ACTIVE' });
    expect(action).toBe(AuditAction.UPDATE);
  });

  it.each([
    ['APPROVED', AuditAction.APPROVE],
    ['CONFIRMED', AuditAction.APPROVE],
    ['REJECTED', AuditAction.REJECT],
    ['CANCELLED', AuditAction.CANCEL],
    ['CANCELED', AuditAction.CANCEL],
    ['ACCEPTED', AuditAction.STATUS_CHANGE],
    ['READY', AuditAction.STATUS_CHANGE],
  ])('maps a new status of %s to %s', (status, expected) => {
    const action = actionForUpdate([column('status')], { status });
    expect(action).toBe(expected);
  });

  it('still looks at status when other columns changed alongside it', () => {
    const action = actionForUpdate([column('resolvedBy'), column('status')], {
      status: 'APPROVED',
      resolvedBy: 'user-1',
    });
    expect(action).toBe(AuditAction.APPROVE);
  });
});

describe('snapshot', () => {
  it('returns null for an undefined entity', () => {
    expect(snapshot(metadata(['id']), undefined)).toBeNull();
  });

  it('serializes only declared columns, redacting sensitive ones', () => {
    const result = snapshot(metadata(['id', 'email', 'passwordHash']), {
      id: 'user-1',
      email: 'ana@example.com',
      passwordHash: '$2b$10$secret',
      extraFieldNotInMetadata: 'should not appear',
    });

    expect(result).toEqual({
      id: 'user-1',
      email: 'ana@example.com',
      passwordHash: '[redactado]',
    });
  });

  it('turns Decimal and Date columns into plain strings', () => {
    const result = snapshot(metadata(['price', 'createdAt']), {
      price: new Decimal('150000.00'),
      createdAt: new Date('2026-09-30T12:00:00.000Z'),
    });

    expect(result).toEqual({
      price: '150000',
      createdAt: '2026-09-30T12:00:00.000Z',
    });
  });
});

describe('diffValues', () => {
  it('only includes the columns that actually changed', () => {
    const { oldValues, newValues } = diffValues(
      { status: 'APPROVED', resolvedBy: 'user-1', reason: 'unchanged' },
      { status: 'PENDING', resolvedBy: null, reason: 'unchanged' },
      [column('status'), column('resolvedBy')],
    );

    expect(oldValues).toEqual({ status: 'PENDING', resolvedBy: null });
    expect(newValues).toEqual({ status: 'APPROVED', resolvedBy: 'user-1' });
  });

  it('redacts a sensitive column on both sides even if it is the one that changed', () => {
    const { oldValues, newValues } = diffValues(
      { movementCode: '999999' },
      { movementCode: '123456' },
      [column('movementCode')],
    );

    expect(oldValues).toEqual({ movementCode: '[redactado]' });
    expect(newValues).toEqual({ movementCode: '[redactado]' });
  });
});

describe('describeAction', () => {
  // LOGIN/LOGOUT no pasan por aquí en la app real (AuthService arma su propia descripción a
  // mano): solo se prueban las acciones que de verdad dispara AuditLogSubscriber.
  it('builds a short human-readable description', () => {
    expect(describeAction(AuditAction.CREATE, 'WriteOff')).toBe('Se creó WriteOff');
    expect(describeAction(AuditAction.APPROVE, 'WriteOff')).toBe('Se aprobó WriteOff');
    expect(describeAction(AuditAction.DELETE, 'Product')).toBe('Se eliminó Product');
  });
});
