import React from 'react';
import { View } from 'react-native';
import { WebView, WebViewMessageEvent } from 'react-native-webview';

/**
 * Cloudflare Turnstile (free CAPTCHA). It runs inside a small web view and hands back a one-time token, which Supabase
 * Auth checks on the server. Usually the person sees nothing and it solves itself.
 *
 *   EXPO_PUBLIC_TURNSTILE_SITE_KEY  the public site key (not a secret). Unset: the app never asks for a CAPTCHA.
 *   EXPO_PUBLIC_TURNSTILE_ORIGIN    a web address added to the widget's allowed hostnames in Cloudflare.
 */
export const turnstileSiteKey = () => process.env.EXPO_PUBLIC_TURNSTILE_SITE_KEY || '';
const origin = () => process.env.EXPO_PUBLIC_TURNSTILE_ORIGIN || 'https://pawspal.vercel.app';

export function turnstileHtml(siteKey: string): string {
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
<style>html,body{margin:0;background:transparent;display:flex;justify-content:center}</style>
<script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" async defer></script></head>
<body><div id="c"></div><script>
function post(m){window.ReactNativeWebView.postMessage(JSON.stringify(m));}
var t=setInterval(function(){if(window.turnstile){clearInterval(t);
window.turnstile.render('#c',{sitekey:${JSON.stringify(siteKey)},theme:'dark',
callback:function(k){post({token:k});},'error-callback':function(){post({error:true});},'expired-callback':function(){post({error:true});}});}},100);
</script></body></html>`;
}

export function Turnstile({ siteKey, onToken, onError }: { siteKey: string; onToken: (token: string) => void; onError: () => void }) {
  const done = React.useRef(false);
  const onMessage = (e: WebViewMessageEvent) => {
    try {
      const m = JSON.parse(e.nativeEvent.data) as { token?: unknown; error?: unknown };
      if (typeof m.token === 'string' && m.token && !done.current) { done.current = true; onToken(m.token); } else if (m.error) onError();
    } catch { onError(); }
  };
  return (
    <View style={{ height: 80 }}>
      <WebView
        originWhitelist={['https://*']}
        source={{ html: turnstileHtml(siteKey), baseUrl: origin() }}
        onMessage={onMessage}
        javaScriptEnabled
        scrollEnabled={false}
        style={{ backgroundColor: 'transparent' }}
        accessibilityLabel="CAPTCHA"
      />
    </View>
  );
}
