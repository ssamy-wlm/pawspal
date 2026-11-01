import React from 'react';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { renderIn } from '../test-utils/render';
import { setLocaleForTests } from '../src/i18n';
import * as explore from '../src/lib/explore';
import { allowMapRequest, AvailabilityMap, parseMapMessage } from '../src/components/AvailabilityMap';

jest.mock('../src/lib/explore', () => ({ fetchMapAvailability: jest.fn() }));
const x = explore as jest.Mocked<typeof explore>;

const row = (i: number, over: Partial<explore.MapAvailability> = {}): explore.MapAvailability => ({
  availability_id: `a${i}`, user_id: `u${i}`, first_name: `Host${i}`, area: 'Masbat', approx_lat: 28.5 + i * 0.01, approx_lng: 34.5, price_per_night: 250,
  offers: ['paid'], starts_on: '2026-12-01', ends_on: '2026-12-09', pets_accepted: ['dog'], ...over,
});
const send = (data: unknown) => act(async () => { screen.getByTestId('availability-map').props.onMessage({ nativeEvent: { data: JSON.stringify(data) } }); });
afterEach(() => setLocaleForTests('en'));
beforeEach(() => { jest.clearAllMocks(); x.fetchMapAvailability.mockResolvedValue([row(1), row(2, { price_per_night: null })]); });

