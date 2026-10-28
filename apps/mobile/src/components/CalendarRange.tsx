import React, { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useTheme } from '../theme';
import { isoDate } from '../lib/search';

const DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

/** Date range picker in the style of the "Post your dates" mockup. Tap a start day, then an end day. */
export function CalendarRange({ start, end, onChange, maxNights = 60 }:
  { start: string | null; end: string | null; onChange: (start: string | null, end: string | null) => void; maxNights?: number }) {
  const t = useTheme();
  const c = t.color;
  const today = isoDate(new Date());
  const [month, setMonth] = useState(() => { const d = new Date(); d.setDate(1); return d; });

  const cells = useMemo(() => {
    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    const count = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    const out: (string | null)[] = Array(first.getDay()).fill(null);
    for (let d = 1; d <= count; d++) out.push(isoDate(new Date(Date.UTC(month.getFullYear(), month.getMonth(), d))));
    return out;
  }, [month]);

  const pick = (day: string) => {
    if (day < today) return;
    if (!start || (start && end) || day < start) return onChange(day, null);
    const n = (Date.parse(day) - Date.parse(start)) / 86400000;
    if (n > maxNights) return onChange(day, null);
    onChange(start, day);
  };
  const shift = (k: number) => setMonth((m) => new Date(m.getFullYear(), m.getMonth() + k, 1));
  const label = month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

  return (
    <View accessibilityLabel="Choose dates" style={{ gap: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={{ fontFamily: 'Poppins_700', fontSize: 17, color: c.text }}>{label}</Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {[-1, 1].map((k) => (
            <Pressable key={k} accessibilityRole="button" accessibilityLabel={k < 0 ? 'Previous month' : 'Next month'} onPress={() => shift(k)}
              style={{ width: 44, height: 44, borderRadius: 22, borderWidth: 2, borderColor: c.border, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ color: c.text, fontSize: 18 }}>{k < 0 ? '‹' : '›'}</Text>
            </Pressable>
          ))}
        </View>
      </View>
      <View style={{ flexDirection: 'row' }}>
        {DAYS.map((d) => <Text key={d} style={{ flex: 1, textAlign: 'center', color: c.textMuted, fontSize: 12 }}>{d}</Text>)}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {cells.map((day, i) => {
          if (!day) return <View key={`b${i}`} style={{ width: `${100 / 7}%`, height: 44 }} />;
          const past = day < today;
          const edge = day === start || day === end;
          const inside = !!start && !!end && day > start && day < end;
          return (
            <Pressable key={day} disabled={past} onPress={() => pick(day)}
              accessibilityRole="button" accessibilityState={{ selected: edge || inside, disabled: past }} accessibilityLabel={day}
              style={{ width: `${100 / 7}%`, height: 44, alignItems: 'center', justifyContent: 'center',
                backgroundColor: inside ? t.tint.teal : 'transparent' }}>
              <View style={{ width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center',
                backgroundColor: edge ? c.primary : 'transparent' }}>
                <Text style={{ color: edge ? c.onPrimary : past ? c.border : inside ? '#1F2D3D' : c.text, fontFamily: edge ? 'Poppins_700' : 'Poppins_400' }}>
                  {Number(day.slice(8))}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
