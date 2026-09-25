import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { In, QueryFailedError } from 'typeorm';
import type { AccessActor } from '../../common/access/access-actor.js';
import { LAST_ADMIN_MESSAGE } from '../../common/access/company-admins.js';
import { COMPANY_VISIBLE_ROLE } from '../../common/access/platform-role.js';
import { PermissionCode } from '../../common/enums/permission-code.enum.js';
import { RecordStatus } from '../../common/enums/record-status.enum.js';
import { IdempotencyKey } from '../idempotency/entities/idempotency-key.entity.js';
import { fingerprintOf } from '../idempotency/idempotency.js';
import { RoleScope } from '../role/entities/role-scope.enum.js';
import { Role } from '../role/entities/role.entity.js';
import { UserCompanyRoleService } from './user-company-role.service.js';

// Lo que responde la base a las consultas SQL sueltas: el bloqueo de la empresa, el conteo de
// administradores, los permisos de un rol o de un usuario y la clave de idempotencia. Se decide por lo que
// pregunta cada consulta, no por el orden en que llegan.
interface SqlAnswers {
  // Permisos del rol que se asigna
  roleCodes: string[];
  // Permisos del usuario al que se le cambia el rol
  userCodes: string[];
  // Administradores que hay en cada conteo sucesivo (el de antes del cambio y el de después); sin más, hay uno
  adminCounts: number[];
  // Lo que devuelve reclamar la clave de idempotencia (vacío: ya estaba reclamada)
  claim: { id: string }[];
}

function sqlAnswering(answers: SqlAnswers) {
  return async (sql: string, _params?: unknown[]): Promise<unknown> => {
    if (sql.includes('FOR UPDATE')) return [];
    if (sql.includes('COUNT(DISTINCT')) return [{ count: answers.adminCounts.shift() ?? 1 }];
    if (sql.includes('SELECT DISTINCT p."code"')) {
      return answers.userCodes.map((code) => ({ code }));
    }
    if (sql.includes('SELECT p."code"')) return answers.roleCodes.map((code) => ({ code }));
    if (sql.includes('INSERT INTO "idempotency_keys"')) return answers.claim;
    return [];
  };
}

function createService() {
  const repo = { find: vi.fn().mockResolvedValue([]), findOneBy: vi.fn() };
  const transactionRepo = {
    existsBy: vi.fn(),
    // Las asignaciones que el usuario ya tiene (las que lee `changeRole`, con y sin bloqueo)
    find: vi.fn().mockResolvedValue([]),
    // La asignación que se relee con bloqueo al quitar un rol
    findOne: vi.fn(),
    // ¿ya tenía ese rol? Por defecto, no.
    findOneBy: vi.fn().mockResolvedValue(null),
    findOneByOrFail: vi.fn(),
    create: vi.fn((data: object) => data),
    save: vi.fn(async (membership: object) => ({ id: 'ucr-1', ...membership })),
  };
  // El rol que se asigna: por defecto, uno de empresa.
  const roleRepo = {
    findOneBy: vi.fn().mockResolvedValue({ id: 'role-1', scope: RoleScope.COMPANY }),
  };
  // La clave de idempotencia que ya hubiera guardada. Por defecto, ninguna.
  const keyRepo = { findOneBy: vi.fn().mockResolvedValue(null) };

  const db: SqlAnswers = {
    roleCodes: [PermissionCode.SALES_CREATE],
    userCodes: [PermissionCode.SALES_CREATE],
    adminCounts: [],
    claim: [{ id: 'claim-1' }],
  };
  const query = vi.fn(sqlAnswering(db));

  const dataSource = {
    transaction: vi.fn(async (fn: (manager: unknown) => unknown) =>
      fn({
        query,
        getRepository: (entity: unknown) =>
          entity === Role ? roleRepo : entity === IdempotencyKey ? keyRepo : transactionRepo,
      }),
    ),
  };
  const service = new UserCompanyRoleService(repo as never, dataSource as never);
  return { service, repo, transactionRepo, roleRepo, keyRepo, db, query, dataSource };
}