describe('availability map', () => {
  it('shows the map once, with a label, and the same hosts as a list', async () => {
    await renderIn(<AvailabilityMap onOpen={jest.fn()} />);
    await waitFor(() => screen.getByTestId('availability-map'));
    expect(screen.getByLabelText(/^Map of hosts showing availability/)).toBeTruthy();
    expect(screen.getByLabelText(/^Host1\. Masbat\. 250 EGP/)).toBeTruthy();
    expect(screen.getByLabelText(/^Host2\. Masbat\. Free/)).toBeTruthy();
    expect(x.fetchMapAvailability).toHaveBeenCalledWith(null);
  });

  it('is locked down: only the page itself, no files, no storage, no location', async () => {
    await renderIn(<AvailabilityMap onOpen={jest.fn()} />);
    const w = await waitFor(() => screen.getByTestId('availability-map'));
    expect(w.props.originWhitelist).toEqual(['about:blank', 'https://unpkg.com', 'https://tile.openstreetmap.org']);
    expect(w.props).toMatchObject({ javaScriptEnabled: true, domStorageEnabled: false, allowFileAccess: false, allowFileAccessFromFileURLs: false, allowUniversalAccessFromFileURLs: false, geolocationEnabled: false, mixedContentMode: 'never' });
    expect(w.props.injectedJavaScript).toBeUndefined();
    expect(w.props.source.html).toContain('maplibre-gl@4.7.1');
    expect(w.props.source.html).not.toContain('u1');                                       // no user ids in the page
  });

  it('blocks every navigation away from the page', async () => {
    expect(allowMapRequest('about:blank')).toBe(true);
    for (const url of ['https://example.com', 'https://unpkg.com/x', 'http://tile.openstreetmap.org/1.png', 'intent://x', 'file:///etc/passwd', 'javascript:alert(1)', 'tel:123']) expect(allowMapRequest(url)).toBe(false);
    await renderIn(<AvailabilityMap onOpen={jest.fn()} />);
    const w = await waitFor(() => screen.getByTestId('availability-map'));
    expect(w.props.onShouldStartLoadWithRequest({ url: 'https://evil.example/' })).toBe(false);
    expect(w.props.onShouldStartLoadWithRequest({ url: 'about:blank' })).toBe(true);
  });

  it('shows the host card when a pin is selected, and opens the profile', async () => {
    const onOpen = jest.fn();
    await renderIn(<AvailabilityMap onOpen={onOpen} />);
    await waitFor(() => screen.getByTestId('availability-map'));
    expect(screen.queryByText('View profile')).toBeNull();
    await send({ type: 'select', id: 'a1' });
    expect(screen.getByText('View profile')).toBeTruthy();
    expect(screen.getByText('Available Dec 1 to Dec 9')).toBeTruthy();
    await fireEvent.press(screen.getByText('View profile'));
    expect(onOpen).toHaveBeenCalledWith('u1');
    await send({ type: 'select', id: 'a2' });                                              // another pin: the card follows
    expect(screen.getAllByText('Host2').length).toBeGreaterThan(0);
  });

  it('selects from the list, keeping the pin highlighted in the page', async () => {
    await renderIn(<AvailabilityMap onOpen={jest.fn()} />);
    await waitFor(() => screen.getByTestId('availability-map'));
    await fireEvent.press(screen.getByLabelText(/^Host2\./));
    expect(screen.getByText('View profile')).toBeTruthy();
    expect(screen.getByLabelText(/^Host2\./).props.accessibilityState).toMatchObject({ selected: true });
  });

  it('ignores messages it does not know', async () => {
    await renderIn(<AvailabilityMap onOpen={jest.fn()} />);
    await waitFor(() => screen.getByTestId('availability-map'));
    await send({ type: 'select', id: 'not-a-pin' });
    await send({ type: 'navigate', url: 'https://evil.example' });
    await act(async () => { screen.getByTestId('availability-map').props.onMessage({ nativeEvent: { data: 'not json' } }); });
    expect(screen.queryByText('View profile')).toBeNull();
    const ids = new Set(['a1']);
    expect(parseMapMessage('{"type":"select","id":"a1"}', ids)).toEqual({ type: 'select', id: 'a1' });
    expect(parseMapMessage('{"type":"select","id":1}', ids)).toBeNull();
    expect(parseMapMessage('{"type":"ready"}', ids)).toEqual({ type: 'ready' });
  });

  it('never makes a pin out of a host without a usable position', async () => {
    x.fetchMapAvailability.mockResolvedValue([row(1, { approx_lat: null }), row(2, { approx_lng: 500 })]);
    await renderIn(<AvailabilityMap onOpen={jest.fn()} />);
    await waitFor(() => expect(screen.getByText('No hosts are showing availability on the map yet.')).toBeTruthy());
    expect(screen.queryByTestId('availability-map')).toBeNull();
  });

  it('filters by pet type with the same chips, and a second tap clears the filter', async () => {
    await renderIn(<AvailabilityMap onOpen={jest.fn()} />);
    await waitFor(() => screen.getByTestId('availability-map'));
    await fireEvent.press(screen.getByText('Cats'));
    await waitFor(() => expect(x.fetchMapAvailability).toHaveBeenLastCalledWith('cat'));
    await fireEvent.press(screen.getByText('Cats'));
    await waitFor(() => expect(x.fetchMapAvailability).toHaveBeenLastCalledWith(null));
  });

  it('says so when it fails, and tries again', async () => {
    x.fetchMapAvailability.mockRejectedValueOnce(new Error('network'));
    await renderIn(<AvailabilityMap onOpen={jest.fn()} />);
    await waitFor(() => expect(screen.getByText('We could not load the map. Check your connection and try again.')).toBeTruthy());
    await fireEvent.press(screen.getByText('Try again'));
    await waitFor(() => screen.getByTestId('availability-map'));
  });

  it('shows an error with a retry when the page itself cannot load', async () => {
    await renderIn(<AvailabilityMap onOpen={jest.fn()} />);
    await waitFor(() => screen.getByTestId('availability-map'));
    await send({ type: 'error' });
    expect(screen.getByText('We could not load the map. Check your connection and try again.')).toBeTruthy();
  });

  it('speaks Arabic', async () => {
    x.fetchMapAvailability.mockResolvedValue([]);
    await renderIn(<AvailabilityMap onOpen={jest.fn()} />, { locale: 'ar' });
    await waitFor(() => expect(screen.getByText('لا يوجد مضيفون يعرضون توفرهم على الخريطة بعد.')).toBeTruthy());
  });
});
