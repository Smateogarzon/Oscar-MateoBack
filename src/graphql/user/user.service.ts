import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import bcrypt from 'bcryptjs';
import { DataSource, EntityManager, In, Not, Repository } from 'typeorm';
import type { AccessActor } from '../../common/access/access-actor.js';
import {
  assertHoldsPermissions,
  assertStillHasAdmin,
  countCompanyAdmins,
  lockCompany,
  permissionCodesOfRole,
  permissionCodesOfUser,
} from '../../common/access/company-admins.js';
import { isPlatformRole, PLATFORM_ROLE } from '../../common/access/platform-role.js';
import { RecordStatus } from '../../common/enums/record-status.enum.js';
import { definedFields } from '../../common/utils/defined-fields.js';
import { mapPostgresWriteError } from '../../common/utils/postgres-error.js';
import { CashSessionStatus } from '../cash-session/entities/cash-session-status.enum.js';
import { CashSession } from '../cash-session/entities/cash-session.entity.js';
import { runIdempotent } from '../idempotency/idempotency.js';
import { Role } from '../role/entities/role.entity.js';
import { UserCompanyRole } from '../user-company-role/entities/user-company-role.entity.js';
import { ChangePasswordInput } from './dto/change-password.input.js';
import { CreateUserInput } from './dto/create-user.input.js';
import { UpdateUserInput } from './dto/update-user.input.js';
import { User } from './entities/user.entity.js';

const PASSWORD_SALT_ROUNDS = 10;

const GRANT_MESSAGE = 'No puedes dar un rol con permisos que tú no tienes';
const TOUCH_MESSAGE = 'No puedes modificar a alguien con más permisos que tú';

