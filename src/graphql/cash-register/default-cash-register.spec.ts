import {
  DEFAULT_CASH_REGISTER_CODE,
  defaultCashRegisterName,
  nextCashRegisterCode,
} from './default-cash-register.js';

describe('nextCashRegisterCode', () => {
  it('a store with no registers starts at C1, the code its first register is born with', () => {
    expect(nextCashRegisterCode([])).toBe('C1');
    expect(nextCashRegisterCode([])).toBe(DEFAULT_CASH_REGISTER_CODE);
  });

  it('goes one past the highest code in use, in order', () => {
    expect(nextCashRegisterCode(['C1'])).toBe('C2');
    expect(nextCashRegisterCode(['C1', 'C2'])).toBe('C3');
  });

  it('never reuses a number, even when there is a gap', () => {
    expect(nextCashRegisterCode(['C1', 'C4'])).toBe('C5');
  });

  it('does not care about the order the codes come in', () => {
    expect(nextCashRegisterCode(['C3', 'C1', 'C2'])).toBe('C4');
  });

  it('ignores case and spaces around a code', () => {
    expect(nextCashRegisterCode([' c2 ', 'C1'])).toBe('C3');
  });

  it('ignores the codes that do not have the shape C<number>: the ones typed by hand before', () => {
    expect(nextCashRegisterCode(['PRINCIPAL', 'C1', 'CAJA-2', 'C2B'])).toBe('C2');
    expect(nextCashRegisterCode(['PRINCIPAL'])).toBe('C1');
  });

  it('does not overflow on a long number', () => {
    expect(nextCashRegisterCode(['C99'])).toBe('C100');
  });
});

describe('defaultCashRegisterName', () => {
  it('is the name of the store', () => {
    expect(defaultCashRegisterName('Tienda centro')).toBe('Tienda centro');
  });

  it('cuts it to what a register name admits', () => {
    expect(defaultCashRegisterName('A'.repeat(120))).toHaveLength(80);
  });

  it('falls back to a name when the store has none to give', () => {
    expect(defaultCashRegisterName('   ')).toBe('Caja principal');
  });
});
