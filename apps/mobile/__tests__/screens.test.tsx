import React from 'react';
import { screen, within } from '@testing-library/react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import ar from '../src/i18n/ar.json';
import en from '../src/i18n/en.json';
import { navyTheme, lightTheme } from '../src/theme';
import Welcome from '../app/index';
import Explore from '../app/(tabs)/explore';
import CalendarTab from '../app/(tabs)/calendar';
import ChatTab from '../app/(tabs)/chat';
import ProfileTab from '../app/(tabs)/profile';
import TabsLayout from '../app/(tabs)/_layout';
import Settings from '../app/settings';
import LegalScreen from '../app/legal/[doc]';
import Showcase from '../app/showcase';
import { ToastProvider } from '../src/components/Toast';
import { COMBOS, renderIn } from '../test-utils/render';

jest.mock('expo-router', () => {
  const { Text, View } = require('react-native');
  const Screen = ({ options }: { options?: { title?: string; tabBarIcon?: (p: { color: string }) => React.ReactNode } }) => (
    <View accessible accessibilityRole="tab">
      {options?.tabBarIcon ? options.tabBarIcon({ color: 'x' }) : null}
      <Text>{options?.title}</Text>
    </View>
  );
  return {
    router: { push: jest.fn(), navigate: jest.fn(), replace: jest.fn() },
    Link: ({ children }: { children: React.ReactNode }) => <Text>{children}</Text>,
    Stack: Object.assign(({ children }: { children?: React.ReactNode }) => children ?? null, { Screen: () => null }),
    Tabs: Object.assign(({ children }: { children: React.ReactNode }) => <View>{children}</View>, { Screen }),
    useLocalSearchParams: () => ({ doc: 'privacyPolicy' }),
    useFocusEffect: (cb: () => void) => require('react').useEffect(cb, [cb]),
  };
});

const w = (locale: 'en' | 'ar') => (locale === 'ar' ? ar : en);

describe.each(COMBOS)('every screen in $mode theme, $locale', ({ mode, locale }) => {
  const r = (ui: React.ReactElement) => renderIn(<GestureHandlerRootView style={{ flex: 1 }}><ToastProvider>{ui}</ToastProvider></GestureHandlerRootView>, { mode, locale });
  const words = w(locale);

  it('Welcome', async () => {
    await r(<Welcome />);
    expect(screen.getByText(words['welcome.needSitter'])).toBeTruthy();
    expect(screen.getByText(words['welcome.wantSit'])).toBeTruthy();
    expect(screen.getByText(words['legal.privacy'])).toBeTruthy();
  });

  it('Explore', async () => {
    await r(<Explore />);
    expect(screen.getByText(words['explore.whenAway'])).toBeTruthy();
    expect(screen.getByText(words['explore.budget.title'])).toBeTruthy();
    expect(screen.getByText(words['explore.mode.swipe'])).toBeTruthy();
    expect(screen.getByLabelText(words['calendar.choose'])).toBeTruthy();
  });

  it('Calendar, Chat and Profile tabs', async () => {
    await r(<><CalendarTab /><ChatTab /><ProfileTab /></>);
    expect(screen.getByText(words['calendar.empty'])).toBeTruthy();
    expect(screen.getByText(words['chat.empty'])).toBeTruthy();
    expect(screen.getByLabelText(words['profile.edit'])).toBeTruthy();
    expect(screen.getByLabelText(words['profile.pets'])).toBeTruthy();
    expect(screen.getByLabelText(words['profile.settings'])).toBeTruthy();
    expect(screen.getByLabelText(words['legal.terms'])).toBeTruthy();
  });

  it('tab bar: Explore, Calendar, Chat, Profile in that order, each with an icon and a label', async () => {
    await r(<TabsLayout />);
    const tabs = screen.getAllByRole('tab');
    const expected = [words['tab.explore'], words['tab.calendar'], words['tab.chat'], words['tab.profile']];
    expect(tabs).toHaveLength(4);
    tabs.forEach((tab, i) => expect(within(tab).getByText(expected[i])).toBeTruthy());
  });

  it('Settings: theme and language choices', async () => {
    await r(<Settings />);
    for (const k of ['theme.system', 'theme.light', 'theme.navy', 'lang.en', 'lang.ar'] as const) expect(screen.getByText(words[k])).toBeTruthy();
    expect(screen.getByText(words['settings.languageNote'])).toBeTruthy();
  });

  it('Legal document', async () => {
    await r(<LegalScreen />);
    expect(screen.getAllByRole('header').length).toBeGreaterThan(3);
    expect(screen.getByText(new RegExp(locale === 'ar' ? 'الإصدار' : 'Version'))).toBeTruthy();
  });

  it('Developer showcase (every component and animation)', async () => {
    await r(<Showcase />);
    expect(screen.getByText(words['dev.replay'])).toBeTruthy();
    expect(screen.getAllByText(words['map.approx']).length).toBeGreaterThan(0);
    expect(screen.getByText(words['terms.title'])).toBeTruthy();
    expect(screen.getByText(words['step.of'].replace('{n}', '2').replace('{total}', '6'))).toBeTruthy();
  });
});

describe('the app background follows the theme', () => {
  it.each([['light', lightTheme], ['navy', navyTheme]] as const)('%s', async (mode, theme) => {
    const { toJSON } = await renderIn(<CalendarTab />, { mode });
    expect(JSON.stringify(toJSON())).toContain(theme.color.background);
  });
});
