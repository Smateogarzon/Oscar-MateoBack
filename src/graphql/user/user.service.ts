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
import { DataSource, In, Not, QueryFailedError, Repository } from 'typeorm';
import { RecordStatus } from '../../common/enums/record-status.enum.js';
import { UserCompanyRole } from '../user-company-role/entities/user-company-role.entity.js';
import { ChangePasswordInput } from './dto/change-password.input.js';
import { CreateUserInput } from './dto/create-user.input.js';
import { UpdateUserInput } from './dto/update-user.input.js';
import { User } from './entities/user.entity.js';

const PASSWORD_SALT_ROUNDS = 10;
const FOREIGN_KEY_VIOLATION = '23503';

// `users` es una tabla común a todas las empresas: un usuario "es de" una empresa cuando
// tiene una membresía en ella (user_company_roles). Lo que se lista, se lee o se modifica
// desde una empresa se limita a sus miembros.
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
    const userIds = [...new Set(memberships.map((membership) => membership.userId))];
    if (userIds.length === 0) return [];

    return this.userRepository.find({ where: { id: In(userIds), ...(status && { status }) } });
  }

  // Sin filtrar por empresa: para el propio usuario (me, changePassword) y para el login.
  async findOne(id: string): Promise<User> {
    const user = await this.userRepository.findOneBy({ id });
    if (!user) throw new NotFoundException(`Usuario ${id} no encontrado`);
    return user;
  }

  // Un usuario de otra empresa se responde igual que uno que no existe.
  async findInCompany(companyId: string, id: string): Promise<User> {
    const isMember = await this.dataSource
      .getRepository(UserCompanyRole)
      .existsBy({ userId: id, companyId });
    if (!isMember) throw new NotFoundException(`Usuario ${id} no encontrado`);
    return this.findOne(id);
  }

  findByEmail(email: string): Promise<User | null> {
    return this.userRepository.findOneBy({ email });
  }

  // La contraseña inicial es la cédula (documentNumber); queda forzado el cambio en el primer login.
  // El usuario entra a la empresa con el rol indicado, todo en la misma transacción.
  async create(companyId: string, input: CreateUserInput): Promise<User> {
    const { roleId, ...userData } = input;

    try {
      return await this.dataSource.transaction(async (manager) => {
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
    } catch (error) {
      throw this.mapCreateError(error);
    }
  }

  async update(companyId: string, id: string, input: UpdateUserInput): Promise<User> {
    const user = await this.findManageable(companyId, id);
    Object.assign(user, input);
    return this.dataSource.transaction((manager) => manager.getRepository(User).save(user));
  }

  async deactivate(companyId: string, id: string): Promise<User> {
    const user = await this.findManageable(companyId, id);
    user.status = RecordStatus.INACTIVE;
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

  private mapCreateError(error: unknown): Error {
    const isForeignKeyViolation =
      error instanceof QueryFailedError &&
      (error.driverError as { code?: string } | undefined)?.code === FOREIGN_KEY_VIOLATION;

    return isForeignKeyViolation
      ? new BadRequestException('El rol indicado no existe')
      : (error as Error);
  }
}
