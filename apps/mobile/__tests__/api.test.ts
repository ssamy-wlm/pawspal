import { ApiError, errorKey, requestOtp, uploadPhoto, verifyOtp } from '../src/lib/api';
import { supabase } from '../src/lib/supabase';

const fetchMock = jest.fn();
beforeEach(() => { fetchMock.mockReset(); (global as unknown as { fetch: unknown }).fetch = fetchMock; });
const reply = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body, arrayBuffer: async () => new ArrayBuffer(8) });

describe('requestOtp', () => {
  it('posts the number and a device id (not a hash, the server hashes) to the request-otp function', async () => {
    fetchMock.mockResolvedValueOnce(reply(200, { ok: true, resend_after_seconds: 60 }));
    await expect(requestOtp('010 1234 5678')).resolves.toEqual({ ok: true, resend_after_seconds: 60 });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://localhost:54321/functions/v1/request-otp');
    expect(JSON.parse(init.body)).toEqual({ phone: '010 1234 5678', device_id: expect.stringMatching(/^[0-9a-f-]{20,}$/) });
    expect(init.headers.authorization).toBeUndefined();
  });

  it('throws an ApiError carrying the code the server gave', async () => {
    fetchMock.mockResolvedValueOnce(reply(429, { error: 'phone_limit' }));
    await expect(requestOtp('0101')).rejects.toMatchObject({ code: 'phone_limit', status: 429 });
  });

  it('reports a lost connection as "network"', async () => {
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    await expect(requestOtp('0101')).rejects.toMatchObject({ code: 'network' });
  });
});

describe('verifyOtp', () => {
  it('signs in with the session the server returns', async () => {
    const set = jest.spyOn(supabase.auth, 'setSession').mockResolvedValue({ data: { session: null, user: null }, error: null } as never);
    fetchMock.mockResolvedValueOnce(reply(200, { access_token: 'a', refresh_token: 'r', user: { id: 'u' } }));
    await verifyOtp('0101', '123456');
    expect(set).toHaveBeenCalledWith({ access_token: 'a', refresh_token: 'r' });
    set.mockRestore();
  });

  it('does not sign in on a wrong code', async () => {
    const set = jest.spyOn(supabase.auth, 'setSession');
    fetchMock.mockResolvedValueOnce(reply(401, { error: 'invalid_code' }));
    await expect(verifyOtp('0101', '000000')).rejects.toMatchObject({ code: 'invalid_code' });
    expect(set).not.toHaveBeenCalled();
    set.mockRestore();
  });
});

describe('uploadPhoto', () => {
  it('uploads the raw photo to the private incoming folder, then asks the server to clean it', async () => {
    jest.spyOn(supabase.auth, 'getSession').mockResolvedValue({ data: { session: { access_token: 'tok' } }, error: null } as never);
    jest.spyOn(supabase.auth, 'getUser').mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null } as never);
    const upload = jest.fn(async () => ({ error: null }));
    const from = jest.spyOn(supabase.storage, 'from').mockReturnValue({ upload } as never);
    fetchMock.mockResolvedValueOnce(reply(200, {}))                           // reading the local file
      .mockResolvedValueOnce(reply(200, { path: 'user-1/clean.jpg' }));       // process-upload
    await expect(uploadPhoto('home', 'file:///p.jpg')).resolves.toBe('user-1/clean.jpg');
    expect(from).toHaveBeenCalledWith('incoming');
    expect((upload.mock.calls[0] as unknown as string[])[0]).toMatch(/^user-1\/.+\.jpg$/);
    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe('http://localhost:54321/functions/v1/process-upload');
    expect(init.headers.authorization).toBe('Bearer tok');
    expect(JSON.parse(init.body)).toMatchObject({ kind: 'home' });
    jest.restoreAllMocks();
  });
});

describe('errorKey', () => {
  it('has a plain sentence for every code the functions can return', () => {
    const codes = ['invalid_phone', 'phone_limit', 'device_limit', 'too_many_attempts', 'captcha_required', 'too_soon', 'send_failed',
      'invalid_code', 'try_again_later', 'not_configured', 'identity_refused', 'invalid_image', 'network'];
    for (const c of codes) expect(errorKey(new ApiError(c, 400))).not.toBe('err.generic');
    expect(errorKey(new ApiError('something_new', 500))).toBe('err.generic');
    expect(errorKey(new Error('x'))).toBe('err.generic');
  });
});
