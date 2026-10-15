import { isAllowedPushEndpoint } from './push-endpoint.js';

describe('isAllowedPushEndpoint', () => {
  it.each([
    'https://fcm.googleapis.com/fcm/send/abc123',
    'https://updates.push.services.mozilla.com/wpush/v2/xyz',
    'https://web.push.apple.com/QabcDEF',
    'https://db5p.notify.windows.com/?token=1',
  ])('accepts a known push service: %s', (endpoint) => {
    expect(isAllowedPushEndpoint(endpoint)).toBe(true);
  });

  it('refuses plain http, even for a known service', () => {
    expect(isAllowedPushEndpoint('http://fcm.googleapis.com/fcm/send/abc')).toBe(false);
  });

  it('refuses any other host, so the server never calls an address it does not know', () => {
    expect(isAllowedPushEndpoint('https://evil.example.com/collect')).toBe(false);
    expect(isAllowedPushEndpoint('https://fcm.googleapis.com.evil.example.com/x')).toBe(false);
    expect(isAllowedPushEndpoint('https://169.254.169.254/latest/meta-data')).toBe(false);
  });

  it('refuses what is not a URL and an endpoint too long to store', () => {
    expect(isAllowedPushEndpoint('no es una url')).toBe(false);
    expect(isAllowedPushEndpoint(`https://fcm.googleapis.com/${'a'.repeat(1100)}`)).toBe(false);
  });
});
