import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InventoryBalance } from './entities/inventory-balance.entity.js';
import { InventoryBalanceResolver } from './inventory-balance.resolver.js';
import { InventoryBalanceService } from './inventory-balance.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([InventoryBalance])],
  providers: [InventoryBalanceService, InventoryBalanceResolver],
  exports: [InventoryBalanceService],
})
export class InventoryBalanceModule {}
