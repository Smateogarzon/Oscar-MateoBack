import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StoreModelMinimum } from './entities/store-model-minimum.entity.js';
import { StoreModelMinimumResolver } from './store-model-minimum.resolver.js';
import { StoreModelMinimumService } from './store-model-minimum.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([StoreModelMinimum])],
  providers: [StoreModelMinimumService, StoreModelMinimumResolver],
  exports: [StoreModelMinimumService],
})
export class StoreModelMinimumModule {}
