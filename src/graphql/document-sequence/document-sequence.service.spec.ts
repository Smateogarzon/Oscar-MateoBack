import { DocumentSequenceService } from './document-sequence.service.js';

const COMPANY = '10000000-0000-4000-8000-000000000001';

function createManager(result: unknown) {
  return { query: vi.fn().mockResolvedValue(result) };
}

describe('DocumentSequenceService', () => {
  it('returns the number the counter just handed out', async () => {
    const manager = createManager([{ lastValue: 5 }]);

    await expect(new DocumentSequenceService().next(manager as never, COMPANY, 'SALE')).resolves.toBe(5);
  });

  it('turns the text Postgres may return into a number', async () => {
    const manager = createManager([{ lastValue: '12' }]);

    await expect(new DocumentSequenceService().next(manager as never, COMPANY, 'SALE')).resolves.toBe(12);
  });

  it('counts per company and per series, creating the counter on first use', async () => {
    const manager = createManager([{ lastValue: 1 }]);

    await new DocumentSequenceService().next(manager as never, COMPANY, 'SALE');

    const [sql, parameters] = manager.query.mock.calls[0];
    expect(parameters).toEqual([COMPANY, 'SALE']);
    // Un solo INSERT ... ON CONFLICT: crea el contador o lo incrementa de forma atómica.
    expect(sql).toContain('ON CONFLICT ("companyId", "series")');
    expect(sql).toContain('"lastValue" + 1');
  });
});
