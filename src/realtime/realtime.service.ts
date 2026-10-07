import { HttpException, HttpStatus, Injectable, Logger, Optional } from '@nestjs/common';
import type { EntityManager, QueryRunner } from 'typeorm';
import { PushService, type PushPayload } from '../push/push.service.js';
import { RealtimeBus } from './realtime-bus.js';
import type { RealtimeEvent } from './realtime-event.js';
import { openStream, type StreamOptions } from './realtime-stream.js';

// Dónde guarda una transacción los eventos que esperan a que se confirme (queryRunner.data es un
// espacio que TypeORM deja para eso: vive lo que viva la transacción)
const OUTBOX_KEY = 'realtimeOutbox';

// Cuántas escuchas abiertas puede tener a la vez una persona en una empresa: una por pestaña o
// dispositivo (y por canal, si las pide separadas). Sin tope, una sola cuenta podría agotar los
// recursos del servidor.
export const MAX_STREAMS_PER_USER = 20;

@Injectable()
export class RealtimeService {
  private readonly logger = new Logger(RealtimeService.name);

  // El aviso del sistema (web push) es opcional: sin el módulo de push, el tiempo real sigue igual.
  constructor(
    private readonly bus: RealtimeBus,
    @Optional() private readonly push?: PushService,
  ) {}

  // Reparte los eventos ya. NUNCA lanza: avisar en vivo es un extra, y que falle no puede deshacer
  // (ni hacer fallar) lo que originó el aviso.
  publish(events: RealtimeEvent[]): void {
    for (const event of events) {
      // El texto del aviso del sistema no viaja por el bus: va aparte, a los dispositivos de la persona.
      const { push, ...signal } = event;
      try {
        this.bus.publish(signal);
      } catch (error) {
        this.logger.error(
          `No se pudo repartir un evento en vivo (${event.kind}): ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      if (push) this.sendPush(event.companyId, event.userId, push);
    }
  }

  // Manda el aviso del sistema sin esperarlo: si falla, no hay nada que deshacer.
  private sendPush(companyId: string, userId: string, payload: PushPayload): void {
    if (!this.push) return;
    void this.push.dispatch(companyId, userId, payload).catch(() => undefined);
  }

  // Los eventos que nacen dentro de una transacción solo se reparten si esa transacción se
  // CONFIRMA: se anotan en ella y RealtimeOutboxSubscriber los reparte después del COMMIT. Repartirlos
  // antes avisaría de algo que puede deshacerse, y quien reaccione al aviso y consulte podría no ver
  // todavía el cambio. Fuera de una transacción no hay nada que esperar y se reparten al momento.
  publishAfterCommit(manager: EntityManager, events: RealtimeEvent[]): void {
    if (events.length === 0) return;

    const runner = manager.queryRunner;
    if (runner?.isTransactionActive) {
      const queued = (runner.data[OUTBOX_KEY] ??= []) as RealtimeEvent[];
      queued.push(...events);
      return;
    }
    this.publish(events);
  }

  // Reparte lo que la transacción anotó. Lo llama RealtimeOutboxSubscriber justo después del COMMIT.
  flushCommitted(runner: QueryRunner): void {
    const queued = runner.data[OUTBOX_KEY] as RealtimeEvent[] | undefined;
    if (!queued || queued.length === 0) return;

    delete runner.data[OUTBOX_KEY];
    this.publish(queued);
  }

  // Descarta lo que la transacción anotó: se deshizo, así que nada de eso pasó.
  discardQueued(runner: QueryRunner): void {
    delete runner.data[OUTBOX_KEY];
  }

  // La escucha de una persona en una empresa. Cada quien solo escucha lo suyo: el tema lo decide el
  // servidor con la sesión, no el cliente.
  subscribe(
    companyId: string,
    userId: string,
    options: StreamOptions = {},
  ): AsyncIterableIterator<RealtimeEvent> {
    if (this.bus.subscriberCount(companyId, userId) >= MAX_STREAMS_PER_USER) {
      throw new HttpException(
        'Tienes demasiadas conexiones en vivo abiertas: cierra alguna pestaña e inténtalo de nuevo',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return openStream(this.bus.subscribe(companyId, userId), options);
  }
}
