import { Decimal } from 'decimal.js';
import { calculateLine, calculateSaleTotals, MAX_AMOUNT } from './sale-totals.js';

const d = (value: string) => new Decimal(value);
const line = (total: string, discountAmount = '0') => ({
  total: d(total),
  discountAmount: d(discountAmount),
});

describe('calculateLine', () => {
  it('multiplies quantity by price and takes the line discount off', () => {
    const { gross, total } = calculateLine(d('2'), d('50000'), d('5000'));

    expect(gross.toFixed(2)).toBe('100000.00');
    expect(total.toFixed(2)).toBe('95000.00');
  });

  it('rounds the value to cents, half up', () => {
    // 1.5 × 9999.99 = 14999.985
    expect(calculateLine(d('1.5'), d('9999.99'), d('0')).gross.toFixed(2)).toBe('14999.99');
    // 3 × 0.335 = 1.005, que en punto flotante se queda en 1.00
    expect(calculateLine(d('3'), d('0.335'), d('0')).gross.toFixed(2)).toBe('1.01');
  });

  it('does not lose cents to floating point', () => {
    // En punto flotante, 0.1 × 3 da 0.30000000000000004.
    expect(calculateLine(d('3'), d('0.10'), d('0')).gross.toFixed(2)).toBe('0.30');
  });
});

describe('calculateSaleTotals', () => {
  it('is all zeros for a sale without lines', () => {
    const totals = calculateSaleTotals([], d('0'));

    expect(totals.subtotal.toFixed(2)).toBe('0.00');
    expect(totals.discountTotal.toFixed(2)).toBe('0.00');
    expect(totals.total.toFixed(2)).toBe('0.00');
  });

  it('adds up the lines: subtotal before discounts, total after them', () => {
    // Una línea de 100000 con 5000 de descuento y otra de 20000 sin descuento.
    const totals = calculateSaleTotals([line('95000', '5000'), line('20000')], d('0'));

    expect(totals.subtotal.toFixed(2)).toBe('120000.00');
    expect(totals.discountTotal.toFixed(2)).toBe('5000.00');
    expect(totals.total.toFixed(2)).toBe('115000.00');
  });

  it('adds the general discount on top of the line discounts', () => {
    const totals = calculateSaleTotals([line('95000', '5000'), line('20000')], d('10000'));

    expect(totals.subtotal.toFixed(2)).toBe('120000.00');
    expect(totals.discountTotal.toFixed(2)).toBe('15000.00');
    expect(totals.total.toFixed(2)).toBe('105000.00');
  });

  it('keeps total = subtotal − discountTotal', () => {
    const totals = calculateSaleTotals([line('95000', '5000'), line('333.33', '0.03')], d('12.34'));

    expect(totals.total.equals(totals.subtotal.minus(totals.discountTotal))).toBe(true);
  });

  it('reports what the lines add up to, so the general discount can be checked against it', () => {
    const totals = calculateSaleTotals([line('95000', '5000'), line('20000')], d('0'));

    expect(totals.net.toFixed(2)).toBe('115000.00');
  });

  it('sums cents exactly, without floating point drift', () => {
    // 0.1 + 0.2 no da 0.3 en punto flotante.
    const totals = calculateSaleTotals([line('0.10'), line('0.20')], d('0'));

    expect(totals.total.toFixed(2)).toBe('0.30');
  });
});

describe('MAX_AMOUNT', () => {
  it('is the first amount that no longer fits numeric(14,2)', () => {
    expect(MAX_AMOUNT.toFixed(0)).toBe('1000000000000');
  });
});
