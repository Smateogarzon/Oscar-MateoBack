import { NotificationChannel } from '../graphql/notification/entities/notification-channel.enum.js';
import { PushStream } from './push-stream.js';
import { RealtimeEventKind, type RealtimeEvent } from './realtime-event.js';
import { openStream } from './realtime-stream.js';

const event = (channel: NotificationChannel, entityId = 'x'): RealtimeEvent => ({
  companyId: 'company-1',
  userId: 'user-1',
  kind: RealtimeEventKind.NOTIFICATION_CREATED,
  channel,
  type: null,
  entityType: null,
  entityId,
  at: new Date('2026-09-23T10:00:00Z'),
});

describe('openStream', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('lets every channel through when none is asked for', async () => {
    const source = new PushStream<RealtimeEvent>();
    const stream = openStream(source);

    source.push(event(NotificationChannel.DISCOUNTS, 'a'));
    source.push(event(NotificationChannel.RETURNS, 'b'));

    expect((await stream.next()).value.entityId).toBe('a');
    expect((await stream.next()).value.entityId).toBe('b');
  });

  it('lets every channel through when the list is empty', async () => {
    const source = new PushStream<RealtimeEvent>();
    const stream = openStream(source, { channels: [] });

    source.push(event(NotificationChannel.RETURNS, 'b'));

    expect((await stream.next()).value.entityId).toBe('b');
  });

  it('only lets through the channels that were asked for', async () => {
    const source = new PushStream<RealtimeEvent>();
    const stream = openStream(source, { channels: [NotificationChannel.RETURNS] });

    source.push(event(NotificationChannel.DISCOUNTS, 'skipped'));
    source.push(event(NotificationChannel.RETURNS, 'kept'));

    expect((await stream.next()).value.entityId).toBe('kept');
  });

  it('waits for the next event of the right channel instead of ending', async () => {
    const source = new PushStream<RealtimeEvent>();
    const stream = openStream(source, { channels: [NotificationChannel.RETURNS] });

    const pending = stream.next();
    source.push(event(NotificationChannel.DISCOUNTS, 'skipped'));
    source.push(event(NotificationChannel.RETURNS, 'kept'));

    expect((await pending).value.entityId).toBe('kept');
  });

  it('closes the listening when the client leaves, even if it is waiting for an event', async () => {
    const source = new PushStream<RealtimeEvent>();
    const stream = openStream(source);
    const pending = stream.next();

    await stream.return?.();

    expect(await pending).toEqual({ done: true, value: undefined });
    expect(source.isClosed).toBe(true);
  });

  it('ends when the source ends', async () => {
    const source = new PushStream<RealtimeEvent>();
    const stream = openStream(source);

    source.close();

    expect(await stream.next()).toEqual({ done: true, value: undefined });
  });

  describe('when the session expires', () => {
    it('closes by itself at that moment, and not before', async () => {
      vi.useFakeTimers();
      const source = new PushStream<RealtimeEvent>();
      const stream = openStream(source, { expiresAt: 5000, now: () => 1000 });

      await vi.advanceTimersByTimeAsync(3999);
      expect(source.isClosed).toBe(false);

      await vi.advanceTimersByTimeAsync(1);
      expect(source.isClosed).toBe(true);
      expect(await stream.next()).toEqual({ done: true, value: undefined });
    });

    it('ends a reader that was waiting for an event', async () => {
      vi.useFakeTimers();
      const source = new PushStream<RealtimeEvent>();
      const stream = openStream(source, { expiresAt: 2000, now: () => 1000 });
      const pending = stream.next();

      await vi.advanceTimersByTimeAsync(1000);

      expect(await pending).toEqual({ done: true, value: undefined });
    });

    it('does not open at all when the session is already over', async () => {
      const source = new PushStream<RealtimeEvent>();
      const stream = openStream(source, { expiresAt: 1000, now: () => 5000 });

      expect(await stream.next()).toEqual({ done: true, value: undefined });
      expect(source.isClosed).toBe(true);
    });

    it('cancels the timer when the client leaves first, so nothing is left pending', async () => {
      vi.useFakeTimers();
      const source = new PushStream<RealtimeEvent>();
      const stream = openStream(source, { expiresAt: 5000, now: () => 1000 });

      await stream.return?.();

      expect(vi.getTimerCount()).toBe(0);
    });

    it('has no limit when the session has no expiry', async () => {
      vi.useFakeTimers();
      const source = new PushStream<RealtimeEvent>();
      openStream(source);

      expect(vi.getTimerCount()).toBe(0);
      await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
      expect(source.isClosed).toBe(false);
    });
  });
});
