import React from 'react';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { COMBOS, renderIn } from '../test-utils/render';
import { setLocaleForTests } from '../src/i18n';
import * as search from '../src/lib/search';
import * as explore from '../src/lib/explore';
import * as prof from '../src/lib/profile';
import Explore, { ROW_HEIGHT, rowLayout } from '../app/(tabs)/explore';
import CalendarTab from '../app/(tabs)/calendar';
import Shortlist from '../app/shortlist';
import Travellers from '../app/travellers';
import PostDates from '../app/post-dates';
import { ResultsMap } from '../src/components/ResultsMap';
import { CardArt, PawHeartPattern } from '../src/components/CardArt';
import { ToastProvider } from '../src/components/Toast';

let mockRole: 'owner' | 'sitter' | 'both' = 'both';
jest.mock('../src/lib/auth', () => ({ useAuth: () => ({ ready: true, session: { user: { id: 'me' } }, state: { status: 'active', role: mockRole }, refresh: jest.fn(), signOut: jest.fn() }) }));
jest.mock('../src/lib/search', () => ({ ...jest.requireActual('../src/lib/search'), searchStays: jest.fn(), browseRandom: jest.fn() }));
jest.mock('../src/lib/explore', () => ({
  saveToShortlist: jest.fn(), removeFromShortlist: jest.fn(), fetchShortlist: jest.fn(), postAvailability: jest.fn(), postTravel: jest.fn(),
  fetchAvailability: jest.fn(), fetchTravelPosts: jest.fn(), deleteAvailability: jest.fn(), deleteTravelPost: jest.fn(), browseTravellers: jest.fn(),
}));
jest.mock('../src/lib/profile', () => ({ ...jest.requireActual('../src/lib/profile'), fetchCard: jest.fn(), fetchPets: jest.fn() }));
// The calendar is tested on its own; here a button picks fixed dates.
jest.mock('../src/components/CalendarRange', () => {
  const { Pressable, Text } = require('react-native');
  return { CalendarRange: ({ onChange }: { onChange: (s: string, e: string) => void }) => (
    <Pressable accessibilityRole="button" accessibilityLabel="pick dates" onPress={() => onChange('2026-12-01', '2026-12-05')}><Text>pick</Text></Pressable>) };
});

// Records the props the results list is given, so the test can check how it is set up for long lists.
const mockListProps: { current: Record<string, unknown> | null } = { current: null };
jest.mock('react-native/Libraries/Lists/FlatList', () => {
  const Actual = jest.requireActual('react-native/Libraries/Lists/FlatList');
  const React = require('react');
  const Real = Actual.default ?? Actual;
  const Recording = React.forwardRef((props: Record<string, unknown>, ref: unknown) => { mockListProps.current = props; return React.createElement(Real, { ...props, ref }); });
  return { __esModule: true, default: Recording };
});

const s = search as jest.Mocked<typeof search>;
const x = explore as jest.Mocked<typeof explore>;
const host = (i: number, over: Partial<search.StayResult> = {}): search.StayResult => ({
  availability_id: `a${i}`, user_id: `u${i}`, first_name: `Host${i}`, area: 'Masbat', card_illustration: 'dog-biscuit', card_background: 'circles_teal', face_photo_path: null,
  rating_avg: 4.8, stays_count: 3, approx_lat: 28.5 + i * 0.001, approx_lng: 34.5 + i * 0.001, starts_on: '2026-12-01', ends_on: '2026-12-09', price_per_night: 200, negotiable: false,
  offers: ['paid'], pets_accepted: ['dog'], match_label: 'Exact match', ...over,
});
const wrap = (ui: React.ReactElement) => <GestureHandlerRootView style={{ flex: 1 }}><ToastProvider>{ui}</ToastProvider></GestureHandlerRootView>;

beforeEach(() => {
  jest.clearAllMocks(); mockRole = 'both';
  s.searchStays.mockResolvedValue([host(1), host(2, { match_label: 'Close match' })]);
  s.browseRandom.mockResolvedValue([host(1), host(2)]);
  x.fetchShortlist.mockResolvedValue([]); x.fetchAvailability.mockResolvedValue([]); x.fetchTravelPosts.mockResolvedValue([]); x.browseTravellers.mockResolvedValue([]);
  x.saveToShortlist.mockResolvedValue(undefined); x.postAvailability.mockResolvedValue(undefined); x.postTravel.mockResolvedValue(undefined);
});
afterEach(() => setLocaleForTests('en'));

