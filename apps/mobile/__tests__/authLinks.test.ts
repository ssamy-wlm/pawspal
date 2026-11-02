import { handleAuthUrl, isAuthUrl, parseAuthUrl } from '../src/lib/authLinks';
import { supabase } from '../src/lib/supabase';

const setSession = jest.spyOn(supabase.auth, 'setSession');
beforeEach(() => { setSession.mockReset(); setSession.mockResolvedValue({ data: { session: null, user: null }, error: null } as never); });

describe('parseAuthUrl', () => {
  it('reads tokens from the fragment', () => {
    expect(parseAuthUrl('pawspal://auth/callback#access_token=a.b&refresh_token=r1&type=signup')).toEqual({ accessToken: 'a.b', refreshToken: 'r1', type: 'signup', failed: false });
  });
  it('reads tokens from the query', () => {
    expect(parseAuthUrl('pawspal://auth/reset?access_token=a&refresh_token=r&type=recovery')).toMatchObject({ accessToken: 'a', refreshToken: 'r', type: 'recovery' });
  });
  it('decodes values and flags errors', () => {
    expect(parseAuthUrl('pawspal://auth/callback#error=access_denied&error_description=Link+expired%21').failed).toBe(true);
    expect(parseAuthUrl('pawspal://auth/callback#access_token=a%2Bb&refresh_token=r').accessToken).toBe('a+b');
  });
  it('returns nothing for a link without tokens', () => {
    expect(parseAuthUrl('pawspal://auth/callback')).toEqual({ accessToken: null, refreshToken: null, type: null, failed: false });
  });
});

describe('isAuthUrl', () => {
  it('accepts only our auth links', () => {
    expect(isAuthUrl('pawspal://auth/callback#a=b')).toBe(true);
    expect(isAuthUrl('pawspal://auth/reset')).toBe(true);
    expect(isAuthUrl('pawspal://chat/1')).toBe(false);
    expect(isAuthUrl('https://example.com/auth/callback')).toBe(false);
    expect(isAuthUrl(null)).toBe(false);
  });
});

describe('handleAuthUrl', () => {
  it.each([['signup', 'signed_in'], ['magiclink', 'signed_in'], ['recovery', 'recovery']] as const)('type %s gives %s and sets the session', async (type, result) => {
    await expect(handleAuthUrl(`pawspal://auth/callback#access_token=A&refresh_token=R&type=${type}`)).resolves.toBe(result);
    expect(setSession).toHaveBeenCalledWith({ access_token: 'A', refresh_token: 'R' });
  });
  it('treats the reset address as a recovery', async () => {
    await expect(handleAuthUrl('pawspal://auth/reset#access_token=A&refresh_token=R')).resolves.toBe('recovery');
  });
  it('gives "error" without touching the session when tokens are missing, the link failed or it is not ours', async () => {
    await expect(handleAuthUrl('pawspal://auth/callback')).resolves.toBe('error');
    await expect(handleAuthUrl('pawspal://auth/callback#error=access_denied')).resolves.toBe('error');
    await expect(handleAuthUrl('pawspal://other#access_token=A&refresh_token=R')).resolves.toBe('error');
    expect(setSession).not.toHaveBeenCalled();
  });
  it('gives "error" when the session is refused or throws', async () => {
    setSession.mockResolvedValueOnce({ data: {}, error: { message: 'bad' } } as never);
    await expect(handleAuthUrl('pawspal://auth/callback#access_token=A&refresh_token=R')).resolves.toBe('error');
    setSession.mockRejectedValueOnce(new Error('x'));
    await expect(handleAuthUrl('pawspal://auth/callback#access_token=A&refresh_token=R')).resolves.toBe('error');
  });
  it('never prints the tokens', async () => {
    const spies = (['log', 'warn', 'error', 'info'] as const).map((k) => jest.spyOn(console, k).mockImplementation(() => {}));
    await handleAuthUrl('pawspal://auth/callback#access_token=SECRETTOKEN&refresh_token=SECRETREFRESH&type=signup');
    for (const s of spies) { expect(JSON.stringify(s.mock.calls)).not.toMatch(/SECRET/); s.mockRestore(); }
  });
});
