import tokens from '../src/tokens.json';

const navy = tokens.color.dark;

/** Placeholder until phase 8 (the real admin dashboard). It shows no data and needs no sign-in. */
export default function Home() {
  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: tokens.space.xl,
        padding: tokens.space.xl,
        textAlign: 'center',
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/pawspal-logo.svg" alt="PawsPal Dahab" width={220} height={220} />
      <h1 style={{ margin: 0, fontSize: tokens.font.size.title, fontWeight: tokens.font.weight.semibold, color: navy.text }}>
        Admin dashboard coming soon
      </h1>
    </main>
  );
}
