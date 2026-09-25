import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CashSessionModule } from '../cash-session/cash-session.module.js';
import { DocumentSequenceModule } from '../document-sequence/document-sequence.module.js';
import { NotificationModule } from '../notification/notification.module.js';
import { SaleItem } from './entities/sale-item.entity.js';
import { Sale } from './entities/sale.entity.js';
import { SaleResolver } from './sale.resolver.js';
import { SaleService } from './sale.service.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([Sale, SaleItem]),
    DocumentSequenceModule,
    CashSessionModule,
    NotificationModule,
  ],
  providers: [SaleService, SaleResolver],
  exports: [SaleService],
})
export class SaleModule {}
