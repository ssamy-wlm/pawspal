import React from 'react';
import { Linking } from 'react-native';
import { act, fireEvent, screen } from '@testing-library/react-native';
import ar from '../src/i18n/ar.json';
import en from '../src/i18n/en.json';
import { ChatBubble } from '../src/components/ChatBubble';
import { CheckRow } from '../src/components/CheckRow';
import { EmptyState } from '../src/components/EmptyState';
import { MapCard } from '../src/components/MapCard';
import { StepHeader } from '../src/components/StepHeader';
import { TermsCard } from '../src/components/TermsCard';
import { ToastProvider, useToast } from '../src/components/Toast';
import { COMBOS, renderIn } from '../test-utils/render';

const words = (locale: 'en' | 'ar') => (locale === 'ar' ? ar : en);

describe.each(COMBOS)('components in $mode theme, $locale', ({ mode, locale }) => {
  const w = words(locale);
  const r = (ui: React.ReactElement) => renderIn(ui, { mode, locale });

  it('StepHeader shows the step, a progress bar and a working back button', async () => {
    const onBack = jest.fn();
    await r(<StepHeader step={2} total={6} onBack={onBack} />);
    const label = w['step.of'].replace('{n}', '2').replace('{total}', '6');
    expect(screen.getByText(label)).toBeTruthy();
    const bar = screen.getByRole('progressbar');
    expect(bar.props.accessibilityValue).toEqual({ min: 1, max: 6, now: 2 });
    await fireEvent.press(screen.getByLabelText(w['common.back']));
    expect(onBack).toHaveBeenCalled();
  });

  it('CheckRow reads as one item with title and description', async () => {
    await r(<CheckRow title="Phone verified" description="One number per account" />);
    expect(screen.getByLabelText('Phone verified. One number per account')).toBeTruthy();
  });

  it('ChatBubble shows the text, and the privacy hint when contact details were masked', async () => {
    await r(<><ChatBubble text="Hello" /><ChatBubble text="Hi back" mine masked /></>);
    expect(screen.getByText('Hello')).toBeTruthy();
    expect(screen.getByText('Hi back')).toBeTruthy();
    expect(screen.getAllByText(w['chat.maskedHint'])).toHaveLength(1);
  });

  it('TermsCard: Accept, then Accepted; Change is always available', async () => {
    const onAccept = jest.fn();
    const onChange = jest.fn();
    const terms = { dates: '2 – 9 Nov', pet: 'Mango', location: 'Sitter home', cost: '250' };
    const { rerender } = await r(<TermsCard terms={terms} accepted={false} onAccept={onAccept} onChange={onChange} />);
    expect(screen.getByText('Mango')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText(w['terms.accept']));
    expect(onAccept).toHaveBeenCalledTimes(1);
    await fireEvent.press(screen.getByLabelText(w['terms.change']));
    expect(onChange).toHaveBeenCalledTimes(1);

    const { ThemeProvider } = require('../src/theme');
    await rerender(<ThemeProvider initialMode={mode}><TermsCard terms={terms} accepted onAccept={onAccept} onChange={onChange} /></ThemeProvider>);
    const accepted = screen.getByLabelText(w['terms.accepted']);
    expect(accepted.props.accessibilityState).toMatchObject({ disabled: true, selected: true });
  });

  it('MapCard: the approximate area never offers directions', async () => {
    await r(<MapCard />);
    expect(screen.getAllByText(w['map.approx']).length).toBeGreaterThan(0);
    expect(screen.queryByText(w['map.directions'])).toBeNull();
    expect(screen.queryByText(w['map.exact'])).toBeNull();
  });

  it('MapCard: the exact pin offers directions in Google Maps', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    await r(<MapCard exact lat={28.5} lng={34.51} address="Masbat Road" />);
    expect(screen.getByText(w['map.exact'])).toBeTruthy();
    expect(screen.getByText('Masbat Road')).toBeTruthy();
    await fireEvent.press(screen.getByText(w['map.directions']));
    expect(open).toHaveBeenCalledWith('https://www.google.com/maps/dir/?api=1&destination=28.5,34.51');
    open.mockRestore();
  });

  it('MapCard: coordinates that are not real never offer directions', async () => {
    await r(<><MapCard exact lat={NaN} lng={34.5} /><MapCard exact lat={91} lng={34.5} /><MapCard exact lat={28.5} lng={Infinity} /></>);
    expect(screen.queryByText(w['map.directions'])).toBeNull();
  });

  it('MapCard: tells the user when Google Maps cannot open, without showing the coordinates', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockRejectedValue(new Error('no app'));
    await r(<ToastProvider><MapCard exact lat={28.5} lng={34.51} /></ToastProvider>);
    await fireEvent.press(screen.getByText(w['map.directions']));
    expect(await screen.findByText(w['map.openFailed'])).toBeTruthy();
    expect(screen.queryByText(/28\.5/)).toBeNull();
    open.mockRestore();
  });

  it('EmptyState: one line and one action', async () => {
    const onAction = jest.fn();
    await r(<EmptyState message={w['calendar.empty']} actionLabel={w['empty.findHost']} onAction={onAction} />);
    expect(screen.getByText(w['calendar.empty'])).toBeTruthy();
    await fireEvent.press(screen.getByText(w['empty.findHost']));
    expect(onAction).toHaveBeenCalled();
  });

  it('Toast: shows a message, can be dismissed, and goes away by itself', async () => {
    jest.useFakeTimers();
    function Trigger() { const toast = useToast(); return <ChatBubble text="go" animate={false} {...{ onTouchEnd: () => toast.show('Saved', 'success') }} />; }
    let show: (m: string) => void = () => {};
    function Grab() { show = useToast().show; return null; }
    await r(<ToastProvider><Grab /><Trigger /></ToastProvider>);
    expect(screen.queryByText('Saved')).toBeNull();
    await act(async () => { show('Saved'); });
    expect(screen.getByText('Saved')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText(w['toast.dismiss']));
    expect(screen.queryByText('Saved')).toBeNull();
    await act(async () => { show('Again'); });
    expect(screen.getByText('Again')).toBeTruthy();
    await act(async () => { jest.advanceTimersByTime(4100); });
    expect(screen.queryByText('Again')).toBeNull();
    jest.useRealTimers();
  });
});
