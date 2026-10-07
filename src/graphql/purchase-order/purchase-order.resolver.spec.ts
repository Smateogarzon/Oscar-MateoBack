import { ForbiddenException } from '@nestjs/common';
import { ACCESS_RULE_KEY } from '../../common/decorators/permissions.decorator.js';
import { PermissionCode } from '../../common/enums/permission-code.enum.js';
import { RoleCode } from '../../common/enums/role-code.enum.js';
import { PurchaseOrderResolver } from './purchase-order.resolver.js';

const COMPANY = 'company-1';
const SUPPLIER_USER = { sub: 'supplier-1', email: 'p@b.co' };
const ADMIN_USER = { sub: 'admin-1', email: 'a@b.co' };

const supplierAccess = {
  roleCodes: [RoleCode.SUPPLIER],
  permissionCodes: [PermissionCode.SUPPLIERS_MANAGE_PURCHASE_ORDERS],
};
const adminAccess = {
  roleCodes: [RoleCode.ADMIN],
  permissionCodes: [PermissionCode.SUPPLIERS_MANAGE_PURCHASE_ORDERS],
};

function createResolver() {
  const service = {
    resolveOverage: vi.fn().mockResolvedValue({ id: 'order-1' }),
    findAll: vi.fn().mockResolvedValue([]),
  };
  return { resolver: new PurchaseOrderResolver(service as never), service };
}

const DECISIONS = [{ itemId: 'item-1', decision: 'APPROVE' }] as never;

describe('PurchaseOrderResolver', () => {
  describe('resolvePurchaseOrderOverage', () => {
    it('blocks a supplier from deciding overages, even with the purchasing permission', () => {
      const { resolver, service } = createResolver();

      expect(() =>
        resolver.resolvePurchaseOrderOverage(COMPANY, SUPPLIER_USER, supplierAccess as never, 'order-1', DECISIONS),
      ).toThrow(ForbiddenException);

      expect(service.resolveOverage).not.toHaveBeenCalled();
    });

    it('lets the company decide the overage', async () => {
      const { resolver, service } = createResolver();

      await resolver.resolvePurchaseOrderOverage(COMPANY, ADMIN_USER, adminAccess as never, 'order-1', DECISIONS);

      expect(service.resolveOverage).toHaveBeenCalledWith(COMPANY, ADMIN_USER.sub, 'order-1', DECISIONS);
    });
  });

  // La lectura de órdenes exige uno de los permisos de la pantalla de compras; antes bastaba ser miembro.
  describe('read access', () => {
    it.each(['purchaseOrders', 'purchaseOrder', 'purchaseOrderItems'] as const)(
      '%s requires a purchasing permission, not just membership',
      (method) => {
        const rule = Reflect.getMetadata(ACCESS_RULE_KEY, PurchaseOrderResolver.prototype[method]);

        expect(rule.mode).toBe('any');
        expect(rule.permissions).toEqual(
          expect.arrayContaining([
            PermissionCode.SUPPLIERS_MANAGE_PURCHASE_ORDERS,
            PermissionCode.SUPPLIERS_REGISTER_DELIVERY,
            PermissionCode.WAREHOUSE_FULFILL_ORDERS,
          ]),
        );
        expect(rule.permissions).not.toContain(PermissionCode.ORDERS_VIEW);
      },
    );
  });
});
