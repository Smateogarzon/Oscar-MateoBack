import { formatReturnNumber, RETURN_SERIES } from './sale-return-number.js';

describe('formatReturnNumber', () => {
  it('pads the consecutive to 5 digits', () => {
    expect(formatReturnNumber(1)).toBe('DEV-00001');
    expect(formatReturnNumber(18)).toBe('DEV-00018');
  });

  it('just grows past 5 digits', () => {
    expect(formatReturnNumber(100000)).toBe('DEV-100000');
  });
});

describe('RETURN_SERIES', () => {
  it('is its own series, apart from the one of the sales', () => {
    expect(RETURN_SERIES).toBe('RETURN');
  });
});
