import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DocumentSequenceModule } from '../document-sequence/document-sequence.module.js';
import { InventoryLocationModule } from '../inventory-location/inventory-location.module.js';
import { InventoryMovementModule } from '../inventory-movement/inventory-movement.module.js';
import { InventoryReservationModule } from '../inventory-reservation/inventory-reservation.module.js';
import { NotificationModule } from '../notification/notification.module.js';
import { InternalOrderCorrection } from './entities/internal-order-correction.entity.js';
import { InternalOrderEvent } from './entities/internal-order-event.entity.js';
import { InternalOrderItem } from './entities/internal-order-item.entity.js';
import { InternalOrderVersion } from './entities/internal-order-version.entity.js';
import { InternalOrder } from './entities/internal-order.entity.js';
import { InternalOrderItemResolver } from './internal-order-item.resolver.js';
import { InternalOrderStock } from './internal-order-stock.js';
import { InternalOrderResolver } from './internal-order.resolver.js';
import { InternalOrderService } from './internal-order.service.js';

// Exporta el servicio para Venta, Caja y Cobro: abrir el cobro de una SO, marcarla pagada y
// devolverle lo apartado si el cobro se anula.
@Module({
  imports: [
    TypeOrmModule.forFeature([InternalOrder, InternalOrderItem, InternalOrderVersion, InternalOrderEvent, InternalOrderCorrection]),
    InventoryMovementModule,
    InventoryLocationModule,
    InventoryReservationModule,
    DocumentSequenceModule,
    NotificationModule,
  ],
  providers: [InternalOrderService, InternalOrderStock, InternalOrderResolver, InternalOrderItemResolver],
  exports: [InternalOrderService],
})
export class InternalOrderModule {}
