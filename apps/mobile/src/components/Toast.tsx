import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from './Icon';
import { fontFamily, useTheme } from '../theme';
import { isRTL, t as tr } from '../i18n';
import { useEntrance } from '../motion';

type Kind = 'info' | 'success' | 'error';
interface ToastItem { id: number; message: string; kind: Kind }
const ToastContext = createContext<{ show: (message: string, kind?: Kind) => void }>({ show: () => {} });

/** `const toast = useToast(); toast.show('Saved')`. One toast at a time; it hides itself after 4 seconds. */
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [item, setItem] = useState<ToastItem | null>(null);
  const counter = useRef(0);
  const show = useCallback((message: string, kind: Kind = 'info') => { counter.current += 1; setItem({ id: counter.current, message, kind }); }, []);
  const value = useMemo(() => ({ show }), [show]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      {item ? <ToastView key={item.id} item={item} onDone={() => setItem(null)} /> : null}
    </ToastContext.Provider>
  );
}

function ToastView({ item, onDone }: { item: ToastItem; onDone: () => void }) {
  const t = useTheme();
  const c = t.color;
  const rtl = isRTL();
  const insets = useSafeAreaInsets();
  const enter = useEntrance({ rise: 20, k: 1.4, duration: 450, origin: 'center' });
  useEffect(() => { const id = setTimeout(onDone, 4000); return () => clearTimeout(id); }, [onDone]);
  const accent = item.kind === 'error' ? c.danger : item.kind === 'success' ? t.brand.teal : t.brand.orange;
  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', start: 16, end: 16, bottom: insets.bottom + 16 }}>
      <Animated.View accessibilityLiveRegion="polite" accessibilityRole="alert"
        style={[{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingStart: 16, paddingEnd: 4, minHeight: 56, borderRadius: 20,
          backgroundColor: c.surfaceRaised ?? c.surface, borderStartWidth: 6, borderStartColor: accent, borderWidth: 1, borderColor: c.border }, enter]}>
        <Text style={{ flex: 1, color: c.text, fontSize: 15, lineHeight: 21, fontFamily: fontFamily('medium', rtl) }}>{item.message}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={tr('toast.dismiss')} onPress={onDone}
          style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="close" color={c.textMuted} size={20} />
        </Pressable>
      </Animated.View>
    </View>
  );
}
