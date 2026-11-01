import React from 'react';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { COMBOS, renderIn } from '../test-utils/render';
import { setLocaleForTests } from '../src/i18n';
import * as chat from '../src/lib/chat';
import * as bk from '../src/lib/bookings';
import * as prof from '../src/lib/profile';
import ChatTab from '../app/(tabs)/chat';
import ChatScreen from '../app/chat/[id]';
import HostProfile from '../app/host/[id]';
import { ToastProvider } from '../src/components/Toast';

let mockRole: 'owner' | 'sitter' = 'owner';
jest.mock('../src/lib/auth', () => ({ useAuth: () => ({ ready: true, session: { user: { id: 'me' } }, state: { status: 'active', role: mockRole }, refresh: jest.fn(), signOut: jest.fn() }) }));
jest.mock('../src/lib/chat', () => ({
  fetchConversations: jest.fn(), startConversation: jest.fn(), fetchMessages: jest.fn(), sendMessage: jest.fn(), markRead: jest.fn(), listenToMessages: jest.fn(), listenToActivity: jest.fn(), PAGE_SIZE: 40,
}));
jest.mock('../src/lib/bookings', () => ({ ...jest.requireActual('../src/lib/bookings'), fetchBookingsBetween: jest.fn(), acceptTerms: jest.fn(), cancelBooking: jest.fn() }));
jest.mock('../src/lib/profile', () => ({ ...jest.requireActual('../src/lib/profile'), fetchCard: jest.fn(), fetchPet: jest.fn(), fetchPets: jest.fn(), useSignedUrl: jest.fn(() => null) }));
jest.mock('../src/lib/explore', () => ({ fetchAvailability: jest.fn(async () => []) }));

const c = chat as jest.Mocked<typeof chat>;
const k = bk as jest.Mocked<typeof bk>;
const p = prof as jest.Mocked<typeof prof>;
const params = useLocalSearchParams as jest.Mock;
const wrap = (ui: React.ReactElement) => <ToastProvider>{ui}</ToastProvider>;

const conv = (over: Partial<chat.Conversation> = {}): chat.Conversation => ({ id: 'c1', other_id: 'them', first_name: 'Hana', card_illustration: 'cat-mango', card_background: 'pattern', last_body: 'See you soon', last_at: '2026-10-01T10:00:00Z', last_mine: false, unread: 2, ...over });
const msg = (id: number, sender: string, body: string, masked = false): chat.Message => ({ id, conversation_id: 'c1', sender_id: sender, body, masked, created_at: '2026-10-01T10:00:00Z' });
const booking = (over: Partial<bk.Booking> = {}): bk.Booking => ({ id: 'b1', owner_id: 'me', sitter_id: 'them', pet_id: 'p1', starts_on: '2026-12-01', ends_on: '2026-12-05', stay_location: 'sitter_home', cost_type: 'paid', price_per_night: 250, food_provided: false, status: 'requested', owner_accepted_at: null, sitter_accepted_at: null, terms_version: 4, ...over });
const card = (role: 'owner' | 'sitter' = 'sitter'): prof.PublicProfile => ({ id: 'them', first_name: 'Hana', role, bio: null, area: null, card_illustration: 'cat-mango', card_background: 'pattern', rating_avg: null, stays_count: 0, home_photo_path: null, home_tags: [] });

let pushMessage: (m: chat.Message) => void = () => {};
let pushActivity: () => void = () => {};
const stopMessages = jest.fn();
const stopActivity = jest.fn();

beforeEach(() => {
  jest.clearAllMocks(); mockRole = 'owner';
  c.fetchConversations.mockResolvedValue([conv()]);
  c.fetchMessages.mockResolvedValue([msg(2, 'them', 'Sure, those dates work'), msg(1, 'me', 'Hi, can you host my dog?')]);
  c.sendMessage.mockImplementation(async (_id, _me, body) => msg(3, 'me', body));
  c.markRead.mockResolvedValue(undefined);
  c.listenToMessages.mockImplementation((_id, cb) => { pushMessage = cb; return stopMessages; });
  c.listenToActivity.mockImplementation((cb) => { pushActivity = cb; return stopActivity; });
  c.startConversation.mockResolvedValue('c1');
  k.fetchBookingsBetween.mockResolvedValue([]);
  p.fetchCard.mockResolvedValue(card()); p.fetchPets.mockResolvedValue([]); p.fetchPet.mockResolvedValue({ id: 'p1', owner_id: 'me', name: 'Biscuit' } as prof.Pet);
  params.mockReturnValue({ id: 'c1' });
});
afterEach(() => setLocaleForTests('en'));

