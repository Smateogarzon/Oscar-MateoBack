import { Field, ID, InputType } from '@nestjs/graphql';
import { IsNotEmpty, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import { MONEY_PATTERN, QUANTITY_PATTERN } from '../../../common/utils/money.js';

// Por ahora solo se agregan líneas genéricas (el tipo no se pide): su precio lo pone el front
// porque puede cambiar. Las líneas de inventario llegarán con el catálogo de productos.
// Los montos viajan como texto y se convierten a Decimal en el servicio: el ValidationPipe
// global recorre los inputs con class-transformer, que no sabe copiar instancias de Decimal.
// El total de la línea no se pide: lo calcula el servidor. Tampoco hay descuento aquí: todo
// descuento pasa por una solicitud que aprueba un administrador (ver DiscountRequest).
@InputType()
export class AddSaleItemInput {
  // Venta (en borrador) a la que se agrega la línea
  @Field(() => ID)
  @IsUUID()
  saleId: string;

  @Field()
  @IsString()
  @IsNotEmpty()
  @MaxLength(180)
  description: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  sku?: string;

  // Debe ser mayor que cero, ej: "2" o "1.5"
  @Field()
  @Matches(QUANTITY_PATTERN, {
    message: 'quantity debe ser una cantidad con hasta 2 decimales, por ejemplo 2 o 1.5',
  })
  quantity: string;

  // Precio por unidad, ej: "50000"
  @Field()
  @Matches(MONEY_PATTERN, {
    message: 'unitPrice debe ser un monto de hasta 12 dígitos enteros y hasta 2 decimales, por ejemplo 50000.50',
  })
  unitPrice: string;
}