// Qué responde la base a las consultas de membresía del usuario al que se le agrega el rol.
function targetUser(
  transactionRepo: { existsBy: ReturnType<typeof vi.fn> },
  { member = true, platform = false } = {},
) {
  transactionRepo.existsBy.mockImplementation(async (where: Record<string, unknown>) =>
    where.role ? platform : member,
  );
}

const COMPANY = 'company-1';
const input = { userId: 'user-1', companyId: COMPANY, roleId: 'role-1' };

// Quien hace el cambio: administra usuarios y además tiene el permiso de vender (así puede dar y tocar roles
// con ese permiso, pero no otros)
const actor: AccessActor = {
  userId: 'admin-1',
  permissionCodes: [PermissionCode.USERS_MANAGE, PermissionCode.SALES_CREATE],
};

// El error de la base de datos por violar un índice único o una llave foránea, como lo entrega el driver.
const databaseError = (code: string) =>
  new QueryFailedError('INSERT', [], Object.assign(new Error('database error'), { code }));

// Una asignación de rol tal como la entrega la base de datos.
const stored = (overrides: Record<string, unknown> = {}) => ({
  id: 'ucr-1',
  userId: 'user-1',
  companyId: COMPANY,
  roleId: 'role-1',
  status: RecordStatus.ACTIVE,
  ...overrides,
});