describe.each(COMBOS)('chat screens in $mode / $locale', ({ mode, locale }) => {
  it.each([['list', ChatTab], ['conversation', ChatScreen]] as const)('%s renders', async (_n, Screen) => {
    await renderIn(wrap(<Screen />), { mode, locale });
    await waitFor(() => expect(screen.toJSON()).not.toBeNull());
  });
});

describe('chat list', () => {
  it('shows each conversation with its unread count and opens it', async () => {
    c.fetchConversations.mockResolvedValue([conv(), conv({ id: 'c2', first_name: 'Sam', unread: 0, last_mine: true, last_body: 'Thanks' })]);
    await renderIn(wrap(<ChatTab />));
    await waitFor(() => expect(screen.getByText('Hana')).toBeTruthy());
    expect(screen.getByText('2')).toBeTruthy();
    expect(screen.getByText('You: Thanks')).toBeTruthy();
    expect(screen.getByLabelText(/^Hana\. 2 unread\. See you soon/)).toBeTruthy();
    await fireEvent.press(screen.getByLabelText(/^Hana/));
    expect(router.push).toHaveBeenCalledWith('/chat/c1');
  });
  it('invites you to find a host when there is nothing yet, and refreshes when something arrives', async () => {
    c.fetchConversations.mockResolvedValue([]);
    await renderIn(wrap(<ChatTab />));
    await waitFor(() => expect(screen.getByText('No messages yet. Chat opens when you contact a host.')).toBeTruthy());
    c.fetchConversations.mockResolvedValue([conv()]);
    await act(async () => { pushActivity(); });
    await waitFor(() => expect(screen.getByText('Hana')).toBeTruthy());
  });
});

describe('conversation', () => {
  it('shows the messages, marks them read, and listens for new ones until you leave', async () => {
    const view = await renderIn(wrap(<ChatScreen />));
    await waitFor(() => expect(screen.getByText('Sure, those dates work')).toBeTruthy());
    expect(screen.getByText('Hi, can you host my dog?')).toBeTruthy();
    expect(c.markRead).toHaveBeenCalledWith('c1');
    await act(async () => { pushMessage(msg(4, 'them', 'One more thing')); });
    expect(screen.getByText('One more thing')).toBeTruthy();
    await act(async () => { pushMessage(msg(4, 'them', 'One more thing')); });         // the same message again changes nothing
    expect(screen.getAllByText('One more thing')).toHaveLength(1);
    await view.unmount();
    expect(stopMessages).toHaveBeenCalled();
    expect(stopActivity).toHaveBeenCalled();
  });

  it('sends a message, shows what the server returns, and tells people contact details are hidden', async () => {
    await renderIn(wrap(<ChatScreen />));
    await waitFor(() => screen.getByLabelText('Message'));
    expect(screen.getByText('Phone numbers, links and handles unlock when the booking is confirmed.')).toBeTruthy();
    expect(screen.getByLabelText('Send')).toBeDisabled();                                 // nothing typed yet
    await fireEvent.changeText(screen.getByLabelText('Message'), '  Call me on •••  ');
    await fireEvent.press(screen.getByLabelText('Send'));
    await waitFor(() => expect(c.sendMessage).toHaveBeenCalledWith('c1', 'me', 'Call me on •••'));
    await waitFor(() => expect(screen.getByText('Call me on •••')).toBeTruthy());
    expect(screen.getByDisplayValue('')).toBeTruthy();                                    // the box is cleared
  });

  it('says so when sending is too fast or fails', async () => {
    await renderIn(wrap(<ChatScreen />));
    await waitFor(() => screen.getByLabelText('Message'));
    c.sendMessage.mockRejectedValueOnce(new Error('slow_down'));
    await fireEvent.changeText(screen.getByLabelText('Message'), 'hi');
    await fireEvent.press(screen.getByLabelText('Send'));
    await waitFor(() => expect(screen.getByText('You are sending messages very fast. Wait a moment.')).toBeTruthy());
    c.sendMessage.mockRejectedValueOnce(new Error('failed'));
    await fireEvent.press(screen.getByLabelText('Send'));
    await waitFor(() => expect(screen.getByText('We could not send that. Try again.')).toBeTruthy());
    expect(screen.getByDisplayValue('hi')).toBeTruthy();                                  // the text is kept so nothing is lost
  });

  it('marks a masked message so people know why', async () => {
    c.fetchMessages.mockResolvedValue([msg(1, 'them', 'Call •••', true)]);
    await renderIn(wrap(<ChatScreen />));
    await waitFor(() => expect(screen.getByText('Call •••')).toBeTruthy());
    expect(screen.getAllByText('Contact details unlock after booking').length).toBeGreaterThan(0);
  });

  it('says so when the conversation cannot be found', async () => {
    c.fetchConversations.mockResolvedValue([]);
    await renderIn(wrap(<ChatScreen />));
    await waitFor(() => expect(screen.getByText('We could not load this chat. Try again.')).toBeTruthy());
  });
});