const searchNow = async () => {
  await fireEvent.press(screen.getByLabelText('pick dates'));
  await fireEvent.press(screen.getByText('Show matches'));
  await waitFor(() => expect(s.searchStays).toHaveBeenCalled());
};

describe('Explore with real data', () => {
  it('searches, shows exact matches before close matches, and opens a host profile on tap', async () => {
    await renderIn(wrap(<Explore />));
    await searchNow();
    await waitFor(() => expect(screen.getByText('Host1')).toBeTruthy());
    const names = screen.getAllByRole('button').map((b) => b.props.accessibilityLabel).filter((l) => /^Host\d$/.test(l ?? ''));
    expect(names).toEqual(['Host1', 'Host2']);                                        // exact first, then close
    expect(screen.getByText("Close matches: dates partly fit, or the price is a little over budget but negotiable.")).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Host2'));
    expect(router.push).toHaveBeenCalledWith('/host/u2');
  });

  it('measures rows without drawing them, so 100 results scroll smoothly', async () => {
    s.searchStays.mockResolvedValue(Array.from({ length: 100 }, (_, i) => host(i, { match_label: i < 60 ? 'Exact match' : 'Close match' })));
    await renderIn(wrap(<Explore />));
    await searchNow();
    await waitFor(() => expect(mockListProps.current).not.toBeNull());
    const list = { props: mockListProps.current as Record<string, any> };
    expect(list.props.data).toHaveLength(101);                                        // 100 hosts and one "close matches" note
    expect(list.props.getItemLayout).toBeInstanceOf(Function);
    expect(list.props.initialNumToRender).toBeLessThanOrEqual(10);
    expect(list.props.windowSize).toBeLessThanOrEqual(10);
    expect(list.props.removeClippedSubviews).toBe(true);
    expect(screen.getAllByLabelText(/^Host\d+$/).length).toBeLessThan(30);           // only a window is drawn
    const rows = list.props.data;
    expect(rowLayout(rows, 0)).toEqual({ length: ROW_HEIGHT, offset: 0, index: 0 });
    expect(rowLayout(rows, 61).length).toBe(ROW_HEIGHT);
    expect(rowLayout(rows, 61).offset).toBe(rowLayout(rows, 60).offset + rowLayout(rows, 60).length + 12);   // the note sits at row 60
  });

  it('switches the results to a map of areas and back', async () => {
    await renderIn(wrap(<Explore />));
    await searchNow();
    await waitFor(() => screen.getByText('Host1'));
    await fireEvent.press(screen.getByText('Map'));
    expect(screen.getByText('Circles show each host’s area, not their home.')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Host1, Masbat'));
    await fireEvent.press(screen.getByText('View profile'));
    expect(router.push).toHaveBeenCalledWith('/host/u1');
    await fireEvent.press(screen.getByText('List'));
    expect(screen.getByLabelText('Host2')).toBeTruthy();
  });

  it('saves a liked host to the shortlist, and says so', async () => {
    await renderIn(wrap(<Explore />));
    await fireEvent.press(screen.getByText('Swipe'));
    await waitFor(() => expect(s.browseRandom).toHaveBeenCalled());
    await waitFor(() => screen.getByLabelText('Like'));
    await act(async () => { await fireEvent.press(screen.getByLabelText('Like')); });
    await waitFor(() => expect(x.saveToShortlist).toHaveBeenCalledWith('me', 'u1'), { timeout: 3000 });
    await waitFor(() => expect(screen.getByText('Saved to your shortlist')).toBeTruthy());
  });

  it('opens the profile of the top swipe card', async () => {
    await renderIn(wrap(<Explore />));
    await fireEvent.press(screen.getByText('Swipe'));
    await waitFor(() => screen.getByText('View profile'));
    await fireEvent.press(screen.getByText('View profile'));
    expect(router.push).toHaveBeenCalledWith('/host/u1');
  });

  it('links to the shortlist and to posting dates, and shows owners travelling only to hosts', async () => {
    await renderIn(wrap(<Explore />));
    await fireEvent.press(screen.getByText('Shortlist'));
    expect(router.push).toHaveBeenCalledWith('/shortlist');
    await fireEvent.press(screen.getByText('Post your dates'));
    expect(router.push).toHaveBeenCalledWith('/post-dates');
    expect(screen.getByText('Owners travelling')).toBeTruthy();
  });

  it('hides "Owners travelling" from owners who do not host', async () => {
    mockRole = 'owner';
    await renderIn(wrap(<Explore />));
    expect(screen.queryByText('Owners travelling')).toBeNull();
  });
});

describe.each(COMBOS)('Explore screens in $mode / $locale', ({ mode, locale }) => {
  it.each([['calendar', CalendarTab], ['shortlist', Shortlist], ['travellers', Travellers], ['post dates', PostDates]] as const)('%s renders', async (_n, Screen) => {
    await renderIn(wrap(<Screen />), { mode, locale });
    await waitFor(() => expect(screen.toJSON()).not.toBeNull());
  });
});

describe('shortlist', () => {
  const card = { id: 'h1', first_name: 'Hana', area: 'Masbat', card_illustration: 'cat-mango', card_background: 'pattern', rating_avg: null, stays_count: 0, home_tags: [], saved_at: '2026-10-01' } as explore.ShortlistCard;
  it('lists saved hosts, opens one and removes one', async () => {
    x.fetchShortlist.mockResolvedValue([card]); x.removeFromShortlist.mockResolvedValue(undefined);
    await renderIn(wrap(<Shortlist />));
    await waitFor(() => expect(screen.getByText('Hana')).toBeTruthy());
    await fireEvent.press(screen.getByLabelText(/^Hana\./));
    expect(router.push).toHaveBeenCalledWith('/host/h1');
    await fireEvent.press(screen.getByLabelText('Remove Hana'));
    expect(x.removeFromShortlist).toHaveBeenCalledWith('h1');
    await waitFor(() => expect(screen.getByText('Hosts you like will wait here.')).toBeTruthy());
  });
});

describe('owners travelling', () => {
  it('lists travel posts with dates and budget, and opens the owner', async () => {
    x.browseTravellers.mockResolvedValue([{ post_id: 'p1', user_id: 'o1', first_name: 'Owen', area: 'Masbat', card_illustration: 'dog-biscuit', card_background: 'circles_sand', pet_type: 'dog', starts_on: '2026-12-01', ends_on: '2026-12-08', budget_per_night: 200, note: 'Calm dog' }]);
    await renderIn(wrap(<Travellers />));
    await waitFor(() => expect(screen.getByText('Owen')).toBeTruthy());
    expect(screen.getByText('200 EGP per night')).toBeTruthy();
    expect(screen.getByText('Calm dog')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText(/^Owen\./));
    expect(router.push).toHaveBeenCalledWith('/host/o1');
    await fireEvent.press(screen.getByText('Cats'));
    await waitFor(() => expect(x.browseTravellers).toHaveBeenLastCalledWith('cat'));
  });
});

describe('post your dates', () => {
  it('posts availability for a host: dates, pets, offers and a price', async () => {
    mockRole = 'sitter';
    await renderIn(wrap(<PostDates />));
    expect(screen.queryByText('I am travelling')).toBeNull();                          // hosts only host
    await fireEvent.press(screen.getByText('Post availability'));
    expect(x.postAvailability).not.toHaveBeenCalled();                                 // no dates yet
    await fireEvent.press(screen.getByLabelText('pick dates'));
    await fireEvent.press(screen.getByText('Other'));                                  // also small pets
    await fireEvent.press(screen.getByText('Food provided'));
    await fireEvent.changeText(screen.getByLabelText('Price per night (EGP)'), '٢٥٠');
    await fireEvent.press(screen.getByText('Negotiable'));
    await fireEvent.press(screen.getByText('Post availability'));
    await waitFor(() => expect(x.postAvailability).toHaveBeenCalledWith('me', {
      starts_on: '2026-12-01', ends_on: '2026-12-05', pets_accepted: ['dog', 'cat', 'other'], offers: ['paid', 'food_provided'], price_per_night: 250, negotiable: true }));
    expect(router.back).toHaveBeenCalled();
  });

  it('needs a price when the stay is paid', async () => {
    mockRole = 'sitter';
    await renderIn(wrap(<PostDates />));
    await fireEvent.press(screen.getByLabelText('pick dates'));
    await fireEvent.press(screen.getByText('Post availability'));
    expect(x.postAvailability).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByText('Paid'));                                   // unpaid: no price needed
    await fireEvent.press(screen.getByText('Volunteer'));
    await fireEvent.press(screen.getByText('Post availability'));
    await waitFor(() => expect(x.postAvailability).toHaveBeenCalledWith('me', expect.objectContaining({ offers: ['volunteer'], price_per_night: null, negotiable: false })));
  });

  it('posts travel dates for a pet owner', async () => {
    mockRole = 'owner';
    await renderIn(wrap(<PostDates />));
    expect(screen.queryByText('I can host')).toBeNull();                               // owners only travel
    await fireEvent.press(screen.getByLabelText('pick dates'));
    await fireEvent.press(screen.getByText('Cats'));
    await fireEvent.changeText(screen.getByLabelText('Budget per night in EGP (optional)'), '150');
    await fireEvent.changeText(screen.getByLabelText('Note (optional)'), 'Shy cat');
    await fireEvent.press(screen.getByText('Post my dates'));
    await waitFor(() => expect(x.postTravel).toHaveBeenCalledWith('me', { pet_type: 'cat', starts_on: '2026-12-01', ends_on: '2026-12-05', budget_per_night: 150, note: 'Shy cat' }));
  });

  it('lets someone who is both choose, and explains the open-post limit', async () => {
    x.postTravel.mockRejectedValue(new Error('too_many'));
    await renderIn(wrap(<PostDates />));
    await fireEvent.press(screen.getByText('I am travelling'));
    await fireEvent.press(screen.getByLabelText('pick dates'));
    await fireEvent.press(screen.getByText('Post my dates'));
    await waitFor(() => expect(screen.getByText('You have too many open posts. Remove one first.')).toBeTruthy());
    expect(router.back).not.toHaveBeenCalled();
  });
});

