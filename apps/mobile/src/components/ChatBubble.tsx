import React from 'react';
import Animated from 'react-native-reanimated';
import { Text, View } from 'react-native';
import { fontFamily, useTheme } from '../theme';
import { isRTL, t as tr } from '../i18n';
import { useEntrance } from '../motion';

/** Incoming: white with a sand border. Outgoing: deep teal with white text. Arrives like in docs/motion.md section 5. */
export function ChatBubble({ text, mine, masked, animate = true }: { text: string; mine?: boolean; masked?: boolean; animate?: boolean }) {
  const t = useTheme();
  const c = t.color;
  const rtl = isRTL();
  // The "tail" corner is bottom-end for my messages and bottom-start for theirs.
  const entrance = useEntrance({ rise: 40, k: 1.6, duration: 450, origin: mine ? 'bottom-end' : 'bottom-start', rtl });
  return (
    <Animated.View style={[{ alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '82%', gap: 4 }, animate ? entrance : null]}>
      <View style={{ paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20,
        borderBottomEndRadius: mine ? 6 : 20, borderBottomStartRadius: mine ? 20 : 6,
        backgroundColor: mine ? c.primary : c.surface, borderWidth: mine ? 0 : 1, borderColor: t.brand.sand }}>
        <Text style={{ color: mine ? c.onPrimary : c.text, fontSize: 16, lineHeight: 22, fontFamily: fontFamily('regular', rtl) }}>{text}</Text>
      </View>
      {masked ? <Text style={{ color: c.textMuted, fontSize: 12, fontFamily: fontFamily('regular', rtl) }}>{tr('chat.maskedHint')}</Text> : null}
    </Animated.View>
  );
}
