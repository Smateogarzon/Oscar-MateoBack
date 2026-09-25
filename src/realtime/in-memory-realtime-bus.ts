import { Injectable } from '@nestjs/common';
import { PushStream } from './push-stream.js';
import { RealtimeBus } from './realtime-bus.js';
import type { RealtimeEvent } from './realtime-event.js';

// Cada persona escucha un tema: su usuario dentro de una empresa. Un usuario que trabaja en dos
// empresas tiene un tema en cada una.
const topicOf = (companyId: string, userId: string) => `${companyId}:${userId}`;

// El bus en la memoria de este proceso. Solo alcanza a las conexiones abiertas en ESTA instancia del
// backend: mientras haya una sola, es todo lo que hace falta. Si algún día hay varias, se cambia por
// otro bus (ver RealtimeBus) sin tocar nada más.
@Injectable()
export class InMemoryRealtimeBus extends RealtimeBus {
  private readonly topics = new Map<string, Set<PushStream<RealtimeEvent>>>();

  publish(event: RealtimeEvent): void {
    const streams = this.topics.get(topicOf(event.companyId, event.userId));
    if (!streams) return;

    for (const stream of streams) stream.push(event);
  }

  subscribe(companyId: string, userId: string): AsyncIterableIterator<RealtimeEvent> {
    const topic = topicOf(companyId, userId);
    const streams = this.topics.get(topic) ?? new Set<PushStream<RealtimeEvent>>();

    const stream = new PushStream<RealtimeEvent>(() => {
      streams.delete(stream);
      // El tema se borra cuando se queda sin escuchas, para no acumular uno por cada usuario que pasó
      if (streams.size === 0 && this.topics.get(topic) === streams) this.topics.delete(topic);
    });

    streams.add(stream);
    this.topics.set(topic, streams);
    return stream;
  }

  subscriberCount(companyId: string, userId: string): number {
    return this.topics.get(topicOf(companyId, userId))?.size ?? 0;
  }
}
