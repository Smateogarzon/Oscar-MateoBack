import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, QueryFailedError, Repository } from 'typeorm';
import { CreateRolePermissionInput } from './dto/create-role-permission.input.js';
import { RolePermission } from './entities/role-permission.entity.js';

const FOREIGN_KEY_VIOLATION = '23503';
const UNIQUE_VIOLATION = '23505';

// RolePermission es una tabla inmutable (ver ImmutableEntity): no tiene `status`,
// así que quitar un permiso de un rol es un delete real, no una desactivación.
// Todo se hace dentro de la empresa activa: una empresa nunca ve ni toca las asignaciones
// de otra, aunque conozca el id.
@Injectable()
export class RolePermissionService {
  constructor(
    @InjectRepository(RolePermission)
    private readonly rolePermissionRepository: Repository<RolePermission>,
    private readonly dataSource: DataSource,
  ) {}

  findAll(companyId: string, roleId?: string): Promise<RolePermission[]> {
    return this.rolePermissionRepository.find({ where: { companyId, ...(roleId && { roleId }) } });
  }

  async create(companyId: string, input: CreateRolePermissionInput): Promise<RolePermission> {
    try {
      return await this.dataSource.transaction((manager) => {
        const repo = manager.getRepository(RolePermission);
        return repo.save(repo.create({ ...input, companyId }));
      });
    } catch (error) {
      throw this.mapWriteError(error);
    }
  }

  async remove(companyId: string, id: string): Promise<boolean> {
    const rolePermission = await this.rolePermissionRepository.findOneBy({ id, companyId });
    if (!rolePermission) throw new NotFoundException(`Asignación ${id} no encontrada`);

    await this.dataSource.transaction((manager) => manager.getRepository(RolePermission).delete(id));
    return true;
  }

  private mapWriteError(error: unknown): Error {
    if (!(error instanceof QueryFailedError)) return error as Error;
    const code = (error.driverError as { code?: string } | undefined)?.code;

    if (code === FOREIGN_KEY_VIOLATION) {
      return new BadRequestException('El rol o el permiso indicado no existe');
    }
    if (code === UNIQUE_VIOLATION) {
      return new ConflictException('Este rol ya tiene asignado ese permiso');
    }
    return error as Error;
  }
}
