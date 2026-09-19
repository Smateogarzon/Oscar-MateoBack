import { BadRequestException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import { RolePermission } from '../../graphql/role-permission/entities/role-permission.entity.js';
import { UserCompanyRole } from '../../graphql/user-company-role/entities/user-company-role.entity.js';
import type { AccessRule } from '../decorators/permissions.decorator.js';
import { PermissionCode } from '../enums/permission-code.enum.js';
import { RecordStatus } from '../enums/record-status.enum.js';
import { PermissionsGuard } from './permissions.guard.js';

const COMPANY = '10000000-0000-4000-8000-000000000001';

const requireAll = (...permissions: PermissionCode[]): AccessRule => ({ mode: 'all', permissions });
const requireAny = (...permissions: PermissionCode[]): AccessRule => ({ mode: 'any', permissions });

interface GuardOptions {
  // null = la operación no tiene regla de acceso
  rule?: AccessRule | null;
  memberships?: unknown[];
  granted?: string[];
}

function createGuard({
  rule = requireAll(PermissionCode.USERS_MANAGE),
  memberships,
  granted = [],
}: GuardOptions = {}) {
  const reflector = { getAllAndOverride: vi.fn(() => rule ?? undefined) };
  const membershipRepo = {
    find: vi.fn(async () =>
      memberships ?? [{ role: { id: 'role-1', code: 'SELLER', status: RecordStatus.ACTIVE } }],
    ),
  };
  const rolePermissionRepo = {
    find: vi.fn(async () =>
      granted.map((code) => ({ permission: { code, status: RecordStatus.ACTIVE } })),
    ),
  };
  const dataSource = {
    getRepository: vi.fn((entity: unknown) =>
      entity === UserCompanyRole ? membershipRepo : entity === RolePermission ? rolePermissionRepo : undefined,
    ),
  };

  return {
    guard: new PermissionsGuard(reflector as never, dataSource as never),
    membershipRepo,
    rolePermissionRepo,
  };
}

// El guard le pasa al Reflector el handler y la clase; el Reflector está mockeado, así que
// basta con que existan.
const handlerAndClass = { getHandler: () => undefined, getClass: () => undefined };
const loggedUser = { sub: 'user-1', email: 'ana@example.com' };

function contextWith(headers: Record<string, string>, user: unknown = loggedUser) {
  const req: Record<string, unknown> = { headers, user };
  vi.spyOn(GqlExecutionContext, 'create').mockReturnValue({
    getContext: () => ({ req }),
  } as unknown as GqlExecutionContext);
  return { req, context: { getType: () => 'graphql', ...handlerAndClass } as never };
}

function httpContextWith(headers: Record<string, string>) {
  const req: Record<string, unknown> = { headers, user: loggedUser };
  const context = {
    getType: () => 'http',
    switchToHttp: () => ({ getRequest: () => req }),
    ...handlerAndClass,
  };
  return { req, context: context as never };
}

describe('PermissionsGuard', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('lets through an operation without an access rule, without touching the database', async () => {
    const { guard, membershipRepo } = createGuard({ rule: null });
    const { context } = contextWith({});

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(membershipRepo.find).not.toHaveBeenCalled();
  });

  it('rejects when nobody is authenticated', async () => {
    const { guard } = createGuard();
    // null y no undefined: undefined activaría el valor por defecto del parámetro.
    const { context } = contextWith({ 'x-company-id': COMPANY }, null);

    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
  });

  it('rejects a request that does not say which company the user is working with', async () => {
    const { guard } = createGuard();
    const { context } = contextWith({});

    await expect(guard.canActivate(context)).rejects.toThrow(BadRequestException);
  });

  it('rejects a company id that is not a UUID before hitting the database', async () => {
    const { guard, membershipRepo } = createGuard();
    const { context } = contextWith({ 'x-company-id': 'not-a-uuid' });

    await expect(guard.canActivate(context)).rejects.toThrow(BadRequestException);
    expect(membershipRepo.find).not.toHaveBeenCalled();
  });

  it('rejects a company the user is not a member of', async () => {
    const { guard } = createGuard({ memberships: [], granted: ['users.manage'] });
    const { context } = contextWith({ 'x-company-id': COMPANY });

    await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
  });

  it('rejects a member whose roles lack the required permission in that company', async () => {
    const { guard } = createGuard({ granted: ['sales.create'] });
    const { context } = contextWith({ 'x-company-id': COMPANY });

    await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
  });

  it('requires every listed permission when the rule is "all"', async () => {
    const { guard } = createGuard({
      rule: requireAll(PermissionCode.USERS_MANAGE, PermissionCode.SETTINGS_MANAGE),
      granted: ['users.manage'],
    });
    const { context } = contextWith({ 'x-company-id': COMPANY });

    await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
  });

  it('lets through a member with just one of the listed permissions when the rule is "any"', async () => {
    const { guard } = createGuard({
      rule: requireAny(PermissionCode.USERS_MANAGE, PermissionCode.SETTINGS_MANAGE),
      granted: ['settings.manage'],
    });
    const { context } = contextWith({ 'x-company-id': COMPANY });

    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('rejects a member with none of the listed permissions when the rule is "any"', async () => {
    const { guard } = createGuard({
      rule: requireAny(PermissionCode.USERS_MANAGE, PermissionCode.SETTINGS_MANAGE),
      granted: ['sales.create'],
    });
    const { context } = contextWith({ 'x-company-id': COMPANY });

    await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
  });

  it('lets any member through when the rule only asks for membership, but still rejects outsiders', async () => {
    const member = createGuard({ rule: requireAll() });
    await expect(
      member.guard.canActivate(contextWith({ 'x-company-id': COMPANY }).context),
    ).resolves.toBe(true);

    const outsider = createGuard({ rule: requireAll(), memberships: [] });
    await expect(
      outsider.guard.canActivate(contextWith({ 'x-company-id': COMPANY }).context),
    ).rejects.toThrow(ForbiddenException);
  });

  it('lets a member through and leaves what they can do in that company on the request', async () => {
    const { guard } = createGuard({ granted: ['users.manage', 'sales.create'] });
    const { req, context } = contextWith({ 'x-company-id': COMPANY });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(req.companyAccess).toEqual({
      companyId: COMPANY,
      roleCodes: ['SELLER'],
      permissionCodes: ['users.manage', 'sales.create'],
    });
  });

  it('checks membership and permissions in the company the request names', async () => {
    const { guard, membershipRepo, rolePermissionRepo } = createGuard({ granted: ['users.manage'] });
    const { context } = contextWith({ 'x-company-id': COMPANY });

    await guard.canActivate(context);

    expect(membershipRepo.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'user-1', companyId: COMPANY, status: RecordStatus.ACTIVE },
      }),
    );
    expect(rolePermissionRepo.find).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ companyId: COMPANY }) }),
    );
  });

  it('also protects REST requests', async () => {
    const { guard } = createGuard({ granted: ['users.manage'] });
    const { req, context } = httpContextWith({ 'x-company-id': COMPANY });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(req.companyAccess).toMatchObject({ companyId: COMPANY });
  });
});
