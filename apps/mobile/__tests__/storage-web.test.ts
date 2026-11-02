import { createWebStorage, Backend } from '../src/lib/storage.web';

const working = (): Backend & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v); }, removeItem: (k) => { data.delete(k); } };
};

describe('web storage', () => {
  it('keeps values in the browser storage and reads them back', async () => {
    const b = working();
    const s = createWebStorage(() => b);
    await s.setItem('session', 'abc');
    expect(b.data.get('session')).toBe('abc');
    expect(await s.getItem('session')).toBe('abc');
    await s.removeItem('session');
    expect(await s.getItem('session')).toBeNull();
  });

  it('returns null for something never saved', async () => {
    expect(await createWebStorage(() => working()).getItem('nothing')).toBeNull();
  });

  it('falls back to memory when the browser refuses storage, and never throws', async () => {
    const refusing: Backend = {
      getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); }, removeItem: () => { throw new Error('blocked'); },
    };
    const s = createWebStorage(() => refusing);
    await expect(s.setItem('k', 'v')).resolves.toBeUndefined();
    expect(await s.getItem('k')).toBe('v');
    await expect(s.removeItem('k')).resolves.toBeUndefined();
    expect(await s.getItem('k')).toBeNull();
  });

  it('falls back to memory when there is no storage at all (the accessor throws or is missing)', async () => {
    for (const getBackend of [() => null, () => { throw new Error('SecurityError'); }]) {
      const s = createWebStorage(getBackend);
      await s.setItem('lang', 'ar');
      expect(await s.getItem('lang')).toBe('ar');
    }
  });

  it('does not leave a stale in-memory copy after storage starts working again', async () => {
    const b = working();
    let broken = true;
    const s = createWebStorage(() => { if (broken) throw new Error('blocked'); return b; });
    await s.setItem('k', 'old');
    broken = false;
    await s.setItem('k', 'new');
    await s.removeItem('k');
    expect(await s.getItem('k')).toBeNull();
  });
});
