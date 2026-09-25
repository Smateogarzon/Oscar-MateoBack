import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import type { AccessActor } from '../../common/access/access-actor.js';
import { assertActiveCompany } from '../../common/access/assert-active-company.js';
import {
  assertHoldsPermissions,
  assertStillHasAdmin,
  countCompanyAdmins,
  lockCompany,
  permissionCodesOfRole,
  permissionCodesOfUser,
} from '../../common/access/company-admins.js';
import {
  COMPANY_VISIBLE_ROLE,
  isPlatformRole,
  PLATFORM_ROLE,
} from '../../common/access/platform-role.js';
import { RecordStatus } from '../../common/enums/record-status.enum.js';
import { mapPostgresWriteError } from '../../common/utils/postgres-error.js';
import { runIdempotent } from '../idempotency/idempotency.js';
import { Role } from '../role/entities/role.entity.js';
import { CreateUserCompanyRoleInput } from './dto/create-user-company-role.input.js';
import { UserCompanyRole } from './entities/user-company-role.entity.js';

const GRANT_MESSAGE = 'No puedes dar un rol con permisos que tú no tienes';
const TOUCH_MESSAGE = 'No puedes modificar a alguien con más permisos que tú';

// Todo se hace dentro de la empresa activa: una empresa nunca ve ni toca las membresías de
// otra, aunque conozca el id. Las membresías con un rol de plataforma (el super admin) no se
// listan, no se desactivan y no se pueden crear desde una empresa.
//
// Lo que cambia quién administra la empresa (dar o quitar roles) bloquea primero la empresa y no puede
// dejarla sin administrador (company-admins.ts); y nadie da un rol con permisos que él no tiene.
@Injectable()
export class UserCompanyRoleService {
  constructor(
    @InjectRepository(UserCompanyRole)
    private readonly userCompanyRoleRepository: Repository<UserCompanyRole>,
    private readonly dataSource: DataSource,
  ) {}

  findAll(companyId: string, userId?: string, status?: RecordStatus): Promise<UserCompanyRole[]> {
    return this.userCompanyRoleRepository.find({
      where: {
        companyId,
        role: COMPANY_VISIBLE_ROLE,
        ...(userId && { userId }),
        ...(status && { status }),
      },
    });
  }

  async findOne(companyId: string, id: string): Promise<UserCompanyRole> {
    const userCompanyRole = await this.userCompanyRoleRepository.findOneBy({
      id,
      companyId,
      role: COMPANY_VISIBLE_ROLE,
    });
    if (!userCompanyRole) throw new NotFoundException(`Asignación ${id} no encontrada`);
    return userCompanyRole;
  }

  // Agrega un rol a alguien que ya es de la empresa. Los usuarios nuevos entran con su rol
  // al crearlos (UserService.create); si esto aceptara a cualquiera, se podría sumar a la
  // empresa a un usuario de otra con solo conocer su id. Si el usuario ya tuvo ese rol y se le quitó, la
  // asignación se REACTIVA en vez de chocar con el índice único (sin esto, volver a un rol anterior era
  // imposible por la API). Para CAMBIAR el rol de alguien usa `changeRole`, que lo hace todo junto.
  async create(
    companyId: string,
    actor: AccessActor,
    input: CreateUserCompanyRoleInput,
  ): Promise<UserCompanyRole> {
    assertActiveCompany(companyId, input.companyId);

    try {
      return await this.dataSource.transaction(async (manager) => {
        await lockCompany(manager, companyId);
        const role = await this.loadAssignableRole(manager, companyId, actor, input.roleId);
        await this.assertMemberOfCompany(manager, companyId, input.userId);

        const repo = manager.getRepository(UserCompanyRole);
        const existing = await repo.findOneBy({ userId: input.userId, companyId, roleId: role.id });
        if (existing) {
          if (existing.status === RecordStatus.ACTIVE) {
            throw new ConflictException('Este usuario ya tiene ese rol asignado en la empresa');
          }
          existing.status = RecordStatus.ACTIVE;
          return repo.save(existing);
        }
        return repo.save(repo.create({ userId: input.userId, companyId, roleId: role.id }));
      });
    } catch (error) {
      throw this.mapWriteError(error);
    }
  }

