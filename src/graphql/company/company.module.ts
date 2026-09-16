import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Company } from './entities/company.entity.js';

// Todavía sin resolver/service propios; existe para que TypeORM registre la entity
// (autoLoadEntities la toma de aquí) — Location la necesita para su relación.
@Module({
  imports: [TypeOrmModule.forFeature([Company])],
  exports: [TypeOrmModule],
})
export class CompanyModule {}
