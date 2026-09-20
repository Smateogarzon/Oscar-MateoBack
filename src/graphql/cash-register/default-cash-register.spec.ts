import { DEFAULT_CASH_REGISTER_CODE, defaultCashRegisterName } from './default-cash-register.js';

describe('defaultCashRegisterName', () => {
  it('is the name of the store', () => {
    expect(defaultCashRegisterName('Sede principal')).toBe('Sede principal');
  });

  it('trims the spaces around it', () => {
    expect(defaultCashRegisterName('  Sede norte ')).toBe('Sede norte');
  });

  it('cuts a store name longer than a cash register name can be', () => {
    expect(defaultCashRegisterName('A'.repeat(120))).toHaveLength(80);
  });

  it('does not leave a space at the end after cutting', () => {
    // 79 letras, un espacio y otra letra: el corte a 80 deja el espacio al final
    expect(defaultCashRegisterName(`${'A'.repeat(79)} B`)).toBe('A'.repeat(79));
  });

  it('falls back to a generic name when the store name is only spaces', () => {
    expect(defaultCashRegisterName('    ')).toBe('Caja principal');
  });
});

describe('DEFAULT_CASH_REGISTER_CODE', () => {
  it('is a short code that fits the 30 characters of a register code', () => {
    expect(DEFAULT_CASH_REGISTER_CODE).toBe('C1');
  });
});