  // Cambia el rol de alguien en UNA sola transacción: desactiva el que tenía y activa (o reactiva, o crea)
  // el nuevo. Antes eran dos llamadas sueltas del front (quitar y luego dar): si la segunda fallaba —volver
  // a un rol que ya había tenido chocaba con el índice único, o el administrador se había quitado a sí
  // mismo los permisos— el usuario se quedaba sin ningún rol y sin poder entrar. Nadie cambia su propio rol,
  // ni el de alguien con más permisos que él, ni asigna un rol con permisos que no tiene, y la empresa
  // siempre conserva un administrador. Con `idempotencyKey`, repetir la petición no hace nada de más.
  async changeRole(
    companyId: string,
    actor: AccessActor,
    userId: string,
    roleId: string,
    idempotencyKey?: string,
  ): Promise<UserCompanyRole> {
    if (userId === actor.userId) throw new ForbiddenException('No puedes cambiar tu propio rol');

    try {
      return await this.dataSource.transaction((manager) =>
        runIdempotent(
          manager,
          {
            companyId,
            userId: actor.userId,
            operation: 'changeUserRole',
            key: idempotencyKey,
            input: { userId, roleId },
            resourceType: 'user_company_role',
          },
          async () => {
            await lockCompany(manager, companyId);
            const before = await countCompanyAdmins(manager, companyId);

            const role = await this.loadAssignableRole(manager, companyId, actor, roleId);
            await this.assertMemberOfCompany(manager, companyId, userId);
            assertHoldsPermissions(
              actor.permissionCodes,
              await permissionCodesOfUser(manager, companyId, userId),
              TOUCH_MESSAGE,
            );

            const repo = manager.getRepository(UserCompanyRole);
            const scoped = await repo.find({
              where: { userId, companyId, role: COMPANY_VISIBLE_ROLE },
            });
            // Se bloquean por id en una segunda lectura: Postgres no deja bloquear las filas de una
            // consulta con uniones externas (la del rol).
            const memberships =
              scoped.length === 0
                ? []
                : await repo.find({
                    where: { id: In(scoped.map((membership) => membership.id)) },
                    lock: { mode: 'pessimistic_write' },
                  });

            // Se apagan los demás roles activos y se deja activo solo el nuevo
            for (const membership of memberships) {
              if (membership.roleId !== role.id && membership.status === RecordStatus.ACTIVE) {
                membership.status = RecordStatus.INACTIVE;
                await repo.save(membership);
              }
            }

            let target = memberships.find((membership) => membership.roleId === role.id);
            if (target) {
              if (target.status !== RecordStatus.ACTIVE) {
                target.status = RecordStatus.ACTIVE;
                target = await repo.save(target);
              }
            } else {
              target = await repo.save(repo.create({ userId, companyId, roleId: role.id }));
            }

            await assertStillHasAdmin(manager, companyId, before);
            return target;
          },
          (id) => manager.getRepository(UserCompanyRole).findOneByOrFail({ id }),
        ),
      );
    } catch (error) {
      throw this.mapWriteError(error);
    }
  }

  // Quita un rol a alguien (queda INACTIVE: no se borra). Se relee la fila con bloqueo dentro de la
  // transacción, no se guarda una leída antes. No se quita el rol a uno mismo ni a alguien con más
  // permisos, y la empresa siempre conserva un administrador.
  async deactivate(companyId: string, actor: AccessActor, id: string): Promise<UserCompanyRole> {
    await this.findOne(companyId, id);

    return this.dataSource.transaction(async (manager) => {
      await lockCompany(manager, companyId);
      const before = await countCompanyAdmins(manager, companyId);

      // La empresa y el rol de plataforma ya se comprobaron arriba (findOne); aquí se relee por id con
      // bloqueo (Postgres no deja bloquear una consulta con uniones externas).
      const repo = manager.getRepository(UserCompanyRole);
      const membership = await repo.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!membership || membership.companyId !== companyId) {
        throw new NotFoundException(`Asignación ${id} no encontrada`);
      }

      if (membership.userId === actor.userId) {
        throw new ForbiddenException('No puedes quitarte tu propio rol');
      }
      assertHoldsPermissions(
        actor.permissionCodes,
        await permissionCodesOfUser(manager, companyId, membership.userId),
        TOUCH_MESSAGE,
      );

      membership.status = RecordStatus.INACTIVE;
      const saved = await repo.save(membership);
      await assertStillHasAdmin(manager, companyId, before);
      return saved;
    });
  }

  // Un rol que esta empresa puede asignar: existe, no es de plataforma (se responde igual que uno
  // inexistente) y quien lo asigna tiene todos sus permisos.
  private async loadAssignableRole(
    manager: EntityManager,
    companyId: string,
    actor: AccessActor,
    roleId: string,
  ): Promise<Role> {
    const role = await manager.getRepository(Role).findOneBy({ id: roleId });
    if (!role || isPlatformRole(role)) {
      throw new NotFoundException(`Rol ${roleId} no encontrado`);
    }
    assertHoldsPermissions(
      actor.permissionCodes,
      await permissionCodesOfRole(manager, companyId, role.id),
      GRANT_MESSAGE,
    );
    return role;
  }

  // Alguien que ya es de la empresa (en cualquier estado) y no es un usuario de plataforma: los demás se
  // responden como si no existieran.
  private async assertMemberOfCompany(
    manager: EntityManager,
    companyId: string,
    userId: string,
  ): Promise<void> {
    const repo = manager.getRepository(UserCompanyRole);
    const isMember = await repo.existsBy({ userId, companyId });
    const isPlatformUser = isMember && (await repo.existsBy({ userId, role: PLATFORM_ROLE }));
    if (!isMember || isPlatformUser) {
      throw new NotFoundException(`Usuario ${userId} no encontrado`);
    }
  }

  private mapWriteError(error: unknown): Error {
    return mapPostgresWriteError(error, {
      foreignKey: 'El usuario, la empresa o el rol indicado no existe',
      unique: 'Este usuario ya tiene ese rol asignado en la empresa',
    });
  }
}
