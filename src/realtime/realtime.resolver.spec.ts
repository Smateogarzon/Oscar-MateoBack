import { NotificationChannel } from '../graphql/notification/entities/notification-channel.enum.js';
import { RealtimeResolver } from './realtime.resolver.js';

function createResolver() {
  const stream = { next: vi.fn(), return: vi.fn() };
  const realtime = { subscribe: vi.fn().mockReturnValue(stream) };
  const resolver = new RealtimeResolver(realtime as never);
  return { resolver, realtime, stream };
}

describe('RealtimeResolver', () => {
  it('opens the listening of who asks, in the active company', () => {
    const { resolver, realtime, stream } = createResolver();

    const result = resolver.notificationEvents('company-1', { sub: 'user-1', email: 'a@b.co' });

    expect(result).toBe(stream);
    expect(realtime.subscribe).toHaveBeenCalledWith('company-1', 'user-1', {
      channels: undefined,
      expiresAt: undefined,
    });
  });

  it('only listens to the channels asked for', () => {
    const { resolver, realtime } = createResolver();

    resolver.notificationEvents('company-1', { sub: 'user-1', email: 'a@b.co' }, [
      NotificationChannel.RETURNS,
    ]);

    expect(realtime.subscribe).toHaveBeenCalledWith(
      'company-1',
      'user-1',
      expect.objectContaining({ channels: [NotificationChannel.RETURNS] }),
    );
  });

  it('closes the listening when the session expires: the token says it in seconds, the service wants milliseconds', () => {
    const { resolver, realtime } = createResolver();

    resolver.notificationEvents('company-1', { sub: 'user-1', email: 'a@b.co', exp: 1_790_000_000 });

    expect(realtime.subscribe).toHaveBeenCalledWith(
      'company-1',
      'user-1',
      expect.objectContaining({ expiresAt: 1_790_000_000_000 }),
    );
  });
});
