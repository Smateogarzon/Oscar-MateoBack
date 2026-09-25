import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import type { AccessActor } from '../../common/access/access-actor.js';
import { LAST_ADMIN_MESSAGE } from '../../common/access/company-admins.js';
import { COMPANY_VISIBLE_ROLE } from '../../common/access/platform-role.js';
import { PermissionCode } from '../../common/enums/permission-code.enum.js';
import { Permission } from '../permission/entities/permission.entity.js';
import { RoleScope } from '../role/entities/role-scope.enum.js';
import { Role } from '../role/entities/role.entity.js';
import { RolePermissionService } from './role-permission.service.js';

function createService() {
  const repository = { find: vi.fn().mockResolvedValue([]), findOneBy: vi.fn() };
  const transactionRepository = {
    create: vi.fn((value: unknown) => value),
    save: vi.fn(async (value: object) => ({ id: 'rp-1', ...value })),
    delete: vi.fn().mockResolvedValue(undefined),
  };
  // El rol al que se le asigna el permiso: por defecto, uno de empresa.
  const roleRepository = {
    findOneBy: vi.fn().mockResolvedValue({ id: 'role-1', scope: RoleScope.COMPANY }),
  };
  // El permiso que se asigna: por defecto, vender.
  const permissionRepository = {
    findOneBy: vi.fn().mockResolvedValue({ id: 'permission-1', code: PermissionCode.SALES_CREATE }),
  };

  // Administradores que hay en cada conteo sucesivo (el de antes de quitar el permiso y el de después); sin
  // más, hay uno. Lo demás que se pregunta a la base (el bloqueo de la empresa) no devuelve filas.
  const adminCounts: number[] = [];
  const query = vi.fn(async (sql: string, _params?: unknown[]) =>
    sql.includes('COUNT(DISTINCT') ? [{ count: adminCounts.shift() ?? 1 }] : [],
  );

  const dataSource = {
    transaction: vi.fn(async (fn: (manager: unknown) => unknown) =>
      fn({
        query,
        getRepository: (entity: unknown) =>
          entity === Role
            ? roleRepository
            : entity === Permission
              ? permissionRepository
              : transactionRepository,
      }),
    ),
  };

  const service = new RolePermissionService(repository as never, dataSource as never);
  return {
    service,
    repository,
    transactionRepository,
    roleRepository,
    permissionRepository,
    adminCounts,
    query,
    dataSource,
  };
}

// Quien edita los permisos: administra la configuración y además puede dar el permiso de vender (así puede dar
// ese permiso, pero no otros)
const actor: AccessActor = {
  userId: 'admin-1',
  permissionCodes: [PermissionCode.SETTINGS_MANAGE, PermissionCode.SALES_CREATE],
};

const input = { roleId: 'role-1', permissionId: 'permission-1' };

// El error de la base de datos por violar un índice único o una llave foránea, como lo entrega el driver.
const databaseError = (code: string) =>
  new QueryFailedError('INSERT', [], Object.assign(new Error('database error'), { code }));

