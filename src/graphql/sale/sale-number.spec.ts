import { formatSaleNumber } from './sale-number.js';

describe('formatSaleNumber', () => {
  it('pads the consecutive to six digits', () => {
    expect(formatSaleNumber(1)).toBe('VTA-000001');
    expect(formatSaleNumber(123456)).toBe('VTA-123456');
  });

  it('keeps growing past a million instead of truncating', () => {
    expect(formatSaleNumber(1234567)).toBe('VTA-1234567');
  });
});
