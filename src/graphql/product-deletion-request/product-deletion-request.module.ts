import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NotificationModule } from '../notification/notification.module.js';
import { ProductModule } from '../product/product.module.js';
import { ProductDeletionRequest } from './entities/product-deletion-request.entity.js';
import { ProductDeletionRequestResolver } from './product-deletion-request.resolver.js';
import { ProductDeletionRequestService } from './product-deletion-request.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([ProductDeletionRequest]), ProductModule, NotificationModule],
  providers: [ProductDeletionRequestService, ProductDeletionRequestResolver],
  exports: [ProductDeletionRequestService],
})
export class ProductDeletionRequestModule {}