describe('calendar tab: your posts', () => {
  it('shows your posts and removes one after a second tap', async () => {
    x.fetchAvailability.mockResolvedValue([{ id: 'av1', starts_on: '2026-12-01', ends_on: '2026-12-09', pets_accepted: ['dog'], offers: ['paid'], price_per_night: 200, negotiable: false }]);
    x.fetchTravelPosts.mockResolvedValue([{ id: 'tp1', pet_type: 'dog', starts_on: '2026-12-20', ends_on: '2026-12-25', budget_per_night: null, note: null }]);
    x.deleteAvailability.mockResolvedValue(undefined);
    await renderIn(wrap(<CalendarTab />));
    await waitFor(() => expect(screen.getByText('Hosting Dec 1 to Dec 9')).toBeTruthy());
    expect(screen.getByText('Travelling Dec 20 to Dec 25')).toBeTruthy();
    const remove = screen.getAllByLabelText('Remove post')[0];
    await fireEvent.press(remove);
    expect(x.deleteAvailability).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByLabelText('Tap again to delete'));
    await waitFor(() => expect(x.deleteAvailability).toHaveBeenCalledWith('av1'));
    await waitFor(() => expect(screen.queryByText('Hosting Dec 1 to Dec 9')).toBeNull());
  });
});

