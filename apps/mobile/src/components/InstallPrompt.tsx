// "Install PawsPal" only exists on the web. On a phone the app is already installed, so this draws nothing
// (InstallPrompt.web.tsx has the real one; Metro picks it for the web build).
export function InstallPrompt(_props: { variant?: 'banner' | 'settings'; delay?: number }): null {
  return null;
}
