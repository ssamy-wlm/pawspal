import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';
import Welcome from '../app/index';
import { ThemeProvider } from '../src/theme';

jest.mock('expo-router', () => {
  const { Text } = require('react-native');
  const ReactLib = require('react');
  return {
    router: { push: jest.fn() },
    // asChild: the link is the child itself (a 44 pt Pressable), so pass the address through to it.
    Link: ({ children, href, asChild }: { children: React.ReactElement<{ accessibilityHint?: string }>; href: string; asChild?: boolean }) =>
      asChild ? ReactLib.cloneElement(children, { accessibilityHint: href }) : <Text accessibilityRole="link" accessibilityHint={href}>{children}</Text>,
  };
});

const renderWelcome = () => render(<ThemeProvider><Welcome /></ThemeProvider>);

describe('Welcome screen', () => {
  it('shows the two ways in: create an account and sign in', async () => {
    await renderWelcome();
    expect(screen.getByText('Create account')).toBeTruthy();
    expect(screen.getByText('Sign in')).toBeTruthy();
    expect(screen.queryByText('I need a sitter')).toBeNull();
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

  it('makes every footer link at least 44 pt tall', async () => {
    await renderWelcome();
    for (const link of screen.getAllByRole('link')) {
      expect(JSON.stringify(link.props.style)).toMatch(/"minHeight":44/);
    }
  });

  it('opens the account screen from Create account, never straight into Explore', async () => {
    await renderWelcome();
    await fireEvent.press(screen.getByLabelText(/Create account/));
    expect(router.push).toHaveBeenCalledWith('/signup/account');
  });

  it('opens the sign-in screen from Sign in', async () => {
    await renderWelcome();
    await fireEvent.press(screen.getByLabelText(/Sign in/));
    expect(router.push).toHaveBeenCalledWith('/signin');
  });
});
