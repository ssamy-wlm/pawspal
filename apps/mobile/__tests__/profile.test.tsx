import React from 'react';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { COMBOS, renderIn } from '../test-utils/render';
import { setLocaleForTests } from '../src/i18n';
import * as api from '../src/lib/api';
import * as prof from '../src/lib/profile';
import EditProfile from '../app/profile/edit';
import Pets from '../app/pets/index';
import PetScreen from '../app/pets/[id]';
import HostProfile from '../app/host/[id]';
import ProfileTab from '../app/(tabs)/profile';

jest.mock('../src/lib/auth', () => ({ useAuth: () => ({ ready: true, session: { user: { id: 'me' } }, state: { status: 'active' }, refresh: jest.fn(), signOut: jest.fn(async () => {}) }) }));
jest.mock('../src/lib/api', () => ({ ...jest.requireActual('../src/lib/api'), uploadPhoto: jest.fn() }));
jest.mock('../src/lib/profile', () => ({
  fetchMyProfile: jest.fn(), fetchCard: jest.fn(), saveMyProfile: jest.fn(), fetchPets: jest.fn(), fetchPet: jest.fn(), savePet: jest.fn(),
  deletePet: jest.fn(), fetchMyPetCare: jest.fn(), saveMyPetCare: jest.fn(), removePhotoFiles: jest.fn(), HOME_TAGS: ['garden','fenced_yard','pet_first_aid','experienced','has_own_pets','quiet_home','near_beach','air_conditioning','works_from_home','medication_ok'], MAX_HOME_TAGS: 8, useSignedUrl: jest.fn(() => 'https://signed.example/photo.jpg'),
}));
jest.mock('../src/lib/explore', () => ({ fetchAvailability: jest.fn() }));
import * as exploreLib from '../src/lib/explore';
const ex = exploreLib as jest.Mocked<typeof exploreLib>;
const p = prof as jest.Mocked<typeof prof>;
const a = api as jest.Mocked<typeof api>;
const params = useLocalSearchParams as jest.Mock;

const me: prof.PublicProfile = { id: 'me', first_name: 'Mona', role: 'both', bio: 'Dive instructor with a garden.', area: 'Masbat',
  card_illustration: 'cat-mango', card_background: 'circles_orange', rating_avg: 4.9, stays_count: 32, home_photo_path: 'me/home.jpg', home_tags: ['garden', 'pet_first_aid'] };
const pet: prof.Pet = { id: 'pet-1', owner_id: 'me', name: 'Biscuit', type: 'dog', size: 'medium', age_years: 3, vaccinated: true, notes: 'Loves walks', photo_paths: ['me/p1.jpg'], locked: false };

beforeEach(() => {
  jest.clearAllMocks();
  p.fetchMyProfile.mockResolvedValue(me); p.fetchCard.mockResolvedValue({ ...me, id: 'host-1' });
  p.fetchPets.mockResolvedValue([pet]); p.fetchPet.mockResolvedValue(pet);
  p.fetchMyPetCare.mockResolvedValue({ vet_name: 'Dr Samir', vet_phone: '0620000000', care_notes: 'Storms' });
  ex.fetchAvailability.mockResolvedValue([]);
  p.savePet.mockResolvedValue('pet-1'); p.saveMyProfile.mockResolvedValue(undefined); p.saveMyPetCare.mockResolvedValue(undefined);
});
afterEach(() => setLocaleForTests('en'));

describe.each(COMBOS)('profile screens in $mode / $locale', ({ mode, locale }) => {
  it.each([['edit', EditProfile], ['pets', Pets], ['pet', PetScreen], ['host', HostProfile], ['tab', ProfileTab]] as const)('%s renders', async (_n, Screen) => {
    params.mockReturnValue({ id: 'pet-1' });
    await renderIn(<Screen />, { mode, locale });
    await waitFor(() => expect(screen.toJSON()).not.toBeNull());
  });
});

