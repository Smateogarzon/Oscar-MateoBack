import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Location } from './entities/location.entity.js';
import { LocationResolver } from './location.resolver.js';
import { LocationService } from './location.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([Location])],
  providers: [LocationService, LocationResolver],
  exports: [LocationService],
})
export class LocationModule {}
