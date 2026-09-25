import { ConflictException, ForbiddenException } from '@nestjs/common';
import { PermissionCode } from '../enums/permission-code.enum.js';
import {
  LAST_ADMIN_MESSAGE,
  assertHoldsPermissions,
  assertStillHasAdmin,
  countCompanyAdmins,
  lockCompany,
  permissionCodesOfRole,
  permissionCodesOfUser,
} from './company-admins.js';

const COMPANY = 'company-1';

// Un manager cuyo `query` responde lo que se le diga, una respuesta por consulta y en orden (sin más
// respuestas, no devuelve filas).
function managerAnswering(...answers: unknown[]) {
  const query = vi.fn().mockResolvedValue([]);
  for (const answer of answers) query.mockResolvedValueOnce(answer);
  return { manager: { query } as never, query };
}

describe('company-admins', () => {
  describe('lockCompany', () => {
    it('locks the row of the company until the transaction ends', async () => {
      const { manager, query } = managerAnswering([{ id: COMPANY }]);

      await lockCompany(manager, COMPANY);

      expect(query).toHaveBeenCalledTimes(1);
      const [sql, params] = query.mock.calls[0];
      expect(sql).toContain('FROM "companies"');
      expect(sql).toContain('FOR UPDATE');
      expect(params).toEqual([COMPANY]);
    });
  });

  describe('countCompanyAdmins', () => {
    it('counts the people that hold both users.manage and settings.manage in the company', async () => {
      const { manager, query } = managerAnswering([{ count: 2 }]);

      await expect(countCompanyAdmins(manager, COMPANY)).resolves.toBe(2);
      expect(query.mock.calls[0][1]).toEqual([
        COMPANY,
        PermissionCode.USERS_MANAGE,
        PermissionCode.SETTINGS_MANAGE,
      ]);
    });

    it('only counts active accounts with an active membership and an active company role', async () => {
      const { manager, query } = managerAnswering([{ count: 1 }]);

      await countCompanyAdmins(manager, COMPANY);

      const [sql] = query.mock.calls[0];
      expect(sql).toContain(`u."status" = 'ACTIVE'`);
      expect(sql).toContain(`ucr."status" = 'ACTIVE'`);
      expect(sql).toContain(`r."status" = 'ACTIVE'`);
      // Un rol de plataforma (el super admin) no cuenta como administrador de la empresa
      expect(sql).toContain(`r."scope" <> 'GLOBAL'`);
    });

    it('reads a count that comes back as text', async () => {
      const { manager } = managerAnswering([{ count: '3' }]);

      await expect(countCompanyAdmins(manager, COMPANY)).resolves.toBe(3);
    });

    it('counts zero when there is no row', async () => {
      const { manager } = managerAnswering([]);

      await expect(countCompanyAdmins(manager, COMPANY)).resolves.toBe(0);
    });
  });

  describe('assertStillHasAdmin', () => {
    it('does not count again when the company had no administrator before: the change is not what left it so', async () => {
      const { manager, query } = managerAnswering([{ count: 0 }]);

      await expect(assertStillHasAdmin(manager, COMPANY, 0)).resolves.toBeUndefined();
      expect(query).not.toHaveBeenCalled();
    });

    it('lets the change through when an administrator is left', async () => {
      const { manager } = managerAnswering([{ count: 1 }]);

      await expect(assertStillHasAdmin(manager, COMPANY, 2)).resolves.toBeUndefined();
    });

    it('rejects a change that leaves a company that had administrators with none', async () => {
      const { manager } = managerAnswering([{ count: 0 }]);

      const error = await assertStillHasAdmin(manager, COMPANY, 1).catch(
        (caught: unknown) => caught,
      );

      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).message).toBe(LAST_ADMIN_MESSAGE);
    });

    it('counts inside the manager it is given, to see the changes of the transaction that are not confirmed yet', async () => {
      const { manager, query } = managerAnswering([{ count: 1 }]);

      await assertStillHasAdmin(manager, COMPANY, 1);

      expect(query).toHaveBeenCalledTimes(1);
      expect(query.mock.calls[0][1]).toContain(COMPANY);
    });
  });

  describe('permissionCodesOfRole', () => {
    it('returns the codes of the permissions the company left assigned to the role', async () => {
      const { manager, query } = managerAnswering([
        { code: PermissionCode.SALES_CREATE },
        { code: PermissionCode.SALES_VIEW },
      ]);

      await expect(permissionCodesOfRole(manager, COMPANY, 'role-1')).resolves.toEqual([
        PermissionCode.SALES_CREATE,
        PermissionCode.SALES_VIEW,
      ]);
      expect(query.mock.calls[0][1]).toEqual([COMPANY, 'role-1']);
    });

    it('returns nothing for a role without permissions', async () => {
      const { manager } = managerAnswering([]);

      await expect(permissionCodesOfRole(manager, COMPANY, 'role-1')).resolves.toEqual([]);
    });

    it('leaves out inactive permissions', async () => {
      const { manager, query } = managerAnswering([]);

      await permissionCodesOfRole(manager, COMPANY, 'role-1');

      expect(query.mock.calls[0][0]).toContain(`p."status" = 'ACTIVE'`);
    });
  });

  describe('permissionCodesOfUser', () => {
    it('returns the codes of the permissions of the active roles of the user in the company', async () => {
      const { manager, query } = managerAnswering([
        { code: PermissionCode.USERS_MANAGE },
        { code: PermissionCode.SALES_VIEW },
      ]);

      await expect(permissionCodesOfUser(manager, COMPANY, 'user-1')).resolves.toEqual([
        PermissionCode.USERS_MANAGE,
        PermissionCode.SALES_VIEW,
      ]);
      expect(query.mock.calls[0][1]).toEqual([COMPANY, 'user-1']);
    });

    it('only looks at active memberships and active roles', async () => {
      const { manager, query } = managerAnswering([]);

      await permissionCodesOfUser(manager, COMPANY, 'user-1');

      const [sql] = query.mock.calls[0];
      expect(sql).toContain(`ucr."status" = 'ACTIVE'`);
      expect(sql).toContain(`r."status" = 'ACTIVE'`);
      expect(sql).toContain(`p."status" = 'ACTIVE'`);
    });

    it('returns nothing for someone without an active membership', async () => {
      const { manager } = managerAnswering([]);

      await expect(permissionCodesOfUser(manager, COMPANY, 'user-1')).resolves.toEqual([]);
    });
  });

  describe('assertHoldsPermissions', () => {
    const MESSAGE = 'No puedes dar lo que no tienes';

    it('lets through someone who holds every permission asked', () => {
      expect(() =>
        assertHoldsPermissions(
          [PermissionCode.USERS_MANAGE, PermissionCode.SALES_CREATE],
          [PermissionCode.SALES_CREATE, PermissionCode.USERS_MANAGE],
          MESSAGE,
        ),
      ).not.toThrow();
    });

    it('lets through someone who holds more than what is asked', () => {
      expect(() =>
        assertHoldsPermissions(
          [PermissionCode.USERS_MANAGE, PermissionCode.SETTINGS_MANAGE],
          [PermissionCode.USERS_MANAGE],
          MESSAGE,
        ),
      ).not.toThrow();
    });

    it('lets through anything that asks for no permission at all, even from someone with none', () => {
      expect(() => assertHoldsPermissions([], [], MESSAGE)).not.toThrow();
    });

    it('rejects when a single one of the permissions is missing: you only give what you have', () => {
      const attempt = () =>
        assertHoldsPermissions(
          [PermissionCode.USERS_MANAGE],
          [PermissionCode.USERS_MANAGE, PermissionCode.SETTINGS_MANAGE],
          MESSAGE,
        );

      expect(attempt).toThrow(ForbiddenException);
      expect(attempt).toThrow(MESSAGE);
    });

    it('rejects someone with no permission when something is asked', () => {
      expect(() =>
        assertHoldsPermissions([], [PermissionCode.SALES_VIEW], MESSAGE),
      ).toThrow(ForbiddenException);
    });
  });
});
