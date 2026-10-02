import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NotificationModule } from '../notification/notification.module.js';
import { InventoryMovement } from './entities/inventory-movement.entity.js';
import { InventoryMovementResolver } from './inventory-movement.resolver.js';
import { InventoryMovementService } from './inventory-movement.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([InventoryMovement]), NotificationModule],
  providers: [InventoryMovementService, InventoryMovementResolver],
  exports: [InventoryMovementService],
})
export class InventoryMovementModule {}
