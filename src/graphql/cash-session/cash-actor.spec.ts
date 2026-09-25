import { cashActor } from './cash-actor.js';

describe('cashActor', () => {
  it('only sees the shifts assigned to them, and cannot open or close shifts, as a cashier', () => {
    expect(cashActor('user-1', ['cash.register_payment', 'sales.create'])).toEqual({
      userId: 'user-1',
      canViewAll: false,
      canManageShifts: false,
    });
  });

  it('sees every shift, but does not open or close them, with cash.view_all', () => {
    expect(cashActor('user-1', ['cash.view_all'])).toEqual({
      userId: 'user-1',
      canViewAll: true,
      canManageShifts: false,
    });
  });

  it('opens and closes shifts, and sees all of them, with cash.open_close_shift', () => {
    expect(cashActor('user-1', ['cash.open_close_shift'])).toEqual({
      userId: 'user-1',
      canViewAll: true,
      canManageShifts: true,
    });
  });
});
