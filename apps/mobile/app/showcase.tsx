import React from 'react';
import { Redirect } from 'expo-router';

/**
 * The motion showcase is a developer screen. In a production build `__DEV__` is false: the bundler removes the branch below,
 * so the screen is not even in the app (phone or web) and this route only sends the person to the welcome screen.
 */
export default function ShowcaseRoute() {
  if (__DEV__) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Showcase = require('../src/dev/Showcase').default as React.ComponentType;
    return <Showcase />;
  }
  return <Redirect href="/" />;
}
