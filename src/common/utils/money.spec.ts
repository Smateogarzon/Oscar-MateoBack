import { Decimal } from 'decimal.js';
import { MAX_AMOUNT, MONEY_PATTERN, QUANTITY_PATTERN, roundMoney } from './money.js';

describe('MONEY_PATTERN', () => {
  it.each(['0', '10', '10.5', '10.55', '125000.50', '999999999999.99'])(
    'accepts %s',
    (value) => {
      expect(MONEY_PATTERN.test(value)).toBe(true);
    },
  );

  it.each([
    ['a negative amount', '-1'],
    ['scientific notation', '1e3'],
    ['no integer part', '.5'],
    ['a thousands separator', '1,000'],
    ['a decimal comma', '10,5'],
    ['more than two decimals', '10.555'],
    ['more than twelve integer digits', '1234567890123'],
    ['an empty string', ''],
    ['leading spaces', ' 10'],
    ['a trailing dot', '10.'],
  ])('rejects %s', (_description, value) => {
    expect(MONEY_PATTERN.test(value)).toBe(false);
  });
});

describe('QUANTITY_PATTERN', () => {
  it.each(['1', '2', '1.5', '0.25', '9999999999.99'])('accepts %s', (value) => {
    expect(QUANTITY_PATTERN.test(value)).toBe(true);
  });

  it.each([
    ['a negative quantity', '-1'],
    ['more than two decimals', '1.555'],
    ['more than ten integer digits', '12345678901'],
    ['scientific notation', '1e2'],
    ['an empty string', ''],
  ])('rejects %s', (_description, value) => {
    expect(QUANTITY_PATTERN.test(value)).toBe(false);
  });
});

describe('MAX_AMOUNT', () => {
  it('is the first amount that no longer fits numeric(14,2)', () => {
    expect(MAX_AMOUNT.toFixed(0)).toBe('1000000000000');
  });
});

describe('roundMoney', () => {
  it('rounds to cents, half up, whatever the global decimal.js setting', () => {
    expect(roundMoney(new Decimal('10.005')).toFixed(2)).toBe('10.01');
    expect(roundMoney(new Decimal('10.004')).toFixed(2)).toBe('10.00');
    expect(roundMoney(new Decimal('3').times('33333.335')).toFixed(2)).toBe('100000.01');
  });
});