// `users` es una tabla común a todas las empresas: un usuario "es de" una empresa cuando
// tiene una membresía en ella (user_company_roles). Lo que se lista, se lee o se modifica
// desde una empresa se limita a sus miembros.
// Los usuarios de plataforma (los que tienen un rol global, el super admin) quedan fuera: son
// invisibles para todas las empresas y ninguna puede tocarlos.
//
// Quien administra usuarios no puede darse ni dar un rol con permisos que él no tiene, ni modificar la
// cuenta de alguien con más permisos que él (así un rol delegado no llega a administrador ni le
// restablece la clave a uno). Nadie desactiva ni restablece su propia cuenta, y desactivar a alguien
// nunca deja a la empresa sin administrador (ver company-admins.ts).
@Injectable()
export class UserService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly dataSource: DataSource,
  ) {}

  // Miembros de la empresa. Cuenta cualquier membresía, activa o no: a quien se le retiró
  // el rol sigue siendo de la empresa y se puede reactivar.
  async findAll(companyId: string, status?: RecordStatus): Promise<User[]> {
    const memberships = await this.dataSource
      .getRepository(UserCompanyRole)
      .find({ where: { companyId } });
    const memberIds = [...new Set(memberships.map((membership) => membership.userId))];
    const platformIds = await this.platformUserIds(memberIds);
    const userIds = memberIds.filter((id) => !platformIds.has(id));
    if (userIds.length === 0) return [];

    return this.userRepository.find({ where: { id: In(userIds), ...(status && { status }) } });
  }

  // Sin filtrar por empresa: para el propio usuario (me, changePassword) y para el login.
  async findOne(id: string): Promise<User> {
    const user = await this.userRepository.findOneBy({ id });
    if (!user) throw new NotFoundException(`Usuario ${id} no encontrado`);
    return user;
  }

  // Un usuario de otra empresa, o de plataforma, se responde igual que uno que no existe.
  async findInCompany(companyId: string, id: string): Promise<User> {
    const memberships = this.dataSource.getRepository(UserCompanyRole);
    const isMember = await memberships.existsBy({ userId: id, companyId });
    const isPlatformUser = isMember && (await memberships.existsBy({ userId: id, role: PLATFORM_ROLE }));
    if (!isMember || isPlatformUser) throw new NotFoundException(`Usuario ${id} no encontrado`);
    return this.findOne(id);
  }

  // El correo se guarda y se busca en minúsculas y sin espacios: "Ana.Lopez@x.com" y "ana.lopez@x.com" son
  // la misma persona. (Antes se comparaba tal cual: quien escribía su correo en minúsculas no entraba si el
  // administrador lo había tecleado con mayúsculas.)
  findByEmail(email: string): Promise<User | null> {
    return this.userRepository.findOneBy({ email: email.trim().toLowerCase() });
  }

  // La contraseña inicial es la cédula (documentNumber); queda forzado el cambio en el primer login.
  // El usuario entra a la empresa con el rol indicado, todo en la misma transacción. Con `idempotencyKey`,
  // repetir la petición devuelve el usuario ya creado en vez de fallar con "ya existe".
  async create(
    companyId: string,
    actor: AccessActor,
    input: CreateUserInput,
    idempotencyKey?: string,
  ): Promise<User> {
    const { roleId, ...userData } = input;
    const email = userData.email.trim().toLowerCase();
    const documentNumber = userData.documentNumber.trim();

    try {
      return await this.dataSource.transaction((manager) =>
        runIdempotent(
          manager,
          {
            companyId,
            userId: actor.userId,
            operation: 'createUser',
            key: idempotencyKey,
            input,
            resourceType: 'user',
          },
          async () => {
            // Un rol de plataforma se responde igual que uno inexistente: ninguna empresa puede
            // asignarlo, aunque conozca su id.
            const role = await manager.getRepository(Role).findOneBy({ id: roleId });
            if (!role || isPlatformRole(role)) {
              throw new BadRequestException('El rol indicado no existe');
            }
            assertHoldsPermissions(
              actor.permissionCodes,
              await permissionCodesOfRole(manager, companyId, role.id),
              GRANT_MESSAGE,
            );

            const repo = manager.getRepository(User);

            const existing = await repo.findOneBy({ email });
            if (existing) {
              throw new ConflictException(`Ya existe un usuario con el email ${email}`);
            }
            // La cédula es la contraseña inicial: dos cuentas con la misma tendrían la misma clave.
            if (await repo.existsBy({ documentNumber })) {
              throw new ConflictException('Ya existe un usuario con ese número de documento');
            }

            const passwordHash = await bcrypt.hash(documentNumber, PASSWORD_SALT_ROUNDS);

            const user = await repo.save(
              repo.create({
                ...userData,
                email,
                documentNumber,
                passwordHash,
                mustChangePassword: true,
              }),
            );

            const membershipRepo = manager.getRepository(UserCompanyRole);
            await membershipRepo.save(
              membershipRepo.create({ userId: user.id, companyId, roleId }),
            );

            return user;
          },
          (id) => manager.getRepository(User).findOneByOrFail({ id }),
        ),
      );
    } catch (error) {
      // Dos altas a la vez con el mismo correo pasan la comprobación de arriba; el índice único frena a la
      // segunda y aquí se responde igual que si la hubiera detectado el servicio.
      throw mapPostgresWriteError(error, { unique: `Ya existe un usuario con el email ${email}` });
    }
  }

  // Todo cambio a una cuenta lee al usuario YA bloqueado, dentro de la transacción (lockUser): dos
  // cambios a la misma cuenta a la vez esperan uno al otro, y cada uno parte de lo que dejó el
  // anterior. Sin esto, guardar un usuario leído antes pisaría lo que otro cambió mientras tanto (por
  // ejemplo, un formulario de datos con la contraseña vieja borraría el restablecimiento). Las
  // comprobaciones de quién puede tocar la cuenta (findManageable) van antes, fuera del bloqueo.
  async update(
    companyId: string,
    actor: AccessActor,
    id: string,
    input: UpdateUserInput,
  ): Promise<User> {
    await this.findManageable(companyId, actor, id);

    return this.dataSource.transaction(async (manager) => {
      const user = await this.lockUser(manager, id);
      Object.assign(user, definedFields(input));
      return manager.getRepository(User).save(user);
    });
  }

  async deactivate(companyId: string, actor: AccessActor, id: string): Promise<User> {
    return this.setStatus(companyId, actor, id, RecordStatus.INACTIVE);
  }

  // Desactivar solo apaga el acceso de la cuenta (no toca su rol ni sus sedes), así que reactivarla
  // la deja exactamente como estaba: con los mismos permisos y sedes, y con la contraseña que
  // tuviera. Tiene la misma restricción que desactivar (ver `findManageable`).
  async activate(companyId: string, actor: AccessActor, id: string): Promise<User> {
    return this.setStatus(companyId, actor, id, RecordStatus.ACTIVE);
  }

  private async setStatus(
    companyId: string,
    actor: AccessActor,
    id: string,
    status: RecordStatus,
  ): Promise<User> {
    const deactivating = status === RecordStatus.INACTIVE;
    if (deactivating && id === actor.userId) {
      throw new ForbiddenException('No puedes desactivar tu propia cuenta');
    }
    await this.findManageable(companyId, actor, id);

    return this.dataSource.transaction(async (manager) => {
      // Desactivar puede dejar a la empresa sin administrador: se bloquea la empresa antes (dos
      // administradores que se desactivan a la vez se ponen en fila) y se cuenta antes y después.
      let before = 0;
      if (deactivating) {
        await lockCompany(manager, companyId);
        before = await countCompanyAdmins(manager, companyId);
      }

      const user = await this.lockUser(manager, id);

      // Una cuenta con un turno de caja abierto no se desactiva: el turno quedaría abierto para alguien
      // que ya no puede entrar. Se cierra primero (como pasa con quitarle el acceso a la tienda).
      if (deactivating) {
        const hasOpenShift = await manager
          .getRepository(CashSession)
          .existsBy({ cashierId: id, status: CashSessionStatus.OPEN });
        if (hasOpenShift) {
          throw new ConflictException(
            'Este usuario tiene un turno de caja abierto: ciérralo antes de desactivar su cuenta',
          );
        }
      }

      user.status = status;
      const saved = await manager.getRepository(User).save(user);
      if (deactivating) await assertStillHasAdmin(manager, companyId, before);
      return saved;
    });
  }

  // Deja la contraseña como al crear el usuario (su documento) y lo obliga a cambiarla
  // en el próximo ingreso. Como JwtAuthGuard revisa `mustChangePassword` en cada petición,
  // una sesión ya abierta queda limitada a cambiar la contraseña desde este momento; además se anota
  // cuándo cambió la clave (`passwordChangedAt`) y las sesiones anteriores dejan de valer. Nadie
  // restablece su propia contraseña (para eso está "cambiar contraseña").
  async resetPassword(companyId: string, actor: AccessActor, id: string): Promise<User> {
    if (id === actor.userId) {
      throw new ForbiddenException('No puedes restablecer tu propia contraseña: usa "Cambiar contraseña"');
    }
    await this.findManageable(companyId, actor, id);

    return this.dataSource.transaction(async (manager) => {
      const user = await this.lockUser(manager, id);
      if (!user.documentNumber) {
        throw new BadRequestException('El usuario no tiene número de documento registrado');
      }

      user.passwordHash = await bcrypt.hash(user.documentNumber, PASSWORD_SALT_ROUNDS);
      user.mustChangePassword = true;
      user.passwordChangedAt = new Date();
      return manager.getRepository(User).save(user);
    });
  }

  // El usuario cambia su propia contraseña: el id viene del token, nunca de los argumentos. Se
  // comprueba la actual contra la contraseña que hay AHORA (con la cuenta bloqueada): si un
  // administrador la restableció mientras tanto, la que valía antes ya no sirve. Las demás sesiones de la
  // cuenta dejan de valer (`passwordChangedAt`); la de quien la cambia se renueva (AuthResolver).
  async changePassword(id: string, input: ChangePasswordInput): Promise<User> {
    return this.dataSource.transaction(async (manager) => {
      const user = await this.lockUser(manager, id);

      const currentMatches = await bcrypt.compare(input.currentPassword, user.passwordHash);
      if (!currentMatches) {
        throw new UnauthorizedException('La contraseña actual no es correcta');
      }

      if (input.newPassword === input.currentPassword) {
        throw new BadRequestException('La nueva contraseña debe ser distinta a la actual');
      }

      // La contraseña inicial es la cédula: sin esto el usuario podría "cambiarla" por la misma.
      if (user.documentNumber && input.newPassword === user.documentNumber) {
        throw new BadRequestException(
          'La nueva contraseña no puede ser tu número de documento',
        );
      }

      user.passwordHash = await bcrypt.hash(input.newPassword, PASSWORD_SALT_ROUNDS);
      user.mustChangePassword = false;
      user.passwordChangedAt = new Date();
      return manager.getRepository(User).save(user);
    });
  }

  // El usuario bloqueado hasta que termine la transacción. Un usuario que no existe se responde
  // igual que en `findOne`.
  private async lockUser(manager: EntityManager, id: string): Promise<User> {
    const user = await manager
      .getRepository(User)
      .findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
    if (!user) throw new NotFoundException(`Usuario ${id} no encontrado`);
    return user;
  }

  // Cambiar la cuenta de alguien (datos, contraseña, activación) solo se permite si trabaja
  // únicamente en esta empresa. Si también trabaja en otra, hacerlo desde aquí afectaría a
  // esa otra empresa: por ejemplo, restablecerle la contraseña daría acceso a sus datos. Tampoco se toca
  // la cuenta de alguien con más permisos que quien la toca.
  private async findManageable(companyId: string, actor: AccessActor, id: string): Promise<User> {
    const user = await this.findInCompany(companyId, id);

    const worksElsewhere = await this.dataSource.getRepository(UserCompanyRole).existsBy({
      userId: id,
      companyId: Not(companyId),
      status: RecordStatus.ACTIVE,
    });
    if (worksElsewhere) {
      throw new ForbiddenException(
        'Este usuario también trabaja en otra empresa: su cuenta no se puede modificar desde aquí',
      );
    }

    // Uno mismo siempre puede tocar sus datos; a los demás, solo si no tienen más permisos que él.
    if (id !== actor.userId) {
      assertHoldsPermissions(
        actor.permissionCodes,
        await permissionCodesOfUser(this.dataSource.manager, companyId, id),
        TOUCH_MESSAGE,
      );
    }

    return user;
  }

  // De los usuarios dados, los que tienen un rol de plataforma en alguna empresa.
  private async platformUserIds(userIds: string[]): Promise<Set<string>> {
    if (userIds.length === 0) return new Set();

    const platformMemberships = await this.dataSource
      .getRepository(UserCompanyRole)
      .find({ where: { userId: In(userIds), role: PLATFORM_ROLE } });
    return new Set(platformMemberships.map((membership) => membership.userId));
  }
}
