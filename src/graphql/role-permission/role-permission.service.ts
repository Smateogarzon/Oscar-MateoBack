import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import type { AccessActor } from '../../common/access/access-actor.js';
import {
  assertHoldsPermissions,
  assertStillHasAdmin,
  countCompanyAdmins,
  lockCompany,
} from '../../common/access/company-admins.js';
import { COMPANY_VISIBLE_ROLE, isPlatformRole } from '../../common/access/platform-role.js';
import { mapPostgresWriteError } from '../../common/utils/postgres-error.js';
import { Permission } from '../permission/entities/permission.entity.js';
import { Role } from '../role/entities/role.entity.js';
import { CreateRolePermissionInput } from './dto/create-role-permission.input.js';
import { RolePermission } from './entities/role-permission.entity.js';

// RolePermission es una tabla inmutable (ver ImmutableEntity): no tiene `status`,
// así que quitar un permiso de un rol es un delete real, no una desactivación.
// Todo se hace dentro de la empresa activa: una empresa nunca ve ni toca las asignaciones
// de otra, aunque conozca el id. Los permisos de un rol de plataforma (el super admin) no se
// listan ni se pueden cambiar desde una empresa.
//
// Quien edita los permisos de un rol solo puede dar permisos que él mismo tiene (si no, con
// settings.manage se podía subir cualquier rol, incluido el propio, al de administrador), y quitar uno
// nunca puede dejar a la empresa sin administrador: el servidor lo comprueba (antes solo lo hacía la
// pantalla, con datos que podían estar viejos).
@Injectable()
export class RolePermissionService {
  constructor(
    @InjectRepository(RolePermission)
    private readonly rolePermissionRepository: Repository<RolePermission>,
    private readonly dataSource: DataSource,
  ) {}

  findAll(companyId: string, roleId?: string): Promise<RolePermission[]> {
    return this.rolePermissionRepository.find({
      where: { companyId, role: COMPANY_VISIBLE_ROLE, ...(roleId && { roleId }) },
    });
  }

  async create(
    companyId: string,
    actor: AccessActor,
    input: CreateRolePermissionInput,
  ): Promise<RolePermission> {
    try {
      return await this.dataSource.transaction(async (manager) => {
        // Un rol de plataforma se responde igual que uno inexistente.
        const role = await manager.getRepository(Role).findOneBy({ id: input.roleId });
        if (!role || isPlatformRole(role)) {
          throw new BadRequestException('El rol o el permiso indicado no existe');
        }

        // Solo se da un permiso que quien lo da también tiene
        const permission = await manager.getRepository(Permission).findOneBy({ id: input.permissionId });
        if (!permission) throw new BadRequestException('El rol o el permiso indicado no existe');
        assertHoldsPermissions(
          actor.permissionCodes,
          [permission.code],
          'No puedes dar un permiso que tú no tienes',
        );

        const repo = manager.getRepository(RolePermission);
        return repo.save(repo.create({ ...input, companyId }));
      });
    } catch (error) {
      throw this.mapWriteError(error);
    }
  }

  async remove(companyId: string, id: string): Promise<boolean> {
    const rolePermission = await this.rolePermissionRepository.findOneBy({
      id,
      companyId,
      role: COMPANY_VISIBLE_ROLE,
    });
    if (!rolePermission) throw new NotFoundException(`Asignación ${id} no encontrada`);

    await this.dataSource.transaction(async (manager) => {
      // La empresa se bloquea antes de contar administradores: dos quitas a la vez se ponen en fila.
      await lockCompany(manager, companyId);
      const before = await countCompanyAdmins(manager, companyId);

      await manager.getRepository(RolePermission).delete(id);

      await assertStillHasAdmin(manager, companyId, before);
    });
    return true;
  }

  private mapWriteError(error: unknown): Error {
    return mapPostgresWriteError(error, {
      foreignKey: 'El rol o el permiso indicado no existe',
      unique: 'Este rol ya tiene asignado ese permiso',
    });
  }
}
