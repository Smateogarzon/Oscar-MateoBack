import { PushStream } from './push-stream.js';

describe('PushStream', () => {
  it('hands out what was pushed, in the order it came', async () => {
    const stream = new PushStream<number>();

    stream.push(1);
    stream.push(2);

    expect(await stream.next()).toEqual({ done: false, value: 1 });
    expect(await stream.next()).toEqual({ done: false, value: 2 });
  });

  it('answers a reader that was already waiting as soon as something is pushed', async () => {
    const stream = new PushStream<string>();

    const pending = stream.next();
    stream.push('hola');

    expect(await pending).toEqual({ done: false, value: 'hola' });
  });

  it('keeps only the most recent events when the reader falls behind', async () => {
    const stream = new PushStream<number>(() => undefined, 3);

    for (const value of [1, 2, 3, 4, 5]) stream.push(value);

    expect(await stream.next()).toEqual({ done: false, value: 3 });
    expect(await stream.next()).toEqual({ done: false, value: 4 });
    expect(await stream.next()).toEqual({ done: false, value: 5 });
  });

  describe('return, which is what GraphQL calls when the client disconnects', () => {
    it('ends a reader that is waiting for the next event, without waiting for one to arrive', async () => {
      const stream = new PushStream<number>();
      const pending = stream.next();

      const result = await stream.return();

      expect(result).toEqual({ done: true, value: undefined });
      expect(await pending).toEqual({ done: true, value: undefined });
    });

    it('stops listening: nothing pushed afterwards is kept', async () => {
      const stream = new PushStream<number>();
      await stream.return();

      stream.push(1);

      expect(stream.isClosed).toBe(true);
      expect(await stream.next()).toEqual({ done: true, value: undefined });
    });

    it('lets whoever created it know, once, even if it is closed twice', async () => {
      const onClose = vi.fn();
      const stream = new PushStream<number>(onClose);

      await stream.return();
      stream.close();

      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('discards what was left unread', async () => {
      const stream = new PushStream<number>();
      stream.push(1);

      await stream.return();

      expect(await stream.next()).toEqual({ done: true, value: undefined });
    });
  });

  it('ends a for-await loop when it is closed', async () => {
    const stream = new PushStream<number>();
    const seen: number[] = [];
    const loop = (async () => {
      for await (const value of stream) seen.push(value);
    })();

    stream.push(1);
    stream.push(2);
    // Deja que el ciclo lea lo que se empujó antes de cerrar
    await new Promise((resolve) => setTimeout(resolve, 0));
    await stream.return();
    await loop;

    expect(seen).toEqual([1, 2]);
  });

  it('closes and rejects when it is thrown into', async () => {
    const onClose = vi.fn();
    const stream = new PushStream<number>(onClose);

    await expect(stream.throw(new Error('boom'))).rejects.toThrow('boom');
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(stream.isClosed).toBe(true);
  });
});
