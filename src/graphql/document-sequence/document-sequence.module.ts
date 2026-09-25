import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DocumentSequenceService } from './document-sequence.service.js';
import { DocumentSequence } from './entities/document-sequence.entity.js';

@Module({
  imports: [TypeOrmModule.forFeature([DocumentSequence])],
  providers: [DocumentSequenceService],
  exports: [DocumentSequenceService],
})
export class DocumentSequenceModule {}
