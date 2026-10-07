import { Parent, ResolveField, Resolver } from '@nestjs/graphql';
import { InternalOrderItemVariantObjectType } from './dto/internal-order-item-variant.object-type.js';
import { InternalOrderItemObjectType } from './dto/internal-order-item.object-type.js';
import type { InternalOrderItem } from './entities/internal-order-item.entity.js';
import { InternalOrderService } from './internal-order.service.js';

// Los campos calculados de una línea de pedido. Solo tiene campos: la línea siempre llega dentro de
// una consulta de pedidos, que ya pasó por sus guards.
@Resolver(() => InternalOrderItemObjectType)
export class InternalOrderItemResolver {
  constructor(private readonly internalOrderService: InternalOrderService) {}

  // Qué producto, color y talla es. Las listas ya traen la variante con todo eso; si no vino, se busca.
  @ResolveField(() => InternalOrderItemVariantObjectType, { nullable: true })
  async variant(@Parent() item: InternalOrderItem): Promise<InternalOrderItemVariantObjectType | null> {
    const variant = item.productVariant?.product
      ? item.productVariant
      : await this.internalOrderService.findVariant(item.productVariantId);
    if (!variant) return null;
    return {
      sku: variant.sku,
      productName: variant.product.name,
      reference: variant.product.reference,
      colorName: variant.color.name,
      colorHex: variant.color.hex,
      sizeName: variant.size.name,
      imageUrl: variant.imageUrl,
    };
  }
}
