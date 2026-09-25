import { PermissionCode } from '../../common/enums/permission-code.enum.js';
import { canReadSale, isOwnSale, saleActor, type SaleActor } from './sale-actor.js';

// Una venta como la ve quien pregunta: quién la cobró y, si lo hubo, quién la vendió.
const sale = (cashierId: string, sellerId: string | null = null) => ({ cashierId, sellerId });

describe('saleActor', () => {
  it('keeps the user id', () => {
    expect(saleActor('user-1', []).userId).toBe('user-1');
  });

  it('without permissions, sees no history and reads no sale of others', () => {
    expect(saleActor('user-1', [])).toEqual({ userId: 'user-1', canViewAll: false, canReadAny: false });
  });

  it('with sales.view_all, sees the history of everyone and reads any sale', () => {
    expect(saleActor('user-1', [PermissionCode.SALES_VIEW_ALL])).toEqual({
      userId: 'user-1',
      canViewAll: true,
      canReadAny: true,
    });
  });

  // Para resolver una solicitud o una devolución hay que poder ver la venta a la que se refiere, pero eso
  // no da el histórico completo de ventas.
  it.each([
    ['approves discounts', PermissionCode.SALES_APPROVE_DISCOUNT],
    ['approves returns', PermissionCode.SALES_APPROVE_RETURN],
  ])('whoever %s reads any sale by its id, without seeing the whole history', (_what, permission) => {
    expect(saleActor('user-1', [permission])).toEqual({
      userId: 'user-1',
      canViewAll: false,
      canReadAny: true,
    });
  });

  it.each([
    PermissionCode.SALES_VIEW,
    PermissionCode.SALES_CREATE,
    PermissionCode.SALES_CANCEL,
    PermissionCode.SALES_RETURN,
    PermissionCode.CASH_VIEW_ALL,
    PermissionCode.CASH_OPEN_CLOSE_SHIFT,
    PermissionCode.CASH_REGISTER_PAYMENT,
  ])('%s alone does not widen what the actor reads: only their own sales', (permission) => {
    expect(saleActor('user-1', [permission])).toEqual({
      userId: 'user-1',
      canViewAll: false,
      canReadAny: false,
    });
  });

  it('combines the permissions: view_all together with the approvals still sees everything', () => {
    const actor = saleActor('user-1', [
      PermissionCode.SALES_VIEW,
      PermissionCode.SALES_VIEW_ALL,
      PermissionCode.SALES_APPROVE_DISCOUNT,
    ]);

    expect(actor.canViewAll).toBe(true);
    expect(actor.canReadAny).toBe(true);
  });

  it('ignores codes it does not know', () => {
    expect(saleActor('user-1', ['inventory.view'])).toEqual({
      userId: 'user-1',
      canViewAll: false,
      canReadAny: false,
    });
  });
});

describe('isOwnSale', () => {
  it('is the sale of whoever charged it', () => {
    expect(isOwnSale({ userId: 'cashier-1' }, sale('cashier-1'))).toBe(true);
  });

  it('is the sale of whoever sold it, even if someone else charged it', () => {
    expect(isOwnSale({ userId: 'seller-1' }, sale('cashier-1', 'seller-1'))).toBe(true);
  });

  it('is not the sale of someone who neither charged it nor sold it', () => {
    expect(isOwnSale({ userId: 'user-9' }, sale('cashier-1', 'seller-1'))).toBe(false);
  });

  it('a sale with no seller belongs only to its cashier', () => {
    expect(isOwnSale({ userId: 'seller-1' }, sale('cashier-1', null))).toBe(false);
  });

  it('is the sale of the user who is both its cashier and its seller', () => {
    expect(isOwnSale({ userId: 'user-1' }, sale('user-1', 'user-1'))).toBe(true);
  });
});

describe('canReadSale', () => {
  const reader = (overrides: Partial<SaleActor> = {}): SaleActor => ({
    userId: 'user-1',
    canViewAll: false,
    canReadAny: false,
    ...overrides,
  });

  it('lets an actor without extra reach read the sale they charged', () => {
    expect(canReadSale(reader(), sale('user-1'))).toBe(true);
  });

  it('lets an actor without extra reach read the sale they sold', () => {
    expect(canReadSale(reader(), sale('cashier-9', 'user-1'))).toBe(true);
  });

  it('does not let an actor without extra reach read the sale of someone else', () => {
    expect(canReadSale(reader(), sale('cashier-9', 'seller-9'))).toBe(false);
    expect(canReadSale(reader(), sale('cashier-9'))).toBe(false);
  });

  it('lets whoever can read any sale read the sale of someone else', () => {
    expect(canReadSale(reader({ canReadAny: true }), sale('cashier-9', 'seller-9'))).toBe(true);
  });

  it('lets whoever sees the whole history read the sale of someone else, once built from their permissions', () => {
    const admin = saleActor('admin-1', [PermissionCode.SALES_VIEW_ALL]);

    expect(canReadSale(admin, sale('cashier-9', 'seller-9'))).toBe(true);
  });

  it('is decided by canReadAny, not by canViewAll alone', () => {
    // Un actor armado a mano con solo canViewAll no lee ventas ajenas por su id: lo decide canReadAny
    expect(canReadSale(reader({ canViewAll: true }), sale('cashier-9'))).toBe(false);
  });

  it('a cashier who only approves discounts reads any sale by id, and their own as well', () => {
    const approver = saleActor('approver-1', [PermissionCode.SALES_APPROVE_DISCOUNT]);

    expect(canReadSale(approver, sale('cashier-9'))).toBe(true);
    expect(canReadSale(approver, sale('approver-1'))).toBe(true);
  });
});
