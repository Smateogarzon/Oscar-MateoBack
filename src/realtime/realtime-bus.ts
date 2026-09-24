import type { RealtimeEvent } from './realtime-event.js';

// El bus por el que viajan los eventos en vivo: quien cambia algo publica, y cada conexión abierta
// escucha el tema de su usuario. Es una clase abstracta y no una implementación concreta para poder
// cambiar por dónde viajan sin tocar a quien publica ni a quien escucha:
//   - InMemoryRealtimeBus: en la memoria de este proceso. Sirve mientras haya una sola instancia del
//     backend.
//   - cuando haya varias instancias, un bus que pase por Postgres (LISTEN/NOTIFY) o Redis, para que un
//     evento publicado en una llegue a las conexiones abiertas en las otras.
export abstract class RealtimeBus {
  // Reparte el evento a quienes escuchan el tema del usuario al que va dirigido.
  abstract publish(event: RealtimeEvent): void;

  // Abre una escucha del tema de un usuario en una empresa. Quien la abre la cierra con `return()`.
  abstract subscribe(companyId: string, userId: string): AsyncIterableIterator<RealtimeEvent>;

  // Cuántas escuchas abiertas tiene ahora ese tema (en este proceso).
  abstract subscriberCount(companyId: string, userId: string): number;
}
