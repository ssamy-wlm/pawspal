import React from 'react';
import { Linking } from 'react-native';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { router, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { COMBOS, renderIn } from '../test-utils/render';
import { setLocaleForTests } from '../src/i18n';
import * as api from '../src/lib/api';
import * as chat from '../src/lib/chat';
import * as bk from '../src/lib/bookings';
import * as prof from '../src/lib/profile';
import { supabase } from '../src/lib/supabase';
import { hapticsEnabled, initHaptics, setHapticsEnabled, tap } from '../src/lib/haptics';
import ChatScreen from '../app/chat/[id]';
import BookingDone from '../app/booking/done/[id]';
import Settings from '../app/settings';
import { ToastProvider } from '../src/components/Toast';

jest.mock('../src/lib/auth', () => ({ useAuth: () => ({ ready: true, session: { user: { id: 'me' } }, state: { status: 'active', role: 'both' }, refresh: jest.fn(), signOut: jest.fn() }) }));
jest.mock('../src/lib/api', () => ({ ...jest.requireActual('../src/lib/api'), createFeePayment: jest.fn() }));
jest.mock('../src/lib/chat', () => ({ fetchConversations: jest.fn(), startConversation: jest.fn(), fetchMessages: jest.fn(), sendMessage: jest.fn(), markRead: jest.fn(), listenToMessages: jest.fn(), listenToActivity: jest.fn(), PAGE_SIZE: 40 }));
jest.mock('../src/lib/bookings', () => ({ ...jest.requireActual('../src/lib/bookings'), fetchBookingsBetween: jest.fn(), fetchBooking: jest.fn(), fetchBookingFee: jest.fn(), fetchRefundPreview: jest.fn(), fetchBookingLocation: jest.fn(), cancelBooking: jest.fn(), acceptTerms: jest.fn() }));
jest.mock('../src/lib/profile', () => ({ ...jest.requireActual('../src/lib/profile'), fetchCard: jest.fn(), fetchPet: jest.fn(), fetchPets: jest.fn(), useSignedUrl: jest.fn(() => null) }));
jest.mock('../src/lib/explore', () => ({ fetchAvailability: jest.fn(async () => []) }));
jest.mock('expo-haptics', () => ({ impactAsync: jest.fn(async () => {}), ImpactFeedbackStyle: { Light: 'light' } }));

const a = api as jest.Mocked<typeof api>;
const c = chat as jest.Mocked<typeof chat>;
const k = bk as jest.Mocked<typeof bk>;
const p = prof as jest.Mocked<typeof prof>;
const params = useLocalSearchParams as jest.Mock;
const wrap = (ui: React.ReactElement) => <ToastProvider>{ui}</ToastProvider>;

const booking = (over: Partial<bk.Booking> = {}): bk.Booking => ({ id: 'b1', owner_id: 'me', sitter_id: 'them', pet_id: 'p1', starts_on: '2026-12-01', ends_on: '2026-12-08', stay_location: 'sitter_home', cost_type: 'volunteer', price_per_night: null, food_provided: true, status: 'terms_agreed', fee_status: 'unpaid', owner_accepted_at: 'x', sitter_accepted_at: 'y', swap_group: null, terms_version: 2, opened_by: 'me', ...over });
const card = (id: string, name: string): prof.PublicProfile => ({ id, first_name: name, role: 'both', bio: null, area: null, card_illustration: 'cat-mango', card_background: 'pattern', rating_avg: null, stays_count: 0, home_photo_path: null, home_tags: [] });
let pushActivity: () => void = () => {};

beforeEach(() => {
  jest.clearAllMocks();
  params.mockReturnValue({ id: 'c1' });
  c.fetchConversations.mockResolvedValue([{ id: 'c1', other_id: 'them', first_name: 'Mona', card_illustration: 'cat-mango', card_background: 'pattern', last_body: null, last_at: '2026-10-01T10:00:00Z', last_mine: false, unread: 0 }]);
  c.fetchMessages.mockResolvedValue([]); c.markRead.mockResolvedValue(undefined);
  c.listenToMessages.mockImplementation(() => () => {}); c.listenToActivity.mockImplementation((cb) => { pushActivity = cb; return () => {}; });
  c.startConversation.mockResolvedValue('c9');
  k.fetchBookingsBetween.mockResolvedValue([booking()]); k.fetchBookingFee.mockResolvedValue(75); k.fetchRefundPreview.mockResolvedValue(null);
  p.fetchCard.mockResolvedValue(card('them', 'Mona')); p.fetchPet.mockResolvedValue({ id: 'p1', owner_id: 'me', name: 'Luna', photo_paths: ['x'] } as prof.Pet); p.fetchPets.mockResolvedValue([]);
  jest.spyOn(Linking, 'openURL').mockResolvedValue(true as never);
});
afterEach(() => { setLocaleForTests('en'); jest.restoreAllMocks(); });

describe('paying the booking fee', () => {
  it('shows the fee from the server and opens the payment page, then waits', async () => {
    a.createFeePayment.mockResolvedValue({ url: 'https://eg.checkout.paymob.com/?x=1', payment_id: 'pay1', amount_egp: 75 });
    await renderIn(wrap(<ChatScreen />));
    await waitFor(() => expect(screen.getByText('Booking fee: 75 EGP')).toBeTruthy());
    expect(screen.getByText('You both agreed. Paying the booking fee comes next.')).toBeTruthy();
    await fireEvent.press(screen.getByText('Pay the booking fee'));
    await waitFor(() => expect(Linking.openURL).toHaveBeenCalledWith('https://eg.checkout.paymob.com/?x=1'));
    expect(a.createFeePayment).toHaveBeenCalledWith('b1');                                 // only the booking is sent, never an amount
    expect(screen.getByText('Finish paying in your browser. This page updates by itself.')).toBeTruthy();
  });

  it('takes me to the confirmed screen when the server confirms the booking', async () => {
    a.createFeePayment.mockResolvedValue({ url: 'https://pay', payment_id: 'pay1', amount_egp: 75 });
    await renderIn(wrap(<ChatScreen />));
    await waitFor(() => screen.getByText('Pay the booking fee'));
    await fireEvent.press(screen.getByText('Pay the booking fee'));
    await waitFor(() => screen.getByText('Finish paying in your browser. This page updates by itself.'));
    expect(router.replace).not.toHaveBeenCalled();
    k.fetchBookingsBetween.mockResolvedValue([booking({ status: 'confirmed', fee_status: 'paid' })]);
    await act(async () => { pushActivity(); });
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/booking/done/b1'));
  });

  it('does not send me away when someone else pays or when I have not paid', async () => {
    k.fetchBookingsBetween.mockResolvedValue([booking({ status: 'confirmed', fee_status: 'paid' })]);
    await renderIn(wrap(<ChatScreen />));
    await waitFor(() => screen.getByText('Booking confirmed'));
    expect(router.replace).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByText('View booking'));
    expect(router.push).toHaveBeenCalledWith('/booking/done/b1');
  });

  it('the other person sees who we are waiting for, and no pay button', async () => {
    k.fetchBookingsBetween.mockResolvedValue([booking({ opened_by: 'them', owner_id: 'them', sitter_id: 'me' })]);
    await renderIn(wrap(<ChatScreen />));
    await waitFor(() => expect(screen.getByText('Waiting for Mona to pay the booking fee')).toBeTruthy());
    expect(screen.queryByText('Pay the booking fee')).toBeNull();
  });

  it.each([
    ['not_configured', 'Payment is not available yet. Try again later.'],
    ['not_payable', 'This booking can no longer be paid. Check the terms again.'],
    ['pet_booked', 'That pet is already booked for these dates.'],
    ['too_many_attempts', 'Too many payment tries. Wait a little and try again.'],
    ['network', 'No connection. Check your internet and try again.'],
    ['something_else', 'We could not start the payment. Try again.'],
  ])('says what went wrong: %s', async (code, text) => {
    a.createFeePayment.mockRejectedValue(new a.ApiError(code, 400));
    await renderIn(wrap(<ChatScreen />));
    await waitFor(() => screen.getByText('Pay the booking fee'));
    await fireEvent.press(screen.getByText('Pay the booking fee'));
    await waitFor(() => expect(screen.getByText(text)).toBeTruthy());
    expect(Linking.openURL).not.toHaveBeenCalled();
    expect(screen.queryByText('Finish paying in your browser. This page updates by itself.')).toBeNull();
  });
});

