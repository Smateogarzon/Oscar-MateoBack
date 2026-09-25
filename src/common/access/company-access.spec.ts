import { Company } from '../../graphql/company/entities/company.entity.js';
import { RolePermission } from '../../graphql/role-permission/entities/role-permission.entity.js';
import { RoleScope } from '../../graphql/role/entities/role-scope.enum.js';
import { UserCompanyRole } from '../../graphql/user-company-role/entities/user-company-role.entity.js';
import { RecordStatus } from '../enums/record-status.enum.js';
import { loadCompanyAccess } from './company-access.js';

const COMPANY = '10000000-0000-4000-8000-000000000001';

function createDataSource(
  memberships: unknown[],
  rolePermissions: unknown[] = [],
  companyActive = true,
) {
  const membershipRepo = { find: vi.fn(async () => memberships) };
  const rolePermissionRepo = { find: vi.fn(async () => rolePermissions) };
  const companyRepo = { existsBy: vi.fn(async () => companyActive) };
  const dataSource = {
    getRepository: vi.fn((entity: unknown) =>
      entity === UserCompanyRole
        ? membershipRepo
        : entity === RolePermission
          ? rolePermissionRepo
          : entity === Company
            ? companyRepo
            : undefined,
    ),
  };
  return { dataSource: dataSource as never, membershipRepo, rolePermissionRepo, companyRepo };
}

const role = (id: string, code: string, status = RecordStatus.ACTIVE, scope = RoleScope.COMPANY) => ({
  id,
  code,
  status,
  scope,
});
const membership = (roleValue: ReturnType<typeof role>) => ({ role: roleValue });
const grant = (code: string, status = RecordStatus.ACTIVE) => ({ permission: { code, status } });

describe('loadCompanyAccess', () => {
  it('returns null, without looking up permissions, when the user is not an active member of the company', async () => {
    const { dataSource, membershipRepo, rolePermissionRepo } = createDataSource([]);

    await expect(loadCompanyAccess(dataSource, 'user-1', COMPANY)).resolves.toBeNull();
    expect(membershipRepo.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'user-1', companyId: COMPANY, status: RecordStatus.ACTIVE },
      }),
    );
    expect(rolePermissionRepo.find).not.toHaveBeenCalled();
  });

  it('only reads the permissions the roles have in that same company', async () => {
    const { dataSource, rolePermissionRepo } = createDataSource(
      [membership(role('role-1', 'SELLER'))],
      [grant('sales.create')],
    );

    await loadCompanyAccess(dataSource, 'user-1', COMPANY);

    expect(rolePermissionRepo.find).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ companyId: COMPANY }) }),
    );
  });

  it('returns the role codes and the permission codes without duplicates', async () => {
    const { dataSource } = createDataSource(
      [membership(role('role-1', 'SELLER')), membership(role('role-2', 'CASHIER'))],
      [grant('sales.create'), grant('cash.charge_orders'), grant('sales.create')],
    );

    await expect(loadCompanyAccess(dataSource, 'user-1', COMPANY)).resolves.toEqual({
      companyId: COMPANY,
      roleCodes: ['SELLER', 'CASHIER'],
      permissionCodes: ['sales.create', 'cash.charge_orders'],
    });
  });

  it('ignores inactive permissions', async () => {
    const { dataSource } = createDataSource(
      [membership(role('role-1', 'SELLER'))],
      [grant('sales.create'), grant('sales.void', RecordStatus.INACTIVE)],
    );

    const access = await loadCompanyAccess(dataSource, 'user-1', COMPANY);

    expect(access?.permissionCodes).toEqual(['sales.create']);
  });

  it('returns null for a company that is suspended or inactive, without looking up permissions', async () => {
    const { dataSource, rolePermissionRepo } = createDataSource(
      [membership(role('role-1', 'SELLER'))],
      [grant('sales.create')],
      false,
    );

    await expect(loadCompanyAccess(dataSource, 'user-1', COMPANY)).resolves.toBeNull();
    expect(rolePermissionRepo.find).not.toHaveBeenCalled();
  });

  it('lets a platform role through even when the company is suspended', async () => {
    const { dataSource, companyRepo } = createDataSource(
      [membership(role('role-9', 'SUPER_ADMIN', RecordStatus.ACTIVE, RoleScope.GLOBAL))],
      [grant('settings.manage')],
      false,
    );

    const access = await loadCompanyAccess(dataSource, 'user-1', COMPANY);

    expect(access?.roleCodes).toEqual(['SUPER_ADMIN']);
    expect(companyRepo.existsBy).not.toHaveBeenCalled();
  });

  it('ignores inactive roles and does not look up permissions when none is left', async () => {
    const { dataSource, rolePermissionRepo } = createDataSource([
      membership(role('role-1', 'SELLER', RecordStatus.INACTIVE)),
    ]);

    await expect(loadCompanyAccess(dataSource, 'user-1', COMPANY)).resolves.toEqual({
      companyId: COMPANY,
      roleCodes: [],
      permissionCodes: [],
    });
    expect(rolePermissionRepo.find).not.toHaveBeenCalled();
  });
});
