import React from 'react';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { Linking } from 'react-native';
import { COMBOS, renderIn } from '../test-utils/render';
import { setLocaleForTests } from '../src/i18n';
import { ApiError } from '../src/lib/api';
import * as api from '../src/lib/api';
import { fetchPaymentSettings, formatDate, hasPaymentDetails, submitPaymentClaim } from '../src/lib/membership';
import Membership from '../app/membership';
import { MembershipBanner } from '../src/components/MembershipBanner';
import { router } from 'expo-router';

const mockRefresh = jest.fn();
const mockSignOut = jest.fn(async () => {});
let mockState: unknown = null;
jest.mock('../src/lib/auth', () => ({ useAuth: () => ({ ready: true, session: { user: { id: 'u1' } }, state: mockState, refresh: mockRefresh, signOut: mockSignOut }) }));
jest.mock('../src/lib/api', () => ({ ...jest.requireActual('../src/lib/api'), uploadPhoto: jest.fn() }));
const mockRpc = jest.fn();
jest.mock('../src/lib/supabase', () => ({ supabase: { rpc: (...a: unknown[]) => mockRpc(...a) } }));

/** Renders the screen and lets the payment settings arrive, so nothing updates after the test ends. */
const show = async (ui: React.ReactElement, opts: Parameters<typeof renderIn>[1] = {}) => {
  const view = await renderIn(ui, opts);
  await act(async () => { await Promise.resolve(); });
  return view;
};
const m = api as jest.Mocked<typeof api>;
const membership = (o: Record<string, unknown> = {}) => ({ state: 'unpaid', kind: 'registration', paid_until: null, days_left: null, amount_egp: 75, claim_status: 'none', claim_note: null, ...o });
const EMPTY = { instapay_link: '', instapay_qr_url: '', bank_name: '', bank_account_name: '', bank_account_number: '', bank_iban: '', payment_note: '' };
const FILLED = { instapay_link: 'https://ipn.eg/S/pawspal', instapay_qr_url: 'https://example.com/qr.png', bank_name: 'Test Bank', bank_account_name: 'PawsPal Dahab', bank_account_number: '1234567890', bank_iban: 'EG000000', payment_note: 'Write your email in the note.' };
let settings: Record<string, unknown> = EMPTY;

beforeEach(() => {
  jest.clearAllMocks(); settings = EMPTY; mockState = { status: 'active', role: 'owner', membership: membership() };
  mockRefresh.mockResolvedValue(null);
  mockRpc.mockImplementation(async (name: string) => (name === 'get_payment_settings' ? { data: settings, error: null } : { data: 'claim-1', error: null }));
});
afterEach(() => setLocaleForTests('en'));

describe.each(COMBOS)('membership screen in $mode / $locale', ({ mode, locale }) => {
  it.each(['unpaid', 'due_soon', 'paused', 'active'])('renders the %s state with a heading', async (state) => {
    mockState = { status: 'active', membership: membership({ state, paid_until: '2027-03-12' }) };
    await show(<Membership />, { mode, locale });
    expect(screen.getAllByRole('header').length).toBeGreaterThan(0);
  });
});