describe('cancelling a confirmed booking shows what comes back', () => {
  const confirmed = () => k.fetchBookingsBetween.mockResolvedValue([booking({ status: 'confirmed', fee_status: 'paid' })]);
  it.each([
    [{ refund_cents: 7500, amount_cents: 7500, is_payer: true }, 'If you cancel now, the full booking fee of 75 EGP is refunded.'],
    [{ refund_cents: 6500, amount_cents: 7500, is_payer: true }, 'If you cancel now, 65 EGP of the booking fee is refunded.'],
    [{ refund_cents: 0, amount_cents: 7500, is_payer: true }, 'If you cancel now, the booking fee is not refunded.'],
    [{ refund_cents: 7500, amount_cents: 7500, is_payer: false }, 'If you cancel, the booking fee goes back to Mona.'],
  ])('%j', async (preview, text) => {
    confirmed(); k.fetchRefundPreview.mockResolvedValue(preview);
    await renderIn(wrap(<ChatScreen />));
    await waitFor(() => expect(screen.getByText(text)).toBeTruthy());
  });
  it('asks twice before cancelling', async () => {
    confirmed(); k.cancelBooking.mockResolvedValue(undefined);
    await renderIn(wrap(<ChatScreen />));
    await waitFor(() => screen.getByText('Cancel booking'));
    await fireEvent.press(screen.getByText('Cancel booking'));
    expect(k.cancelBooking).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByText('Tap again to cancel'));
    await waitFor(() => expect(k.cancelBooking).toHaveBeenCalledWith('b1'));
  });
});

