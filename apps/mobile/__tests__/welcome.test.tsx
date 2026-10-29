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

  it('makes every footer link at least 44 pt tall', async () => {
    await renderWelcome();
    for (const link of screen.getAllByRole('link')) {
      expect(JSON.stringify(link.props.style)).toMatch(/"minHeight":44/);
    }
  });

  it('starts sign-up with the chosen role, never straight into Explore', async () => {
    await renderWelcome();
    await fireEvent.press(screen.getByLabelText(/I need a sitter/));
    expect(router.push).toHaveBeenCalledWith('/signup/phone?role=owner');
    await fireEvent.press(screen.getByLabelText(/I want to sit/));
    expect(router.push).toHaveBeenCalledWith('/signup/phone?role=sitter');
  });

  it('has a Log in button that opens the phone step', async () => {
    await renderWelcome();
    await fireEvent.press(screen.getByText('Already have an account? Log in'));
    expect(router.push).toHaveBeenCalledWith('/signup/phone');
  });
});
