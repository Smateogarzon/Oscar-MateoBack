import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CashSessionModule } from '../cash-session/cash-session.module.js';
import { NotificationModule } from '../notification/notification.module.js';
import { SaleModule } from '../sale/sale.module.js';
import { SaleReturnModule } from '../sale-return/sale-return.module.js';
import { SalePayment } from './entities/sale-payment.entity.js';
import { SalePaymentResolver } from './sale-payment.resolver.js';
import { SalePaymentService } from './sale-payment.service.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([SalePayment]),
    SaleModule,
    CashSessionModule,
    SaleReturnModule,
    NotificationModule,
  ],
  providers: [SalePaymentService, SalePaymentResolver],
  exports: [SalePaymentService],
})
export class SalePaymentModule {}