describe('booking confirmed screen', () => {
  beforeEach(() => {
    params.mockReturnValue({ id: 'b1' });
    k.fetchBooking.mockResolvedValue(booking({ status: 'confirmed', fee_status: 'paid' }));
    k.fetchBookingLocation.mockResolvedValue({ lat: 28.5, lng: 34.5, address: 'Masbat Road, Building 14' });
    p.fetchCard.mockImplementation(async (id: string) => card(id, id === 'them' ? 'Mona' : 'Me'));
  });
  it.each(COMBOS)('renders in $mode / $locale', async ({ mode, locale }) => {
    await renderIn(wrap(<BookingDone />), { mode, locale });
    await waitFor(() => expect(screen.toJSON()).not.toBeNull());
  });
  it('shows the dates, who stays with whom, the exact pin and directions', async () => {
    await renderIn(wrap(<BookingDone />));
    await waitFor(() => expect(screen.getByText('Booking confirmed!')).toBeTruthy());
    expect(screen.getByText('Dec 1 to Dec 8 · 7 nights')).toBeTruthy();
    expect(screen.getByText('Luna stays with Mona')).toBeTruthy();
    expect(screen.getByText('Masbat Road, Building 14')).toBeTruthy();
    expect(screen.getByText('Exact pin unlocked')).toBeTruthy();
    expect(screen.getByText('Get directions in Google Maps')).toBeTruthy();
    expect(screen.getByText('Handover day')).toBeTruthy();
    await fireEvent.press(screen.getByText('Message Mona'));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/chat/c9'));
    expect(c.startConversation).toHaveBeenCalledWith('them');
  });
  it('says so when the host did not share a pin, and shows no map', async () => {
    k.fetchBookingLocation.mockResolvedValue(null);
    await renderIn(wrap(<BookingDone />));
    await waitFor(() => expect(screen.getByText('The host chose not to share an exact pin. Ask in chat.')).toBeTruthy());
    expect(screen.queryByText('Get directions in Google Maps')).toBeNull();
    expect(screen.queryByText('Exact pin unlocked')).toBeNull();
  });
  it('does not open a booking that is not confirmed, or one I am not part of', async () => {
    k.fetchBooking.mockResolvedValue(booking({ status: 'terms_agreed' }));
    const first = await renderIn(wrap(<BookingDone />));
    await waitFor(() => expect(screen.getByText('We could not open this booking. Try again.')).toBeTruthy());
    expect(k.fetchBookingLocation).not.toHaveBeenCalled();
    await first.unmount();
    k.fetchBooking.mockResolvedValue(booking({ status: 'confirmed', owner_id: 'x', sitter_id: 'y' }));
    await renderIn(wrap(<BookingDone />));
    await waitFor(() => expect(screen.getByText('We could not open this booking. Try again.')).toBeTruthy());
    expect(k.fetchBookingLocation).not.toHaveBeenCalled();
  });
});

