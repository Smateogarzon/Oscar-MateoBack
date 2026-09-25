import { Decimal } from 'decimal.js';
import { lineGross, MAX_DISCOUNT_PERCENT, maxDiscountFor } from './discount-rules.js';

const d = (value: string) => new Decimal(value);

describe('maxDiscountFor', () => {
  it('is 30 percent of the value', () => {
    expect(MAX_DISCOUNT_PERCENT).toBe(30);
    expect(maxDiscountFor(d('100000')).toFixed(2)).toBe('30000.00');
    expect(maxDiscountFor(d('95000')).toFixed(2)).toBe('28500.00');
  });

  it('rounds to cents, half up', () => {
    // 30 % de 99.99 = 29.997
    expect(maxDiscountFor(d('99.99')).toFixed(2)).toBe('30.00');
    // 30 % de 0.01 = 0.003
    expect(maxDiscountFor(d('0.01')).toFixed(2)).toBe('0.00');
  });

  it('always fits a percentage up to the cap, converted to an amount the same way', () => {
    const value = d('99.99');
    for (const percent of [1, 5, 10, 29.99, 30]) {
      const amount = value.times(percent).dividedBy(100).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
      expect(amount.lessThanOrEqualTo(maxDiscountFor(value))).toBe(true);
    }
  });

  it('is zero for something worth nothing', () => {
    expect(maxDiscountFor(d('0')).toFixed(2)).toBe('0.00');
  });
});

describe('lineGross', () => {
  it('is the total plus the discount the line already carries', () => {
    expect(lineGross({ total: d('85500'), discountAmount: d('9500') }).toFixed(2)).toBe('95000.00');
    expect(lineGross({ total: d('20000'), discountAmount: d('0') }).toFixed(2)).toBe('20000.00');
  });
});