describe('edit profile', () => {
  it('loads your profile, previews the card style and saves the choices', async () => {
    await renderIn(<EditProfile />);
    await waitFor(() => expect(screen.getByLabelText('First name')).toBeTruthy());
    expect(screen.getByDisplayValue('Mona')).toBeTruthy();
    expect(screen.getByText('Looking for a sitter and hosting')).toBeTruthy();
    expect(screen.getByText('Your role is fixed once your profile has been reviewed.')).toBeTruthy();
    expect(screen.getByLabelText('Mango the cat')).toBeTruthy();                       // the live preview is labelled
    await fireEvent.press(screen.getByText('Storm the husky'));
    await fireEvent.press(screen.getByText('Navy'));
    await fireEvent.changeText(screen.getByLabelText('About you'), 'New text');
    await fireEvent.press(screen.getByText('Save'));
    await waitFor(() => expect(p.saveMyProfile).toHaveBeenCalledWith('me', { first_name: 'Mona', bio: 'New text', area: 'Masbat', card_illustration: 'husky-storm', card_background: 'navy', home_tags: ['garden', 'pet_first_aid'] }));
    expect(router.back).toHaveBeenCalled();
  });

  it('picks home tags, at most eight', async () => {
    p.fetchMyProfile.mockResolvedValue({ ...me, home_tags: [] });
    await renderIn(<EditProfile />);
    await waitFor(() => screen.getByText('About your home'));
    for (const k of ['Garden', 'Fenced yard', 'Pet first aid', 'Experienced', 'Has own pets', 'Quiet home', 'Near the beach', 'Air conditioning', 'Works from home', 'Can give medication']) {
      await fireEvent.press(screen.getByText(k));
    }
    await fireEvent.press(screen.getByText('Save'));
    await waitFor(() => expect(p.saveMyProfile).toHaveBeenCalled());
    const tags = (p.saveMyProfile.mock.calls[0][1] as { home_tags: string[] }).home_tags;
    expect(tags).toHaveLength(8);
    expect(tags).not.toContain('works_from_home');                                      // the ninth and tenth were refused
  });

  it('does not offer home tags to someone who only needs a sitter', async () => {
    p.fetchMyProfile.mockResolvedValue({ ...me, role: 'owner' });
    await renderIn(<EditProfile />);
    await waitFor(() => screen.getByLabelText('First name'));
    expect(screen.queryByText('About your home')).toBeNull();
  });

  it('cannot save without a name', async () => {
    await renderIn(<EditProfile />);
    await waitFor(() => screen.getByLabelText('First name'));
    await fireEvent.changeText(screen.getByLabelText('First name'), '  ');
    await fireEvent.press(screen.getByText('Save'));
    expect(p.saveMyProfile).not.toHaveBeenCalled();
  });

  it('shows a plain message when saving fails', async () => {
    p.saveMyProfile.mockRejectedValue(new Error('x'));
    await renderIn(<EditProfile />);
    await waitFor(() => screen.getByLabelText('First name'));
    await fireEvent.press(screen.getByText('Save'));
    await waitFor(() => expect(screen.getByText('Something went wrong. Try again.')).toBeTruthy());
    expect(router.back).not.toHaveBeenCalled();
  });
});

describe('my pets', () => {
  it('lists pets and marks one in a confirmed booking', async () => {
    p.fetchPets.mockResolvedValue([pet, { ...pet, id: 'pet-2', name: 'Mango', type: 'cat', locked: true }]);
    await renderIn(<Pets />);
    await waitFor(() => expect(screen.getByText('Biscuit')).toBeTruthy());
    expect(screen.getByText('Dog · Medium · 3 years')).toBeTruthy();
    expect(screen.getByLabelText(/^Mango\. .*In a confirmed booking/)).toBeTruthy();
    await fireEvent.press(screen.getByLabelText(/^Biscuit/));
    expect(router.push).toHaveBeenCalledWith('/pets/pet-1');
  });

  it('invites you to add a first pet', async () => {
    p.fetchPets.mockResolvedValue([]);
    await renderIn(<Pets />);
    await waitFor(() => expect(screen.getByText('No pets yet. Add one so hosts can meet them.')).toBeTruthy());
    await fireEvent.press(screen.getByText('Add a pet'));
    expect(router.push).toHaveBeenCalledWith('/pets/new');
  });
});

