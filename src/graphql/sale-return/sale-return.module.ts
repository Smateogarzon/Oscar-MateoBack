import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CashSessionModule } from '../cash-session/cash-session.module.js';
import { DocumentSequenceModule } from '../document-sequence/document-sequence.module.js';
import { SaleModule } from '../sale/sale.module.js';
import { RefundPayment } from './entities/refund-payment.entity.js';
import { SaleReturnItem } from './entities/sale-return-item.entity.js';
import { SaleReturn } from './entities/sale-return.entity.js';
import { SaleReturnResolver } from './sale-return.resolver.js';
import { SaleReturnService } from './sale-return.service.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([SaleReturn, SaleReturnItem, RefundPayment]),
    SaleModule,
    DocumentSequenceModule,
    CashSessionModule,
  ],
  providers: [SaleReturnService, SaleReturnResolver],
  exports: [SaleReturnService],
})
export class SaleReturnModule {}
