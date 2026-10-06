import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InventoryBalanceModule } from '../inventory-balance/inventory-balance.module.js';
import { InventoryReservation } from './entities/inventory-reservation.entity.js';
import { InventoryReservationResolver } from './inventory-reservation.resolver.js';
import { InventoryReservationService } from './inventory-reservation.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([InventoryReservation]), InventoryBalanceModule],
  providers: [InventoryReservationService, InventoryReservationResolver],
  exports: [InventoryReservationService],
})
export class InventoryReservationModule {}
