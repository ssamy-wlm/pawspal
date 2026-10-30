import React from 'react';
import { Linking } from 'react-native';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { COMBOS, renderIn } from '../test-utils/render';
import { setLocaleForTests } from '../src/i18n';
import * as api from '../src/lib/api';
import * as chat from '../src/lib/chat';
import * as bk from '../src/lib/bookings';
import * as prof from '../src/lib/profile';
import * as sf from '../src/lib/safety';
import { supabase } from '../src/lib/supabase';
import SafetyCenter from '../app/safety/index';
import Blocked from '../app/safety/blocked';
import Report from '../app/safety/report';
import Emergency from '../app/safety/emergency';
import Handover from '../app/handover/[id]';
import Review from '../app/review/[id]';
import ChatTab from '../app/(tabs)/chat';
import { ToastProvider } from '../src/components/Toast';

jest.mock('../src/lib/auth', () => ({ useAuth: () => ({ ready: true, session: { user: { id: 'me' } }, state: { status: 'active', role: 'both' }, refresh: jest.fn(), signOut: jest.fn() }) }));
jest.mock('../src/lib/chat', () => ({ fetchConversations: jest.fn(), startConversation: jest.fn(), listenToActivity: jest.fn(() => () => {}) }));
jest.mock('../src/lib/bookings', () => ({ ...jest.requireActual('../src/lib/bookings'), fetchBooking: jest.fn() }));
jest.mock('../src/lib/profile', () => ({ ...jest.requireActual('../src/lib/profile'), fetchCard: jest.fn(), fetchPet: jest.fn() }));
jest.mock('../src/lib/api', () => ({ ...jest.requireActual('../src/lib/api'), uploadPhoto: jest.fn(), handoverPhotoUrl: jest.fn(), sendEmergency: jest.fn() }));
jest.mock('../src/lib/safety', () => ({
  ...jest.requireActual('../src/lib/safety'),
  addHandoverPhoto: jest.fn(), listHandoverPhotos: jest.fn(), completeBooking: jest.fn(), hasReviewed: jest.fn(), submitReview: jest.fn(),
  fileReport: jest.fn(), fetchBlocks: jest.fn(), blockUser: jest.fn(), unblockUser: jest.fn(), fetchAlerts: jest.fn(), dismissAlert: jest.fn(),
  raiseEmergency: jest.fn(), fetchPetCare: jest.fn(), fetchRunningStays: jest.fn(),
}));

const s = sf as jest.Mocked<typeof sf>;
const k = bk as jest.Mocked<typeof bk>;
const p = prof as jest.Mocked<typeof prof>;
const c = chat as jest.Mocked<typeof chat>;
const params = useLocalSearchParams as jest.Mock;
const wrap = (ui: React.ReactElement) => <ToastProvider>{ui}</ToastProvider>;
const day = (offset: number) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
const booking = (over: Partial<bk.Booking> = {}): bk.Booking => ({ id: 'b1', owner_id: 'me', sitter_id: 'them', pet_id: 'p1', starts_on: day(-3), ends_on: day(-1), stay_location: 'sitter_home', cost_type: 'volunteer', price_per_night: null, food_provided: false, status: 'in_progress', fee_status: 'paid', owner_accepted_at: 'x', sitter_accepted_at: 'y', swap_group: null, terms_version: 1, opened_by: 'me', ...over });

beforeEach(() => {
  jest.clearAllMocks();
  params.mockReturnValue({});
  k.fetchBooking.mockResolvedValue(booking());
  p.fetchPet.mockResolvedValue({ id: 'p1', owner_id: 'me', name: 'Luna', photo_paths: [] } as unknown as prof.Pet);
  p.fetchCard.mockResolvedValue({ id: 'them', first_name: 'Mona' } as prof.PublicProfile);
  s.listHandoverPhotos.mockResolvedValue([]);
  s.fetchBlocks.mockResolvedValue([]);
  s.fetchAlerts.mockResolvedValue([]);
  s.fetchRunningStays.mockResolvedValue([]);
  s.hasReviewed.mockResolvedValue(false);
  c.fetchConversations.mockResolvedValue([{ id: 'c1', other_id: 'them', first_name: 'Mona', card_illustration: 'cat-mango', card_background: 'pattern', last_body: null, last_at: '2026-10-01T10:00:00Z', last_mine: false, unread: 0 }]);
});
afterEach(() => { setLocaleForTests('en'); jest.restoreAllMocks(); });

