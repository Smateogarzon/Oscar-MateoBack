import { MONEY_PATTERN, QUANTITY_PATTERN } from './money.js';

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
