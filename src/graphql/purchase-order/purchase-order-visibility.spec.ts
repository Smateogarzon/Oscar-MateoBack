import { ForbiddenException } from '@nestjs/common';
import type { CompanyAccess } from '../../common/access/company-access.js';
import { PermissionCode } from '../../common/enums/permission-code.enum.js';
import { RoleCode } from '../../common/enums/role-code.enum.js';
import { UserCompanyRole } from '../user-company-role/entities/user-company-role.entity.js';
import { UserLocationAccess } from '../user-location-access/entities/user-location-access.entity.js';
import { assertCanReceiveAt, purchaseOrderLocationScope } from './purchase-order-visibility.js';

const COMPANY = 'company-1';
const USER = 'user-1';

const accessOf = (roleCodes: string[], permissionCodes: string[] = []): CompanyAccess => ({
  companyId: COMPANY,
  roleCodes,
  permissionCodes,
});

// `assigned` son las sedes del usuario; `isPlatform`, si es super admin (entra a todas).
function createManager({ assigned = [] as string[], isPlatform = false } = {}) {
  const locationAccessRepo = {
    find: vi.fn().mockResolvedValue(assigned.map((locationId) => ({ locationId }))),
    existsBy: vi.fn(async ({ locationId }: { locationId: string }) => assigned.includes(locationId)),
  };
  const membershipRepo = { existsBy: vi.fn().mockResolvedValue(isPlatform) };
  return {
    getRepository: (entity: unknown) => (entity === UserLocationAccess ? locationAccessRepo : entity === UserCompanyRole ? membershipRepo : null),
  } as never;
}

const scopeFor = (manager: never, access: CompanyAccess) => purchaseOrderLocationScope(manager, COMPANY, USER, access);

describe('purchaseOrderLocationScope', () => {
  // El bug: el bodeguero veía (y podía recibir) las órdenes de toda la empresa, también las que
  // entran a una bodega que no es suya.
  it('limits a warehouse user to the warehouses they are assigned', async () => {
    const manager = createManager({ assigned: ['bodega-1'] });

    const scope = await scopeFor(manager, accessOf([RoleCode.WAREHOUSE], [PermissionCode.WAREHOUSE_FULFILL_ORDERS]));

    expect(scope).toEqual(['bodega-1']);
  });

  // Vacío no es lo mismo que `null`: quien no tiene ninguna bodega asignada no ve ninguna orden, no
  // las ve todas.
  it('gives a warehouse user with no assignment an empty scope, not a free pass', async () => {
    const manager = createManager({ assigned: [] });

    const scope = await scopeFor(manager, accessOf([RoleCode.WAREHOUSE], [PermissionCode.WAREHOUSE_FULFILL_ORDERS]));

    expect(scope).toEqual([]);
  });

  it('lets whoever manages the purchasing see every order: they are the ones who build them', async () => {
    const manager = createManager({ assigned: ['bodega-1'] });

    const scope = await scopeFor(manager, accessOf([RoleCode.ADMIN], [PermissionCode.SUPPLIERS_MANAGE_PURCHASE_ORDERS]));

    expect(scope).toBeNull();
  });

  // El proveedor ya queda acotado a las suyas por `supplierId`: a qué bodega entran no es asunto suyo.
  it('does not limit the supplier by warehouse', async () => {
    const manager = createManager({ assigned: [] });

    const scope = await scopeFor(manager, accessOf([RoleCode.SUPPLIER], [PermissionCode.SUPPLIERS_REGISTER_DELIVERY]));

    expect(scope).toBeNull();
  });
});

describe('assertCanReceiveAt', () => {
  it('lets the warehouse user receive in a warehouse of theirs', async () => {
    const manager = createManager({ assigned: ['bodega-1'] });

    await expect(assertCanReceiveAt(manager, USER, 'bodega-1')).resolves.toBeUndefined();
  });

  // Lo de la captura: el bodeguero de otra bodega podía firmar la llegada y meterle existencia.
  it('stops them receiving in a warehouse that is not theirs', async () => {
    const manager = createManager({ assigned: ['bodega-1'] });

    await expect(assertCanReceiveAt(manager, USER, 'bodega-2')).rejects.toThrow(ForbiddenException);
  });

  it('lets the super admin receive anywhere, with no explicit assignment', async () => {
    const manager = createManager({ assigned: [], isPlatform: true });

    await expect(assertCanReceiveAt(manager, USER, 'bodega-2')).resolves.toBeUndefined();
  });
});
