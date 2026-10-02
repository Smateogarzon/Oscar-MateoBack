import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InventoryLocationModule } from '../inventory-location/inventory-location.module.js';
import { InventoryMovementModule } from '../inventory-movement/inventory-movement.module.js';
import { WriteOffItem } from './entities/write-off-item.entity.js';
import { WriteOff } from './entities/write-off.entity.js';
import { WriteOffResolver } from './write-off.resolver.js';
import { WriteOffService } from './write-off.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([WriteOff, WriteOffItem]), InventoryMovementModule, InventoryLocationModule],
  providers: [WriteOffService, WriteOffResolver],
  exports: [WriteOffService],
})
export class WriteOffModule {}
