import React from 'react';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { isRTL } from '../i18n';

export type IconName = 'explore' | 'calendar' | 'chat' | 'profile' | 'check' | 'back' | 'close' | 'settings';

/** Simple line icons (24 x 24). Decorative: put the accessibility label on the button that holds the icon. */
export function Icon({ name, color, size = 24 }: { name: IconName; color: string; size?: number }) {
  const common = { stroke: color, strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' };
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessible={false} importantForAccessibility="no-hide-descendants"
      style={name === 'back' && isRTL() ? { transform: [{ scaleX: -1 }] } : undefined}>
      {name === 'explore' && (<><Circle cx={11} cy={11} r={7} {...common} /><Path d="M16.5 16.5 L21 21" {...common} /></>)}
      {name === 'calendar' && (<><Rect x={3} y={5} width={18} height={16} rx={3} {...common} /><Path d="M3 10 H21 M8 3 V7 M16 3 V7" {...common} /></>)}
      {name === 'chat' && <Path d="M5 4 H19 A2 2 0 0 1 21 6 V15 A2 2 0 0 1 19 17 H10 L5 21 V17 A2 2 0 0 1 3 15 V6 A2 2 0 0 1 5 4 Z" {...common} />}
      {name === 'profile' && (<><Circle cx={12} cy={8} r={4} {...common} /><Path d="M4 21 C4 16.6 7.6 14 12 14 C16.4 14 20 16.6 20 21" {...common} /></>)}
      {name === 'check' && <Path d="M5 12.5 L10 17.5 L19 7" {...common} />}
      {name === 'back' && <Path d="M15 5 L8 12 L15 19" {...common} />}
      {name === 'close' && <Path d="M6 6 L18 18 M18 6 L6 18" {...common} />}
      {name === 'settings' && (<><Circle cx={12} cy={12} r={3} {...common} /><Path d="M12 3 V6 M12 18 V21 M3 12 H6 M18 12 H21 M5.6 5.6 L7.8 7.8 M16.2 16.2 L18.4 18.4 M18.4 5.6 L16.2 7.8 M7.8 16.2 L5.6 18.4" {...common} /></>)}
    </Svg>
  );
}
