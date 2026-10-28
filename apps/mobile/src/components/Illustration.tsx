import React from 'react';
import { SvgXml } from 'react-native-svg';
import { svg, SvgName } from '../illustrations';

/** Renders one of the shared illustrations (the same files used in the Instagram posts). */
export function Illustration({ name, width, height, label }: { name: SvgName; width: number; height?: number; label?: string }) {
  return (
    <SvgXml
      xml={svg[name]}
      width={width}
      height={height ?? width}
      accessibilityRole={label ? 'image' : undefined}
      accessibilityLabel={label}
      accessible={!!label}
    />
  );
}
