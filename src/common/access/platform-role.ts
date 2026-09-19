import { Not, type FindOptionsWhere } from 'typeorm';
import type { Role } from '../../graphql/role/entities/role.entity.js';
import { RoleScope } from '../../graphql/role/entities/role-scope.enum.js';

// Los roles de alcance global (el super admin) son de la plataforma, no de una empresa: las
// empresas no los ven en ninguna lista, no pueden asignarlos y no pueden tocar a quien los
// tiene. Solo se crean desde la terminal (npm run create:admin).
export const isPlatformRole = (role: Pick<Role, 'scope'>): boolean => role.scope === RoleScope.GLOBAL;

// Para filtrar consultas que llegan al rol a través de la relación `role`.
export const PLATFORM_ROLE: FindOptionsWhere<Role> = { scope: RoleScope.GLOBAL };
export const COMPANY_VISIBLE_ROLE: FindOptionsWhere<Role> = { scope: Not(RoleScope.GLOBAL) };
