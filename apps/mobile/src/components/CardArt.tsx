import React from 'react';
import { View } from 'react-native';
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

/** The person's chosen card background. It looks the same in every app theme, like the printed card in the posts. */
export function cardBackground(kind: string, t: Theme) {
  switch (kind) {
    case 'circles_orange': return { fill: t.tint.orange, circle: lightTheme.color.surface, circleOpacity: 0.55 };
    case 'circles_sand': return { fill: t.brand.sand, circle: lightTheme.color.surface, circleOpacity: 0.55 };
    case 'pattern': return { fill: lightTheme.color.surface, circle: t.tint.orange, circleOpacity: 0.5 };
    case 'navy': return { fill: t.brand.navy, circle: navyTheme.color.surface!, circleOpacity: 1 };
    default: return { fill: t.tint.teal, circle: lightTheme.color.surface, circleOpacity: 0.55 };
  }
}

/** The illustration on the chosen background: the top of a profile, and the live preview in the card picker. */
export function CardArt({ illustration, background, height = 220, label }: { illustration: string; background: string; height?: number; label?: string }) {
  const t = useTheme();
  const bg = cardBackground(background, t);
  const art = ART[illustration as CardIllustration] ?? 'dogBiscuit';
  return (
    <View style={{ height, backgroundColor: bg.fill, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
      <View style={{ position: 'absolute', end: -height * 0.2, top: -height * 0.2, width: height * 0.75, height: height * 0.75, borderRadius: height,
        backgroundColor: bg.circle, opacity: bg.circleOpacity }} />
      <Illustration name={art} width={height * 0.85} height={height * 0.72} label={label} />
    </View>
  );
}
