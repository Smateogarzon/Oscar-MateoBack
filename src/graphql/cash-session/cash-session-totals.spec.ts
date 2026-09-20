import { Decimal } from 'decimal.js';
import { CashMovementType } from '../cash-movement/entities/cash-movement-type.enum.js';
import { PaymentMethodType } from '../payment-method/entities/payment-method-type.enum.js';
import { calculateSessionTotals } from './cash-session-totals.js';

const d = (value: string) => new Decimal(value);
const payment = (amount: string, type: PaymentMethodType) => ({ amount: d(amount), type });
const movement = (amount: string, type: CashMovementType) => ({ amount: d(amount), type });

describe('calculateSessionTotals', () => {
  it('is just the opening amount for a shift with nothing in it', () => {
    const totals = calculateSessionTotals(d('200000'), [], []);

    expect(totals.expectedCash.toFixed(2)).toBe('200000.00');
    expect(totals.cashSales.toFixed(2)).toBe('0.00');
    expect(totals.cardSales.toFixed(2)).toBe('0.00');
    expect(totals.transferSales.toFixed(2)).toBe('0.00');
    expect(totals.cashIn.toFixed(2)).toBe('0.00');
    expect(totals.cashOut.toFixed(2)).toBe('0.00');
  });

  it('adds cash sales and income, and takes out expenses', () => {
    const totals = calculateSessionTotals(
      d('200000'),
      [payment('80000', PaymentMethodType.CASH), payment('45000.50', PaymentMethodType.CASH)],
      [
        movement('30000', CashMovementType.CASH_IN),
        movement('12000.25', CashMovementType.CASH_OUT),
        movement('5000', CashMovementType.CASH_OUT),
      ],
    );

    expect(totals.cashSales.toFixed(2)).toBe('125000.50');
    expect(totals.cashIn.toFixed(2)).toBe('30000.00');
    expect(totals.cashOut.toFixed(2)).toBe('17000.25');
    // 200000 + 125000.50 + 30000 − 17000.25
    expect(totals.expectedCash.toFixed(2)).toBe('338000.25');
  });

  it('keeps card and transfer payments out of the cash in the drawer', () => {
    const totals = calculateSessionTotals(
      d('100000'),
      [
        payment('50000', PaymentMethodType.CASH),
        payment('30000', PaymentMethodType.CARD),
        payment('20000', PaymentMethodType.TRANSFER),
        payment('10000', PaymentMethodType.CARD),
      ],
      [],
    );

    expect(totals.cashSales.toFixed(2)).toBe('50000.00');
    expect(totals.cardSales.toFixed(2)).toBe('40000.00');
    expect(totals.transferSales.toFixed(2)).toBe('20000.00');
    expect(totals.expectedCash.toFixed(2)).toBe('150000.00');
  });

  it('adds cents exactly, with no floating point drift', () => {
    const totals = calculateSessionTotals(
      d('0'),
      [payment('0.10', PaymentMethodType.CASH), payment('0.20', PaymentMethodType.CASH)],
      [],
    );

    // 0.1 + 0.2 = 0.30000000000000004 con números normales
    expect(totals.expectedCash.toFixed(2)).toBe('0.30');
  });

  it('can go negative when more is taken out than there was', () => {
    const totals = calculateSessionTotals(d('1000'), [], [movement('1500', CashMovementType.CASH_OUT)]);

    expect(totals.expectedCash.toFixed(2)).toBe('-500.00');
  });
});
