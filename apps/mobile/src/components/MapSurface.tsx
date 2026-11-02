import React from 'react';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import { useTheme } from '../theme';

/** The map page may only be the page itself. Every other navigation (links, redirects, other sites) is refused. */
export const allowMapRequest = (url: string): boolean => url === 'about:blank' || url === 'about:srcdoc';

export interface MapSurfaceHandle { select(id: string): void }
export interface MapSurfaceProps {
  html: string;
  /** Origins the page may load from (phone only). */
  whitelist: string[];
  /** Raw text the page posted to us. The caller checks it. */
  onData: (data: string) => void;
  onFailed: () => void;
}

/** Phone: the map page runs in a locked-down WebView. (The web version, MapSurface.web.tsx, uses a sandboxed iframe.) */
export const MapSurface = React.forwardRef<MapSurfaceHandle, MapSurfaceProps>(function MapSurface({ html, whitelist, onData, onFailed }, ref) {
  const c = useTheme().color;
  const web = React.useRef<WebView<object>>(null);
  React.useImperativeHandle(ref, () => ({
    select: (id: string) => { web.current?.injectJavaScript?.(`window.__select&&window.__select(${JSON.stringify(id)});true;`); },
  }), []);
  return (
    <WebView<object>
      ref={web}
      testID="availability-map"
      source={{ html, baseUrl: 'about:blank' }}
      originWhitelist={whitelist}
      onShouldStartLoadWithRequest={(req) => allowMapRequest(req.url)}
      onMessage={(e: WebViewMessageEvent) => onData(e.nativeEvent.data)}
      onError={onFailed}
      onHttpError={onFailed}
      javaScriptEnabled
      domStorageEnabled={false}
      allowFileAccess={false}
      allowFileAccessFromFileURLs={false}
      allowUniversalAccessFromFileURLs={false}
      allowsLinkPreview={false}
      geolocationEnabled={false}
      setSupportMultipleWindows={false}
      javaScriptCanOpenWindowsAutomatically={false}
      mixedContentMode="never"
      thirdPartyCookiesEnabled={false}
      sharedCookiesEnabled={false}
      overScrollMode="never"
      style={{ flex: 1, backgroundColor: c.surface }}
    />
  );
});