describe('membership screen', () => {
  it('shows the registration fee from the server', async () => {
    mockState = { status: 'active', membership: membership({ amount_egp: 80 }) };
    await show(<Membership />);
    expect(screen.getByText('Registration fee 80 EGP')).toBeTruthy();
  });

  it('shows the renewal date when a renewal is due soon', async () => {
    mockState = { status: 'active', membership: membership({ state: 'due_soon', kind: 'renewal', paid_until: '2027-03-12', days_left: 5, amount_egp: 25 }) };
    await show(<Membership />);
    expect(screen.getByText(/^Renewal due on .*2027/)).toBeTruthy();
  });

  it('says the membership is paused, with the renewal fee', async () => {
    mockState = { status: 'active', membership: membership({ state: 'paused', kind: 'renewal', paid_until: '2026-09-01', amount_egp: 25 }) };
    await show(<Membership />);
    expect(screen.getByText('Membership paused')).toBeTruthy();
    expect(screen.getByText('Renewal fee: 25 EGP')).toBeTruthy();
  });

  it('says payment details are coming soon while the settings are empty, and hides the form', async () => {
    await show(<Membership />);
    await waitFor(() => expect(screen.getByText('Payment details are coming soon. Please check back shortly.')).toBeTruthy());
    expect(screen.queryByText('Pay with InstaPay')).toBeNull();
    expect(screen.queryByLabelText('Reference number')).toBeNull();
    expect(screen.getByText('PawsPal confirms your payment by hand.')).toBeTruthy();
  });

  it('shows InstaPay, the QR image, the bank details and the note', async () => {
    settings = FILLED;
    jest.spyOn(Linking, 'openURL').mockImplementation(async () => {});
    await show(<Membership />);
    await waitFor(() => screen.getByText('Pay with InstaPay'));
    await fireEvent.press(screen.getByText('Pay with InstaPay'));
    expect(Linking.openURL).toHaveBeenCalledWith('https://ipn.eg/S/pawspal');
    expect(screen.getByLabelText('InstaPay QR code')).toBeTruthy();
    for (const v of ['Test Bank', 'PawsPal Dahab', '1234567890', 'EG000000', 'Write your email in the note.']) expect(screen.getByText(v)).toBeTruthy();
    expect(screen.getByText('1234567890').props.selectable).toBe(true);
  });

  it('never opens or shows an address that is not https', async () => {
    settings = { ...FILLED, instapay_link: 'http://ipn.eg/x', instapay_qr_url: 'javascript:alert(1)' };
    await show(<Membership />);
    await waitFor(() => screen.getByText('Test Bank'));
    expect(screen.queryByText('Pay with InstaPay')).toBeNull();
    expect(screen.queryByLabelText('InstaPay QR code')).toBeNull();
  });

  it('sends a reference and a screenshot as a payment claim', async () => {
    settings = FILLED;
    m.uploadPhoto.mockResolvedValue('u1/shot.jpg');
    await show(<Membership />);
    await waitFor(() => screen.getByLabelText('Reference number'));
    await fireEvent.press(screen.getByText('Send'));
    expect(mockRpc).not.toHaveBeenCalledWith('submit_payment_claim', expect.anything());   // nothing typed yet
    await fireEvent.changeText(screen.getByLabelText('Reference number'), 'IPN-998877');
    await fireEvent.press(screen.getByText('Add screenshot'));
    await waitFor(() => screen.getByText('Screenshot added'));
    await fireEvent.press(screen.getByText('Send'));
    await waitFor(() => expect(mockRpc).toHaveBeenCalledWith('submit_payment_claim', { p_reference: 'IPN-998877', p_screenshot_path: 'u1/shot.jpg' }));
    expect(m.uploadPhoto).toHaveBeenCalledWith('payment', 'file:///photo.jpg');
    await waitFor(() => expect(screen.getByText('We got it. We confirm payments within 1 business day.')).toBeTruthy());
    expect(mockRefresh).toHaveBeenCalled();
    expect(screen.queryByLabelText('Reference number')).toBeNull();
  });

  it('can send a screenshot alone', async () => {
    settings = FILLED;
    m.uploadPhoto.mockResolvedValue('u1/shot.jpg');
    await show(<Membership />);
    await waitFor(() => screen.getByText('Add screenshot'));
    await fireEvent.press(screen.getByText('Add screenshot'));
    await waitFor(() => screen.getByText('Screenshot added'));
    await fireEvent.press(screen.getByText('Send'));
    await waitFor(() => expect(mockRpc).toHaveBeenCalledWith('submit_payment_claim', { p_reference: null, p_screenshot_path: 'u1/shot.jpg' }));
  });

  it('shows a plain message and keeps the form when sending fails', async () => {
    settings = FILLED;
    mockRpc.mockImplementation(async (name: string) => (name === 'get_payment_settings' ? { data: settings, error: null } : { data: null, error: { message: 'x' } }));
    await show(<Membership />);
    await waitFor(() => screen.getByLabelText('Reference number'));
    await fireEvent.changeText(screen.getByLabelText('Reference number'), 'R1');
    await fireEvent.press(screen.getByText('Send'));
    await waitFor(() => expect(screen.getByText('Something went wrong. Try again.')).toBeTruthy());
    expect(screen.getByLabelText('Reference number')).toBeTruthy();
  });

  it('shows "we got it" instead of the form while a claim is pending', async () => {
    settings = FILLED;
    mockState = { status: 'active', membership: membership({ claim_status: 'pending' }) };
    await show(<Membership />);
    await waitFor(() => screen.getByText('We got it. We confirm payments within 1 business day.'));
    expect(screen.queryByLabelText('Reference number')).toBeNull();
  });

  it('shows the reviewer\'s note after a rejection and lets the person send again', async () => {
    settings = FILLED;
    mockState = { status: 'active', membership: membership({ claim_status: 'rejected', claim_note: 'Amount was too low.' }) };
    await show(<Membership />);
    await waitFor(() => screen.getByLabelText('Reference number'));
    expect(screen.getByText('We could not confirm your last payment: Amount was too low.')).toBeTruthy();
  });

  it('lets the person sign out', async () => {
    await show(<Membership />);
    await fireEvent.press(screen.getByText('Sign out'));
    expect(mockSignOut).toHaveBeenCalled();
  });
});

