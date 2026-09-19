import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcryptjs';
import { DataSource, In, Repository } from 'typeorm';
import { RecordStatus } from '../../common/enums/record-status.enum.js';
import { Role } from '../role/entities/role.entity.js';
import { UserCompanyRole } from '../user-company-role/entities/user-company-role.entity.js';
import { User } from '../user/entities/user.entity.js';
import { UserService } from '../user/user.service.js';
import { ADMIN_TOKEN_TTL, DEFAULT_TOKEN_TTL } from './auth-cookie.constants.js';
import { LoginInput } from './dto/login.input.js';
import type { JwtPayload } from './interface/jwt-payload.interface.js';

const ADMIN_ROLE_CODE = 'ADMIN';

export interface LoginResult {
  accessToken: string;
  user: User;
  isAdmin: boolean;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly userService: UserService,
    private readonly jwtService: JwtService,
    @InjectRepository(Role)
    private readonly roleRepository: Repository<Role>,
    @InjectRepository(UserCompanyRole)
    private readonly userCompanyRoleRepository: Repository<UserCompanyRole>,
    private readonly dataSource: DataSource,
  ) {}

  private async validateCredentials(
    email: string,
    password: string,
  ): Promise<User> {
    const user = await this.userService.findByEmail(email);
    if (!user || user.status !== RecordStatus.ACTIVE) {
      throw new UnauthorizedException('Credenciales inválidas');
    }

    const passwordMatches = await bcrypt.compare(password, user.passwordHash);
    if (!passwordMatches) {
      throw new UnauthorizedException('Credenciales inválidas');
    }

    return user;
  }

  // Solo decide cuánto dura la sesión (los administradores, menos). Qué puede hacer el
  // usuario NO va en el token: depende de la empresa y se consulta en cada petición.
  private async isAdminInAnyCompany(userId: string): Promise<boolean> {
    const assignments = await this.userCompanyRoleRepository.find({
      where: { userId, status: RecordStatus.ACTIVE },
    });
    const roleIds = [
      ...new Set(assignments.map((assignment) => assignment.roleId)),
    ];
    if (roleIds.length === 0) return false;

    const roles = await this.roleRepository.findBy({ id: In(roleIds) });
    return roles.some((role) => role.code === ADMIN_ROLE_CODE);
  }

  async login(input: LoginInput): Promise<LoginResult> {
    const user = await this.validateCredentials(input.email, input.password);
    const isAdmin = await this.isAdminInAnyCompany(user.id);

    const payload: JwtPayload = { sub: user.id, email: user.email };

    const accessToken = this.jwtService.sign(payload, {
      expiresIn: isAdmin ? ADMIN_TOKEN_TTL : DEFAULT_TOKEN_TTL,
    });

    // update() no toca el objeto en memoria: se guarda el acceso de ahora pero `user`
    // conserva el anterior, que es el que tiene sentido mostrar como "último acceso".
    await this.dataSource.transaction((manager) =>
      manager.getRepository(User).update(user.id, { lastLoginAt: new Date() }),
    );

    return { accessToken, user, isAdmin };
  }

  logout(): boolean {
    return true;
  }
}
