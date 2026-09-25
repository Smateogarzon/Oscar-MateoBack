// Un flujo de eventos que se alimenta desde afuera (`push`) y se lee como un iterador asíncrono, que
// es lo que una suscripción de GraphQL espera. No es un generador (`async function*`) a propósito:
// un generador detenido esperando el siguiente evento no atiende `return()` hasta que llegue uno, y
// GraphQL llama a `return()` justo cuando el cliente se desconecta, así que la escucha se quedaría
// abierta para siempre.
//
// Si quien lee es más lento que quien escribe, se guardan a lo sumo `maxBuffered` eventos y se
// descartan los más viejos: son señales de "algo cambió", así que perder alguna no importa (la
// siguiente hace volver a consultar).
const DEFAULT_MAX_BUFFERED = 200;

export class PushStream<T> implements AsyncIterableIterator<T> {
  private readonly buffer: T[] = [];
  private readonly waiting: Array<(result: IteratorResult<T>) => void> = [];
  private closed = false;

  constructor(
    // Se llama una sola vez, al cerrarse, para que quien lo creó deje de alimentarlo
    private readonly onClose: () => void = () => undefined,
    private readonly maxBuffered: number = DEFAULT_MAX_BUFFERED,
  ) {}

  get isClosed(): boolean {
    return this.closed;
  }

  push(value: T): void {
    if (this.closed) return;

    const waiter = this.waiting.shift();
    if (waiter) {
      waiter({ done: false, value });
      return;
    }

    this.buffer.push(value);
    if (this.buffer.length > this.maxBuffered) this.buffer.shift();
  }

  next(): Promise<IteratorResult<T>> {
    if (this.buffer.length > 0) {
      return Promise.resolve({ done: false, value: this.buffer.shift() as T });
    }
    if (this.closed) return Promise.resolve({ done: true, value: undefined });

    return new Promise((resolve) => this.waiting.push(resolve));
  }

  // Lo llama GraphQL cuando el cliente cierra la suscripción o se desconecta.
  return(): Promise<IteratorResult<T>> {
    this.close();
    return Promise.resolve({ done: true, value: undefined });
  }

  throw(error: unknown): Promise<IteratorResult<T>> {
    this.close();
    return Promise.reject(error);
  }

  // Cierra el flujo: quien esté esperando el siguiente evento termina, y lo que quedara sin leer se
  // descarta. Cerrarlo dos veces no hace nada.
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.buffer.length = 0;
    for (const waiter of this.waiting.splice(0)) waiter({ done: true, value: undefined });
    this.onClose();
  }

  [Symbol.asyncIterator](): AsyncIterableIterator<T> {
    return this;
  }
}