describe('membership library', () => {
  it('reads the settings and trims them', async () => {
    settings = { ...FILLED, bank_name: '  Test Bank ', registration_fee_egp: 75 };
    const s = await fetchPaymentSettings();
    expect(s.bank_name).toBe('Test Bank');
    expect(s.registration_fee_egp).toBe('75');
    expect(hasPaymentDetails(s)).toBe(true);
    expect(hasPaymentDetails({ ...s, ...EMPTY })).toBe(false);
  });
  it('throws when the server says no', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'x' } });
    await expect(fetchPaymentSettings()).rejects.toBeTruthy();
  });
  it('refuses a claim with neither a reference nor a screenshot', async () => {
    await expect(submitPaymentClaim('  ', null)).rejects.toThrow();
    expect(mockRpc).not.toHaveBeenCalled();
  });
  it('does not send a claim when the screenshot upload fails', async () => {
    m.uploadPhoto.mockRejectedValueOnce(new ApiError('network', 0));
    await expect(submitPaymentClaim('R1', 'file:///x.jpg')).rejects.toMatchObject({ code: 'network' });
    expect(mockRpc).not.toHaveBeenCalled();
  });
  it('formats dates in both languages', () => {
    expect(formatDate('2027-03-12')).toMatch(/2027/);
    setLocaleForTests('ar');
    expect(formatDate('2027-03-12')).toBeTruthy();
    expect(formatDate(null)).toBe('');
  });
});

describe('MembershipBanner', () => {
  it.each(['unpaid', 'active'])('stays hidden for a %s membership', async (state) => {
    mockState = { membership: membership({ state }) };
    await renderIn(<MembershipBanner />);
    expect(screen.queryByRole('button')).toBeNull();
  });
  it('says when the membership renews and opens Membership', async () => {
    mockState = { membership: membership({ state: 'due_soon', paid_until: '2027-03-12' }) };
    await renderIn(<MembershipBanner />);
    const b = screen.getByRole('button');
    expect(b.props.accessibilityLabel).toMatch(/^Your membership renews on .*2027\. Tap to renew\.$/);
    await fireEvent.press(b);
    expect(router.push).toHaveBeenCalledWith('/membership');
  });
  it('says when the membership is paused, with a 44 pt target', async () => {
    mockState = { membership: membership({ state: 'paused' }) };
    await renderIn(<MembershipBanner />);
    expect(screen.getByText('Your membership is paused. Tap to renew.')).toBeTruthy();
    expect(JSON.stringify(screen.getByRole('button').props.style)).toMatch(/"minHeight":44/);
  });
  it('speaks Arabic too', async () => {
    mockState = { membership: membership({ state: 'paused' }) };
    await renderIn(<MembershipBanner />, { locale: 'ar' });
    expect(screen.getByText('عضويتك متوقفة. اضغط للتجديد.')).toBeTruthy();
  });
});
