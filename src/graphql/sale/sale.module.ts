import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DocumentSequenceModule } from '../document-sequence/document-sequence.module.js';
import { SaleItem } from './entities/sale-item.entity.js';
import { Sale } from './entities/sale.entity.js';
import { SaleResolver } from './sale.resolver.js';
import { SaleService } from './sale.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([Sale, SaleItem]), DocumentSequenceModule],
  providers: [SaleService, SaleResolver],
  exports: [SaleService],
})
export class SaleModule {}
