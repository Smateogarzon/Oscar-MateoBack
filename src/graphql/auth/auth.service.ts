import { randomBytes } from 'node:crypto';
import { HttpException, HttpStatus, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcryptjs';
import { DataSource, In, Repository } from 'typeorm';
import { isPlatformRole } from '../../common/access/platform-role.js';
import { RecordStatus } from '../../common/enums/record-status.enum.js';
import { Role } from '../role/entities/role.entity.js';
import { UserCompanyRole } from '../user-company-role/entities/user-company-role.entity.js';
import { User } from '../user/entities/user.entity.js';
import { UserService } from '../user/user.service.js';
import { ADMIN_TOKEN_TTL, DEFAULT_TOKEN_TTL } from './auth-cookie.constants.js';
import { LoginInput } from './dto/login.input.js';
import type { JwtPayload } from './interface/jwt-payload.interface.js';

const ADMIN_ROLE_CODE = 'ADMIN';

// Contra la fuerza bruta por cuenta: tras 5 contraseñas equivocadas seguidas para un mismo correo (en
// 15 minutos) ese correo queda bloqueado 15 minutos. Se cuenta igual para un correo que existe que para
// uno que no: el bloqueo no delata qué correos son de la app. El contador vive en memoria (una sola
// instancia del servidor); si el servidor se reinicia se borra, que es aceptable para esto.
const MAX_FAILED_LOGINS = 5;
const FAILURE_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_LOCK_MS = 15 * 60 * 1000;
const MAX_TRACKED_EMAILS = 5000;
const PASSWORD_SALT_ROUNDS = 10;

// Un hash cualquiera para comparar cuando el correo no existe o la cuenta no está activa: así una
// respuesta de "credenciales inválidas" tarda lo mismo exista o no el correo (si no, el tiempo delataba
// cuáles correos son de la app).
const DUMMY_HASH = bcrypt.hashSync(randomBytes(16).toString('hex'), PASSWORD_SALT_ROUNDS);

interface FailureRecord {
  count: number;
  firstAt: number;
  lockedUntil: number;
}

export interface LoginResult {
  accessToken: string;
  user: User;
  isAdmin: boolean;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly failures = new Map<string, FailureRecord>();

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
    ip: string | undefined,
  ): Promise<User> {
    const found = await this.userService.findByEmail(email);
    const activeUser = found && found.status === RecordStatus.ACTIVE ? found : null;

    // Siempre se compara contra un hash (el real o uno falso): mismo tiempo en los dos casos.
    const passwordMatches = await bcrypt.compare(password, activeUser?.passwordHash ?? DUMMY_HASH);
    if (!activeUser || !passwordMatches) {
      this.registerFailure(email);
      this.logger.warn(`Inicio de sesión fallido: correo=${email} ip=${ip ?? 'desconocida'}`);
      throw new UnauthorizedException('Credenciales inválidas');
    }

    return activeUser;
  }

  // Solo decide cuánto dura la sesión (los administradores y el super admin, menos). Qué puede
  // hacer el usuario NO va en el token: depende de la empresa y se consulta en cada petición.
  private async isAdminInAnyCompany(userId: string): Promise<boolean> {
    const assignments = await this.userCompanyRoleRepository.find({
      where: { userId, status: RecordStatus.ACTIVE },
    });
    const roleIds = [
      ...new Set(assignments.map((assignment) => assignment.roleId)),
    ];
    if (roleIds.length === 0) return false;

    const roles = await this.roleRepository.findBy({ id: In(roleIds) });
    return roles.some((role) => role.code === ADMIN_ROLE_CODE || isPlatformRole(role));
  }

  // El token de una sesión nueva de este usuario, y si dura menos (administradores). Lo usan el inicio de
  // sesión y el cambio de contraseña (que renueva la sesión de quien la cambia).
  async issueSession(user: Pick<User, 'id' | 'email'>): Promise<{ accessToken: string; isAdmin: boolean }> {
    const isAdmin = await this.isAdminInAnyCompany(user.id);
    const payload: JwtPayload = { sub: user.id, email: user.email };
    const accessToken = this.jwtService.sign(payload, {
      expiresIn: isAdmin ? ADMIN_TOKEN_TTL : DEFAULT_TOKEN_TTL,
    });
    return { accessToken, isAdmin };
  }

  async login(input: LoginInput, ip?: string): Promise<LoginResult> {
    // El correo es el mismo sin importar cómo se escriba (mayúsculas, espacios)
    const email = input.email.trim().toLowerCase();
    this.assertNotLocked(email);

    const user = await this.validateCredentials(email, input.password, ip);
    this.failures.delete(email);

    const { accessToken, isAdmin } = await this.issueSession(user);
    this.logger.log(`Inicio de sesión: usuario=${user.id} ip=${ip ?? 'desconocida'}`);

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

  // Un correo bloqueado no llega ni a comparar la contraseña.
  private assertNotLocked(email: string): void {
    const record = this.failures.get(email);
    if (record && record.lockedUntil > Date.now()) {
      throw new HttpException(
        'Demasiados intentos fallidos: espera unos minutos e inténtalo de nuevo',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private registerFailure(email: string): void {
    const now = Date.now();
    this.pruneFailures(now);

    const current = this.failures.get(email);
    const record: FailureRecord =
      current && now - current.firstAt < FAILURE_WINDOW_MS
        ? current
        : { count: 0, firstAt: now, lockedUntil: 0 };

    record.count += 1;
    if (record.count >= MAX_FAILED_LOGINS) {
      record.lockedUntil = now + LOGIN_LOCK_MS;
      record.count = 0;
      record.firstAt = now;
    }
    this.failures.set(email, record);
  }

  // El mapa no crece sin fin: cuando pasa de cierto tamaño se descartan los registros que ya no
  // cuentan (fuera de la ventana y sin bloqueo vigente).
  private pruneFailures(now: number): void {
    if (this.failures.size < MAX_TRACKED_EMAILS) return;
    for (const [email, record] of this.failures) {
      if (record.lockedUntil <= now && now - record.firstAt >= FAILURE_WINDOW_MS) {
        this.failures.delete(email);
      }
    }
  }
}
