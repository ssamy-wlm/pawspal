import { supabase } from '../src/lib/supabase';
import { setLocaleForTests } from '../src/i18n';
import { acceptedByMe, acceptedByOther, acceptTerms, Booking, cancelBooking, currentBookings, proposeTerms, requestBooking, requestSwap, termsText } from '../src/lib/bookings';

const b = (over: Partial<Booking> = {}): Booking => ({
  id: 'b1', owner_id: 'me', sitter_id: 'them', pet_id: 'p1', starts_on: '2026-12-01', ends_on: '2026-12-05', stay_location: 'sitter_home', cost_type: 'paid',
  price_per_night: 250, food_provided: true, status: 'requested', fee_status: 'unpaid', owner_accepted_at: null, sitter_accepted_at: null, swap_group: null, terms_version: 1, ...over,
});
afterEach(() => { jest.restoreAllMocks(); setLocaleForTests('en'); });

describe('which booking is current', () => {
  it('takes the newest open one, and both legs of a swap', () => {
    expect(currentBookings([b({ id: 'x', status: 'cancelled' }), b({ id: 'y' }), b({ id: 'z' })]).map((x) => x.id)).toEqual(['y']);
    const legs = [b({ id: 'l1', swap_group: 'g' }), b({ id: 'l2', swap_group: 'g', owner_id: 'them', sitter_id: 'me' }), b({ id: 'old', status: 'completed' })];
    expect(currentBookings(legs).map((x) => x.id)).toEqual(['l1', 'l2']);
  });
  it('is empty when nothing is open', () => {
    expect(currentBookings([b({ status: 'cancelled' }), b({ status: 'completed' })])).toEqual([]);
    expect(currentBookings([])).toEqual([]);
  });
});

describe('who has accepted', () => {
  it('reads my side and their side, on every leg', () => {
    expect(acceptedByMe([b({ owner_accepted_at: 'x' })], 'me')).toBe(true);
    expect(acceptedByMe([b({ sitter_accepted_at: 'x' })], 'me')).toBe(false);
    expect(acceptedByMe([b({ sitter_accepted_at: 'x' })], 'them')).toBe(true);
    expect(acceptedByOther([b({ sitter_accepted_at: 'x' })], 'me')).toBe(true);
    const swap = [b({ owner_accepted_at: 'x', swap_group: 'g' }), b({ owner_id: 'them', sitter_id: 'me', sitter_accepted_at: null, swap_group: 'g' })];
    expect(acceptedByMe(swap, 'me')).toBe(false);                                   // both legs must carry my acceptance
    expect(acceptedByMe([], 'me')).toBe(false);
  });
});

describe('terms in words', () => {
  it('says the dates, pet, place and cost', () => {
    expect(termsText(b(), 'Biscuit')).toEqual({ dates: 'Dec 1 – Dec 5', pet: 'Biscuit', location: 'At the host’s home', cost: '250 EGP per night, food provided' });
    expect(termsText(b({ cost_type: 'volunteer', food_provided: false, stay_location: 'owner_home' }), 'Mango')).toMatchObject({ location: 'At the owner’s home', cost: 'Free' });
    expect(termsText(b({ cost_type: 'swap', food_provided: false }), 'Mango').cost).toBe('Swap');
  });
  it('speaks Arabic too', () => {
    setLocaleForTests('ar');
    expect(termsText(b({ cost_type: 'volunteer', food_provided: false }), 'x').cost).toBe('مجاني');
  });
});

describe('asking the database', () => {
  const rpc = (reply: { data?: unknown; error?: { message: string } | null }) => jest.spyOn(supabase, 'rpc').mockResolvedValue({ data: reply.data ?? null, error: reply.error ?? null } as never);

  it('sends a stay request with the right names', async () => {
    const spy = rpc({ data: 'new-id' });
    await expect(requestBooking({ sitterId: 's', petId: 'p', starts_on: 'a', ends_on: 'b', location: 'owner_home', cost: 'paid', price: 200, food: true })).resolves.toBe('new-id');
    expect(spy).toHaveBeenCalledWith('request_booking', { p_sitter: 's', p_pet: 'p', p_starts: 'a', p_ends: 'b', p_location: 'owner_home', p_cost: 'paid', p_price: 200, p_food: true });
  });
  it('sends a swap request', async () => {
    const spy = rpc({ data: 'group' });
    await requestSwap({ otherId: 'o', myPetId: 'm', theirPetId: 't', myStarts: 'a', myEnds: 'b', theirStarts: 'c', theirEnds: 'd', food: false });
    expect(spy).toHaveBeenCalledWith('request_swap', { p_other: 'o', p_my_pet: 'm', p_their_pet: 't', p_my_starts: 'a', p_my_ends: 'b', p_their_starts: 'c', p_their_ends: 'd', p_food: false });
  });
  it('proposes terms, accepts and cancels', async () => {
    const spy = rpc({ data: 'terms_agreed' });
    await proposeTerms('b1', { starts_on: 'a', ends_on: 'b', location: 'sitter_home', cost: 'volunteer', price: null, food: false });
    expect(spy).toHaveBeenCalledWith('propose_terms', { p_booking: 'b1', p_starts: 'a', p_ends: 'b', p_location: 'sitter_home', p_cost: 'volunteer', p_price: null, p_food: false });
    await expect(acceptTerms('b1', 3)).resolves.toBe('terms_agreed');
    expect(spy).toHaveBeenLastCalledWith('accept_terms', { p_booking: 'b1', p_version: 3 });
    await cancelBooking('b1');
    expect(spy).toHaveBeenLastCalledWith('cancel_booking', { p_booking: 'b1', p_reason: '' });
  });
  it('turns the database’s refusals into short codes', async () => {
    const stay = { sitterId: 's', petId: 'p', starts_on: 'a', ends_on: 'b', location: 'sitter_home' as const, cost: 'volunteer' as const, price: null, food: false };
    rpc({ error: { message: 'there is already a request for these dates' } });
    await expect(requestBooking(stay)).rejects.toThrow('duplicate');
    rpc({ error: { message: 'too many open requests' } });
    await expect(requestBooking(stay)).rejects.toThrow('too_many');
    rpc({ error: { message: 'the terms changed' } });
    await expect(acceptTerms('b1', 1)).rejects.toThrow('terms_changed');
    rpc({ error: { message: 'that pet is already booked for these dates' } });
    await expect(requestBooking(stay)).rejects.toThrow('pet_booked');
    rpc({ error: { message: 'permission denied' } });
    await expect(requestBooking(stay)).rejects.toThrow('failed');
  });
});
