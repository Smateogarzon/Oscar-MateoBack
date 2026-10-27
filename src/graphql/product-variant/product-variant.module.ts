import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProductVariant } from './entities/product-variant.entity.js';
import { ProductVariantResolver } from './product-variant.resolver.js';
import { ProductVariantService } from './product-variant.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([ProductVariant])],
  providers: [ProductVariantService, ProductVariantResolver],
  exports: [ProductVariantService],
})
export class ProductVariantModule {}
