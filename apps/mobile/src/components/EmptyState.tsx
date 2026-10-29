import React from 'react';
import { Text, View } from 'react-native';
import { AnimatedLogo } from './AnimatedLogo';
import { Button } from './Button';
import { Illustration } from './Illustration';
import { fontFamily, useTheme } from '../theme';
import { isRTL } from '../i18n';
import type { SvgName } from '../illustrations';

/** Logo or a pet illustration, one line of text, one action. */
export function EmptyState({ message, actionLabel, onAction, art }: { message: string; actionLabel?: string; onAction?: () => void; art?: SvgName }) {
  const c = useTheme().color;
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 20 }}>
      {art ? <Illustration name={art} width={160} height={136} /> : <AnimatedLogo size={120} />}
      <Text style={{ color: c.text, fontSize: 18, lineHeight: 26, textAlign: 'center', fontFamily: fontFamily('medium', isRTL()), maxWidth: 300 }}>{message}</Text>
      {actionLabel && onAction ? <Button title={actionLabel} onPress={onAction} /> : null}
    </View>
  );
}