describe('pet screen', () => {
  it('adds a new pet with a photo and private vet details', async () => {
    params.mockReturnValue({ id: 'new' });
    a.uploadPhoto.mockResolvedValue('me/new.jpg');
    p.savePet.mockResolvedValue('pet-9');
    await renderIn(<PetScreen />);
    await fireEvent.press(screen.getByText('Save pet'));
    expect(p.savePet).not.toHaveBeenCalled();                                          // no name or photo yet
    await fireEvent.changeText(screen.getByLabelText('Pet name'), 'Mango');
    await fireEvent.press(screen.getByText('Cat'));
    await fireEvent.press(screen.getByText('Small'));
    await fireEvent.changeText(screen.getByLabelText('Age in years (optional)'), '2a');
    await fireEvent.press(screen.getByText('Add a photo'));
    await waitFor(() => expect(a.uploadPhoto).toHaveBeenCalledWith('pet', 'file:///photo.jpg'));
    await fireEvent.changeText(screen.getByLabelText('Vet name'), 'Dr Samir');
    await fireEvent.changeText(screen.getByLabelText('Vet phone'), '0620000000');
    await fireEvent.press(screen.getByText('Save pet'));
    await waitFor(() => expect(p.savePet).toHaveBeenCalledWith('me', null, { name: 'Mango', type: 'cat', size: 'small', age_years: 2, vaccinated: false, notes: '', photo_paths: ['me/new.jpg'] }));
    expect(p.saveMyPetCare).toHaveBeenCalledWith('pet-9', { vet_name: 'Dr Samir', vet_phone: '0620000000', care_notes: '' });
    expect(router.back).toHaveBeenCalled();
    expect(screen.queryByText('Delete pet')).toBeNull();                              // nothing to delete yet
  });

  it('loads your own pet with its private details, and deletes it after a second tap', async () => {
    params.mockReturnValue({ id: 'pet-1' });
    await renderIn(<PetScreen />);
    await waitFor(() => expect(screen.getByDisplayValue('Biscuit')).toBeTruthy());
    expect(screen.getByDisplayValue('Dr Samir')).toBeTruthy();
    expect(screen.getByText('Only you, and your host once a booking is confirmed, can see these.')).toBeTruthy();
    await fireEvent.press(screen.getByText('Delete pet'));
    expect(p.deletePet).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByText('Tap again to delete'));
    await waitFor(() => expect(p.deletePet).toHaveBeenCalledWith('pet-1'));
  });

  it('never wipes saved vet details when they could not be read', async () => {
    p.fetchMyPetCare.mockRejectedValue(new Error('offline'));
    params.mockReturnValue({ id: 'pet-1' });
    await renderIn(<PetScreen />);
    await waitFor(() => screen.getByDisplayValue('Biscuit'));
    await fireEvent.changeText(screen.getByLabelText('About your pet'), 'Updated');
    await fireEvent.press(screen.getByText('Save pet'));
    await waitFor(() => expect(p.savePet).toHaveBeenCalled());
    expect(p.saveMyPetCare).not.toHaveBeenCalled();
  });

  it('understands an age typed with Arabic digits', async () => {
    params.mockReturnValue({ id: 'pet-1' });
    await renderIn(<PetScreen />);
    await waitFor(() => screen.getByDisplayValue('Biscuit'));
    await fireEvent.changeText(screen.getByLabelText('Age in years (optional)'), '٤');
    await fireEvent.press(screen.getByText('Save pet'));
    await waitFor(() => expect(p.savePet).toHaveBeenCalledWith('me', 'pet-1', expect.objectContaining({ age_years: 4 })));
  });

  it('deletes the photo files that were taken off the pet, and ones added then dropped, once the pet is saved', async () => {
    p.fetchPet.mockResolvedValue({ ...pet, photo_paths: ['me/p1.jpg', 'me/p2.jpg'] });
    a.uploadPhoto.mockResolvedValueOnce('me/new1.jpg').mockResolvedValueOnce('me/new2.jpg');
    params.mockReturnValue({ id: 'pet-1' });
    await renderIn(<PetScreen />);
    await waitFor(() => screen.getByDisplayValue('Biscuit'));
    await fireEvent.press(screen.getByText('Add a photo'));
    await waitFor(() => screen.getByLabelText('Remove photo 3'));
    await fireEvent.press(screen.getByText('Add a photo'));
    await waitFor(() => screen.getByLabelText('Remove photo 4'));
    await fireEvent.press(screen.getByLabelText('Remove photo 4'));                      // added, then dropped
    await fireEvent.press(screen.getByLabelText('Remove photo 1'));                      // an old photo taken off
    await fireEvent.press(screen.getByText('Save pet'));
    await waitFor(() => expect(p.removePhotoFiles).toHaveBeenCalled());
    expect(p.savePet).toHaveBeenCalledWith('me', 'pet-1', expect.objectContaining({ photo_paths: ['me/p2.jpg', 'me/new1.jpg'] }));
    const [bucket, paths] = p.removePhotoFiles.mock.calls[0];
    expect(bucket).toBe('pets');
    expect([...(paths as string[])].sort()).toEqual(['me/new2.jpg', 'me/p1.jpg']);
  });

  it('deletes every photo file of a pet that is deleted, after the pet itself', async () => {
    p.deletePet.mockResolvedValue(undefined);
    params.mockReturnValue({ id: 'pet-1' });
    await renderIn(<PetScreen />);
    await waitFor(() => screen.getByDisplayValue('Biscuit'));
    await fireEvent.press(screen.getByText('Delete pet'));
    await fireEvent.press(screen.getByText('Tap again to delete'));
    await waitFor(() => expect(p.removePhotoFiles).toHaveBeenCalledWith('pets', ['me/p1.jpg']));
    expect(p.deletePet.mock.invocationCallOrder[0]).toBeLessThan(p.removePhotoFiles.mock.invocationCallOrder[0]);
  });

  it('keeps the files when the pet could not be deleted', async () => {
    p.deletePet.mockRejectedValue(new Error('locked'));
    params.mockReturnValue({ id: 'pet-1' });
    await renderIn(<PetScreen />);
    await waitFor(() => screen.getByDisplayValue('Biscuit'));
    await fireEvent.press(screen.getByText('Delete pet'));
    await fireEvent.press(screen.getByText('Tap again to delete'));
    await waitFor(() => expect(screen.getByText('Something went wrong. Try again.')).toBeTruthy());
    expect(p.removePhotoFiles).not.toHaveBeenCalled();
  });

  it('keeps at least one photo on a pet', async () => {
    params.mockReturnValue({ id: 'pet-1' });
    await renderIn(<PetScreen />);
    await waitFor(() => screen.getByDisplayValue('Biscuit'));
    expect(screen.queryByLabelText('Remove photo 1')).toBeNull();
  });

  it('a pet in a confirmed booking cannot be edited: no form, no vet fields, a clear note', async () => {
    p.fetchPet.mockResolvedValue({ ...pet, locked: true });
    params.mockReturnValue({ id: 'pet-1' });
    await renderIn(<PetScreen />);
    await waitFor(() => expect(screen.getByText('This pet is in a confirmed booking, so it cannot be changed until the stay ends.')).toBeTruthy());
    expect(screen.queryByText('Save pet')).toBeNull();
    expect(screen.queryByLabelText('Vet name')).toBeNull();
    expect(screen.queryByText('Delete pet')).toBeNull();
    expect(screen.getByText('Biscuit')).toBeTruthy();
  });

  it("someone else's pet is read-only and never asks for private details", async () => {
    p.fetchPet.mockResolvedValue({ ...pet, owner_id: 'host-1' });
    params.mockReturnValue({ id: 'pet-1' });
    await renderIn(<PetScreen />);
    await waitFor(() => expect(screen.getByText('Biscuit')).toBeTruthy());
    expect(p.fetchMyPetCare).not.toHaveBeenCalled();
    expect(screen.queryByText('Save pet')).toBeNull();
    expect(screen.queryByLabelText('Vet phone')).toBeNull();
    expect(screen.queryByText('Private details')).toBeNull();
    expect(screen.getByText('Dog · Medium · 3 years · Vaccinated')).toBeTruthy();
  });

  it('says so when the pet cannot be found', async () => {
    p.fetchPet.mockResolvedValue(null);
    params.mockReturnValue({ id: 'nope' });
    await renderIn(<PetScreen />);
    await waitFor(() => expect(screen.getByText('We could not find this pet.')).toBeTruthy());
  });
});