describe('UserCompanyRoleService', () => {
  describe('findAll', () => {
    it('only lists the memberships of the company, without those of platform roles', async () => {
      const { service, repo } = createService();

      await service.findAll(COMPANY);

      expect(repo.find).toHaveBeenCalledWith({
        where: { companyId: COMPANY, role: COMPANY_VISIBLE_ROLE },
      });
    });

    it('can narrow the list down by user and status', async () => {
      const { service, repo } = createService();

      await service.findAll(COMPANY, 'user-1', RecordStatus.ACTIVE);

      expect(repo.find).toHaveBeenCalledWith({
        where: {
          companyId: COMPANY,
          role: COMPANY_VISIBLE_ROLE,
          userId: 'user-1',
          status: RecordStatus.ACTIVE,
        },
      });
    });
  });

  describe('findOne', () => {
    it('looks the membership up inside the company, ignoring platform roles', async () => {
      const { service, repo } = createService();
      repo.findOneBy.mockResolvedValue(null);

      await expect(service.findOne(COMPANY, 'ucr-9')).rejects.toThrow(NotFoundException);
      expect(repo.findOneBy).toHaveBeenCalledWith({
        id: 'ucr-9',
        companyId: COMPANY,
        role: COMPANY_VISIBLE_ROLE,
      });
    });
  });

  describe('create', () => {
    it('rejects an input that points at another company, before touching the database', async () => {
      const { service, dataSource } = createService();

      await expect(
        service.create(COMPANY, actor, { ...input, companyId: 'company-2' }),
      ).rejects.toThrow(ForbiddenException);
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('does not assign a platform role, even knowing its id', async () => {
      const { service, roleRepo, transactionRepo } = createService();
      roleRepo.findOneBy.mockResolvedValue({ id: 'role-1', scope: RoleScope.GLOBAL });
      targetUser(transactionRepo);

      await expect(service.create(COMPANY, actor, input)).rejects.toThrow(NotFoundException);
      expect(transactionRepo.save).not.toHaveBeenCalled();
    });

    it('does not assign a role that does not exist', async () => {
      const { service, roleRepo, transactionRepo } = createService();
      roleRepo.findOneBy.mockResolvedValue(null);
      targetUser(transactionRepo);

      await expect(service.create(COMPANY, actor, input)).rejects.toThrow(NotFoundException);
      expect(transactionRepo.save).not.toHaveBeenCalled();
    });

    it('does not add a role to someone who is not part of the company', async () => {
      const { service, transactionRepo } = createService();
      targetUser(transactionRepo, { member: false });

      await expect(service.create(COMPANY, actor, input)).rejects.toThrow(NotFoundException);
      expect(transactionRepo.existsBy).toHaveBeenCalledWith({ userId: 'user-1', companyId: COMPANY });
      expect(transactionRepo.save).not.toHaveBeenCalled();
    });

    it('does not add a role to a platform user (the super admin)', async () => {
      const { service, transactionRepo } = createService();
      targetUser(transactionRepo, { platform: true });

      await expect(service.create(COMPANY, actor, input)).rejects.toThrow(NotFoundException);
      expect(transactionRepo.save).not.toHaveBeenCalled();
    });

    it('adds a role to a member of the company, inside a transaction', async () => {
      const { service, transactionRepo, dataSource } = createService();
      targetUser(transactionRepo);

      const membership = await service.create(COMPANY, actor, input);

      expect(dataSource.transaction).toHaveBeenCalled();
      expect(transactionRepo.create).toHaveBeenCalledWith(input);
      expect(membership).toMatchObject(input);
    });

    it('locks the company first, before checking anything', async () => {
      const { service, transactionRepo, roleRepo, query } = createService();
      targetUser(transactionRepo);

      await service.create(COMPANY, actor, input);

      expect(query.mock.calls[0][0]).toContain('FOR UPDATE');
      expect(query.mock.calls[0][1]).toEqual([COMPANY]);
      expect(query.mock.invocationCallOrder[0]).toBeLessThan(
        roleRepo.findOneBy.mock.invocationCallOrder[0],
      );
    });

    it('does not let someone give a role with permissions they do not have: you only give what you have', async () => {
      const { service, transactionRepo, db } = createService();
      targetUser(transactionRepo);
      // El rol también puede aprobar descuentos y quien lo da no
      db.roleCodes = [PermissionCode.SALES_CREATE, PermissionCode.SALES_APPROVE_DISCOUNT];

      const error = await service.create(COMPANY, actor, input).catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ForbiddenException);
      expect((error as ForbiddenException).message).toBe(
        'No puedes dar un rol con permisos que tú no tienes',
      );
      expect(transactionRepo.save).not.toHaveBeenCalled();
    });

    it('lets someone give a role whose permissions they all have', async () => {
      const { service, transactionRepo, db } = createService();
      targetUser(transactionRepo);
      db.roleCodes = [PermissionCode.USERS_MANAGE, PermissionCode.SALES_CREATE];

      await expect(service.create(COMPANY, actor, input)).resolves.toMatchObject(input);
    });

    it('refuses a role the user already has active', async () => {
      const { service, transactionRepo } = createService();
      targetUser(transactionRepo);
      transactionRepo.findOneBy.mockResolvedValue(stored());

      await expect(service.create(COMPANY, actor, input)).rejects.toThrow(ConflictException);
      expect(transactionRepo.findOneBy).toHaveBeenCalledWith({
        userId: 'user-1',
        companyId: COMPANY,
        roleId: 'role-1',
      });
      expect(transactionRepo.save).not.toHaveBeenCalled();
    });

    it('reactivates an assignment the user had and lost, instead of colliding with the unique index', async () => {
      const { service, transactionRepo } = createService();
      targetUser(transactionRepo);
      transactionRepo.findOneBy.mockResolvedValue(
        stored({ id: 'ucr-5', status: RecordStatus.INACTIVE }),
      );

      const membership = await service.create(COMPANY, actor, input);

      expect(transactionRepo.create).not.toHaveBeenCalled();
      expect(transactionRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'ucr-5', status: RecordStatus.ACTIVE }),
      );
      expect(membership).toMatchObject({ id: 'ucr-5', status: RecordStatus.ACTIVE });
    });

    it('answers a race on the same assignment as a conflict: the unique index stops the second one', async () => {
      const { service, transactionRepo } = createService();
      targetUser(transactionRepo);
      transactionRepo.save.mockRejectedValue(databaseError('23505'));

      const error = await service.create(COMPANY, actor, input).catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).message).toBe(
        'Este usuario ya tiene ese rol asignado en la empresa',
      );
    });

    it('answers a reference that does not exist as a bad request', async () => {
      const { service, transactionRepo } = createService();
      targetUser(transactionRepo);
      transactionRepo.save.mockRejectedValue(databaseError('23503'));

      await expect(service.create(COMPANY, actor, input)).rejects.toThrow(BadRequestException);
    });
  });

  describe('changeRole', () => {
    const KEY = 'change-role-0001';

    it('does not let anyone change their own role, before touching the database', async () => {
      const { service, dataSource } = createService();

      const error = await service
        .changeRole(COMPANY, actor, 'admin-1', 'role-1')
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ForbiddenException);
      expect((error as ForbiddenException).message).toBe('No puedes cambiar tu propio rol');
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('turns off the role the user had and gives the new one, all in one transaction', async () => {
      const { service, transactionRepo, dataSource } = createService();
      targetUser(transactionRepo);
      const previous = stored({ id: 'ucr-old', roleId: 'role-old' });
      transactionRepo.find.mockResolvedValue([previous]);

      const result = await service.changeRole(COMPANY, actor, 'user-1', 'role-1');

      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
      expect(previous.status).toBe(RecordStatus.INACTIVE);
      expect(transactionRepo.save).toHaveBeenCalledWith(previous);
      expect(transactionRepo.create).toHaveBeenCalledWith({
        userId: 'user-1',
        companyId: COMPANY,
        roleId: 'role-1',
      });
      expect(result).toMatchObject({ userId: 'user-1', roleId: 'role-1' });
    });

    it('creates the assignment when the user had no role in the company yet', async () => {
      const { service, transactionRepo } = createService();
      targetUser(transactionRepo);
      transactionRepo.find.mockResolvedValue([]);

      const result = await service.changeRole(COMPANY, actor, 'user-1', 'role-1');

      expect(transactionRepo.save).toHaveBeenCalledTimes(1);
      expect(result).toMatchObject({ userId: 'user-1', companyId: COMPANY, roleId: 'role-1' });
    });

    it('reactivates a role the user had before, instead of colliding with the unique index', async () => {
      const { service, transactionRepo } = createService();
      targetUser(transactionRepo);
      const current = stored({ id: 'ucr-b', roleId: 'role-2' });
      const before = stored({ id: 'ucr-a', roleId: 'role-1', status: RecordStatus.INACTIVE });
      transactionRepo.find.mockResolvedValue([current, before]);

      const result = await service.changeRole(COMPANY, actor, 'user-1', 'role-1');

      expect(current.status).toBe(RecordStatus.INACTIVE);
      expect(transactionRepo.create).not.toHaveBeenCalled();
      expect(result).toMatchObject({ id: 'ucr-a', roleId: 'role-1', status: RecordStatus.ACTIVE });
    });

    it('changes nothing when the user already has that role and no other', async () => {
      const { service, transactionRepo } = createService();
      targetUser(transactionRepo);
      const current = stored({ id: 'ucr-a', roleId: 'role-1' });
      transactionRepo.find.mockResolvedValue([current]);

      const result = await service.changeRole(COMPANY, actor, 'user-1', 'role-1');

      expect(result).toBe(current);
      expect(transactionRepo.save).not.toHaveBeenCalled();
      expect(transactionRepo.create).not.toHaveBeenCalled();
    });

    it('turns off every other active role, not just one', async () => {
      const { service, transactionRepo } = createService();
      targetUser(transactionRepo);
      const first = stored({ id: 'ucr-a', roleId: 'role-2' });
      const second = stored({ id: 'ucr-b', roleId: 'role-3' });
      transactionRepo.find.mockResolvedValue([first, second]);

      await service.changeRole(COMPANY, actor, 'user-1', 'role-1');

      expect(first.status).toBe(RecordStatus.INACTIVE);
      expect(second.status).toBe(RecordStatus.INACTIVE);
    });

    it('reads the assignments of the user without platform roles, and then locks them by id', async () => {
      const { service, transactionRepo } = createService();
      targetUser(transactionRepo);
      transactionRepo.find.mockResolvedValue([stored({ id: 'ucr-a', roleId: 'role-1' })]);

      await service.changeRole(COMPANY, actor, 'user-1', 'role-1');

      expect(transactionRepo.find).toHaveBeenNthCalledWith(1, {
        where: { userId: 'user-1', companyId: COMPANY, role: COMPANY_VISIBLE_ROLE },
      });
      expect(transactionRepo.find).toHaveBeenNthCalledWith(2, {
        where: { id: In(['ucr-a']) },
        lock: { mode: 'pessimistic_write' },
      });
    });

    it('does not lock anything by id when the user has no assignments', async () => {
      const { service, transactionRepo } = createService();
      targetUser(transactionRepo);

      await service.changeRole(COMPANY, actor, 'user-1', 'role-1');

      expect(transactionRepo.find).toHaveBeenCalledTimes(1);
    });

    it('locks the company first and counts the administrators before and after the change', async () => {
      const { service, transactionRepo, query } = createService();
      targetUser(transactionRepo);

      await service.changeRole(COMPANY, actor, 'user-1', 'role-1');

      const statements = query.mock.calls.map(([sql]) => sql);
      expect(statements[0]).toContain('FOR UPDATE');
      expect(statements[1]).toContain('COUNT(DISTINCT');
      expect(statements[statements.length - 1]).toContain('COUNT(DISTINCT');
      expect(statements.filter((sql) => sql.includes('COUNT(DISTINCT'))).toHaveLength(2);
    });

    it('refuses a change that leaves the company without an administrator', async () => {
      const { service, transactionRepo, db } = createService();
      targetUser(transactionRepo);
      transactionRepo.find.mockResolvedValue([stored({ id: 'ucr-old', roleId: 'role-old' })]);
      // Había un administrador y, con este cambio, ninguno
      db.adminCounts = [1, 0];

      const error = await service
        .changeRole(COMPANY, actor, 'user-1', 'role-1')
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).message).toBe(LAST_ADMIN_MESSAGE);
    });

    it('lets the change through when another administrator is left', async () => {
      const { service, transactionRepo, db } = createService();
      targetUser(transactionRepo);
      db.adminCounts = [2, 1];

      await expect(service.changeRole(COMPANY, actor, 'user-1', 'role-1')).resolves.toMatchObject({
        roleId: 'role-1',
      });
    });

    it('does not assign a platform role, even knowing its id', async () => {
      const { service, roleRepo, transactionRepo } = createService();
      targetUser(transactionRepo);
      roleRepo.findOneBy.mockResolvedValue({ id: 'role-1', scope: RoleScope.GLOBAL });

      await expect(service.changeRole(COMPANY, actor, 'user-1', 'role-1')).rejects.toThrow(
        NotFoundException,
      );
      expect(transactionRepo.save).not.toHaveBeenCalled();
    });

    it('does not assign a role that does not exist', async () => {
      const { service, roleRepo, transactionRepo } = createService();
      targetUser(transactionRepo);
      roleRepo.findOneBy.mockResolvedValue(null);

      await expect(service.changeRole(COMPANY, actor, 'user-1', 'role-9')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('does not change the role of someone who is not part of the company', async () => {
      const { service, transactionRepo } = createService();
      targetUser(transactionRepo, { member: false });

      await expect(service.changeRole(COMPANY, actor, 'user-9', 'role-1')).rejects.toThrow(
        NotFoundException,
      );
      expect(transactionRepo.save).not.toHaveBeenCalled();
    });

    it('does not change the role of a platform user (the super admin)', async () => {
      const { service, transactionRepo } = createService();
      targetUser(transactionRepo, { platform: true });

      await expect(service.changeRole(COMPANY, actor, 'super', 'role-1')).rejects.toThrow(
        NotFoundException,
      );
      expect(transactionRepo.save).not.toHaveBeenCalled();
    });

    it('does not let someone assign a role with permissions they do not have', async () => {
      const { service, transactionRepo, db } = createService();
      targetUser(transactionRepo);
      db.roleCodes = [PermissionCode.SETTINGS_MANAGE];

      const error = await service
        .changeRole(COMPANY, actor, 'user-1', 'role-1')
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ForbiddenException);
      expect((error as ForbiddenException).message).toBe(
        'No puedes dar un rol con permisos que tú no tienes',
      );
      expect(transactionRepo.save).not.toHaveBeenCalled();
    });

    it('does not let someone change the role of a person who has more permissions than theirs', async () => {
      const { service, transactionRepo, db } = createService();
      targetUser(transactionRepo);
      // El usuario al que se le cambia el rol puede administrar la configuración y quien lo cambia no
      db.userCodes = [PermissionCode.SALES_CREATE, PermissionCode.SETTINGS_MANAGE];

      const error = await service
        .changeRole(COMPANY, actor, 'user-1', 'role-1')
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ForbiddenException);
      expect((error as ForbiddenException).message).toBe(
        'No puedes modificar a alguien con más permisos que tú',
      );
      expect(transactionRepo.save).not.toHaveBeenCalled();
    });

    it('answers a race on the same assignment as a conflict', async () => {
      const { service, transactionRepo } = createService();
      targetUser(transactionRepo);
      transactionRepo.save.mockRejectedValue(databaseError('23505'));

      await expect(service.changeRole(COMPANY, actor, 'user-1', 'role-1')).rejects.toThrow(
        ConflictException,
      );
    });

    it('does not touch the idempotency table when the request carries no key', async () => {
      const { service, transactionRepo, query, keyRepo } = createService();
      targetUser(transactionRepo);

      await service.changeRole(COMPANY, actor, 'user-1', 'role-1');

      expect(query.mock.calls.some(([sql]) => sql.includes('idempotency_keys'))).toBe(false);
      expect(keyRepo.findOneBy).not.toHaveBeenCalled();
    });

    describe('with an idempotency key', () => {
      it('claims the key inside the same transaction and links it to the assignment', async () => {
        const { service, transactionRepo, query, dataSource } = createService();
        targetUser(transactionRepo);

        const result = await service.changeRole(COMPANY, actor, 'user-1', 'role-1', KEY);

        expect(dataSource.transaction).toHaveBeenCalledTimes(1);
        expect(query).toHaveBeenCalledWith(
          expect.stringContaining('INSERT INTO "idempotency_keys"'),
          [
            COMPANY,
            'admin-1',
            'changeUserRole',
            KEY,
            fingerprintOf({ userId: 'user-1', roleId: 'role-1' }),
          ],
        );
        expect(query).toHaveBeenCalledWith(expect.stringContaining('UPDATE "idempotency_keys"'), [
          'claim-1',
          'user_company_role',
          result.id,
        ]);
      });

      it('answers a retry with the assignment that was already made, without changing anything again', async () => {
        const { service, transactionRepo, keyRepo, query, db } = createService();
        targetUser(transactionRepo);
        db.claim = []; // la clave ya estaba reclamada
        keyRepo.findOneBy.mockResolvedValue({
          resourceId: 'ucr-9',
          fingerprint: fingerprintOf({ userId: 'user-1', roleId: 'role-1' }),
        });
        transactionRepo.findOneByOrFail.mockResolvedValue(stored({ id: 'ucr-9' }));

        const result = await service.changeRole(COMPANY, actor, 'user-1', 'role-1', KEY);

        expect(result).toMatchObject({ id: 'ucr-9', roleId: 'role-1' });
        expect(transactionRepo.findOneByOrFail).toHaveBeenCalledWith({ id: 'ucr-9' });
        expect(transactionRepo.save).not.toHaveBeenCalled();
        // Solo el intento de reclamar la clave: ni se bloqueó la empresa ni se contó nada
        expect(query).toHaveBeenCalledTimes(1);
      });

      it('rejects the same key for another user or another role, without changing anything', async () => {
        const { service, transactionRepo, keyRepo, db } = createService();
        targetUser(transactionRepo);
        db.claim = [];
        keyRepo.findOneBy.mockResolvedValue({
          resourceId: 'ucr-9',
          fingerprint: fingerprintOf({ userId: 'user-1', roleId: 'role-1' }),
        });

        const error = await service
          .changeRole(COMPANY, actor, 'user-2', 'role-1', KEY)
          .catch((caught: unknown) => caught);

        expect(error).toBeInstanceOf(ConflictException);
        expect((error as ConflictException).message).toContain('otros datos');
        expect(transactionRepo.save).not.toHaveBeenCalled();
      });
    });
  });

  describe('deactivate', () => {
    // La asignación se lee fuera de la transacción (para comprobar que es de la empresa) y otra vez, con
    // bloqueo, dentro de ella
    function withMembership(
      ctx: ReturnType<typeof createService>,
      overrides: Record<string, unknown> = {},
    ) {
      const membership = stored(overrides);
      ctx.repo.findOneBy.mockResolvedValue(membership);
      ctx.transactionRepo.findOne.mockResolvedValue(membership);
      return membership;
    }

    it('deactivates a membership of the company', async () => {
      const ctx = createService();
      withMembership(ctx);

      const result = await ctx.service.deactivate(COMPANY, actor, 'ucr-1');

      expect(ctx.dataSource.transaction).toHaveBeenCalled();
      expect(result.status).toBe(RecordStatus.INACTIVE);
    });

    it('cannot reach a membership of another company, or a platform one, by id', async () => {
      const { service, repo, dataSource } = createService();
      repo.findOneBy.mockResolvedValue(null);

      await expect(service.deactivate(COMPANY, actor, 'ucr-9')).rejects.toThrow(NotFoundException);
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('rereads the membership under a lock inside the transaction, instead of saving the one read before', async () => {
      const ctx = createService();
      withMembership(ctx);

      await ctx.service.deactivate(COMPANY, actor, 'ucr-1');

      expect(ctx.transactionRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'ucr-1' },
        lock: { mode: 'pessimistic_write' },
      });
    });

    it('answers "not found" when the membership disappears or moves to another company before it is locked', async () => {
      const ctx = createService();
      withMembership(ctx);
      ctx.transactionRepo.findOne.mockResolvedValue(null);

      await expect(ctx.service.deactivate(COMPANY, actor, 'ucr-1')).rejects.toThrow(
        NotFoundException,
      );

      ctx.transactionRepo.findOne.mockResolvedValue(stored({ companyId: 'company-2' }));

      await expect(ctx.service.deactivate(COMPANY, actor, 'ucr-1')).rejects.toThrow(
        NotFoundException,
      );
      expect(ctx.transactionRepo.save).not.toHaveBeenCalled();
    });

    it('locks the company before counting the administrators and before reading the membership', async () => {
      const ctx = createService();
      withMembership(ctx);

      await ctx.service.deactivate(COMPANY, actor, 'ucr-1');

      expect(ctx.query.mock.calls[0][0]).toContain('FOR UPDATE');
      expect(ctx.query.mock.calls[1][0]).toContain('COUNT(DISTINCT');
      expect(ctx.query.mock.invocationCallOrder[1]).toBeLessThan(
        ctx.transactionRepo.findOne.mock.invocationCallOrder[0],
      );
    });

    it('does not let anyone take away their own role', async () => {
      const ctx = createService();
      withMembership(ctx, { userId: 'admin-1' });

      const error = await ctx.service
        .deactivate(COMPANY, actor, 'ucr-1')
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ForbiddenException);
      expect((error as ForbiddenException).message).toBe('No puedes quitarte tu propio rol');
      expect(ctx.transactionRepo.save).not.toHaveBeenCalled();
    });

    it('does not let someone take the role away from a person who has more permissions than theirs', async () => {
      const ctx = createService();
      withMembership(ctx);
      ctx.db.userCodes = [PermissionCode.SALES_CREATE, PermissionCode.SETTINGS_MANAGE];

      const error = await ctx.service
        .deactivate(COMPANY, actor, 'ucr-1')
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ForbiddenException);
      expect((error as ForbiddenException).message).toBe(
        'No puedes modificar a alguien con más permisos que tú',
      );
      expect(ctx.transactionRepo.save).not.toHaveBeenCalled();
    });

    it('refuses to take away the role of the last administrator of the company', async () => {
      const ctx = createService();
      withMembership(ctx);
      // Había un administrador y, con este cambio, ninguno
      ctx.db.adminCounts = [1, 0];

      const error = await ctx.service
        .deactivate(COMPANY, actor, 'ucr-1')
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).message).toBe(LAST_ADMIN_MESSAGE);
    });

    it('lets the role go when another administrator is left', async () => {
      const ctx = createService();
      withMembership(ctx);
      ctx.db.adminCounts = [2, 1];

      const result = await ctx.service.deactivate(COMPANY, actor, 'ucr-1');

      expect(result.status).toBe(RecordStatus.INACTIVE);
    });
  });
});
