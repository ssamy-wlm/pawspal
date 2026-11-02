// The web version of storage.ts. The browser has no keychain, so values go in localStorage. See docs/security.md
// ("Web session storage") for what that means and why the page's strict content policy matters.
// If the browser refuses storage (private window, blocked site data), values are kept in memory for this tab instead:
// the person stays signed in until they close it, and nothing ever throws.

export interface Backend { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void }

/** Builds the storage functions on top of a backend. `getBackend` may throw or return null: that means "use memory". */
export function createWebStorage(getBackend: () => Backend | null) {
  const memory = new Map<string, string>();
  const safe = <T>(fn: (b: Backend) => T): { ok: true; value: T } | { ok: false } => {
    try { const b = getBackend(); if (b) return { ok: true, value: fn(b) }; } catch { /* use memory */ }
    return { ok: false };
  };
  return {
    async getItem(key: string): Promise<string | null> {
      const r = safe((b) => b.getItem(key));
      if (r.ok && r.value !== null) return r.value;
      return memory.get(key) ?? null;
    },
    async setItem(key: string, value: string): Promise<void> {
      const r = safe((b) => b.setItem(key, value));
      if (r.ok) memory.delete(key); else memory.set(key, value);
    },
    async removeItem(key: string): Promise<void> {
      safe((b) => b.removeItem(key));
      memory.delete(key);
    },
  };
}

const browser = (): Backend | null => (typeof window !== 'undefined' ? window.localStorage : null);
const store = createWebStorage(browser);

export const getItem = store.getItem;
export const setItem = store.setItem;
export const removeItem = store.removeItem;
