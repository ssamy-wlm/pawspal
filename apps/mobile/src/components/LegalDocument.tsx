import React from 'react';
import { ScrollView, Text, View } from 'react-native';
import { legal, LegalDoc } from '../legal';
import { fontFamily, useTheme } from '../theme';
import { isRTL, t as tr } from '../i18n';
import { Block, Inline, parseMarkdown } from './markdown';

/** Renders a bundled legal document (Privacy Policy, Terms, Community Guidelines) inside the app. Works offline. */
export function LegalDocument({ doc }: { doc: LegalDoc }) {
  const t = useTheme();
  const rtl = isRTL();
  const d = legal[doc];
  const c = t.color;
  const blocks = React.useMemo(() => parseMarkdown(d.body), [d.body]);

  const runs = (content: Inline[], bold = false) =>
    content.map((r, i) => (
      <Text
        key={i}
        style={[
          r.bold || bold ? { fontFamily: fontFamily('bold', rtl) } : null,
          r.code ? { backgroundColor: c.surfaceTint ?? c.surface } : null,
        ]}>
        {r.text}
      </Text>
    ));

  const body = { color: c.text, fontSize: 16, lineHeight: 24, fontFamily: fontFamily('regular', rtl) } as const;

  const render = (b: Block, i: number) => {
    switch (b.type) {
      case 'heading': {
        const size = { 1: 28, 2: 20, 3: 17 }[b.level];
        const weight = { 1: 'extrabold', 2: 'bold', 3: 'semibold' }[b.level] as 'extrabold' | 'bold' | 'semibold';
        return (
          <Text key={i} accessibilityRole="header"
            style={{ color: c.text, fontSize: size, fontFamily: fontFamily(weight, rtl), marginTop: b.level === 1 ? 0 : b.level === 2 ? 24 : 16, marginBottom: 8 }}>
            {runs(b.content)}
          </Text>
        );
      }
      case 'paragraph':
        return <Text key={i} style={[body, { marginBottom: 12 }]}>{runs(b.content)}</Text>;
      case 'bullet':
      case 'numbered':
        return (
          <View key={i} style={{ flexDirection: 'row', gap: 8, marginBottom: 6, paddingStart: 8 }}>
            <Text style={body}>{b.type === 'bullet' ? '•' : b.marker}</Text>
            <Text style={[body, { flex: 1 }]}>{runs(b.content)}</Text>
          </View>
        );
      case 'table':
        return (
          <View key={i} accessibilityRole="summary" style={{ borderWidth: 1, borderColor: c.border, borderRadius: 12, marginVertical: 12, overflow: 'hidden' }}>
            {[b.header, ...b.rows].map((row, r) => (
              <View key={r} style={{ flexDirection: 'row', borderTopWidth: r === 0 ? 0 : 1, borderColor: c.border,
                backgroundColor: r === 0 ? c.surfaceTint ?? c.surface : 'transparent' }}>
                {row.map((cell, k) => (
                  <Text key={k} style={[body, { flex: 1, fontSize: 14, lineHeight: 20, padding: 8 }]}>{runs(cell, r === 0)}</Text>
                ))}
              </View>
            ))}
          </View>
        );
    }
  };

  return (
    <ScrollView style={{ backgroundColor: c.background }} contentContainerStyle={{ padding: 24, paddingBottom: 64 }}>
      <View style={{ marginBottom: 12 }}>
        <Text style={{ color: c.textMuted, fontSize: 13, fontFamily: fontFamily('regular', rtl) }}>{tr('legal.version', { version: d.version ?? '', effective: d.effective ?? '' })}</Text>
      </View>
      {blocks.map(render)}
    </ScrollView>
  );
}
