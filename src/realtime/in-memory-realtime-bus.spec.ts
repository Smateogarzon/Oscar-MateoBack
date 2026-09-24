import { NotificationChannel } from '../graphql/notification/entities/notification-channel.enum.js';
import { InMemoryRealtimeBus } from './in-memory-realtime-bus.js';
import { RealtimeEventKind, type RealtimeEvent } from './realtime-event.js';

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

describe('InMemoryRealtimeBus', () => {
  it('delivers an event to whoever listens to the topic of that user in that company', async () => {
    const bus = new InMemoryRealtimeBus();
    const stream = bus.subscribe('company-1', 'user-1');

    bus.publish(event({ entityId: 'req-1' }));

    const result = await stream.next();
    expect(result.done).toBe(false);
    expect(result.value.entityId).toBe('req-1');
  });

  it('does not deliver it to anyone else: another user, or the same user in another company', async () => {
    const bus = new InMemoryRealtimeBus();
    const otherUser = bus.subscribe('company-1', 'user-2');
    const otherCompany = bus.subscribe('company-2', 'user-1');
    const owner = bus.subscribe('company-1', 'user-1');

    bus.publish(event());
    await owner.next();

    // Lo que le llegó a los otros dos es nada: si hubiera algo, next() resolvería ya
    const nothing = Symbol('nothing');
    const race = (stream: AsyncIterableIterator<RealtimeEvent>) =>
      Promise.race([stream.next(), Promise.resolve(nothing)]);
    expect(await race(otherUser)).toBe(nothing);
    expect(await race(otherCompany)).toBe(nothing);
  });

  it('delivers it to every open connection of the same user (one per tab)', async () => {
    const bus = new InMemoryRealtimeBus();
    const tabOne = bus.subscribe('company-1', 'user-1');
    const tabTwo = bus.subscribe('company-1', 'user-1');

    bus.publish(event());

    expect((await tabOne.next()).done).toBe(false);
    expect((await tabTwo.next()).done).toBe(false);
  });

  it('counts the open connections of a topic, and stops counting the ones that were closed', async () => {
    const bus = new InMemoryRealtimeBus();
    expect(bus.subscriberCount('company-1', 'user-1')).toBe(0);

    const first = bus.subscribe('company-1', 'user-1');
    bus.subscribe('company-1', 'user-1');
    expect(bus.subscriberCount('company-1', 'user-1')).toBe(2);

    await first.return?.();
    expect(bus.subscriberCount('company-1', 'user-1')).toBe(1);
  });

  it('does not accumulate topics: one without listeners is forgotten', async () => {
    const bus = new InMemoryRealtimeBus();
    const stream = bus.subscribe('company-1', 'user-1');

    await stream.return?.();

    expect(bus.subscriberCount('company-1', 'user-1')).toBe(0);
    // Y se puede volver a escuchar el mismo tema sin problema
    const again = bus.subscribe('company-1', 'user-1');
    bus.publish(event());
    expect((await again.next()).done).toBe(false);
  });

  it('does nothing when nobody is listening', () => {
    const bus = new InMemoryRealtimeBus();

    expect(() => bus.publish(event())).not.toThrow();
  });

  it('stops delivering to a connection once it was closed', async () => {
    const bus = new InMemoryRealtimeBus();
    const stream = bus.subscribe('company-1', 'user-1');
    await stream.return?.();

    bus.publish(event());

    expect(await stream.next()).toEqual({ done: true, value: undefined });
  });
});