describe('the safety library', () => {
  const rpc = (reply: { data?: unknown; error?: { message: string; code?: string } | null }) => jest.spyOn(supabase, 'rpc').mockResolvedValue({ data: reply.data ?? null, error: reply.error ?? null } as never);
  const real = jest.requireActual('../src/lib/safety') as typeof sf;

  it('uploads a handover photo for cleaning, then saves its clean path on the booking', async () => {
    (api.uploadPhoto as jest.Mock).mockResolvedValue('me/clean.jpg');
    const spy = rpc({ data: 'photo-id' });
    await real.addHandoverPhoto('b1', 'dropoff', 'file:///x.jpg');
    expect(api.uploadPhoto).toHaveBeenCalledWith('handover', 'file:///x.jpg');
    expect(spy).toHaveBeenCalledWith('add_handover_photo', { p_booking: 'b1', p_kind: 'dropoff', p_path: 'me/clean.jpg' });
  });
  it('turns refusals into short codes', async () => {
    (api.uploadPhoto as jest.Mock).mockResolvedValue('me/clean.jpg');
    rpc({ error: { message: 'not available yet' } });
    await expect(real.addHandoverPhoto('b1', 'pickup', 'u')).rejects.toThrow('not_yet');
    rpc({ error: { message: 'too many photos' } });
    await expect(real.addHandoverPhoto('b1', 'pickup', 'u')).rejects.toThrow('too_many');
    rpc({ error: { message: 'not allowed' } });
    await expect(real.addHandoverPhoto('b1', 'pickup', 'u')).rejects.toThrow('not_allowed');
    (api.uploadPhoto as jest.Mock).mockRejectedValue(new api.ApiError('network', 0));
    await expect(real.addHandoverPhoto('b1', 'pickup', 'u')).rejects.toThrow('network');
    rpc({ error: { message: 'the stay is not finished' } });
    await expect(real.completeBooking('b1')).rejects.toThrow('not_yet');
  });
  it('sends reports, blocks and unblocks with the right names', async () => {
    const spy = rpc({ data: 'r1' });
    await real.fileReport({ reportedId: 'u1', reason: 'no_show', details: '  late  ', bookingId: 'b1' });
    expect(spy).toHaveBeenCalledWith('file_report', { p_reported: 'u1', p_reason: 'no_show', p_details: 'late', p_booking: 'b1', p_conversation: null });
    await real.blockUser('u1');
    expect(spy).toHaveBeenLastCalledWith('block_user', { p_user: 'u1' });
    await real.unblockUser('u1');
    expect(spy).toHaveBeenLastCalledWith('unblock_user', { p_user: 'u1' });
    rpc({ error: { message: 'too many reports' } });
    await expect(real.fileReport({ reportedId: 'u1', reason: 'other', details: '' })).rejects.toThrow('too_many');
  });
  it('maps emergency answers to codes', async () => {
    (api.sendEmergency as jest.Mock).mockResolvedValue('sent');
    await expect(real.raiseEmergency('b1', ' hurt ')).resolves.toBe('sent');
    expect(api.sendEmergency).toHaveBeenCalledWith('b1', 'hurt');
    (api.sendEmergency as jest.Mock).mockRejectedValue(new api.ApiError('not_allowed', 403));
    await expect(real.raiseEmergency('b1', '')).rejects.toThrow('not_allowed');
    (api.sendEmergency as jest.Mock).mockRejectedValue(new api.ApiError('too_many_attempts', 429));
    await expect(real.raiseEmergency('b1', '')).rejects.toThrow('too_many');
  });
  it('offers the review button only inside the 14 day window', () => {
    const today = new Date('2026-11-20T12:00:00Z');
    expect(real.reviewOpen('2026-11-10', today)).toBe(true);
    expect(real.reviewOpen('2026-11-06', today)).toBe(true);
    expect(real.reviewOpen('2026-11-01', today)).toBe(false);
  });
});

