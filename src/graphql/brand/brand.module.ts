import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BrandResolver } from './brand.resolver.js';
import { BrandService } from './brand.service.js';
import { Brand } from './entities/brand.entity.js';

@Module({
  imports: [TypeOrmModule.forFeature([Brand])],
  providers: [BrandService, BrandResolver],
  exports: [BrandService],
})
export class BrandModule {}
