import { scrubBreadcrumb, scrubEvent, scrubString, scrubValue } from '../src/lib/scrub';

describe('scrubString', () => {
  it.each([
    ['an email', 'failed for sara.k+test@example.com today', 'sara.k+test@example.com'],
    ['a push token', 'token ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx] failed', 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]'],
    ['a sign-in token', 'jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnop bad', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnop'],
    ['a bearer header', 'Authorization: Bearer abcdef0123456789', 'abcdef0123456789'],
    ['an Egyptian phone number', 'call +20 100 123 4567 now', '100 123 4567'],
    ['a local phone number', 'call 01001234567 now', '01001234567'],
    ['a user id', 'user 3f2b8c1e-9a4d-4e0b-8c3f-1a2b3c4d5e6f not found', '3f2b8c1e-9a4d-4e0b-8c3f-1a2b3c4d5e6f'],
    ['a coordinate pair', 'pin at 28.50934, 34.51212 saved', '28.50934'],
    ['a long opaque string', 'code A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8', 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8'],
    ['a one-time code', 'otp 123456789', '123456789'],
  ])('removes %s', (_name, input, secret) => {
    const out = scrubString(input);
    expect(out).not.toContain(secret);
    expect(out).toContain('[removed]');
  });

  it('keeps plain error text and short numbers', () => {
    expect(scrubString('Undefined is not a function at line 42')).toBe('Undefined is not a function at line 42');
    expect(scrubString('Network request failed (status 500)')).toBe('Network request failed (status 500)');
  });
});

describe('scrubValue', () => {
  it('drops values under private-looking keys and cleans the rest, however deep', () => {
    const out = scrubValue({ password: 'hunter2', nested: { Authorization: 'x', ok: 'fine', mail: 'a@b.co', list: ['a@b.co', 'plain'] }, n: 3 });
    expect(out).toEqual({ password: '[removed]', nested: { Authorization: '[removed]', ok: 'fine', mail: '[removed]', list: ['[removed]', 'plain'] }, n: 3 });
  });
});

describe('scrubEvent', () => {
  const event = {
    user: { id: 'u1', email: 'a@b.co', ip_address: '1.2.3.4' },
    request: { url: 'https://x.supabase.co/rest/v1/messages', data: '{"body":"hello Sara"}', headers: { authorization: 'Bearer abcdefgh1234' } },
    breadcrumbs: [{ category: 'ui.click', message: 'Send message' }],
    server_name: 'my-phone',
    message: 'Could not send to sara@example.com',
    exception: { values: [{ type: 'Error', value: 'bad token ExponentPushToken[abc123def456]', stacktrace: { frames: [{ filename: 'app/chat/[id].tsx', lineno: 10 }] } }] },
    tags: { screen: 'chat', contact: 'sara@example.com' },
    extra: { messageText: 'see you at 28.51234, 34.51234' },
    contexts: { device: { model: 'Pixel' } },
  };

  it('removes the user, the request, breadcrumbs and the server name, and cleans every text', () => {
    const out = scrubEvent(event);
    expect(out.user).toBeUndefined();
    expect(out.request).toBeUndefined();
    expect(out.breadcrumbs).toBeUndefined();
    expect(out.server_name).toBeUndefined();
    const text = JSON.stringify(out);
    for (const secret of ['sara@example.com', 'ExponentPushToken', 'hello Sara', '1.2.3.4', '28.51234', 'Send message']) expect(text).not.toContain(secret);
    expect(out.exception?.values?.[0].stacktrace).toEqual(event.exception.values[0].stacktrace);   // file names and lines stay
    expect(out.contexts).toEqual({ device: { model: 'Pixel' } });
  });
});

describe('scrubBreadcrumb', () => {
  it.each(['ui.click', 'ui.input', 'console', 'xhr', 'fetch', 'navigation', 'touch'])('drops %s breadcrumbs', (category) => {
    expect(scrubBreadcrumb({ category, message: 'anything' })).toBeNull();
  });
  it('drops user and http typed breadcrumbs and cleans the others', () => {
    expect(scrubBreadcrumb({ type: 'user', category: 'x' })).toBeNull();
    expect(scrubBreadcrumb({ type: 'http', category: 'x' })).toBeNull();
    expect(scrubBreadcrumb({ category: 'app.lifecycle', message: 'for a@b.co', data: { token: 't' } })).toEqual({ category: 'app.lifecycle', message: 'for [removed]', data: { token: '[removed]' } });
  });
});
