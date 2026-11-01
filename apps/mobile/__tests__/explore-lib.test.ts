import { supabase } from '../src/lib/supabase';
import { fetchMapAvailability, postAvailability, postTravel, saveToShortlist } from '../src/lib/explore';
import { removePhotoFiles } from '../src/lib/profile';

type Reply = { error: { code?: string; message: string } | null };
const table = (reply: Reply) => ({ insert: jest.fn(async () => reply) });
afterEach(() => jest.restoreAllMocks());

describe('shortlist and posts', () => {
  it('treats saving the same host twice as fine', async () => {
    jest.spyOn(supabase, 'from').mockReturnValue(table({ error: { code: '23505', message: 'duplicate' } }) as never);
    await expect(saveToShortlist('me', 'h')).resolves.toBeUndefined();
  });
  it('says "full" when the shortlist is full, and "failed" for anything else', async () => {
    jest.spyOn(supabase, 'from').mockReturnValueOnce(table({ error: { message: 'shortlist is full' } }) as never)
      .mockReturnValueOnce(table({ error: { code: '42501', message: 'denied' } }) as never);
    await expect(saveToShortlist('me', 'h')).rejects.toThrow('full');
    await expect(saveToShortlist('me', 'h')).rejects.toThrow('failed');
  });
  it('maps the open-post limit to a message the screen understands', async () => {
    jest.spyOn(supabase, 'from').mockReturnValue(table({ error: { message: 'too many open posts' } }) as never);
    await expect(postAvailability('me', { starts_on: 'a', ends_on: 'b', pets_accepted: ['dog'], offers: ['paid'], price_per_night: 1, negotiable: false })).rejects.toThrow('too_many');
    await expect(postTravel('me', { pet_type: 'dog', starts_on: 'a', ends_on: 'b', budget_per_night: null, note: '  ' })).rejects.toThrow('too_many');
  });
  it('stores an empty travel note as nothing', async () => {
    const t = table({ error: null });
    jest.spyOn(supabase, 'from').mockReturnValue(t as never);
    await postTravel('me', { pet_type: 'cat', starts_on: 'a', ends_on: 'b', budget_per_night: 100, note: '   ' });
    expect(t.insert).toHaveBeenCalledWith({ user_id: 'me', pet_type: 'cat', starts_on: 'a', ends_on: 'b', budget_per_night: 100, note: null });
  });
});

describe('removePhotoFiles', () => {
  it('asks storage to delete the files, and does nothing for an empty list', async () => {
    const remove = jest.fn(async () => ({ data: [], error: null }));
    const from = jest.spyOn(supabase.storage, 'from').mockReturnValue({ remove } as never);
    await removePhotoFiles('pets', []);
    expect(from).not.toHaveBeenCalled();
    await removePhotoFiles('pets', ['u/a.jpg', 'u/b.jpg']);
    expect(from).toHaveBeenCalledWith('pets');
    expect(remove).toHaveBeenCalledWith(['u/a.jpg', 'u/b.jpg']);
  });
  it('never throws, even when storage does', async () => {
    jest.spyOn(supabase.storage, 'from').mockReturnValue({ remove: jest.fn(async () => { throw new Error('offline'); }) } as never);
    await expect(removePhotoFiles('homes', ['u/a.jpg'])).resolves.toBeUndefined();
  });
});

describe('map availability', () => {
  it('asks for the pet type and a limit, and returns the rows', async () => {
    const spy = jest.spyOn(supabase, 'rpc').mockResolvedValue({ data: [{ availability_id: 'a' }], error: null } as never);
    await expect(fetchMapAvailability('dog')).resolves.toEqual([{ availability_id: 'a' }]);
    expect(spy).toHaveBeenCalledWith('map_availability', { p_pet_type: 'dog', p_limit: 200 });
    await fetchMapAvailability(null, 50);
    expect(spy).toHaveBeenLastCalledWith('map_availability', { p_pet_type: null, p_limit: 50 });
  });
  it('turns nothing into an empty list and throws on an error', async () => {
    jest.spyOn(supabase, 'rpc').mockResolvedValueOnce({ data: null, error: null } as never).mockResolvedValueOnce({ data: null, error: { message: 'denied' } } as never);
    await expect(fetchMapAvailability(null)).resolves.toEqual([]);
    await expect(fetchMapAvailability(null)).rejects.toBeTruthy();
  });
});
