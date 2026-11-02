import React from 'react';
import { View } from 'react-native';
import { t as tr } from '../i18n';
import type { MapSurfaceHandle, MapSurfaceProps } from './MapSurface';

// If the map says nothing at all for this long (blocked, offline), show the "could not load" message.
const SILENCE_MS = 20000;

/**
 * Web: the map page runs in a sandboxed iframe (scripts only: no storage, no cookies, no access to the app). The frame
 * is /map-frame.html, which has its own strict content policy; the finished page from buildMapHtml is sent into it as a
 * message, and the page's messages come back the same way. Only messages from our own frame are read.
 */
export const MapSurface = React.forwardRef<MapSurfaceHandle, MapSurfaceProps>(function MapSurface({ html, onData, onFailed }, ref) {
  const frame = React.useRef<HTMLIFrameElement | null>(null);
  const loaded = React.useRef(false);
  const onDataRef = React.useRef(onData);
  const onFailedRef = React.useRef(onFailed);
  const htmlRef = React.useRef(html);
  React.useEffect(() => { onDataRef.current = onData; onFailedRef.current = onFailed; htmlRef.current = html; });

  const send = React.useCallback((message: Record<string, unknown>) => {
    frame.current?.contentWindow?.postMessage({ pawspal: message.pawspal, ...message }, '*');
  }, []);

  React.useImperativeHandle(ref, () => ({ select: (id: string) => send({ pawspal: 'map-select', id }) }), [send]);

  // Send the page whenever it changes (and once the frame is ready).
  React.useEffect(() => { if (loaded.current) send({ pawspal: 'map-html', html }); }, [html, send]);

  React.useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = setTimeout(() => onFailedRef.current(), SILENCE_MS);
    const heard = () => { if (timer) { clearTimeout(timer); timer = null; } };
    const listen = (e: MessageEvent) => {
      if (!frame.current || e.source !== frame.current.contentWindow) return;
      const m = e.data as { pawspal?: unknown; data?: unknown } | null;
      if (!m || typeof m !== 'object') return;
      if (m.pawspal === 'map-frame-ready') { loaded.current = true; send({ pawspal: 'map-html', html: htmlRef.current }); }
      else if (m.pawspal === 'map-msg' && typeof m.data === 'string') { heard(); onDataRef.current(m.data); }
    };
    window.addEventListener('message', listen);
    return () => { window.removeEventListener('message', listen); heard(); };
  }, [send]);

  return (
    <View style={{ flex: 1 }} testID="availability-map">
      <iframe
        ref={frame}
        src="/map-frame.html"
        title={tr('map.availability.label')}
        sandbox="allow-scripts"
        style={{ border: 0, width: '100%', height: '100%', display: 'block' }}
      />
    </View>
  );
});
