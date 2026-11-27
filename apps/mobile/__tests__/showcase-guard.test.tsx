import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const mockRedirect = jest.fn();
jest.mock('expo-router', () => ({ Redirect: (p: { href: string }) => { mockRedirect(p.href); return null; } }));
jest.mock('../src/dev/Showcase', () => ({ __esModule: true, default: () => require('react-native').Text && require('react').createElement(require('react-native').Text, null, 'showcase-body') }));

const load = (dev: boolean) => {
  (globalThis as unknown as { __DEV__: boolean }).__DEV__ = dev;
  let Route: React.ComponentType = () => null;
  jest.isolateModules(() => { Route = require('../app/showcase').default; });
  return Route;
};
afterEach(() => { (globalThis as unknown as { __DEV__: boolean }).__DEV__ = true; mockRedirect.mockClear(); });

describe('the motion showcase route', () => {
  it('opens in development', async () => {
    const Route = load(true);
    await render(<Route />);
    expect(screen.getByText('showcase-body')).toBeTruthy();
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it('sends everyone to the welcome screen in production', async () => {
    const Route = load(false);
    await render(<Route />);
    expect(screen.queryByText('showcase-body')).toBeNull();
    expect(mockRedirect).toHaveBeenCalledWith('/');
  });

  it('is only ever imported inside the development branch, so the bundler leaves it out', () => {
    const src = readFileSync(join(__dirname, '..', 'app', 'showcase.tsx'), 'utf8');
    const imports = src.split('\n').filter((l) => /^import .*Showcase/.test(l));
    expect(imports).toEqual([]);
    expect(src).toMatch(/if \(__DEV__\) \{[\s\S]*require\('\.\.\/src\/dev\/Showcase'\)/);
    // and no other file pulls it in
    const { execSync } = require('node:child_process') as typeof import('node:child_process');
    const users = execSync("grep -rl \"dev/Showcase\" app src --include=*.ts --include=*.tsx || true", { cwd: join(__dirname, '..') }).toString().trim().split('\n').filter(Boolean).sort();
    expect(users).toEqual(['app/showcase.tsx']);
  });
});
