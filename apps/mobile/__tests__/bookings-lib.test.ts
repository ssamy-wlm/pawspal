import { supabase } from '../src/lib/supabase';
import { setLocaleForTests } from '../src/i18n';
import { acceptedByMe, acceptedByOther, acceptTerms, Booking, cancelBooking, currentBooking, proposeTerms, requestBooking, termsText } from '../src/lib/bookings';

const b = (over: Partial<Booking> = {}): Booking => ({
  id: 'b1', owner_id: 'me', sitter_id: 'them', pet_id: 'p1', starts_on: '2026-12-01', ends_on: '2026-12-05', stay_location: 'sitter_home', cost_type: 'paid',
  price_per_night: 250, food_provided: true, status: 'requested', owner_accepted_at: null, sitter_accepted_at: null, terms_version: 1, ...over,
});
afterEach(() => { jest.restoreAllMocks(); setLocaleForTests('en'); });

describe('which booking is current', () => {
  it('takes the newest open one', () => {
    expect(currentBooking([b({ id: 'x', status: 'cancelled' }), b({ id: 'y' }), b({ id: 'z' })])?.id).toBe('y');
    expect(currentBooking([b({ id: 'c', status: 'confirmed' })])?.id).toBe('c');
  });
  it('is null when nothing is open', () => {
    expect(currentBooking([b({ status: 'cancelled' }), b({ status: 'completed' })])).toBeNull();
    expect(currentBooking([])).toBeNull();
  });
});

describe('who has accepted', () => {
  it('reads my side and their side', () => {
    expect(acceptedByMe(b({ owner_accepted_at: 'x' }), 'me')).toBe(true);
    expect(acceptedByMe(b({ sitter_accepted_at: 'x' }), 'me')).toBe(false);
    expect(acceptedByMe(b({ sitter_accepted_at: 'x' }), 'them')).toBe(true);
    expect(acceptedByOther(b({ sitter_accepted_at: 'x' }), 'me')).toBe(true);
    expect(acceptedByMe(null, 'me')).toBe(false);
  });
});

describe('terms in words', () => {
  it('says the dates, pet, place and cost', () => {
    expect(termsText(b(), 'Biscuit')).toEqual({ dates: 'Dec 1 – Dec 5', pet: 'Biscuit', location: 'At the host’s home', cost: '250 EGP per night, food provided' });
    expect(termsText(b({ cost_type: 'volunteer', food_provided: false, stay_location: 'owner_home' }), 'Mango')).toMatchObject({ location: 'At the owner’s home', cost: 'Free' });
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
  it('proposes terms, accepts and cancels', async () => {
    const spy = rpc({ data: 'confirmed' });
    await proposeTerms('b1', { starts_on: 'a', ends_on: 'b', location: 'sitter_home', cost: 'volunteer', price: null, food: false });
    expect(spy).toHaveBeenCalledWith('propose_terms', { p_booking: 'b1', p_starts: 'a', p_ends: 'b', p_location: 'sitter_home', p_cost: 'volunteer', p_price: null, p_food: false });
    await expect(acceptTerms('b1', 3)).resolves.toBe('confirmed');
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
    rpc({ error: { message: 'booking fee is unpaid' } });
    await expect(requestBooking(stay)).rejects.toThrow('failed');                    // there are no fee codes any more
    rpc({ error: { message: 'permission denied' } });
    await expect(requestBooking(stay)).rejects.toThrow('failed');
  });
});
