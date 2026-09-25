import { Injectable, Logger } from '@nestjs/common';
import {
  DataSource,
  type EntitySubscriberInterface,
  type TransactionCommitEvent,
  type TransactionRollbackEvent,
} from 'typeorm';
import { RealtimeService } from './realtime.service.js';

// Reparte los eventos en vivo de una transacción cuando ESA transacción se confirma (ver
// RealtimeService.publishAfterCommit), y los descarta si se deshace. Se registra como suscriptor de
// TypeORM al arrancar.
//
// Lo que haga aquí no puede lanzar nunca: TypeORM llama a este método DESPUÉS del COMMIT, y un error
// aquí le llegaría a quien hizo la transacción como si hubiera fallado, cuando los cambios ya están
// guardados.
@Injectable()
export class RealtimeOutboxSubscriber implements EntitySubscriberInterface {
  private readonly logger = new Logger(RealtimeOutboxSubscriber.name);

  constructor(
    dataSource: DataSource,
    private readonly realtime: RealtimeService,
  ) {
    dataSource.subscribers.push(this);
  }

  afterTransactionCommit(event: TransactionCommitEvent): void {
    // Confirmar una transacción anidada (un savepoint) todavía no confirma nada: hay una externa
    // abierta que puede deshacerlo todo.
    if (event.queryRunner.isTransactionActive) return;

    try {
      this.realtime.flushCommitted(event.queryRunner);
    } catch (error) {
      this.logger.error(
        `No se pudieron repartir los eventos en vivo de una transacción: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  afterTransactionRollback(event: TransactionRollbackEvent): void {
    if (event.queryRunner.isTransactionActive) return;

    try {
      this.realtime.discardQueued(event.queryRunner);
    } catch (error) {
      this.logger.error(
        `No se pudieron descartar los eventos en vivo de una transacción deshecha: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