describe('payBookingFee', () => {
  it('opens the page the server returns and gives back the amount', async () => {
    a.createFeePayment.mockResolvedValue({ url: 'https://pay', payment_id: 'p', amount_egp: 75 });
    const open = jest.fn(async () => {});
    await expect(bk.payBookingFee('b1', open)).resolves.toBe(75);
    expect(open).toHaveBeenCalledWith('https://pay');
  });
});

describe('the fee and the exact pin come only from the server', () => {
  it('reads the fee from the settings table and tolerates a missing or odd value', async () => {
    const real = jest.requireActual('../src/lib/bookings') as typeof bk;
    const from = jest.spyOn(supabase, 'from');
    const chain = (data: unknown, error: unknown = null) => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data, error }) }) }) });
    from.mockReturnValueOnce(chain({ value: '90' }) as never).mockReturnValueOnce(chain(null) as never).mockReturnValueOnce(chain({ value: 'abc' }) as never);
    await expect(real.fetchBookingFee()).resolves.toBe(90);
    await expect(real.fetchBookingFee()).resolves.toBeNull();
    await expect(real.fetchBookingFee()).resolves.toBeNull();
  });
  it('asks the server for the location and the refund preview', async () => {
    const real = jest.requireActual('../src/lib/bookings') as typeof bk;
    const rpc = jest.spyOn(supabase, 'rpc').mockResolvedValueOnce({ data: [{ lat: 1, lng: 2, address: 'x' }], error: null } as never).mockResolvedValueOnce({ data: null, error: { message: 'denied' } } as never).mockResolvedValueOnce({ data: [{ refund_cents: 1, amount_cents: 2, is_payer: true }], error: null } as never);
    await expect(real.fetchBookingLocation('b1')).resolves.toEqual({ lat: 1, lng: 2, address: 'x' });
    await expect(real.fetchBookingLocation('b1')).resolves.toBeNull();                      // a stranger is refused by the server
    await expect(real.fetchRefundPreview('b1')).resolves.toEqual({ refund_cents: 1, amount_cents: 2, is_payer: true });
    expect(rpc).toHaveBeenNthCalledWith(1, 'get_booking_location', { p_booking: 'b1' });
    expect(real.feePayerOf([booking({ opened_by: 'them' })])).toBe('them');
    expect(real.feePayerOf([booking({ opened_by: null })])).toBe('me');
    expect(real.feePayerOf([])).toBeNull();
  });
});

describe('haptics setting', () => {
  it('buzzes by default, stops when switched off, and remembers the choice', async () => {
    await initHaptics();
    expect(hapticsEnabled()).toBe(true);
    tap();
    expect(Haptics.impactAsync).toHaveBeenCalledTimes(1);
    await setHapticsEnabled(false);
    tap();
    expect(Haptics.impactAsync).toHaveBeenCalledTimes(1);
    await initHaptics();                                                                    // a fresh start reads the saved choice
    expect(hapticsEnabled()).toBe(false);
    await setHapticsEnabled(true);
    tap();
    expect(Haptics.impactAsync).toHaveBeenCalledTimes(2);
  });
  it('is a switch in Settings', async () => {
    await initHaptics();
    await renderIn(<Settings />);
    expect(screen.getByText('Vibration')).toBeTruthy();
    expect(screen.getByText('A small buzz when you swipe a card.')).toBeTruthy();
    await fireEvent.press(screen.getByText('Off'));
    await waitFor(() => expect(hapticsEnabled()).toBe(false));
    expect(screen.getAllByRole('button').find((b) => b.props.accessibilityState?.selected && b.props.children)).toBeTruthy();
    await fireEvent.press(screen.getAllByText('On').pop()!);
    await waitFor(() => expect(hapticsEnabled()).toBe(true));
  });
});