describe('booking in the conversation', () => {
  it('offers "Request booking" when I am an owner and they host', async () => {
    await renderIn(wrap(<ChatScreen />));
    await waitFor(() => screen.getByText('Request booking'));
    await fireEvent.press(screen.getByText('Request booking'));
    expect(router.push).toHaveBeenCalledWith('/booking/new?other=them');
  });
  it('does not offer it when they only own pets, or when I only host', async () => {
    p.fetchCard.mockResolvedValue(card('owner'));
    const first = await renderIn(wrap(<ChatScreen />));
    await waitFor(() => screen.getByLabelText('Message'));
    expect(screen.queryByText('Request booking')).toBeNull();
    await first.unmount();
    p.fetchCard.mockResolvedValue(card('sitter')); mockRole = 'sitter';
    await renderIn(wrap(<ChatScreen />));
    await waitFor(() => screen.getByLabelText('Message'));
    expect(screen.queryByText('Request booking')).toBeNull();
  });

  it('shows the terms, lets me accept, and says who we are waiting for', async () => {
    k.fetchBookingsBetween.mockResolvedValue([booking()]);
    k.acceptTerms.mockResolvedValue('requested');
    await renderIn(wrap(<ChatScreen />));
    await waitFor(() => expect(screen.getByText('Proposed terms')).toBeTruthy());
    expect(screen.getByText('Dec 1 – Dec 5')).toBeTruthy();
    expect(screen.getByText('Biscuit')).toBeTruthy();
    expect(screen.getByText('250 EGP per night')).toBeTruthy();
    expect(screen.getByText('Waiting for both of you to accept')).toBeTruthy();
    k.fetchBookingsBetween.mockResolvedValue([booking({ owner_accepted_at: '2026-10-01' })]);
    await fireEvent.press(screen.getByLabelText('Accept terms'));
    await waitFor(() => expect(k.acceptTerms).toHaveBeenCalledWith('b1', 4));
    await waitFor(() => expect(screen.getByText('Waiting for Hana to accept')).toBeTruthy());
  });

  it('tells me when the terms changed while I was looking, and shows the new ones', async () => {
    k.fetchBookingsBetween.mockResolvedValue([booking()]);
    k.acceptTerms.mockRejectedValueOnce(new Error('terms_changed'));
    await renderIn(wrap(<ChatScreen />));
    await waitFor(() => screen.getByLabelText('Accept terms'));
    k.fetchBookingsBetween.mockResolvedValue([booking({ price_per_night: 400, terms_version: 5 })]);
    await fireEvent.press(screen.getByLabelText('Accept terms'));
    await waitFor(() => expect(screen.getByText('The terms just changed. Please read them again.')).toBeTruthy());
    expect(screen.getByText('400 EGP per night')).toBeTruthy();
  });

  it('opens the terms editor from "Change"', async () => {
    k.fetchBookingsBetween.mockResolvedValue([booking()]);
    await renderIn(wrap(<ChatScreen />));
    await waitFor(() => screen.getByText('Change'));
    await fireEvent.press(screen.getByText('Change'));
    expect(router.push).toHaveBeenCalledWith('/booking/b1?other=them');
  });

  it('updates the card when the booking changes elsewhere', async () => {
    k.fetchBookingsBetween.mockResolvedValue([booking()]);
    await renderIn(wrap(<ChatScreen />));
    await waitFor(() => screen.getByText('Waiting for both of you to accept'));
    k.fetchBookingsBetween.mockResolvedValue([booking({ status: 'confirmed', owner_accepted_at: 'x', sitter_accepted_at: 'y' })]);
    await act(async () => { pushActivity(); });
    await waitFor(() => expect(screen.getByText('Booking confirmed')).toBeTruthy());
  });

  it('confirms the booking the moment the second person accepts, with no fee or payment step', async () => {
    k.fetchBookingsBetween.mockResolvedValue([booking({ sitter_accepted_at: 'y' })]);
    k.acceptTerms.mockResolvedValue('confirmed');
    await renderIn(wrap(<ChatScreen />));
    await waitFor(() => screen.getByLabelText('Accept terms'));
    expect(screen.getByText('Payment between you and the other person is your own arrangement. PawsPal never handles that money.')).toBeTruthy();
    expect(screen.getByText('When you both accept, your contact details and the exact address unlock.')).toBeTruthy();
    k.fetchBookingsBetween.mockResolvedValue([booking({ status: 'confirmed', owner_accepted_at: 'x', sitter_accepted_at: 'y' })]);
    await fireEvent.press(screen.getByLabelText('Accept terms'));
    await waitFor(() => expect(k.acceptTerms).toHaveBeenCalledWith('b1', 4));
    await waitFor(() => expect(screen.getByText('Booking confirmed')).toBeTruthy());
    await fireEvent.press(screen.getByText('View booking'));
    expect(router.push).toHaveBeenCalledWith('/booking/done/b1');
    expect(screen.queryByText(/fee/i)).toBeNull();
    expect(screen.queryByText(/refund/i)).toBeNull();
    expect(screen.queryByText(/^Pay/)).toBeNull();
  });

  it('cancels a request after a second tap', async () => {
    k.fetchBookingsBetween.mockResolvedValue([booking()]);
    k.cancelBooking.mockResolvedValue(undefined);
    await renderIn(wrap(<ChatScreen />));
    await waitFor(() => screen.getByText('Cancel request'));
    await fireEvent.press(screen.getByText('Cancel request'));
    expect(k.cancelBooking).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByText('Tap again to cancel'));
    await waitFor(() => expect(k.cancelBooking).toHaveBeenCalledWith('b1'));
  });

  it('cancels a confirmed booking after a second tap, with no word about refunds', async () => {
    k.fetchBookingsBetween.mockResolvedValue([booking({ status: 'confirmed', owner_accepted_at: 'x', sitter_accepted_at: 'y' })]);
    k.cancelBooking.mockResolvedValue(undefined);
    await renderIn(wrap(<ChatScreen />));
    await waitFor(() => expect(screen.getByText('Booking confirmed')).toBeTruthy());
    expect(screen.queryByText('Phone numbers, links and handles unlock when the booking is confirmed.')).toBeNull();
    expect(screen.queryByText(/refund/i)).toBeNull();
    await fireEvent.press(screen.getByText('Cancel booking'));
    expect(k.cancelBooking).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByText('Tap again to cancel'));
    await waitFor(() => expect(k.cancelBooking).toHaveBeenCalledWith('b1'));
  });

  it('has no swap anywhere in the conversation', async () => {
    k.fetchBookingsBetween.mockResolvedValue([booking()]);
    await renderIn(wrap(<ChatScreen />));
    await waitFor(() => screen.getByText('Proposed terms'));
    expect(screen.queryByText(/swap/i)).toBeNull();
    expect(screen.getAllByText('Proposed terms')).toHaveLength(1);
  });
});

