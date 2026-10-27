import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Size } from './entities/size.entity.js';
import { SizeResolver } from './size.resolver.js';
import { SizeService } from './size.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([Size])],
  providers: [SizeService, SizeResolver],
  exports: [SizeService],
})
export class SizeModule {}
