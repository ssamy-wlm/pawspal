import React from 'react';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { COMBOS, renderIn } from '../test-utils/render';
import { setLocaleForTests } from '../src/i18n';
import * as bk from '../src/lib/bookings';
import * as prof from '../src/lib/profile';
import BookingScreen from '../app/booking/[id]';
import { ToastProvider } from '../src/components/Toast';

let mockRole: 'owner' | 'sitter' | 'both' = 'both';
jest.mock('../src/lib/auth', () => ({ useAuth: () => ({ ready: true, session: { user: { id: 'me' } }, state: { status: 'active', role: mockRole }, refresh: jest.fn(), signOut: jest.fn() }) }));
jest.mock('../src/lib/bookings', () => ({ ...jest.requireActual('../src/lib/bookings'), fetchBooking: jest.fn(), requestBooking: jest.fn(), requestSwap: jest.fn(), proposeTerms: jest.fn() }));
jest.mock('../src/lib/profile', () => ({ ...jest.requireActual('../src/lib/profile'), fetchCard: jest.fn(), fetchPets: jest.fn() }));
// The calendar has its own tests: here each calendar is a button that picks fixed dates (the second one picks later dates).
jest.mock('../src/components/CalendarRange', () => {
  const { Pressable, Text } = require('react-native');
  let n = 0;
  return { CalendarRange: ({ onChange }: { onChange: (s: string, e: string) => void }) => {
    const mine = ++n;
    void mine;
    return <Pressable accessibilityRole="button" accessibilityLabel="pick dates" onPress={() => onChange('2026-12-01', '2026-12-05')}><Text>pick</Text></Pressable>;
  } };
});

const k = bk as jest.Mocked<typeof bk>;
const p = prof as jest.Mocked<typeof prof>;
const params = useLocalSearchParams as jest.Mock;
const wrap = (ui: React.ReactElement) => <ToastProvider>{ui}</ToastProvider>;
const pet = (id: string, name: string, owner: string): prof.Pet => ({ id, owner_id: owner, name, type: 'dog', size: 'small', age_years: 2, vaccinated: true, notes: null, photo_paths: ['x'], locked: false });
const card = (role: 'owner' | 'sitter' | 'both'): prof.PublicProfile => ({ id: 'them', first_name: 'Hana', role, bio: null, area: null, card_illustration: 'cat-mango', card_background: 'pattern', rating_avg: null, stays_count: 0, home_photo_path: null, home_tags: [] });
const booking = (over: Partial<bk.Booking> = {}): bk.Booking => ({ id: 'b1', owner_id: 'me', sitter_id: 'them', pet_id: 'p1', starts_on: '2026-12-01', ends_on: '2026-12-05', stay_location: 'sitter_home', cost_type: 'paid', price_per_night: 250, food_provided: true, status: 'requested', fee_status: 'unpaid', owner_accepted_at: null, sitter_accepted_at: null, swap_group: null, terms_version: 1, ...over });

beforeEach(() => {
  jest.clearAllMocks(); mockRole = 'both';
  params.mockReturnValue({ id: 'new', other: 'them' });
  p.fetchCard.mockResolvedValue(card('sitter'));
  p.fetchPets.mockImplementation(async (owner: string) => (owner === 'me' ? [pet('mine1', 'Biscuit', 'me'), pet('mine2', 'Rex', 'me')] : [pet('their1', 'Mango', 'them')]));
  k.requestBooking.mockResolvedValue('b9'); k.requestSwap.mockResolvedValue('g9'); k.proposeTerms.mockResolvedValue(undefined);
});
afterEach(() => setLocaleForTests('en'));

describe.each(COMBOS)('booking form in $mode / $locale', ({ mode, locale }) => {
  it('renders', async () => {
    await renderIn(wrap(<BookingScreen />), { mode, locale });
    await waitFor(() => expect(screen.toJSON()).not.toBeNull());
  });
});

