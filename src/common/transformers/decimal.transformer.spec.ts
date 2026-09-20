import { Decimal } from 'decimal.js';
import { decimalTransformer } from './decimal.transformer.js';

describe('decimalTransformer', () => {
  it('reads a numeric column as a Decimal, without floating point errors', () => {
    const value = decimalTransformer.from('0.30') as Decimal;

    expect(value).toBeInstanceOf(Decimal);
    expect(value.plus(new Decimal('0.10')).toFixed(2)).toBe('0.40');
  });

  it('writes a Decimal, a string or a number as plain text', () => {
    expect(decimalTransformer.to(new Decimal('12.5'))).toBe('12.5');
    expect(decimalTransformer.to('12.50')).toBe('12.5');
    expect(decimalTransformer.to(0)).toBe('0');
  });

  it('never writes scientific notation for big or tiny amounts', () => {
    expect(decimalTransformer.to(new Decimal('1e+9'))).toBe('1000000000');
    expect(decimalTransformer.to(new Decimal('1e-7'))).toBe('0.0000001');
  });

  it('lets null and undefined through', () => {
    expect(decimalTransformer.from(null)).toBeNull();
    expect(decimalTransformer.to(null)).toBeNull();
    expect(decimalTransformer.to(undefined)).toBeUndefined();
  });
});
