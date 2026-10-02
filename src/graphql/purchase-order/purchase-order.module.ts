import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PurchaseOrder } from './entities/purchase-order.entity.js';
import { PurchaseOrderResolver } from './purchase-order.resolver.js';
import { PurchaseOrderService } from './purchase-order.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([PurchaseOrder])],
  providers: [PurchaseOrderService, PurchaseOrderResolver],
  exports: [PurchaseOrderService],
})
export class PurchaseOrderModule {}
