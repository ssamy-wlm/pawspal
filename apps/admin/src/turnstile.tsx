'use client';
import React from 'react';

declare global {
  interface Window { turnstile?: { render(el: HTMLElement, o: Record<string, unknown>): string; reset(id?: string): void; remove(id?: string): void } }
}
const SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
export const turnstileSiteKey = () => process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? '';

/** Cloudflare's free "are you a person" check. Supabase Auth asks for it on every password sign-in. */
export function Turnstile({ onToken, resetKey }: { onToken: (token: string | null) => void; resetKey: number }) {
  const box = React.useRef<HTMLDivElement>(null);
  const id = React.useRef<string | null>(null);
  const siteKey = turnstileSiteKey();
  React.useEffect(() => {
    if (!siteKey || !box.current) return;
    let gone = false;
    const mount = () => {
      if (gone || !box.current || !window.turnstile || id.current) return;
      id.current = window.turnstile.render(box.current, {
        sitekey: siteKey, theme: 'dark',
        callback: (t: string) => onToken(t), 'expired-callback': () => onToken(null), 'error-callback': () => onToken(null),
      });
    };
    if (window.turnstile) mount();
    else {
      let s = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT}"]`);
      if (!s) { s = document.createElement('script'); s.src = SCRIPT; s.async = true; document.head.appendChild(s); }
      s.addEventListener('load', mount);
    }
    return () => { gone = true; if (id.current && window.turnstile) window.turnstile.remove(id.current); id.current = null; };
  }, [siteKey, onToken]);
  React.useEffect(() => { if (id.current && window.turnstile) { window.turnstile.reset(id.current); onToken(null); } }, [resetKey, onToken]);
  return siteKey ? <div ref={box} /> : null;
}
