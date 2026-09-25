import { HttpException, HttpStatus } from '@nestjs/common';
import { NotificationChannel } from '../graphql/notification/entities/notification-channel.enum.js';
import { InMemoryRealtimeBus } from './in-memory-realtime-bus.js';
import { RealtimeEventKind, type RealtimeEvent } from './realtime-event.js';
import { MAX_STREAMS_PER_USER, RealtimeService } from './realtime.service.js';

const event = (overrides: Partial<RealtimeEvent> = {}): RealtimeEvent => ({
  companyId: 'company-1',
  userId: 'user-1',
  kind: RealtimeEventKind.NOTIFICATION_CREATED,
  channel: NotificationChannel.DISCOUNTS,
  type: null,
  entityType: null,
  entityId: null,
  at: new Date('2026-09-23T10:00:00Z'),
  ...overrides,
});

// Una transacción de TypeORM vista desde lo que este servicio usa de ella
const transaction = (isTransactionActive = true) => {
  const runner = { isTransactionActive, data: {} as Record<string, unknown> };
  return { manager: { queryRunner: runner }, runner };
};

function createService() {
  const bus = {
    publish: vi.fn(),
    subscribe: vi.fn(),
    subscriberCount: vi.fn().mockReturnValue(0),
  };
  const service = new RealtimeService(bus as never);
  return { service, bus };
}

describe('RealtimeService', () => {
  describe('publish', () => {
    it('hands every event to the bus', () => {
      const { service, bus } = createService();
      const events = [event({ userId: 'a' }), event({ userId: 'b' })];

      service.publish(events);

      expect(bus.publish).toHaveBeenCalledTimes(2);
      expect(bus.publish).toHaveBeenNthCalledWith(1, events[0]);
      expect(bus.publish).toHaveBeenNthCalledWith(2, events[1]);
    });

    it('never throws: a failing event does not stop the rest, and does not reach whoever caused it', () => {
      const { service, bus } = createService();
      bus.publish.mockImplementationOnce(() => {
        throw new Error('el bus falló');
      });

      expect(() => service.publish([event({ userId: 'a' }), event({ userId: 'b' })])).not.toThrow();
      expect(bus.publish).toHaveBeenCalledTimes(2);
    });
  });

  describe('publishAfterCommit', () => {
    it('does not publish while the transaction is open: it queues the events in it', () => {
      const { service, bus } = createService();
      const { manager, runner } = transaction();

      service.publishAfterCommit(manager as never, [event({ userId: 'a' })]);
      service.publishAfterCommit(manager as never, [event({ userId: 'b' })]);

      expect(bus.publish).not.toHaveBeenCalled();
      expect(Object.values(runner.data)[0]).toHaveLength(2);
    });

    it('publishes right away when there is no transaction to wait for', () => {
      const { service, bus } = createService();

      service.publishAfterCommit({} as never, [event()]);
      service.publishAfterCommit(transaction(false).manager as never, [event()]);

      expect(bus.publish).toHaveBeenCalledTimes(2);
    });

    it('does nothing when there are no events', () => {
      const { service, bus } = createService();
      const { manager, runner } = transaction();

      service.publishAfterCommit(manager as never, []);

      expect(bus.publish).not.toHaveBeenCalled();
      expect(runner.data).toEqual({});
    });
  });

  describe('flushCommitted', () => {
    it('publishes what the transaction queued, once it was committed', () => {
      const { service, bus } = createService();
      const { manager, runner } = transaction();
      service.publishAfterCommit(manager as never, [event({ userId: 'a' }), event({ userId: 'b' })]);

      service.flushCommitted(runner as never);

      expect(bus.publish).toHaveBeenCalledTimes(2);
      expect(runner.data).toEqual({});
    });

    it('does not publish the same events twice', () => {
      const { service, bus } = createService();
      const { manager, runner } = transaction();
      service.publishAfterCommit(manager as never, [event()]);

      service.flushCommitted(runner as never);
      service.flushCommitted(runner as never);

      expect(bus.publish).toHaveBeenCalledTimes(1);
    });

    it('does nothing when the transaction queued nothing', () => {
      const { service, bus } = createService();

      service.flushCommitted(transaction().runner as never);

      expect(bus.publish).not.toHaveBeenCalled();
    });
  });

  describe('discardQueued', () => {
    it('throws away what a rolled back transaction queued: none of it happened', () => {
      const { service, bus } = createService();
      const { manager, runner } = transaction();
      service.publishAfterCommit(manager as never, [event()]);

      service.discardQueued(runner as never);
      service.flushCommitted(runner as never);

      expect(bus.publish).not.toHaveBeenCalled();
      expect(runner.data).toEqual({});
    });
  });

  describe('subscribe', () => {
    it('listens to the topic of that user in that company', () => {
      const { service, bus } = createService();
      bus.subscribe.mockReturnValue({ next: vi.fn(), return: vi.fn() });

      service.subscribe('company-1', 'user-1');

      expect(bus.subscribe).toHaveBeenCalledWith('company-1', 'user-1');
    });

    it('only lets the channels that were asked for through', async () => {
      const realBus = new InMemoryRealtimeBus();
      const service = new RealtimeService(realBus);
      const stream = service.subscribe('company-1', 'user-1', {
        channels: [NotificationChannel.RETURNS],
      });

      realBus.publish(event({ channel: NotificationChannel.DISCOUNTS, entityId: 'skipped' }));
      realBus.publish(event({ channel: NotificationChannel.RETURNS, entityId: 'kept' }));

      expect((await stream.next()).value.entityId).toBe('kept');
    });

    it('refuses to open more connections than a person is allowed', () => {
      const { service, bus } = createService();
      bus.subscriberCount.mockReturnValue(MAX_STREAMS_PER_USER);

      try {
        service.subscribe('company-1', 'user-1');
        expect.unreachable('debió rechazar la conexión');
      } catch (error) {
        expect(error).toBeInstanceOf(HttpException);
        expect((error as HttpException).getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
      }
      expect(bus.subscribe).not.toHaveBeenCalled();
    });

    it('lets one more in while under the limit', () => {
      const { service, bus } = createService();
      bus.subscriberCount.mockReturnValue(MAX_STREAMS_PER_USER - 1);
      bus.subscribe.mockReturnValue({ next: vi.fn(), return: vi.fn() });

      expect(() => service.subscribe('company-1', 'user-1')).not.toThrow();
    });

    it('counts the connections of each company apart', () => {
      const { service, bus } = createService();
      bus.subscribe.mockReturnValue({ next: vi.fn(), return: vi.fn() });

      service.subscribe('company-1', 'user-1');
      service.subscribe('company-2', 'user-1');

      expect(bus.subscriberCount).toHaveBeenNthCalledWith(1, 'company-1', 'user-1');
      expect(bus.subscriberCount).toHaveBeenNthCalledWith(2, 'company-2', 'user-1');
    });
  });
});
