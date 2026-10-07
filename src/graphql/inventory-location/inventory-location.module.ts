import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InventoryLocation } from './entities/inventory-location.entity.js';
import { InventoryLocationResolver } from './inventory-location.resolver.js';
import { InventoryLocationService } from './inventory-location.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([InventoryLocation])],
  providers: [InventoryLocationService, InventoryLocationResolver],
  exports: [InventoryLocationService],
})
export class InventoryLocationModule {}
