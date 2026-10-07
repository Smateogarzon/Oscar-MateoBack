import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ColorResolver } from './color.resolver.js';
import { ColorService } from './color.service.js';
import { Color } from './entities/color.entity.js';

@Module({
  imports: [TypeOrmModule.forFeature([Color])],
  providers: [ColorService, ColorResolver],
  exports: [ColorService],
})
export class ColorModule {}