describe.each(COMBOS)('safety screens ($mode, $locale)', ({ mode, locale }) => {
  const r = (ui: React.ReactElement) => renderIn(wrap(ui), { mode, locale });
  const en = locale === 'en';

  it('Safety Center lists emergency, report, blocked people, rules and appeals', async () => {
    await r(<SafetyCenter />);
    expect(screen.getAllByRole('button').length).toBeGreaterThanOrEqual(4);
    await fireEvent.press(screen.getAllByRole('button')[0]);
    expect(router.push).toHaveBeenCalledWith('/safety/emergency');
    await fireEvent.press(screen.getAllByRole('button')[3]);
    expect(router.push).toHaveBeenCalledWith('/legal/communityGuidelines');
    if (en) expect(screen.getByText('Appeals')).toBeTruthy();
  });

  it('Blocked people: lists them and unblocks one', async () => {
    s.fetchBlocks.mockResolvedValue([{ user_id: 'u1', first_name: 'Rami', blocked_at: 'x' }]);
    s.unblockUser.mockResolvedValue(undefined);
    await r(<Blocked />);
    await waitFor(() => expect(screen.getByText('Rami')).toBeTruthy());
    await fireEvent.press(screen.getByText(en ? 'Unblock' : 'إلغاء الحظر'));
    await waitFor(() => expect(s.unblockUser).toHaveBeenCalledWith('u1'));
    await waitFor(() => expect(screen.queryByText('Rami')).toBeNull());
  });

  it('Report: needs a person and a reason, then sends and can block too', async () => {
    params.mockReturnValue({ user: 'them', name: 'Mona', conversation: 'c1' });
    s.fileReport.mockResolvedValue(undefined); s.blockUser.mockResolvedValue(undefined);
    await r(<Report />);
    const send = screen.getByRole('button', { name: en ? 'Send report' : 'إرسال البلاغ' });
    expect(send.props.accessibilityState.disabled).toBe(true);
    await fireEvent.press(screen.getByText(en ? 'Rude or harassing' : 'إساءة أو مضايقة'));
    await fireEvent.press(screen.getByText(en ? 'Block them too' : 'احظره أيضًا'));
    await fireEvent.press(screen.getByRole('button', { name: en ? 'Send report' : 'إرسال البلاغ' }));
    await waitFor(() => expect(s.fileReport).toHaveBeenCalledWith({ reportedId: 'them', reason: 'rude_or_harassment', details: '', bookingId: undefined, conversationId: 'c1' }));
    expect(s.blockUser).toHaveBeenCalledWith('them');
    expect(router.back).toHaveBeenCalled();
  });

  it('Report: without a person, picks one of the people I chat with', async () => {
    await r(<Report />);
    await waitFor(() => expect(screen.getByText('Mona')).toBeTruthy());
    await fireEvent.press(screen.getByText('Mona'));
    await fireEvent.press(screen.getByText(en ? 'Something else' : 'سبب آخر'));
    s.fileReport.mockResolvedValue(undefined);
    await fireEvent.press(screen.getByRole('button', { name: en ? 'Send report' : 'إرسال البلاغ' }));
    await waitFor(() => expect(s.fileReport).toHaveBeenCalledWith(expect.objectContaining({ reportedId: 'them', reason: 'other' })));
  });

  it('Report: shows a plain message when the day limit is reached', async () => {
    params.mockReturnValue({ user: 'them', name: 'Mona' });
    s.fileReport.mockRejectedValue(new Error('too_many'));
    await r(<Report />);
    await fireEvent.press(screen.getByText(en ? 'Something else' : 'سبب آخر'));
    await fireEvent.press(screen.getByRole('button', { name: en ? 'Send report' : 'إرسال البلاغ' }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(router.back).not.toHaveBeenCalled();
  });

  it('Emergency: with one running stay it shows the vet to call, then alerts the other person', async () => {
    s.fetchRunningStays.mockResolvedValue([{ id: 'b1', pet_id: 'p1' }]);
    s.fetchPetCare.mockResolvedValue({ vet_name: 'Dr Nour', vet_phone: '+20 69 123 4567', care_notes: null });
    s.raiseEmergency.mockResolvedValue('sent');
    jest.spyOn(Linking, 'openURL').mockResolvedValue(true as never);
    await r(<Emergency />);
    const call = await screen.findByText(en ? 'Call +20 69 123 4567' : 'اتصل بالرقم \u2066+20 69 123 4567\u2069');
    await fireEvent.press(call);
    expect(Linking.openURL).toHaveBeenCalledWith('tel:+20691234567');
    await fireEvent.press(screen.getByRole('button', { name: en ? 'Alert them now' : 'نبّههم الآن' }));
    await waitFor(() => expect(s.raiseEmergency).toHaveBeenCalledWith('b1', ''));
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
  });

  it('Emergency: with no running stay it only tells the person to call a vet', async () => {
    await r(<Emergency />);
    await waitFor(() => expect(screen.getByText(en ? 'You have no stay in progress. For an emergency with a pet, call a vet.' : 'ليس لديك إقامة جارية. في حالة طارئة مع حيوان، اتصل بالطبيب البيطري.')).toBeTruthy());
    expect(screen.queryByRole('button', { name: en ? 'Alert them now' : 'نبّههم الآن' })).toBeNull();
  });

  it('Emergency: a failed alert says so and points to the vet', async () => {
    params.mockReturnValue({ booking: 'b1' });
    s.fetchRunningStays.mockResolvedValue([{ id: 'b1', pet_id: 'p1' }]);
    s.fetchPetCare.mockResolvedValue(null);
    s.raiseEmergency.mockRejectedValue(new Error('failed'));
    await r(<Emergency />);
    await fireEvent.press(await screen.findByRole('button', { name: en ? 'Alert them now' : 'نبّههم الآن' }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
  });

  it('Chat tab: an emergency alert shows even with no conversations, and opens the stay', async () => {
    s.fetchAlerts.mockResolvedValue([{ id: 'a1', booking_id: 'b1', from_name: 'Sam', pet_name: 'Luna', created_at: 'x' }]);
    s.dismissAlert.mockResolvedValue(undefined);
    c.fetchConversations.mockResolvedValue([]);
    await r(<ChatTab />);
    const alert = await screen.findByLabelText(en ? 'Sam raised an emergency about Luna' : 'Sam أبلغ عن حالة طارئة بخصوص Luna');
    await fireEvent.press(alert);
    expect(s.dismissAlert).toHaveBeenCalledWith('a1');
    expect(router.push).toHaveBeenCalledWith('/booking/done/b1');
  });
});

describe.each(COMBOS)('handover and reviews ($mode, $locale)', ({ mode, locale }) => {
  const r = (ui: React.ReactElement) => renderIn(wrap(ui), { mode, locale });
  const en = locale === 'en';
  beforeEach(() => { params.mockReturnValue({ id: 'b1' }); (api.handoverPhotoUrl as jest.Mock).mockResolvedValue('https://signed.test/x'); });

  it('Handover: taking a photo uses the camera, then saves it as a drop-off', async () => {
    k.fetchBooking.mockResolvedValue(booking({ status: 'confirmed', starts_on: day(0), ends_on: day(3) }));
    s.addHandoverPhoto.mockResolvedValue(undefined);
    await r(<Handover />);
    const take = await screen.findAllByRole('button', { name: en ? 'Take a photo' : 'التقاط صورة' });
    expect(take).toHaveLength(1);                                       // pick-up opens only once the stay has started
    await fireEvent.press(take[0]);
    await waitFor(() => expect(s.addHandoverPhoto).toHaveBeenCalledWith('b1', 'dropoff', 'file:///camera.jpg'));
    expect(ImagePicker.launchCameraAsync).toHaveBeenCalled();
  });

  it('Handover: a running stay offers both photos, and the owner can finish it after the end date', async () => {
    s.completeBooking.mockResolvedValue(undefined);
    s.listHandoverPhotos.mockResolvedValue([{ id: 'ph1', kind: 'dropoff', mine: false, taken_at: 'x' }]);
    await r(<Handover />);
    expect(await screen.findAllByRole('button', { name: en ? 'Take a photo' : 'التقاط صورة' })).toHaveLength(2);
    await waitFor(() => expect(api.handoverPhotoUrl).toHaveBeenCalledWith('ph1'));
    await fireEvent.press(screen.getByRole('button', { name: en ? 'The stay is finished' : 'انتهت الإقامة' }));
    await waitFor(() => expect(s.completeBooking).toHaveBeenCalledWith('b1'));
  });

  it('Handover: the sitter cannot finish the stay, and the owner cannot before the end date', async () => {
    k.fetchBooking.mockResolvedValue(booking({ owner_id: 'them', sitter_id: 'me' }));
    const first = await r(<Handover />);
    await screen.findAllByRole('button', { name: en ? 'Take a photo' : 'التقاط صورة' });
    expect(screen.queryByRole('button', { name: en ? 'The stay is finished' : 'انتهت الإقامة' })).toBeNull();
    await first.unmount();
    k.fetchBooking.mockResolvedValue(booking({ ends_on: day(2) }));
    await r(<Handover />);
    await screen.findAllByRole('button', { name: en ? 'Take a photo' : 'التقاط صورة' });
    expect(screen.queryByRole('button', { name: en ? 'The stay is finished' : 'انتهت الإقامة' })).toBeNull();
  });

  it('Handover: a refused photo says why', async () => {
    k.fetchBooking.mockResolvedValue(booking({ status: 'confirmed', starts_on: day(0), ends_on: day(3) }));
    s.addHandoverPhoto.mockRejectedValue(new Error('not_yet'));
    await r(<Handover />);
    await fireEvent.press((await screen.findAllByRole('button', { name: en ? 'Take a photo' : 'التقاط صورة' }))[0]);
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
  });

  it('Handover: without camera permission nothing is uploaded', async () => {
    k.fetchBooking.mockResolvedValue(booking({ status: 'confirmed', starts_on: day(0), ends_on: day(3) }));
    (ImagePicker.requestCameraPermissionsAsync as jest.Mock).mockResolvedValueOnce({ granted: false });
    await r(<Handover />);
    await fireEvent.press((await screen.findAllByRole('button', { name: en ? 'Take a photo' : 'التقاط صورة' }))[0]);
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(s.addHandoverPhoto).not.toHaveBeenCalled();
  });

  it('Review: a stay that is not completed cannot be reviewed', async () => {
    k.fetchBooking.mockResolvedValue(booking({ status: 'in_progress' }));
    await r(<Review />);
    await waitFor(() => expect(screen.getByText(en ? 'Reviews open after a stay is finished and close 14 days later.' : 'يفتح التقييم بعد انتهاء الإقامة ويُغلق بعد 14 يومًا.')).toBeTruthy());
    expect(screen.queryByRole('button', { name: en ? 'Send review' : 'إرسال التقييم' })).toBeNull();
  });

  it('Review: already reviewed shows that, a completed stay lets me rate and send', async () => {
    k.fetchBooking.mockResolvedValue(booking({ status: 'completed' }));
    s.hasReviewed.mockResolvedValue(true);
    const first = await r(<Review />);
    await waitFor(() => expect(screen.getByText(en ? 'You already reviewed this stay.' : 'لقد قيّمت هذه الإقامة من قبل.')).toBeTruthy());
    await first.unmount();
    s.hasReviewed.mockResolvedValue(false); s.submitReview.mockResolvedValue(undefined);
    await r(<Review />);
    const send = await screen.findByRole('button', { name: en ? 'Send review' : 'إرسال التقييم' });
    expect(send.props.accessibilityState.disabled).toBe(true);
    await fireEvent.press(screen.getAllByRole('radio')[3]);
    await fireEvent.changeText(screen.getByLabelText(en ? 'Say a little more (optional)' : 'أخبرنا أكثر (اختياري)'), 'Lovely');
    await fireEvent.press(screen.getByRole('button', { name: en ? 'Send review' : 'إرسال التقييم' }));
    await waitFor(() => expect(s.submitReview).toHaveBeenCalledWith('b1', 'me', 'them', 4, 'Lovely'));
    expect(router.back).toHaveBeenCalled();
  });

  it('Review: the database refusing it shows a plain message', async () => {
    k.fetchBooking.mockResolvedValue(booking({ status: 'completed' }));
    s.submitReview.mockRejectedValue(new Error('not_allowed'));
    await r(<Review />);
    await screen.findByRole('button', { name: en ? 'Send review' : 'إرسال التقييم' });
    await fireEvent.press(screen.getAllByRole('radio')[4]);
    await fireEvent.press(screen.getByRole('button', { name: en ? 'Send review' : 'إرسال التقييم' }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
  });
});