describe('RolePermissionService', () => {
  describe('findAll', () => {
    it('only lists the assignments of the given company, without those of platform roles', async () => {
      const { service, repository } = createService();

      await service.findAll('company-1');

      expect(repository.find).toHaveBeenCalledWith({
        where: { companyId: 'company-1', role: COMPANY_VISIBLE_ROLE },
      });
    });

    it('can narrow the list down to one role', async () => {
      const { service, repository } = createService();

      await service.findAll('company-1', 'role-1');

      expect(repository.find).toHaveBeenCalledWith({
        where: { companyId: 'company-1', role: COMPANY_VISIBLE_ROLE, roleId: 'role-1' },
      });
    });
  });

  describe('create', () => {
    it('saves the assignment under the given company', async () => {
      const { service, transactionRepository } = createService();

      await service.create('company-1', actor, input);

      expect(transactionRepository.create).toHaveBeenCalledWith({
        roleId: 'role-1',
        permissionId: 'permission-1',
        companyId: 'company-1',
      });
    });

    it('does not change the permissions of a platform role, even knowing its id', async () => {
      const { service, roleRepository, transactionRepository } = createService();
      roleRepository.findOneBy.mockResolvedValue({ id: 'role-1', scope: RoleScope.GLOBAL });

      await expect(service.create('company-1', actor, input)).rejects.toThrow(BadRequestException);
      expect(transactionRepository.save).not.toHaveBeenCalled();
    });

    it('rejects a role that does not exist', async () => {
      const { service, roleRepository, transactionRepository } = createService();
      roleRepository.findOneBy.mockResolvedValue(null);

      await expect(service.create('company-1', actor, input)).rejects.toThrow(BadRequestException);
      expect(transactionRepository.save).not.toHaveBeenCalled();
    });

    it('rejects a permission that does not exist', async () => {
      const { service, permissionRepository, transactionRepository } = createService();
      permissionRepository.findOneBy.mockResolvedValue(null);

      await expect(service.create('company-1', actor, input)).rejects.toThrow(BadRequestException);
      expect(permissionRepository.findOneBy).toHaveBeenCalledWith({ id: 'permission-1' });
      expect(transactionRepository.save).not.toHaveBeenCalled();
    });

    it('does not let someone give a permission they do not have: you only give what you have', async () => {
      const { service, permissionRepository, transactionRepository } = createService();
      // Quien edita puede vender pero no aprobar descuentos
      permissionRepository.findOneBy.mockResolvedValue({
        id: 'permission-2',
        code: PermissionCode.SALES_APPROVE_DISCOUNT,
      });

      const error = await service
        .create('company-1', actor, { roleId: 'role-1', permissionId: 'permission-2' })
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ForbiddenException);
      expect((error as ForbiddenException).message).toBe(
        'No puedes dar un permiso que tú no tienes',
      );
      expect(transactionRepository.save).not.toHaveBeenCalled();
    });

    it('does not let someone raise a role to administrator: the permissions that govern the company can only be given by whoever holds them', async () => {
      const { service, permissionRepository, transactionRepository } = createService();
      permissionRepository.findOneBy.mockResolvedValue({
        id: 'permission-3',
        code: PermissionCode.USERS_MANAGE,
      });

      await expect(
        service.create('company-1', actor, { roleId: 'role-1', permissionId: 'permission-3' }),
      ).rejects.toThrow(ForbiddenException);
      expect(transactionRepository.save).not.toHaveBeenCalled();
    });

    it('lets someone give a permission they hold', async () => {
      const { service, permissionRepository } = createService();
      permissionRepository.findOneBy.mockResolvedValue({
        id: 'permission-4',
        code: PermissionCode.SETTINGS_MANAGE,
      });

      await expect(
        service.create('company-1', actor, { roleId: 'role-1', permissionId: 'permission-4' }),
      ).resolves.toMatchObject({ companyId: 'company-1', permissionId: 'permission-4' });
    });

    it('answers a permission the role already has as a conflict: the unique index stops the second one', async () => {
      const { service, transactionRepository } = createService();
      transactionRepository.save.mockRejectedValue(databaseError('23505'));

      const error = await service
        .create('company-1', actor, input)
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).message).toBe('Este rol ya tiene asignado ese permiso');
    });

    it('answers a reference that does not exist as a bad request', async () => {
      const { service, transactionRepository } = createService();
      transactionRepository.save.mockRejectedValue(databaseError('23503'));

      await expect(service.create('company-1', actor, input)).rejects.toThrow(BadRequestException);
    });
  });

  describe('remove', () => {
    it('looks the assignment up inside the company and outside platform roles', async () => {
      const { service, repository, transactionRepository } = createService();
      repository.findOneBy.mockResolvedValue(null);

      await expect(service.remove('company-1', 'rp-9')).rejects.toThrow(NotFoundException);
      expect(repository.findOneBy).toHaveBeenCalledWith({
        id: 'rp-9',
        companyId: 'company-1',
        role: COMPANY_VISIBLE_ROLE,
      });
      expect(transactionRepository.delete).not.toHaveBeenCalled();
    });

    it('deletes an assignment of the company', async () => {
      const { service, repository, transactionRepository } = createService();
      repository.findOneBy.mockResolvedValue({ id: 'rp-1', companyId: 'company-1' });

      await expect(service.remove('company-1', 'rp-1')).resolves.toBe(true);
      expect(transactionRepository.delete).toHaveBeenCalledWith('rp-1');
    });

    it('locks the company before counting the administrators and before deleting', async () => {
      const { service, repository, transactionRepository, query } = createService();
      repository.findOneBy.mockResolvedValue({ id: 'rp-1', companyId: 'company-1' });

      await service.remove('company-1', 'rp-1');

      expect(query.mock.calls[0][0]).toContain('FOR UPDATE');
      expect(query.mock.calls[0][1]).toEqual(['company-1']);
      expect(query.mock.calls[1][0]).toContain('COUNT(DISTINCT');
      expect(query.mock.invocationCallOrder[1]).toBeLessThan(
        transactionRepository.delete.mock.invocationCallOrder[0],
      );
    });

    it('counts the administrators again after deleting', async () => {
      const { service, repository, transactionRepository, query } = createService();
      repository.findOneBy.mockResolvedValue({ id: 'rp-1', companyId: 'company-1' });

      await service.remove('company-1', 'rp-1');

      const counts = query.mock.calls.filter(([sql]) => sql.includes('COUNT(DISTINCT'));
      expect(counts).toHaveLength(2);
      expect(query.mock.invocationCallOrder[2]).toBeGreaterThan(
        transactionRepository.delete.mock.invocationCallOrder[0],
      );
    });

    it('refuses to take away the permission that leaves the company without an administrator', async () => {
      const { service, repository, adminCounts } = createService();
      repository.findOneBy.mockResolvedValue({ id: 'rp-1', companyId: 'company-1' });
      // Había un administrador y, sin este permiso, ninguno
      adminCounts.push(1, 0);

      const error = await service.remove('company-1', 'rp-1').catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).message).toBe(LAST_ADMIN_MESSAGE);
    });

    it('lets the permission go when an administrator is left', async () => {
      const { service, repository, adminCounts } = createService();
      repository.findOneBy.mockResolvedValue({ id: 'rp-1', companyId: 'company-1' });
      adminCounts.push(2, 1);

      await expect(service.remove('company-1', 'rp-1')).resolves.toBe(true);
    });

    it('does not block the change when the company had no administrator before it', async () => {
      const { service, repository, adminCounts, query } = createService();
      repository.findOneBy.mockResolvedValue({ id: 'rp-1', companyId: 'company-1' });
      adminCounts.push(0);

      await expect(service.remove('company-1', 'rp-1')).resolves.toBe(true);
      // Ya no había a quién dejar sin permisos: se contó una sola vez
      expect(query.mock.calls.filter(([sql]) => sql.includes('COUNT(DISTINCT'))).toHaveLength(1);
    });
  });
});