describe('host profile buttons', () => {
  it('"Message" opens the conversation, "Request booking" opens the request form', async () => {
    params.mockReturnValue({ id: 'them' });
    await renderIn(wrap(<HostProfile />));
    await waitFor(() => screen.getByText('Message'));
    await fireEvent.press(screen.getByText('Message'));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/chat/c1'));
    await fireEvent.press(screen.getByText('Request booking'));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/booking/new?other=them'));
    expect(c.startConversation).toHaveBeenCalledWith('them');
  });
  it('has no buttons on your own profile, and no request button for someone who only owns pets or when I host', async () => {
    params.mockReturnValue({ id: 'me' });
    p.fetchCard.mockResolvedValue({ ...card(), id: 'me' });
    const first = await renderIn(wrap(<HostProfile />));
    await waitFor(() => expect(screen.getAllByText('Hana').length).toBeGreaterThan(0));
    expect(screen.queryByText('Message')).toBeNull();
    await first.unmount();
    params.mockReturnValue({ id: 'them' });
    p.fetchCard.mockResolvedValue(card('owner'));
    const second = await renderIn(wrap(<HostProfile />));
    await waitFor(() => screen.getByText('Message'));
    expect(screen.queryByText('Request booking')).toBeNull();
    await second.unmount();
    p.fetchCard.mockResolvedValue(card('sitter')); mockRole = 'sitter';
    await renderIn(wrap(<HostProfile />));
    await waitFor(() => screen.getByText('Message'));
    expect(screen.queryByText('Request booking')).toBeNull();
  });
});
