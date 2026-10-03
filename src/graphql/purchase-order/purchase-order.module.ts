import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DocumentSequenceModule } from '../document-sequence/document-sequence.module.js';
import { InventoryLocationModule } from '../inventory-location/inventory-location.module.js';
import { InventoryMovementModule } from '../inventory-movement/inventory-movement.module.js';
import { NotificationModule } from '../notification/notification.module.js';
import { PurchaseOrderItem } from './entities/purchase-order-item.entity.js';
import { PurchaseOrder } from './entities/purchase-order.entity.js';
import { PurchaseOrderReceivingService } from './purchase-order-receiving.service.js';
import { PurchaseOrderResolver } from './purchase-order.resolver.js';
import { PurchaseOrderService } from './purchase-order.service.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([PurchaseOrder, PurchaseOrderItem]),
    DocumentSequenceModule,
    InventoryMovementModule,
    InventoryLocationModule,
    NotificationModule,
  ],
  providers: [PurchaseOrderService, PurchaseOrderReceivingService, PurchaseOrderResolver],
  exports: [PurchaseOrderService],
})
export class PurchaseOrderModule {}
