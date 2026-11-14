package com.meera.assistant;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.speech.RecognizerIntent;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.util.ArrayList;
import java.util.Locale;

/**
 * M.E.E.R.A. — Android shell.
 *
 * A minimal, dependency-free host: one full-screen WebView for the HUD, plus a
 * JavaScript bridge that gives the page the two APIs Android WebView does not
 * provide on its own — text-to-speech and speech-to-text.
 *
 * The page talks to Android through `window.AndroidBridge`; `native-bridge.js`
 * in assets/www wraps that into the standard Web Speech API, so the HUD's
 * existing code runs unchanged.
 */
public class MainActivity extends Activity {

    private static final int REQ_SPEECH = 4201;
    private static final int REQ_MIC_PERMISSION = 4202;

    private WebView web;
    private TextToSpeech tts;
    private boolean ttsReady = false;
    private boolean pendingListen = false;

    /** Public entry point for the TTS init callback. */
    public interface TtsSink {
        void ready(boolean ok);
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(true);
        s.setAllowContentAccess(true);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.JELLY_BEAN) {
            s.setAllowFileAccessFromFileURLs(true);
            s.setAllowUniversalAccessFromFileURLs(true);
        }
        s.setTextZoom(100);

        web.setBackgroundColor(0xFF03070D);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        web.setWebViewClient(new WebViewClient());
        web.setWebChromeClient(new WebChromeClient());
        web.addJavascriptInterface(new Bridge(), "AndroidBridge");

        setContentView(web);

        tts = new TextToSpeech(this, status -> {
            ttsReady = status == TextToSpeech.SUCCESS;
            if (ttsReady) {
                int r = tts.setLanguage(new Locale("en", "IN"));
                if (r == TextToSpeech.LANG_MISSING_DATA || r == TextToSpeech.LANG_NOT_SUPPORTED) {
                    tts.setLanguage(Locale.US);
                }
                tts.setPitch(1.12f);
                tts.setSpeechRate(1.02f);
                tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                    @Override public void onStart(String id) { }
                    @Override public void onDone(String id) { notifySpeechDone(); }
                    @Override public void onError(String id) { notifySpeechDone(); }
                });
            }
        });

        web.loadUrl("file:///android_asset/www/index.html");
    }

    /* ------------------------------------------------------------------
       JS -> native
    ------------------------------------------------------------------ */

    public class Bridge {

        @JavascriptInterface
        public String platform() {
            return "android";
        }

        @JavascriptInterface
        public int sdkInt() {
            return Build.VERSION.SDK_INT;
        }

        @JavascriptInterface
        public void speak(final String text) {
            runOnUiThread(() -> {
                if (!ttsReady) {
                    notifySpeechDone();
                    return;
                }
                tts.stop();
                tts.speak(text == null ? "" : text, TextToSpeech.QUEUE_FLUSH, null, "meera");
            });
        }

        @JavascriptInterface
        public void stopSpeaking() {
            runOnUiThread(() -> {
                if (ttsReady) tts.stop();
            });
        }

        @JavascriptInterface
        public void listen() {
            runOnUiThread(MainActivity.this::startListening);
        }

        @JavascriptInterface
        public void toast(String message) {
            runOnUiThread(() -> Toast.makeText(MainActivity.this, message, Toast.LENGTH_SHORT).show());
        }

        @JavascriptInterface
        public void vibrate(int ms) {
            runOnUiThread(() -> {
                try {
                    android.os.Vibrator v =
                            (android.os.Vibrator) getSystemService(VIBRATOR_SERVICE);
                    if (v != null) v.vibrate(ms);
                } catch (Exception ignored) { }
            });
        }
    }

    /* ------------------------------------------------------------------
       speech
    ------------------------------------------------------------------ */

    private void startListening() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M
                && checkSelfPermission(Manifest.permission.RECORD_AUDIO)
                   != PackageManager.PERMISSION_GRANTED) {
            pendingListen = true;
            requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, REQ_MIC_PERMISSION);
            return;
        }

        Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL,
                        RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, "en-IN");
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, "en-IN");
        intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, false);
        intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
        intent.putExtra(RecognizerIntent.EXTRA_PROMPT, "Speak to Meera");

        try {
            startActivityForResult(intent, REQ_SPEECH);
        } catch (Exception e) {
            notifySpeechFailed("No speech recogniser on this device");
        }
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] perms, int[] results) {
        if (code == REQ_MIC_PERMISSION) {
            boolean granted = results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED;
            if (granted && pendingListen) {
                pendingListen = false;
                startListening();
            } else {
                pendingListen = false;
                notifySpeechFailed("Microphone permission denied");
            }
            return;
        }
        super.onRequestPermissionsResult(code, perms, results);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == REQ_SPEECH) {
            String text = "";
            if (resultCode == RESULT_OK && data != null) {
                ArrayList<String> results =
                        data.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS);
                if (results != null && !results.isEmpty()) text = results.get(0);
            }
            if (text == null || text.trim().isEmpty()) {
                notifySpeechFailed("");
            } else {
                eval("window.__meeraSpeechResult && window.__meeraSpeechResult(" + jsString(text) + ");");
            }
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    /* ------------------------------------------------------------------
       native -> JS
    ------------------------------------------------------------------ */

    private void notifySpeechDone() {
        eval("window.__meeraSpeechEnd && window.__meeraSpeechEnd();");
    }

    private void notifySpeechFailed(String why) {
        eval("window.__meeraSpeechFail && window.__meeraSpeechFail(" + jsString(why) + ");");
    }

    private void eval(final String js) {
        runOnUiThread(() -> {
            if (web == null) return;
            try {
                web.evaluateJavascript(js, null);
            } catch (Exception ignored) { }
        });
    }

    /** Escape a Java string into a JavaScript string literal. */
    private static String jsString(String s) {
        if (s == null) return "\"\"";
        StringBuilder sb = new StringBuilder(s.length() + 16);
        sb.append('"');
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"':  sb.append("\\\""); break;
                case '\\': sb.append("\\\\"); break;
                case '\n': sb.append("\\n");  break;
                case '\r': sb.append("\\r");  break;
                case '\t': sb.append("\\t");  break;
                default:
                    if (c < 0x20 || c == 0x2028 || c == 0x2029) {
                        sb.append(String.format("\\u%04x", (int) c));
                    } else {
                        sb.append(c);
                    }
            }
        }
        return sb.append('"').toString();
    }

    /* ------------------------------------------------------------------
       lifecycle
    ------------------------------------------------------------------ */

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK && web != null && web.canGoBack()) {
            web.goBack();
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }

    @Override
    protected void onDestroy() {
        if (tts != null) {
            try {
                tts.stop();
                tts.shutdown();
            } catch (Exception ignored) { }
        }
        if (web != null) {
            try { web.destroy(); } catch (Exception ignored) { }
        }
        super.onDestroy();
    }
}