describe('host profile', () => {
  it('shows name, area, stats, about, pets and home', async () => {
    params.mockReturnValue({ id: 'host-1' });
    await renderIn(<HostProfile />);
    await waitFor(() => expect(screen.getByText('Mona')).toBeTruthy());
    expect(screen.getByText('Masbat')).toBeTruthy();
    expect(screen.getByLabelText('4.9 rating')).toBeTruthy();
    expect(screen.getByLabelText('32 stays')).toBeTruthy();
    expect(screen.getByText('Dive instructor with a garden.')).toBeTruthy();
    await waitFor(() => expect(screen.getByLabelText(/^Biscuit/)).toBeTruthy());
    expect(screen.getByLabelText('Home')).toBeTruthy();
  });

  it('shows tag chips (pets accepted and home tags), available dates and terms', async () => {
    ex.fetchAvailability.mockResolvedValue([
      { id: 'av1', starts_on: '2026-12-01', ends_on: '2026-12-09', pets_accepted: ['dog', 'cat'], offers: ['paid', 'swap', 'food_provided'], price_per_night: 250, negotiable: true },
    ]);
    params.mockReturnValue({ id: 'host-1' });
    await renderIn(<HostProfile />);
    await waitFor(() => expect(screen.getByText('Dogs')).toBeTruthy());
    for (const tag of ['Cats', 'Garden', 'Pet first aid']) expect(screen.getByText(tag)).toBeTruthy();
    expect(screen.queryByText('Fenced yard')).toBeNull();
    expect(screen.getByText('Available')).toBeTruthy();
    expect(screen.getByText('Dec 1 – Dec 9')).toBeTruthy();
    expect(screen.getByText('Terms')).toBeTruthy();
    expect(screen.getByText('250 EGP per night, negotiable')).toBeTruthy();
    expect(screen.getByText('Swap welcome')).toBeTruthy();
    expect(screen.getByText('Food provided')).toBeTruthy();
  });

  it('shows "New" for a host with no rating and a note when there is no description', async () => {
    p.fetchCard.mockResolvedValue({ ...me, rating_avg: null, stays_count: 0, bio: null, home_photo_path: null });
    params.mockReturnValue({ id: 'host-1' });
    await renderIn(<HostProfile />);
    await waitFor(() => expect(screen.getByText('No description yet.')).toBeTruthy());
    expect(screen.getByLabelText('New rating')).toBeTruthy();
  });

  it('shows a plain message for a blocked, unreviewed or missing person', async () => {
    p.fetchCard.mockResolvedValue(null);
    params.mockReturnValue({ id: 'someone' });
    await renderIn(<HostProfile />);
    await waitFor(() => expect(screen.getByText('We could not find this profile.')).toBeTruthy());
    expect(p.fetchPets).not.toHaveBeenCalled();
  });
});

describe('profile tab', () => {
  it('shows your card with links to edit, pets and settings', async () => {
    await renderIn(<ProfileTab />);
    await waitFor(() => expect(screen.getByLabelText(/Mona, Masbat/)).toBeTruthy());
    expect(screen.getByLabelText('Edit profile')).toBeTruthy();
    expect(screen.getByLabelText('My pets')).toBeTruthy();
    expect(screen.getByText('Sign out')).toBeTruthy();
  });
});
