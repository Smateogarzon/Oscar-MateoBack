import { Module } from '@nestjs/common';
import { InMemoryRealtimeBus } from './in-memory-realtime-bus.js';
import { RealtimeBus } from './realtime-bus.js';
import { RealtimeOutboxSubscriber } from './realtime-outbox.subscriber.js';
import { RealtimeResolver } from './realtime.resolver.js';
import { RealtimeService } from './realtime.service.js';

// El tiempo real: quien cambia algo publica una señal (RealtimeService) y las conexiones abiertas de
// cada persona la reciben (RealtimeResolver). Por dónde viajan se decide aquí: hoy, la memoria de este
// proceso; con varias instancias del backend, se cambia el bus por otro (ver RealtimeBus).
@Module({
  providers: [
    { provide: RealtimeBus, useClass: InMemoryRealtimeBus },
    RealtimeService,
    RealtimeOutboxSubscriber,
    RealtimeResolver,
  ],
  exports: [RealtimeService],
})
export class RealtimeModule {}
