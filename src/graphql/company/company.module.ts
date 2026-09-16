import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Company } from './entities/company.entity.js';
import { CompanyResolver } from './company.resolver.js';
import { CompanyService } from './company.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([Company])],
  providers: [CompanyService, CompanyResolver],
  exports: [TypeOrmModule],
})
export class CompanyModule {}
