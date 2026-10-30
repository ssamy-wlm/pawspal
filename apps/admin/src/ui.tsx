'use client';
import React from 'react';
import Link from 'next/link';
import tokens from './tokens.json';
import { supabase } from './supabase';

export const C = { ...tokens.color.light, navy: tokens.color.brand.navy, dark: tokens.color.dark, tint: tokens.color.tint, brand: tokens.color.brand };
const font = tokens.font.size;

export const pageStyle: React.CSSProperties = { padding: 32, display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 1180 };

export function H1({ children, sub }: { children: React.ReactNode; sub?: string }) {
  return (
    <header style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <h1 style={{ margin: 0, fontSize: font.headline, color: C.text }}>{children}</h1>
      {sub ? <p style={{ margin: 0, color: C.textMuted, fontSize: font.body }}>{sub}</p> : null}
    </header>
  );
}
export const H2 = ({ children }: { children: React.ReactNode }) => <h2 style={{ margin: '8px 0 0', fontSize: font.lead, color: C.text }}>{children}</h2>;

export function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <section style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: tokens.radius.card, padding: 20, display: 'flex', flexDirection: 'column', gap: 12, ...style }}>{children}</section>;
}

type Tone = 'neutral' | 'good' | 'warn' | 'bad';
const TONES: Record<Tone, [string, string]> = {
  neutral: [C.surfaceTint, C.text], good: [C.tint.teal, C.primary], warn: [C.tint.orange, C.navy], bad: [C.tint.coral, C.danger],
};
export function Badge({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: Tone }) {
  const [bg, fg] = TONES[tone];
  return <span style={{ display: 'inline-block', padding: '2px 10px', borderRadius: 999, background: bg, color: fg, fontSize: font.caption, fontWeight: 600, whiteSpace: 'nowrap' }}>{children}</span>;
}
export const statusTone = (s: string): Tone => (s === 'active' || s === 'resolved' || s === 'completed' || s === 'confirmed' ? 'good' : s === 'suspended' || s === 'removed' || s === 'dismissed' || s === 'cancelled' ? 'bad' : 'warn');

export function Btn({ children, onClick, kind = 'primary', disabled, type = 'button' }:
  { children: React.ReactNode; onClick?: () => void; kind?: 'primary' | 'secondary' | 'danger'; disabled?: boolean; type?: 'button' | 'submit' }) {
  const bg = kind === 'primary' ? C.primary : kind === 'danger' ? C.danger : 'transparent';
  const fg = kind === 'secondary' ? C.primary : C.onPrimary;
  return (
    <button type={type} onClick={onClick} disabled={disabled}
      style={{ minHeight: 40, padding: '0 18px', borderRadius: 999, border: kind === 'secondary' ? `2px solid ${C.primary}` : 'none', background: bg, color: fg, fontWeight: 600, fontSize: font.small, cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1 }}>
      {children}
    </button>
  );
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: font.small, fontWeight: 600, color: C.text }}>{label}{children}</label>;
}
export const inputStyle: React.CSSProperties = { minHeight: 40, padding: '8px 12px', borderRadius: tokens.radius.input, border: `2px solid ${C.textMuted}`, background: C.surface, color: C.text, fontSize: font.body, fontFamily: 'inherit' };

export const Err = ({ children }: { children?: string | null }) => (children ? <p role="alert" style={{ margin: 0, color: C.danger, fontSize: font.small, fontWeight: 600 }}>{children}</p> : null);
export const Muted = ({ children }: { children: React.ReactNode }) => <p style={{ margin: 0, color: C.textMuted, fontSize: font.small }}>{children}</p>;

export function Table({ head, children }: { head: string[]; children: React.ReactNode }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: font.small }}>
        <thead><tr>{head.map((h) => <th key={h} style={{ textAlign: 'left', padding: '8px 10px', color: C.textMuted, borderBottom: `2px solid ${C.border}`, fontWeight: 600 }}>{h}</th>)}</tr></thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
export const Td = ({ children, wide }: { children: React.ReactNode; wide?: boolean }) => <td style={{ padding: '10px', borderBottom: `1px solid ${C.border}`, verticalAlign: 'top', maxWidth: wide ? 380 : undefined, overflowWrap: 'anywhere' }}>{children}</td>;

export const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '');
export const day = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString('en-GB', { dateStyle: 'medium' }) : '');

/** Loads something when the page opens (and again on reload()). Errors become a plain sentence. */
export function useLoad<T>(fn: () => Promise<T>, deps: React.DependencyList) {
  const [data, setData] = React.useState<T | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [tick, setTick] = React.useState(0);
  React.useEffect(() => {
    let live = true;
    fn().then((v) => { if (live) { setData(v); setError(null); } }, () => { if (live) setError('Could not load this. Try again.'); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { data, error, reload: () => setTick((n) => n + 1) };
}

/** A photo from a private bucket. The admin's own sign-in (with the code) is what allows the link. */
export function Photo({ bucket, path, size = 140, alt }: { bucket: 'faces' | 'pets' | 'homes'; path: string | null | undefined; size?: number; alt: string }) {
  const [url, setUrl] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!path) return;
    let live = true;
    supabase().storage.from(bucket).createSignedUrl(path, 300).then(({ data }) => { if (live) setUrl(data?.signedUrl ?? null); }, () => {});
    return () => { live = false; };
  }, [bucket, path]);
  const box: React.CSSProperties = { width: size, height: size, borderRadius: 16, background: C.surfaceTint, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.textMuted, fontSize: font.caption };
  // eslint-disable-next-line @next/next/no-img-element
  return <div style={box}>{path && url ? <img src={url} alt={alt} width={size} height={size} style={{ objectFit: 'cover' }} /> : path ? 'Loading' : 'No photo'}</div>;
}

export function PersonLink({ id, name }: { id: string; name: string | null | undefined }) {
  return <Link href={`/users/${id}`} style={{ color: C.link, fontWeight: 600 }}>{name ?? 'No name'}</Link>;
}
