import { Module } from '@nestjs/common';
import { InventoryLocationModule } from '../inventory-location/inventory-location.module.js';
import { InventoryReservationModule } from '../inventory-reservation/inventory-reservation.module.js';
import { NotificationModule } from '../notification/notification.module.js';
import { ReturnsBinService } from './returns-bin.service.js';

// El cajón de devoluciones de cada tienda (ver ReturnsBinService). Lo usan Pedidos (cliente no compra,
// cambio de pedido, armar la RE), Venta (lo que caja quita) y Devoluciones (lo devuelto de una venta).
@Module({
  imports: [InventoryReservationModule, InventoryLocationModule, NotificationModule],
  providers: [ReturnsBinService],
  exports: [ReturnsBinService],
})
export class ReturnsBinModule {}
