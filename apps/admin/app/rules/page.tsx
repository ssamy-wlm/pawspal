'use client';
import React from 'react';
import { LADDER, RULES, ZERO_TOLERANCE } from '../../src/rules';
import { Card, H1, H2, Muted, pageStyle } from '../../src/ui';

export default function Rules() {
  return (
    <div style={pageStyle}>
      <H1 sub="What we expect from everyone, and what happens when a rule is broken. The full text people agreed to is in the app under Community Guidelines.">Rules</H1>
      <H2>The five rules</H2>
      <Card><ol style={{ margin: 0, paddingLeft: 22, display: 'flex', flexDirection: 'column', gap: 6 }}>{RULES.map((r) => <li key={r}>{r}</li>)}</ol></Card>
      <H2>The ladder</H2>
      <Card>
        <ol style={{ margin: 0, paddingLeft: 22, display: 'flex', flexDirection: 'column', gap: 6 }}>{LADDER.map((r) => <li key={r}>{r}</li>)}</ol>
        <Muted>People can appeal in the app. A person reviews every appeal on the Appeals page.</Muted>
      </Card>
      <H2>Zero tolerance</H2>
      <Card>
        <ul style={{ margin: 0, paddingLeft: 22, display: 'flex', flexDirection: 'column', gap: 6 }}>{ZERO_TOLERANCE.map((r) => <li key={r}>{r}</li>)}</ul>
        <Muted>These can go straight to removal. A removed person&apos;s phone number, ID document and device are blocked so they cannot return.</Muted>
      </Card>
    </div>
  );
}
