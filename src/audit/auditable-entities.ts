import { Decimal } from 'decimal.js';
import type { EntityMetadata, ObjectLiteral } from 'typeorm';
import type { ColumnMetadata } from 'typeorm/metadata/ColumnMetadata.js';
import { Brand } from '../graphql/brand/entities/brand.entity.js';
import { CashMovement } from '../graphql/cash-movement/entities/cash-movement.entity.js';
import { CashRegister } from '../graphql/cash-register/entities/cash-register.entity.js';
import { CashSession } from '../graphql/cash-session/entities/cash-session.entity.js';
import { Category } from '../graphql/category/entities/category.entity.js';
import { Color } from '../graphql/color/entities/color.entity.js';
import { Company } from '../graphql/company/entities/company.entity.js';
import { DiscountRequest } from '../graphql/discount-request/entities/discount-request.entity.js';
import { Incident } from '../graphql/incident/entities/incident.entity.js';
import { InternalOrder } from '../graphql/internal-order/entities/internal-order.entity.js';
import { InventoryLocation } from '../graphql/inventory-location/entities/inventory-location.entity.js';
import { InventoryReservation } from '../graphql/inventory-reservation/entities/inventory-reservation.entity.js';
import { Location } from '../graphql/location/entities/location.entity.js';
import { PaymentMethod } from '../graphql/payment-method/entities/payment-method.entity.js';
import { Permission } from '../graphql/permission/entities/permission.entity.js';
import { Product } from '../graphql/product/entities/product.entity.js';
import { ProductVariant } from '../graphql/product-variant/entities/product-variant.entity.js';
import { PurchaseOrder } from '../graphql/purchase-order/entities/purchase-order.entity.js';
import { Role } from '../graphql/role/entities/role.entity.js';
import { RolePermission } from '../graphql/role-permission/entities/role-permission.entity.js';
import { SalePayment } from '../graphql/sale-payment/entities/sale-payment.entity.js';
import { RefundPayment } from '../graphql/sale-return/entities/refund-payment.entity.js';
import { SaleReturn } from '../graphql/sale-return/entities/sale-return.entity.js';
import { Sale } from '../graphql/sale/entities/sale.entity.js';
import { Size } from '../graphql/size/entities/size.entity.js';
import { StorePaymentMethod } from '../graphql/store-payment-method/entities/store-payment-method.entity.js';
import { UserCompanyRole } from '../graphql/user-company-role/entities/user-company-role.entity.js';
import { UserLocationAccess } from '../graphql/user-location-access/entities/user-location-access.entity.js';
import { User } from '../graphql/user/entities/user.entity.js';
import { WriteOff } from '../graphql/write-off/entities/write-off.entity.js';
import { AuditAction } from './entities/audit-action.enum.js';

// A propósito NO están aquí (quedan fuera del registro automático):
// - InventoryBalance: se reescribe en cada movimiento, no tiene companyId propio, y es redundante
//   con InventoryMovement (que ya es su propio ledger, inmutable).
// - InventoryMovement: por el mismo motivo de volumen — se crea en cada venta/traslado/baja, y
//   casi siempre ya queda registrada la acción que lo originó (la venta, el pedido, la baja...)
//   en esta misma tabla. Auditarlo también duplicaría casi cada escritura de inventario.
// - IdempotencyKey, Notification, UserNotification: control técnico o generado por el sistema,
//   no una decisión de una persona.
// - DocumentSequence: un contador interno.
// - SaleItem, SaleReturnItem, DiscountRequestItem, InternalOrderItem, WriteOffItem: líneas de un
//   documento que ya audita su propia cabecera (Sale, SaleReturn, DiscountRequest, InternalOrder,
//   WriteOff); auditar cada línea multiplicaría las filas sin agregar una decisión nueva.
export const AUDITABLE_ENTITIES: ReadonlySet<Function> = new Set<Function>([
  Brand,
  Category,
  Color,
  Size,
  Product,
  ProductVariant,
  Company,
  Location,
  User,
  Role,
  Permission,
  RolePermission,
  UserCompanyRole,
  UserLocationAccess,
  PaymentMethod,
  StorePaymentMethod,
  CashRegister,
  CashSession,
  CashMovement,
  Sale,
  SalePayment,
  SaleReturn,
  RefundPayment,
  DiscountRequest,
  InternalOrder,
  PurchaseOrder,
  WriteOff,
  Incident,
  InventoryReservation,
  InventoryLocation,
]);