describe('request a stay', () => {
  it('sends a free stay: pet, dates, place', async () => {
    await renderIn(wrap(<BookingScreen />));
    await waitFor(() => screen.getByText('Send request'));
    await fireEvent.press(screen.getByText('Send request'));
    expect(k.requestBooking).not.toHaveBeenCalled();                                        // no dates yet
    await fireEvent.press(screen.getByLabelText('pick dates'));
    await fireEvent.press(screen.getByText('Rex'));
    await fireEvent.press(screen.getByText('At the owner’s home'));
    await fireEvent.press(screen.getByText('Send request'));
    await waitFor(() => expect(k.requestBooking).toHaveBeenCalledWith({ sitterId: 'them', petId: 'mine2', starts_on: '2026-12-01', ends_on: '2026-12-05', location: 'owner_home', cost: 'volunteer', price: null, food: false }));
    expect(router.back).toHaveBeenCalled();
  });

  it('needs a price above zero when paid, and sends it with the food choice', async () => {
    await renderIn(wrap(<BookingScreen />));
    await waitFor(() => screen.getByText('Send request'));
    await fireEvent.press(screen.getByLabelText('pick dates'));
    await fireEvent.press(screen.getByText('Paid'));
    await fireEvent.changeText(screen.getByLabelText('Price per night (EGP)'), '٠');
    await fireEvent.press(screen.getByText('Send request'));
    expect(k.requestBooking).not.toHaveBeenCalled();
    await fireEvent.changeText(screen.getByLabelText('Price per night (EGP)'), '٢٥٠');
    await fireEvent.press(screen.getByText('Food provided'));
    await fireEvent.press(screen.getByText('Send request'));
    await waitFor(() => expect(k.requestBooking).toHaveBeenCalledWith(expect.objectContaining({ cost: 'paid', price: 250, food: true, petId: 'mine1' })));
  });

  it('explains a duplicate request and a full request list', async () => {
    await renderIn(wrap(<BookingScreen />));
    await waitFor(() => screen.getByText('Send request'));
    await fireEvent.press(screen.getByLabelText('pick dates'));
    k.requestBooking.mockRejectedValueOnce(new Error('duplicate'));
    await fireEvent.press(screen.getByText('Send request'));
    await waitFor(() => expect(screen.getByText('You already have a request for these dates.')).toBeTruthy());
    k.requestBooking.mockRejectedValueOnce(new Error('too_many'));
    await fireEvent.press(screen.getByText('Send request'));
    await waitFor(() => expect(screen.getByText('You have too many open requests.')).toBeTruthy());
    k.requestBooking.mockRejectedValueOnce(new Error('failed'));
    await fireEvent.press(screen.getByText('Send request'));
    await waitFor(() => expect(screen.getByText('We could not send that. Try again.')).toBeTruthy());
    expect(router.back).not.toHaveBeenCalled();
  });

  it('says so when the pet is already booked for those dates', async () => {
    await renderIn(wrap(<BookingScreen />));
    await waitFor(() => screen.getByText('Send request'));
    await fireEvent.press(screen.getByLabelText('pick dates'));
    k.requestBooking.mockRejectedValueOnce(new Error('pet_booked'));
    await fireEvent.press(screen.getByText('Send request'));
    await waitFor(() => expect(screen.getByText('That pet is already booked for these dates.')).toBeTruthy());
  });

  it('asks you to add a pet first when you have none', async () => {
    p.fetchPets.mockImplementation(async (owner: string) => (owner === 'me' ? [] : []));
    await renderIn(wrap(<BookingScreen />));
    await waitFor(() => expect(screen.getByText('Add a pet first, so a host can meet them.')).toBeTruthy());
    await fireEvent.press(screen.getByText('Add a pet'));
    expect(router.push).toHaveBeenCalledWith('/pets/new');
  });

  it('says so when the host cannot be found', async () => {
    p.fetchCard.mockResolvedValue(null);
    await renderIn(wrap(<BookingScreen />));
    await waitFor(() => expect(screen.getByText('We could not send that. Try again.')).toBeTruthy());
  });
});

