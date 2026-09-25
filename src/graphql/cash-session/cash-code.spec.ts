import { ForbiddenException } from '@nestjs/common';
import {
  CASH_CODE_PATTERN,
  CashCodeVerdict,
  cashCodeException,
  formatCashCode,
  generateCashCode,
  isCashCode,
} from './cash-code.js';

describe('formatCashCode', () => {
  it('pads with zeros on the left up to 6 digits', () => {
    expect(formatCashCode(4821)).toBe('004821');
    expect(formatCashCode(0)).toBe('000000');
  });

  it('leaves a 6 digit number as it is', () => {
    expect(formatCashCode(999999)).toBe('999999');
  });
});

describe('generateCashCode', () => {
  it('always gives 6 digits, zeros on the left included', () => {
    for (let attempt = 0; attempt < 500; attempt++) {
      expect(generateCashCode()).toMatch(CASH_CODE_PATTERN);
    }
  });
});

describe('isCashCode', () => {
  it('accepts the same code', () => {
    expect(isCashCode('004821', '004821')).toBe(true);
  });

  it('rejects a different code, even when only one digit changes', () => {
    expect(isCashCode('004822', '004821')).toBe(false);
  });

  it('rejects a code of another length without failing', () => {
    expect(isCashCode('4821', '004821')).toBe(false);
    expect(isCashCode('', '004821')).toBe(false);
  });
});

describe('cashCodeException', () => {
  it('forbids a wrong code', () => {
    expect(cashCodeException(CashCodeVerdict.WRONG)).toBeInstanceOf(ForbiddenException);
  });

  it('forbids a locked code, and says the administrator has to generate another', () => {
    const error = cashCodeException(CashCodeVerdict.LOCKED);

    expect(error).toBeInstanceOf(ForbiddenException);
    expect(error.message).toContain('genere otro');
  });
});
