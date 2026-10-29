import React from 'react';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import * as Location from 'expo-location';
import { COMBOS, renderIn } from '../test-utils/render';
import { setLocaleForTests } from '../src/i18n';
import { ApiError } from '../src/lib/api';
import * as api from '../src/lib/api';
import PhoneStep from '../app/signup/phone';
import SelfieStep from '../app/signup/selfie';
import IdStep from '../app/signup/id';
import AboutStep from '../app/signup/about';
import LocationStep from '../app/signup/location';
import RulesStep from '../app/signup/rules';
import Pending from '../app/pending';

const mockRefresh = jest.fn();
const mockSignOut = jest.fn(async () => {});
let mockState: unknown = null;
jest.mock('../src/lib/auth', () => ({ useAuth: () => ({ ready: true, session: { user: { id: 'u1' } }, state: mockState, refresh: mockRefresh, signOut: mockSignOut }) }));
jest.mock('../src/lib/api', () => ({ ...jest.requireActual('../src/lib/api'), requestOtp: jest.fn(), verifyOtp: jest.fn(), uploadPhoto: jest.fn(), verifyFace: jest.fn(), verifyId: jest.fn() }));

const mockCalls: { table: string; op: string; row?: unknown }[] = [];
const mockRpc = jest.fn();
let mockTables: Record<string, unknown[]> = {};
let mockAcceptError: { code: string } | null = null;
jest.mock('../src/lib/supabase', () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    rpc: (...a: unknown[]) => mockRpc(...a),
    from: (table: string) => ({
      insert: async (row: unknown) => { mockCalls.push({ table, op: 'insert', row }); return { error: table === 'legal_acceptances' ? mockAcceptError : null }; },
      update: (row: unknown) => ({ eq: async () => { mockCalls.push({ table, op: 'update', row }); return { error: null }; } }),
      select: () => {
        const chain: Record<string, unknown> = {};
        for (const k of ['eq', 'in', 'order', 'limit']) chain[k] = () => chain;
        chain.then = (resolve: (v: unknown) => void) => resolve({ data: mockTables[table] ?? [], error: null });
        return chain;
      },
    }),
  },
}));

const m = api as jest.Mocked<typeof api>;
beforeEach(() => {
  jest.clearAllMocks(); mockCalls.length = 0; mockState = null; mockAcceptError = null;
  mockTables = { legal_documents: [{ doc: 'terms', current_version: '1' }, { doc: 'privacy', current_version: '1' }, { doc: 'guidelines', current_version: '1' }] };
  delete process.env.EXPO_PUBLIC_TURNSTILE_SITE_KEY;
  mockRefresh.mockResolvedValue({ status: 'pending_verification', missing: ['face'] });
  mockRpc.mockResolvedValue({ data: 'pending_review', error: null });
});
afterEach(() => setLocaleForTests('en'));

describe.each(COMBOS)('sign-up steps in $mode / $locale', ({ mode, locale }) => {
  const show = (ui: React.ReactElement) => renderIn(ui, { mode, locale });

  it.each([['phone', PhoneStep], ['selfie', SelfieStep], ['id', IdStep], ['about', AboutStep], ['location', LocationStep], ['rules', RulesStep], ['pending', Pending]] as const)(
    'shows the %s screen with a heading', async (_name, Step) => {
      await show(<Step />);
      expect(screen.getAllByRole('header').length).toBeGreaterThan(0);
    });
});

