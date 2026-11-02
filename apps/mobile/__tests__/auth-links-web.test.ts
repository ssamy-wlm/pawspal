import { Platform } from 'react-native';
import { authCallbackUrl, authLinkKind, authResetUrl, forgetTokensInAddressBar, handleAuthUrl, isAuthUrl, parseAuthUrl } from '../src/lib/authLinks';
import { supabase } from '../src/lib/supabase';

const ORIGIN = 'https://app.pawspal.example';
const g = globalThis as unknown as { window?: unknown };
let original: unknown;
const replaceState = jest.fn();
let setSession: jest.SpyInstance;

beforeEach(() => {
  original = g.window;
  g.window = { location: { origin: ORIGIN, pathname: '/auth/callback', href: `${ORIGIN}/auth/callback#access_token=A` }, history: { state: null, replaceState } };
  jest.replaceProperty(Platform, 'OS', 'web');
  replaceState.mockReset();
  setSession = jest.spyOn(supabase.auth, 'setSession');
  setSession.mockResolvedValue({ data: { session: null, user: null }, error: null } as never);
});
afterEach(() => { jest.restoreAllMocks(); g.window = original; });

describe('email links on the web', () => {
  it('send people back to the web page itself', () => {
    expect(authCallbackUrl()).toBe(`${ORIGIN}/auth/callback`);
    expect(authResetUrl()).toBe(`${ORIGIN}/auth/reset`);
  });

  it('keep the pawspal:// links on a phone', () => {
    jest.replaceProperty(Platform, 'OS', 'ios');
    expect(authCallbackUrl()).toBe('pawspal://auth/callback');
    expect(authResetUrl()).toBe('pawspal://auth/reset');
  });

  it('recognise this site\'s own links, with the tokens in the fragment or the query', () => {
    expect(isAuthUrl(`${ORIGIN}/auth/callback#access_token=a&refresh_token=r&type=signup`)).toBe(true);
    expect(isAuthUrl(`${ORIGIN}/auth/reset?access_token=a`)).toBe(true);
    expect(isAuthUrl(`${ORIGIN}/auth/callback/`)).toBe(true);
    expect(authLinkKind(`${ORIGIN}/auth/reset#x=1`)).toBe('reset');
    expect(authLinkKind(`${ORIGIN}/auth/callback`)).toBe('callback');
    expect(authLinkKind('pawspal://auth/reset')).toBe('reset');
  });

  it('refuse other sites, look-alike hosts and other pages', () => {
    expect(isAuthUrl('https://evil.example/auth/callback#access_token=a')).toBe(false);
    expect(isAuthUrl(`${ORIGIN}.evil.example/auth/callback`)).toBe(false);
    expect(isAuthUrl(`${ORIGIN}/authentic`)).toBe(false);
    expect(isAuthUrl(`${ORIGIN}/signin`)).toBe(false);
    expect(isAuthUrl(null)).toBe(false);
  });

  it('are not recognised as web links on a phone', () => {
    jest.replaceProperty(Platform, 'OS', 'ios');
    expect(isAuthUrl(`${ORIGIN}/auth/callback#access_token=a`)).toBe(false);
  });

  it('read the tokens and sign the person in', async () => {
    expect(parseAuthUrl(`${ORIGIN}/auth/callback#access_token=a.b&refresh_token=r1&type=signup`)).toEqual({ accessToken: 'a.b', refreshToken: 'r1', type: 'signup', failed: false });
    await expect(handleAuthUrl(`${ORIGIN}/auth/callback#access_token=A&refresh_token=R&type=signup`)).resolves.toBe('signed_in');
    expect(setSession).toHaveBeenCalledWith({ access_token: 'A', refresh_token: 'R' });
  });

  it('treat the reset address as a password reset, and a failed link as an error', async () => {
    await expect(handleAuthUrl(`${ORIGIN}/auth/reset#access_token=A&refresh_token=R`)).resolves.toBe('recovery');
    await expect(handleAuthUrl(`${ORIGIN}/auth/callback#error=access_denied&error_code=otp_expired`)).resolves.toBe('error');
    await expect(handleAuthUrl('https://evil.example/auth/callback#access_token=A&refresh_token=R')).resolves.toBe('error');
    expect(setSession).toHaveBeenCalledTimes(1);
  });

  it('take the tokens out of the address bar afterwards', () => {
    forgetTokensInAddressBar();
    expect(replaceState).toHaveBeenCalledWith(null, '', '/auth/callback');
  });

  it('leave the address alone on a phone', () => {
    jest.replaceProperty(Platform, 'OS', 'ios');
    forgetTokensInAddressBar();
    expect(replaceState).not.toHaveBeenCalled();
  });
});
