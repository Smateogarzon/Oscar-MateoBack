import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SaleModule } from '../sale/sale.module.js';
import { DiscountRequestResolver } from './discount-request.resolver.js';
import { DiscountRequestService } from './discount-request.service.js';
import { DiscountRequestItem } from './entities/discount-request-item.entity.js';
import { DiscountRequest } from './entities/discount-request.entity.js';

@Module({
  imports: [TypeOrmModule.forFeature([DiscountRequest, DiscountRequestItem]), SaleModule],
  providers: [DiscountRequestService, DiscountRequestResolver],
  exports: [DiscountRequestService],
})
export class DiscountRequestModule {}
