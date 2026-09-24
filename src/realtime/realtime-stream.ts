import type { NotificationChannel } from '../graphql/notification/entities/notification-channel.enum.js';
import type { RealtimeEvent } from './realtime-event.js';

export interface StreamOptions {
  // Los canales que quiere escuchar; sin indicar, todos
  channels?: NotificationChannel[];
  // Cuándo vence su sesión (milisegundos desde 1970): la escucha se cierra sola en ese momento
  expiresAt?: number;
  // Solo para las pruebas
  now?: () => number;
}

// Lo que ve una suscripción de GraphQL: los eventos de la escucha de un usuario, pero solo de los
// canales que pidió, y sin pasar de cuando vence su sesión. La conexión de un WebSocket dura más que
// un token (1 hora el de un administrador, 24 el de los demás), y el token solo se comprueba al abrir
// la suscripción; por eso la escucha se cierra al vencer: el cliente tiene que volver a abrirla, y
// ahí sí se le comprueba una sesión vigente.
export function openStream(
  source: AsyncIterableIterator<RealtimeEvent>,
  { channels, expiresAt, now = Date.now }: StreamOptions = {},
): AsyncIterableIterator<RealtimeEvent> {
  const wanted = channels && channels.length > 0 ? new Set(channels) : null;

  let timer: ReturnType<typeof setTimeout> | undefined;
  const stopTimer = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  const close = async (): Promise<IteratorResult<RealtimeEvent>> => {
    stopTimer();
    await source.return?.();
    return { done: true, value: undefined };
  };

  if (expiresAt !== undefined) {
    const remaining = expiresAt - now();
    if (remaining <= 0) {
      void close();
    } else {
      timer = setTimeout(() => void close(), remaining);
      // Un temporizador pendiente no debe impedir que el proceso termine
      timer.unref?.();
    }
  }

  const stream: AsyncIterableIterator<RealtimeEvent> = {
    async next() {
      for (;;) {
        const result = await source.next();
        if (result.done) {
          stopTimer();
          return { done: true, value: undefined };
        }
        if (!wanted || wanted.has(result.value.channel)) return result;
      }
    },
    return: close,
    async throw(error: unknown) {
      await close();
      throw error;
    },
    [Symbol.asyncIterator]() {
      return stream;
    },
  };
  return stream;
}
