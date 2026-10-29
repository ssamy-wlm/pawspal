import React from 'react';
import { act, screen } from '@testing-library/react-native';
import * as Reanimated from 'react-native-reanimated';
import { AnimatedLogo } from '../src/components/AnimatedLogo';
import { Blob } from '../src/components/Blob';
import { CheckStamp } from '../src/components/CheckStamp';
import { ChatBubble } from '../src/components/ChatBubble';
import { HeartBurst, HeartBurstHandle } from '../src/components/HeartBurst';
import { PinDrop } from '../src/components/PinDrop';
import { TermsCard } from '../src/components/TermsCard';
import { ease, entranceSpec, M } from '../src/motion';
import { ThemeProvider } from '../src/theme';
import { renderIn } from '../test-utils/render';

jest.mock('react-native-reanimated', () => {
  const actual = jest.requireActual('react-native-reanimated');
  return { ...actual, __esModule: true, default: actual.default, withRepeat: jest.fn(actual.withRepeat), useReducedMotion: jest.fn(() => false) };
});

const reduceMotion = (on: boolean) => (Reanimated.useReducedMotion as jest.Mock).mockReturnValue(on);
const terms = { dates: 'a', pet: 'b', location: 'c', cost: 'd' };

describe('entrance spec (docs/motion.md section 8)', () => {
  it('normally rises and overshoots like the video', () => {
    expect(entranceSpec(false, { rise: 40, k: 1.6, duration: 450 })).toEqual({ rise: 40, overshoot: 1.6, duration: 450, scales: true });
    expect(entranceSpec(false).overshoot).toBe(M.overshoot.pop);
  });

  it('with Reduce Motion: no overshoot, no travel, no scaling, a 200 ms fade', () => {
    expect(entranceSpec(true, { rise: 60, k: 1.9, duration: 900 })).toEqual({ rise: 0, overshoot: 0, duration: 200, scales: false });
  });
});

describe('Reduce Motion turns off loops and overshoot', () => {
  beforeEach(() => { (Reanimated.withRepeat as jest.Mock).mockClear(); jest.restoreAllMocks(); });
  afterEach(() => reduceMotion(false));

  const looping = () => (
    <>
      <AnimatedLogo size={100} /><Blob x={0} y={0} size={50} color="x" /><CheckStamp /><PinDrop />
    </>
  );

  it('plays its idle loops (sway, wiggle, breathing) when motion is allowed', async () => {
    reduceMotion(false);
    await renderIn(looping());
    expect((Reanimated.withRepeat as jest.Mock).mock.calls.length).toBeGreaterThan(0);
  });

  it('plays no loop at all when Reduce Motion is on', async () => {
    reduceMotion(true);
    await renderIn(looping());
    expect(Reanimated.withRepeat).not.toHaveBeenCalled();
  });

  it('chat bubbles and the terms card use an overshoot curve only when motion is allowed', async () => {
    const back = jest.spyOn(Reanimated.Easing, 'back');
    reduceMotion(false);
    await renderIn(<><ChatBubble text="hi" /><TermsCard terms={terms} accepted={false} onAccept={() => {}} onChange={() => {}} /></>);
    expect(back).toHaveBeenCalledWith(1.6);

    back.mockClear();
    reduceMotion(true);
    await renderIn(<><ChatBubble text="hi" /><TermsCard terms={terms} accepted={false} onAccept={() => {}} onChange={() => {}} /></>);
    expect(back).not.toHaveBeenCalled();
    expect(screen.getAllByText('hi').length).toBeGreaterThan(0);
  });

  it('the 200 ms Reduce Motion fade really plays (it opts out of the "skip animations" default)', async () => {
    const timing = jest.spyOn(Reanimated, 'withTiming');
    reduceMotion(true);
    await renderIn(<><ChatBubble text="hi" /><Blob x={0} y={0} size={20} color="x" /></>);
    const fades = timing.mock.calls.filter(([, cfg]) => cfg?.duration === 200);
    expect(fades.length).toBeGreaterThanOrEqual(2);
    for (const [, cfg] of fades) expect(cfg?.reduceMotion).toBe(Reanimated.ReduceMotion.Never);
  });

  it('the accept ripple plays when terms become accepted, and not when an accepted card is shown again', async () => {
    const rippleCalls = (spy: jest.SpyInstance) => spy.mock.calls.filter(([, cfg]) => cfg?.easing === ease.out && cfg?.duration === M.duration.pop).length;
    reduceMotion(false);

    const again = jest.spyOn(Reanimated, 'withTiming');
    await renderIn(<TermsCard terms={terms} accepted onAccept={() => {}} onChange={() => {}} />);
    expect(rippleCalls(again)).toBe(0);
    again.mockClear();

    const { rerender } = await renderIn(<TermsCard terms={terms} accepted={false} onAccept={() => {}} onChange={() => {}} />);
    again.mockClear();
    await rerender(<ThemeProvider initialMode="light"><TermsCard terms={terms} accepted onAccept={() => {}} onChange={() => {}} /></ThemeProvider>);
    expect(rippleCalls(again)).toBe(1);
  });

  it('the heart burst does nothing with Reduce Motion', async () => {
    const timing = jest.spyOn(Reanimated, 'withTiming');
    reduceMotion(true);
    const ref = React.createRef<HeartBurstHandle>();
    await renderIn(<HeartBurst ref={ref} />);
    timing.mockClear();
    await act(async () => { ref.current?.burst(); });
    expect(timing).not.toHaveBeenCalled();

    reduceMotion(false);
    const ref2 = React.createRef<HeartBurstHandle>();
    await renderIn(<HeartBurst ref={ref2} />);
    await act(async () => { ref2.current?.burst(); });
    expect(timing).toHaveBeenCalled();
  });
});
