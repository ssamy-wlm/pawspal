import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';
import Welcome from '../app/index';
import { ThemeProvider } from '../src/theme';

jest.mock('expo-router', () => {
  const { Text } = require('react-native');
  return {
    router: { push: jest.fn() },
    Link: ({ children, href }: { children: React.ReactNode; href: string }) => (
      <Text accessibilityRole="link" accessibilityHint={href}>{children}</Text>
    ),
  };
});

const renderWelcome = () => render(<ThemeProvider><Welcome /></ThemeProvider>);

describe('Welcome screen', () => {
  it('shows both ways to join and the legal links', async () => {
    await renderWelcome();
    expect(screen.getByText('I need a sitter')).toBeTruthy();
    expect(screen.getByText('I want to sit')).toBeTruthy();
  });

  it('links each legal document from the footer', async () => {
    await renderWelcome();
    const links = screen.getAllByRole('link');
    expect(links.map((l) => l.props.accessibilityHint)).toEqual([
      '/legal/termsOfService', '/legal/privacyPolicy', '/legal/communityGuidelines',
    ]);
    expect(screen.getByText('Terms of Service')).toBeTruthy();
    expect(screen.getByText('Privacy Policy')).toBeTruthy();
    expect(screen.getByText('Community Guidelines')).toBeTruthy();
  });

  it('opens Explore from "I need a sitter"', async () => {
    await renderWelcome();
    await fireEvent.press(screen.getByLabelText(/I need a sitter/));
    expect(router.push).toHaveBeenCalledWith('/explore');
  });
});
