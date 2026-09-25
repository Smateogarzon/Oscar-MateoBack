import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import bcrypt from 'bcryptjs';
import { In, QueryFailedError } from 'typeorm';
import type { AccessActor } from '../../common/access/access-actor.js';
import { LAST_ADMIN_MESSAGE } from '../../common/access/company-admins.js';
import { PLATFORM_ROLE } from '../../common/access/platform-role.js';
import { PermissionCode } from '../../common/enums/permission-code.enum.js';
import { RecordStatus } from '../../common/enums/record-status.enum.js';
import { CashSessionStatus } from '../cash-session/entities/cash-session-status.enum.js';
import { CashSession } from '../cash-session/entities/cash-session.entity.js';
import { IdempotencyKey } from '../idempotency/entities/idempotency-key.entity.js';
import { fingerprintOf } from '../idempotency/idempotency.js';
import { RoleScope } from '../role/entities/role-scope.enum.js';
import { Role } from '../role/entities/role.entity.js';
import { UserCompanyRole } from '../user-company-role/entities/user-company-role.entity.js';
import { UserService } from './user.service.js';

// Lo que responde la base a las consultas SQL sueltas: el bloqueo de la empresa, el conteo de
// administradores, los permisos de un rol o de un usuario y la clave de idempotencia. Se decide por lo que
// pregunta cada consulta, no por el orden en que llegan.
interface SqlAnswers {
  // Permisos del rol que se asigna
  roleCodes: string[];
  // Permisos del usuario al que se toca
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
  const repo = {
    find: vi.fn(),
    findOneBy: vi.fn(),
  };
  // Membresías consultadas fuera de una transacción (¿es de esta empresa? ¿trabaja en otra?
  // ¿es un usuario de plataforma?)
  const membershipRepo = {
    find: vi.fn(),
    existsBy: vi.fn(),
  };
  // El usuario que se lee YA bloqueado dentro de la transacción. Por defecto es el mismo que
  // devuelve `repo.findOneBy` (lo que cada prueba prepara), a menos que una prueba diga que en el
  // ínterin cambió (`transactionRepo.findOne.mockResolvedValue(...)`).
  const transactionRepo = {
    findOne: vi.fn(async () => repo.findOneBy({})),
    findOneBy: vi.fn(),
    findOneByOrFail: vi.fn(),
    // ¿ya hay alguien con ese número de documento? Por defecto, nadie.
    existsBy: vi.fn().mockResolvedValue(false),
    create: vi.fn((data: object) => data),
    save: vi.fn(async (user: object) => ({ id: 'new-id', ...user })),
  };
  const transactionMembershipRepo = {
    create: vi.fn((data: object) => data),
    save: vi.fn(async (membership: object) => membership),
  };
  // El rol con el que se crea el usuario: por defecto, uno de empresa.
  const transactionRoleRepo = {
    findOneBy: vi.fn().mockResolvedValue({ id: 'role-1', scope: RoleScope.COMPANY }),
  };
  // ¿tiene el usuario un turno de caja abierto? Por defecto, no.
  const cashSessionRepo = { existsBy: vi.fn().mockResolvedValue(false) };
  // La clave de idempotencia que ya hubiera guardada. Por defecto, ninguna.
  const keyRepo = { findOneBy: vi.fn().mockResolvedValue(null) };

  const db: SqlAnswers = {
    roleCodes: [PermissionCode.SALES_CREATE],
    userCodes: [PermissionCode.SALES_CREATE],
    adminCounts: [],
    claim: [{ id: 'claim-1' }],
  };
  // Dentro de la transacción y fuera de ella (las comprobaciones de quién puede tocar la cuenta van fuera)
  const query = vi.fn(sqlAnswering(db));
  const outsideQuery = vi.fn(sqlAnswering(db));

  const dataSource = {
    manager: { query: outsideQuery },
    getRepository: vi.fn((entity: unknown) =>
      entity === UserCompanyRole ? membershipRepo : undefined,
    ),
    transaction: vi.fn(async (fn: (manager: unknown) => unknown) =>
      fn({
        query,
        getRepository: (entity: unknown) =>
          entity === UserCompanyRole
            ? transactionMembershipRepo
            : entity === Role
              ? transactionRoleRepo
              : entity === CashSession
                ? cashSessionRepo
                : entity === IdempotencyKey
                  ? keyRepo
                  : transactionRepo,
      }),
    ),
  };
  const service = new UserService(repo as never, dataSource as never);
  return {
    service,
    repo,
    membershipRepo,
    transactionRepo,
    transactionMembershipRepo,
    transactionRoleRepo,
    cashSessionRepo,
    keyRepo,
    db,
    query,
    outsideQuery,
    dataSource,
  };
}

const COMPANY = 'company-1';

// Quien hace el cambio: administra usuarios y configuración, y además tiene el permiso de vender (así puede
// dar y tocar cuentas con ese permiso, pero no otros)
const actor: AccessActor = {
  userId: 'admin-1',
  permissionCodes: [
    PermissionCode.USERS_MANAGE,
    PermissionCode.SETTINGS_MANAGE,
    PermissionCode.SALES_CREATE,
  ],
};

const input = {
  firstName: 'Ana',
  lastName: 'Gómez',
  email: 'ana@example.com',
  documentNumber: '123456789',
  roleId: 'role-1',
};

