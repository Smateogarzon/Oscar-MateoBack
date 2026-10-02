import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InventoryLocationModule } from '../inventory-location/inventory-location.module.js';
import { InventoryMovementModule } from '../inventory-movement/inventory-movement.module.js';
import { InternalOrderItem } from './entities/internal-order-item.entity.js';
import { InternalOrder } from './entities/internal-order.entity.js';
import { InternalOrderResolver } from './internal-order.resolver.js';
import { InternalOrderService } from './internal-order.service.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([InternalOrder, InternalOrderItem]),
    InventoryMovementModule,
    InventoryLocationModule,
  ],
  providers: [InternalOrderService, InternalOrderResolver],
  exports: [InternalOrderService],
})
export class InternalOrderModule {}