describe('phone step', () => {
  it('asks for a code, then shows a resend timer and lets the person use another number', async () => {
    m.requestOtp.mockResolvedValue({ resend_after_seconds: 60 });
    await renderIn(<PhoneStep />);
    const send = screen.getByText('Send code');
    expect(send).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Mobile number'), '010 1234 5678');
    await fireEvent.press(send);
    await waitFor(() => expect(screen.getByText('Enter your code')).toBeTruthy());
    expect(m.requestOtp).toHaveBeenCalledWith('010 1234 5678', undefined);
    expect(screen.getByText('Send again in 60s')).toBeTruthy();
    expect(screen.queryByText('Send again')).toBeNull();
    await fireEvent.press(screen.getByText('Use another number'));
    expect(screen.getByText('Your phone number')).toBeTruthy();
  });

  it('offers "Send again" once the wait is over', async () => {
    m.requestOtp.mockResolvedValue({ resend_after_seconds: 1 });
    await renderIn(<PhoneStep />);
    await fireEvent.changeText(screen.getByLabelText('Mobile number'), '01012345678');
    await fireEvent.press(screen.getByText('Send code'));
    await waitFor(() => expect(screen.getByText('Send again in 1s')).toBeTruthy());
    await waitFor(() => expect(screen.getByText('Send again')).toBeTruthy(), { timeout: 3000 });
  });

  it('keeps the send button off until a number is typed', async () => {
    await renderIn(<PhoneStep />);
    await fireEvent.press(screen.getByText('Send code'));
    expect(m.requestOtp).not.toHaveBeenCalled();
  });

  it('shows a plain message when the number is not an Egypt number or the limit is reached', async () => {
    m.requestOtp.mockRejectedValueOnce(new ApiError('invalid_phone', 400));
    await renderIn(<PhoneStep />);
    await fireEvent.changeText(screen.getByLabelText('Mobile number'), '+1 555 0100 000');
    await fireEvent.press(screen.getByText('Send code'));
    await waitFor(() => expect(screen.getByText('That does not look like an Egypt mobile number.')).toBeTruthy());
    expect(screen.queryByText('Enter your code')).toBeNull();
  });

  it('signs in with the code and moves to the first step that is missing', async () => {
    m.requestOtp.mockResolvedValue({ resend_after_seconds: 60 });
    m.verifyOtp.mockResolvedValue(undefined);
    await renderIn(<PhoneStep />);
    await fireEvent.changeText(screen.getByLabelText('Mobile number'), '01012345678');
    await fireEvent.press(screen.getByText('Send code'));
    await waitFor(() => screen.getByLabelText('Code'));
    await fireEvent.changeText(screen.getByLabelText('Code'), '12 34-56');
    await fireEvent.press(screen.getByText('Verify'));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/signup/selfie'));
    expect(m.verifyOtp).toHaveBeenCalledWith('01012345678', '123456', undefined);
  });

  it('says so when the code is wrong', async () => {
    m.requestOtp.mockResolvedValue({ resend_after_seconds: 60 });
    m.verifyOtp.mockRejectedValue(new ApiError('invalid_code', 401));
    await renderIn(<PhoneStep />);
    await fireEvent.changeText(screen.getByLabelText('Mobile number'), '01012345678');
    await fireEvent.press(screen.getByText('Send code'));
    await waitFor(() => screen.getByLabelText('Code'));
    await fireEvent.changeText(screen.getByLabelText('Code'), '000000');
    await fireEvent.press(screen.getByText('Verify'));
    await waitFor(() => expect(screen.getByText('That code did not work. Check it and try again.')).toBeTruthy());
    expect(router.replace).not.toHaveBeenCalled();
  });
});

