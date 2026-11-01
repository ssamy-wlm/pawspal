import React from 'react';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import * as Location from 'expo-location';
import { COMBOS, renderIn } from '../test-utils/render';
import { setLocaleForTests } from '../src/i18n';
import { ApiError } from '../src/lib/api';
import * as api from '../src/lib/api';
import { clearVerificationDraft, getFacePath, setFacePath, setIdPath, setPendingEmail } from '../src/lib/draft';
import { legal } from '../src/legal';
import AccountStep from '../app/signup/account';
import CheckEmailStep from '../app/signup/check-email';
import SignIn from '../app/signin';
import Forgot from '../app/forgot';
import ResetPassword from '../app/reset-password';
import SelfieStep from '../app/signup/selfie';
import IdStep from '../app/signup/id';
import AboutStep from '../app/signup/about';
import LocationStep from '../app/signup/location';
import RulesStep from '../app/signup/rules';
import Pending from '../app/pending';

const mockRefresh = jest.fn();
const mockSignOut = jest.fn(async () => {});
let mockState: unknown = null;
let mockSession: unknown = { user: { id: 'u1' } };
jest.mock('../src/lib/auth', () => ({ useAuth: () => ({ ready: true, session: mockSession, state: mockState, refresh: mockRefresh, signOut: mockSignOut }) }));
jest.mock('../src/lib/api', () => ({ ...jest.requireActual('../src/lib/api'), uploadPhoto: jest.fn(), deviceId: jest.fn(async () => 'device-1') }));

