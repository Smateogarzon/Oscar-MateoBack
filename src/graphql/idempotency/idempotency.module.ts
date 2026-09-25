import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IdempotencyKey } from './entities/idempotency-key.entity.js';

// Solo registra la entidad: la idempotencia se usa con funciones (ver idempotency.ts), no con un
// servicio inyectable, porque tiene que correr dentro de la transacción de quien la pide.
@Module({
  imports: [TypeOrmModule.forFeature([IdempotencyKey])],
})
export class IdempotencyModule {}
