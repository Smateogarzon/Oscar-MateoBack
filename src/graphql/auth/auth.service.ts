import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcryptjs';
import { In, Repository } from 'typeorm';
import { RecordStatus } from '../../common/enums/record-status.enum.js';
import { Permission } from '../permission/entities/permission.entity.js';
import { Role } from '../role/entities/role.entity.js';
import { RolePermission } from '../role-permission/entities/role-permission.entity.js';
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
    @InjectRepository(Permission)
    private readonly permissionRepository: Repository<Permission>,
    @InjectRepository(RolePermission)
    private readonly rolePermissionRepository: Repository<RolePermission>,
    @InjectRepository(UserCompanyRole)
    private readonly userCompanyRoleRepository: Repository<UserCompanyRole>,
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

  // Roles y permisos de todas las empresas del usuario, aplanados; se hornean en el JWT
  // para no tener que consultarlos en cada request.
  private async loadRolesAndPermissions(
    userId: string,
  ): Promise<{ roleCodes: string[]; permissionCodes: string[] }> {
    const assignments = await this.userCompanyRoleRepository.find({
      where: { userId, status: RecordStatus.ACTIVE },
    });
    const roleIds = [
      ...new Set(assignments.map((assignment) => assignment.roleId)),
    ];
    if (roleIds.length === 0) return { roleCodes: [], permissionCodes: [] };

    const roles = await this.roleRepository.findBy({ id: In(roleIds) });
    const roleCodes = roles.map((role) => role.code);

    const rolePermissions = await this.rolePermissionRepository.find({
      where: { roleId: In(roleIds) },
    });
    const permissionIds = [
      ...new Set(rolePermissions.map((rp) => rp.permissionId)),
    ];
    const permissions = permissionIds.length
      ? await this.permissionRepository.findBy({ id: In(permissionIds) })
      : [];

    return {
      roleCodes,
      permissionCodes: permissions.map((permission) => permission.code),
    };
  }

  async login(input: LoginInput): Promise<LoginResult> {
    const user = await this.validateCredentials(input.email, input.password);
    const { roleCodes, permissionCodes } = await this.loadRolesAndPermissions(
      user.id,
    );
    const isAdmin = roleCodes.includes(ADMIN_ROLE_CODE);

    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      isAdmin,
      roleCodes,
      permissionCodes,
    };

    const accessToken = this.jwtService.sign(payload, {
      expiresIn: isAdmin ? ADMIN_TOKEN_TTL : DEFAULT_TOKEN_TTL,
    });

    return { accessToken, user, isAdmin };
  }

  logout(): boolean {
    return true;
  }
}
