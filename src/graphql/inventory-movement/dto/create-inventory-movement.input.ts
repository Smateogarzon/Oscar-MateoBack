import { Field, ID, InputType } from '@nestjs/graphql';
import { IsEnum, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import { Trim } from '../../../common/decorators/trim.decorator.js';
import { QUANTITY_PATTERN } from '../../../common/utils/money.js';
import { InventoryMovementType } from '../entities/inventory-movement-type.enum.js';
import { InventorySourceType } from '../entities/inventory-source-type.enum.js';

// Igual que QUANTITY_PATTERN, pero admitiendo también vacío: así "" sigue sirviendo para borrar el
// mínimo ya puesto (ver minStock más abajo), cosa que QUANTITY_PATTERN por sí solo no deja pasar.
const MIN_STOCK_PATTERN = /^$|^\d{1,10}(\.\d{1,2})?$/;

// La cantidad viaja como texto y se convierte a Decimal en el servicio (ver AddSaleItemInput): el
// ValidationPipe recorre los inputs con class-transformer, que no sabe copiar Decimal.
@InputType()
export class CreateInventoryMovementInput {
  @Field(() => ID)
  @IsUUID()
  productVariantId: string;

  // Sin ella, el movimiento entra al sistema desde fuera (una compra, el cargue inicial).
  @Field(() => ID, { nullable: true })
  @IsOptional()
  @IsUUID()
  fromLocationId?: string;

  // Sin ella, el movimiento sale del sistema (una venta).
  @Field(() => ID, { nullable: true })
  @IsOptional()
  @IsUUID()
  toLocationId?: string;

  // Debe ser mayor que cero, ej: "2" o "1.5"
  @Field()
  @Matches(QUANTITY_PATTERN, {
    message: 'quantity debe ser una cantidad con hasta 2 decimales, por ejemplo 2 o 1.5',
  })
  quantity: string;

  @Field(() => InventoryMovementType)
  @IsEnum(InventoryMovementType)
  type: InventoryMovementType;

  @Field(() => InventorySourceType)
  @IsEnum(InventorySourceType)
  sourceType: InventorySourceType;

  @Field(() => ID, { nullable: true })
  @IsOptional()
  @IsUUID()
  sourceId?: string;

  @Field({ nullable: true })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(50)
  sourceNumber?: string;

  @Field({ nullable: true })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(255)
  notes?: string;

  // Dónde queda dentro del cajón destino: "Rack A-14 · Nivel 2". Solo tiene efecto si el
  // movimiento tiene `toLocationId` (si no, no hay balanza de destino a la que ponérsela); ausente
  // no toca lo que ya tenía, "" la borra.
  @Field({ nullable: true })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(120)
  position?: string;

  // Debajo de esta cantidad la existencia de la balanza destino se considera baja (para alertas de
  // agotamiento, aún por construir). Mismas reglas que position: solo toca la balanza destino,
  // ausente no la toca, "" la borra.
  @Field({ nullable: true })
  @IsOptional()
  @Matches(MIN_STOCK_PATTERN, {
    message: 'minStock debe ser una cantidad con hasta 2 decimales, por ejemplo 2 o 1.5, o vacío para borrarlo',
  })
  minStock?: string;
}
