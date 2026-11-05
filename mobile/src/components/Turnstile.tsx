import { useMemo } from "react";
import { View } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import { env } from "@/mobile/src/lib/env";

type Props = { onToken: (token: string) => void; onError: () => void };

/**
 * Cloudflare Turnstile widget'ı WebView içinde (SPEC-MOBILE M2). baseUrl = web alan adı: Turnstile alan adı
 * doğrulaması bu kökene göre yapılır; Turnstile panelinde EXPO_PUBLIC_API_URL alan adı tanımlı olmalı.
 * Token tek kullanımlıktır; signInAnonymously({ captchaToken }) ile Supabase'e iletilir.
 */
export function Turnstile({ onToken, onError }: Props) {
  const html = useMemo(
    () => `<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>html,body{margin:0;background:transparent;display:flex;align-items:center;justify-content:center;height:100%}</style>
<script src="https://challenges.cloudflare.com/turnstile/v0/api.js?onload=__onload&render=explicit" async defer></script>
<script>
function __post(m){window.ReactNativeWebView&&window.ReactNativeWebView.postMessage(JSON.stringify(m));}
function __onload(){try{turnstile.render('#w',{sitekey:${JSON.stringify(env.turnstileSiteKey)},language:'tr',theme:'auto',size:'flexible',
 callback:function(t){__post({type:'token',token:t});},'error-callback':function(){__post({type:'error'});},'expired-callback':function(){__post({type:'error'});}});}
 catch(e){__post({type:'error'});}}
</script></head><body><div id="w"></div></body></html>`,
    [],
  );

  function onMessage(e: WebViewMessageEvent) {
    try {
      const m = JSON.parse(e.nativeEvent.data) as { type: string; token?: string };
      if (m.type === "token" && m.token) onToken(m.token);
      else onError();
    } catch {
      onError();
    }
  }

  return (
    <View style={{ height: 80, width: "100%" }} accessibilityLabel="Robot olmadığını doğrula">
      <WebView
        originWhitelist={["*"]}
        source={{ html, baseUrl: env.apiUrl }}
        onMessage={onMessage}
        onError={onError}
        javaScriptEnabled
        domStorageEnabled={false}
        style={{ backgroundColor: "transparent" }}
        // Görsel/kamera verisi bu WebView'a hiçbir zaman girmez; yalnız captcha.
      />
    </View>
  );
}
