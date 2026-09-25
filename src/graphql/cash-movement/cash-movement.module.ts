import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CashSessionModule } from '../cash-session/cash-session.module.js';
import { CashMovementResolver } from './cash-movement.resolver.js';
import { CashMovementService } from './cash-movement.service.js';
import { CashMovement } from './entities/cash-movement.entity.js';

@Module({
  imports: [TypeOrmModule.forFeature([CashMovement]), CashSessionModule],
  providers: [CashMovementService, CashMovementResolver],
  exports: [CashMovementService],
})
export class CashMovementModule {}
