import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StorePaymentMethod } from './entities/store-payment-method.entity.js';
import { StorePaymentMethodResolver } from './store-payment-method.resolver.js';
import { StorePaymentMethodService } from './store-payment-method.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([StorePaymentMethod])],
  providers: [StorePaymentMethodService, StorePaymentMethodResolver],
  exports: [StorePaymentMethodService],
})
export class StorePaymentMethodModule {}
