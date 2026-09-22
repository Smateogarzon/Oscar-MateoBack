import { Module } from '@nestjs/common';
import { PosHardwareController } from './pos-hardware.controller.js';

@Module({
  controllers: [PosHardwareController],
})
export class PosHardwareModule {}
