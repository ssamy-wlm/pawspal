// The web build has no crash reporting yet: the page's content policy (vercel.json) does not allow a Sentry address.
// To turn it on for the web, see the note in apps/mobile/README.md ("Crash reporting"). Metro picks this file on the web.
export function initMonitoring(): boolean {
  return false;
}
