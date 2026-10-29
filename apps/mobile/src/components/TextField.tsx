import React from 'react';
import { Text, TextInput, TextInputProps, View } from 'react-native';
import { fontFamily, useTheme } from '../theme';
import { isRTL } from '../i18n';

/** A labelled text box with a 56 pt field. Pass `hint` for a one-line example under it. */
export function TextField({ label, hint, ...input }: { label: string; hint?: string } & TextInputProps) {
  const c = useTheme().color;
  const rtl = isRTL();
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ color: c.text, fontSize: 15, fontFamily: fontFamily('semibold', rtl) }}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        accessibilityHint={hint}
        placeholderTextColor={c.textMuted}
        {...input}
        style={[{
          minHeight: 56, borderRadius: 16, borderWidth: 2, borderColor: c.textMuted, backgroundColor: c.surface, color: c.text,
          paddingHorizontal: 16, fontSize: 17, fontFamily: fontFamily('regular', rtl),
        }, input.style]}
      />
      {hint ? <Text style={{ color: c.textMuted, fontSize: 13, fontFamily: fontFamily('regular', rtl) }}>{hint}</Text> : null}
    </View>
  );
}
