import { ApiError, authErrorKey, deviceId, errorKey, uploadPhoto } from '../src/lib/api';
import { supabase } from '../src/lib/supabase';

const fetchMock = jest.fn();
beforeEach(() => { fetchMock.mockReset(); (global as unknown as { fetch: unknown }).fetch = fetchMock; });
const reply = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body, arrayBuffer: async () => new ArrayBuffer(8) });

describe('deviceId', () => {
  it('is a random id that stays the same during the session', async () => {
    const a = await deviceId();
    expect(a).toMatch(/^[0-9a-f-]{20,}$/);
    expect(await deviceId()).toBe(a);
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

  it.each(['face', 'id', 'payment'] as const)('sends the %s kind to process-upload', async (kind) => {
    jest.spyOn(supabase.auth, 'getSession').mockResolvedValue({ data: { session: { access_token: 'tok' } }, error: null } as never);
    jest.spyOn(supabase.auth, 'getUser').mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null } as never);
    jest.spyOn(supabase.storage, 'from').mockReturnValue({ upload: jest.fn(async () => ({ error: null })) } as never);
    fetchMock.mockResolvedValueOnce(reply(200, {})).mockResolvedValueOnce(reply(200, { path: 'user-1/x.jpg' }));
    await uploadPhoto(kind, 'file:///p.jpg');
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({ kind });
    jest.restoreAllMocks();
  });

  it('says the photo did not work when the file cannot be read, and sends nothing', async () => {
    jest.spyOn(supabase.auth, 'getSession').mockResolvedValue({ data: { session: { access_token: 'tok' } }, error: null } as never);
    jest.spyOn(supabase.auth, 'getUser').mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null } as never);
    fetchMock.mockRejectedValueOnce(new Error('gone'));
    await expect(uploadPhoto('id', 'file:///p.jpg')).rejects.toMatchObject({ code: 'invalid_image' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    jest.restoreAllMocks();
  });
});

describe('errorKey', () => {
  it('has a plain sentence for the codes the app can show', () => {
    for (const c of ['try_again_later', 'invalid_image', 'network']) expect(errorKey(new ApiError(c, 400))).not.toBe('err.generic');
    expect(errorKey(new ApiError('something_new', 500))).toBe('err.generic');
    expect(errorKey(new Error('x'))).toBe('err.generic');
  });
});

describe('authErrorKey', () => {
  it.each([
    [{ code: 'user_already_exists', status: 422 }, 'err.emailTaken'],
    [{ message: 'User already registered', status: 400 }, 'err.emailTaken'],
    [{ code: 'weak_password', status: 422 }, 'err.weakPassword'],
    [{ code: 'over_email_send_rate_limit', status: 429 }, 'err.rateLimited'],
    [{ status: 429 }, 'err.rateLimited'],
    [{ name: 'AuthRetryableFetchError', status: 0 }, 'err.network'],
    [{ code: 'email_not_confirmed', status: 400 }, 'err.emailNotConfirmed'],
    [{ message: 'Database error saving new user', status: 500 }, 'err.signupRefused'],
    [{ code: 'validation_failed' }, 'err.emailInvalid'],
    [{ code: 'something_else', status: 500 }, 'err.generic'],
    [null, 'err.generic'],
  ])('maps %j to %s', (e, key) => { expect(authErrorKey(e)).toBe(key); });
});