// Nunca se guarda su valor real, así haya cambiado: ni en old_values ni en new_values.
const REDACTED_FIELDS = new Set(['passwordHash', 'passwordChangedAt', 'movementCode']);
const REDACTED_PLACEHOLDER = '[redactado]';

const STATUS_COLUMN = 'status';

// El estado nuevo decide la acción: funciona porque en este proyecto los enums de estado usan
// siempre los mismos nombres (APPROVED/CONFIRMED, REJECTED, CANCELLED) en WriteOff, PurchaseOrder,
// InternalOrder, DiscountRequest, SaleReturn, etc. Cualquier otro cambio de estado (p. ej.
// PENDING→ACCEPTED) queda como STATUS_CHANGE genérico.
export function actionForUpdate(
  updatedColumns: readonly ColumnMetadata[],
  entity: ObjectLiteral,
): AuditAction {
  const statusChanged = updatedColumns.some((column) => column.propertyName === STATUS_COLUMN);
  if (!statusChanged) return AuditAction.UPDATE;

  const value = String((entity as Record<string, unknown>)[STATUS_COLUMN] ?? '').toUpperCase();
  if (value === 'APPROVED' || value === 'CONFIRMED') return AuditAction.APPROVE;
  if (value === 'REJECTED') return AuditAction.REJECT;
  if (value === 'CANCELLED' || value === 'CANCELED') return AuditAction.CANCEL;
  return AuditAction.STATUS_CHANGE;
}

function toPlainValue(value: unknown): unknown {
  if (value instanceof Decimal) return value.toString();
  if (value instanceof Date) return value.toISOString();
  return value;
}

// Snapshot completo (para CREATE/DELETE): solo columnas propias, nunca relaciones.
export function snapshot(
  metadata: EntityMetadata,
  entity: ObjectLiteral | undefined,
): Record<string, unknown> | null {
  if (!entity) return null;
  const result: Record<string, unknown> = {};
  for (const column of metadata.columns) {
    const key = column.propertyName;
    result[key] = REDACTED_FIELDS.has(key)
      ? REDACTED_PLACEHOLDER
      : toPlainValue((entity as Record<string, unknown>)[key]);
  }
  return result;
}

export interface ValueDiff {
  oldValues: Record<string, unknown> | null;
  newValues: Record<string, unknown> | null;
}

// Para UPDATE: solo las columnas que de verdad cambiaron, antes y después.
export function diffValues(
  entity: ObjectLiteral,
  databaseEntity: ObjectLiteral,
  updatedColumns: readonly ColumnMetadata[],
): ValueDiff {
  const oldValues: Record<string, unknown> = {};
  const newValues: Record<string, unknown> = {};
  for (const column of updatedColumns) {
    const key = column.propertyName;
    const redacted = REDACTED_FIELDS.has(key);
    oldValues[key] = redacted
      ? REDACTED_PLACEHOLDER
      : toPlainValue((databaseEntity as Record<string, unknown>)[key]);
    newValues[key] = redacted
      ? REDACTED_PLACEHOLDER
      : toPlainValue((entity as Record<string, unknown>)[key]);
  }
  return { oldValues, newValues };
}

const ACTION_VERB: Record<AuditAction, string> = {
  [AuditAction.CREATE]: 'Se creó',
  [AuditAction.UPDATE]: 'Se actualizó',
  [AuditAction.DELETE]: 'Se eliminó',
  [AuditAction.STATUS_CHANGE]: 'Cambió de estado',
  [AuditAction.APPROVE]: 'Se aprobó',
  [AuditAction.REJECT]: 'Se rechazó',
  [AuditAction.CANCEL]: 'Se canceló',
  [AuditAction.LOGIN]: 'Inicio de sesión',
  [AuditAction.LOGOUT]: 'Cierre de sesión',
};

export function describeAction(action: AuditAction, entityType: string): string {
  return `${ACTION_VERB[action]} ${entityType}`;
}
