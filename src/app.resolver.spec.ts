import { AppResolver } from './app.resolver.js';

describe('AppResolver', () => {
  it('returns "pong"', () => {
    const resolver = new AppResolver();
    expect(resolver.ping()).toBe('pong');
  });
});