// El error de la base de datos por violar un índice único, como lo entrega el driver de Postgres.
const uniqueViolation = () =>
  new QueryFailedError('INSERT', [], Object.assign(new Error('duplicate key'), { code: '23505' }));

type MembershipRepo = ReturnType<typeof createService>['membershipRepo'];

// Qué responde la base a las consultas de membresía sobre un usuario. Se decide por lo que
// pregunta cada consulta, no por el orden en que llegan.
function membership(
  membershipRepo: MembershipRepo,
  { member = true, platform = false, elsewhere = false } = {},
) {
  membershipRepo.existsBy.mockImplementation(async (where: Record<string, unknown>) => {
    if (where.role) return platform; // ¿tiene un rol de plataforma?
    if (where.status) return elsewhere; // ¿trabaja activamente en otra empresa?
    return member; // ¿es de esta empresa?
  });
}

// Membresías de la empresa y, entre esos usuarios, las de plataforma.
function companyMembers(
  membershipRepo: MembershipRepo,
  { members, platform = [] }: { members: string[]; platform?: string[] },
) {
  membershipRepo.find.mockImplementation(async ({ where }: { where: Record<string, unknown> }) =>
    (where.role ? platform : members).map((userId) => ({ userId })),
  );
}

describe('UserService', () => {
  describe('findAll', () => {
    it('lists only the users that have a membership in the company', async () => {
      const { service, repo, membershipRepo } = createService();
      companyMembers(membershipRepo, { members: ['u1', 'u1', 'u2'] });
      repo.find.mockResolvedValue([{ id: 'u1' }, { id: 'u2' }]);

      const users = await service.findAll(COMPANY);

      expect(membershipRepo.find).toHaveBeenCalledWith({ where: { companyId: COMPANY } });
      expect(repo.find).toHaveBeenCalledWith({ where: { id: In(['u1', 'u2']) } });
      expect(users).toHaveLength(2);
    });

    it('leaves out platform users (the super admin): no company sees them', async () => {
      const { service, repo, membershipRepo } = createService();
      companyMembers(membershipRepo, { members: ['u1', 'u2'], platform: ['u2'] });
      repo.find.mockResolvedValue([{ id: 'u1' }]);

      await service.findAll(COMPANY);

      expect(membershipRepo.find).toHaveBeenCalledWith({
        where: { userId: In(['u1', 'u2']), role: PLATFORM_ROLE },
      });
      expect(repo.find).toHaveBeenCalledWith({ where: { id: In(['u1']) } });
    });

    it('returns nothing when the only member is a platform user', async () => {
      const { service, repo, membershipRepo } = createService();
      companyMembers(membershipRepo, { members: ['u2'], platform: ['u2'] });

      await expect(service.findAll(COMPANY)).resolves.toEqual([]);
      expect(repo.find).not.toHaveBeenCalled();
    });

    it('can narrow the list down by status', async () => {
      const { service, repo, membershipRepo } = createService();
      companyMembers(membershipRepo, { members: ['u1'] });
      repo.find.mockResolvedValue([]);

      await service.findAll(COMPANY, RecordStatus.ACTIVE);

      expect(repo.find).toHaveBeenCalledWith({
        where: { id: In(['u1']), status: RecordStatus.ACTIVE },
      });
    });

    it('returns nothing, without looking up users, when nobody belongs to the company', async () => {
      const { service, repo, membershipRepo } = createService();
      companyMembers(membershipRepo, { members: [] });

      await expect(service.findAll(COMPANY)).resolves.toEqual([]);
      expect(repo.find).not.toHaveBeenCalled();
    });
  });

  describe('findInCompany', () => {
    it('answers a user of another company as if it did not exist', async () => {
      const { service, repo, membershipRepo } = createService();
      membership(membershipRepo, { member: false });

      await expect(service.findInCompany(COMPANY, 'u9')).rejects.toThrow(NotFoundException);
      expect(membershipRepo.existsBy).toHaveBeenCalledWith({ userId: 'u9', companyId: COMPANY });
      expect(repo.findOneBy).not.toHaveBeenCalled();
    });

    it('answers a platform user (the super admin) as if it did not exist', async () => {
      const { service, repo, membershipRepo } = createService();
      membership(membershipRepo, { member: true, platform: true });

      await expect(service.findInCompany(COMPANY, 'super')).rejects.toThrow(NotFoundException);
      expect(repo.findOneBy).not.toHaveBeenCalled();
    });

    it('returns a member of the company', async () => {
      const { service, repo, membershipRepo } = createService();
      membership(membershipRepo);
      repo.findOneBy.mockResolvedValue({ id: 'u1' });

      await expect(service.findInCompany(COMPANY, 'u1')).resolves.toEqual({ id: 'u1' });
    });
  });

  describe('findByEmail', () => {
    it('looks the email up in lowercase and without spaces: it is the same person however it is typed', async () => {
      const { service, repo } = createService();
      repo.findOneBy.mockResolvedValue({ id: 'u1' });

      await expect(service.findByEmail('  Ana.Gomez@Example.COM ')).resolves.toEqual({ id: 'u1' });
      expect(repo.findOneBy).toHaveBeenCalledWith({ email: 'ana.gomez@example.com' });
    });

    it('answers null when nobody has that email', async () => {
      const { service, repo } = createService();
      repo.findOneBy.mockResolvedValue(null);

      await expect(service.findByEmail('nadie@example.com')).resolves.toBeNull();
    });
  });

  describe('create', () => {
    it('hashes documentNumber as the initial password', async () => {
      const { service, transactionRepo } = createService();
      transactionRepo.findOneBy.mockResolvedValue(null);

      const user = await service.create(COMPANY, actor, input);

      const created = transactionRepo.create.mock.calls[0][0] as Record<string, any>;
      expect(created.mustChangePassword).toBe(true);
      expect(created.passwordHash).not.toBe(input.documentNumber);
      expect(await bcrypt.compare(input.documentNumber, created.passwordHash)).toBe(true);
      expect(created).not.toHaveProperty('roleId');
      expect(user.id).toBe('new-id');
    });

    it('saves the email in lowercase and without spaces, and the document without spaces', async () => {
      const { service, transactionRepo } = createService();
      transactionRepo.findOneBy.mockResolvedValue(null);

      await service.create(COMPANY, actor, {
        ...input,
        email: '  Ana.Gomez@Example.COM ',
        documentNumber: ' 123456789 ',
      });

      // Con el correo normalizado también se busca el repetido, y con el documento sin espacios
      expect(transactionRepo.findOneBy).toHaveBeenCalledWith({ email: 'ana.gomez@example.com' });
      expect(transactionRepo.existsBy).toHaveBeenCalledWith({ documentNumber: '123456789' });
      const created = transactionRepo.create.mock.calls[0][0] as Record<string, any>;
      expect(created.email).toBe('ana.gomez@example.com');
      expect(created.documentNumber).toBe('123456789');
      // La contraseña inicial es el documento ya recortado
      expect(await bcrypt.compare('123456789', created.passwordHash)).toBe(true);
    });

    it('adds the new user to the company with the chosen role, in the same transaction', async () => {
      const { service, transactionRepo, transactionMembershipRepo, dataSource } = createService();
      transactionRepo.findOneBy.mockResolvedValue(null);

      await service.create(COMPANY, actor, input);

      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
      expect(transactionMembershipRepo.create).toHaveBeenCalledWith({
        userId: 'new-id',
        companyId: COMPANY,
        roleId: 'role-1',
      });
      expect(transactionMembershipRepo.save).toHaveBeenCalledTimes(1);
    });

    it('throws when the email is already registered, without adding anyone to the company', async () => {
      const { service, transactionRepo, transactionMembershipRepo } = createService();
      transactionRepo.findOneBy.mockResolvedValue({ id: 'existing' });

      await expect(service.create(COMPANY, actor, input)).rejects.toThrow(ConflictException);
      expect(transactionRepo.save).not.toHaveBeenCalled();
      expect(transactionMembershipRepo.save).not.toHaveBeenCalled();
    });

    it('treats an email that only differs in capital letters as the one that is already registered', async () => {
      const { service, transactionRepo } = createService();
      transactionRepo.findOneBy.mockImplementation(async ({ email }: { email: string }) =>
        email === 'ana@example.com' ? { id: 'existing' } : null,
      );

      await expect(
        service.create(COMPANY, actor, { ...input, email: 'ANA@Example.com' }),
      ).rejects.toThrow(ConflictException);
    });

    it('throws when the document number is already registered: it would be the same initial password', async () => {
      const { service, transactionRepo, transactionMembershipRepo } = createService();
      transactionRepo.findOneBy.mockResolvedValue(null);
      transactionRepo.existsBy.mockResolvedValue(true);

      await expect(service.create(COMPANY, actor, input)).rejects.toThrow(
        'Ya existe un usuario con ese número de documento',
      );
      expect(transactionRepo.existsBy).toHaveBeenCalledWith({ documentNumber: '123456789' });
      expect(transactionRepo.save).not.toHaveBeenCalled();
      expect(transactionMembershipRepo.save).not.toHaveBeenCalled();
    });

    it('answers a race on the email as a conflict too: the unique index stops the second one', async () => {
      const { service, transactionRepo } = createService();
      transactionRepo.findOneBy.mockResolvedValue(null);
      transactionRepo.save.mockRejectedValue(uniqueViolation());

      const error = await service
        .create(COMPANY, actor, input)
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).message).toBe(
        'Ya existe un usuario con el email ana@example.com',
      );
    });

    it('lets any other database failure through as it is', async () => {
      const { service, transactionRepo } = createService();
      transactionRepo.findOneBy.mockResolvedValue(null);
      const failure = new Error('conexión perdida');
      transactionRepo.save.mockRejectedValue(failure);

      await expect(service.create(COMPANY, actor, input)).rejects.toBe(failure);
    });

    it('reports an unknown role as a bad request, without creating the user', async () => {
      const { service, transactionRepo, transactionRoleRepo } = createService();
      transactionRoleRepo.findOneBy.mockResolvedValue(null);

      await expect(service.create(COMPANY, actor, input)).rejects.toThrow(BadRequestException);
      expect(transactionRepo.save).not.toHaveBeenCalled();
    });

    it('does not let a company assign a platform role, even knowing its id', async () => {
      const { service, transactionRepo, transactionMembershipRepo, transactionRoleRepo } =
        createService();
      transactionRoleRepo.findOneBy.mockResolvedValue({ id: 'role-1', scope: RoleScope.GLOBAL });

      await expect(service.create(COMPANY, actor, input)).rejects.toThrow(BadRequestException);
      expect(transactionRepo.save).not.toHaveBeenCalled();
      expect(transactionMembershipRepo.save).not.toHaveBeenCalled();
    });

    it('does not let someone give a role with permissions they do not have: you only give what you have', async () => {
      const { service, transactionRepo, transactionMembershipRepo, db } = createService();
      // El rol elegido puede aprobar descuentos y quien lo da no
      db.roleCodes = [PermissionCode.SALES_CREATE, PermissionCode.SALES_APPROVE_DISCOUNT];

      const error = await service
        .create(COMPANY, actor, input)
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ForbiddenException);
      expect((error as ForbiddenException).message).toBe(
        'No puedes dar un rol con permisos que tú no tienes',
      );
      expect(transactionRepo.save).not.toHaveBeenCalled();
      expect(transactionMembershipRepo.save).not.toHaveBeenCalled();
    });

    it('lets someone give a role whose permissions they all have', async () => {
      const { service, transactionRepo, db } = createService();
      transactionRepo.findOneBy.mockResolvedValue(null);
      db.roleCodes = [PermissionCode.SALES_CREATE, PermissionCode.USERS_MANAGE];

      await expect(service.create(COMPANY, actor, input)).resolves.toMatchObject({ id: 'new-id' });
    });

    it('reads the permissions of the chosen role in the company that is creating the user', async () => {
      const { service, transactionRepo, query } = createService();
      transactionRepo.findOneBy.mockResolvedValue(null);

      await service.create(COMPANY, actor, input);

      const roleQuery = query.mock.calls.find(([sql]) => sql.includes('SELECT p."code"'));
      expect(roleQuery?.[1]).toEqual([COMPANY, 'role-1']);
    });

    describe('with an idempotency key', () => {
      const KEY = 'create-user-0001';

      it('claims the key in the same transaction and links it to the new user', async () => {
        const { service, transactionRepo, query, dataSource } = createService();
        transactionRepo.findOneBy.mockResolvedValue(null);

        const user = await service.create(COMPANY, actor, input, KEY);

        expect(dataSource.transaction).toHaveBeenCalledTimes(1);
        expect(query).toHaveBeenCalledWith(
          expect.stringContaining('INSERT INTO "idempotency_keys"'),
          [COMPANY, 'admin-1', 'createUser', KEY, fingerprintOf(input)],
        );
        expect(query).toHaveBeenCalledWith(expect.stringContaining('UPDATE "idempotency_keys"'), [
          'claim-1',
          'user',
          user.id,
        ]);
      });

      it('answers a retry with the user that was already created, instead of failing with "already exists"', async () => {
        const { service, transactionRepo, transactionMembershipRepo, keyRepo, db } =
          createService();
        db.claim = []; // la clave ya estaba reclamada
        keyRepo.findOneBy.mockResolvedValue({
          resourceId: 'user-9',
          fingerprint: fingerprintOf(input),
        });
        transactionRepo.findOneByOrFail.mockResolvedValue({ id: 'user-9', email: input.email });

        const user = await service.create(COMPANY, actor, input, KEY);

        expect(user).toEqual({ id: 'user-9', email: input.email });
        expect(transactionRepo.findOneByOrFail).toHaveBeenCalledWith({ id: 'user-9' });
        expect(transactionRepo.save).not.toHaveBeenCalled();
        expect(transactionMembershipRepo.save).not.toHaveBeenCalled();
      });

      it('rejects the same key with other data, without creating anything', async () => {
        const { service, transactionRepo, transactionMembershipRepo, keyRepo, db } =
          createService();
        db.claim = [];
        keyRepo.findOneBy.mockResolvedValue({
          resourceId: 'user-9',
          fingerprint: fingerprintOf(input),
        });

        const error = await service
          .create(COMPANY, actor, { ...input, email: 'otra@example.com' }, KEY)
          .catch((caught: unknown) => caught);

        expect(error).toBeInstanceOf(ConflictException);
        expect((error as ConflictException).message).toContain('otros datos');
        expect(transactionRepo.save).not.toHaveBeenCalled();
        expect(transactionMembershipRepo.save).not.toHaveBeenCalled();
      });

      it('does not touch the idempotency table when the request carries no key', async () => {
        const { service, transactionRepo, query, keyRepo } = createService();
        transactionRepo.findOneBy.mockResolvedValue(null);

        await service.create(COMPANY, actor, input);

        expect(query.mock.calls.some(([sql]) => sql.includes('idempotency_keys'))).toBe(false);
        expect(keyRepo.findOneBy).not.toHaveBeenCalled();
      });
    });
  });

  describe('update', () => {
    it('applies changes inside a transaction', async () => {
      const { service, repo, membershipRepo, dataSource } = createService();
      membership(membershipRepo);
      repo.findOneBy.mockResolvedValue({ id: '1', firstName: 'Ana' });

      const result = await service.update(COMPANY, actor, '1', { firstName: 'Ana María' });

      expect(dataSource.transaction).toHaveBeenCalled();
      expect(result.firstName).toBe('Ana María');
    });

    it('changes the row it reads under the lock, so it does not undo what somebody else changed meanwhile', async () => {
      const { service, repo, membershipRepo, transactionRepo } = createService();
      membership(membershipRepo);
      // Lo que se leyó al comprobar permisos, y lo que hay cuando la cuenta ya está bloqueada:
      // mientras tanto otro administrador le restableció la contraseña.
      repo.findOneBy.mockResolvedValue({
        id: '1',
        firstName: 'Ana',
        passwordHash: 'vieja',
        mustChangePassword: false,
      });
      transactionRepo.findOne.mockResolvedValue({
        id: '1',
        firstName: 'Ana',
        passwordHash: 'restablecida',
        mustChangePassword: true,
      });

      const result = await service.update(COMPANY, actor, '1', { firstName: 'Ana María' });

      expect(transactionRepo.findOne).toHaveBeenCalledWith({
        where: { id: '1' },
        lock: { mode: 'pessimistic_write' },
      });
      expect(transactionRepo.save).toHaveBeenCalledWith({
        id: '1',
        firstName: 'Ana María',
        passwordHash: 'restablecida',
        mustChangePassword: true,
      });
      expect(result.passwordHash).toBe('restablecida');
    });

    it('answers "not found" when the account disappears before it can be locked', async () => {
      const { service, repo, membershipRepo, transactionRepo } = createService();
      membership(membershipRepo);
      repo.findOneBy.mockResolvedValue({ id: '1', firstName: 'Ana' });
      transactionRepo.findOne.mockResolvedValue(null);

      await expect(service.update(COMPANY, actor, '1', { firstName: 'X' })).rejects.toThrow(
        NotFoundException,
      );
      expect(transactionRepo.save).not.toHaveBeenCalled();
    });

    it('throws when the user is not a member of the company', async () => {
      const { service, membershipRepo, dataSource } = createService();
      membership(membershipRepo, { member: false });

      await expect(service.update(COMPANY, actor, 'missing', { firstName: 'X' })).rejects.toThrow(
        NotFoundException,
      );
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('cannot change a platform user (the super admin)', async () => {
      const { service, membershipRepo, dataSource } = createService();
      membership(membershipRepo, { platform: true });

      await expect(service.update(COMPANY, actor, 'super', { firstName: 'X' })).rejects.toThrow(
        NotFoundException,
      );
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('refuses to change a user who also works in another company', async () => {
      const { service, repo, membershipRepo, dataSource } = createService();
      membership(membershipRepo, { elsewhere: true });
      repo.findOneBy.mockResolvedValue({ id: '1', firstName: 'Ana' });

      await expect(service.update(COMPANY, actor, '1', { firstName: 'X' })).rejects.toThrow(
        ForbiddenException,
      );
      expect(dataSource.transaction).not.toHaveBeenCalled();
      // Solo cuentan las membresías activas: una revocada en otra empresa ya no la protege.
      expect(membershipRepo.existsBy).toHaveBeenCalledWith(
        expect.objectContaining({ userId: '1', status: RecordStatus.ACTIVE }),
      );
    });

    it('refuses to change someone who has more permissions than the one changing them', async () => {
      const { service, repo, membershipRepo, dataSource, db, outsideQuery } = createService();
      membership(membershipRepo);
      repo.findOneBy.mockResolvedValue({ id: '1', firstName: 'Ana' });
      // Quien se toca puede aprobar descuentos y quien lo toca no
      db.userCodes = [PermissionCode.SALES_CREATE, PermissionCode.SALES_APPROVE_DISCOUNT];

      const error = await service
        .update(COMPANY, actor, '1', { firstName: 'X' })
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ForbiddenException);
      expect((error as ForbiddenException).message).toBe(
        'No puedes modificar a alguien con más permisos que tú',
      );
      expect(outsideQuery.mock.calls[0][1]).toEqual([COMPANY, '1']);
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('lets someone change the account of a person whose permissions they all hold', async () => {
      const { service, repo, membershipRepo, db } = createService();
      membership(membershipRepo);
      repo.findOneBy.mockResolvedValue({ id: '1', firstName: 'Ana' });
      db.userCodes = [PermissionCode.SALES_CREATE];

      await expect(service.update(COMPANY, actor, '1', { firstName: 'X' })).resolves.toMatchObject({
        firstName: 'X',
      });
    });

    it('always lets someone change their own data, whatever permissions they have', async () => {
      const { service, repo, membershipRepo, db, outsideQuery } = createService();
      membership(membershipRepo);
      repo.findOneBy.mockResolvedValue({ id: 'admin-1', firstName: 'Admin' });
      db.userCodes = [PermissionCode.SALES_APPROVE_DISCOUNT];

      const result = await service.update(
        COMPANY,
        { userId: 'admin-1', permissionCodes: [PermissionCode.USERS_MANAGE] },
        'admin-1',
        { firstName: 'Admin 2' },
      );

      expect(result.firstName).toBe('Admin 2');
      // Ni se miran los permisos de la cuenta: es la propia
      expect(outsideQuery).not.toHaveBeenCalled();
    });
  });

  describe('deactivate', () => {
    it('sets status to INACTIVE inside a transaction', async () => {
      const { service, repo, membershipRepo, dataSource } = createService();
      membership(membershipRepo);
      repo.findOneBy.mockResolvedValue({ id: '1', status: RecordStatus.ACTIVE });

      const result = await service.deactivate(COMPANY, actor, '1');

      expect(dataSource.transaction).toHaveBeenCalled();
      expect(result.status).toBe(RecordStatus.INACTIVE);
    });

    it('locks the account and keeps whatever else was changed meanwhile', async () => {
      const { service, repo, membershipRepo, transactionRepo } = createService();
      membership(membershipRepo);
      repo.findOneBy.mockResolvedValue({ id: '1', status: RecordStatus.ACTIVE, firstName: 'Ana' });
      transactionRepo.findOne.mockResolvedValue({
        id: '1',
        status: RecordStatus.ACTIVE,
        firstName: 'Ana María',
      });

      await service.deactivate(COMPANY, actor, '1');

      expect(transactionRepo.findOne).toHaveBeenCalledWith({
        where: { id: '1' },
        lock: { mode: 'pessimistic_write' },
      });
      expect(transactionRepo.save).toHaveBeenCalledWith({
        id: '1',
        status: RecordStatus.INACTIVE,
        firstName: 'Ana María',
      });
    });

    it('throws when the user is not a member of the company', async () => {
      const { service, membershipRepo } = createService();
      membership(membershipRepo, { member: false });

      await expect(service.deactivate(COMPANY, actor, 'missing')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('refuses to deactivate an account that another company also uses', async () => {
      const { service, repo, membershipRepo, dataSource } = createService();
      membership(membershipRepo, { elsewhere: true });
      repo.findOneBy.mockResolvedValue({ id: '1', status: RecordStatus.ACTIVE });

      await expect(service.deactivate(COMPANY, actor, '1')).rejects.toThrow(ForbiddenException);
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('does not let anyone deactivate their own account, before touching anything', async () => {
      const { service, membershipRepo, dataSource } = createService();
      membership(membershipRepo);

      const error = await service
        .deactivate(COMPANY, actor, 'admin-1')
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ForbiddenException);
      expect((error as ForbiddenException).message).toBe('No puedes desactivar tu propia cuenta');
      expect(membershipRepo.existsBy).not.toHaveBeenCalled();
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('refuses to deactivate someone who has more permissions than the one deactivating them', async () => {
      const { service, repo, membershipRepo, dataSource, db } = createService();
      membership(membershipRepo);
      repo.findOneBy.mockResolvedValue({ id: '1', status: RecordStatus.ACTIVE });
      db.userCodes = [PermissionCode.SALES_APPROVE_DISCOUNT];

      await expect(service.deactivate(COMPANY, actor, '1')).rejects.toThrow(ForbiddenException);
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('refuses to deactivate an account with an open cash shift: it must be closed first', async () => {
      const { service, repo, membershipRepo, transactionRepo, cashSessionRepo } = createService();
      membership(membershipRepo);
      repo.findOneBy.mockResolvedValue({ id: '1', status: RecordStatus.ACTIVE });
      cashSessionRepo.existsBy.mockResolvedValue(true);

      const error = await service
        .deactivate(COMPANY, actor, '1')
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).message).toContain('turno de caja abierto');
      expect(cashSessionRepo.existsBy).toHaveBeenCalledWith({
        cashierId: '1',
        status: CashSessionStatus.OPEN,
      });
      expect(transactionRepo.save).not.toHaveBeenCalled();
    });

    it('locks the company before counting the administrators and before locking the account', async () => {
      const { service, repo, membershipRepo, transactionRepo, query } = createService();
      membership(membershipRepo);
      repo.findOneBy.mockResolvedValue({ id: '1', status: RecordStatus.ACTIVE });

      await service.deactivate(COMPANY, actor, '1');

      expect(query.mock.calls[0][0]).toContain('FOR UPDATE');
      expect(query.mock.calls[0][1]).toEqual([COMPANY]);
      expect(query.mock.calls[1][0]).toContain('COUNT(DISTINCT');
      expect(query.mock.invocationCallOrder[1]).toBeLessThan(
        transactionRepo.findOne.mock.invocationCallOrder[0],
      );
    });

    it('refuses to deactivate the last administrator of the company, and the change is not kept', async () => {
      const { service, repo, membershipRepo, db } = createService();
      membership(membershipRepo);
      repo.findOneBy.mockResolvedValue({ id: '1', status: RecordStatus.ACTIVE });
      // Había un administrador y, con este cambio, ninguno
      db.adminCounts = [1, 0];

      const error = await service
        .deactivate(COMPANY, actor, '1')
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).message).toBe(LAST_ADMIN_MESSAGE);
    });

    it('lets an administrator go when another one is left', async () => {
      const { service, repo, membershipRepo, db } = createService();
      membership(membershipRepo);
      repo.findOneBy.mockResolvedValue({ id: '1', status: RecordStatus.ACTIVE });
      db.adminCounts = [2, 1];

      const result = await service.deactivate(COMPANY, actor, '1');

      expect(result.status).toBe(RecordStatus.INACTIVE);
    });

    it('does not block the change when the company had no administrator before it', async () => {
      const { service, repo, membershipRepo, db, query } = createService();
      membership(membershipRepo);
      repo.findOneBy.mockResolvedValue({ id: '1', status: RecordStatus.ACTIVE });
      db.adminCounts = [0];

      const result = await service.deactivate(COMPANY, actor, '1');

      expect(result.status).toBe(RecordStatus.INACTIVE);
      // Ya no había a quién dejar sin cuenta: se contó una sola vez
      expect(query.mock.calls.filter(([sql]) => sql.includes('COUNT(DISTINCT'))).toHaveLength(1);
    });
  });

  describe('activate', () => {
    it('brings a deactivated account back, inside a transaction', async () => {
      const { service, repo, membershipRepo, dataSource } = createService();
      membership(membershipRepo);
      repo.findOneBy.mockResolvedValue({ id: '1', status: RecordStatus.INACTIVE });

      const result = await service.activate(COMPANY, actor, '1');

      expect(dataSource.transaction).toHaveBeenCalled();
      expect(result.status).toBe(RecordStatus.ACTIVE);
    });

    it('changes nothing else: the password, the role and the branches are left as they were', async () => {
      const { service, repo, membershipRepo, transactionRepo, transactionMembershipRepo } =
        createService();
      membership(membershipRepo);
      repo.findOneBy.mockResolvedValue({
        id: '1',
        status: RecordStatus.INACTIVE,
        passwordHash: 'hash-anterior',
        mustChangePassword: false,
      });

      await service.activate(COMPANY, actor, '1');

      expect(transactionRepo.save).toHaveBeenCalledWith({
        id: '1',
        status: RecordStatus.ACTIVE,
        passwordHash: 'hash-anterior',
        mustChangePassword: false,
      });
      expect(transactionMembershipRepo.save).not.toHaveBeenCalled();
    });

    it('does not need the company lock, the administrator count or the shift check: activating never removes access', async () => {
      const { service, repo, membershipRepo, query, cashSessionRepo } = createService();
      membership(membershipRepo);
      repo.findOneBy.mockResolvedValue({ id: '1', status: RecordStatus.INACTIVE });

      await service.activate(COMPANY, actor, '1');

      expect(query).not.toHaveBeenCalled();
      expect(cashSessionRepo.existsBy).not.toHaveBeenCalled();
    });

    it('throws when the user is not a member of the company', async () => {
      const { service, membershipRepo, dataSource } = createService();
      membership(membershipRepo, { member: false });

      await expect(service.activate(COMPANY, actor, 'missing')).rejects.toThrow(NotFoundException);
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('refuses to activate an account that another company also uses', async () => {
      const { service, repo, membershipRepo, dataSource } = createService();
      membership(membershipRepo, { elsewhere: true });
      repo.findOneBy.mockResolvedValue({ id: '1', status: RecordStatus.INACTIVE });

      await expect(service.activate(COMPANY, actor, '1')).rejects.toThrow(ForbiddenException);
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('refuses to activate someone who has more permissions than the one activating them', async () => {
      const { service, repo, membershipRepo, dataSource, db } = createService();
      membership(membershipRepo);
      repo.findOneBy.mockResolvedValue({ id: '1', status: RecordStatus.INACTIVE });
      db.userCodes = [PermissionCode.SETTINGS_MANAGE, PermissionCode.SALES_APPROVE_DISCOUNT];

      await expect(service.activate(COMPANY, actor, '1')).rejects.toThrow(ForbiddenException);
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('cannot reach a platform user', async () => {
      const { service, membershipRepo, dataSource } = createService();
      membership(membershipRepo, { platform: true });

      await expect(service.activate(COMPANY, actor, '1')).rejects.toThrow(NotFoundException);
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });
  });

  describe('resetPassword', () => {
    it('leaves the document number as the password and forces a change', async () => {
      const { service, repo, membershipRepo } = createService();
      membership(membershipRepo);
      repo.findOneBy.mockResolvedValue({ id: '1', documentNumber: '123456789' });

      const result = await service.resetPassword(COMPANY, actor, '1');

      expect(result.mustChangePassword).toBe(true);
      expect(await bcrypt.compare('123456789', result.passwordHash)).toBe(true);
    });

    it('notes when the password changed, so the sessions open before it stop working', async () => {
      const { service, repo, membershipRepo } = createService();
      membership(membershipRepo);
      repo.findOneBy.mockResolvedValue({ id: '1', documentNumber: '123456789' });
      const before = Date.now();

      const result = await service.resetPassword(COMPANY, actor, '1');

      expect(result.passwordChangedAt).toBeInstanceOf(Date);
      expect(result.passwordChangedAt!.getTime()).toBeGreaterThanOrEqual(before);
    });

    it('resets the account it reads under the lock, and keeps what else was changed meanwhile', async () => {
      const { service, repo, membershipRepo, transactionRepo } = createService();
      membership(membershipRepo);
      repo.findOneBy.mockResolvedValue({ id: '1', documentNumber: '123456789', firstName: 'Ana' });
      transactionRepo.findOne.mockResolvedValue({
        id: '1',
        documentNumber: '123456789',
        firstName: 'Ana María',
      });

      const result = await service.resetPassword(COMPANY, actor, '1');

      expect(transactionRepo.findOne).toHaveBeenCalledWith({
        where: { id: '1' },
        lock: { mode: 'pessimistic_write' },
      });
      expect(result.firstName).toBe('Ana María');
      expect(result.mustChangePassword).toBe(true);
    });

    it('does not let anyone reset their own password: there is "change password" for that', async () => {
      const { service, membershipRepo, dataSource } = createService();
      membership(membershipRepo);

      const error = await service
        .resetPassword(COMPANY, actor, 'admin-1')
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ForbiddenException);
      expect((error as ForbiddenException).message).toContain('No puedes restablecer tu propia contraseña');
      expect(membershipRepo.existsBy).not.toHaveBeenCalled();
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('does not let a delegated role reset the password of someone with more permissions than theirs', async () => {
      const { service, repo, membershipRepo, dataSource, db } = createService();
      membership(membershipRepo);
      repo.findOneBy.mockResolvedValue({ id: '1', documentNumber: '123456789' });
      // La cuenta a la que se le restablece la clave tiene un permiso que quien lo hace no tiene
      db.userCodes = [PermissionCode.SETTINGS_MANAGE, PermissionCode.SALES_APPROVE_DISCOUNT];

      await expect(service.resetPassword(COMPANY, actor, '1')).rejects.toThrow(ForbiddenException);
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('rejects an account without a document number, since it is the password it goes back to', async () => {
      const { service, repo, membershipRepo, transactionRepo } = createService();
      membership(membershipRepo);
      repo.findOneBy.mockResolvedValue({ id: '1', documentNumber: null });

      await expect(service.resetPassword(COMPANY, actor, '1')).rejects.toThrow(BadRequestException);
      expect(transactionRepo.save).not.toHaveBeenCalled();
    });

    it('cannot reset the password of a platform user (the super admin)', async () => {
      const { service, membershipRepo, dataSource } = createService();
      membership(membershipRepo, { platform: true });

      await expect(service.resetPassword(COMPANY, actor, 'super')).rejects.toThrow(
        NotFoundException,
      );
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('refuses to reset the password of someone who also works in another company', async () => {
      const { service, repo, membershipRepo, dataSource } = createService();
      membership(membershipRepo, { elsewhere: true });
      repo.findOneBy.mockResolvedValue({ id: '1', documentNumber: '123456789' });

      await expect(service.resetPassword(COMPANY, actor, '1')).rejects.toThrow(ForbiddenException);
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });
  });

  describe('changePassword', () => {
    const currentPassword = 'clave-actual';
    const documentNumber = '123456789';

    async function storedUser() {
      return {
        id: '1',
        documentNumber,
        mustChangePassword: true,
        passwordHash: await bcrypt.hash(currentPassword, 4),
      };
    }

    it('rehashes the password and clears mustChangePassword', async () => {
      const { service, repo } = createService();
      const user = await storedUser();
      repo.findOneBy.mockResolvedValue(user);

      const result = await service.changePassword('1', {
        currentPassword,
        newPassword: 'una-clave-nueva',
      });

      expect(result.mustChangePassword).toBe(false);
      expect(await bcrypt.compare('una-clave-nueva', result.passwordHash)).toBe(true);
    });

    it('notes when the password changed, so the other sessions of the account stop working', async () => {
      const { service, repo } = createService();
      repo.findOneBy.mockResolvedValue(await storedUser());
      const before = Date.now();

      const result = await service.changePassword('1', {
        currentPassword,
        newPassword: 'una-clave-nueva',
      });

      expect(result.passwordChangedAt).toBeInstanceOf(Date);
      expect(result.passwordChangedAt!.getTime()).toBeGreaterThanOrEqual(before);
    });

    it('returns the user, so whoever calls it can renew the session', async () => {
      const { service, repo } = createService();
      repo.findOneBy.mockResolvedValue(await storedUser());

      const result = await service.changePassword('1', {
        currentPassword,
        newPassword: 'una-clave-nueva',
      });

      expect(result).toMatchObject({ id: '1', mustChangePassword: false });
    });

    it('locks the account before checking the current password', async () => {
      const { service, repo, transactionRepo } = createService();
      repo.findOneBy.mockResolvedValue(await storedUser());

      await service.changePassword('1', { currentPassword, newPassword: 'una-clave-nueva' });

      expect(transactionRepo.findOne).toHaveBeenCalledWith({
        where: { id: '1' },
        lock: { mode: 'pessimistic_write' },
      });
    });

    it('checks the current password against the one there is now: one an administrator just reset no longer works', async () => {
      const { service, transactionRepo } = createService();
      transactionRepo.findOne.mockResolvedValue({
        ...(await storedUser()),
        passwordHash: await bcrypt.hash('restablecida-por-el-admin', 4),
      });

      await expect(
        service.changePassword('1', { currentPassword, newPassword: 'una-clave-nueva' }),
      ).rejects.toThrow(UnauthorizedException);
      expect(transactionRepo.save).not.toHaveBeenCalled();
    });

    it('rejects a wrong current password', async () => {
      const { service, repo, transactionRepo } = createService();
      repo.findOneBy.mockResolvedValue(await storedUser());

      await expect(
        service.changePassword('1', {
          currentPassword: 'equivocada',
          newPassword: 'una-clave-nueva',
        }),
      ).rejects.toThrow(UnauthorizedException);
      expect(transactionRepo.save).not.toHaveBeenCalled();
    });

    it('rejects reusing the document number as the new password', async () => {
      const { service, repo } = createService();
      repo.findOneBy.mockResolvedValue(await storedUser());

      await expect(
        service.changePassword('1', { currentPassword, newPassword: documentNumber }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects reusing the current password', async () => {
      const { service, repo } = createService();
      repo.findOneBy.mockResolvedValue(await storedUser());

      await expect(
        service.changePassword('1', { currentPassword, newPassword: currentPassword }),
      ).rejects.toThrow(BadRequestException);
    });

    it('answers "not found" when the account no longer exists', async () => {
      const { service, transactionRepo } = createService();
      transactionRepo.findOne.mockResolvedValue(null);

      await expect(
        service.changePassword('1', { currentPassword, newPassword: 'una-clave-nueva' }),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
