import React from 'react';
import { Text, View } from 'react-native';
import { Icon } from './Icon';
import { fontFamily, useTheme } from '../theme';
import { isRTL } from '../i18n';

/** Teal check circle, a title and a one-line description (verification and rules screens). */
export function CheckRow({ title, description, done = true }: { title: string; description?: string; done?: boolean }) {
  const t = useTheme();
  const c = t.color;
  const rtl = isRTL();
  return (
    <View accessible accessibilityLabel={description ? `${title}. ${description}` : title} style={{ flexDirection: 'row', gap: 14, alignItems: 'flex-start', paddingVertical: 8 }}>
      <View style={{ width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center',
        backgroundColor: done ? t.brand.teal : 'transparent', borderWidth: done ? 0 : 2, borderColor: c.border }}>
        {done ? <Icon name="check" color={t.brand.navy} size={18} /> : null}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ color: c.text, fontSize: 17, fontFamily: fontFamily('bold', rtl) }}>{title}</Text>
        {description ? <Text style={{ color: c.textMuted, fontSize: 14, lineHeight: 20, fontFamily: fontFamily('regular', rtl) }}>{description}</Text> : null}
      </View>
    </View>
  );
}
