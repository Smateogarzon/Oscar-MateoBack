import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { RecordStatus } from '../../common/enums/record-status.enum.js';
import { RoleCode } from '../../common/enums/role-code.enum.js';
import { UserCompanyRole } from '../user-company-role/entities/user-company-role.entity.js';
import { User } from '../user/entities/user.entity.js';

// El proveedor es un usuario con el rol Proveedor en esta empresa (no cualquier usuario).
export async function assertSupplier(manager: EntityManager, companyId: string, supplierId: string): Promise<void> {
  const isSupplier = await manager.getRepository(UserCompanyRole).existsBy({
    userId: supplierId,
    companyId,
    status: RecordStatus.ACTIVE,
    role: { code: RoleCode.SUPPLIER, status: RecordStatus.ACTIVE },
  });
  const accountActive =
    isSupplier && (await manager.getRepository(User).existsBy({ id: supplierId, status: RecordStatus.ACTIVE }));
  if (!accountActive) throw new NotFoundException(`Proveedor ${supplierId} no encontrado`);
}

// Si la orden dice a qué proveedor va, se valida ese. Si no, la empresa tiene UN solo proveedor y
// es ese; con ninguno o con varios no hay forma de adivinar y se pide que lo indiquen.
export async function resolveSupplierId(
  manager: EntityManager,
  companyId: string,
  supplierId?: string,
): Promise<string> {
  if (supplierId) {
    await assertSupplier(manager, companyId, supplierId);
    return supplierId;
  }

  const memberships = await manager.getRepository(UserCompanyRole).find({
    where: {
      companyId,
      status: RecordStatus.ACTIVE,
      role: { code: RoleCode.SUPPLIER, status: RecordStatus.ACTIVE },
      user: { status: RecordStatus.ACTIVE },
    },
    select: { userId: true },
  });
  const supplierIds = [...new Set(memberships.map((membership) => membership.userId))];

  if (supplierIds.length === 0) throw new NotFoundException('Esta empresa no tiene un proveedor activo');
  if (supplierIds.length > 1) {
    throw new BadRequestException('Esta empresa tiene varios proveedores: indica a cuál va la orden');
  }
  return supplierIds[0];
}
