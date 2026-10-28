import React from 'react';
import { ScrollView, Text, View } from 'react-native';
import Markdown from 'react-native-markdown-display';
import { legal, LegalDoc } from '../legal';
import { useTheme } from '../theme';

/** Renders a bundled legal document (Privacy Policy, Terms, Community Guidelines) inside the app. Works offline. */
export function LegalDocument({ doc }: { doc: LegalDoc }) {
  const t = useTheme();
  const d = legal[doc];
  const c = t.color;
  return (
    <ScrollView style={{ backgroundColor: c.background }} contentContainerStyle={{ padding: 24, paddingBottom: 64 }}>
      <View style={{ marginBottom: 12 }}>
        <Text style={{ color: c.textMuted, fontSize: 13 }}>Version {d.version} · Effective {d.effective}</Text>
      </View>
      <Markdown
        style={{
          body: { color: c.text, fontSize: 16, lineHeight: 24, fontFamily: 'Poppins_400' },
          heading1: { color: c.text, fontSize: 28, fontFamily: 'Poppins_800', marginBottom: 12 },
          heading2: { color: c.text, fontSize: 20, fontFamily: 'Poppins_700', marginTop: 24 },
          heading3: { color: c.text, fontSize: 17, fontFamily: 'Poppins_600', marginTop: 16 },
          link: { color: c.link },
          table: { borderColor: c.border },
          th: { padding: 6 },
          td: { padding: 6, borderColor: c.border },
          code_inline: { backgroundColor: c.surfaceTint ?? c.surface, color: c.text },
        }}
      >
        {d.body}
      </Markdown>
    </ScrollView>
  );
}
