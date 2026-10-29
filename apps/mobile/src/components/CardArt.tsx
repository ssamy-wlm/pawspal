import React from 'react';
import { View } from 'react-native';
import Svg, { Circle, Ellipse, G, Path } from 'react-native-svg';
import { Blob } from './Blob';
import { Illustration } from './Illustration';
import { lightTheme, navyTheme, Theme, useTheme } from '../theme';
import type { SvgName } from '../illustrations';

export type CardIllustration = 'dog-biscuit' | 'cat-mango' | 'cat-midnight' | 'husky-storm';
export type CardBackground = 'circles_teal' | 'circles_orange' | 'circles_sand' | 'pattern' | 'navy';
export const ILLUSTRATIONS: CardIllustration[] = ['dog-biscuit', 'cat-mango', 'cat-midnight', 'husky-storm'];
export const BACKGROUNDS: CardBackground[] = ['circles_teal', 'circles_orange', 'circles_sand', 'pattern', 'navy'];

export const ART: Record<CardIllustration, SvgName> = {
  'dog-biscuit': 'dogBiscuit', 'cat-mango': 'catMango', 'cat-midnight': 'catMidnight', 'husky-storm': 'huskyStorm',
};

/** Three circles per background (big tint, small white, warm accent), as on the mockups. Looks the same in every app theme. */
export function cardBackground(kind: string, t: Theme) {
  const white = lightTheme.color.surface;        // white in every app theme, like the printed card
  switch (kind) {
    case 'circles_orange': return { fill: t.tint.orange, circles: [t.tint.orangeSoft, white, t.tint.teal] as const, pattern: false };
    case 'circles_sand': return { fill: t.brand.sand, circles: [t.tint.sand, white, t.tint.orange] as const, pattern: false };
    case 'pattern': return { fill: white, circles: null, pattern: true };
    case 'navy': return { fill: t.brand.navy, circles: [navyTheme.color.surface!, navyTheme.color.surface!, navyTheme.color.surface!] as const, pattern: false };
    default: return { fill: t.tint.teal, circles: [t.tint.sea, white, t.tint.orange] as const, pattern: false };
  }
}

/** Circle geometry as fractions of the art's height: [x, y, size, anchor]. */
const GEOMETRY: [number, number, number, 'start' | 'end'][] = [[-0.3, -0.35, 1.0, 'start'], [0.12, 0.04, 0.38, 'end'], [-0.28, 0.32, 0.7, 'end']];

const HEART = 'M12 21s-7-4.5-9.5-9C1 8.5 3 5 6.5 5c2 0 3.5 1 5.5 3 2-2 3.5-3 5.5-3C21 5 23 8.5 21.5 12 19 16.5 12 21 12 21z';

/** White background with light yellow paws and pink hearts, in a staggered grid (docs/design-system.md). */
export function PawHeartPattern({ width, height, paw, heart }: { width: number; height: number; paw: string; heart: string }) {
  const step = 56;
  const cells: React.ReactNode[] = [];
  for (let row = 0; row * step < height + step; row++) {
    for (let col = 0; col * step < width + step; col++) {
      const x = col * step + (row % 2 ? step / 2 : 0) - 8;
      const y = row * step - 4;
      const isPaw = (row + col) % 2 === 0;
      cells.push(isPaw ? (
        <G key={`${row}-${col}`} transform={`translate(${x} ${y}) rotate(${(row * 3 + col * 5) % 2 ? -14 : 14} 12 12)`} fill={paw}>
          <Ellipse cx={12} cy={15.5} rx={5.5} ry={4.5} />
          <Circle cx={5.5} cy={10} r={2.4} /><Circle cx={9.5} cy={5.8} r={2.4} /><Circle cx={14.5} cy={5.8} r={2.4} /><Circle cx={18.5} cy={10} r={2.4} />
        </G>
      ) : (
        <Path key={`${row}-${col}`} d={HEART} fill={heart} transform={`translate(${x + 2} ${y + 2}) scale(0.85)`} />
      ));
    }
  }
  return <Svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>{cells}</Svg>;
}

/**
 * The illustration on the chosen background: the top of a profile, the card in a swipe deck, and the live preview in the
 * card picker. Circles pop in and breathe (docs/motion.md section 2; still when Reduce Motion is on). `compact` is the
 * small, still version for list rows, so a long list stays smooth.
 */
export function CardArt({ illustration, background, height = 220, compact, label }: { illustration: string; background: string; height?: number; compact?: boolean; label?: string }) {
  const t = useTheme();
  const bg = cardBackground(background, t);
  const art = ART[illustration as CardIllustration] ?? 'dogBiscuit';
  const size = compact ? 96 : height;
  const [width, setWidth] = React.useState(compact ? 96 : 360);
  return (
    <View
      onLayout={compact ? undefined : (e) => setWidth(Math.round(e.nativeEvent.layout.width))}
      style={{ height: size, ...(compact ? { width: 96, borderRadius: 20 } : null), backgroundColor: bg.fill, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
      {bg.pattern ? (
        <View pointerEvents="none" accessible={false} importantForAccessibility="no-hide-descendants" style={{ position: 'absolute', top: 0, start: 0 }}>
          <PawHeartPattern width={width} height={size} paw={t.tint.paw} heart={t.tint.heart} />
        </View>
      ) : bg.circles ? GEOMETRY.map(([x, y, s, anchor], i) => compact ? (
        <View key={i} pointerEvents="none" accessible={false} importantForAccessibility="no-hide-descendants"
          style={{ position: 'absolute', [anchor]: x * size, top: y * size, width: s * size, height: s * size, borderRadius: s * size, backgroundColor: bg.circles![i] }} />
      ) : (
        <Blob key={i} anchor={anchor} x={x * size} y={y * size} size={s * size} color={bg.circles![i]} delay={i * 120} />
      )) : null}
      <Illustration name={art} width={size * 0.85} height={size * 0.72} label={label} />
    </View>
  );
}