describe('animated card backgrounds', () => {
  it('draws each background kind, with moving circles on the full card and still ones in list rows', async () => {
    for (const bg of ['circles_teal', 'circles_orange', 'circles_sand', 'navy', 'pattern']) {
      const full = await renderIn(<CardArt illustration="cat-mango" background={bg} height={200} />);
      expect(screen.toJSON()).not.toBeNull();
      await full.unmount();
      const small = await renderIn(<CardArt illustration="cat-mango" background={bg} compact />);
      expect(JSON.stringify(screen.toJSON())).toContain('"width":96');
      await small.unmount();
    }
  });

  it('builds the paw-and-heart pattern from paws and hearts only', async () => {
    await renderIn(<PawHeartPattern width={120} height={120} paw="#aaa" heart="#bbb" />);
    const json = JSON.stringify(screen.toJSON());
    expect((json.match(/RNSVGEllipse/g) ?? []).length).toBeGreaterThan(2);           // paw pads
    expect((json.match(/RNSVGPath/g) ?? []).length).toBeGreaterThan(2);              // hearts
  });
});

describe('results map', () => {
  it('says so when there is nothing to show, and never plots hosts without an area', async () => {
    await renderIn(<ResultsMap results={[host(1, { approx_lat: null, approx_lng: null })]} onOpen={jest.fn()} />);
    expect(screen.getByText('No hosts to show on the map.')).toBeTruthy();
  });
});

void prof;
