import { RealtimeOutboxSubscriber } from './realtime-outbox.subscriber.js';

function createSubscriber() {
  const dataSource = { subscribers: [] as unknown[] };
  const realtime = { flushCommitted: vi.fn(), discardQueued: vi.fn() };
  const subscriber = new RealtimeOutboxSubscriber(dataSource as never, realtime as never);
  return { subscriber, dataSource, realtime };
}

// El evento que TypeORM manda después de un COMMIT o un ROLLBACK
const eventOf = (isTransactionActive: boolean) => ({ queryRunner: { isTransactionActive } });

describe('RealtimeOutboxSubscriber', () => {
  it('registers itself with TypeORM, which is how it hears about commits', () => {
    const { subscriber, dataSource } = createSubscriber();

    expect(dataSource.subscribers).toContain(subscriber);
  });

  describe('after a commit', () => {
    it('publishes what the transaction queued', () => {
      const { subscriber, realtime } = createSubscriber();
      const event = eventOf(false);

      subscriber.afterTransactionCommit(event as never);

      expect(realtime.flushCommitted).toHaveBeenCalledWith(event.queryRunner);
    });

    it('waits when a transaction is still open: committing a savepoint confirms nothing yet', () => {
      const { subscriber, realtime } = createSubscriber();

      subscriber.afterTransactionCommit(eventOf(true) as never);

      expect(realtime.flushCommitted).not.toHaveBeenCalled();
    });

    it('never throws: the commit already happened, and the error would reach the caller as if it had failed', () => {
      const { subscriber, realtime } = createSubscriber();
      realtime.flushCommitted.mockImplementation(() => {
        throw new Error('falló');
      });

      expect(() => subscriber.afterTransactionCommit(eventOf(false) as never)).not.toThrow();
    });
  });

  describe('after a rollback', () => {
    it('discards what the transaction queued', () => {
      const { subscriber, realtime } = createSubscriber();
      const event = eventOf(false);

      subscriber.afterTransactionRollback(event as never);

      expect(realtime.discardQueued).toHaveBeenCalledWith(event.queryRunner);
    });

    it('waits when an outer transaction is still open', () => {
      const { subscriber, realtime } = createSubscriber();

      subscriber.afterTransactionRollback(eventOf(true) as never);

      expect(realtime.discardQueued).not.toHaveBeenCalled();
    });

    it('never throws', () => {
      const { subscriber, realtime } = createSubscriber();
      realtime.discardQueued.mockImplementation(() => {
        throw new Error('falló');
      });

      expect(() => subscriber.afterTransactionRollback(eventOf(false) as never)).not.toThrow();
    });
  });
});
