import { Decimal } from 'decimal.js';
import { paidPerLine, returnValue } from './return-values.js';

const d = (value: string) => new Decimal(value);
const line = (id: string, quantity: string, total: string) => ({
  id,
  quantity: d(quantity),
  total: d(total),
});

describe('paidPerLine', () => {
  it('is what each line was worth when the sale has no general discount', () => {
    const paid = paidPerLine([line('a', '1', '100000'), line('b', '2', '50000')], d('0'));

    expect(paid.get('a')?.toFixed(2)).toBe('100000.00');
    expect(paid.get('b')?.toFixed(2)).toBe('50000.00');
  });

  it('keeps the discount that a line already had on its own', () => {
    // La línea valía 100000 y tuvo 10000 de descuento: el cliente pagó 90000
    const paid = paidPerLine([line('a', '1', '90000')], d('0'));

    expect(paid.get('a')?.toFixed(2)).toBe('90000.00');
  });

  it('spreads a general discount over the lines in proportion to what each was worth', () => {
    // 200000 en líneas con 20000 de descuento general: cada línea de 100000 paga 90000
    const paid = paidPerLine([line('a', '1', '100000'), line('b', '1', '100000')], d('20000'));

    expect(paid.get('a')?.toFixed(2)).toBe('90000.00');
    expect(paid.get('b')?.toFixed(2)).toBe('90000.00');
  });

  it('gives more of the discount to the line that was worth more', () => {
    // 300000 en líneas con 30000 de descuento: 10 % de cada una
    const paid = paidPerLine([line('a', '1', '200000'), line('b', '1', '100000')], d('30000'));

    expect(paid.get('a')?.toFixed(2)).toBe('180000.00');
    expect(paid.get('b')?.toFixed(2)).toBe('90000.00');
  });

  it('adds up exactly to the total of the sale, with no cents left over, even when the split is uneven', () => {
    // 10 de descuento entre tres líneas de 100: 3,33 + 3,33 y la última se lleva 3,34
    const paid = paidPerLine(
      [line('a', '1', '100'), line('b', '1', '100'), line('c', '1', '100')],
      d('10'),
    );

    const sum = [...paid.values()].reduce((total, value) => total.plus(value), d('0'));
    expect(sum.toFixed(2)).toBe('290.00');
    expect(paid.get('a')?.toFixed(2)).toBe('96.67');
    expect(paid.get('c')?.toFixed(2)).toBe('96.66');
  });
});

describe('returnValue', () => {
  it('is what was paid for those units, in proportion', () => {
    // Pagó 90000 por 3 unidades: devolver 1 vale 30000
    expect(returnValue(d('90000'), d('3'), d('0'), d('0'), d('1')).toFixed(2)).toBe('30000.00');
  });

  it('is the whole line when all its units are returned at once', () => {
    expect(returnValue(d('90000'), d('3'), d('0'), d('0'), d('3')).toFixed(2)).toBe('90000.00');
  });

  it('is exactly what was left when the rest of the units are returned', () => {
    // Ya se devolvió 1 unidad por 30000: las 2 que quedan valen 60000
    expect(returnValue(d('90000'), d('3'), d('1'), d('30000'), d('2')).toFixed(2)).toBe('60000.00');
  });

  it('never leaves loose cents when a line is returned unit by unit', () => {
    // 100 por 3 unidades: 33,33 + 33,33 y la última vale lo que quede, 33,34
    const first = returnValue(d('100'), d('3'), d('0'), d('0'), d('1'));
    const second = returnValue(d('100'), d('3'), d('1'), first, d('1'));
    const third = returnValue(d('100'), d('3'), d('2'), first.plus(second), d('1'));

    expect(first.toFixed(2)).toBe('33.33');
    expect(second.toFixed(2)).toBe('33.33');
    expect(third.toFixed(2)).toBe('33.34');
    expect(first.plus(second).plus(third).toFixed(2)).toBe('100.00');
  });

  it('works with fractional quantities', () => {
    // 1,5 unidades pagadas con 15000: devolver 0,5 vale 5000
    expect(returnValue(d('15000'), d('1.5'), d('0'), d('0'), d('0.5')).toFixed(2)).toBe('5000.00');
  });
});
