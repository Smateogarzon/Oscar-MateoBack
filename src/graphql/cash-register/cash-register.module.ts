import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CashRegisterResolver } from './cash-register.resolver.js';
import { CashRegisterService } from './cash-register.service.js';
import { CashRegister } from './entities/cash-register.entity.js';

@Module({
  imports: [TypeOrmModule.forFeature([CashRegister])],
  providers: [CashRegisterService, CashRegisterResolver],
  exports: [CashRegisterService],
})
export class CashRegisterModule {}