describe('request a swap', () => {
  it('is offered only when both of you host and own pets', async () => {
    p.fetchCard.mockResolvedValue(card('sitter'));
    const first = await renderIn(wrap(<BookingScreen />));
    await waitFor(() => screen.getByText('Send request'));
    expect(screen.queryByText('A swap')).toBeNull();
    await first.unmount();
    p.fetchCard.mockResolvedValue(card('both')); mockRole = 'owner';
    const second = await renderIn(wrap(<BookingScreen />));
    await waitFor(() => screen.getByText('Send request'));
    expect(screen.queryByText('A swap')).toBeNull();
    await second.unmount();
    mockRole = 'both';
    await renderIn(wrap(<BookingScreen />));
    await waitFor(() => expect(screen.getByText('A swap')).toBeTruthy());
  });

  it('sends two pets and two sets of dates as one swap', async () => {
    p.fetchCard.mockResolvedValue(card('both'));
    await renderIn(wrap(<BookingScreen />));
    await waitFor(() => screen.getByText('A swap'));
    await fireEvent.press(screen.getByText('A swap'));
    expect(screen.getByText('Their pet')).toBeTruthy();
    expect(screen.queryByText('Paid')).toBeNull();                                         // a swap has no price
    const calendars = screen.getAllByLabelText('pick dates');
    expect(calendars).toHaveLength(2);
    await fireEvent.press(screen.getByText('Send request'));
    expect(k.requestSwap).not.toHaveBeenCalled();                                          // the dates are not both chosen
    for (const cal of calendars) await fireEvent.press(cal);
    await fireEvent.press(screen.getByText('Mango'));
    await fireEvent.press(screen.getByText('Send request'));
    await waitFor(() => expect(k.requestSwap).toHaveBeenCalledWith({ otherId: 'them', myPetId: 'mine1', theirPetId: 'their1', myStarts: '2026-12-01', myEnds: '2026-12-05', theirStarts: '2026-12-01', theirEnds: '2026-12-05', food: false }));
  });
});

describe('change the terms', () => {
  it('loads the current terms and proposes the changed ones', async () => {
    params.mockReturnValue({ id: 'b1', other: 'them' });
    k.fetchBooking.mockResolvedValue(booking());
    await renderIn(wrap(<BookingScreen />));
    await waitFor(() => expect(screen.getByText('Save changes')).toBeTruthy());
    expect(screen.getByDisplayValue('250')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Price per night (EGP)'), '300');
    await fireEvent.press(screen.getByText('At the owner’s home'));
    await fireEvent.press(screen.getByText('Save changes'));
    await waitFor(() => expect(k.proposeTerms).toHaveBeenCalledWith('b1', { starts_on: '2026-12-01', ends_on: '2026-12-05', location: 'owner_home', cost: 'paid', price: 300, food: true }));
    expect(router.back).toHaveBeenCalled();
  });

  it('keeps a swap leg a swap: only dates and food can change', async () => {
    params.mockReturnValue({ id: 'l1', other: 'them' });
    k.fetchBooking.mockResolvedValue(booking({ id: 'l1', cost_type: 'swap', price_per_night: null, swap_group: 'g' }));
    await renderIn(wrap(<BookingScreen />));
    await waitFor(() => expect(screen.getByText('Save changes')).toBeTruthy());
    expect(screen.queryByText('Paid')).toBeNull();
    expect(screen.queryByText('At the host’s home')).toBeNull();
    await fireEvent.press(screen.getByText('Save changes'));
    await waitFor(() => expect(k.proposeTerms).toHaveBeenCalledWith('l1', expect.objectContaining({ cost: 'swap', price: null, location: 'sitter_home' })));
  });

  it('refuses to open a booking that is confirmed or cancelled', async () => {
    params.mockReturnValue({ id: 'b1', other: 'them' });
    k.fetchBooking.mockResolvedValue(booking({ status: 'confirmed' }));
    await renderIn(wrap(<BookingScreen />));
    await waitFor(() => expect(screen.getByText('We could not send that. Try again.')).toBeTruthy());
    expect(screen.queryByText('Save changes')).toBeNull();
  });
});
