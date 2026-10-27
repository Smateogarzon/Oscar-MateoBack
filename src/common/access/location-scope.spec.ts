import { ForbiddenException } from '@nestjs/common';
import { RoleCode } from '../enums/role-code.enum.js';
import type { CompanyAccess } from './company-access.js';
import { assertVisibleLocation, visibleLocationIds } from './location-scope.js';

const COMPANY = '10000000-0000-4000-8000-000000000001';
const USER = '30000000-0000-4000-8000-000000000001';
const BODEGA_A = '40000000-0000-4000-8000-00000000000a';
const BODEGA_B = '40000000-0000-4000-8000-00000000000b';

const access = (...roleCodes: string[]): CompanyAccess => ({ companyId: COMPANY, roleCodes, permissionCodes: [] });

// Un manager con el repositorio de accesos a sedes resuelto a lo que se le pase.
function createManager(locationIds: string[]) {
  const repo = { find: vi.fn(async () => locationIds.map((locationId) => ({ locationId }))) };
  return { manager: { getRepository: () => repo } as never, repo };
}

describe('visibleLocationIds', () => {
  it('el bodeguero ve solo las sedes que tiene asignadas', async () => {
    const { manager } = createManager([BODEGA_A]);
    await expect(visibleLocationIds(manager, COMPANY, USER, access(RoleCode.WAREHOUSE))).resolves.toEqual([BODEGA_A]);
  });

  it('sin ninguna asignada no ve nada: lista vacía, que no es lo mismo que "todas"', async () => {
    const { manager } = createManager([]);
    await expect(visibleLocationIds(manager, COMPANY, USER, access(RoleCode.WAREHOUSE))).resolves.toEqual([]);
  });

  it('el administrador de la empresa las ve todas, sin consultar asignaciones', async () => {
    const { manager, repo } = createManager([BODEGA_A]);
    await expect(visibleLocationIds(manager, COMPANY, USER, access(RoleCode.ADMIN))).resolves.toBeNull();
    expect(repo.find).not.toHaveBeenCalled();
  });

  it('el super administrador también', async () => {
    const { manager } = createManager([]);
    await expect(visibleLocationIds(manager, COMPANY, USER, access(RoleCode.SUPER_ADMIN))).resolves.toBeNull();
  });
});

describe('assertVisibleLocation', () => {
  it('deja pasar una sede asignada', async () => {
    const { manager } = createManager([BODEGA_A, BODEGA_B]);
    await expect(assertVisibleLocation(manager, COMPANY, USER, access(RoleCode.WAREHOUSE), BODEGA_B)).resolves.toBeUndefined();
  });

  it('rechaza una sede que no es suya', async () => {
    const { manager } = createManager([BODEGA_A]);
    await expect(assertVisibleLocation(manager, COMPANY, USER, access(RoleCode.WAREHOUSE), BODEGA_B)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rechaza un cajón sin sede (la bolsa de un corredor) a quien no las ve todas', async () => {
    const { manager } = createManager([BODEGA_A]);
    await expect(assertVisibleLocation(manager, COMPANY, USER, access(RoleCode.WAREHOUSE), null)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('al administrador no le pide nada', async () => {
    const { manager } = createManager([]);
    await expect(assertVisibleLocation(manager, COMPANY, USER, access(RoleCode.ADMIN), null)).resolves.toBeUndefined();
  });
});
