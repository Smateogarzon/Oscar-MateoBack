import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PaymentMethod } from './entities/payment-method.entity.js';
import { PaymentMethodResolver } from './payment-method.resolver.js';
import { PaymentMethodService } from './payment-method.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([PaymentMethod])],
  providers: [PaymentMethodService, PaymentMethodResolver],
  exports: [PaymentMethodService],
})
export class PaymentMethodModule {}