describe('selfie step', () => {
  it('shows the camera with a face guide', async () => {
    await renderIn(<SelfieStep />);
    expect(screen.getByTestId('camera')).toBeTruthy();
    expect(screen.getByLabelText('Face guide: keep your face inside the oval')).toBeTruthy();
  });

  it('uploads the cleaned photo, checks the face and moves on', async () => {
    m.uploadPhoto.mockResolvedValue('u1/clean.jpg');
    m.verifyFace.mockResolvedValue(true);
    mockRefresh.mockResolvedValue({ status: 'pending_verification', missing: ['id'] });
    await renderIn(<SelfieStep />);
    await fireEvent.press(screen.getByText('Take photo'));
    await waitFor(() => screen.getByText('Use this photo'));
    await fireEvent.press(screen.getByText('Use this photo'));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/signup/id'));
    expect(m.uploadPhoto).toHaveBeenCalledWith('face', 'file:///selfie.jpg');
    expect(m.verifyFace).toHaveBeenCalledWith('u1/clean.jpg');
  });

  it('asks for a new photo when no clear face was found', async () => {
    m.uploadPhoto.mockResolvedValue('u1/clean.jpg');
    m.verifyFace.mockResolvedValue(false);
    await renderIn(<SelfieStep />);
    await fireEvent.press(screen.getByText('Take photo'));
    await waitFor(() => screen.getByText('Use this photo'));
    await fireEvent.press(screen.getByText('Use this photo'));
    await waitFor(() => expect(screen.getByText('We could not match a clear face. Try again in good light.')).toBeTruthy());
    expect(screen.getByText('Take photo')).toBeTruthy();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('explains how to allow the camera when it is refused', async () => {
    const cam = jest.requireMock('expo-camera') as { useCameraPermissions: jest.Mock };
    cam.useCameraPermissions.mockReturnValueOnce([{ granted: false, canAskAgain: true }, jest.fn()]);
    await renderIn(<SelfieStep />);
    expect(screen.getByText('Allow camera')).toBeTruthy();
  });
});

describe('ID step', () => {
  it('says we keep no photo of the ID and moves on after a good check', async () => {
    m.verifyId.mockResolvedValue({ ok: true, adult: true });
    mockRefresh.mockResolvedValue({ status: 'pending_verification', missing: ['name'] });
    await renderIn(<IdStep />);
    expect(screen.getByText('We do not keep your ID photo')).toBeTruthy();
    await fireEvent.press(screen.getByText('Start ID check'));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/signup/about'));
  });

  it('stops under-18s and failed checks', async () => {
    m.verifyId.mockResolvedValueOnce({ ok: true, adult: false });
    await renderIn(<IdStep />);
    await fireEvent.press(screen.getByText('Start ID check'));
    await waitFor(() => expect(screen.getByText('You need to be 18 or older to join PawsPal.')).toBeTruthy());
    m.verifyId.mockResolvedValueOnce({ ok: false, adult: true });
    await fireEvent.press(screen.getByText('Start ID check'));
    await waitFor(() => expect(screen.getByText('We could not read your ID. Try again.')).toBeTruthy());
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('shows the "not available yet" message while no ID provider is set up', async () => {
    m.verifyId.mockRejectedValueOnce(new ApiError('not_configured', 503));
    await renderIn(<IdStep />);
    await fireEvent.press(screen.getByText('Start ID check'));
    await waitFor(() => expect(screen.getByText('This step is not available yet. Try again later.')).toBeTruthy());
  });
});

describe('about step', () => {
  it('needs a name, a pet with a photo and a home photo before continuing', async () => {
    m.uploadPhoto.mockResolvedValueOnce('u1/pet.jpg').mockResolvedValueOnce('u1/home.jpg');
    mockRefresh.mockResolvedValue({ status: 'pending_verification', missing: ['location', 'legal'] });
    await renderIn(<AboutStep />);                      // no role chosen yet: "both"
    await fireEvent.press(screen.getByText('Continue'));
    expect(mockCalls).toHaveLength(0);
    await fireEvent.changeText(screen.getByLabelText('First name'), 'Salma');
    await fireEvent.changeText(screen.getByLabelText('Pet name'), 'Biscuit');
    await fireEvent.press(screen.getByText('Cat'));
    await fireEvent.press(screen.getByText('Small'));
    await fireEvent.press(screen.getByText('Add a photo'));
    await waitFor(() => screen.getByText('Photo added'));
    await fireEvent.press(screen.getByText('Continue'));
    expect(mockCalls).toHaveLength(0);                       // the home photo is still missing
    await fireEvent.press(screen.getByText('Add a photo of your home'));
    await waitFor(() => screen.getByText('Home photo added'));
    await fireEvent.press(screen.getByText('Continue'));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/signup/location'));
    expect(mockCalls).toEqual([
      { table: 'profiles', op: 'update', row: { first_name: 'Salma', role: 'both' } },
      { table: 'pets', op: 'insert', row: { owner_id: 'u1', name: 'Biscuit', type: 'cat', size: 'small', photo_paths: ['u1/pet.jpg'] } },
    ]);
    expect(m.uploadPhoto).toHaveBeenNthCalledWith(1, 'pet', 'file:///photo.jpg');
    expect(m.uploadPhoto).toHaveBeenNthCalledWith(2, 'home', 'file:///photo.jpg');
  });

  it('asks owners only for a pet, and sitters only for a home photo', async () => {
    await renderIn(<AboutStep />);
    await fireEvent.press(screen.getByText('I need a sitter'));
    expect(screen.getByText('Your pet')).toBeTruthy();
    expect(screen.queryByText('Your home')).toBeNull();
    await fireEvent.press(screen.getByText('I want to sit'));
    expect(screen.queryByText('Your pet')).toBeNull();
    expect(screen.getByText('Your home')).toBeTruthy();
  });
});

describe('location step', () => {
  it('drops the pin through the server and then continues', async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });
    mockRefresh.mockResolvedValue({ status: 'pending_verification', missing: ['legal'] });
    await renderIn(<LocationStep />);
    await fireEvent.changeText(screen.getByLabelText('Area name (optional)'), 'Masbat');
    await fireEvent.press(screen.getByText('Use my location'));
    await waitFor(() => screen.getByText('Pin dropped'));
    expect(mockRpc).toHaveBeenCalledWith('set_my_location', { p_lat: 28.5, p_lng: 34.5, p_address: 'Masbat' });
    await fireEvent.press(screen.getByText('Continue'));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/signup/rules'));
  });

  it('explains what to do when location is refused, and sends nothing', async () => {
    (Location.requestForegroundPermissionsAsync as jest.Mock).mockResolvedValueOnce({ granted: false });
    await renderIn(<LocationStep />);
    await fireEvent.press(screen.getByText('Use my location'));
    await waitFor(() => expect(screen.getByText('We could not get your location. You can allow it in your phone settings.')).toBeTruthy());
    expect(mockRpc).not.toHaveBeenCalled();
  });
});

describe('rules step', () => {
  const tickAll = async () => {
    for (const name of ['Terms of Service', 'Privacy Policy', 'Community Guidelines']) {
      await fireEvent.press(screen.getByLabelText(`I accept the ${name}`));
    }
  };

  it('stays off until all three documents are ticked', async () => {
    await renderIn(<RulesStep />);
    await fireEvent.press(screen.getByText('Send for review'));
    expect(mockRpc).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByLabelText('I accept the Terms of Service'));
    await fireEvent.press(screen.getByText('Send for review'));
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('records the accepted versions and sends the profile for review', async () => {
    await renderIn(<RulesStep />);
    await tickAll();
    await fireEvent.press(screen.getByText('Send for review'));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/pending'));
    expect(mockCalls.filter((c) => c.table === 'legal_acceptances').map((c) => c.row)).toEqual([
      { user_id: 'u1', doc: 'terms', version: '1' }, { user_id: 'u1', doc: 'privacy', version: '1' }, { user_id: 'u1', doc: 'guidelines', version: '1' },
    ]);
    expect(mockRpc).toHaveBeenCalledWith('submit_profile');
  });

  it('treats an already accepted version as fine, but stops on any other error', async () => {
    mockAcceptError = { code: '23505' };
    await renderIn(<RulesStep />);
    await tickAll();
    await fireEvent.press(screen.getByText('Send for review'));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/pending'));
    (router.replace as jest.Mock).mockClear();
    mockAcceptError = { code: '42501' };
    await fireEvent.press(screen.getByText('Send for review'));
    await waitFor(() => expect(screen.getByText('Something went wrong. Try again.')).toBeTruthy());
    expect(router.replace).not.toHaveBeenCalled();
  });
});

describe('pending screen', () => {
  it('tells people their profile is being checked and lets them sign out', async () => {
    mockState = { status: 'pending_review' };
    await renderIn(<Pending />);
    expect(screen.getByText('We are checking your profile')).toBeTruthy();
    await fireEvent.press(screen.getByText('Sign out'));
    expect(mockSignOut).toHaveBeenCalled();
  });

  it('shows a different message for a suspended account', async () => {
    mockState = { status: 'suspended' };
    await renderIn(<Pending />);
    expect(screen.getByText('This account is not active')).toBeTruthy();
    expect(screen.queryByText('We are checking your profile')).toBeNull();
  });

  it('lets a suspended person read our message and send an appeal, once', async () => {
    mockState = { status: 'suspended' };
    mockTables.enforcement_actions = [{ id: 'act-1', message: 'You broke rule 4.' }];
    await renderIn(<Pending />);
    await waitFor(() => expect(screen.getByText('You broke rule 4.')).toBeTruthy());
    await fireEvent.press(screen.getByText('Send appeal'));
    expect(mockCalls.filter((c) => c.table === 'appeals')).toHaveLength(0);          // nothing typed yet
    await fireEvent.changeText(screen.getByLabelText('Your message'), 'I was away, my friend used the app.');
    await fireEvent.press(screen.getByText('Send appeal'));
    await waitFor(() => expect(screen.getByText('Appeal sent')).toBeTruthy());
    expect(mockCalls.filter((c) => c.table === 'appeals').map((c) => c.row)).toEqual([
      { action_id: 'act-1', user_id: 'u1', body: 'I was away, my friend used the app.' },
    ]);
    expect(screen.queryByText('Send appeal')).toBeNull();
  });

  it('shows "Appeal sent" straight away when an appeal is already open', async () => {
    mockState = { status: 'removed' };
    mockTables.enforcement_actions = [{ id: 'act-1', message: null }];
    mockTables.appeals = [{ id: 'ap-1' }];
    await renderIn(<Pending />);
    await waitFor(() => expect(screen.getByText('Appeal sent')).toBeTruthy());
    expect(screen.queryByLabelText('Your message')).toBeNull();
  });

  it('offers no appeal form to someone who is only waiting for review', async () => {
    mockState = { status: 'pending_review' };
    mockTables.enforcement_actions = [{ id: 'act-1', message: 'x' }];
    await renderIn(<Pending />);
    expect(screen.queryByText('Send appeal')).toBeNull();
  });
});

describe('CAPTCHA (Cloudflare Turnstile)', () => {
  const solve = async (token: string) => {
    const web = screen.getByTestId('webview');
    await act(async () => { web.props.onMessage({ nativeEvent: { data: JSON.stringify({ token }) } }); });
  };

  it('asks for no CAPTCHA while no site key is set', async () => {
    m.requestOtp.mockResolvedValue({ resend_after_seconds: 60 });
    await renderIn(<PhoneStep />);
    await fireEvent.changeText(screen.getByLabelText('Mobile number'), '01012345678');
    await fireEvent.press(screen.getByText('Send code'));
    await waitFor(() => expect(m.requestOtp).toHaveBeenCalledWith('01012345678', undefined));
    expect(screen.queryByTestId('webview')).toBeNull();
  });

  it('shows the check first, and sends the code only with its token', async () => {
    process.env.EXPO_PUBLIC_TURNSTILE_SITE_KEY = '1x00000000000000000000AA';
    m.requestOtp.mockResolvedValue({ resend_after_seconds: 60 });
    await renderIn(<PhoneStep />);
    await fireEvent.changeText(screen.getByLabelText('Mobile number'), '01012345678');
    await fireEvent.press(screen.getByText('Send code'));
    expect(screen.getByTestId('webview')).toBeTruthy();
    expect(m.requestOtp).not.toHaveBeenCalled();
    await solve('tok-1');
    await waitFor(() => expect(m.requestOtp).toHaveBeenCalledWith('01012345678', 'tok-1'));
    await waitFor(() => expect(screen.getByText('Enter your code')).toBeTruthy());
    expect(screen.queryByTestId('webview')).toBeNull();
  });

  it('shows the check again when the server did not accept it', async () => {
    process.env.EXPO_PUBLIC_TURNSTILE_SITE_KEY = '1x00000000000000000000AA';
    m.requestOtp.mockRejectedValueOnce(new ApiError('captcha_failed', 400, { captcha_required: true }));
    await renderIn(<PhoneStep />);
    await fireEvent.changeText(screen.getByLabelText('Mobile number'), '01012345678');
    await fireEvent.press(screen.getByText('Send code'));
    await solve('bad');
    await waitFor(() => expect(screen.getByText('The check did not work. Try again.')).toBeTruthy());
    expect(screen.getByTestId('webview')).toBeTruthy();
  });

  it('asks for the check after two wrong codes and retries the code with its token', async () => {
    process.env.EXPO_PUBLIC_TURNSTILE_SITE_KEY = '1x00000000000000000000AA';
    m.requestOtp.mockResolvedValue({ resend_after_seconds: 60 });
    m.verifyOtp.mockRejectedValueOnce(new ApiError('too_many_attempts', 429, { captcha_required: true, retry_after_seconds: 600 }));
    m.verifyOtp.mockResolvedValueOnce(undefined);
    await renderIn(<PhoneStep />);
    await fireEvent.changeText(screen.getByLabelText('Mobile number'), '01012345678');
    await fireEvent.press(screen.getByText('Send code'));
    await solve('send-token');
    await waitFor(() => screen.getByLabelText('Code'));
    await fireEvent.changeText(screen.getByLabelText('Code'), '123456');
    await fireEvent.press(screen.getByText('Verify'));
    await solve('verify-token');                     // the check shows after the first, too-many-attempts answer
    await waitFor(() => expect(m.verifyOtp).toHaveBeenCalledTimes(2));
    expect(m.verifyOtp).toHaveBeenNthCalledWith(2, '01012345678', '123456', 'verify-token');
  });

  it('tells the person to ask for a new code when this one is used up', async () => {
    m.requestOtp.mockResolvedValue({ resend_after_seconds: 60 });
    m.verifyOtp.mockRejectedValue(new ApiError('request_new_code', 429));
    await renderIn(<PhoneStep />);
    await fireEvent.changeText(screen.getByLabelText('Mobile number'), '01012345678');
    await fireEvent.press(screen.getByText('Send code'));
    await waitFor(() => screen.getByLabelText('Code'));
    await fireEvent.changeText(screen.getByLabelText('Code'), '123456');
    await fireEvent.press(screen.getByText('Verify'));
    await waitFor(() => expect(screen.getByText('That code is used up. Ask for a new one.')).toBeTruthy());
  });
});
