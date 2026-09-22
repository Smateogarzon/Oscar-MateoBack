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
import { DataSource, In, Not, Repository } from 'typeorm';
import { isPlatformRole, PLATFORM_ROLE } from '../../common/access/platform-role.js';
import { RecordStatus } from '../../common/enums/record-status.enum.js';
import { Role } from '../role/entities/role.entity.js';
import { UserCompanyRole } from '../user-company-role/entities/user-company-role.entity.js';
import { ChangePasswordInput } from './dto/change-password.input.js';
import { CreateUserInput } from './dto/create-user.input.js';
import { UpdateUserInput } from './dto/update-user.input.js';
import { User } from './entities/user.entity.js';

const PASSWORD_SALT_ROUNDS = 10;

// `users` es una tabla común a todas las empresas: un usuario "es de" una empresa cuando
// tiene una membresía en ella (user_company_roles). Lo que se lista, se lee o se modifica
// desde una empresa se limita a sus miembros.
// Los usuarios de plataforma (los que tienen un rol global, el super admin) quedan fuera: son
// invisibles para todas las empresas y ninguna puede tocarlos.
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

  findByEmail(email: string): Promise<User | null> {
    return this.userRepository.findOneBy({ email });
  }

  // La contraseña inicial es la cédula (documentNumber); queda forzado el cambio en el primer login.
  // El usuario entra a la empresa con el rol indicado, todo en la misma transacción.
  async create(companyId: string, input: CreateUserInput): Promise<User> {
    const { roleId, ...userData } = input;

    return this.dataSource.transaction(async (manager) => {
      // Un rol de plataforma se responde igual que uno inexistente: ninguna empresa puede
      // asignarlo, aunque conozca su id.
      const role = await manager.getRepository(Role).findOneBy({ id: roleId });
      if (!role || isPlatformRole(role)) {
        throw new BadRequestException('El rol indicado no existe');
      }

      const repo = manager.getRepository(User);

      const existing = await repo.findOneBy({ email: userData.email });
      if (existing) {
        throw new ConflictException(`Ya existe un usuario con el email ${userData.email}`);
      }

      const passwordHash = await bcrypt.hash(userData.documentNumber, PASSWORD_SALT_ROUNDS);

      const user = await repo.save(
        repo.create({ ...userData, passwordHash, mustChangePassword: true }),
      );

      const membershipRepo = manager.getRepository(UserCompanyRole);
      await membershipRepo.save(
        membershipRepo.create({ userId: user.id, companyId, roleId }),
      );

      return user;
    });
  }

  async update(companyId: string, id: string, input: UpdateUserInput): Promise<User> {
    const user = await this.findManageable(companyId, id);
    Object.assign(user, input);
    return this.dataSource.transaction((manager) => manager.getRepository(User).save(user));
  }

  async deactivate(companyId: string, id: string): Promise<User> {
    return this.setStatus(companyId, id, RecordStatus.INACTIVE);
  }

  // Desactivar solo apaga el acceso de la cuenta (no toca su rol ni sus sedes), así que reactivarla
  // la deja exactamente como estaba: con los mismos permisos y sedes, y con la contraseña que
  // tuviera. Tiene la misma restricción que desactivar (ver `findManageable`).
  async activate(companyId: string, id: string): Promise<User> {
    return this.setStatus(companyId, id, RecordStatus.ACTIVE);
  }

  private async setStatus(companyId: string, id: string, status: RecordStatus): Promise<User> {
    const user = await this.findManageable(companyId, id);
    user.status = status;
    return this.dataSource.transaction((manager) => manager.getRepository(User).save(user));
  }

  // Deja la contraseña como al crear el usuario (su documento) y lo obliga a cambiarla
  // en el próximo ingreso. Como JwtAuthGuard revisa `mustChangePassword` en cada petición,
  // una sesión ya abierta queda limitada a cambiar la contraseña desde este momento.
  async resetPassword(companyId: string, id: string): Promise<User> {
    const user = await this.findManageable(companyId, id);
    if (!user.documentNumber) {
      throw new BadRequestException('El usuario no tiene número de documento registrado');
    }

    user.passwordHash = await bcrypt.hash(user.documentNumber, PASSWORD_SALT_ROUNDS);
    user.mustChangePassword = true;
    return this.dataSource.transaction((manager) => manager.getRepository(User).save(user));
  }

  // El usuario cambia su propia contraseña: el id viene del token, nunca de los argumentos.
  async changePassword(id: string, input: ChangePasswordInput): Promise<User> {
    const user = await this.findOne(id);

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

    return this.dataSource.transaction((manager) => manager.getRepository(User).save(user));
  }

  // Cambiar la cuenta de alguien (datos, contraseña, activación) solo se permite si trabaja
  // únicamente en esta empresa. Si también trabaja en otra, hacerlo desde aquí afectaría a
  // esa otra empresa: por ejemplo, restablecerle la contraseña daría acceso a sus datos.
  private async findManageable(companyId: string, id: string): Promise<User> {
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