const mockCalls: { table: string; op: string; row?: unknown }[] = [];
const mockRpc = jest.fn();
const mockAuth = {
  getUser: async () => ({ data: { user: { id: 'u1' } } }),
  signUp: jest.fn(), resend: jest.fn(), signInWithPassword: jest.fn(), resetPasswordForEmail: jest.fn(), updateUser: jest.fn(),
};
let mockTables: Record<string, unknown[]> = {};
let mockAcceptError: { code: string } | null = null;
jest.mock('../src/lib/supabase', () => ({
  supabase: {
    auth: {
      getUser: () => mockAuth.getUser(), signUp: (...a: unknown[]) => mockAuth.signUp(...a), resend: (...a: unknown[]) => mockAuth.resend(...a),
      signInWithPassword: (...a: unknown[]) => mockAuth.signInWithPassword(...a), resetPasswordForEmail: (...a: unknown[]) => mockAuth.resetPasswordForEmail(...a),
      updateUser: (...a: unknown[]) => mockAuth.updateUser(...a),
    },
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
const GOOD_PASSWORD = 'Sunny-Day-2026';
const ACCEPT = 'I have read this and I accept the Terms of Service and Privacy Policy';

beforeEach(() => {
  jest.clearAllMocks(); mockCalls.length = 0; mockState = null; mockAcceptError = null; mockSession = { user: { id: 'u1' } };
  mockTables = { legal_documents: [{ doc: 'guidelines', current_version: '1' }] };
  clearVerificationDraft(); setPendingEmail('');
  mockRefresh.mockResolvedValue({ status: 'pending_verification', missing: ['name'] });
  mockRpc.mockResolvedValue({ data: 'pending_review', error: null });
  mockAuth.signUp.mockResolvedValue({ data: { user: { id: 'new', identities: [{}] } }, error: null });
  mockAuth.resend.mockResolvedValue({ data: {}, error: null });
  mockAuth.signInWithPassword.mockResolvedValue({ data: {}, error: null });
  mockAuth.resetPasswordForEmail.mockResolvedValue({ data: {}, error: null });
  mockAuth.updateUser.mockResolvedValue({ data: {}, error: null });
});
afterEach(() => setLocaleForTests('en'));

describe.each(COMBOS)('sign-up screens in $mode / $locale', ({ mode, locale }) => {
  const show = (ui: React.ReactElement) => renderIn(ui, { mode, locale });

  it.each([
    ['account', AccountStep], ['check-email', CheckEmailStep], ['signin', SignIn], ['forgot', Forgot], ['reset', ResetPassword],
    ['selfie', SelfieStep], ['id', IdStep], ['about', AboutStep], ['location', LocationStep], ['rules', RulesStep], ['pending', Pending],
  ] as const)('shows the %s screen with a heading', async (_name, Step) => {
    mockState = { status: 'pending_review', role: 'owner', verification: { status: 'none', note: null }, membership: { state: 'active' } };
    setFacePath('u1/face.jpg');
    await show(<Step />);
    expect(screen.getAllByRole('header').length).toBeGreaterThan(0);
  });
});

describe('create account', () => {
  const fill = async (over: { role?: string | null; email?: string; password?: string; accept?: boolean } = {}) => {
    const { role = 'Owner', email = 'salma@example.com', password = GOOD_PASSWORD, accept = true } = over;
    if (role) await fireEvent.press(screen.getByLabelText(new RegExp(`^${role}\\.`)));
    await fireEvent.changeText(screen.getByLabelText('Email'), email);
    await fireEvent.changeText(screen.getByLabelText('Password'), password);
    if (accept) await fireEvent.press(screen.getByLabelText(ACCEPT));
  };

  it('shows Owner and Host with a line each, and the disclaimer word for word', async () => {
    await renderIn(<AccountStep />);
    expect(screen.getByText('I have a pet and need a host.')).toBeTruthy();
    expect(screen.getByText('I have a home and can look after pets.')).toBeTruthy();
    expect(screen.getByText('PawsPal connects pet owners and hosts. PawsPal does not vet, employ or guarantee any host or owner, and arrangements and payments between users are their own responsibility. If a disagreement happens, PawsPal will help where it can, for example by reviewing the chat and handover photos.')).toBeTruthy();
    expect(screen.getByText('At least 12 characters with upper case, lower case and a number.')).toBeTruthy();
  });

  it('links the Terms and the Privacy Policy', async () => {
    await renderIn(<AccountStep />);
    expect(screen.getAllByRole('link').map((l) => l.props.accessibilityRole)).toHaveLength(2);
    expect(screen.getByText('Terms of Service')).toBeTruthy();
    expect(screen.getByText('Privacy Policy')).toBeTruthy();
  });

  it('cannot be sent until the box about the disclaimer, Terms and Privacy Policy is ticked', async () => {
    await renderIn(<AccountStep />);
    await fill({ accept: false });
    await fireEvent.press(screen.getByText('Create account'));
    expect(mockAuth.signUp).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByLabelText(ACCEPT));
    await fireEvent.press(screen.getByText('Create account'));
    await waitFor(() => expect(mockAuth.signUp).toHaveBeenCalledTimes(1));
  });

  it('needs a role, a valid email and a strong password', async () => {
    await renderIn(<AccountStep />);
    await fill({ role: null });
    await fireEvent.press(screen.getByText('Create account'));
    await fireEvent.press(screen.getByLabelText(/^Host\./));
    await fireEvent.changeText(screen.getByLabelText('Email'), 'not-an-email');
    await fireEvent.press(screen.getByText('Create account'));
    await fireEvent.changeText(screen.getByLabelText('Email'), 'salma@example.com');
    for (const weak of ['short1A', 'alllowercase1234', 'ALLUPPERCASE1234', 'NoDigitsInHere']) {
      await fireEvent.changeText(screen.getByLabelText('Password'), weak);
      await fireEvent.press(screen.getByText('Create account'));
    }
    expect(mockAuth.signUp).not.toHaveBeenCalled();
  });

  it('sends the role, the Terms version and the device id as sign-up data, and the link address', async () => {
    await renderIn(<AccountStep />);
    await fill({ role: 'Host' });
    await fireEvent.press(screen.getByText('Create account'));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/signup/check-email'));
    expect(mockAuth.signUp).toHaveBeenCalledWith({
      email: 'salma@example.com', password: GOOD_PASSWORD,
      options: { emailRedirectTo: 'pawspal://auth/callback', data: { role: 'sitter', terms_version: legal.termsOfService.version, device_id: 'device-1' } },
    });
  });

  it('sends an owner as "owner"', async () => {
    await renderIn(<AccountStep />);
    await fill();
    await fireEvent.press(screen.getByText('Create account'));
    await waitFor(() => expect(mockAuth.signUp).toHaveBeenCalled());
    expect((mockAuth.signUp.mock.calls[0][0] as { options: { data: { role: string } } }).options.data.role).toBe('owner');
  });

  it.each([
    [{ code: 'user_already_exists', status: 422, message: 'x' }, 'That email already has an account. Try signing in.'],
    [{ code: 'weak_password', status: 422, message: 'x' }, 'That password is too weak. Use at least 12 characters with upper case, lower case and a number.'],
    [{ code: 'over_email_send_rate_limit', status: 429, message: 'x' }, 'Too many tries. Wait a few minutes and try again.'],
    [{ name: 'AuthRetryableFetchError', status: 0, message: 'x' }, 'No connection. Check your internet and try again.'],
    [{ status: 500, message: 'Database error saving new user' }, 'We cannot create an account with these details.'],
  ])('shows a plain sentence for %j', async (error, sentence) => {
    mockAuth.signUp.mockResolvedValueOnce({ data: { user: null }, error });
    await renderIn(<AccountStep />);
    await fill();
    await fireEvent.press(screen.getByText('Create account'));
    await waitFor(() => expect(screen.getByText(sentence)).toBeTruthy());
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('treats a sign-up with no identities (an address that is already registered) as "already has an account"', async () => {
    mockAuth.signUp.mockResolvedValueOnce({ data: { user: { id: 'x', identities: [] } }, error: null });
    await renderIn(<AccountStep />);
    await fill();
    await fireEvent.press(screen.getByText('Create account'));
    await waitFor(() => expect(screen.getByText('That email already has an account. Try signing in.')).toBeTruthy());
  });

  it('never prints the email or password to the console', async () => {
    const spies = (['log', 'warn', 'error', 'info'] as const).map((k) => jest.spyOn(console, k).mockImplementation(() => {}));
    mockAuth.signUp.mockResolvedValueOnce({ data: { user: null }, error: { code: 'weak_password', message: 'x' } });
    await renderIn(<AccountStep />);
    await fill();
    await fireEvent.press(screen.getByText('Create account'));
    await waitFor(() => expect(mockAuth.signUp).toHaveBeenCalled());
    for (const s of spies) { expect(JSON.stringify(s.mock.calls)).not.toMatch(/salma@example|Sunny-Day/); s.mockRestore(); }
  });
});

describe('check your email', () => {
  beforeEach(() => { jest.useFakeTimers(); setPendingEmail('salma@example.com'); });
  afterEach(() => { jest.useRealTimers(); });
  const tick = async (seconds: number) => { for (let i = 0; i < seconds; i += 1) await act(async () => { jest.advanceTimersByTime(1000); }); };

  it('shows the address and what to do', async () => {
    await renderIn(<CheckEmailStep />);
    expect(screen.getByText('We sent a link to salma@example.com. Open the email and tap the link to confirm your account.')).toBeTruthy();
    expect(screen.getAllByText('salma@example.com').length).toBeGreaterThan(0);
  });

  it('lets the person resend only after 60 seconds, then waits another 60', async () => {
    await renderIn(<CheckEmailStep />);
    expect(screen.getByText('Send again in 60s')).toBeTruthy();
    await fireEvent.press(screen.getByText('Send again in 60s'));
    expect(mockAuth.resend).not.toHaveBeenCalled();
    await tick(30);
    expect(screen.getByText('Send again in 30s')).toBeTruthy();
    await tick(30);
    await fireEvent.press(screen.getByText('Send the email again'));
    await waitFor(() => expect(mockAuth.resend).toHaveBeenCalledWith({ type: 'signup', email: 'salma@example.com', options: { emailRedirectTo: 'pawspal://auth/callback' } }));
    await waitFor(() => expect(screen.getByText('We sent it again.')).toBeTruthy());
    expect(screen.getByText('Send again in 60s')).toBeTruthy();
  });

  it('shows a plain sentence when resending fails', async () => {
    mockAuth.resend.mockResolvedValueOnce({ data: {}, error: { code: 'over_email_send_rate_limit', status: 429, message: 'x' } });
    await renderIn(<CheckEmailStep />);
    await tick(60);
    await fireEvent.press(screen.getByText('Send the email again'));
    await waitFor(() => expect(screen.getByText('Too many tries. Wait a few minutes and try again.')).toBeTruthy());
  });

  it('goes to sign-in once confirmed, and back to the form to change the email', async () => {
    await renderIn(<CheckEmailStep />);
    await fireEvent.press(screen.getByText('I confirmed, sign me in'));
    expect(router.replace).toHaveBeenCalledWith('/signin');
    await fireEvent.press(screen.getByText('Change email'));
    expect(router.replace).toHaveBeenCalledWith('/signup/account');
  });
});

describe('sign in', () => {
  const fill = async () => {
    await fireEvent.changeText(screen.getByLabelText('Email'), 'salma@example.com');
    await fireEvent.changeText(screen.getByLabelText('Password'), 'whatever');
  };

  it('signs in with email and password and leaves the routing to the gate', async () => {
    await renderIn(<SignIn />);
    await fill();
    await fireEvent.press(screen.getByText('Sign in'));
    await waitFor(() => expect(mockAuth.signInWithPassword).toHaveBeenCalledWith({ email: 'salma@example.com', password: 'whatever' }));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('gives one generic sentence for a wrong email or password, whatever the reason', async () => {
    for (const error of [{ code: 'invalid_credentials', status: 400, message: 'Invalid login credentials' }, { code: 'user_not_found', status: 400, message: 'nope' }, { status: 500, message: 'odd' }]) {
      mockAuth.signInWithPassword.mockResolvedValueOnce({ data: {}, error });
      const view = await renderIn(<SignIn />);
      await fill();
      await fireEvent.press(screen.getByText('Sign in'));
      await waitFor(() => expect(screen.getByText('The email or password is not right.')).toBeTruthy());
      view.unmount();
    }
  });

  it('offers to send the confirmation email again when the address is not confirmed', async () => {
    mockAuth.signInWithPassword.mockResolvedValueOnce({ data: {}, error: { code: 'email_not_confirmed', status: 400, message: 'Email not confirmed' } });
    await renderIn(<SignIn />);
    await fill();
    await fireEvent.press(screen.getByText('Sign in'));
    await waitFor(() => expect(screen.getByText('Your email is not confirmed yet. Open the link we sent you.')).toBeTruthy());
    await fireEvent.press(screen.getByText('Send the confirmation email again'));
    await waitFor(() => expect(mockAuth.resend).toHaveBeenCalledWith({ type: 'signup', email: 'salma@example.com', options: { emailRedirectTo: 'pawspal://auth/callback' } }));
    await waitFor(() => expect(screen.getByText('We sent it again.')).toBeTruthy());
  });

  it('links to Forgot password and to Create account', async () => {
    await renderIn(<SignIn />);
    await fireEvent.press(screen.getByText('Forgot password?'));
    expect(router.push).toHaveBeenCalledWith('/forgot');
    await fireEvent.press(screen.getByText('New here? Create an account'));
    expect(router.replace).toHaveBeenCalledWith('/signup/account');
  });

  it('stays off until both fields are filled', async () => {
    await renderIn(<SignIn />);
    await fireEvent.press(screen.getByText('Sign in'));
    expect(mockAuth.signInWithPassword).not.toHaveBeenCalled();
  });
});

describe('forgot password', () => {
  const MESSAGE = 'If that email has an account, we sent a link. Open it on this phone to choose a new password.';

  it('asks for a link that opens the app on the reset screen', async () => {
    await renderIn(<Forgot />);
    await fireEvent.changeText(screen.getByLabelText('Email'), 'salma@example.com');
    await fireEvent.press(screen.getByText('Send link'));
    await waitFor(() => expect(screen.getByText(MESSAGE)).toBeTruthy());
    expect(mockAuth.resetPasswordForEmail).toHaveBeenCalledWith('salma@example.com', { redirectTo: 'pawspal://auth/reset' });
  });

  it('says the same thing whether or not the address has an account', async () => {
    mockAuth.resetPasswordForEmail.mockResolvedValueOnce({ data: {}, error: { code: 'user_not_found', status: 400, message: 'x' } });
    await renderIn(<Forgot />);
    await fireEvent.changeText(screen.getByLabelText('Email'), 'nobody@example.com');
    await fireEvent.press(screen.getByText('Send link'));
    await waitFor(() => expect(screen.getByText(MESSAGE)).toBeTruthy());
  });

  it('only a lost connection gets a different message', async () => {
    mockAuth.resetPasswordForEmail.mockResolvedValueOnce({ data: {}, error: { name: 'AuthRetryableFetchError', status: 0, message: 'x' } });
    await renderIn(<Forgot />);
    await fireEvent.changeText(screen.getByLabelText('Email'), 'salma@example.com');
    await fireEvent.press(screen.getByText('Send link'));
    await waitFor(() => expect(screen.getByText('No connection. Check your internet and try again.')).toBeTruthy());
    expect(screen.queryByText(MESSAGE)).toBeNull();
  });

  it('sends nothing for an address that is not an email', async () => {
    await renderIn(<Forgot />);
    await fireEvent.changeText(screen.getByLabelText('Email'), 'salma');
    await fireEvent.press(screen.getByText('Send link'));
    expect(mockAuth.resetPasswordForEmail).not.toHaveBeenCalled();
  });
});

describe('reset password', () => {
  it('needs two matching strong passwords, then saves and goes on', async () => {
    await renderIn(<ResetPassword />);
    await fireEvent.changeText(screen.getByLabelText('New password'), 'weak');
    await fireEvent.changeText(screen.getByLabelText('Repeat the new password'), 'weak');
    await fireEvent.press(screen.getByText('Save password'));
    expect(mockAuth.updateUser).not.toHaveBeenCalled();
    await fireEvent.changeText(screen.getByLabelText('New password'), GOOD_PASSWORD);
    await fireEvent.changeText(screen.getByLabelText('Repeat the new password'), GOOD_PASSWORD + 'x');
    expect(screen.getByText('The two passwords do not match.')).toBeTruthy();
    await fireEvent.press(screen.getByText('Save password'));
    expect(mockAuth.updateUser).not.toHaveBeenCalled();
    await fireEvent.changeText(screen.getByLabelText('Repeat the new password'), GOOD_PASSWORD);
    await fireEvent.press(screen.getByText('Save password'));
    await waitFor(() => expect(mockAuth.updateUser).toHaveBeenCalledWith({ password: GOOD_PASSWORD }));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/'));
  });

  it('shows a plain sentence when the server says no', async () => {
    mockAuth.updateUser.mockResolvedValueOnce({ data: {}, error: { code: 'weak_password', status: 422, message: 'x' } });
    await renderIn(<ResetPassword />);
    await fireEvent.changeText(screen.getByLabelText('New password'), GOOD_PASSWORD);
    await fireEvent.changeText(screen.getByLabelText('Repeat the new password'), GOOD_PASSWORD);
    await fireEvent.press(screen.getByText('Save password'));
    await waitFor(() => expect(screen.getByText(/too weak/)).toBeTruthy());
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('says the link has expired when there is no session, and offers a new link', async () => {
    mockSession = null;
    await renderIn(<ResetPassword />);
    expect(screen.getByText('This link has expired. Ask for a new one.')).toBeTruthy();
    await fireEvent.press(screen.getByText('Ask for a new link'));
    expect(router.replace).toHaveBeenCalledWith('/forgot');
  });
});

describe('selfie step', () => {
  it('shows the camera with a face guide', async () => {
    await renderIn(<SelfieStep />);
    expect(screen.getByTestId('camera')).toBeTruthy();
    expect(screen.getByLabelText('Face guide: keep your face inside the oval')).toBeTruthy();
  });

  it('uploads the photo as a selfie, keeps the raw path in the draft and moves to the ID step', async () => {
    m.uploadPhoto.mockResolvedValue('u1/clean.jpg');
    await renderIn(<SelfieStep />);
    await fireEvent.press(screen.getByText('Take photo'));
    await waitFor(() => screen.getByText('Use this photo'));
    await fireEvent.press(screen.getByText('Use this photo'));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/signup/id'));
    expect(m.uploadPhoto).toHaveBeenCalledWith('face', 'file:///selfie.jpg');
    expect(getFacePath()).toBe('u1/clean.jpg');
    expect(mockRpc).not.toHaveBeenCalled();                 // nothing is submitted until the ID is uploaded too
  });

  it('shows the reviewer\'s note after a rejection', async () => {
    mockState = { status: 'pending_verification', verification: { status: 'rejected', note: 'The photo is too dark.' } };
    await renderIn(<SelfieStep />);
    expect(screen.getByText('We could not approve your photos.')).toBeTruthy();
    expect(screen.getByText('The photo is too dark.')).toBeTruthy();
  });

  it('says so when the upload fails and stays on the step', async () => {
    m.uploadPhoto.mockRejectedValue(new ApiError('network', 0));
    await renderIn(<SelfieStep />);
    await fireEvent.press(screen.getByText('Take photo'));
    await waitFor(() => screen.getByText('Use this photo'));
    await fireEvent.press(screen.getByText('Use this photo'));
    await waitFor(() => expect(screen.getByText('No connection. Check your internet and try again.')).toBeTruthy());
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
  beforeEach(() => setFacePath('u1/face.jpg'));

  it('says who sees the photo and that it is deleted after the check', async () => {
    await renderIn(<IdStep />);
    expect(screen.getByText('Passport or national ID. Only the PawsPal team sees it and it is deleted right after we check it.')).toBeTruthy();
  });

  it('goes back to the selfie when there is none yet', async () => {
    clearVerificationDraft();
    await renderIn(<IdStep />);
    expect(router.replace).toHaveBeenCalledWith('/signup/selfie');
  });

  it('uploads the ID, then submits both paths for review and moves on', async () => {
    m.uploadPhoto.mockResolvedValue('u1/id.jpg');
    mockRpc.mockResolvedValue({ data: 'req-1', error: null });
    mockRefresh.mockResolvedValue({ status: 'pending_verification', missing: ['name', 'pet'] });
    await renderIn(<IdStep />);
    await fireEvent.press(screen.getByText('Take a photo'));
    await waitFor(() => screen.getByText('ID photo added'));
    expect(m.uploadPhoto).toHaveBeenCalledWith('id', 'file:///camera.jpg');
    expect(mockRpc).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByText('Send for checking'));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/signup/about'));
    expect(mockRpc).toHaveBeenCalledWith('submit_verification', { p_face_path: 'u1/face.jpg', p_id_path: 'u1/id.jpg' });
    expect(getFacePath()).toBeNull();                        // the draft is cleared once it is sent
  });

  it('can pick the photo from the library', async () => {
    m.uploadPhoto.mockResolvedValue('u1/id.jpg');
    await renderIn(<IdStep />);
    await fireEvent.press(screen.getByText('Choose from library'));
    await waitFor(() => screen.getByText('ID photo added'));
    expect(m.uploadPhoto).toHaveBeenCalledWith('id', 'file:///photo.jpg');
  });

  it('keeps the draft and shows a message when sending fails', async () => {
    setIdPath('u1/id.jpg');
    mockRpc.mockResolvedValue({ data: null, error: { message: 'x' } });
    await renderIn(<IdStep />);
    await fireEvent.press(screen.getByText('Send for checking'));
    await waitFor(() => expect(screen.getByText('Something went wrong. Try again.')).toBeTruthy());
    expect(getFacePath()).toBe('u1/face.jpg');
    expect(router.replace).not.toHaveBeenCalledWith('/signup/about');
  });

  it('shows a plain message when the upload fails', async () => {
    m.uploadPhoto.mockRejectedValue(new ApiError('invalid_image', 400));
    await renderIn(<IdStep />);
    await fireEvent.press(screen.getByText('Choose from library'));
    await waitFor(() => expect(screen.getByText('That photo did not work. Take a new one.')).toBeTruthy());
    expect(screen.queryByText('Send for checking')).toBeNull();
  });
});

describe('about step', () => {
  it('asks an owner for a first name and a pet with a photo, and saves the name without a role', async () => {
    mockState = { status: 'pending_verification', role: 'owner', first_name: null, has_pet: false, has_home_photo: false };
    m.uploadPhoto.mockResolvedValueOnce('u1/pet.jpg');
    mockRefresh.mockResolvedValue({ status: 'pending_verification', missing: ['location', 'legal'] });
    await renderIn(<AboutStep />);
    expect(screen.queryByText('Your home')).toBeNull();
    expect(screen.queryByText('Owner')).toBeNull();                 // no role switch here
    await fireEvent.press(screen.getByText('Continue'));
    expect(mockCalls).toHaveLength(0);
    await fireEvent.changeText(screen.getByLabelText('First name'), 'Salma');
    await fireEvent.changeText(screen.getByLabelText('Pet name'), 'Biscuit');
    await fireEvent.press(screen.getByText('Cat'));
    await fireEvent.press(screen.getByText('Small'));
    await fireEvent.press(screen.getByText('Continue'));
    expect(mockCalls).toHaveLength(0);                              // the pet photo is still missing
    await fireEvent.press(screen.getByText('Add a photo'));
    await waitFor(() => screen.getByText('Photo added'));
    await fireEvent.press(screen.getByText('Continue'));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/signup/location'));
    expect(mockCalls).toEqual([
      { table: 'profiles', op: 'update', row: { first_name: 'Salma' } },
      { table: 'pets', op: 'insert', row: { owner_id: 'u1', name: 'Biscuit', type: 'cat', size: 'small', photo_paths: ['u1/pet.jpg'] } },
    ]);
    expect(m.uploadPhoto).toHaveBeenCalledWith('pet', 'file:///photo.jpg');
  });

  it('asks a host for a first name and a home photo, and no pet', async () => {
    mockState = { status: 'pending_verification', role: 'sitter', first_name: null, has_pet: false, has_home_photo: false };
    m.uploadPhoto.mockResolvedValueOnce('u1/home.jpg');
    mockRefresh.mockResolvedValue({ status: 'pending_verification', missing: ['location', 'legal'] });
    await renderIn(<AboutStep />);
    expect(screen.queryByText('Your pet')).toBeNull();
    await fireEvent.changeText(screen.getByLabelText('First name'), 'Mona');
    await fireEvent.press(screen.getByText('Continue'));
    expect(mockCalls).toHaveLength(0);                              // the home photo is still missing
    await fireEvent.press(screen.getByText('Add a photo of your home'));
    await waitFor(() => screen.getByText('Home photo added'));
    await fireEvent.press(screen.getByText('Continue'));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/signup/location'));
    expect(mockCalls).toEqual([{ table: 'profiles', op: 'update', row: { first_name: 'Mona' } }]);
    expect(m.uploadPhoto).toHaveBeenCalledWith('home', 'file:///photo.jpg');
  });

  it('does not ask an owner who already has a pet for another one', async () => {
    mockState = { status: 'pending_verification', role: 'owner', first_name: 'Salma', has_pet: true, has_home_photo: false };
    mockRefresh.mockResolvedValue({ status: 'pending_verification', missing: ['location'] });
    await renderIn(<AboutStep />);
    expect(screen.queryByText('Your pet')).toBeNull();
    await fireEvent.press(screen.getByText('Continue'));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/signup/location'));
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
  const tick = async () => { await fireEvent.press(screen.getByLabelText('I accept the Community Guidelines')); };

  it('asks only for the Community Guidelines (Terms and Privacy were accepted at sign-up)', async () => {
    await renderIn(<RulesStep />);
    expect(screen.queryByLabelText('I accept the Terms of Service')).toBeNull();
    expect(screen.queryByLabelText('I accept the Privacy Policy')).toBeNull();
    await fireEvent.press(screen.getByText('Send for review'));
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('records the Guidelines version and sends the profile for review', async () => {
    await renderIn(<RulesStep />);
    await tick();
    await fireEvent.press(screen.getByText('Send for review'));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/pending'));
    expect(mockCalls.filter((c) => c.table === 'legal_acceptances').map((c) => c.row)).toEqual([{ user_id: 'u1', doc: 'guidelines', version: '1' }]);
    expect(mockRpc).toHaveBeenCalledWith('submit_profile');
  });

  it('treats an already accepted version as fine, but stops on any other error', async () => {
    mockAcceptError = { code: '23505' };
    await renderIn(<RulesStep />);
    await tick();
    await fireEvent.press(screen.getByText('Send for review'));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/pending'));
    (router.replace as jest.Mock).mockClear();
    mockAcceptError = { code: '42501' };
    await fireEvent.press(screen.getByText('Send for review'));
    await waitFor(() => expect(screen.getByText('Something went wrong. Try again.')).toBeTruthy());
    expect(router.replace).not.toHaveBeenCalled();
  });
});

describe('pending screen (status hub)', () => {
  const account = (over: Record<string, unknown> = {}) => ({
    status: 'pending_review', role: 'owner', verification: { status: 'pending', note: null },
    membership: { state: 'active', claim_status: 'none', claim_note: null, amount_egp: 75 }, ...over,
  });

  it('promises a review within 1 business day, shows the photo status and lets people sign out', async () => {
    mockState = account();
    await renderIn(<Pending />);
    expect(screen.getByText('We are checking your account')).toBeTruthy();
    expect(screen.getByText('We review new accounts within 1 business day.')).toBeTruthy();
    expect(screen.getByText('Your photos are waiting for our team.')).toBeTruthy();
    await fireEvent.press(screen.getByText('Sign out'));
    expect(mockSignOut).toHaveBeenCalled();
  });

  it('shows a rejection with the reviewer\'s note and goes back to the selfie to upload again', async () => {
    mockState = account({ verification: { status: 'rejected', note: 'The ID is cut off.' } });
    await renderIn(<Pending />);
    expect(screen.getByText('We could not approve your photos.')).toBeTruthy();
    expect(screen.getByText('The ID is cut off.')).toBeTruthy();
    await fireEvent.press(screen.getByText('Upload again'));
    expect(router.replace).toHaveBeenCalledWith('/signup/selfie');
  });

  it('shows the registration fee with a button to Membership while it is unpaid', async () => {
    mockState = account({ membership: { state: 'unpaid', claim_status: 'none', claim_note: null, amount_egp: 75 } });
    await renderIn(<Pending />);
    expect(screen.getByText('Registration fee: 75 EGP')).toBeTruthy();
    await fireEvent.press(screen.getByText('Pay registration'));
    expect(router.push).toHaveBeenCalledWith('/membership');
  });

  it('says the payment is being confirmed once it has been sent', async () => {
    mockState = account({ membership: { state: 'unpaid', claim_status: 'pending', claim_note: null, amount_egp: 75 } });
    await renderIn(<Pending />);
    expect(screen.getByText('We got it. We confirm payments within 1 business day.')).toBeTruthy();
    expect(screen.queryByText('Pay registration')).toBeNull();
  });

  it('shows different text for a suspended and a removed account', async () => {
    mockState = account({ status: 'suspended' });
    const view = await renderIn(<Pending />);
    expect(screen.getByText('This account is not active')).toBeTruthy();
    expect(screen.getByText(/If you think this is a mistake/)).toBeTruthy();
    expect(screen.queryByText('We are checking your account')).toBeNull();
    expect(screen.queryByText('Your photos are waiting for our team.')).toBeNull();
    view.unmount();
    mockState = account({ status: 'removed' });
    await renderIn(<Pending />);
    expect(screen.getByText('This account has been removed. If you think this is a mistake, you can ask us to look again.')).toBeTruthy();
  });

  it('lets a suspended person read our message and send an appeal, once', async () => {
    mockState = account({ status: 'suspended' });
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
    mockState = account({ status: 'removed' });
    mockTables.enforcement_actions = [{ id: 'act-1', message: null }];
    mockTables.appeals = [{ id: 'ap-1' }];
    await renderIn(<Pending />);
    await waitFor(() => expect(screen.getByText('Appeal sent')).toBeTruthy());
    expect(screen.queryByLabelText('Your message')).toBeNull();
  });

  it('offers no appeal form to someone who is only waiting for review', async () => {
    mockState = account();
    mockTables.enforcement_actions = [{ id: 'act-1', message: 'x' }];
    await renderIn(<Pending />);
    expect(screen.queryByText('Send appeal')).toBeNull();
  });
});
